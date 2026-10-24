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
  /** items worked as one (E-12-216A/B): one row in the list, a step started / finished on all of them */
  combine?: string | null;
}
export interface TrkIat { id: string; tag: string; iatNo: string; jobText: string | null; discipline: string | null; issuedAt: string; status: 'open' | 'closed'; closedAt: string | null;
  /** from the daily IAT tracking sheet: work order, the line it is on, the status as written in the sheet, a remark */
  wo?: string | null; line?: string | null; sheetStatus?: string | null; remark?: string | null;
  finding?: string | null; recommendation?: string | null; lineClass?: string | null; material?: string | null; checks?: Record<string, string>; painting?: Record<string, string>; actionBy?: string | null;
  /** ticked by a person: Operations action needed, handover needed */
  opsAction?: boolean; hoRequired?: boolean;
  /** no action from Operations · spool drop only (no handover procedure, no blind list) */
  opsNone?: boolean; spoolOnly?: boolean;
  /** the operations label, shown in colour: painting (nothing needed) · spool to drop · ready for handover · ops in progress */
  opsLabel?: IatLabel | null;
  /** the last change to the row: who, when */
  updatedBy?: string | null; updatedAt?: string | null }
export type IatLabel = 'painting' | 'spool' | 'ready' | 'progress';
export const IAT_LABELS: [IatLabel, string][] = [['painting', '🎨 Painting'], ['spool', '🔧 Spool to drop'], ['ready', '✅ Ready for HO'], ['progress', '▶ Ops I/P']];
/** The IAT statuses of the tracking sheet, set in the app; Completed and Cancelled close the IAT. */
export const IAT_STATUSES = ['New IAT', 'To start', 'In progress', 'Hold', 'Completed', 'Cancelled'] as const;
export const iatClosedBy = (s: string) => s === 'Completed' || s === 'Cancelled';
export interface TrkActivity {
  id: string; activityId: string; group: string | null; key: string; activity: string; durationH: number | null; start: string | null; finish: string | null; stage: number | null; tracked: boolean;
  /** the mechanical activity as it went (kept for future shutdowns) */
  actualStart?: string | null; actualFinish?: string | null; actualNote?: string | null; updatedBy?: string | null; updatedAt?: string | null;
  /** the place set by hand in the item's list (null = the plan order) · a field-operator detail step, hidden for the Section Head */
  seq?: number | null; detail?: boolean;
  /** the P6 text of a bar-chart line renamed in the field */
  p6Activity?: string | null;
}
export interface TrkLog { kind: 'step' | 'equipment' | 'iat' | 'activity' | 'point' | 'event' | 'qty' | 'shift'; ref: string; field: string; oldValue: string | null; newValue: string | null; byName: string | null; at: string }
import { qtyForecast, qtyProgress, type TrkEngine } from './qty';
export * from './qty';
export interface TrkSettings { hoTarget?: string; end?: string; workOrder?: string; whatsapp?: string; opsStart?: string; miStart?: string; miEnd?: string;
  /** the progress engine (drums, updates) on this tracker, and its forecast window / freshness rules */
  progressV2?: boolean; fcWindow?: number; fcMin?: number; staleH?: number; miscDays?: number }
/** A critical blind (segregation point) or a neutralization (loop or item), entered once on the Isolation page. */
export type PointStatus = 'open' | 'in' | 'out' | 'filling' | 'soaking' | 'draining' | 'done';
export interface TrkPoint {
  id: string; kind: 'blind' | 'neut';
  /** a blind: segregation or HP critical (installed by M & I) */
  grp: 'segregation' | 'hp_critical' | null; ref: string; name: string; detail: string | null; fo: string | null; stepId: string | null; items: string[];
  /** the blinds (refs) that must be in before this neutralization can start */
  requires?: string[];
  /** how a neutralization is done: soak (fill, soak, drain) or spray (start, done: heater tube OD after the burners stop) */
  method?: 'soak' | 'spray';
  /** the main items this loop is a part of, neutralized on its own (R-205 addition / withdrawal / quench lines, the piping between the reactors) */
  partOf?: string[];
  /** the work steps (activity ids on its items) that must be finished before it starts: the reactor body spray after the catalyst dumping */
  afterActs?: string[];
  /** a neutralization the item's handover waits for */
  beforeHo: boolean; sort: number; status: PointStatus;
  inAt: string | null; outAt: string | null; fillAt: string | null; soakAt: string | null; drainAt: string | null; doneAt: string | null;
  soakH: number | null; remark: string | null; updatedBy: string | null; updatedAt: string | null;
  /** on hold, with its reason (resumed = null) */
  holdReason?: string | null; holdAt?: string | null;
}
/** A main field step of a neutralization (from its SOP): before filling, while filling, or after. */
export interface TrkPointStep { id: string; pointId: string; seq: number; phase: 'before' | 'fill' | 'after'; text: string; source: string | null; doneAt: string | null; doneBy: string | null;
  /** a critical step that needs a crane (control valves dropped) */
  crane: boolean;
  /** a timed field job (crane, blinding, elbows / spools): started and finished; the rest are ticks */
  kind: 'check' | 'step'; startAt: string | null; startBy: string | null;
  /** the equipment work steps this field step is (same physical work): its state is theirs */
  linkActs?: string[];
  /** segregation blinds it is the same work as ("Blinds in: …"): done when they are all in */
  linkPoints?: string[] }
/** An event of the shutdown not tied to one item: nitrogen supply, an issue common to the reactors, other. */
export interface TrkEvent { id: string; category: 'nitrogen' | 'reactors' | 'other'; text: string; startedAt: string; endedAt: string | null; by: string | null; endedBy: string | null;
  /** the item a problem is on (its bar-chart key); none for an event of the shutdown */
  key?: string | null }
export const EVENT_LABEL: Record<TrkEvent['category'], string> = { nitrogen: 'N₂ supply', reactors: 'Reactors', other: 'Other' };
export interface TrkData { events?: TrkEvent[]; engine?: TrkEngine; pointSteps?: TrkPointStep[]; lineup?: LuStream[]; lineupEq?: LuEquip[]; steps: TrkStep[]; equipment: TrkEquipment[]; iats: TrkIat[]; activities: TrkActivity[]; log: TrkLog[]; settings: TrkSettings; points?: TrkPoint[] }

/** The main equipment groups; the rest (control valve shells, PSVs, check valves, RTJ & injection points, piping, OPR
 *  list, PMRs …) is miscellaneous, shown after them. */
export const MAIN_GROUPS = ['Reactors', 'Heaters', 'Exchangers', 'Vessels', 'Filters', 'Compressor', 'Pumps / LO'] as const;
export const isMisc = (group: string) => !(MAIN_GROUPS as readonly string[]).includes(group);
/** Small jobs in the M & I progress: the miscellaneous groups and the pumps' lube oil work (short jobs that the bar
 *  chart plans as long windows, Section Head decision 23 Oct), counted apart from the main equipment. */
export const isSmallJob = (group: string) => isMisc(group) || group === 'Pumps / LO';
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
/** A field step linked to work steps or blinds (the same physical work, e.g. a control valve dropped in two procedures,
 *  a blind also in the segregation list) takes their state: started when one is, done when all are; otherwise its own. */
export function linkedStep(c: TrkPointStep, acts: TrkActivity[], points: TrkPoint[] = []): TrkPointStep {
  const la = acts.filter((a) => (c.linkActs ?? []).includes(a.id)), lp = points.filter((p) => (c.linkPoints ?? []).includes(p.id));
  if (!la.length && !lp.length) return c;
  const ends = [...la.map((a) => a.actualFinish ?? null), ...lp.map((p) => (p.status === 'in' || p.status === 'out' ? p.inAt ?? p.updatedAt ?? '' : null))];
  const fin = ends.every(Boolean) ? (ends as string[]).sort().slice(-1)[0] || null : null;
  const st = [...la.map((a) => a.actualStart), ...lp.map((p) => p.inAt), c.startAt].filter(Boolean).sort()[0] ?? null;
  const by = fin ? la.find((a) => a.actualFinish === fin)?.updatedBy ?? lp.find((p) => p.inAt === fin)?.updatedBy ?? null : null;
  return { ...c, startAt: st, doneAt: fin, doneBy: by, startBy: null };
}
/** Other lists' work on the same tag (the OPR list's "FV-1426 d/s check valve servicing" on the FV-1426 d/s item, the
 *  LV-553B passing on the LV-0553B control valve): shown on the item, each keeping its own status. */
