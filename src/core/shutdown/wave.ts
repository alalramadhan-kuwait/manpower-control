// The heat wave through the reactors (owner, 28-29 Oct 2026). Only R-105 is heated; the heat travels R-105 → E-129 →
// R-101 → R-102 → R-103 → R-104. The black oil cut-in can start when every reactor inlet is at its temperature.
// fitWave gives the delay of each step in the wave:  rate of rise = (temperature before it − its own) ÷ τ.
// cutinEstimate works on the inlets: the highest each can reach with the R-105 inlet at its limit (E-129 gives part of
// the R-105 outlet's heat to the feed; each step loses some) and when it gets to its target at the present rate.
const H = 3_600_000;
const DT = 0.01; // hours per simulation step

export type PointKey = 'r105_in' | 'r105_out' | 'r101_in' | 'r102_in' | 'r103_in' | 'r104_in' | 'r104_out' | 'e129_feed' | 'e129_out';
/** E-129's own points, optional: the feed coming into its shell (TI-265) and the effluent leaving its tubes before the
 *  FC-148 hot gas joins (TI-1687). With them the E-129 drop is worked out from the feed temperature. */
export const E129_POINTS: { key: PointKey; label: string }[] = [{ key: 'e129_feed', label: 'E-129 feed in (12TI265)' }, { key: 'e129_out', label: 'E-129 tube out (12TI1687)' }];
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
export interface CutinSpec {
  targets: Record<ReactorKey, number>; inletMax: number; ref: string | null;
  /** R-105 catalyst: used catalyst gives heat (an exotherm) once R-105 is hot; fresh did not (owner, 29 Oct 2026) */
  catalyst?: 'fresh' | 'used' | null;
  /** the R-101 inlet held by its controller (TC-172) once there, e.g. 610 °F */
  r101Hold?: number | null;
}
/** E-129 takes this share of (R-105 outlet − feed in) once hot: 0.27–0.29 on both start-ups, one train (Oct-26) and two
 *  trains (Jan-26); fitted live when the feed in and the tube out are read */
export const E129_EFF = 0.28;
/** R-105 exotherm with used catalyst (Jan-26 start-up, Train-2 running): from an R-105 outlet of about 600 °F the outlet
 *  rose above the inlet, to about 68 °F over what it would be without the reaction, in about 2 h steps. Fresh catalyst
 *  (Oct-26) gave none, even at an R-105 inlet of 634 °F. */
export const EXO_USED = { onsetOut: 600, max: 68, tau: 2 };

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
  e129: {
    dropNow: number; perDegree: number;
    /** the most E-129 (less what FC-148 adds) may take for R-101 inlet to reach its target with R-105 inlet at its limit */
    allowed: number;
    /** from the feed temperature, when read: drop = eff × (R-105 outlet − feed in); the feed needed into E-129 */
    eff: number | null; feed: number | null; needFeed: number | null; gain: number;
  } | null;
  model: WaveModel;
  /** the R-105 exotherm: °F over the outlet without the reaction now, whether more is expected (used catalyst), the
   *  most expected */
  exo: { now: number; expected: boolean; max: number; catalyst: 'fresh' | 'used' | null };
  /** R-101 inlet held by TC-172 at this value, when set */
  r101Hold: number | null;
}

/** The wave model fitted to the panel's readings (owner, 29 Oct 2026): R-105 inlet → R-105 outlet (a delay τ and a
 *  loss), E-129 (takes from the R-105 outlet a drop a + b × outlet, the feed side following the heat train), then
 *  R-101 inlet → R-102 → R-103 → R-104 inlets (each a delay and a loss). With two readings the losses are taken as
 *  none; from three on they are fitted too. Fitted to Train-1's 3:00 PM, 9:51 PM and 5:37 AM it reads every point
 *  within 4 °F. */
export interface LagFit { tau: number; loss: number }
export interface WaveModel { r105: LagFit; e129: { a: number; b: number }; steps: Record<'r102' | 'r103' | 'r104', LagFit>; readings: number }
const STEP = 0.05; // hours per simulation step
const LAG_PATH: { key: 'r102' | 'r103' | 'r104'; from: PointKey; to: PointKey }[] = [
  { key: 'r102', from: 'r101_in', to: 'r102_in' }, { key: 'r103', from: 'r102_in', to: 'r103_in' }, { key: 'r104', from: 'r103_in', to: 'r104_in' }];

function lag(up: number[], x0: number, f: LagFit) { const out: number[] = []; let x = x0; for (const u of up) { x += (STEP * (u - f.loss - x)) / f.tau; out.push(x); } return out; }
/** the best delay and loss for one step: the simulated values meet the readings (least squares) */
function fitLag(up: number[], x0: number, marks: { i: number; v: number }[], withLoss: boolean): LagFit {
  let best = { e: Infinity, tau: 1, loss: 0 };
  for (let t = 1; t <= 100; t++) for (let l = 0; l <= (withLoss ? 40 : 0); l++) {
    const f = { tau: t * STEP, loss: l / 2 }; const s = lag(up, x0, f);
    const e = marks.reduce((n, m) => n + (s[Math.min(s.length - 1, m.i)] - m.v) ** 2, 0);
    if (e < best.e) best = { e, ...f };
  }
  return { tau: best.tau, loss: best.loss };
}
const e129Of = (m: WaveModel, out: number) => out - Math.max(0, m.e129.a + m.e129.b * out);

