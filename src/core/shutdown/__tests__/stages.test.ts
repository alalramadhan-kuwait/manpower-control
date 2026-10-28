import { describe, expect, it } from 'vitest';
import { delayPeriod, runRecord, sopRefs, stageSummary, startupVsPlan, stdTimeline, swapTimes, type StdStep } from '../stages';

const T0 = Date.parse('2026-11-12T03:00:00Z');
const H = 3_600_000;
const step = (id: string, stdHours: number | null, status: StdStep['status'] = 'not_started', startedAt: string | null = null, doneAt: string | null = null): StdStep => ({ id, stdHours, status, startedAt, doneAt });

describe('stdTimeline', () => {
  it('plans the steps one after another by their standard hours, skipping a step not required', () => {
    const v = stdTimeline([step('a', 4), step('b', 6, 'not_required'), step('c', 2)], T0, T0);
    expect(v.map((x) => [(x.planStart! - T0) / H, (x.planEnd! - T0) / H])).toEqual([[0, 4], [4, 4], [4, 6]]);
  });
  it('measures actual against standard and flags a running step past its plan', () => {
    const now = T0 + 8 * H;
    const v = stdTimeline([step('a', 4, 'done', new Date(T0).toISOString(), new Date(T0 + 5 * H).toISOString()), step('b', 1, 'running', new Date(T0 + 5 * H).toISOString())], T0, now);
    expect(v[0]).toMatchObject({ actualH: 5, overH: 1, late: false });
    expect(v[1]).toMatchObject({ actualH: 3, overH: 2, late: true });
    // half an hour past the plan is not late (1 h is)
    expect(stdTimeline([step('c', 1, 'running', new Date(T0).toISOString())], T0, T0 + 1.5 * H)[0].late).toBe(false);
  });
  it('a step not started after its planned start is late; no stage start, no plan', () => {
    expect(stdTimeline([step('a', 4)], T0, T0 + 2 * H)[0].late).toBe(true);
    expect(stdTimeline([step('a', 4)], T0, T0 + 0.5 * H)[0].late).toBe(false);
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

describe('startupVsPlan', () => {
  // the Train-1 start-up as recorded on 28 Oct 2026 (UTC times)
  const z = (x: string) => `2026-10-${x}:00Z`;
  const steps: StdStep[] = [
    step('s1', 7, 'done', z('25T04:30'), z('25T12:00')), step('s2', 3, 'done', z('26T08:00'), z('27T10:00')),
    step('s3', 8, 'done', z('27T10:00'), z('27T18:00')), step('s4', 5, 'done', z('27T18:00'), z('27T23:00')),
    step('s5', 4, 'done', z('27T23:00'), z('28T03:00')), step('s6', 6, 'running', z('28T06:00')), step('s7', 9), step('s8', 18)];
  const now = Date.parse(z('28T09:00'));
  it('plans from the first start + all standard hours and expects the end from the actual times', () => {
    const v = startupVsPlan(steps, now);
    expect(new Date(v.planEnd!).toISOString()).toBe('2026-10-27T16:30:00.000Z');
    expect(new Date(v.expectedEnd!).toISOString()).toBe('2026-10-29T15:00:00.000Z');
    expect(v.behindH).toBe(46.5);
  });
  it('splits the delay into steps over standard and waiting between steps', () => {
    const v = startupVsPlan(steps, now);
    expect(v.overH).toBe(23); expect(v.waitH).toBe(23);
    expect(v.over.has('s1')).toBe(false);
    expect(v.over.get('s2')).toBe(23); expect(v.wait.get('s2')).toBe(20); expect(v.wait.get('s6')).toBe(3);
  });
  it('progress by standard hours: done steps and the running one up to its standard', () => {
    const v = startupVsPlan(steps, now);
    expect(v.actualPct).toBe(50); expect(v.planPct).toBe(100);
  });
  it('a step not started after the one before it was done is waiting until now', () => {
    const v = startupVsPlan([step('a', 2, 'done', z('28T00:00'), z('28T02:00')), step('b', 3)], now);
    expect(v.wait.get('b')).toBe(7);
  });
  it('no step started: no plan yet', () => {
    expect(startupVsPlan([step('a', 2)], now)).toMatchObject({ start: null, planEnd: null, behindH: null, actualPct: 0 });
  });
});

describe('holds', () => {
  const z = (x: string) => `2026-10-${x}:00Z`;
  const hold = (id: string, a: string, d: string | null): StdStep => ({ id, stdHours: null, status: d ? 'done' : 'running', startedAt: a, doneAt: d, kind: 'hold' });
  const steps: StdStep[] = [step('s1', 7, 'done', z('25T04:30'), z('25T12:00')), hold('h', z('25T12:00'), z('27T07:00')), step('s2', 3, 'done', z('27T07:00'), z('27T10:00')), step('s3', 8)];
  const now = Date.parse(z('27T10:00'));
  it('a hold is not a delay: the step after it is on time, its length is the hold', () => {
    const v = startupVsPlan(steps, now);
    expect(v.over.size).toBe(0); expect(v.wait.size).toBe(0);
    expect(v.hold.get('h')).toBe(43); expect(v.holdH).toBe(43);
    expect(v.behindH).toBe(43.5); expect(v.lateH).toBe(0.5);
  });
  it('the steps after a hold are planned from its end; it has no plan and is never late', () => {
    const t = stdTimeline(steps, Date.parse(z('25T04:30')), now);
    expect(t[1]).toMatchObject({ late: false, overH: null });
    expect(new Date(t[3].planStart!).toISOString()).toBe('2026-10-27T10:00:00.000Z');
  });
  it('a hold still running moves the end with now; counts no step', () => {
    const v = startupVsPlan([step('s1', 2, 'done', z('27T00:00'), z('27T02:00')), hold('h', z('27T02:00'), null), step('s2', 3)], now);
    expect(v.hold.get('h')).toBe(8);
    expect(new Date(v.expectedEnd!).toISOString()).toBe('2026-10-27T13:00:00.000Z');
    expect(stageSummary([step('s1', 2, 'done', z('27T00:00'), z('27T02:00')), hold('h', z('27T02:00'), null)])).toMatchObject({ total: 1, done: 1 });
  });
});

describe('moving rows', () => {
  const z = (x: string) => `2026-10-${x}:00Z`;
  it('two finished rows trade places, each keeps its length and the gap between them', () => {
    const r = swapTimes({ startedAt: z('25T12:00'), doneAt: z('26T08:00'), status: 'done' }, { startedAt: z('26T09:00'), doneAt: z('26T12:00'), status: 'done' });
    expect(r).toEqual({ b: { startedAt: '2026-10-25T12:00:00.000Z', doneAt: '2026-10-25T15:00:00.000Z' }, a: { startedAt: '2026-10-25T16:00:00.000Z', doneAt: '2026-10-26T12:00:00.000Z' } });
  });
  it('rows without times only change order; a running row does not move past a finished one', () => {
    expect(swapTimes({ startedAt: null, doneAt: null, status: 'not_started' }, { startedAt: null, doneAt: null, status: 'not_started' })).toBe('order');
    expect(swapTimes({ startedAt: z('25T12:00'), doneAt: z('26T08:00'), status: 'done' }, { startedAt: z('26T09:00'), doneAt: null, status: 'running' })).toBeNull();
  });
  it('a delay as a period: the wait before a step, or its time over plan', () => {
    const s = step('s', 3, 'done', z('26T08:00'), z('27T10:00'));
    expect(delayPeriod(s, Date.parse(z('25T12:00')), 'wait', 0)).toEqual({ from: Date.parse(z('25T12:00')), to: Date.parse(z('26T08:00')), h: 20 });
    expect(delayPeriod(s, null, 'over', 0)).toEqual({ from: Date.parse(z('26T08:00')), to: Date.parse(z('27T07:00')), h: 23 });
    expect(delayPeriod(step('t', 3, 'done', z('26T08:00'), z('26T11:30')), null, 'over', 0)).toBeNull();
  });
});

describe('added steps', () => {
  const z = (x: string) => `2026-10-${x}:00Z`;
  it('a step with no plan is added time, never over plan', () => {
    const v = startupVsPlan([step('a', 4, 'done', z('28T00:00'), z('28T04:00')), step('x', null, 'done', z('28T04:00'), z('28T07:00')), step('b', 6)], Date.parse(z('28T07:00')));
    expect(v.over.size).toBe(0); expect(v.added.get('x')).toBe(3); expect(v.addedH).toBe(3);
  });
});