const OWN_ITEM = /^([A-Z]{1,4}-12-\d|12-[A-Z]{1,4}-\d)/i;
export function relatedWork(tag: string, key: string, acts: TrkActivity[]): TrkActivity[] {
  // the unit number is not the item number: V-12-201 is V-201 (12-PSV-0519 is PSV-0519)
  // a part keeps its part (P-12-203-E-01A is P-203-E-01A, not the pump)
  const m = tag.replace(/^12-/, '').replace(/^([A-Z]{1,4})-12-/i, '$1-').match(/^([A-Z]{1,4})-0*(\d{2,4}[A-Z]?)((?:-[A-Z0-9]+)*)(?![0-9A-Z])/i); if (!m) return [];
  const re = new RegExp(`\\b${m[1]}[- ]?(12-)?0*${m[2]}${m[3]}(?![0-9A-Z]|-[A-Z]{1,3}-?\\d)`, 'i');
  // only the work in the lists (OPR list, PMRs, site services …) whose own words name the item: another piece of
  // equipment (V-12-202, C-12-201-ST, R-12-205) has its own sheet, and a list named after several items
  // (P-203/205 HT motors) is not all about this one
  return acts.filter((a) => a.key !== key && a.tracked && !a.detail && !OWN_ITEM.test(a.key) && re.test(a.activity));
}
/** Valves and PSVs taken out with their own steps (control valves, check valves, PSVs): not in the blind list. */
export const VALVE_KEY = /^12-(PSV|VC|HV|LV|FV|TV|PV|PCV|FCV|XV)-/i;
export const equipBlind = (a: Pick<TrkActivity, 'activity' | 'stage' | 'tracked' | 'group' | 'key'>) => a.tracked && a.stage === 1 && a.group !== 'Operations' && !VALVE_KEY.test(a.key) && /blind/i.test(a.activity) && !/deblind|de-blind|remove blind/i.test(a.activity);
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
/** The reactor body spray (after the catalyst dumping): part of the reactor's own work, shown with the reactor only. */
export const withReactor = (p: Pick<TrkPoint, 'afterActs'>) => (p.afterActs ?? []).length > 0;
export const pointComplete = (p: Pick<TrkPoint, 'kind' | 'status'>) => (p.kind === 'blind' ? p.status === 'in' || p.status === 'out' : p.status === 'done');
export const NEUT_FLOW = ['open', 'filling', 'soaking', 'draining', 'done'] as const;
export const NEUT_LABEL: Record<string, string> = { open: 'Not started', filling: 'Filling', soaking: 'Soaking', draining: 'Draining', done: 'Neutralized' };
/** A neutralization's state in words: a sprayed one is "Spraying" while it runs. */
export const neutLabel = (p: Pick<TrkPoint, 'status' | 'method'>) => (p.method === 'spray' && p.status !== 'open' && p.status !== 'done' ? 'Spraying' : NEUT_LABEL[p.status]);
/** What a neutralization is called on an item: its loop, the item's own soda ash, or its sprayed tube OD. */
export const neutName = (p: Pick<TrkPoint, 'stepId' | 'ref' | 'method'>) => (p.stepId ? p.ref : / body$/.test(p.ref) ? 'Body spray' : p.method === 'spray' ? 'Tube OD spray' : /^R-12-/.test(p.ref) ? 'Catalyst soak' : /^[A-Z]{1,3}-12-/.test(p.ref) ? 'Soda ash' : p.ref);
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
/** The work steps a neutralization still waits for (names, not finished yet), empty when it can start. */
export function waitingSteps(p: Pick<TrkPoint, 'afterActs' | 'items'>, acts: TrkActivity[] = []): string[] {
  const ids = p.afterActs ?? [];
  return ids.length ? [...new Set(acts.filter((a) => ids.includes(a.activityId) && p.items.includes(a.key) && !a.actualFinish).map((a) => a.activity))] : [];
}
/** The loops neutralized on their own that are parts of a main item (a reactor's lines, the piping between reactors). */
export const partsOf = (tag: string, points: TrkPoint[] = []) => points.filter((p) => p.kind === 'neut' && (p.partOf ?? []).includes(tag));
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
  if (running.length) return { state: 'neut', why: `Neutralizing ${running.map((p) => `${p.ref} · ${neutLabel(p)}`).join(', ')}`, missing, loops };
  if (missing.length) return { state: 'blind', why: `🔒 ${missing.join(', ')} not in`, missing, loops };
  if (!open.length) return { state: 'ready', why: loops.length ? `Neutralized ${loops.map((p) => p.ref).join(', ')} → hand over` : 'Blinds in → hand over', missing, loops };
  return { state: 'idle', why: `Waiting ${open.map((p) => p.ref).join(', ')} (not started)`, missing, loops };
}

export function planVsActual(acts: TrkActivity[], actual: number, now: number): PlanVsActual | null {
  const list = acts.filter((a) => a.tracked && a.stage !== null && a.start && a.group !== 'Operations');
  if (!list.length) return null;
  // a line counts for its stage once planned to finish, as the actual stage moves when a step is finished
  const started = list.filter((a) => (a.finish ? ms(a.finish) : ms(a.start) + (a.durationH ?? 0) * H) <= now);
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

// ── Stage review ─────────────────────────────────────────────────────────────────────────────────────────────
/** Items whose stage and finished steps disagree, for a person to review. Nothing is changed automatically, and a
 *  finished step never stands for a formal handover:
 *  - `ho_missing`: blinded, or work after handover started, but the item is not handed over (to confirm the normal way);
 *  - `behind`: handed over, and the finished steps reach a later stage than the item shows;
 *  - `ahead`: the item shows a later stage than its finished steps (often fine: work done outside the bar chart);
 *  - `no_stage`: started work whose steps carry no stage, so the stage cannot follow them. */
export type StageIssue = 'ho_missing' | 'behind' | 'ahead' | 'no_stage';
export interface StageReviewItem { eq: TrkEquipment; issue: StageIssue; stage: number; steps: number | null; done: number; total: number }
export function stageReview(d: TrkData, eqs: EquipView[]): StageReviewItem[] {
  const out: StageReviewItem[] = [];
  for (const v of eqs) {
    if (!v.eq.tracked) continue;
    const key = v.eq.barchartKey ?? v.eq.tag;
    const xs = d.activities.filter((a) => a.key === key && a.tracked && !a.detail && a.group !== 'Operations');
    if (!xs.length) continue;
    const fin = xs.filter((a) => a.actualFinish);
    const staged = fin.filter((a) => a.stage != null && a.stage >= 2 && a.stage <= 6).map((a) => a.stage!);
    const steps = staged.length ? Math.max(...staged) : null;
    const base = { eq: v.eq, stage: v.stage, steps, done: fin.length, total: xs.length };
    // not handed over, but blinded (a finished stage-1 line) or work after handover started
    const blinded = fin.some((a) => a.stage === 1), work = xs.some((a) => a.actualStart && (a.stage ?? 0) >= 2);
    if (v.stage === 0 && (blinded || work)) out.push({ ...base, issue: 'ho_missing' });
    else if (steps != null && v.stage >= 1 && steps > v.stage) out.push({ ...base, issue: 'behind' });
    else if (steps != null && v.stage >= 2 && v.stage < 6 && v.stage > steps) out.push({ ...base, issue: 'ahead' });
    else if (xs.some((a) => a.actualStart) && xs.every((a) => a.stage == null)) out.push({ ...base, issue: 'no_stage' });
  }
  const rank: Record<StageIssue, number> = { ho_missing: 0, behind: 1, ahead: 2, no_stage: 3 };
  return out.sort((a, b) => rank[a.issue] - rank[b.issue] || a.eq.sort - b.eq.sort);
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
    return { text: m.length ? `🔒 Blinds for ${p.ref}: ${m.join(', ')}` : `Neutralize ${p.ref} · ${neutLabel(p)}`, running: p.status !== 'open', n: 0, of: 0 }; }
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

// ── IATs ───────────────────────────────────────────────────────────────────────────────────────────────────────
const IAT_CHECKS: [string, string][] = [['prefab', 'Prefabrication'], ['excavation', 'Excavation'], ['lpt', 'LPT'], ['xray', 'X-ray'], ['pwht', 'PWHT'], ['hardness', 'Hardness'], ['hydro', 'Hydro test'], ['service', 'Service test']];
/** The inspection checks the IAT sheet asks for, in order: label and the sheet's mark (REQ, IF REQ, done …); the hydro
 *  test carries its pressure (from the sheet, else from the recommendation). */
export function iatChecks(i: Pick<TrkIat, 'checks' | 'recommendation'>): { key: string; label: string; mark: string; optional: boolean }[] {
  const c = i.checks ?? {};
  return IAT_CHECKS.filter(([k]) => c[k]).map(([k, label]) => {
    const raw = c[k].replace(/\s+/g, ' ').trim(); const p = raw.match(/(\d{2,5})/)?.[1] ?? (k === 'hydro' ? i.recommendation?.match(/hydro\s*test[^\d]{0,40}(\d{2,5})\s*psig/i)?.[1] : undefined);
    return { key: k, label: k === 'hydro' && p ? `Hydro ${p} psig` : label, mark: raw.replace(/\d{2,5}/, '').trim() || 'REQ', optional: /if\s*req/i.test(raw) };
  });
}
export const iatStatus = (i: Pick<TrkIat, 'sheetStatus' | 'status'>) => i.sheetStatus ?? (i.status === 'open' ? 'New IAT' : 'Completed');

// ── Process lineup (P&ID) ──────────────────────────────────────────────────────────────────────────────────────
/** One P&ID connection of the U-12 lineup: from → to, the fluid, the line numbers on it and the P&ID sheets. */
export interface LuStream { id: string; from: string; to: string; fluid: string | null; line: string | null; lineNos: string[]; sheets: string[]; size: string | null; conf: string | null }
/** The lineup form of a tracker tag (E-12-229 → E-229, R-205 stays), and a lineup tag's keys (E-216A/B → E-216A, E-216B, E-216). */
export const luTag = (tag: string) => tag.replace(/^([A-Z]{1,3})-12-(\d{3})/, '$1-$2').trim();
export function luKeys(tag: string): string[] {
  const t = tag.replace(/^(HDR|BL|BL-TR2):\s*/, '').trim(); const m = t.match(/^([A-Z]{1,3}-\d{3})([A-Z](?:[/-][A-Z])*)?\b/);
  if (!m) return [t];
  const base = m[1], suf = m[2] ?? '';
  const letters = suf.includes('-') ? (() => { const [a, b] = suf.split('-'); const r: string[] = []; for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c++) r.push(String.fromCharCode(c)); return r; })() : suf.split('/').filter(Boolean);
  return [base, ...letters.map((l) => base + l)];
}
const sameTag = (lineupTag: string, tag: string) => luKeys(lineupTag).includes(luTag(tag));
/** A lineup equipment item: its tag, the tracker tag, name, data block (vents and trim lines are named there) and P&ID sheet. */
export interface LuEquip { tag: string; plantTag: string | null; name: string | null; data: string | null; sheet: string | null }
/** A line named in an equipment data block (a vent or trim line, e.g. VT-12-2018 on V-212), with the words before it. */
export function lineOnEquipment(line: string | null | undefined, eqs: LuEquip[] = []): { eq: LuEquip; what: string }[] {
  if (!line) return [];
  return eqs.flatMap((e) => { const i = (e.data ?? '').indexOf(line); if (i < 0) return [];
    const before = (e.data ?? '').slice(0, i).split(/[;,]/).pop()?.trim() ?? ''; return [{ eq: e, what: before || 'line' }]; });
}
/** Where a line is in the unit: the lineup connections carrying that line number. */
export const lineStreams = (line: string | null | undefined, lu: LuStream[] = []) => (line ? lu.filter((s) => s.lineNos.includes(line)) : []);
/** The tracker items at either end of a connection. */
export const streamItems = (s: LuStream, tags: string[]) => tags.filter((t) => sameTag(s.from, t) || sameTag(s.to, t));
/** An item's connections in the P&ID lineup (the unit map): what comes in, what goes out, with fluid and line. */
export const connectionsOf = (tag: string, lu: LuStream[] = []) => ({
  from: lu.filter((x) => sameTag(x.to, tag)).map((x) => ({ other: x.from, fluid: x.fluid, line: x.lineNos[0] ?? x.line })),
  to: lu.filter((x) => sameTag(x.from, tag)).map((x) => ({ other: x.to, fluid: x.fluid, line: x.lineNos[0] ?? x.line })) });
