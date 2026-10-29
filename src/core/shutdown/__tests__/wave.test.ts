import { describe, expect, it } from 'vitest';
import { TRAIN1_CUTIN, cutinEstimate, fitModel, fitWave, pickPair, type WaveReading } from '../wave';

const H = 3_600_000;
const t = (d: number, hh: number, mm = 0) => Date.UTC(2026, 9, d, hh - 3, mm); // Kuwait time
// Train-1 panel temperatures: 3:00 PM (owner's message), 9:51 PM and 5:37 AM (DCS reactors bed temperature page)
const pm3: WaveReading = { at: t(28, 15), pts: { r105_in: 401, r105_out: 369, r101_in: 360, r102_in: 355, r103_in: 345, r104_in: 336, r104_out: 331 }, beds: {} };
const pm951: WaveReading = { at: t(28, 21, 51), pts: { r105_in: 580.2, r105_out: 522.4, r101_in: 497, r102_in: 488, r103_in: 460, r104_in: 429, r104_out: 403.8 }, beds: {} };
const am537: WaveReading = { at: t(29, 5, 37), pts: { r105_in: 620, r105_out: 611.1, r101_in: 576, r102_in: 577, r103_in: 574, r104_in: 561, r104_out: 551.5 },
  beds: { r105: 627.6, r101: 577, r102: 580, r103: 574, r104: 560 } };
const of = (e: NonNullable<ReturnType<typeof cutinEstimate>>, k: string) => e.reactors.find((r) => r.key === k)!;

describe('heat wave fit', () => {
  it('fits a delay for each step, about an hour or two', () => {
    const f = fitWave(pm3, pm951)!;
    expect(f.chain).toHaveLength(7);
    expect(f.tau[0]).toBeGreaterThan(1.8); expect(f.tau[0]).toBeLessThan(2.6); // R-105, the big bed
    expect(Math.round(f.inletRate)).toBe(26);
  });
  it('needs two readings an hour apart, with the R-105 inlet', () => {
    expect(pickPair([pm951])).toBeNull();
    expect(pickPair([pm3, { ...pm951, at: pm3.at + 0.5 * H }])).toBeNull();
    expect(fitWave({ ...pm3, pts: { ...pm3.pts, r105_in: undefined } }, pm951)).toBeNull();
  });
});

describe('wave model fitted to the readings', () => {
  it('fits a delay for each step and E-129 as a drop growing with the R-105 outlet', () => {
    const m = fitModel([pm3, pm951, am537])!;
    expect(m.readings).toBe(3); expect(m.r105.tau).toBeGreaterThan(1.5); expect(m.r105.tau).toBeLessThan(3);
    expect(m.e129.b).toBeGreaterThan(0.09); expect(m.e129.b).toBeLessThan(0.13);
    for (const k of ['r102', 'r103', 'r104'] as const) { expect(m.steps[k].tau).toBeGreaterThan(0.2); expect(m.steps[k].tau).toBeLessThan(2.5); }
  });
  it('from 3:00 PM and 9:51 PM alone it foresaw 5:37 AM: R-101 short of 600, R-103 and R-104 there by then', () => {
    const e = cutinEstimate([pm3, pm951], TRAIN1_CUTIN)!;
    expect(of(e, 'r101').wont).toBe(true); expect(of(e, 'r101').max!).toBeLessThan(590);
    for (const k of ['r103', 'r104']) expect(of(e, k).eta!).toBeLessThanOrEqual(am537.at);
  });
});

describe('cut-in estimate on the reactor inlets', () => {
  const e = cutinEstimate([pm3, pm951, am537], TRAIN1_CUTIN)!;
  it('uses the latest two readings for the rates', () => { expect(e.from).toBe(pm951.at); expect(e.to).toBe(am537.at); });
  it('R-105, R-103 and R-104 inlets are there', () => {
    for (const k of ['r105', 'r103', 'r104']) expect(of(e, k).done).toBe(true);
  });
  it('R-101 cannot reach 600: E-129 takes ~36 °F at the R-105 inlet limit', () => {
    const r = of(e, 'r101');
    expect(r.max!).toBeGreaterThan(575); expect(r.max!).toBeLessThan(590);
    expect(r.wont).toBe(true); expect(e.blocked).toBe(true); expect(e.ready).toBeNull(); expect(e.limiting).toBe('r101');
  });
  it('marks the reaction where a bed is hotter than its inlet', () => {
    expect(of(e, 'r105').exo).toBe(true); expect(of(e, 'r102').exo).toBe(false);
  });
});
