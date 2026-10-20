// Shutdown progress tracker (U-12 TR-2 tracker v4): the rules of the guideline steps, the equipment flags, plan vs
// actual against the bar chart, the "needs attention" list and the shift report. Pure: everything is worked out from
// the rows and the time given, the same on the page, the report and the tests.

export type StepStatus = 'not_started' | 'in_progress' | 'done' | 'pending' | 'na';
export type StepState = 'DONE' | 'NA' | 'PENDING' | 'IN_PROGRESS' | 'READY' | 'WAITING';
export type Flag = 'IAT_OPEN' | 'COMPLETE' | 'PENDING' | 'HO_LATE' | 'LATE' | 'NOT_HO' | 'IN_PROGRESS' | 'NONE';

export interface TrkStep {
  id: string; stepId: string; fo: string; gate: number; gateName: string | null; shortName: string; text: string | null;
  procedure: string | null; prereq: string[]; estHours: number | null; note: string | null; target: string | null;
  status: StepStatus; pendingReason: string | null; remark: string | null; updatedBy: string | null; updatedAt: string | null;
  /** when it was started and done (stamped, correctable) */
  startedAt?: string | null; doneAt?: string | null;
}
export interface TrkEquipment {
  id: string; tag: string; group: string; description: string | null; fo: string | null; hoStep: string | null; procedure: string | null;
  barchartKey: string | null; opsItem: boolean; critical: boolean; tracked: boolean; disabledReason: string | null;
  plannedHo: string | null; plannedFinish: string | null; sort: number; stage: number; pendingReason: string | null; remark: string | null;
  blindsIn: string | null; blindsOut: string | null; updatedBy: string | null; updatedAt: string | null;
}
export interface TrkIat { id: string; tag: string; iatNo: string; jobText: string | null; discipline: string | null; issuedAt: string; status: 'open' | 'closed'; closedAt: string | null }
export interface TrkActivity {
  id: string; activityId: string; group: string | null; key: string; activity: string; durationH: number | null; start: string | null; finish: string | null; stage: number | null; tracked: boolean;
  /** the mechanical activity as it went (kept for future shutdowns) */
  actualStart?: string | null; actualFinish?: string | null; actualNote?: string | null; updatedBy?: string | null; updatedAt?: string | null;
  /** the place set by hand in the item's list (null = the plan order) · a field-operator detail step, hidden for the Section Head */
  seq?: number | null; detail?: boolean;
}
export interface TrkLog { kind: 'step' | 'equipment' | 'iat' | 'activity' | 'point'; ref: string; field: string; oldValue: string | null; newValue: string | null; byName: string | null; at: string }
export interface TrkSettings { hoTarget?: string; end?: string; workOrder?: string; whatsapp?: string; opsStart?: string; miStart?: string; miEnd?: string }
/** A critical blind (segregation point) or a neutralization (loop or item), entered once on the Isolation page. */
export type PointStatus = 'open' | 'in' | 'out' | 'filling' | 'soaking' | 'draining' | 'done';
export interface TrkPoint {
  id: string; kind: 'blind' | 'neut';
  /** a blind: segregation or HP critical (installed by M & I) */
  grp: 'segregation' | 'hp_critical' | null; ref: string; name: string; detail: string | null; fo: string | null; stepId: string | null; items: string[];
  /** the blinds (refs) that must be in before this neutralization can start */
  requires?: string[];
  /** a neutralization the item's handover waits for */
  beforeHo: boolean; sort: number; status: PointStatus;
  inAt: string | null; outAt: string | null; fillAt: string | null; soakAt: string | null; drainAt: string | null; doneAt: string | null;
  soakH: number | null; remark: string | null; updatedBy: string | null; updatedAt: string | null;
}
export interface TrkData { steps: TrkStep[]; equipment: TrkEquipment[]; iats: TrkIat[]; activities: TrkActivity[]; log: TrkLog[]; settings: TrkSettings; points?: TrkPoint[] }

/** The main equipment groups; the rest (control valve shells, PSVs, check valves, RTJ & injection points, piping, OPR
 *  list, PMRs …) is miscellaneous, shown after them. */
export const MAIN_GROUPS = ['Reactors', 'Heaters', 'Exchangers', 'Vessels', 'Filters', 'Compressor', 'Pumps / LO'] as const;
export const isMisc = (group: string) => !(MAIN_GROUPS as readonly string[]).includes(group);
export const STAGES = ['Not handed over', 'Handed over', 'Opened / cleaning', 'Inspection', 'Repair', 'Box-up', 'Deblinded / returned'] as const;
export const STAGE_SHORT = ['Not HO', 'HO', 'Cleaning', 'Inspection', 'Repair', 'Box-up', 'Returned'] as const;
export const PENDING_REASONS = ['Stuck / seized bolts', 'Waiting material', 'Waiting manpower', 'Waiting scaffolding', 'Waiting permit / gas test', 'Waiting inspection (IAT)',
  'Line choked', 'Valve passing', 'Waiting blind / gasket', 'Waiting crane / equipment', 'Waiting previous step', 'Waiting N2 / steam / soda ash', 'Weather', 'Other'] as const;
export const FO_NAMES: Record<string, string> = { FO1: 'Reactors', FO2: 'HP', FO3: 'LP + Heaters' };
const DEFAULT_TARGET = '2026-10-20T07:00:00+03:00';
const DAY = 864e5, H = 36e5;
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

// ── Steps ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface StepView { step: TrkStep; state: StepState; waitingFor: string[]; late: boolean; lateBy: number }
export function stepViews(d: TrkData, now: number): Map<string, StepView> {
  const by = new Map(d.steps.map((s) => [s.stepId, s]));
  const closed = (id: string) => { const s = by.get(id); return !s || s.status === 'done' || s.status === 'na'; };
  const out = new Map<string, StepView>();
  for (const s of d.steps) {
    const waitingFor = s.prereq.filter((p) => !closed(p));
    const state: StepState = s.status === 'done' ? 'DONE' : s.status === 'na' ? 'NA' : s.status === 'pending' || !!s.pendingReason ? 'PENDING'
      : s.status === 'in_progress' ? 'IN_PROGRESS' : waitingFor.length ? 'WAITING' : 'READY';
    // a waiting step is never late: only the root cause turns red
    const target = ms(s.target ?? d.settings.hoTarget ?? DEFAULT_TARGET);
    const late = (state === 'READY' || state === 'IN_PROGRESS' || state === 'PENDING') && now > target;
    out.set(s.stepId, { step: s, state, waitingFor, late, lateBy: late ? now - target : 0 });
  }
  return out;
}