/** The IATs of an item: its own, and those on a line that runs to or from it (P&ID lineup); open first. */
export const iatsOf = (tag: string, iats: TrkIat[], lu: LuStream[] = []) => iats
  .filter((i) => i.tag === tag || lineStreams(i.line, lu).some((s) => streamItems(s, [tag]).length > 0))
  .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || a.iatNo.localeCompare(b.iatNo));
/** The lineup lines a neutralization loop covers: the connections between two of its equipment (an item named
 *  "R-205 to E-229" counts both ends), the line numbers on them. */
export function loopLines(p: Pick<TrkPoint, 'items' | 'name'>, lu: LuStream[] = []): { lines: string[]; streams: LuStream[] } {
  const ends = new Set<string>();
  for (const it of [...p.items, p.name]) for (const m of it.matchAll(/\b([A-Z]{1,3})-(?:12-)?(\d{3}[A-Z]?)\b/g)) ends.add(`${m[1]}-${m[2]}`);
  const has = (x: string) => luKeys(x).some((k) => ends.has(k));
  const streams = lu.filter((s) => has(s.from) && has(s.to));
  return { lines: [...new Set(streams.flatMap((s) => s.lineNos))].sort(), streams };
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
  /** when the report was made, and one status line per item (by section) and per open neutralization loop */
  at: number; items: ReportItem[]; loops: { ref: string; name: string; line: string; running: boolean; started: boolean }[];
  /** segregation / HP-critical blinds not in yet */
  blindsOpen: { ref: string; name: string }[];
  /** catalyst removal by drums: each reactor dumping (or emptied this shift), its verified total and this shift's drums */
  drums: { key: string; verified: number; working: number | null; pct: number | null; shift: number; pending: number; empty: boolean }[];
  /** PSVs: removed / installed of all, and what moved this shift or runs now */
  psvs: { total: number; removed: number; installed: number; lines: string[] };
  /** the shutdown's events (nitrogen, reactors): open ones, and those ended this shift */
  events: { category: string; text: string; open: boolean; hours: number; tag: string | null; since: string }[];
}
export type ReportSection = 'Reactors' | 'Heaters' | 'Exchangers' | 'Vessels' | 'Others';
export interface ReportItem { tag: string; section: ReportSection; line: string }
const SECTION: Record<string, ReportSection> = { Reactors: 'Reactors', Heaters: 'Heaters', Exchangers: 'Exchangers', 'Air coolers': 'Exchangers', Vessels: 'Vessels', Filters: 'Others', Compressor: 'Others', 'Pumps / LO': 'Others' };
const STAGE_WORDS = ['Not handed over', 'Handed over', 'Opened / cleaning', 'Under inspection', 'Under repair', 'Box-up', 'Returned'];
const NEUT_WORDS: Record<string, string> = { filling: 'Soda ash filling I/P', soaking: 'Under soaking', draining: 'Soda ash draining I/P' };
/** An item's status in the plant's words: the logbook remark of the last day, else what runs now, else its own
 *  neutralization, else its isolation state or stage; a pending reason is added when the line does not say it. */
/** A bar-chart step in the plant's words: Title Case P6 text in sentence case (tags, codes and units kept) and the
 *  P6 short forms spelled out. */
const P6_WORDS: Record<string, string> = { suc: 'suction', disch: 'discharge', stainer: 'strainer', comp: 'compressor', exch: 'exchanger', insp: 'inspection' };
export function tidyStep(text: string): string {
  const ws = text.trim().split(/\s+/), words = ws.filter((w) => /^[A-Za-z]{3,}$/.test(w));
  const title = words.length >= 2 && words.filter((w) => /^[A-Z][a-z]/.test(w)).length >= words.length * 0.6;
  return ws.map((w, i) => {
    const bare = w.replace(/[^A-Za-z]/g, '').toLowerCase(); const full = P6_WORDS[bare];
    if (full) return w.replace(/[A-Za-z]+/, i === 0 ? full[0].toUpperCase() + full.slice(1) : full);
    // a tag, a code or an abbreviation (V-209, N2, I/P, PSV) stays as written
    if (!title || i === 0 || /[\d\-/]/.test(w) || /^[A-Z]{2,}[^a-z]*$/.test(w)) return w;
    return w.toLowerCase();
  }).join(' ');
}
/** An item's note still says how it is: set in the last day and not older than its latest step start / finish. */
/** How long a step took (or has been running), in words: "45 min", "6 h", "1 d 3 h"; '' when start and finish
 *  are under 10 minutes apart (ticked straight to done, so no real time was recorded). */
