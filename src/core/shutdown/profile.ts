// A start-up step's target profile (owner, 28 Oct 2026): the SOP's hour table (feed, AR/DSL flow, each reactor's inlet
// temperature by hour), hour 0 = the step's actual start. The target now and next hour; and, from what the panel reports,
// how far behind (or ahead) the heat-up is and when it will reach the end, re-planned at the SOP's own rate, never faster.
// The targets are the SOP's: nothing here changes them.
const H = 3_600_000;
const r1 = (x: number) => Math.round(x * 10) / 10;

export interface ProfileRow { h: number; sop_h: number; feed: number; ardsl: string; rx: number[]; note: string | null }
/** a panel reading: the inlet temperature (a heat-up), or the black oil feed in KBPD (the cut-in) */
export interface Reading { at: number; temp: number | null; holding: boolean; black?: number | null }
export const RX_NAMES = ['Rx-105', 'Rx-101', 'Rx-102', 'Rx-103', 'Rx-104'];

/** Each reactor's target at a point in the profile (hours from the start), between two rows a straight line. */
export function targetsAt(p: ProfileRow[], x: number): number[] {
  if (!p.length) return [];
  if (x <= p[0].h) return p[0].rx;
  const last = p[p.length - 1]; if (x >= last.h) return last.rx;
  const i = p.findIndex((r) => r.h > x); const a = p[i - 1], b = p[i];
  return a.rx.map((v, k) => Math.round(v + ((b.rx[k] - v) * (x - a.h)) / (b.h - a.h)));
}
/** The row in force at a point (feed, AR/DSL, note): the last row at or before it. */
export const rowAt = (p: ProfileRow[], x: number) => [...p].reverse().find((r) => r.h <= x) ?? p[0];
/** All reactors with the same target in every row (a heat-up): readings re-plan it. */
export const uniform = (p: ProfileRow[]) => p.length > 1 && p.every((r) => r.rx.every((v) => v === r.rx[0])) && p.every((r, i) => i === 0 || r.rx[0] >= p[i - 1].rx[0]);
/** Where in the profile a temperature is (hours from the start), for a uniform rising profile. */
export function hourOf(p: ProfileRow[], t: number): number {
  if (t <= p[0].rx[0]) return p[0].h;
  for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i]; if (t <= b.rx[0]) return b.rx[0] === a.rx[0] ? b.h : a.h + ((t - a.rx[0]) * (b.h - a.h)) / (b.rx[0] - a.rx[0]); }
  return p[p.length - 1].h;
}

export interface ProfileView {
  /** hours since the step started; the profile point now (re-planned when there is a reading) */
  elapsedH: number; atH: number;
  /** the target now and in an hour, each reactor (and its clock time) */
  now: number[]; next: { at: number; rx: number[] };
  /** the row in force now and the next row (feed, AR/DSL, note) */
  row: ProfileRow; nextRow: ProfileRow | null;
  /** from the latest reading: behind (+) / ahead (−) in hours and °F, holding, the re-planned end */
  shiftH: number; behindF: number | null; holding: boolean; reading: Reading | null; endAt: number; planEndAt: number;
  /** the profile point of the latest reading: the hours from it on are re-planned */
  fromH: number;
}

/**
 * The profile at this moment. Without a reading it runs on the clock from the step's start. With one (the latest), a
 * uniform profile is re-planned from that temperature: the rest follows the SOP's hours from there (so its rate, never
 * faster), the shift being how much later than the plan; a reading marked holding keeps the temperature until now.
 */
export function profileView(p: ProfileRow[], start: number, readings: Reading[], now: number): ProfileView {
  const last = p[p.length - 1].h;
  const r = [...readings].sort((a, b) => a.at - b.at).pop() ?? null;
  let shift = 0; let behindF: number | null = null; let fromH = 0;
  if (r && r.black != null && p.some((x) => blackOf(x) > 0)) {
    // the cut-in by its black oil feed: the row where that much black oil goes in is where the step stands then
    const pos = blackHourOf(p, r.black); const at = (r.at - start) / H; fromH = pos; shift = at - pos;
  } else if (r && r.temp != null && uniform(p)) {
    const pos = hourOf(p, r.temp); const at = (r.at - start) / H; fromH = pos;
    behindF = Math.round(targetsAt(p, at)[0] - r.temp);
    shift = (r.holding ? (Math.max(now, r.at) - start) / H : at) - pos;
  }
  const elapsedH = (now - start) / H; const atH = Math.min(last, Math.max(0, elapsedH - shift));
  const nowT = r?.holding && r.temp != null && uniform(p) ? p[0].rx.map(() => Math.round(r.temp!)) : targetsAt(p, atH);
  const nextH = Math.min(last, atH + 1);
  return { elapsedH: r1(elapsedH), atH: r1(atH), now: nowT, next: { at: start + (nextH + shift) * H, rx: targetsAt(p, nextH) }, row: rowAt(p, atH),
    nextRow: p.find((x) => x.h > atH) ?? null, shiftH: shift, behindF, holding: !!r?.holding, reading: r,
    endAt: start + (last + shift) * H, planEndAt: start + last * H, fromH };
}

/** The re-planned clock time of a profile hour (for the table and the graph): from the reading's point on, shifted; the
 *  rows before it fall between the step's start and the reading (they happened in that time, faster or slower). */