/** Fit the model to the readings (two at least, an hour or more apart, with every inlet and the R-105 outlet). */
export function fitModel(readings: WaveReading[]): WaveModel | null {
  const need: PointKey[] = ['r105_in', 'r105_out', 'r101_in', 'r102_in', 'r103_in', 'r104_in'];
  const r = [...readings].filter((x) => need.every((k) => x.pts[k] != null)).sort((a, b) => a.at - b.at);
  if (r.length < 2 || r[r.length - 1].at - r[0].at < H) return null;
  const t0 = r[0].at; const n = Math.ceil((r[r.length - 1].at - t0) / H / STEP);
  const idx = (x: WaveReading) => Math.max(0, Math.round((x.at - t0) / H / STEP) - 1);
  const marks = (k: PointKey) => r.slice(1).map((x) => ({ i: idx(x), v: x.pts[k]! }));
  // the R-105 inlet between readings: straight lines
  const inlet = Array.from({ length: n }, (_, i) => { const t = t0 + (i + 1) * STEP * H; const k = r.findIndex((x) => x.at >= t); const b = r[Math.max(1, k)], a = r[Math.max(0, k - 1)];
    return b.at === a.at ? b.pts.r105_in! : a.pts.r105_in! + ((b.pts.r105_in! - a.pts.r105_in!) * (t - a.at)) / (b.at - a.at); });
  const withLoss = r.length >= 3;
  // R-105's own delay and loss from the readings before its catalyst gives heat (outlet not above the inlet)
  const cool = r.slice(1).filter((x) => x.pts.r105_out! <= x.pts.r105_in! + 3).map((x) => ({ i: idx(x), v: x.pts.r105_out! }));
  const r105 = fitLag(inlet, r[0].pts.r105_out!, cool.length ? cool : marks('r105_out'), withLoss && cool.length >= 2);
  const out = lag(inlet, r[0].pts.r105_out!, r105);
  // E-129: the drop against the R-105 outlet, a straight line through the readings
  const xs = r.map((x) => x.pts.r105_out!), ys = r.map((x) => x.pts.r105_out! - x.pts.r101_in!);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0); const b = sxx > 0 ? Math.min(1, Math.max(0, xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx)) : 0;
  const m: WaveModel = { r105, e129: { a: my - b * mx, b }, steps: {} as WaveModel['steps'], readings: r.length };
  let up = out.map((o) => e129Of(m, o));
  for (const p of LAG_PATH) { const f = fitLag(up, r[0].pts[p.to]!, marks(p.to), withLoss); m.steps[p.key] = f; up = lag(up, r[0].pts[p.to]!, f); }
  return m;
}

/** E-129 from the feed temperature: drop = eff × (R-105 outlet − feed in), least squares over the readings that have
 *  the feed; the FC-148 hot gas adds R-101 inlet − E-129 out (when that is read; else none). */
export function feedModel(readings: WaveReading[]): { eff: number; gain: number } | null {
  // the latest readings with the feed flowing and warmed (a cold, standing feed line reads its pipe, not the feed)
  const r = readings.filter((x) => x.pts.e129_feed != null && x.pts.r105_out != null && (x.pts.e129_out != null || x.pts.r101_in != null) && x.pts.r105_out - x.pts.e129_feed > 40)
    .sort((a, b) => a.at - b.at).slice(-8);
  if (!r.length) return null;
  const g = r.filter((x) => x.pts.e129_out != null && x.pts.r101_in != null).map((x) => x.pts.r101_in! - x.pts.e129_out!);
  const gain = g.length ? g.reduce((a, v) => a + v, 0) / g.length : 0;
  let sxy = 0, sxx = 0;
  for (const x of r) { const d = x.pts.r105_out! - x.pts.e129_feed!; const drop = x.pts.r105_out! - (x.pts.e129_out ?? x.pts.r101_in! - gain); sxy += d * drop; sxx += d * d; }
  return sxx > 0 ? { eff: Math.min(1, Math.max(0, sxy / sxx)), gain } : null;
}

/**
 * The cut-in estimate on the reactor inlets. From the latest reading on, the R-105 inlet goes on at its present rate
 * up to its limit and the model carries the heat down the train: when each inlet gets to its target, and the highest
 * it can reach (all steady with R-105 inlet at the limit). An inlet whose highest is below its target reads "won't".
 * An estimate only: it never changes a step.
 */