// ── Equipment ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface PlanVsActual { planned: number; variance: number; days: number }
export interface EquipView {
  eq: TrkEquipment; stage: number; flag: Flag; reason: string | null; late: boolean; lateBy: number;
  /** when the item was blinded = handed over: the blinds-in time (stamped by the stage, the HO step or the blind line) */
  hoAt: string | null; iatsOpen: TrkIat[]; plan: PlanVsActual | null;
}

/** A bar-chart line done with the stage, not tapped on its own: the deblinding (stage 6, = returned). The blinding
 *  (stage 1) is M & I work tapped on its own (finished, it also means the item is handed over). */
export function blindLink(a: Pick<TrkActivity, 'activity' | 'stage'>): 6 | null {
  return /blind/i.test(a.activity) && a.stage === 6 ? 6 : null;
}
/** An item's blind line installed by M & I (stage 1 in the bar chart; not the operations steps that mention blinds). */
export const equipBlind = (a: Pick<TrkActivity, 'activity' | 'stage' | 'tracked' | 'group'>) => a.tracked && a.stage === 1 && a.group !== 'Operations' && /blind/i.test(a.activity) && !/deblind|de-blind|remove blind/i.test(a.activity);
/** The order of an item's work steps: the operations steps of its handover procedure first (in their order), then the
 *  bar chart by planned start. */
export function actOrder(x: Pick<TrkActivity, 'group' | 'activityId' | 'start'>, y: Pick<TrkActivity, 'group' | 'activityId' | 'start'>): number {
  const ox = x.group === 'Operations', oy = y.group === 'Operations';
  if (ox !== oy) return ox ? -1 : 1;
  if (ox) return x.activityId.localeCompare(y.activityId);
  return (x.start ?? '9').localeCompare(y.start ?? '9');
}

type Orderable = Pick<TrkActivity, 'group' | 'activityId' | 'start'> & { activity?: string; actualStart?: string | null; seq?: number | null };
/** The work steps in the order they go: the operations steps first, then the bar-chart lines by when they really
 *  started (the plan for those not started yet). The soda-ash parts (filling · soaking · draining) stay together. */
export function sortActs<T>(xs: T[], get: (x: T) => Orderable = (x) => x as unknown as Orderable): T[] {
  const base = (a: Orderable) => a.activityId.replace(/-\d+$/, '');
  const soda = (a: Orderable) => /soda ash|neutrali/i.test(a.activity ?? '');
  const first = new Map<string, string>();
  for (const x of xs) { const a = get(x); if (soda(a) && a.actualStart && (!first.has(base(a)) || a.actualStart < first.get(base(a))!)) first.set(base(a), a.actualStart); }
  const when = (a: Orderable) => (soda(a) && first.has(base(a)) ? first.get(base(a))! : a.actualStart ?? a.start ?? '9');
  return [...xs].sort((p, q) => {
    const x = get(p), y = get(q); const ox = x.group === 'Operations', oy = y.group === 'Operations';
    // an order set by hand wins (steps added later without a place go to the end)
    if (x.seq != null || y.seq != null) { if (x.seq == null) return 1; if (y.seq == null) return -1; if (x.seq !== y.seq) return x.seq - y.seq; }
    if (ox !== oy) return ox ? -1 : 1;
    if (ox) return x.activityId.localeCompare(y.activityId);
    return when(x).localeCompare(when(y)) || x.activityId.localeCompare(y.activityId, undefined, { numeric: true });
  });
}

// ── Isolation & neutralization ─────────────────────────────────────────────────────────────────────────────────
/** Blind in (or already out) · neutralization drained. */
export const pointComplete = (p: Pick<TrkPoint, 'kind' | 'status'>) => (p.kind === 'blind' ? p.status === 'in' || p.status === 'out' : p.status === 'done');
export const NEUT_FLOW = ['open', 'filling', 'soaking', 'draining', 'done'] as const;
export const NEUT_LABEL: Record<string, string> = { open: 'Not started', filling: 'Filling', soaking: 'Soaking', draining: 'Draining', done: 'Neutralized' };
/** The time left of the soak (ms, below 0 = overdue), when soaking with a soak time. */
export function soakLeft(p: TrkPoint, now: number): number | null {
  return p.kind === 'neut' && p.status === 'soaking' && p.soakH && p.soakAt ? Date.parse(p.soakAt) + p.soakH * H - now : null;
}
/** A bar-chart line moved by the item's neutralization (not tapped on its own). */
export const neutLink = (a: Pick<TrkActivity, 'activity'>) => /neutrali|soda ash (filling|soaking|draining)/i.test(a.activity);
export interface Isolation { blinds: TrkPoint[]; neut: TrkPoint[]; blindsIn: number; neutDone: number; ready: boolean }
/** An item's blinds and neutralization: ready (handed over) when its neutralization before handover is done (the blinds are M & I work after it). */
export function isolationOf(tag: string, points: TrkPoint[] = []): Isolation | null {
  const mine = points.filter((p) => p.items.includes(tag));
  if (!mine.length) return null;
  const blinds = mine.filter((p) => p.kind === 'blind'), neut = mine.filter((p) => p.kind === 'neut');
  const gate = mine.filter((p) => p.kind === 'neut' && p.beforeHo);
  return { blinds, neut, blindsIn: blinds.filter(pointComplete).length, neutDone: neut.filter(pointComplete).length, ready: gate.length > 0 && gate.every(pointComplete) && blinds.every(pointComplete) };
}