export const clockOf = (start: number, v: ProfileView, h: number) =>
  h >= v.fromH ? start + (h + v.shiftH) * H : v.fromH > 0 ? start + (h * (v.fromH + v.shiftH) * H) / v.fromH : start + h * H;

/** The black oil (AR) rate of a row: the first number of its AR/DSL column ("21/04" → 21, "42" → 42). */
export const blackOf = (r: ProfileRow) => { const n = Number.parseFloat(String(r.ardsl).split('/')[0]); return Number.isFinite(n) ? n : 0; };
/** The first profile hour the SOP table reaches a black oil rate (KBPD), or null when it never does. */
export const blackAt = (p: ProfileRow[], kbpd: number) => p.find((r) => blackOf(r) >= kbpd)?.h ?? null;
/** The diesel (DSL) rate of a row: the number after the slash ("21/04" → 4; "42" → 0). */
export const dieselOf = (r: ProfileRow) => { const n = Number.parseFloat(String(r.ardsl).split('/')[1] ?? '0'); return Number.isFinite(n) ? n : 0; };
/** The first row where the feed is all black oil (some AR, no diesel left), or null. */
export const allBlackRow = (p: ProfileRow[]) => p.find((r) => blackOf(r) > 0 && dieselOf(r) === 0) ?? null;

/** The profile hour where this much black oil (KBPD) goes in: between two rows in proportion; past the last, its hour. */
export function blackHourOf(p: ProfileRow[], kbpd: number): number {
  if (kbpd <= blackOf(p[0])) return p[0].h;
  for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i]; const ba = blackOf(a), bb = blackOf(b); if (kbpd <= bb) return bb === ba ? b.h : a.h + ((kbpd - ba) * (b.h - a.h)) / (bb - ba); }
  return p[p.length - 1].h;
}

/** The heat-up plan of every start-up (owner, 29 Oct 2026; rule sd.heatup): each reactor inlet from 350 to 575 °F at its
 *  own rate. R-105 by the heater firing; R-101..R-104 follow the heat wave (Train-1's Oct-26 average rates less a margin,
 *  rounded). The slowest sets the end. Changed on Rules. */
export const HEATUP_PLAN = { r105: 25, r101: 14, r102: 14, r103: 14, r104: 13, from: 350, to: 575 };
export const heatupRates = (p = HEATUP_PLAN) => [p.r105, p.r101, p.r102, p.r103, p.r104];
/** Hours to the end: the slowest reactor. */
export const heatupHours = (p = HEATUP_PLAN) => Math.round(Math.max(...heatupRates(p).map((r) => (p.to - p.from) / r)) * 10) / 10;
/** The plan as profile rows: every hour, each reactor at its rate and held at the target once there; a last row at the
 *  end (all at the target). Feed 20 KBPD diesel as in the SOP. */
export function heatupProfile(p = HEATUP_PLAN): ProfileRow[] {
  const rates = heatupRates(p); const end = heatupHours(p);
  const at = (h: number) => rates.map((r) => Math.round(Math.min(p.to, p.from + r * h)));
  const rows: ProfileRow[] = [];
  for (let h = 0; h < end; h++) rows.push({ h, sop_h: h, feed: 20, ardsl: '0/20', rx: at(h), note: null });
  rows.push({ h: end, sop_h: end, feed: 20, ardsl: '0/20', rx: rates.map(() => p.to), note: 'heat-up end' });
  return rows;
}
export const heatupRef = (p = HEATUP_PLAN) => `Heat-up plan · R-105 ${p.r105} (heater) · R-101 ${p.r101} · R-102 ${p.r102} · R-103 ${p.r103} · R-104 ${p.r104} °F/h`;
/** The black oil cut-in of SOP MAB-OPR-SOP-12-1051 (hours 9–27), as on Train-1's start-up. */
export const CUTIN_SOP: ProfileRow[] = [
  [0, 9, 20, '0/20', [575, 575, 575, 575, 575], null], [1, 10, 23, '3/20', [600, 600, 600, 600, 600], 'Note 1'], [2, 11, 25, '6/19', [610, 610, 610, 610, 610], null],
  [3, 12, 25, '9/16', [620, 620, 620, 620, 620], 'Note 2'], [4, 13, 25, '11/14', [630, 630, 630, 630, 630], null], [5, 14, 25, '13/12', [640, 642, 645, 647, 649], '50/50'],
  [6, 15, 25, '15/10', [640, 642, 645, 647, 649], 'Note 3'], [7, 16, 25, '18/07', [640, 644, 647, 649, 652], null], [8, 17, 25, '21/04', [640, 646, 649, 650, 654], null],
  [9, 18, 25, '24/01', [640, 653, 657, 659, 663], null], [10, 19, 25, '25/0', [645, 658, 660, 667, 672], null], [11, 20, 28, '28/0', [646, 659, 661, 668, 675], null],
  [12, 21, 31, '31/0', [647, 660, 666, 675, 680], null], [13, 22, 34, '34/0', [649, 663, 669, 678, 690], null], [14, 23, 37, '37/0', [650, 666, 672, 681, 693], null],
  [15, 24, 40, '40/0', [650, 669, 675, 684, 696], null], [16, 25, 42, '42/0', [653, 672, 678, 687, 699], null], [17, 26, 42, '42', [656, 675, 681, 690, 702], null],
  [18, 27, 42, '42', [659, 678, 684, 693, 705], null],
].map(([h, sop_h, feed, ardsl, rx, note]) => ({ h, sop_h, feed, ardsl, rx, note }) as ProfileRow);
