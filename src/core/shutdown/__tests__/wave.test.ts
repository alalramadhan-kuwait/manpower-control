import { describe, expect, it } from 'vitest';
import { TRAIN1_CUTIN, cutinEstimate, fitWave, pickPair, type WaveReading } from '../wave';

const H = 3_600_000;
const t = (hh: number, mm = 0) => Date.UTC(2026, 9, 28, hh - 3, mm); // Kuwait time, 28 Oct 2026
// Train-1 panel readings: 3:00 PM (owner's message) and 9:51 PM (DCS reactors bed temperature page)
const pm3: WaveReading = { at: t(15), pts: { r105_in: 401, r105_out: 369, r101_in: 360, r102_in: 355, r103_in: 345, r104_in: 336, r104_out: 331 }, beds: {} };
const pm951: WaveReading = { at: t(21, 51), pts: { r105_in: 580.2, r105_out: 522.4, r101_in: 497, r102_in: 488, r103_in: 460, r104_in: 429, r104_out: 403.8 },
  beds: { r105: 398.1, r101: 486, r102: 460, r103: 422, r104: 395 } };

describe('heat wave fit', () => {
  it('fits a delay for each step, about an hour or two', () => {
    const f = fitWave(pm3, pm951)!;
    expect(f.chain).toHaveLength(7);
    expect(f.tau[0]).toBeGreaterThan(1.8); expect(f.tau[0]).toBeLessThan(2.6); // R-105, the big bed
    for (const x of f.tau.slice(3)) { expect(x).toBeGreaterThan(0.8); expect(x).toBeLessThan(2); }
    expect(Math.round(f.inletRate)).toBe(26);
  });
  it('needs two readings an hour apart, with the R-105 inlet', () => {
    expect(pickPair([pm951])).toBeNull();
    expect(pickPair([pm3, { ...pm951, at: pm3.at + 0.5 * H }])).toBeNull();
    expect(fitWave({ ...pm3, pts: { ...pm3.pts, r105_in: undefined } }, pm951)).toBeNull();
  });
});

describe('cut-in estimate', () => {
  it('R-104 outlet reaches 560 early Thursday morning; the beds that trail it later', () => {
    const noBeds = cutinEstimate([pm3, { ...pm951, beds: {} }], TRAIN1_CUTIN)!;
    const r104 = noBeds.reactors.find((r) => r.key === 'r104')!;
    const h = (r104.eta! - pm951.at) / H;
    expect(h).toBeGreaterThan(6); expect(h).toBeLessThan(8.5);
    expect(noBeds.limiting).toBe('r104');
    const beds = cutinEstimate([pm3, pm951], TRAIN1_CUTIN)!;
    expect(beds.reactors.find((r) => r.key === 'r104')!.eta!).toBeGreaterThan(r104.eta!);
    expect(beds.ready).not.toBeNull();
  });
  it('a reactor already at its temperature is done', () => {
    const hot = { ...pm951, beds: { ...pm951.beds, r102: 590 } };
    expect(cutinEstimate([pm3, hot], TRAIN1_CUTIN)!.reactors.find((r) => r.key === 'r102')!.done).toBe(true);
  });
  it('gives the panel values to check 3 h on', () => {
    const e = cutinEstimate([pm3, pm951], TRAIN1_CUTIN)!;
    expect(e.check.at).toBe(pm951.at + 3 * H);
    expect(e.check.expect.r104_in!).toBeGreaterThan(470); expect(e.check.expect.r104_in!).toBeLessThan(530);
  });
});