export function cutinEstimate(readings: WaveReading[], spec: CutinSpec, horizonH = 48): CutinEstimate | null {
  const pair = pickPair(readings); if (!pair) return null;
  const [a, b] = pair; const span = (b.at - a.at) / H;
  const m = fitModel(readings); if (!m || b.pts.r105_in == null) return null;
  const cap = Math.max(spec.inletMax, b.pts.r105_in); const rate = Math.max(0, (b.pts.r105_in - (a.pts.r105_in ?? b.pts.r105_in)) / span);
  // E-129 by the feed temperature (when read): drop = eff × (R-105 outlet − feed in), the feed held at its latest value;
  // without the feed, the drop fitted against the outlet as before
  const fm = feedModel(readings); const feed = b.pts.e129_feed ?? null;
  const eff = fm && feed != null ? (readings.filter((x) => x.pts.e129_feed != null).length >= 2 ? fm.eff : E129_EFF) : null;
  const gain = fm?.gain ?? 0; const hold = spec.r101Hold ?? null;
  const e129 = (o: number) => (eff != null && feed != null ? o - eff * Math.max(0, o - feed) + gain : e129Of(m, o));
  const r101At = (o: number) => (hold != null ? Math.min(hold, e129(o)) : e129(o));
  // the R-105 exotherm: what the outlet reads over the outlet without the reaction (inlet less R-105's loss)
  const cat = spec.catalyst ?? null; const out1 = b.pts.r105_out!;
  const exoNow = out1 > b.pts.r105_in ? out1 - (b.pts.r105_in - m.r105.loss) : 0;
  const used = cat === 'used'; const exoMax = used ? Math.max(EXO_USED.max, exoNow) : exoNow;
  // steady with the inlet at its limit
  const oSS = cap - m.r105.loss + exoMax; const max: Record<ReactorKey, number> = { r105: cap, r101: r101At(oSS), r102: 0, r103: 0, r104: 0 };
  const allowed = oSS + gain - spec.targets.r101;
  const needFeed = eff && eff > 0 ? oSS - allowed / eff : null;
  max.r102 = max.r101 - m.steps.r102.loss; max.r103 = max.r102 - m.steps.r103.loss; max.r104 = max.r103 - m.steps.r104.loss;
  // the way there, from the latest reading: the outlet without the reaction follows the inlet; the reaction adds its
  // heat (used catalyst: growing from an outlet of ~600 °F to its most; fresh: what is seen now, held)
  const n = Math.ceil(horizonH / STEP);
  const inlet = Array.from({ length: n }, (_, i) => Math.min(cap, b.pts.r105_in! + rate * (i + 1) * STEP));
  const base = lag(inlet, out1 - exoNow, m.r105);
  let ex = exoNow; const outS = base.map((o) => { if (used && (ex > 0 || o >= EXO_USED.onsetOut)) ex += (STEP * (exoMax - ex)) / EXO_USED.tau; return o + ex; });
  const series: Record<ReactorKey, number[]> = { r105: inlet, r101: [], r102: [], r103: [], r104: [] };
  series.r101 = outS.map(r101At);
  series.r102 = lag(series.r101, b.pts.r102_in!, m.steps.r102); series.r103 = lag(series.r102, b.pts.r103_in!, m.steps.r103); series.r104 = lag(series.r103, b.pts.r104_in!, m.steps.r104);
  const reactors: InletEta[] = WAVE_REACTORS.map((r) => {
    const target = spec.targets[r.key]; const now = b.pts[INLET[r.key]] ?? null; const was = a.pts[INLET[r.key]];
    const rt = now != null && was != null ? (now - was) / span : null; const mx = max[r.key];
    const bed = b.beds[r.key]; const exo = bed != null && now != null && bed > now + 3;
    const base = { key: r.key, name: r.name, target, now, rate: rt, max: mx, exo };
    // R-105 giving heat: its outlet at the target counts (the plant lowers the inlet once the reaction carries it)
    if (now != null && (now >= target || (r.key === 'r105' && exoNow > 5 && out1 >= target))) return { ...base, done: true, wont: false, eta: b.at };
    if (now == null) return { ...base, done: false, wont: false, eta: null };
    if (mx < target) return { ...base, done: false, wont: true, eta: null };
    const k = series[r.key].findIndex((v) => v >= target);
    return { ...base, done: false, wont: false, eta: k < 0 ? null : b.at + (k + 1) * STEP * H };
  });
  const open = reactors.filter((r) => !r.done); const blocked = open.some((r) => r.wont);
  const ready = open.length === 0 ? b.at : open.some((r) => r.eta === null) ? null : Math.max(...open.map((r) => r.eta!));
  const limiting = open.length === 0 ? null : (open.find((r) => r.wont) ?? open.find((r) => r.eta === null) ?? open.reduce((x, r) => (r.eta! > x.eta! ? r : x))).key;
  const o1 = b.pts.r105_out!;
  return { from: a.at, to: b.at, reactors, ready, limiting, blocked, e129: { dropNow: o1 - b.pts.r101_in!, perDegree: m.e129.b, allowed, eff, feed, needFeed, gain }, model: m,
    exo: { now: exoNow, expected: used, max: exoMax, catalyst: cat }, r101Hold: hold };
}

/** Train-1's cut-in conditions (process instruction, 28 Oct 2026): each reactor's inlet °F, R-105 inlet up to 620 °F. */
export const TRAIN1_CUTIN: CutinSpec = { targets: { r105: 610, r101: 600, r102: 580, r103: 570, r104: 560 }, inletMax: 620, ref: 'Process instruction 28 Oct 2026' };