/** The blinds a neutralization still waits for (refs not in yet), empty when it can start. */
export function missingBlinds(p: Pick<TrkPoint, 'requires'>, points: TrkPoint[] = []): string[] {
  return (p.requires ?? []).filter((r) => !points.some((b) => b.kind === 'blind' && b.ref === r && pointComplete(b)));
}
/** An item's isolation state, the colour it shows everywhere before (and at) the handover. */
export type IsoState = 'blind' | 'idle' | 'neut' | 'ready' | 'ho';
export const ISO_LABEL: Record<IsoState, string> = { blind: 'BLIND', idle: 'NOT READY', neut: 'NEUT', ready: 'READY HO', ho: 'HO' };
export interface IsoView { state: IsoState; why: string; missing: string[]; loops: TrkPoint[] }
export function isoState(tag: string, stage: number, points: TrkPoint[] = []): IsoView | null {
  const mine = points.filter((p) => p.items.includes(tag));
  const loops = mine.filter((p) => p.kind === 'neut' && p.beforeHo);
  if (!mine.length) return null;
  if (stage >= 1) return { state: 'ho', why: 'Handed over', missing: [], loops };
  const open = loops.filter((p) => !pointComplete(p));
  // blinds linked to the item, and those its open loops wait for
  const missing = [...new Set([...mine.filter((p) => p.kind === 'blind' && !pointComplete(p)).map((p) => p.ref), ...open.flatMap((p) => missingBlinds(p, points))])].sort();
  const running = open.filter((p) => p.status !== 'open');
  if (running.length) return { state: 'neut', why: `Neutralizing ${running.map((p) => `${p.ref} · ${NEUT_LABEL[p.status]}`).join(', ')}`, missing, loops };
  if (missing.length) return { state: 'blind', why: `🔒 ${missing.join(', ')} not in`, missing, loops };
  if (!open.length) return { state: 'ready', why: loops.length ? `Neutralized ${loops.map((p) => p.ref).join(', ')} → hand over` : 'Blinds in → hand over', missing, loops };
  return { state: 'idle', why: `Waiting ${open.map((p) => p.ref).join(', ')} (not started)`, missing, loops };
}

export function planVsActual(acts: TrkActivity[], actual: number, now: number): PlanVsActual | null {
  const list = acts.filter((a) => a.tracked && a.stage !== null && a.start && a.group !== 'Operations');
  if (!list.length) return null;
  // a line counts for its stage once planned to start, a long one (over a day, e.g. a 15-day overhaul) once planned to finish
  const started = list.filter((a) => ms((a.durationH ?? 0) > 24 && a.finish ? a.finish : a.start) <= now);
  const planned = started.length ? Math.max(...started.map((a) => a.stage!)) : 0;
  const variance = actual - planned;
  const firstOf = (st: number) => { const xs = list.filter((a) => a.stage === st).map((a) => ms(a.start)); return xs.length ? Math.min(...xs) : NaN; };
  let days = 0;
  if (variance < 0) { const t = firstOf(actual + 1); days = Number.isNaN(t) ? 0 : Math.max(0, (now - t) / DAY); }
  else if (variance > 0) { const t = firstOf(actual); days = Number.isNaN(t) ? 0 : Math.max(0, (t - now) / DAY); }
  return { planned, variance, days: Math.round(days * 10) / 10 };
}

export function equipViews(d: TrkData, now: number, steps = stepViews(d, now)): EquipView[] {
  const actsBy = new Map<string, TrkActivity[]>();
  for (const a of d.activities) actsBy.set(a.key, [...(actsBy.get(a.key) ?? []), a]);
  return [...d.equipment].sort((a, b) => a.sort - b.sort).map((eq) => {
    const ho = eq.hoStep ? steps.get(eq.hoStep) ?? null : null;
    const hoDone = ho?.state === 'DONE';
    const stage = Math.max(eq.stage, hoDone ? 1 : 0);
    const iatsOpen = d.iats.filter((i) => i.tag === eq.tag && i.status === 'open');
    const ops = eq.opsItem && !!eq.fo && !!eq.hoStep;
    const hoAtIso = eq.blindsIn ?? (hoDone ? ho!.step.doneAt ?? ho!.step.updatedAt : null);
    // the bar chart of an item handed over runs from its own handover (moved by how early / late it came)
    const acts = eq.barchartKey ? actsBy.get(eq.barchartKey) ?? [] : [];
    const first = Math.min(...acts.filter((a) => a.tracked && a.start && a.group !== 'Operations').map((a) => ms(a.start)));
    const shift = stage >= 1 && hoAtIso && Number.isFinite(first) ? ms(hoAtIso) - first : 0;
    const plan = eq.barchartKey ? planVsActual(acts, stage, now - shift) : null;
    let flag: Flag = 'NONE', reason: string | null = null, lateBy = 0;
    // blinded = handed over: an item handed over on its own while its HO step (shared by several items) is open is fine
    if (stage >= 5 && iatsOpen.length) flag = 'IAT_OPEN';
    else if (stage === 6) flag = 'COMPLETE';
    else if (eq.pendingReason) { flag = 'PENDING'; reason = eq.pendingReason; }
    else if (stage === 0 && ho?.state === 'PENDING') { flag = 'PENDING'; reason = `${ho.step.pendingReason ?? 'Pending'} (step)`; }
    // handover late only once operations can work the handover step (assumption agreed for v1: a WAITING step's item is not late)
    else if (ops && eq.tracked && stage === 0 && eq.plannedHo && now > ms(eq.plannedHo) && ho && ho.state !== 'WAITING') { flag = 'HO_LATE'; lateBy = now - ms(eq.plannedHo); }
    else if (ops && eq.tracked && stage < 6 && eq.plannedFinish && now > ms(eq.plannedFinish)) { flag = 'LATE'; lateBy = now - ms(eq.plannedFinish); }
    else if (ops && stage === 0) flag = 'NOT_HO';
    else if (stage >= 1 && stage <= 5) flag = 'IN_PROGRESS';
    const hoAt = hoAtIso;
    return { eq, stage, flag, reason, late: flag === 'HO_LATE' || flag === 'LATE', lateBy, hoAt, iatsOpen, plan };
  });
}