export function spanText(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return '';
  const m = Math.round((Date.parse(end) - Date.parse(start)) / 60000);
  if (m < 10) return '';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}`;
}

export function noteCurrent(e: TrkEquipment, d: TrkData, now: number): boolean {
  if (!e.remark?.trim() || !e.updatedAt) return false;
  const at = ms(e.updatedAt); if (now - at >= DAY) return false;
  const key = e.barchartKey ?? e.tag;
  const steps = d.activities.filter((a) => a.key === key && a.tracked && !a.detail).flatMap((a) => [ms(a.actualStart), ms(a.actualFinish)]).filter((x) => !Number.isNaN(x) && x <= now);
  return !steps.length || Math.max(...steps) <= at + 10 * 60000;
}
export function itemStatusLine(e: EquipView, d: TrkData, now: number): string {
  const key = e.eq.barchartKey ?? e.eq.tag; const pts = d.points ?? [];
  const recent = noteCurrent(e.eq, d, now);
  const running = sortActs(d.activities.filter((a) => a.key === key && a.tracked && !a.detail && a.actualStart && !a.actualFinish && !(a.group === 'Operations' && /neutrali|soak/i.test(a.activity)))).map((a) => tidyStep(a.activity));
  const own = pts.find((p) => p.kind === 'neut' && !p.stepId && p.items.includes(e.eq.tag) && p.status !== 'open' && !pointComplete(p));
  const iso = e.stage === 0 ? isoState(e.eq.tag, 0, pts) : null;
  let line = recent ? e.eq.remark!.trim()
    : running.length ? `${running.slice(0, 2).join(', ')} I/P`
    : own ? (own.method === 'spray' ? (/ body$/.test(own.ref) ? 'Body spraying I/P' : 'Spraying I/P') : NEUT_WORDS[own.status] ?? neutLabel(own))
    : iso?.state === 'ready' ? 'Ready for handover' : iso?.state === 'blind' ? `Awaiting blinds ${iso.missing.join(', ')}` : iso?.state === 'neut' ? `Under neutralization (${iso.loops.filter((p) => p.status !== 'open' && !pointComplete(p)).map((p) => p.ref).join(', ')})`
    : STAGE_WORDS[e.stage];
  // the logbook words already say why it waits: the pending reason is added only to a line the app built
  if (e.eq.pendingReason && !recent) line += ` (pending: ${e.eq.pendingReason.toLowerCase()})`;
  return line.replace(/\.$/, '');
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
      return { tag: e.eq.tag, critical: e.eq.critical, stage: e.stage, hoAt: e.hoAt, neut: !n ? null : pointComplete(n) ? 'neutralized' : n.status === 'open' ? null : neutLabel(n).toLowerCase() };
    }),
    results: opsResults(d, eqs), blinds: miBlinds(d),
    shift: { date: sh.date, shift: sh.shift }, name: title,
    pointsDone: lastBy(inShift.filter((l) => l.kind === 'point')).filter((l) => l.newValue === 'in' || l.newValue === 'done')
      .map((l) => ({ ref: l.ref, kind: l.newValue === 'in' ? 'blind' as const : 'neut' as const })),
    blindLinesDone: d.activities.filter((a) => equipBlind(a) && a.actualFinish && ms(a.actualFinish) >= sh.from && ms(a.actualFinish) < sh.to).length,
    at: now,
    items: (() => { const tags = eqs.map((e) => e.eq.tag); const part = (t: string) => tags.some((p) => p !== t && (t.startsWith(`${p}-`) || t.startsWith(`${p} `)));
      return eqs.filter((e) => e.eq.tracked && SECTION[e.eq.group] && e.stage < 6).flatMap((e) => {
        const recent = noteCurrent(e.eq, d, now);
        const running = d.activities.some((a) => a.key === (e.eq.barchartKey ?? e.eq.tag) && a.tracked && !a.detail && a.actualStart && !a.actualFinish && !(a.group === 'Operations' && /neutrali|soak/i.test(a.activity)));
        const iso = e.stage === 0 ? isoState(e.eq.tag, 0, d.points ?? []) : null;
        const show = e.eq.group === 'Reactors' || recent || ((running || !!e.eq.pendingReason || e.stage >= 2 || (iso && iso.state !== 'idle' && iso.state !== 'ho')) && !part(e.eq.tag));
        return show ? [{ tag: e.eq.tag, section: SECTION[e.eq.group], line: itemStatusLine(e, d, now) }] : [];
      }); })(),
    // the loops still open, and those completed in the last day (shown once as completed)
    // the loops still open, and those completed in this shift (a finished loop is not repeated after its shift)
    loops: (d.points ?? []).filter((p) => p.kind === 'neut' && !withReactor(p) && (p.stepId || (!p.items.includes(p.ref) && (p.method !== 'spray' || p.status !== 'open'))) && (!pointComplete(p) || (!!p.doneAt && ms(p.doneAt) >= sh.from))).sort((a, b) => a.sort - b.sort).map((p) => {
      const m = p.status === 'open' ? missingBlinds(p, d.points) : []; const left = soakLeft(p, now); const done = pointComplete(p);
      // its field jobs (crane lifts, blinding): those running, and those finished this shift
      const jobs = (d.pointSteps ?? []).filter((c) => c.pointId === p.id && c.kind === 'step').map((c) => linkedStep(c, d.activities, d.points ?? []));
      const jobName = (c: TrkPointStep) => `${c.crane ? '🏗 ' : ''}${c.text.split(/,|:/)[0].replace(/\s*\(.*?\)/g, '').trim()}`;
      const jobLines = done ? [] : [...jobs.filter((c) => c.startAt && !c.doneAt).map((c) => `${jobName(c)} I/P (${hoursText(now - ms(c.startAt!))})`),
        ...jobs.filter((c) => c.doneAt && ms(c.doneAt) >= sh.from && ms(c.doneAt) < sh.to).map((c) => `${jobName(c)} ✓`)];
      const left2 = jobs.filter((c) => c.phase === 'before' && !c.doneAt).length;
      const base = done ? 'Completed' : m.length ? `Awaiting blinds ${m.join(', ')}` : p.status === 'open' ? (p.remark?.trim() || (jobs.length && left2 === 0 ? 'Ready to fill' : 'Not started'))
        : p.method === 'spray' ? 'Spraying I/P' : p.status === 'soaking' ? `Under soaking${left !== null && left > 0 ? ` (${hoursText(left)} left)` : left !== null ? ' (soak time reached)' : ''}` : NEUT_WORDS[p.status] ?? neutLabel(p);
      const line = jobLines.length ? `${base === 'Not started' ? '' : `${base} · `}${jobLines.join(' · ')}` : base;
      return { ref: p.ref, name: p.name.replace(/\s*(loop\s*)?neutrali[sz]ation.*$/i, '').replace(/→/g, ' to ').replace(/\s+/g, ' ').trim() || p.ref, line, running: (p.status !== 'open' && !done) || jobLines.length > 0, started: p.status !== 'open' || m.length > 0 || !!p.remark?.trim() || jobs.some((c) => c.startAt || c.doneAt) };
    }),
    blindsOpen: (d.points ?? []).filter((p) => p.kind === 'blind' && !pointComplete(p)).map((p) => ({ ref: p.ref, name: p.name })),
    drums: (d.engine?.scopes ?? []).filter((sc) => sc.scope === 'removal' && sc.unit && (!sc.completeAt || ms(sc.completeAt) >= sh.from)).flatMap((sc) => {
      const es = (d.engine?.entries ?? []).filter((e) => e.scopeId === sc.id && e.kind !== 'transfer');
      const started = es.length > 0 || d.activities.some((a) => a.key === sc.key && sc.activityIds.includes(a.activityId) && a.actualStart);
      if (!started) return [];
      const p = qtyProgress({ working: sc.working, initial: sc.initial, completeAt: sc.completeAt }, es);
      const shiftQty = es.filter((e) => e.verify !== 'rejected' && e.shiftDate === sh.date && e.shift === sh.shift).reduce((t, e) => t + e.qty, 0);
      return [{ key: sc.key, verified: p.verified, working: sc.working, pct: p.actualPct, shift: shiftQty, pending: es.filter((e) => e.verify === 'pending').length, empty: !!sc.completeAt }];
    }),
    events: (d.events ?? []).filter((e) => !e.endedAt || (ms(e.endedAt) >= sh.from && ms(e.endedAt) < sh.to))
      .map((e) => ({ category: EVENT_LABEL[e.category], text: e.text, open: !e.endedAt, hours: Math.round(((e.endedAt ? ms(e.endedAt) : now) - ms(e.startedAt)) / H * 10) / 10,
        tag: e.key ? d.equipment.find((x) => (x.barchartKey ?? x.tag) === e.key)?.tag ?? e.key : null, since: e.startedAt })),
    psvs: (() => {
      const tags = d.equipment.filter((e) => e.group === 'PSVs' && e.tracked).map((e) => e.barchartKey ?? e.tag);
      const acts = (k: string) => d.activities.filter((a) => a.key === k && a.tracked);
      const fin = (k: string, re: RegExp) => acts(k).find((a) => re.test(a.activity) && a.actualFinish);
      const REMOVED = /remove psv|psv to shop/i, INSTALLED = /^install psv/i;
      const lines = tags.flatMap((k) => {
        // the four PSV jobs in the plant's words
        const say = (x: string) => (REMOVED.test(x) ? 'removed to shop' : /^install blind|blind on flange/i.test(x) ? 'blind installed' : /^remove blind/i.test(x) ? 'blind removed' : INSTALLED.test(x) ? 'PSV installed' : x.toLowerCase());
        const run = acts(k).filter((a) => a.actualStart && !a.actualFinish).map((a) => `${say(a.activity)} I/P`);
        const now_ = acts(k).filter((a) => a.actualFinish && ms(a.actualFinish) >= sh.from && ms(a.actualFinish) < sh.to).map((a) => `${say(a.activity)} ✓`);
        // where it is, short: the tags without the unit number, a spare as "V-209 spare"
        const loc = d.equipment.find((e) => (e.barchartKey ?? e.tag) === k)?.description?.split(' · ')[0].replace(/\b([A-Z]{1,3})-12-/g, '$1-')
          .replace(/^Spare PSV on (\S+).*$/i, '$1 spare').replace(/\s*\(duty [^)]*\)/i, '').replace(/^PSV on /, 'on ');
        return run.length || now_.length ? [`${k.replace(/^12-/, '')}${loc ? ` (${loc})` : ''}: ${[...now_, ...run].join(' · ')}`] : [];
      });
      return { total: tags.length, removed: tags.filter((k) => fin(k, REMOVED)).length, installed: tags.filter((k) => fin(k, INSTALLED)).length, lines };
    })(),
  };
}

export const bannerText = (b: Banner) => `${b.state === 'ON_PLAN' ? 'ON PLAN' : b.state}${b.state !== 'ON_PLAN' && b.days ? ` ${b.state === 'BEHIND' ? '−' : '+'}${b.days} d` : ''}`;
const FLAG_TEXT: Record<string, string> = { HO_LATE: 'HO LATE', LATE: 'LATE', PENDING: 'Pending', IAT_OPEN: 'IAT open', STEP_LATE: 'LATE', STEP_PENDING: 'Pending' };
export const flagText = (f: string) => FLAG_TEXT[f] ?? f;

/** The WhatsApp message, in the plant's own format (one short status line per item, by equipment type) and the same
 *  for every shutdown: the title, then Reactors, Segregation blinding, Neutralization, Heaters, Exchangers, Vessels and
 *  Others, then one progress line. Items with the same status share a line (V-202/210), the pending blinds are named,
 *  the loops not started share one line, and empty sections are left out. *bold* titles, "- " lines, no columns. */
const short = (tag: string) => tag.replace(/^([A-Z]{1,3})-12-/, '$1-');
function joinTags(tags: string[]): string {
  const xs = tags.map(short); if (xs.length < 2) return xs.join('');
  let p = xs[0]; for (const x of xs) while (!x.startsWith(p)) p = p.slice(0, -1);
  // E-216A + E-216B → E-216A/B · V-202 + V-210 → V-202/210 · otherwise a plain list
  if (xs.every((x) => /^[A-Z]$/.test(x.slice(p.length)))) return p + xs.map((x) => x.slice(p.length)).join('/');
  const m = xs.map((t) => t.match(/^([A-Z]{1,3}-)(\d[^-]*)$/));
  return m.every((x) => x && x[1] === m[0]![1]) ? m[0]![1] + m.map((x) => x![2]).join('/') : xs.join(', ');
}
export function reportText(r: ShiftReport, opts: { test?: boolean; by?: string } = {}): string {
  const unit = r.name.match(/U-?\s?(\d+)/i)?.[1], train = r.name.match(/TR(?:AIN)?-?\s?(\d+)/i)?.[1];
  const title = unit || train ? `${unit ? `Unit-${unit}` : ''}${unit && train ? ' ' : ''}${train ? `Train-${train}` : ''} shutdown report` : `${r.name} report`;
  const date = new Date(`${r.shift.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const out: string[] = [`*${opts.test ? '[TEST] ' : ''}${title}*`, `_${date} · ${r.shift.shift === 'D' ? 'Day' : 'Night'} shift · ${kwTime(new Date(r.at).toISOString())}_`];
  const section = (head: string, lines: string[]) => { if (lines.length) out.push('', `*${head}*`, ...lines.map((l) => `- ${l}`)); };
  const merged = (sec: ReportSection) => { const by = new Map<string, string[]>(); for (const x of r.items.filter((i) => i.section === sec)) by.set(x.line, [...(by.get(x.line) ?? []), x.tag]);
    return [...by.entries()].map(([line, tags]) => `${joinTags(tags)}: ${line}`); };
  const rx = r.items.filter((i) => i.section === 'Reactors').sort((a, b) => Number(b.tag === 'R-12-205') - Number(a.tag === 'R-12-205') || a.tag.localeCompare(b.tag));
  section('Reactors', rx.map((x) => `${short(x.tag)}: ${x.line}`));
  // the problems open (on an item, or the shutdown's N2 / reactors events), and those ended this shift
  const sinceT = (iso: string) => (shiftOf(ms(iso)).date === r.shift.date ? kwTime(iso) : `${kwDay(iso).replace(/^\w+,\s*/, '')} ${kwTime(iso)}`);
  section('Issues', [...r.events].sort((a, b) => Number(b.open) - Number(a.open)).map((e) => `${e.tag ? short(e.tag) : e.category}: ${e.text}${e.open ? ` (since ${sinceT(e.since)})` : ` · resolved (${e.hours} h)`}`));
  const bo = r.blindsOpen;
  const bIn = r.pointsDone.filter((x) => x.kind === 'blind').map((x) => x.ref);
  section('Segregation blinding', [bo.length ? `${bo.length} blind${bo.length > 1 ? 's' : ''} pending${bo.length <= 6 ? `: ${bo.map((b) => b.ref).join(', ')}` : ''}` : 'All segregation blinds in ✓', ...(bIn.length ? [`In this shift: ${bIn.join(', ')}`] : [])]);
  const rank = (l: ShiftReport['loops'][number]) => (l.line === 'Completed' ? 0 : l.running ? 1 : 2);
  const run = r.loops.filter((l) => l.started).sort((a, b) => rank(a) - rank(b)), idle = r.loops.filter((l) => !l.started);
  section('Neutralization', [...run.map((l) => `${l.name}: ${l.line}`), ...(idle.length ? [`Not started: ${idle.map((l) => l.ref).join(', ')}`] : [])]);
  const fmtN = (n: number) => n.toLocaleString('en-US');
  section('Catalyst removal (drums)', r.drums.map((x) => `${short(x.key)}: ${x.empty ? 'vessel empty ✓ · ' : ''}${fmtN(x.verified)}${x.working ? `/${fmtN(x.working)}` : ''} drums${x.pct !== null ? ` (${x.pct}%)` : ''}${x.shift ? ` · this shift ${x.shift > 0 ? '+' : ''}${fmtN(x.shift)}` : ''}${x.pending ? ` · ${x.pending} awaiting verification` : ''}`));
  if (r.psvs.total) section('PSVs', [`Removed ${r.psvs.removed}/${r.psvs.total} · installed ${r.psvs.installed}/${r.psvs.total}`, ...r.psvs.lines]);
  section('Heaters', merged('Heaters')); section('Exchangers', merged('Exchangers')); section('Vessels', merged('Vessels')); section('Others', merged('Others'));
  section('Max bed temperature', REACTORS.filter((k) => r.temps[k]).map((k) => `R-${k.slice(1)}: ${r.temps[k]}°F`));
  if (r.notes.trim()) out.push('', '*Notes*', r.notes.trim());
  const res = r.results, b = r.blinds, mi = r.mi.banner, w = r.mi.weighted;
  const blindsIn = b.segregation[0] + b.hp[0], blindsAll = b.segregation[1] + b.hp[1];
  out.push('', `📊 Handover ${res ? `${res.ho[0]}/${res.ho[1]}` : `${r.totals.hoDone}/${r.totals.ho}`}${res ? ` · Neutralized ${res.neut[0]}/${res.neut[1]}` : ''}${blindsAll ? ` · Blinds ${blindsIn}/${blindsAll}` : ''}${w ? ` · M&I ${w.actualPct}%${w.actualHiPct > w.actualPct ? `–${w.actualHiPct}%` : ''} (plan ${w.planPct}%)` : mi && mi.items ? ` · M&I ${mi.state === 'BEHIND' ? `behind${mi.days ? ` ${mi.days} d` : ''}` : mi.state === 'AHEAD' ? `ahead${mi.days ? ` ${mi.days} d` : ''}` : 'on plan'}` : ''}`);
  // the controlling item: the latest forecast against the M & I end (unverified: P6 links not imported)
  const cp = w?.controlling;
  if (cp) out.push(`⏱ Controlling: ${short(cp.tag)} · forecast ${kwDay(cp.forecast)} ${kwTime(cp.forecast)} · ${cp.spareD < 0 ? `${-cp.spareD} d past the end (delays shutdown)` : `${cp.spareD} d float`}${w!.delays.length > 1 ? ` · ${w!.delays.length} items past the end` : ''} (unverified)`);
  if (opts.by) out.push(`— ${opts.by}`);
  return out.join('\n');
}

