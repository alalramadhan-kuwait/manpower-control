// Phase 1 of the progress engine: the quantity rules (drums), against the plan's test scenarios.
import { describe, expect, it } from 'vitest';
import { plannedPct, qtyForecast, qtyProgress, qtyTotals, kwShift, shiftRecords, variancePts, type QtyEntry } from '../qty';

const kw = (s: string) => Date.parse(`${s.replace(' ', 'T')}:00+03:00`);
let n = 0;
const e = (shiftDate: string, shift: 'D' | 'N', qty: number, o: Partial<QtyEntry> = {}): QtyEntry =>
  ({ id: `e${++n}`, shiftDate, shift, kind: 'removal', method: 'vacuum', qty, verify: 'verified', ...o });

describe('drum progress', () => {
  it('advances over several shifts against the working estimate', () => {
    const es = [e('2026-10-23', 'D', 150), e('2026-10-23', 'N', 170), e('2026-10-24', 'D', 160)];
    expect(qtyProgress({ working: 2600, initial: 2600 }, es)).toEqual({ verified: 480, pending: 0, remaining: 2120, actualPct: 18.5, awaitingEmpty: false });
  });
  it('a revised estimate changes % and remaining, never the recorded drums', () => {
    const es = [e('2026-10-23', 'D', 150), e('2026-10-23', 'N', 170), e('2026-10-24', 'D', 160)];
    expect(qtyProgress({ working: 2400, initial: 2600 }, es)).toMatchObject({ verified: 480, remaining: 1920, actualPct: 20 });
  });
  it('only verified entries count, transfers never add, corrections are signed', () => {
    const es = [e('2026-10-23', 'D', 150), e('2026-10-23', 'N', 170, { verify: 'pending' }), e('2026-10-23', 'D', -10, { kind: 'correction', corrects: 'e1' }),
      e('2026-10-24', 'D', 40, { kind: 'transfer' }), e('2026-10-24', 'N', 99, { verify: 'rejected' })];
    expect(qtyTotals(es)).toEqual({ verified: 140, pending: 170 });
  });
  it('quantity reaching the estimate holds at 99% until the vessel is confirmed empty', () => {
    const es = [e('2026-10-23', 'D', 600)];
    expect(qtyProgress({ working: 600, initial: 600 }, es)).toMatchObject({ actualPct: 99, remaining: 0, awaitingEmpty: true });
    expect(qtyProgress({ working: 600, initial: 600, completeAt: '2026-10-24T05:00:00+03:00' }, es)).toMatchObject({ actualPct: 100, awaitingEmpty: false });
  });
  it('no estimate: no % (never assumed)', () => {
    expect(qtyProgress({ working: null, initial: null }, [e('2026-10-23', 'D', 10)]).actualPct).toBeNull();
  });
});

describe('planned curve (provisional) and variance', () => {
  const a5410 = { start: '2026-10-23T03:00:00+03:00', finish: '2026-10-28T03:00:00+03:00' };
  it('elapsed share of the baseline line, in percentage points of variance', () => {
    expect(plannedPct([a5410], kw('2026-10-24 03:00'))).toBe(20);
    expect(plannedPct([a5410], kw('2026-10-22 03:00'))).toBe(0);
    expect(plannedPct([a5410], kw('2026-11-01 03:00'))).toBe(100);
    expect(variancePts(18.5, 20)).toBe(-1.5);
    expect(variancePts(null, 20)).toBeNull();
  });
  it('two lines (vacuum then cone) weigh by their durations', () => {
    const cone = { start: '2026-10-28T15:00:00+03:00', finish: '2026-10-29T03:00:00+03:00' };
    expect(plannedPct([a5410, cone], kw('2026-10-28 03:00'))).toBe(90.9);
  });
});

describe('shifts', () => {
  it('day 07–19, night 19–07 dated by its start', () => {
    expect(kwShift(kw('2026-10-23 08:00'))).toEqual({ date: '2026-10-23', shift: 'D' });
    expect(kwShift(kw('2026-10-23 20:00'))).toEqual({ date: '2026-10-23', shift: 'N' });
    expect(kwShift(kw('2026-10-24 03:00'))).toEqual({ date: '2026-10-23', shift: 'N' });
  });
  it('one record per shift, net of corrections, stopped shifts marked', () => {
    const rs = shiftRecords([e('2026-10-23', 'D', 150), e('2026-10-23', 'D', 20, { method: 'cone' }), e('2026-10-23', 'D', -10, { kind: 'correction' }),
      e('2026-10-23', 'N', 0, { stoppage: 'vacuum truck down' })]);
    expect(rs).toEqual([{ date: '2026-10-23', shift: 'D', qty: 160, method: 'vacuum', stopped: false }, { date: '2026-10-23', shift: 'N', qty: 0, method: 'vacuum', stopped: true }]);
  });
});