// ── Overall ────────────────────────────────────────────────────────────────────────────────────────────────────
export type Banner = { state: 'AHEAD' | 'BEHIND' | 'ON_PLAN'; planPct: number; actualPct: number; days: number; items: number };
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export function banner(eqs: EquipView[]): Banner {
  const list = eqs.filter((e) => e.eq.opsItem && e.eq.tracked && e.plan);
  if (!list.length) return { state: 'ON_PLAN', planPct: 0, actualPct: 0, days: 0, items: 0 };
  const planPct = list.reduce((t, e) => t + e.plan!.planned / 6, 0) / list.length;
  const actualPct = list.reduce((t, e) => t + e.stage / 6, 0) / list.length;
  const state = actualPct >= planPct + 0.02 ? 'AHEAD' : actualPct < planPct - 0.02 ? 'BEHIND' : 'ON_PLAN';
  const off = list.filter((e) => (state === 'BEHIND' ? e.plan!.variance < 0 : state === 'AHEAD' ? e.plan!.variance > 0 : false)).map((e) => e.plan!.days);
  return { state, planPct: Math.round(planPct * 100), actualPct: Math.round(actualPct * 100), days: Math.round(median(off) * 10) / 10, items: list.length };
}

export interface Attention { kind: 'step' | 'equipment'; ref: string; label: string; detail: string; flag: Flag | 'STEP_LATE' | 'STEP_PENDING'; rank: number; at: number }
const RANK: Record<string, number> = { HO_LATE: 1, LATE: 2, STEP_LATE: 2, PENDING: 3, STEP_PENDING: 3, IAT_OPEN: 4 };
export const hoursText = (msec: number) => (msec >= DAY ? `${Math.round(msec / DAY * 10) / 10} d` : `${Math.max(1, Math.round(msec / H))} h`);
/** The "needs me" list: HO LATE › LATE › PENDING › IAT OPEN (tracked items only), steps late or pending too. */
export function attention(steps: Map<string, StepView>, eqs: EquipView[]): Attention[] {
  const out: Attention[] = [];
  for (const e of eqs) {
    if (!e.eq.tracked || !(e.flag in RANK)) continue;
    const detail = e.flag === 'HO_LATE' || e.flag === 'LATE' ? hoursText(e.lateBy)
      : e.flag === 'PENDING' ? e.reason ?? '' : e.flag === 'IAT_OPEN' ? e.iatsOpen.map((i) => i.iatNo).join(', ') : '';
    out.push({ kind: 'equipment', ref: e.eq.tag, label: e.eq.tag, detail, flag: e.flag, rank: RANK[e.flag], at: e.lateBy });
  }
  for (const v of steps.values()) {
    if (v.state === 'PENDING') out.push({ kind: 'step', ref: v.step.stepId, label: `${v.step.stepId} ${v.step.shortName}`, detail: v.step.pendingReason ?? 'Pending', flag: 'STEP_PENDING', rank: RANK.STEP_PENDING, at: v.lateBy });
    else if (v.late) out.push({ kind: 'step', ref: v.step.stepId, label: `${v.step.stepId} ${v.step.shortName}`, detail: hoursText(v.lateBy), flag: 'STEP_LATE', rank: RANK.STEP_LATE, at: v.lateBy });
  }
  return out.sort((a, b) => a.rank - b.rank || b.at - a.at || a.label.localeCompare(b.label));
}

/** What to do next on an item: before the handover its next operations step (then its neutralization, then the
 *  handover itself), after the handover its next bar-chart line. `n`/`of` count the steps of that phase. */
export interface NextStep { text: string; running: boolean; n: number; of: number }
export function nextStep(e: EquipView, acts: TrkActivity[], points: TrkPoint[] = []): NextStep | null {
  const key = e.eq.barchartKey ?? e.eq.tag;
  const mine = acts.filter((a) => a.tracked && !a.detail && a.key === key);
  const pick = (xs: TrkActivity[]): NextStep | null => {
    const s = sortActs(xs), a = s.find((x) => !x.actualFinish);
    return a ? { text: a.activity, running: !!a.actualStart, n: s.indexOf(a) + 1, of: s.length } : null;
  };
  if (e.stage >= 1) return pick(mine.filter((a) => a.group !== 'Operations'));
  const ops = pick(mine.filter((a) => a.group === 'Operations'));
  if (ops) return ops;
  const p = points.find((x) => x.kind === 'neut' && x.beforeHo && x.items.includes(e.eq.tag) && !pointComplete(x));
  if (p) { const m = p.status === 'open' ? missingBlinds(p, points) : [];
    return { text: m.length ? `🔒 Blinds for ${p.ref}: ${m.join(', ')}` : `Neutralize ${p.ref} · ${NEUT_LABEL[p.status]}`, running: p.status !== 'open', n: 0, of: 0 }; }
  const b = points.find((x) => x.kind === 'blind' && x.items.includes(e.eq.tag) && !pointComplete(x));
  if (b) return { text: `🔒 Blind ${b.ref} · ${b.name}`, running: false, n: 0, of: 0 };
  return { text: e.eq.hoStep ? `Hand over (${e.eq.hoStep})` : 'Hand over', running: false, n: 0, of: 0 };
}

/** Needs-attention order by what matters, not by name: critical items, then the main items (reactors, heaters,
 *  compressor, vessels, exchangers, filters, pumps), a step already running before one not started; parts of another
 *  item (C-12-201-E-01A, P-12-205-TK-01 …) and the miscellaneous ones (check valves, PSVs, CV shells …) are `minor`. */
const FOCUS_GROUP = ['Reactors', 'Heaters', 'Compressor', 'Vessels', 'Exchangers', 'Filters', 'Pumps / LO'];
export interface Focus { a: Attention; e: EquipView | null; next: NextStep | null; minor: boolean }
export function focusList(att: Attention[], eqs: EquipView[], acts: TrkActivity[], points: TrkPoint[] = []): Focus[] {
  const tags = eqs.map((x) => x.eq.tag);
  const part = (t: string) => tags.some((p) => p !== t && (t.startsWith(`${p}-`) || t.startsWith(`${p} `)));
  const out = att.map((a, i) => {
    const e = a.kind === 'equipment' ? eqs.find((x) => x.eq.tag === a.ref) ?? null : null;
    const next = e ? nextStep(e, acts, points) : null;
    const minor = !!e && !e.eq.critical && (isMisc(e.eq.group) || part(e.eq.tag));
    const g = e ? (FOCUS_GROUP.indexOf(e.eq.group) + 1 || 9) : 8;   // a late guideline step after the main items
    return { f: { a, e, next, minor }, k: [Number(minor), e?.eq.critical ? 0 : 1, next?.running ? 0 : 1, g, i] };
  });
  return out.sort((x, y) => { for (let j = 0; j < x.k.length; j++) if (x.k[j] !== y.k[j]) return x.k[j] - y.k[j]; return 0; }).map((x) => x.f);
}

