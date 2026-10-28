// The heat wave through the reactors (owner, 28 Oct 2026). Only R-105 is heated; the heat travels R-105 → R-101 →
// R-102 → R-103 → R-104, each one following the one before it. The relationship, fitted to the panel's readings:
//   rate of rise (°F/h) = (temperature before it − its own temperature) ÷ τ
// τ (hours) is the delay of each step in the wave. From two readings τ is fitted step by step; then, with the R-105
// inlet going on at its rate up to its limit (620 °F), the app works out when each reactor reaches its cut-in
// temperature. The black oil cut-in can start when the last one does. An estimate only: it never changes a step.
const H = 3_600_000;
const DT = 0.01; // hours per simulation step

export type PointKey = 'r105_in' | 'r105_out' | 'r101_in' | 'r102_in' | 'r103_in' | 'r104_in' | 'r104_out';
export type ReactorKey = 'r105' | 'r101' | 'r102' | 'r103' | 'r104';
/** the panel points in the order the heat reaches them */
export const WAVE_POINTS: { key: PointKey; label: string }[] = [
  { key: 'r105_in', label: 'R-105 inlet' }, { key: 'r105_out', label: 'R-105 outlet' }, { key: 'r101_in', label: 'R-101 inlet' },
  { key: 'r102_in', label: 'R-102 inlet' }, { key: 'r103_in', label: 'R-103 inlet' }, { key: 'r104_in', label: 'R-104 inlet' }, { key: 'r104_out', label: 'R-104 outlet' }];
/** each reactor and the point that stands for its beds: its outlet (the next reactor's inlet) */
export const WAVE_REACTORS: { key: ReactorKey; name: string; proxy: PointKey }[] = [
  { key: 'r105', name: 'R-105', proxy: 'r105_out' }, { key: 'r101', name: 'R-101', proxy: 'r102_in' }, { key: 'r102', name: 'R-102', proxy: 'r103_in' },
  { key: 'r103', name: 'R-103', proxy: 'r104_in' }, { key: 'r104', name: 'R-104', proxy: 'r104_out' }];

export interface WaveReading { at: number; pts: Partial<Record<PointKey, number>>; beds: Partial<Record<ReactorKey, number>> }
/** the cut-in conditions: each reactor's bed temperature, and the most the R-105 inlet may be raised to */
export interface CutinSpec { targets: Record<ReactorKey, number>; inletMax: number; ref: string | null }

export interface WaveFit { chain: PointKey[]; tau: number[]; from: number; to: number; inletRate: number }
export interface ReactorEta { key: ReactorKey; name: string; target: number; now: number | null; bed: boolean; done: boolean; eta: number | null }
export interface CutinEstimate {
  fit: WaveFit; reactors: ReactorEta[];
  /** when every reactor is at its temperature (null: not within two days at this rate, or a reactor not read) */
  ready: number | null; limiting: ReactorKey | null;
  /** what the panel should read 3 h after the latest reading, to check the estimate */
  check: { at: number; expect: Partial<Record<PointKey, number>> };
}

function simulate(upstream: (t: number) => number, x0: number, tau: number, hours: number) {
  const out: number[] = []; let x = x0;
  for (let k = 0; k * DT < hours; k++) { x += (DT * (upstream(k * DT) - x)) / tau; out.push(x); }
  return out;
}
const at = (s: number[], t: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(t / DT) - 1))];

/** The two readings the fit uses: the latest and the latest one at least an hour before it. */
export function pickPair(readings: WaveReading[]): [WaveReading, WaveReading] | null {
  const r = [...readings].sort((a, b) => a.at - b.at); const b = r[r.length - 1];
  const a = [...r].reverse().find((x) => b && b.at - x.at >= H);
  return a && b ? [a, b] : null;
}

