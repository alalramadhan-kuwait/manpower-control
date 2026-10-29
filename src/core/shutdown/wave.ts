// The heat wave through the reactors (owner, 28-29 Oct 2026). Only R-105 is heated; the heat travels R-105 → E-129 →
// R-101 → R-102 → R-103 → R-104. The black oil cut-in can start when every reactor inlet is at its temperature.
// fitWave gives the delay of each step in the wave:  rate of rise = (temperature before it − its own) ÷ τ.
// cutinEstimate works on the inlets: the highest each can reach with the R-105 inlet at its limit (E-129 gives part of
// the R-105 outlet's heat to the feed; each step loses some) and when it gets to its target at the present rate.
const H = 3_600_000;
const DT = 0.01; // hours per simulation step

export type PointKey = 'r105_in' | 'r105_out' | 'r101_in' | 'r102_in' | 'r103_in' | 'r104_in' | 'r104_out';
export type ReactorKey = 'r105' | 'r101' | 'r102' | 'r103' | 'r104';
/** the panel points in the order the heat reaches them */
export const WAVE_POINTS: { key: PointKey; label: string }[] = [
  { key: 'r105_in', label: 'R-105 inlet' }, { key: 'r105_out', label: 'R-105 outlet' }, { key: 'r101_in', label: 'R-101 inlet' },
  { key: 'r102_in', label: 'R-102 inlet' }, { key: 'r103_in', label: 'R-103 inlet' }, { key: 'r104_in', label: 'R-104 inlet' }, { key: 'r104_out', label: 'R-104 outlet' }];
/** the reactors in the order the heat reaches them */
export const WAVE_REACTORS: { key: ReactorKey; name: string }[] = [
  { key: 'r105', name: 'R-105' }, { key: 'r101', name: 'R-101' }, { key: 'r102', name: 'R-102' }, { key: 'r103', name: 'R-103' }, { key: 'r104', name: 'R-104' }];

/** the panel's temperatures at a time; beds: each reactor's hottest bed, optional, to show an exotherm */
export interface WaveReading { at: number; pts: Partial<Record<PointKey, number>>; beds: Partial<Record<ReactorKey, number>> }
/** the cut-in conditions: each reactor's inlet temperature, and the most the R-105 inlet may be raised to */
export interface CutinSpec { targets: Record<ReactorKey, number>; inletMax: number; ref: string | null }

export interface WaveFit { chain: PointKey[]; tau: number[]; from: number; to: number; inletRate: number }

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

/** each reactor's inlet: the cut-in conditions are on the reactor inlet temperatures (owner, 29 Oct 2026) */
export const INLET: Record<ReactorKey, PointKey> = { r105: 'r105_in', r101: 'r101_in', r102: 'r102_in', r103: 'r103_in', r104: 'r104_in' };

export interface InletEta {
  key: ReactorKey; name: string; target: number; now: number | null;
  /** °F/h between the two readings; the highest it can reach with the R-105 inlet at its limit */
  rate: number | null; max: number | null;
  done: boolean; wont: boolean; eta: number | null;
  /** a bed hotter than the inlet: the reaction is giving heat */
  exo: boolean;
}
export interface CutinEstimate {
  from: number; to: number; reactors: InletEta[];
  /** when every inlet is at its temperature; null when one cannot get there at this R-105 inlet or is not rising */
  ready: number | null; limiting: ReactorKey | null; blocked: boolean;
  /** the share of the R-105 outlet's heat above the feed that E-129 takes (from the drop to R-101 inlet) */
  e129: { dropNow: number; perDegree: number } | null;
}

/**
 * The cut-in estimate on the reactor inlets, from the latest two readings an hour or more apart.
 * The highest each inlet can reach: R-105 inlet at its limit; R-105 gives no heat away (a reaction only adds); E-129
 * takes from the R-105 outlet a drop that grows with it (as seen between the two readings: the feed side follows the
 * heat train); every further step loses what it loses now. The time: the rise at the present rate, slowing as it nears
 * that highest value. An estimate only: it never changes a step.
 */
export function cutinEstimate(readings: WaveReading[], spec: CutinSpec, horizonH = 48): CutinEstimate | null {
  const pair = pickPair(readings); if (!pair) return null;
  const [a, b] = pair; const span = (b.at - a.at) / H;
  if (b.pts.r105_in == null) return null;
  const cap = Math.max(spec.inletMax, b.pts.r105_in);
  // the highest each inlet can reach, down the train
  const max: Partial<Record<ReactorKey, number>> = { r105: cap };
  let e129: CutinEstimate['e129'] = null;
  const o1 = b.pts.r105_out, i1 = b.pts.r101_in;
  if (i1 != null) {
    if (o1 != null) {
      const d1 = o1 - i1; const o0 = a.pts.r105_out, i0 = a.pts.r101_in;
      const per = o0 != null && i0 != null && o1 !== o0 ? Math.min(1, Math.max(0, (d1 - (o0 - i0)) / (o1 - o0))) : 0;
      e129 = { dropNow: d1, perDegree: per };
      max.r101 = cap - Math.max(0, d1 + per * (cap - o1));
    } else max.r101 = cap - Math.max(0, b.pts.r105_in - i1);
  }
  const chain: ReactorKey[] = ['r101', 'r102', 'r103', 'r104'];
  for (let k = 1; k < chain.length; k++) {
    const up = chain[k - 1], me = chain[k]; const u = b.pts[INLET[up]], x = b.pts[INLET[me]];
    if (max[up] != null && u != null && x != null) max[me] = max[up]! - Math.max(0, u - x);
  }
  const reactors: InletEta[] = WAVE_REACTORS.map((r) => {
    const target = spec.targets[r.key]; const now = b.pts[INLET[r.key]] ?? null; const was = a.pts[INLET[r.key]];
    const rate = now != null && was != null ? (now - was) / span : null; const m = max[r.key] ?? null;
    const bed = b.beds[r.key]; const exo = bed != null && now != null && bed > now + 3;
    const base = { key: r.key, name: r.name, target, now, rate, max: m, exo };
    if (now != null && now >= target) return { ...base, done: true, wont: false, eta: b.at };
    if (now == null || m == null) return { ...base, done: false, wont: false, eta: null };
    if (m < target) return { ...base, done: false, wont: true, eta: null };
    if (rate == null || rate <= 0.5) return { ...base, done: false, wont: false, eta: null };
    // a first-order approach to the highest value: fast while far from it, slowing near it
    const gap = m - now; const left = Math.max(m - target, 1e-6); const h = (gap / rate) * Math.log(gap / left);
    return { ...base, done: false, wont: false, eta: h <= horizonH ? b.at + h * H : null };
  });
  const open = reactors.filter((r) => !r.done); const blocked = open.some((r) => r.wont);
  const ready = open.length === 0 ? b.at : open.some((r) => r.eta === null) ? null : Math.max(...open.map((r) => r.eta!));
  const limiting = open.length === 0 ? null : (open.find((r) => r.wont) ?? open.find((r) => r.eta === null) ?? open.reduce((x, r) => (r.eta! > x.eta! ? r : x))).key;
  return { from: a.at, to: b.at, reactors, ready, limiting, blocked, e129 };
}

/** Train-1's cut-in conditions (process instruction, 28 Oct 2026): each reactor's inlet °F, R-105 inlet up to 620 °F. */
export const TRAIN1_CUTIN: CutinSpec = { targets: { r105: 610, r101: 600, r102: 580, r103: 570, r104: 560 }, inletMax: 620, ref: 'Process instruction 28 Oct 2026' };