export interface Totals { steps: number; stepsDone: number; ho: number; hoDone: number; late: number; pending: number; iatOpen: number; ready: number }
export function totals(steps: Map<string, StepView>, eqs: EquipView[], iats: TrkIat[]): Totals {
  const sv = [...steps.values()];
  const ops = eqs.filter((e) => e.eq.opsItem && e.eq.tracked);
  return {
    steps: sv.filter((v) => v.state !== 'NA').length, stepsDone: sv.filter((v) => v.state === 'DONE').length,
    ho: ops.length, hoDone: ops.filter((e) => e.stage >= 1).length,
    late: sv.filter((v) => v.late).length + eqs.filter((e) => e.eq.tracked && e.late).length,
    pending: sv.filter((v) => v.state === 'PENDING').length + eqs.filter((e) => e.eq.tracked && e.flag === 'PENDING' && !e.reason?.endsWith('(step)')).length,
    iatOpen: iats.filter((i) => i.status === 'open').length, ready: sv.filter((v) => v.state === 'READY').length,
  };
}

// ── Shifts and the report ──────────────────────────────────────────────────────────────────────────────────────
const KW = 3 * H;   // Kuwait time, UTC+3 all year
/** The shift a moment falls in: day 07:00–19:00, night 19:00–07:00 (Kuwait); its date is the day it starts. */
export function shiftOf(now: number): { date: string; shift: 'D' | 'N'; from: number; to: number } {
  const local = now + KW; const day = Math.floor(local / DAY) * DAY; const h = (local - day) / H;
  if (h >= 7 && h < 19) return { date: new Date(day).toISOString().slice(0, 10), shift: 'D', from: day + 7 * H - KW, to: day + 19 * H - KW };
  const start = h >= 19 ? day : day - DAY;
  return { date: new Date(start).toISOString().slice(0, 10), shift: 'N', from: start + 19 * H - KW, to: start + 31 * H - KW };
}
export const kwTime = (iso: string | number) => { const d = new Date((typeof iso === 'number' ? iso : Date.parse(iso)) + KW); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
export const kwDay = (iso: string | number) => new Date((typeof iso === 'number' ? iso : Date.parse(iso)) + KW).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export interface ShiftReport {
  title: string; banner: Banner; totals: Totals;
  stepsDone: { stepId: string; name: string; at: string; by: string | null }[];
  stageChanges: { tag: string; from: number; to: number; at: string; by: string | null }[];
  /** mechanical activities started / finished in the shift */
  activities: { ref: string; field: 'actual_start' | 'actual_finish'; at: string; by: string | null }[];
  attention: Attention[]; ready: StepView[]; notes: string; temps: Record<string, string>;
  /** the operations part and M & I (started at the critical handover) */
  ops: OpsProgress | null; mi: MiPhase;
  /** for the brief message: each reactor (stage, its neutralization), handovers, neutralization and blinds */
  reactors: { tag: string; critical: boolean; stage: number; neut: string | null; hoAt: string | null }[];
  results: ReturnType<typeof opsResults>; blinds: ReturnType<typeof miBlinds>;
  /** the shift (date, day / night), the tracker title, the blinds / neutralizations completed in the shift */
  shift: { date: string; shift: 'D' | 'N' }; name: string; pointsDone: { ref: string; kind: 'blind' | 'neut' }[]; blindLinesDone: number;
}
export const REACTORS = ['R205', 'R201', 'R202', 'R203', 'R204'] as const;

export function shiftReport(d: TrkData, now: number, log: { notes?: string | null; temps?: Record<string, string> } | null, title = 'U-12 TR-2 SD'): ShiftReport {
  const sh = shiftOf(now);
  const steps = stepViews(d, now); const eqs = equipViews(d, now, steps);
  const inShift = d.log.filter((l) => ms(l.at) >= sh.from && ms(l.at) < sh.to);
  const name = (id: string) => d.steps.find((s) => s.stepId === id)?.shortName ?? '';
  // the last change of each step / item in the shift (a step done then reopened is not "done this shift")
  const lastBy = <T extends TrkLog>(xs: T[]) => { const m = new Map<string, T>(); for (const x of xs) m.set(x.ref, x); return [...m.values()]; };
  const stepsDone = lastBy(inShift.filter((l) => l.kind === 'step' && l.field === 'status')).filter((l) => l.newValue === 'done')
    .map((l) => ({ stepId: l.ref, name: name(l.ref), at: l.at, by: l.byName }));
  const firstOld = new Map<string, number>();
  for (const l of inShift) if (l.kind === 'equipment' && l.field === 'stage' && !firstOld.has(l.ref)) firstOld.set(l.ref, Number(l.oldValue ?? 0));
  const stageChanges = lastBy(inShift.filter((l) => l.kind === 'equipment' && l.field === 'stage')).map((l) => ({ tag: l.ref, from: firstOld.get(l.ref) ?? 0, to: Number(l.newValue ?? 0), at: l.at, by: l.byName }))
    .filter((c) => c.from !== c.to);
  const activities = inShift.filter((l) => l.kind === 'activity' && (l.field === 'actual_start' || l.field === 'actual_finish') && l.newValue)
    .map((l) => ({ ref: l.ref, field: l.field as 'actual_start' | 'actual_finish', at: l.at, by: l.byName }));
  return {
    title: `${title} · ${kwDay(sh.from)} · ${sh.shift === 'D' ? 'Day' : 'Night'}`,
    banner: banner(eqs), totals: totals(steps, eqs, d.iats), stepsDone, stageChanges, activities,
    ...(() => { const ph = phases(d, now, steps); return { ops: ph.ops, mi: ph.mi }; })(),
    attention: attention(steps, eqs), ready: [...steps.values()].filter((v) => v.state === 'READY'),
    notes: log?.notes ?? '', temps: log?.temps ?? {},
    reactors: eqs.filter((e) => e.eq.group === 'Reactors' && e.eq.tracked).map((e) => {
      const n = (d.points ?? []).find((p) => p.kind === 'neut' && p.ref === e.eq.tag);
      return { tag: e.eq.tag, critical: e.eq.critical, stage: e.stage, hoAt: e.hoAt, neut: !n ? null : pointComplete(n) ? 'neutralized' : n.status === 'open' ? null : NEUT_LABEL[n.status].toLowerCase() };
    }),
    results: opsResults(d, eqs), blinds: miBlinds(d),
    shift: { date: sh.date, shift: sh.shift }, name: title,
    pointsDone: lastBy(inShift.filter((l) => l.kind === 'point')).filter((l) => l.newValue === 'in' || l.newValue === 'done')
      .map((l) => ({ ref: l.ref, kind: l.newValue === 'in' ? 'blind' as const : 'neut' as const })),
    blindLinesDone: d.activities.filter((a) => equipBlind(a) && a.actualFinish && ms(a.actualFinish) >= sh.from && ms(a.actualFinish) < sh.to).length,
  };
}

export const bannerText = (b: Banner) => `${b.state === 'ON_PLAN' ? 'ON PLAN' : b.state}${b.state !== 'ON_PLAN' && b.days ? ` ${b.state === 'BEHIND' ? '−' : '+'}${b.days} d` : ''}`;
const FLAG_TEXT: Record<string, string> = { HO_LATE: 'HO LATE', LATE: 'LATE', PENDING: 'Pending', IAT_OPEN: 'IAT open', STEP_LATE: 'LATE', STEP_PENDING: 'Pending' };
export const flagText = (f: string) => FLAG_TEXT[f] ?? f;

/** The WhatsApp message, the standard template of every shutdown (Train-1 / Train-2): a bold title between dividers,
 *  then short sections (overall progress, reactors, blinds, temperatures, changes this shift, attention) with WhatsApp
 *  formatting (*bold*), one item per line (no space-aligned columns: WhatsApp fonts are proportional). Delays and
 *  pending items are put first and marked red; the Report page and its PDF keep the details. */
const RULE = '━━━━━━━━━━━━━━━━━━';
export function reportText(r: ShiftReport, opts: { test?: boolean; by?: string } = {}): string {
  const mi = r.mi, res = r.results, b = r.blinds;
  const pct = (x: [number, number]) => `*${x[0]}/${x[1]}${x[1] ? ` (${Math.round((x[0] / x[1]) * 100)}%)` : ''}*`;
  const unit = r.name.match(/U-?\s?(\d+)/i)?.[1], train = r.name.match(/TR(?:AIN)?-?\s?(\d+)/i)?.[1];
  const title = unit || train ? `${unit ? `U-${unit}` : ''}${unit && train ? ' | ' : ''}${train ? `TRAIN-${train}` : ''} SHUTDOWN` : r.name.toUpperCase();
  const date = new Date(`${r.shift.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const NEUT_ICON: Record<string, string> = { filling: '💧 Filling', soaking: '🔄 Soaking', draining: '🚿 Draining', neutralized: '🧪 Neutralized' };
  const reactor = (x: ShiftReport['reactors'][number]) => {
    const tag = `*${x.tag.replace('R-12-', 'R-')}*${x.critical ? ' ⭐' : ''}`;
    const ho = x.stage >= 1 ? `HO${x.critical && x.hoAt ? ` ${kwTime(x.hoAt)}` : ''}` : '';
    if (x.stage === 0) return `${tag} ⏳ *Not handed over*${x.neut ? ` | ${NEUT_ICON[x.neut] ?? x.neut}` : ''}`;
    if (x.neut && x.neut !== 'neutralized') return `${tag} ${NEUT_ICON[x.neut] ?? x.neut} | ${ho}`;
    return `${tag} ${x.stage === 1 ? '✅ Handed over' : `🔧 ${STAGES[x.stage]}`}${x.critical && x.hoAt ? ` | HO ${kwTime(x.hoAt)}` : ''}`;
  };
  const out: string[] = [RULE, `*${opts.test ? '[TEST] ' : ''}${title}*`, `📅 ${date} | ${r.shift.shift === 'D' ? '☀️ Day Shift' : '🌙 Night Shift'}`, RULE];
  const section = (head: string, lines: string[]) => { if (lines.length) out.push('', `*${head}*`, ...lines, '', RULE); };
  const misLine = mi.actualStart === null ? [`🔧 M&I starts at *${mi.critical.map((c) => c.tag.replace('R-12-', 'R-')).join(', ') || 'critical'}* handover`]
    : mi.banner && mi.banner.items ? [`🔧 M&I Actual *${mi.banner.actualPct}%* | Planned *${mi.banner.planPct}%*`,
      mi.banner.state === 'BEHIND' ? `🔴 *BEHIND${mi.banner.days ? ` ${mi.banner.days} d` : ''}*` : mi.banner.state === 'AHEAD' ? `🟢 *AHEAD${mi.banner.days ? ` ${mi.banner.days} d` : ''}*` : '🟢 *ON SCHEDULE*']
    : ['🔧 M&I started'];
  section('📊 OVERALL PROGRESS', [res ? `✅ Handover ${pct(res.ho)}` : `✅ Handover *${r.totals.hoDone}/${r.totals.ho}*`, ...(res ? [`🧪 Neutralized ${pct(res.neut)}`] : []), ...misLine]);
  // delays and pending items come right after the overall progress, before the routine sections
  const top = r.attention.slice(0, 3).map((x) => `${x.flag === 'PENDING' || x.flag === 'STEP_PENDING' ? '🟠' : x.flag === 'IAT_OPEN' ? '🟡' : '🔴'} *${x.label}* ${flagText(x.flag)}${x.detail ? ` – ${x.detail}` : ''}`);
  section('⚠️ ATTENTION REQUIRED', r.attention.length ? [...top, ...(r.attention.length > 3 ? [`+${r.attention.length - 3} more in the app`] : [])] : []);
  section('⚗️ REACTOR STATUS', [...r.reactors].sort((x, y) => Number(x.critical) - Number(y.critical) || x.tag.localeCompare(y.tag)).map(reactor));
  section('🔒 BLIND INSTALLATION', b.segregation[1] + b.hp[1] + b.equipment[1] ? [`Segregation ${pct(b.segregation)}`, `HP Critical ${pct(b.hp)}`, `Equipment ${pct(b.equipment)}`] : []);
  section('🌡 MAX BED TEMPERATURE', REACTORS.filter((k) => r.temps[k]).map((k) => `R-${k.slice(1)} *${r.temps[k]}°F*`));
  const ho = r.stageChanges.filter((c) => c.from === 0 && c.to >= 1).map((c) => c.tag), moved = r.stageChanges.filter((c) => c.from >= 1 && c.to > c.from);
  const neutDone = r.pointsDone.filter((p) => p.kind === 'neut').map((p) => p.ref), blindsIn = r.pointsDone.filter((p) => p.kind === 'blind').length + r.blindLinesDone;
  section('🔄 CHANGES THIS SHIFT', [
    ...(ho.length ? [`✅ Handed over: *${ho.join(', ')}*`] : []),
    ...(neutDone.length ? [`🧪 Neutralized: *${neutDone.join(', ')}*`] : []),
    ...(blindsIn ? [`🔒 Blinds installed: *${blindsIn}*`] : []),
    ...(moved.length ? [`🔧 Moved on: *${moved.map((c) => `${c.tag} → ${STAGE_SHORT[c.to]}`).join(', ')}*`] : []),
    ...(r.stepsDone.length ? [`✔️ Guideline steps done: *${r.stepsDone.length}*`] : []),
  ]);
  section('📝 NOTES', r.notes.trim() ? [r.notes.trim()] : []);
  out.push(`*END OF SHIFT REPORT*${opts.by ? `\n— ${opts.by}` : ''}`, RULE);
  return out.join('\n');
}

// ── Mechanical activity timing (plan vs actual, for future shutdowns) ───────────────────────────────────────────
export type TimingState = 'NOT_STARTED' | 'RUNNING' | 'FINISHED';
export interface Timing {
  a: TrkActivity; state: TimingState;
  plannedH: number | null;
  /** hours from the actual start to the finish (or to now while it runs) */
  actualH: number | null;
  /** actual start less the planned start, h (+ late) */
  startDelayH: number | null;
  /** actual duration less the planned duration, h (+ longer) */
  overrunH: number | null;
  /** planned to have started (or finished) by now and has not */
  lateStart: boolean; lateFinish: boolean;
}
const r1 = (x: number) => Math.round(x * 10) / 10;
export function timing(a: TrkActivity, now: number): Timing {
  const ps = ms(a.start), pf = ms(a.finish), as = ms(a.actualStart), af = ms(a.actualFinish);
  const plannedH = !Number.isNaN(ps) && !Number.isNaN(pf) ? r1((pf - ps) / H) : a.durationH ?? null;
  const state: TimingState = !Number.isNaN(af) ? 'FINISHED' : !Number.isNaN(as) ? 'RUNNING' : 'NOT_STARTED';
  const actualH = Number.isNaN(as) ? null : r1(((Number.isNaN(af) ? now : af) - as) / H);
  return {
    a, state, plannedH, actualH,
    startDelayH: Number.isNaN(as) || Number.isNaN(ps) ? null : r1((as - ps) / H),
    overrunH: state === 'FINISHED' && actualH !== null && plannedH !== null ? r1(actualH - plannedH) : null,
    lateStart: state === 'NOT_STARTED' && !Number.isNaN(ps) && now > ps,
    lateFinish: state !== 'FINISHED' && !Number.isNaN(pf) && now > pf,
  };
}
export interface TimingSummary { total: number; started: number; finished: number; running: number; avgStartDelayH: number | null; avgOverrunH: number | null }
export function timingSummary(ts: Timing[]): TimingSummary {
  const avg = (xs: number[]) => (xs.length ? r1(xs.reduce((t, x) => t + x, 0) / xs.length) : null);
  return { total: ts.length, started: ts.filter((t) => t.state !== 'NOT_STARTED').length, finished: ts.filter((t) => t.state === 'FINISHED').length, running: ts.filter((t) => t.state === 'RUNNING').length,
    avgStartDelayH: avg(ts.flatMap((t) => (t.startDelayH === null ? [] : [t.startDelayH]))), avgOverrunH: avg(ts.flatMap((t) => (t.overrunH === null ? [] : [t.overrunH]))) };
}
const kwFull = (iso: string | null | undefined) => (iso ? new Date(Date.parse(iso) + KW).toISOString().slice(0, 16).replace('T', ' ') : '');
/** The record for future reference: one line per activity, plan and actual (Kuwait time), as CSV. */
export function timingCsv(ts: Timing[]): string {
  const q = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['equipment', 'activity_id', 'activity', 'stage', 'planned_start', 'planned_finish', 'planned_h', 'actual_start', 'actual_finish', 'actual_h', 'start_delay_h', 'overrun_h', 'note', 'by'];
  return [head.join(','), ...ts.map((t) => [t.a.key, t.a.activityId, t.a.activity, t.a.stage, kwFull(t.a.start), kwFull(t.a.finish), t.plannedH, kwFull(t.a.actualStart), kwFull(t.a.actualFinish),
    t.state === 'FINISHED' ? t.actualH : '', t.startDelayH, t.overrunH, t.a.actualNote, t.a.updatedBy].map(q).join(','))].join('\n');
}

// ── Step timing (estimate vs actual) ───────────────────────────────────────────────────────────────────────────
export interface StepTiming { s: TrkStep; estH: number | null; actualH: number | null; overrunH: number | null; running: boolean }
export function stepTiming(s: TrkStep, now: number): StepTiming {
  const a = ms(s.startedAt), d = ms(s.doneAt);
  const running = !Number.isNaN(a) && Number.isNaN(d);
  const actualH = Number.isNaN(a) ? null : r1(((Number.isNaN(d) ? now : d) - a) / H);
  return { s, estH: s.estHours, actualH, running, overrunH: !running && actualH !== null && s.estHours !== null ? r1(actualH - s.estHours) : null };
}
export function stepTimingCsv(ts: StepTiming[]): string {
  const q = (v: unknown) => { const x = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const head = ['step', 'fo', 'gate', 'name', 'procedure', 'est_h', 'started', 'done', 'actual_h', 'overrun_h', 'remark'];
  return [head.join(','), ...ts.map((t) => [t.s.stepId, t.s.fo, t.s.gate, t.s.shortName, t.s.procedure, t.estH, kwFull(t.s.startedAt), kwFull(t.s.doneAt), t.running ? '' : t.actualH, t.overrunH, t.s.remark].map(q).join(','))].join('\n');
}

// ── The two parts of the shutdown: operations (guideline steps) and M & I (bar chart) ──────────────────────────
// Operations ends, and M & I starts, when the critical item(s) (R-12-205) are handed over: blinded = handed over (their handover step done, the stage tap or the blind line).
export interface OpsProgress { state: Banner['state'] | 'NOT_STARTED' | 'DONE'; planPct: number; actualPct: number; day: number; days: number; offDays: number; start: number; end: number;
  /** when operations finished (the critical handover), and its difference from the plan in hours (+ late) */
  finishedAt: number | null; finishDelayH: number | null }
export interface MiPhase {
  /** the planned M & I start (bar chart) and the actual one (the critical handover) */
  planned: number; actualStart: number | null; delayH: number | null;
  /** the critical items and their handover steps that start it */
  critical: { tag: string; hoStep: string | null; done: boolean }[];
  /** plan vs actual from the actual start (the bar chart shifted by the start delay) */
  banner: Banner | null;
  /** the planned end (bar chart) and the end expected now: shifted by the start delay and by the days behind / ahead */
  plannedEnd: number; estEnd: number | null;
}
export interface Phases { ops: OpsProgress | null; mi: MiPhase }

/** The critical handover: every tracked critical item blinded = handed over; the time is the last of them. */
export function criticalHandover(d: TrkData, steps: Map<string, StepView>): { at: number | null; critical: MiPhase['critical'] } {
  const crit = d.equipment.filter((e) => e.critical && e.tracked);
  const stepDone = (e: TrkEquipment) => !!e.hoStep && steps.get(e.hoStep)?.state === 'DONE';
  const critical = crit.map((e) => ({ tag: e.tag, hoStep: e.hoStep, done: e.stage >= 1 || stepDone(e) }));
  if (!critical.length || critical.some((c) => !c.done)) return { at: null, critical };
  const times = crit.map((e) => { const st = e.hoStep ? steps.get(e.hoStep)?.step : undefined; return ms(e.blindsIn ?? st?.doneAt ?? st?.updatedAt ?? null); }).filter((x) => !Number.isNaN(x));
  return { at: times.length ? Math.max(...times) : null, critical };
}

/** The operations results: neutralization (before handover) done and operations items handed over. */
export function opsResults(d: TrkData, eqs: EquipView[]): { done: number; total: number; neut: [number, number]; ho: [number, number] } | null {
  const pts = d.points ?? [];
  if (!pts.length) return null;
  const n = pts.filter((p) => p.kind === 'neut' && p.beforeHo), o = eqs.filter((e) => e.eq.opsItem && e.eq.tracked);
  const neut: [number, number] = [n.filter(pointComplete).length, n.length], ho: [number, number] = [o.filter((e) => e.stage >= 1).length, o.length];
  return { done: neut[0] + ho[0], total: neut[1] + ho[1], neut, ho };
}
/** The blinds installed by M & I: segregation and HP critical points, and the items' blind lines (equipment). */
export function miBlinds(d: TrkData): { segregation: [number, number]; hp: [number, number]; equipment: [number, number] } {
  const pts = (d.points ?? []).filter((p) => p.kind === 'blind');
  const c = (xs: { done: boolean }[]): [number, number] => [xs.filter((x) => x.done).length, xs.length];
  return {
    segregation: c(pts.filter((p) => p.grp !== 'hp_critical').map((p) => ({ done: pointComplete(p) }))),
    hp: c(pts.filter((p) => p.grp === 'hp_critical').map((p) => ({ done: pointComplete(p) }))),
    equipment: c(d.activities.filter(equipBlind).map((a) => ({ done: !!a.actualFinish }))),
  };
}

export function opsProgress(steps: Map<string, StepView>, s: TrkSettings, now: number, finishedAt: number | null = null, results: { done: number; total: number } | null = null): OpsProgress | null {
  const start = ms(s.opsStart), end = ms(s.miStart ?? s.hoTarget);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  // measured by the results (blinds, neutralization, handovers), the guideline steps when there are none
  const sv = [...steps.values()].filter((v) => v.state !== 'NA');
  const actual = results && results.total ? results.done / results.total : sv.length ? sv.filter((v) => v.state === 'DONE').length / sv.length : 0;
  const t = finishedAt ?? now;
  const plan = Math.min(1, Math.max(0, (t - start) / (end - start)));
  const day = Math.max(1, Math.floor((t - start) / DAY) + 1), days = Math.max(Math.round((end - start) / DAY), day);
  const state = finishedAt !== null ? 'DONE' : now < start ? 'NOT_STARTED' : actual >= plan + 0.05 ? 'AHEAD' : actual < plan - 0.05 ? 'BEHIND' : 'ON_PLAN';
  return { state, planPct: Math.round(plan * 100), actualPct: Math.round(actual * 100), day, days, offDays: r1((actual - plan) * (end - start) / DAY), start, end,
    finishedAt, finishDelayH: finishedAt !== null ? r1((finishedAt - end) / H) : null };
}
/** The planned M & I start (bar chart). */
export function miStart(s: TrkSettings): number { return ms(s.miStart ?? s.hoTarget); }

/** Both parts at a moment: operations until the critical handover, M & I from it (its plan shifted by the start delay). */
export function phases(d: TrkData, now: number, steps = stepViews(d, now)): Phases {
  const ho = criticalHandover(d, steps);
  const planned = miStart(d.settings);
  const started = ho.at !== null && ho.at <= now ? ho.at : null;
  const delay = started !== null && !Number.isNaN(planned) ? started - planned : 0;
  // M & I counts only the items handed over to it, each measured from its own handover
  const bn = started !== null ? banner(equipViews(d, now, steps).filter((e) => e.stage >= 1)) : null;
  const plannedEnd = ms(d.settings.miEnd);
  return {
    ops: opsProgress(steps, d.settings, now, started, opsResults(d, equipViews(d, now, steps))),
    mi: { planned, actualStart: started, delayH: started !== null && !Number.isNaN(planned) ? r1(delay / H) : null, critical: ho.critical, banner: bn,
      plannedEnd, estEnd: Number.isNaN(plannedEnd) ? null : plannedEnd + delay + (bn && bn.state !== 'ON_PLAN' ? (bn.state === 'BEHIND' ? 1 : -1) * bn.days * DAY : 0) },
  };
}