/** The team leader update for WhatsApp: the measures first, each named for what it counts (the critical path item
 *  against its own plan, the work hours done, the items completed and those within the end date), then the
 *  item that controls the end, the items close to it, the equipment by stage, then the SD scope and the hot work as
 *  short counts. Times in hours, no columns. */
const LEADER_GROUPS = ['Reactors', 'Exchangers', 'Vessels', 'Heaters', 'Filters'];
/** The SD scope groups, short; a 'key:' entry is a bar-chart line with no item of its own (counted by its jobs). */
const SCOPE_SHORT: [string, string][] = [['key:RTJ / Inspection', 'RTJ'], ['Check valves', 'NRV'], ['Process piping', 'Piping'], ['CV shells', 'CV'], ['Pumps / LO', 'Pumps'], ['OPR list', 'OPR']];
export function leaderReportText(d: TrkData, now: number, opts: { title?: string; test?: boolean; by?: string } = {}): string {
  const r = shiftReport(d, now, null, opts.title), w = r.mi.weighted;
  const unit = r.name.match(/U-?\s?(\d+)/i)?.[1], train = r.name.match(/TR(?:AIN)?-?\s?(\d+)/i)?.[1];
  const name = unit || train ? [unit && `U-${unit}`, train && `Train-${train}`].filter(Boolean).join(' ') + ' SD' : r.name;
  const date = new Date(`${r.shift.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const start = miStart(d.settings), end = ms(d.settings.miEnd ?? d.settings.end);
  const dayOf = !Number.isNaN(start) && !Number.isNaN(end) && now >= start ? ` · M&I day ${Math.min(Math.floor((now - start) / DAY) + 1, Math.round((end - start) / DAY))} of ${Math.round((end - start) / DAY)}` : '';
  const out = [`*${opts.test ? '[TEST] ' : ''}${name} · Team leader update*`, `_${date}${dayOf}_`];
  if (!w) { out.push('', 'M&I progress not available yet.'); if (opts.by) out.push(`— ${opts.by}`); return out.join('\n'); }
  const day = (x: number) => kwDay(new Date(x).toISOString()).replace(/^\w+,\s*/, '');
  const at = (x: number) => `${day(x)} ${kwTime(new Date(x).toISOString())}`;
  const vsEnd = (x: number) => { const h = Math.round(Math.abs(x - end) / H); return x > end ? `${h} h after P6` : `${h} h before P6`; };
  const status = (tag: string) => r.items.find((i) => i.tag === tag)?.line ?? d.equipment.find((e) => e.tag === tag)?.remark?.trim() ?? null;
  const main = w.items.filter((i) => !i.small), cp = w.controlling;
  out.push('');
  if (cp) {
    const word = cp.physPct > cp.planPct ? 'ahead' : cp.physPct < cp.planPct ? 'behind' : 'on plan';
    const drums = r.drums.some((x) => x.key === cp.key && !x.empty);
    out.push(`🎯 *Critical path (${short(cp.tag)}):* ${word} · ${cp.physPct}% vs plan ${cp.planPct}%`, `   End ${at(cp.forecast)} · ${vsEnd(cp.forecast)}${drums ? ' (drum rate)' : ''}`);
  }
  out.push(`🛠 *Work done (hours):* ${w.main.physPct}% · plan ${w.main.planPct}%`,
    `📦 *Items completed:* ${main.filter((i) => i.done === i.lines).length} / ${main.length}`,
    `🟢 *Items within the end date:* ${main.filter((i) => i.forecast <= end).length} / ${main.length}`);
  if (cp) { const s = status(cp.tag); out.push('', `🔴 *${short(cp.tag)}* (controls the end)`, ...(s ? [`• ${s}`] : [])); }
  // the items close to the end, those with the same float and status on one line
  const watch = new Map<string, { tags: string[]; line: string | null; h: string }>();
  for (const i of w.critical.filter((x) => x !== cp && x.done < x.lines)) {
    const hh = Math.round((end - i.forecast) / H), h = hh >= 0 ? `${hh} h float` : `${-hh} h past the end`, line = status(i.tag);
    const k = `${h}|${line}`; watch.set(k, { tags: [...(watch.get(k)?.tags ?? []), i.tag], line, h });
  }
  if (watch.size) out.push('', '🟠 *Watch*', ...[...watch.values()].flatMap((x) => [`• ${joinTags(x.tags).replace(/, /g, ' / ')}: ${x.h}`, ...(x.line ? [`  ${x.line}`] : [])]));
  const eqs = equipViews(d, now).filter((e) => e.eq.tracked);
  const lines = LEADER_GROUPS.flatMap((g) => {
    const xs = eqs.filter((e) => e.eq.group === g); if (!xs.length) return [];
    const n = STAGE_SHORT.map((_, s) => xs.filter((e) => e.stage === s).length);
    return [`• ${g} ${xs.length}: ${STAGE_SHORT.flatMap((s, k) => (n[k] ? [`${s === 'HO' || s === 'Box-up' ? s : s.toLowerCase()} ${n[k]}`] : [])).join(' · ')}`];
  });
  if (lines.length) out.push('', '*Equipment status*', ...lines);
  // the small jobs and the hot work, one short count each (done / total): an item is done when all its jobs are; one
  // item with many jobs (the OPR list) counts its jobs
  const jobs = (k: string) => d.activities.filter((a) => a.key === k && a.tracked && !a.detail && a.group !== 'Operations');
  const scope = (g: string) => {
    if (g.startsWith('key:')) { const ls = jobs(g.slice(4)); return ls.length ? `${ls.filter((a) => a.actualFinish).length}/${ls.length}` : null; }
    const xs = d.equipment.filter((e) => e.tracked && e.group === g && (jobs(e.barchartKey ?? e.tag).length || !e.hoStep)); if (!xs.length) return null;
    const one = xs.length === 1 ? jobs(xs[0].barchartKey ?? xs[0].tag) : [];
    if (one.length > 1) return `${one.filter((a) => a.actualFinish).length}/${one.length}`;
    return `${xs.filter((e) => { const ls = jobs(e.barchartKey ?? e.tag); return ls.length ? ls.every((a) => a.actualFinish) : e.stage >= STAGE_SHORT.length - 1; }).length}/${xs.length}`;
  };
  const small = SCOPE_SHORT.flatMap(([g, n]) => { const c = scope(g); return c ? [`${n} ${c}`] : []; });
  if (r.psvs.total) small.push(`PSV ${r.psvs.removed} out, ${r.psvs.installed} back`);
  const iats = d.iats.map(iatStatus).filter((x) => x !== 'Cancelled'), pmr = scope('PMRs');
  const hot = [...(iats.length ? [`IAT ${iats.filter((x) => x === 'Completed').length}/${iats.length}${iats.includes('In progress') ? ` (${iats.filter((x) => x === 'In progress').length} I/P)` : ''}`] : []), ...(pmr ? [`PMR ${pmr}`] : [])];
  if (small.length) out.push('', `📋 *SD scope:* ${small.join(' · ')}`);
  if (hot.length) out.push(`🔥 *Hot work:* ${hot.join(' · ')}`);
  if (opts.by) out.push('', `— ${opts.by}`);
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
  /** the planned end (bar chart) and the end expected now: the latest item forecast (the critical path) */
  plannedEnd: number; estEnd: number | null;
  /** progress against time, weighted by the spare time of each item */
  weighted: MiWeighted | null;
}
export interface Phases { ops: OpsProgress | null; mi: MiPhase }

/** M & I progress, forecast and the controlling item, from the bar chart (P6 baseline, never changed).
 *  - Physical progress: each line weighted by its P6 hours (provisional until approved weights exist). A finished line
 *    counts 100%, a running line its measured share (drums), a running line with no measure is "not measured" and only
 *    widens the range (up to), never counted as done or as 0.
 *  - Forecast: the item's remaining work laid forward. A line follows the line(s) whose P6 finish is its P6 start (the
 *    order of the P6 dates: the P6 links are not imported); lines in parallel overlap; a late line moves only what
 *    follows it. Running drums use the measured removal rate, everything else its P6 duration (never invented).
 *  - Three indicators per item: physical % (vs plan %), schedule variance (P6 finish − forecast, days, + ahead),
 *    float to the M & I end and the shutdown impact (days past it). Every item can control the end, PSVs included.
 *  Lines not on an item (Electrical, workshop …) are support jobs, counted apart. */
export interface MiItem { tag: string; key: string; group: string; small: boolean;
  /** physical progress: measured, and up to (with the running lines not measured counted done) · plan by the P6 dates */
  physPct: number; physHiPct: number; planPct: number;
  p6Finish: number; forecast: number; remainingD: number; svD: number; spareD: number; impactD: number;
  done: number; lines: number; next: string | null; driving: string | null;
  /** why the forecast is not verified (beyond the P6 logic not imported) */
  unverified: string[] }
export interface MiPart { items: number; physPct: number; physHiPct: number; planPct: number }
export interface MiWeighted { planPct: number; actualPct: number; actualHiPct: number; state: Banner['state']; end: number; items: MiItem[];
  /** the main equipment (the headline %) and the small jobs (PSVs, CV shells, piping …), kept apart */
  main: MiPart; small: MiPart;
  /** the item with the latest forecast (any group), its forecast and the days past the M & I end */
  controlling: MiItem | null; estEnd: number; impactD: number;
  critical: MiItem[]; delays: MiItem[]; support: [number, number] }
export const CRITICAL_SPARE_D = 3;
export function miWeighted(d: TrkData, now: number, eqs: EquipView[]): MiWeighted | null {
  const end = ms(d.settings.miEnd ?? d.settings.end);
  if (Number.isNaN(end)) return null;
  const byKey = new Map(eqs.filter((e) => e.eq.tracked).map((e) => [e.eq.barchartKey ?? e.eq.tag, e]));
  const lines = d.activities.filter((a) => a.tracked && !a.detail && a.group !== 'Operations' && a.start && a.finish);
  const support = lines.filter((a) => !byKey.has(a.key));
  const keys = [...new Set(lines.map((a) => a.key))].filter((k) => byKey.has(k));
  if (!keys.length) return null;
  const eng = d.engine;
  const items = keys.map((key): MiItem => {
    const e = byKey.get(key)!, xs = sortActs(lines.filter((a) => a.key === key));
    const hours = (a: TrkActivity) => Math.max(0, a.durationH ?? (ms(a.finish) - ms(a.start)) / H);
    const unverified: string[] = [];
    // the measured work (drums): share done and the finish from the removal rate (the progress engine's rules)
    const measure = (a: TrkActivity): { p: number; finish: number | null } | null => {
      const sc = eng?.scopes.find((x) => x.key === key && x.scope === 'removal' && x.activityIds.includes(a.activityId));
      if (!sc || !sc.working) return null;
      const es = eng!.entries.filter((x) => x.scopeId === sc.id);
      const pr = qtyProgress({ working: sc.working, initial: sc.initial, completeAt: sc.completeAt }, es);
      const fc = qtyForecast(es, pr.remaining, now, { window: d.settings.fcWindow, min: d.settings.fcMin });
      if (fc.status !== 'ok') unverified.push(`${a.activity}: rate not yet known (${fc.reason}), P6 duration used`);
      return { p: (pr.actualPct ?? 0) / 100, finish: fc.status === 'ok' ? fc.finish : null };
    };
    const fc = new Map<TrkActivity, number>();
    let w = 0, got = 0, open = 0, plan = 0;
    for (const a of [...xs].sort((x, y) => ms(x.start) - ms(y.start) || ms(x.finish) - ms(y.finish))) {
      const h = hours(a), s0 = ms(a.start), f0 = ms(a.finish);
      w += h; plan += h * (f0 > s0 ? Math.min(1, Math.max(0, (now - s0) / (f0 - s0))) : now >= s0 ? 1 : 0);
      const preds = xs.filter((p) => p !== a && ms(p.finish) === s0 && fc.has(p));
      let f: number;
      if (a.actualFinish) { f = ms(a.actualFinish); got += h; }
      else if (a.actualStart) {
        const m = measure(a);
        if (m) { got += h * m.p; f = m.finish ?? now + h * (1 - m.p) * H; }
        else {
          open += h; f = Math.max(ms(a.actualStart) + h * H, now);
          unverified.push(ms(a.actualStart) + h * H < now ? `${a.activity}: running past its P6 duration, remaining not known` : `${a.activity}: running, not measured`);
        }
      } else {
        if (!preds.length && s0 < now) unverified.push(`${a.activity}: P6 start passed, no start recorded`);
        f = (preds.length ? Math.max(now, ...preds.map((p) => fc.get(p)!)) : Math.max(s0, now)) + h * H;
      }
      fc.set(a, f);
    }
    const p6Finish = Math.max(...xs.map((a) => ms(a.finish)));
    const left = xs.filter((a) => !a.actualFinish);
    const forecast = Math.max(...fc.values());
    const drv = left.length ? [...left].sort((a, b) => fc.get(b)! - fc.get(a)!)[0] : null;
    const pct = (x: number) => (w > 0 ? Math.round(x / w * 100) : 0);
    return { tag: e.eq.tag, key, group: e.eq.group, small: isSmallJob(e.eq.group), physPct: pct(got), physHiPct: pct(got + open), planPct: pct(plan),
      p6Finish, forecast, remainingD: r1(Math.max(0, forecast - now) / DAY), svD: r1((p6Finish - forecast) / DAY), spareD: r1((end - forecast) / DAY),
      impactD: r1(Math.max(0, forecast - end) / DAY), done: xs.length - left.length, lines: xs.length, next: left[0]?.activity ?? null, driving: drv?.activity ?? null, unverified };
  }).sort((a, b) => a.spareD - b.spareD || a.tag.localeCompare(b.tag));
  // the parts: physical % weighted by the lines' hours
  const hoursOf = (key: string) => lines.filter((a) => a.key === key).reduce((t, a) => t + Math.max(0, a.durationH ?? (ms(a.finish) - ms(a.start)) / H), 0);
  const part = (xs: MiItem[]): MiPart => {
    const ws = xs.map((i) => hoursOf(i.key)), W = ws.reduce((t, x) => t + x, 0) || 1;
    const f = (k: 'physPct' | 'physHiPct' | 'planPct') => Math.round(xs.reduce((t, i, n) => t + i[k] * ws[n], 0) / W);
    return { items: xs.length, physPct: f('physPct'), physHiPct: f('physHiPct'), planPct: f('planPct') };
  };
  const main = part(items.filter((i) => !i.small)), small = part(items.filter((i) => i.small));
  const openItems = items.filter((i) => i.done < i.lines);
  const controlling = openItems.length ? openItems.reduce((a, b) => (b.forecast > a.forecast ? b : a)) : null;
  const estEnd = Math.max(...items.map((i) => i.forecast));
  return { planPct: main.planPct, actualPct: main.physPct, actualHiPct: main.physHiPct, state: main.physPct >= main.planPct + 2 ? 'AHEAD' : main.physHiPct < main.planPct - 2 ? 'BEHIND' : 'ON_PLAN',
    end, items, main, small, controlling, estEnd, impactD: r1(Math.max(0, estEnd - end) / DAY),
    critical: openItems.filter((i) => i.spareD <= CRITICAL_SPARE_D), delays: items.filter((i) => i.spareD < 0),
    support: [support.filter((a) => a.actualFinish).length, support.length] };
}

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
  const w = started !== null ? miWeighted(d, now, equipViews(d, now, steps)) : null;
  return {
    ops: opsProgress(steps, d.settings, now, started, opsResults(d, equipViews(d, now, steps))),
    mi: { planned, actualStart: started, delayH: started !== null && !Number.isNaN(planned) ? r1(delay / H) : null, critical: ho.critical, banner: bn,
      plannedEnd, estEnd: Number.isNaN(plannedEnd) ? null : w ? w.estEnd : plannedEnd + delay, weighted: w },
  };
}

// ── Ask for updates: the items whose work has had no update for a while, as a WhatsApp request ─────────────────
/** No update for this long asks for one: critical-path items sooner, small jobs (PSVs, CV shells …) later. */
export const STALE_H = { normal: 12, critical: 6, small: 24 } as const;
export interface StaleItem { tag: string; key: string; section: string; critical: boolean; small: boolean;
  /** the last thing heard about it, its age in hours, the limit it passed */
  lastAt: number; ageH: number; limitH: number;
  /** the latest update in the plant's words (its remark, else the running step) */
  status: string }
const askWhen = (t: number) => `${new Date(t + KW).getUTCDate()} ${new Date(t + KW).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })} ${kwTime(t)}`;
const askName = (x: string) => { const t = x.replace(/\s+/g, ' ').split(/,|\s\(|\s-\s/)[0].trim(); return t.length > 28 ? `${t.slice(0, 26).trim()}…` : t; };
/** The request's sections: the equipment groups, main equipment first, PSVs last. */
const ASK_ORDER = ['Reactors', 'Heaters', 'Exchangers', 'Air coolers', 'Vessels', 'Filters', 'Compressor', 'Pumps / LO'];
const ASK_NAME: Record<string, string> = { 'CV shells': 'Control valves', 'Pumps / LO': 'Pumps / lube oil' };
/** The tracked items with work running (or due and not started) and no update for longer than their limit: their
 *  steps' times, the item's own changes (remark, hold, stage) and drum entries all count as an update. Items on hold,
 *  finished or not yet due are not asked. Latest-first is the oldest update first. */
export function staleItems(d: TrkData, now: number, limits: { normal?: number; critical?: number; small?: number } = {}): StaleItem[] {
  const lim = { ...STALE_H, normal: d.settings.staleH ?? STALE_H.normal, ...limits };
  const w = miWeighted(d, now, equipViews(d, now));
  const spare = new Map((w?.items ?? []).map((i) => [i.key, i.spareD]));
  const seen = new Set<string>(); const out: StaleItem[] = [];
  for (const e of d.equipment) {
    if (!e.tracked || e.pendingReason) continue;
    const key = e.barchartKey ?? e.tag;
    if (e.combine) { if (seen.has(e.combine)) continue; seen.add(e.combine); }
    const keys = e.combine ? d.equipment.filter((x) => x.combine === e.combine).map((x) => x.barchartKey ?? x.tag) : [key];
    const acts = sortActs(d.activities.filter((a) => keys.includes(a.key) && a.tracked && !a.detail && a.group !== 'Operations'));
    const open = acts.filter((a) => !a.actualFinish);
    if (!acts.length || !open.length) continue;
    const running = open.filter((a) => a.actualStart);
    const next = open.find((a) => !a.actualStart);
    const due = !running.length && next?.start && ms(next.start) < now ? next : null;
    if (!running.length && !due) continue;
    const scope = (d.engine?.scopes ?? []).find((s) => keys.includes(s.key) && s.scope === 'removal' && !s.completeAt);
    const entries = scope ? (d.engine?.entries ?? []).filter((x) => x.scopeId === scope.id && x.kind !== 'transfer') : [];
    const times = [...acts.flatMap((a) => [a.actualStart, a.actualFinish, a.updatedAt]), ...d.equipment.filter((x) => keys.includes(x.barchartKey ?? x.tag)).map((x) => x.updatedAt), ...entries.map((x) => x.enteredAt)]
      .filter((x): x is string => !!x).map(ms).filter((x) => !Number.isNaN(x) && x <= now);
    const lastAt = times.length ? Math.max(...times) : due ? ms(due.start) : now;
    const small = isSmallJob(e.group), critical = e.critical || (spare.get(key) ?? Infinity) <= CRITICAL_SPARE_D;
    const limitH = critical ? lim.critical : small ? lim.small : lim.normal;
    const ageH = Math.round((now - lastAt) / H);
    if (ageH < limitH) continue;
    const dumping = scope && running.some((a) => scope.activityIds.includes(a.activityId));
    const drums = entries.reduce((t, x) => t + x.qty, 0);
    const r = running[0];
    // the latest update in the plant's words: the item's remark, else its running step, else the step due
    const remark = d.equipment.find((x) => keys.includes(x.barchartKey ?? x.tag) && x.remark?.trim())?.remark?.trim();
    const status = remark ? remark : dumping ? `Dumping I/P: ${drums.toLocaleString('en-US')} drums` : r ? `${askName(r.activity)} I/P` : '';
    out.push({ tag: e.combine ?? e.tag, key, section: e.group, critical, small, lastAt, ageH, limitH, status });
  }
  return out.sort((a, b) => a.lastAt - b.lastAt);
}
/** The request as WhatsApp text: by equipment group, one item per line with its latest update and when, the reply after the colon. */
export function askText(items: StaleItem[], now: number, opts: { name?: string; test?: boolean; by?: string } = {}): string {
  // short, like the shift report: the item, its latest update and when; the reply is written after the colon
  const out = [`*${opts.test ? '[TEST] ' : ''}${opts.name ?? 'Shutdown'} · Update request*`, `_${askWhen(now)} · latest update shown, please reply with the status_`];
  const rank = (g: string) => (ASK_ORDER.includes(g) ? ASK_ORDER.indexOf(g) : g === 'PSVs' ? 99 : 50);
  for (const sec of [...new Set(items.map((i) => i.section))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
    // one item per line, so each can be answered on its own
    // short: "no activity since 19 Oct", "Pigging I/P since 21 Oct", "Gas test OK (22 Oct)"; today's updates by the hour
    const day = (t: number) => (Math.floor((t + KW) / DAY) === Math.floor((now + KW) / DAY) ? kwTime(t) : askWhen(t).replace(/ \d\d:\d\d$/, ''));
    out.push('', `*${ASK_NAME[sec] ?? sec}*`, ...items.filter((i) => i.section === sec).sort((a, b) => a.tag.localeCompare(b.tag, 'en', { numeric: true }))
      .map((x) => `- ${short(x.tag.replace(/^12-/, ''))}: ${!x.status ? `no activity since ${day(x.lastAt)}` : / I\/P$/.test(x.status) ? `${x.status} since ${day(x.lastAt)}` : `${x.status} (${day(x.lastAt)})`}:`));
  }
  if (opts.by) out.push('', `— ${opts.by}`);
  return out.join('\n');
}


// ── Change log in words: who changed what (Section Head) ────────────────────────────────────────────────────────
const tagShort = (t: string) => t.replace(/^([A-Z]{1,3})-12-/, '$1-').replace(/^12-/, '');
const STEP_WORDS: Record<string, string> = { not_started: 'not started', in_progress: 'in progress', done: 'done', na: 'not needed', pending: 'pending' };
/** One change as a short line: the item, then what happened. Times inside the values are shown in Kuwait time. */
export function logText(l: TrkLog, acts: TrkActivity[] = []): { item: string; what: string } {
  const t = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v) ? `${kwDay(v)} ${kwTime(v)}` : v);
  const q = (v: string | null) => (v ? `"${v}"` : '—');
  if (l.kind === 'activity') {
    const [key, id] = l.ref.split(' · ');
    const name = acts.find((a) => a.key === key && a.activityId === id)?.activity ?? id ?? '';
    const item = tagShort(key);
    if (l.field === 'actual_start') return { item, what: l.newValue ? `▶ started ${name}` : `↶ start undone · ${name}` };
    if (l.field === 'actual_finish') return { item, what: l.newValue ? `✓ finished ${name}` : `↶ finish undone · ${name}` };
    if (l.field === 'renamed') return { item, what: `✎ step renamed ${q(l.oldValue)} → ${q(l.newValue)}` };
    if (l.field === 'step added') return { item, what: `+ step added ${q(l.newValue)}` };
    if (l.field === 'step off' || l.field === 'step on') return { item, what: `${l.field === 'step off' ? '🗑 step removed' : '+ step back'} ${q(l.newValue)}` };
    if (l.field === 'order') return { item, what: '↕ steps reordered' };
    return { item, what: `${l.field}: ${t(l.oldValue) ?? '—'} → ${t(l.newValue) ?? '—'}` };
  }
  if (l.kind === 'equipment') {
    const item = tagShort(l.ref);
    if (l.field === 'stage') return { item, what: `stage ${STAGE_SHORT[Number(l.oldValue)] ?? l.oldValue} → ${STAGE_SHORT[Number(l.newValue)] ?? l.newValue}` };
    if (l.field === 'pending') return { item, what: l.newValue ? `⏸ on hold · ${l.newValue}` : '▶ back in progress' };
    if (l.field === 'note') return { item, what: `📝 note ${q(l.newValue)}` };
    if (l.field === 'blinds_in') return { item, what: l.newValue ? `🔒 blinds in ${t(l.newValue)}` : 'blinds in undone' };
    if (l.field === 'blinds_out') return { item, what: l.newValue ? `🔓 blinds out ${t(l.newValue)}` : 'blinds out undone' };
    if (l.field === 'tracked') return { item, what: l.newValue === 'true' ? 'followed again' : 'taken off the tracker' };
  }
  if (l.kind === 'step') {
    if (l.field === 'status') return { item: l.ref, what: `${STEP_WORDS[l.oldValue ?? ''] ?? l.oldValue ?? '—'} → ${STEP_WORDS[l.newValue ?? ''] ?? l.newValue ?? '—'}` };
    if (l.field === 'pending') return { item: l.ref, what: l.newValue ? `⏸ ${l.newValue}` : '▶ resumed' };
  }
  if (l.kind === 'point') {
    if (l.field === 'blind') return { item: l.ref, what: `blind ${l.oldValue ?? '—'} → ${l.newValue ?? '—'}` };
    if (l.field === 'neut') return { item: l.ref, what: `neutralization ${l.oldValue ?? '—'} → ${l.newValue ?? '—'}` };
    if (/^step /.test(l.field)) return { item: l.ref, what: `${l.field}${l.newValue && !/^\d{4}-/.test(l.newValue) ? ` · ${l.newValue}` : ''}` };
    if (l.field === 'hold' || l.field === 'resumed') return { item: l.ref, what: l.field === 'hold' ? `⏸ on hold · ${l.newValue ?? ''}` : '▶ resumed' };
  }
  if (l.kind === 'iat') {
    if (l.field === 'iat') return { item: tagShort(l.ref), what: `IAT ${l.newValue ?? ''}` };
    return { item: `IAT ${l.ref}`, what: `${l.field}: ${l.newValue ?? 'cleared'}` };
  }
  if (l.kind === 'event') {
    const item = /-12-|^\d/.test(l.ref) ? tagShort(l.ref) : l.ref === 'nitrogen' ? 'N₂' : l.ref === 'reactors' ? 'Reactors' : 'Other';
    const verb = l.field === 'event' ? '⚠ issue' : l.field === 'event ended' ? '✓ issue resolved' : l.field === 'event reopened' ? '↺ issue reopened' : '✎ issue edited';
    return { item, what: `${verb} ${q(l.newValue)}` };
  }
  if (l.kind === 'qty') {
    const [key, , date, sh] = l.ref.split(' ');
    const n = l.newValue?.split(' ')[0];
    if (l.field === 'removal') return { item: tagShort(key), what: `🛢 ${n} drums (${date ?? ''} ${sh ?? ''})` };
    if (l.field === 'correction') return { item: tagShort(key), what: `🛢 drums corrected ${n}` };
    if (l.field === 'complete') return { item: tagShort(key), what: '✓ reactor empty' };
    return { item: tagShort(key), what: `drums ${l.field}: ${l.newValue ?? ''}` };
  }
  if (l.kind === 'shift') {
    if (l.field === 'temperatures') { let v = l.newValue ?? ''; try { v = Object.entries(JSON.parse(v) as Record<string, string>).filter(([, x]) => x).map(([k, x]) => `R-${k.slice(1)} ${x}°F`).join(' · '); } catch { /* as written */ } return { item: 'Shift', what: `🌡 ${v}` }; }
    return { item: 'Shift', what: `📝 notes ${q(l.newValue)}` };
  }
  return { item: l.ref, what: `${l.field}: ${t(l.oldValue) ?? '—'} → ${t(l.newValue) ?? '—'}` };
}
