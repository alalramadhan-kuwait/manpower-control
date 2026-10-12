import { describe, expect, it } from 'vitest';
import { conflicts, personRow, sickBand, sickRolling, type StatCode, type StatSnapshot, type StatValue } from '..';
import { parseOracleStats } from '../parse';

const codes: StatCode[] = ['SH', 'SK', 'SS', 'SW', 'SD'].map((c) => ({ code: c, label: c, countsAsSick: true, appType: null, verified: true, source: 'SH', note: null }))
  .concat(['AB', 'PE', 'SP'].map((c) => ({ code: c, label: c, countsAsSick: false, appType: null, verified: true, source: 'SH', note: null })));
const ALL = ['SH', 'SK', 'SS', 'SW', 'SD', 'AB', 'PE'];
const snap = (id: string, ps: string, pe: string, taken: string, emps: string[], c = ALL): StatSnapshot => ({ id, source: 'R', periodStart: ps, periodEnd: pe, extractedOn: taken, codes: c, employees: emps, importedAt: `${taken}T08:00:00Z` });
const val = (s: string, e: string, code: string, days: number, status: StatValue['status'] = 'active'): StatValue => ({ snapshotId: s, employeeId: e, code, days, occurrences: null, status });

describe('Oracle statistics: rolling 12 months', () => {
  const s1 = snap('s1', '2025-10-01', '2026-09-30', '2026-10-05', ['a', 'b']);
  const values = [val('s1', 'a', 'SK', 10), val('s1', 'a', 'SS', 5), val('s1', 'a', 'AB', 2)];
  it('verified sum of the sick codes only (AB / PE are not sick days)', () => {
    const r = sickRolling('a', '2026-10-12', [s1], values, codes);
    expect(r.state).toBe('verified'); expect(r.days).toBe(15); expect(sickBand(15)).toBe('eligible');
  });
  it('a covered person with no figure had 0; a person not in the report is unknown, never 0', () => {
    expect(sickRolling('b', '2026-10-12', [s1], values, codes)).toMatchObject({ state: 'verified', days: 0 });
    expect(sickRolling('c', '2026-10-12', [s1], values, codes)).toMatchObject({ state: 'missing', days: null });
    expect(personRow(s1, values, 'b').SK).toBe(0);
  });
  it('a calendar-year total is never stretched into a rolling figure', () => {
    const cy = snap('cy', '2026-01-01', '2026-09-30', '2026-10-05', ['a']);
    expect(sickRolling('a', '2026-10-12', [cy], [val('cy', 'a', 'SK', 30)], codes)).toMatchObject({ state: 'verification_needed', days: null });
  });
  it('older than 45 days: Data outdated', () => {
    expect(sickRolling('a', '2026-12-30', [s1], values, codes).state).toBe('outdated');
  });
  it('a report missing a sick code: Verification needed', () => {
    const part = snap('p', '2025-10-01', '2026-09-30', '2026-10-05', ['a'], ['SK', 'AB']);
    expect(sickRolling('a', '2026-10-12', [part], [val('p', 'a', 'SK', 3)], codes).state).toBe('verification_needed');
  });
  it('bands 21 / 22 / 35 / 36', () => { expect([21, 22, 35, 36].map(sickBand)).toEqual(['eligible', 'warning', 'warning', 'excluded']); });
  it('superseded values do not count twice; changed figures are conflicts', () => {
    const s2 = snap('s2', '2025-10-01', '2026-09-30', '2026-10-10', ['a']);
    const vs = [val('s1', 'a', 'SK', 10, 'superseded'), val('s2', 'a', 'SK', 12)];
    expect(sickRolling('a', '2026-10-12', [s1, s2], vs, codes).days).toBe(12);
    expect(conflicts({ start: '2025-10-01', end: '2026-09-30' }, [{ employeeId: 'a', code: 'SK', days: 14 }], [s1, s2], vs)).toEqual([{ employeeId: 'a', code: 'SK', days: 14, existing: 12 }]);
    expect(conflicts({ start: '2025-10-01', end: '2026-09-30' }, [{ employeeId: 'a', code: 'SK', days: 12 }], [s1, s2], vs)).toEqual([]);
  });
});

describe('Oracle statistics file', () => {
  it('long layout', () => {
    const r = parseOracleStats([['Employee Number', 'Code', 'Days', 'Occurrences'], ['12345', 'sk', 3, 2], ['12345', 'AB', '1', null], ['', 'PE', 2], ['99999', 'SK', 'x']]);
    expect(r.layout).toBe('long'); expect(r.values).toHaveLength(2); expect(r.values[0]).toMatchObject({ code: 'SK', days: 3, occurrences: 2 }); expect(r.problems).toHaveLength(2);
  });
  it('wide layout', () => {
    const r = parseOracleStats([['Report'], ['Emp No', 'Name', 'SK', 'AB', 'PE'], ['12345', 'A', 4, null, 1]]);
    expect(r.layout).toBe('wide'); expect(r.codes).toEqual(['AB', 'PE', 'SK']); expect(r.values.map((v) => v.code)).toEqual(['SK', 'PE']);
  });
  it('no header: nothing guessed', () => { expect(parseOracleStats([['a', 'b'], [1, 2]]).layout).toBeNull(); });
});