describe('forecast (provisional)', () => {
  const run = [e('2026-10-23', 'D', 150), e('2026-10-23', 'N', 170), e('2026-10-24', 'D', 160), e('2026-10-24', 'N', 160)];
  it('rate of the last productive shifts, finish from the remaining drums', () => {
    const f = qtyForecast(run, 1960, kw('2026-10-25 08:00'));
    expect(f).toMatchObject({ status: 'ok', provisional: true, method: 'vacuum', shifts: 4, ratePerShift: 160, availability: 1 });
    if (f.status === 'ok') expect((f.finish - kw('2026-10-25 08:00')) / 36e5).toBeCloseTo(1960 / 160 * 12, 5);
  });
  it('a stopped shift is not a rate of zero: it lowers availability', () => {
    const es = [...run.slice(0, 2), e('2026-10-24', 'D', 0, { stoppage: 'vacuum truck down' }), e('2026-10-24', 'N', 160), e('2026-10-25', 'D', 160)];
    const f = qtyForecast(es, 1000, kw('2026-10-25 20:00'));
    expect(f).toMatchObject({ status: 'ok', shifts: 4, ratePerShift: 160, availability: 0.8 });
  });
  it('a change of method starts a new phase: no forecast until 3 productive shifts with it', () => {
    const es = [...run, e('2026-10-25', 'D', 60, { method: 'cone' }), e('2026-10-25', 'N', 55, { method: 'cone' })];
    expect(qtyForecast(es, 300, kw('2026-10-26 08:00'))).toEqual({ status: 'unavailable', provisional: true, reason: 'fewer than 3 productive shifts with the current method (cone)' });
    const more = [...es, e('2026-10-26', 'D', 65, { method: 'cone' })];
    expect(qtyForecast(more, 300, kw('2026-10-26 20:00'))).toMatchObject({ status: 'ok', method: 'cone', shifts: 3, ratePerShift: 60 });
  });
  it('the last shift without an entry: unavailable (not zero progress)', () => {
    expect(qtyForecast(run, 1960, kw('2026-10-26 08:00'))).toEqual({ status: 'unavailable', provisional: true, reason: 'no entry for the last shift' });
  });
  it('too little evidence, no estimate, pending entries only', () => {
    expect(qtyForecast(run.slice(0, 2), 2000, kw('2026-10-24 08:00'))).toMatchObject({ status: 'unavailable', reason: 'fewer than 3 productive shifts with the current method (vacuum)' });
    expect(qtyForecast(run, null, kw('2026-10-25 08:00'))).toMatchObject({ status: 'unavailable', reason: 'no working estimate' });
    expect(qtyForecast(run.map((x) => ({ ...x, verify: 'pending' as const })), 1000, kw('2026-10-25 08:00'))).toMatchObject({ status: 'unavailable', reason: 'no verified shift yet' });
  });
  it('uses at most the window of productive shifts', () => {
    const es = [e('2026-10-22', 'D', 50), e('2026-10-22', 'N', 50), ...run];
    expect(qtyForecast(es, 1000, kw('2026-10-25 08:00'), { window: 4 })).toMatchObject({ shifts: 4, ratePerShift: 160 });
    expect(qtyForecast(es, 1000, kw('2026-10-25 08:00'), { window: 6 })).toMatchObject({ shifts: 6, ratePerShift: 123.3 });
  });
});

describe('shift choice for an entry', () => {
  it('the current shift and the two before it', async () => {
    const { recentShifts } = await import('../qty');
    expect(recentShifts(kw('2026-10-21 12:30'))).toEqual([{ date: '2026-10-21', shift: 'D' }, { date: '2026-10-20', shift: 'N' }, { date: '2026-10-20', shift: 'D' }]);
    expect(recentShifts(kw('2026-10-22 02:00'))).toEqual([{ date: '2026-10-21', shift: 'N' }, { date: '2026-10-21', shift: 'D' }, { date: '2026-10-20', shift: 'N' }]);
  });
});
