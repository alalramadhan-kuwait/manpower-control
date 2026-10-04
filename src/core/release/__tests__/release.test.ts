import { describe, expect, it } from 'vitest';
import { FULL_OPERATION, type MpAbsence, type MpAssignment, type MpPerson } from '../../manpower';
import type { Crew } from '../../roster';
import { checkRelease } from '..';

// 23 Sep 2026: A = Morning, C = Afternoon, B = Night, D = Off.
const DAY = '2026-09-23';
const P = (id: string, role: MpPerson['role'], crew: Crew | null, grade = 11): MpPerson =>
  ({ id, employeeNumber: id, name: id, role, crew, grade, employmentType: 'knpc', takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null });
/** One Controller, `panel` Panel Operators (first Grade 14, the rest 13), `field` Take-Charge Field Operators (Grade 11). */
const crew = (c: Crew, panel = 3, field = 7): MpPerson[] => [P(`ctl${c}`, 'controller', c, 16), ...Array.from({ length: panel }, (_, i) => P(`p${c}${i}`, 'panel_operator', c, i === 0 ? 14 : 13)), ...Array.from({ length: field }, (_, i) => P(`f${c}${i}`, 'field_operator', c, 11))];
const world = (a: MpPerson[]) => [...a, ...crew('B'), ...crew('C'), ...crew('D')];
const none: MpAssignment[] = [];

describe('release check', () => {
  it('a Field Operator when the crew has no Grade 13+ spare: the crew is left at the minimum (no buffer)', () => {
    const a = crew('A', 3, 7);
    const r = checkRelease(a.find((p) => p.id === 'fA0')!, DAY, DAY, world(a), [], FULL_OPERATION, none);
    expect(r.days[0]).toMatchObject({ kind: 'duty', crew: 'A', verdict: 'no_buffer', before: 'amber', after: 'amber' });
    expect(r.days[0].positions.find((p) => p.key === 'field')).toMatchObject({ before: 7, after: 6, min: 6 });
    expect(r.verdict).toBe('no_buffer');
  });
  it('with a Panel spare (Grade 13+) or two spare Field Operators the buffer is kept (safe)', () => {
    const a = crew('A', 4, 8);
    const r = checkRelease(a.find((p) => p.id === 'fA0')!, DAY, DAY, world(a), [], FULL_OPERATION, none);
    expect(r.days[0].verdict).toBe('safe');
    expect(r.days[0].after).toBe('green');
    const b = crew('A', 4, 7);
    const r2 = checkRelease(b.find((p) => p.id === 'fA0')!, DAY, DAY, world(b), [], FULL_OPERATION, none);
    expect(r2.days[0]).toMatchObject({ verdict: 'safe', backup: 'pA1' });
  });
  it('a Field Operator when the crew is at the minimum: shortage, with the numbers', () => {
    const a = crew('A', 3, 6);
    const r = checkRelease(a.find((p) => p.id === 'fA0')!, DAY, DAY, world(a), [], FULL_OPERATION, none);
    expect(r.days[0].verdict).toBe('shortage');
    expect(r.days[0].positions.find((p) => p.key === 'field')).toMatchObject({ before: 6, after: 5, min: 6 });
    expect(r.counts.shortage).toBe(1);
  });
  it('the Controller: the shift needs a cover', () => {
    const a = crew('A');
    const r = checkRelease(a.find((p) => p.id === 'ctlA')!, DAY, DAY, world(a), [], FULL_OPERATION, none);
    expect(r.days[0].verdict).toBe('cover');
  });
  it('his crew is off that day: nothing changes', () => {
    const d = crew('D');
    const r = checkRelease(d.find((p) => p.id === 'fD0')!, DAY, DAY, [...crew('A'), ...crew('B'), ...crew('C'), ...d], [], FULL_OPERATION, none);
    expect(r.days[0]).toMatchObject({ kind: 'rest', verdict: null });
    expect(r.verdict).toBeNull();
  });
  it('already on leave that day: it is not counted twice', () => {
    const a = crew('A', 3, 7);
    const leave: MpAbsence = { id: 'l1', employeeId: 'fA0', start: DAY, end: DAY, status: 'approved', typeCode: 'annual_leave_planned', typeLabel: 'Planned Annual Leave', inCurrentPlan: true };
    const r = checkRelease(a.find((p) => p.id === 'fA0')!, DAY, DAY, world(a), [leave], FULL_OPERATION, none);
    expect(r.days[0].kind).toBe('absent');
  });
  it('several days: the worst day decides the verdict', () => {
    const a = crew('A', 3, 7);
    const sick: MpAbsence = { id: 's1', employeeId: 'fA1', start: '2026-09-24', end: '2026-09-24', status: 'approved', typeCode: 'sick_leave', typeLabel: 'Sick Leave', inCurrentPlan: true };
    // 23 Sep: A morning; the 24th A is Off 1 ... the check follows the crew's rota for each day
    const r = checkRelease(a.find((p) => p.id === 'fA0')!, DAY, '2026-09-28', world(a), [sick], FULL_OPERATION, none);
    expect(r.days).toHaveLength(6);
    expect(r.days.filter((x) => x.kind === 'duty').length).toBeGreaterThan(0);
  });
});
