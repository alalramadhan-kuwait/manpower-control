import { describe, expect, it } from 'vitest';
import { allBlackRow, blackAt, blackHourOf, blackOf, dieselOf, clockOf, hourOf, profileView, targetsAt, uniform, type ProfileRow } from '../profile';

const H = 3_600_000;
const heat: ProfileRow[] = Array.from({ length: 10 }, (_, h) => ({ h, sop_h: h, feed: 20, ardsl: '0/20', rx: Array(5).fill(350 + 25 * h), note: null }));
const T0 = Date.parse('2026-10-28T11:32:00Z');

describe('profile targets', () => {
  it('reads the target between two hours on a straight line, and where a temperature sits', () => {
    expect(targetsAt(heat, 1.5)[0]).toBe(388);
    expect(hourOf(heat, 365)).toBeCloseTo(0.6, 5);
    expect(uniform(heat)).toBe(true);
    expect(uniform([{ h: 0, sop_h: 14, feed: 25, ardsl: '13/12', rx: [640, 642, 645, 647, 649], note: null }, { h: 1, sop_h: 15, feed: 25, ardsl: '15/10', rx: [640, 642, 645, 647, 649], note: null }])).toBe(false);
  });
  it('without a reading: on the clock from the start, now and next hour', () => {
    const v = profileView(heat, T0, [], T0 + 1.55 * H);
    expect(v.now[0]).toBe(389); expect(v.next.rx[0]).toBe(414); expect(v.shiftH).toBe(0);
    expect(new Date(v.endAt).toISOString()).toBe('2026-10-28T20:32:00.000Z');
  });
  it('a reading behind the profile re-plans the rest at the SOP rate: later end, never faster', () => {
    // 16:30 local (13:30Z) the panel says 365 °F; the plan was 399 °F
    const at = Date.parse('2026-10-28T13:30:00Z');
    const v = profileView(heat, T0, [{ at, temp: 365, holding: false }], at);
    expect(v.behindF).toBe(34); expect(v.shiftH).toBeCloseTo(1.37, 2);
    expect(new Date(v.endAt).toISOString()).toBe('2026-10-28T21:54:00.000Z');
    expect(v.next.rx[0]).toBe(390);
    expect(new Date(clockOf(T0, v, 9)).toISOString()).toBe('2026-10-28T21:54:00.000Z');
    expect(new Date(clockOf(T0, v, 0)).toISOString()).toBe('2026-10-28T11:32:00.000Z');
  });
  it('holding: the temperature stays until now and the end moves with the clock', () => {
    const at = Date.parse('2026-10-28T13:30:00Z');
    const v = profileView(heat, T0, [{ at, temp: 400, holding: true }], at + 2 * H);
    expect(v.holding).toBe(true); expect(v.now[0]).toBe(400);
    expect(new Date(v.endAt).toISOString()).toBe('2026-10-28T22:30:00.000Z');
  });
});

describe('black oil rate milestones', () => {
  const oil: ProfileRow[] = [['0/20', 0], ['3/20', 1], ['18/07', 7], ['21/04', 8], ['40/0', 15], ['42/0', 16], ['42', 17]].map(([a, h]) => ({ h: h as number, sop_h: (h as number) + 9, feed: 25, ardsl: a as string, rx: [600], note: null }));
  it('reads the AR side of AR/DSL', () => { expect(blackOf(oil[3])).toBe(21); expect(blackOf(oil[6])).toBe(42); });
  it('finds the first hour at or over a rate', () => { expect(blackAt(oil, 20)).toBe(8); expect(blackAt(oil, 42)).toBe(16); expect(blackAt(oil, 50)).toBeNull(); });
});

describe('all black oil', () => {
  const oil: ProfileRow[] = [['0/20', 0], ['21/04', 8], ['24/01', 9], ['25/0', 10], ['42/0', 16], ['42', 17]].map(([a, h]) => ({ h: h as number, sop_h: (h as number) + 9, feed: 25, ardsl: a as string, rx: [600], note: null }));
  it('reads the diesel side', () => { expect(dieselOf(oil[1])).toBe(4); expect(dieselOf(oil[5])).toBe(0); });
  it('finds the first hour with no diesel left', () => { expect(allBlackRow(oil)?.h).toBe(10); expect(blackOf(allBlackRow(oil)!)).toBe(25); });
});

describe('the cut-in by its black oil feed (owner, 29 Oct 2026)', () => {
  // Train-1 cut-in from 29 Oct 8:35 AM: SOP hour 19 (25/0, all black) is step hour 10
  const P = [{ h: 0, sop_h: 9, feed: 20, ardsl: '0/20', rx: [575, 575, 575, 575, 575], note: null }, { h: 1, sop_h: 10, feed: 23, ardsl: '3/20', rx: [600, 600, 600, 600, 600], note: null },
    { h: 9, sop_h: 18, feed: 25, ardsl: '24/01', rx: [640, 653, 657, 659, 663], note: null }, { h: 10, sop_h: 19, feed: 25, ardsl: '25/0', rx: [645, 658, 660, 667, 672], note: null },
    { h: 18, sop_h: 27, feed: 42, ardsl: '42', rx: [659, 678, 684, 693, 705], note: null }];
  const start = Date.UTC(2026, 9, 29, 5, 35);
  it('25 KBPD all black at 12:30 PM puts SOP hour 19 at 12:30 PM: about 6 h ahead of the table', () => {
    expect(blackHourOf(P, 25)).toBe(10);
    const v = profileView(P, start, [{ at: Date.UTC(2026, 9, 29, 9, 30), temp: null, black: 25, holding: false }], Date.UTC(2026, 9, 29, 12, 0));
    expect(v.fromH).toBe(10); expect(v.shiftH).toBeCloseTo(-6.08, 1);
    expect(clockOf(start, v, 10)).toBe(Date.UTC(2026, 9, 29, 9, 30));
    expect(clockOf(start, v, 18)).toBe(Date.UTC(2026, 9, 29, 17, 30)); // 42 KBPD ~8:30 PM
  });
});