/** τ of each step in the wave, from two readings (points read in both, R-105 inlet first). */
export function fitWave(a: WaveReading, b: WaveReading): WaveFit | null {
  const chain = WAVE_POINTS.map((p) => p.key).filter((k) => a.pts[k] != null && b.pts[k] != null);
  if (chain[0] !== 'r105_in' || chain.length < 2) return null;
  const span = (b.at - a.at) / H; const i0 = a.pts.r105_in!, i1 = b.pts.r105_in!;
  let up: (t: number) => number = (t) => i0 + ((i1 - i0) * t) / span;
  const tau: number[] = [];
  for (const k of chain.slice(1)) {
    const x0 = a.pts[k]!, x1 = b.pts[k]!; const u = up;
    const end = (t: number) => simulate(u, x0, t, span).pop()! - x1;
    // a longer delay rises less: find τ where the simulated end meets the reading (clamped to 0.05–30 h)
    let lo = 0.05, hi = 30;
    if (end(lo) < 0) hi = lo; else if (end(hi) > 0) lo = hi;
    for (let n = 0; n < 50 && hi - lo > 1e-4; n++) { const m = (lo + hi) / 2; if (end(m) > 0) lo = m; else hi = m; }
    const t = (lo + hi) / 2; tau.push(t);
    const s = simulate(u, x0, t, span); up = (tt) => at(s, tt);
  }
  return { chain, tau, from: a.at, to: b.at, inletRate: (i1 - i0) / span };
}

/** From the latest reading on: each reactor's time to its cut-in temperature, and when the last one gets there. */
export function cutinEstimate(readings: WaveReading[], spec: CutinSpec, horizonH = 48): CutinEstimate | null {
  const pair = pickPair(readings); if (!pair) return null;
  const fit = fitWave(...pair); if (!fit) return null;
  const last = pair[1]; const inlet0 = last.pts.r105_in!;
  const cap = Math.max(spec.inletMax, inlet0); const rate = Math.max(0, fit.inletRate);
  // the wave from now on: the inlet goes on at its rate up to its limit, each point follows the one before it
  const series = new Map<PointKey, number[]>();
  let up: (t: number) => number = (t) => Math.min(cap, inlet0 + rate * t);
  series.set('r105_in', Array.from({ length: Math.ceil(horizonH / DT) }, (_, k) => up((k + 1) * DT)));
  fit.chain.slice(1).forEach((k, i) => { const s = simulate(up, last.pts[k]!, fit.tau[i], horizonH); series.set(k, s); up = (t) => at(s, t); });
  const reactors: ReactorEta[] = WAVE_REACTORS.map((r) => {
    const target = spec.targets[r.key]; const s = series.get(r.proxy); const p = last.pts[r.proxy];
    const bed = last.beds[r.key]; const now = bed ?? p ?? null;
    if (now !== null && now >= target) return { key: r.key, name: r.name, target, now, bed: bed != null, done: true, eta: last.at };
    if (!s || p == null) return { key: r.key, name: r.name, target, now, bed: bed != null, done: false, eta: null };
    // a bed colder than its outlet trails it, as the wave does: by the gap at the outlet's present rate
    const k = s.findIndex((v) => v >= target); const pr = (p - (pair[0].pts[r.proxy] ?? p)) / ((last.at - pair[0].at) / H);
    const lag = bed != null && bed < p ? (pr > 0 ? (p - bed) / pr : null) : 0;
    return { key: r.key, name: r.name, target, now, bed: bed != null, done: false, eta: k < 0 || lag === null ? null : last.at + ((k + 1) * DT + lag) * H };
  });
  const open = reactors.filter((r) => !r.done);
  const ready = open.length === 0 ? last.at : open.some((r) => r.eta === null) ? null : Math.max(...open.map((r) => r.eta!));
  const limiting = open.length === 0 ? null : (open.find((r) => r.eta === null) ?? open.reduce((m, r) => (r.eta! > m.eta! ? r : m))).key;
  const expect: Partial<Record<PointKey, number>> = {};
  for (const [k, s] of series) expect[k] = Math.round(at(s, 3));
  return { fit, reactors, ready, limiting, check: { at: last.at + 3 * H, expect } };
}

/** Train-1's cut-in conditions (process instruction, 28 Oct 2026): the bed temperatures, R-105 inlet up to 620 °F. */
export const TRAIN1_CUTIN: CutinSpec = { targets: { r105: 610, r101: 600, r102: 580, r103: 570, r104: 560 }, inletMax: 620, ref: 'Process instruction 28 Oct 2026' };
