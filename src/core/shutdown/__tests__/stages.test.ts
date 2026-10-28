import { describe, expect, it } from 'vitest';
import { runRecord, sopRefs, stageSummary, stdTimeline, type StdStep } from '../stages';

const T0 = Date.parse('2026-11-12T03:00:00Z');
const H = 3_600_000;
const step = (id: string, stdHours: number | null, status: StdStep['status'] = 'not_started', startedAt: string | null = null, doneAt: string | null = null): StdStep => ({ id, stdHours, status, startedAt, doneAt });

describe('stdTimeline', () => {
  it('plans the steps one after another by their standard hours, skipping a step not required', () => {
    const v = stdTimeline([step('a', 4), step('b', 6, 'not_required'), step('c', 2)], T0, T0);
    expect(v.map((x) => [(x.planStart! - T0) / H, (x.planEnd! - T0) / H])).toEqual([[0, 4], [4, 4], [4, 6]]);
  });
  it('measures actual against standard and flags a running step past its plan', () => {
    const now = T0 + 7 * H;
    const v = stdTimeline([step('a', 4, 'done', new Date(T0).toISOString(), new Date(T0 + 5 * H).toISOString()), step('b', 1, 'running', new Date(T0 + 5 * H).toISOString())], T0, now);
    expect(v[0]).toMatchObject({ actualH: 5, overH: 1, late: false });
    expect(v[1]).toMatchObject({ actualH: 2, overH: 1, late: true });
  });
  it('a step not started after its planned start is late; no stage start, no plan', () => {
    expect(stdTimeline([step('a', 4)], T0, T0 + H)[0].late).toBe(true);
    expect(stdTimeline([step('a', 4)], null, T0)[0]).toMatchObject({ planStart: null, late: false });
  });
  it('re-plans the next steps on the actual times: a late step moves the ones after it', () => {
    const now = T0 + 30 * H;
    const v = stdTimeline([step('a', 3, 'done', new Date(T0).toISOString(), new Date(T0 + 26 * H).toISOString()), step('b', 6, 'running', new Date(T0 + 29 * H).toISOString()), step('c', 9)], T0, now);
    expect((v[2].planStart! - T0) / H).toBe(35);
    expect(v[2].late).toBe(false);
  });
});

describe('stageSummary', () => {
  it('counts the standard hours and the steps done, not the ones not required', () => {
    const s = stageSummary([step('a', 4, 'done', '2026-11-12T03:00:00Z', '2026-11-12T07:00:00Z'), step('b', 6, 'not_required'), step('c', 2)]);
    expect(s).toMatchObject({ stdH: 6, done: 1, total: 2, finishedAt: null });
    expect(s.startedAt).toBe(T0);
  });
});

describe('runRecord', () => {
  const ev = [
    { id: '1', title: 'SD', unitCodes: ['train_1'], start: '2025-12-26', end: '2026-01-24' },
    { id: '2', title: 'Sulfur line SD', unitCodes: ['train_1'], start: '2026-10-09', end: '2026-10-24' },
    { id: '3', title: 'SD', unitCodes: ['train_2'], start: '2026-10-18', end: '2026-11-16' },
    { id: '4', title: 'Cat change', unitCodes: ['train_1'], start: '2029-01-01', end: '2029-01-30', tentative: true },
  ];
  it('gives down and running periods newest first, from the first recorded shutdown', () => {
    expect(runRecord(ev, 'train_1', '2026-10-28')).toEqual([
      { kind: 'run', start: '2026-10-25', end: null, days: 4, eventId: null, title: null },
      { kind: 'down', start: '2026-10-09', end: '2026-10-24', days: 16, eventId: '2', title: 'Sulfur line SD' },
      { kind: 'run', start: '2026-01-25', end: '2026-10-08', days: 257, eventId: null, title: null },
      { kind: 'down', start: '2025-12-26', end: '2026-01-24', days: 30, eventId: '1', title: 'SD' },
    ]);
  });
  it('a running shutdown is down until today; tentative and future ones are not record', () => {
    expect(runRecord(ev, 'train_2', '2026-10-28')).toEqual([{ kind: 'down', start: '2026-10-18', end: null, days: 11, eventId: '3', title: 'SD' }]);
    expect(runRecord(ev, 'fractionator', '2026-10-28')).toEqual([]);
  });
  it('joins overlapping shutdowns into one down period', () => {
    const r = runRecord([{ id: 'a', title: 'A', unitCodes: ['x'], start: '2026-01-01', end: '2026-01-10' }, { id: 'b', title: 'B', unitCodes: ['x'], start: '2026-01-08', end: '2026-01-12' }], 'x', '2026-01-20');
    expect(r[1]).toMatchObject({ kind: 'down', start: '2026-01-01', end: '2026-01-12', days: 12, title: 'A + B' });
  });
});

describe('sopRefs', () => {
  it('reads the procedure numbers, a short number after a slash is the same series', () => {
    expect(sopRefs('SOP-12-2004/2009')).toEqual(['SOP-12-2004', 'SOP-12-2009']);
    expect(sopRefs('SOP-12-2002 + SOP-12-2003')).toEqual(['SOP-12-2002', 'SOP-12-2003']);
    expect(sopRefs('SOP-12-2005 §3.5')).toEqual(['SOP-12-2005']);
    expect(sopRefs('No SOP received')).toEqual([]);
    expect(sopRefs(null)).toEqual([]);
  });
});
