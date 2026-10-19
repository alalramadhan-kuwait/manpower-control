// Shutdown progress tracker (U-12 TR-2 tracker v4): the rules of the guideline steps, the equipment flags, plan vs
// actual against the bar chart, the "needs attention" list and the shift report. Pure: everything is worked out from
// the rows and the time given, the same on the page, the report and the tests.

export type StepStatus = 'not_started' | 'in_progress' | 'done' | 'pending' | 'na';
export type StepState = 'DONE' | 'NA' | 'PENDING' | 'IN_PROGRESS' | 'READY' | 'WAITING';
export type Flag = 'CHECK_HO' | 'IAT_OPEN' | 'COMPLETE' | 'PENDING' | 'HO_LATE' | 'LATE' | 'NOT_HO' | 'IN_PROGRESS' | 'NONE';

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
}
export interface TrkLog { kind: 'step' | 'equipment' | 'iat' | 'activity'; ref: string; field: string; oldValue: string | null; newValue: string | null; byName: string | null; at: string }
export interface TrkSettings { hoTarget?: string; end?: string; workOrder?: string; whatsapp?: string; opsStart?: string; miStart?: string; miEnd?: string }
export interface TrkData { steps: TrkStep[]; equipment: TrkEquipment[]; iats: TrkIat[]; activities: TrkActivity[]; log: TrkLog[]; settings: TrkSettings }

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
  /** when the item was handed over: its HO step's time done (or the stage stamp) */
  hoAt: string | null; iatsOpen: TrkIat[]; plan: PlanVsActual | null;
}

export function planVsActual(acts: TrkActivity[], actual: number, now: number): PlanVsActual | null {
  const list = acts.filter((a) => a.tracked && a.stage !== null && a.start);
  if (!list.length) return null;
  const started = list.filter((a) => ms(a.start) <= now);
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
    const plan = eq.barchartKey ? planVsActual(actsBy.get(eq.barchartKey) ?? [], stage, now) : null;
    let flag: Flag = 'NONE', reason: string | null = null, lateBy = 0;
    if (eq.stage >= 1 && eq.hoStep && !hoDone) flag = 'CHECK_HO';
    else if (stage >= 5 && iatsOpen.length) flag = 'IAT_OPEN';
    else if (stage === 6) flag = 'COMPLETE';
    else if (eq.pendingReason) { flag = 'PENDING'; reason = eq.pendingReason; }
    else if (stage === 0 && ho?.state === 'PENDING') { flag = 'PENDING'; reason = `${ho.step.pendingReason ?? 'Pending'} (step)`; }
    // handover late only once operations can work the handover step (assumption agreed for v1: a WAITING step's item is not late)
    else if (ops && eq.tracked && stage === 0 && eq.plannedHo && now > ms(eq.plannedHo) && ho && ho.state !== 'WAITING') { flag = 'HO_LATE'; lateBy = now - ms(eq.plannedHo); }
    else if (ops && eq.tracked && stage < 6 && eq.plannedFinish && now > ms(eq.plannedFinish)) { flag = 'LATE'; lateBy = now - ms(eq.plannedFinish); }
    else if (ops && stage === 0) flag = 'NOT_HO';
    else if (stage >= 1 && stage <= 5) flag = 'IN_PROGRESS';
    const hoAt = hoDone ? ho!.step.updatedAt : null;
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
const RANK: Record<string, number> = { CHECK_HO: 0, HO_LATE: 1, LATE: 2, STEP_LATE: 2, PENDING: 3, STEP_PENDING: 3, IAT_OPEN: 4 };
export const hoursText = (msec: number) => (msec >= DAY ? `${Math.round(msec / DAY * 10) / 10} d` : `${Math.max(1, Math.round(msec / H))} h`);
/** The "needs me" list: CHECK HO STEP › HO LATE › LATE › PENDING › IAT OPEN (tracked items only), steps late or pending too. */
export function attention(steps: Map<string, StepView>, eqs: EquipView[]): Attention[] {
  const out: Attention[] = [];
  for (const e of eqs) {
    if (!e.eq.tracked || !(e.flag in RANK)) continue;
    const detail = e.flag === 'CHECK_HO' ? `stage set, ${e.eq.hoStep} not done` : e.flag === 'HO_LATE' || e.flag === 'LATE' ? hoursText(e.lateBy)
      : e.flag === 'PENDING' ? e.reason ?? '' : e.flag === 'IAT_OPEN' ? e.iatsOpen.map((i) => i.iatNo).join(', ') : '';
    out.push({ kind: 'equipment', ref: e.eq.tag, label: e.eq.tag, detail, flag: e.flag, rank: RANK[e.flag], at: e.lateBy });
  }
  for (const v of steps.values()) {
    if (v.state === 'PENDING') out.push({ kind: 'step', ref: v.step.stepId, label: `${v.step.stepId} ${v.step.shortName}`, detail: v.step.pendingReason ?? 'Pending', flag: 'STEP_PENDING', rank: RANK.STEP_PENDING, at: v.lateBy });
    else if (v.late) out.push({ kind: 'step', ref: v.step.stepId, label: `${v.step.stepId} ${v.step.shortName}`, detail: hoursText(v.lateBy), flag: 'STEP_LATE', rank: RANK.STEP_LATE, at: v.lateBy });
  }
  return out.sort((a, b) => a.rank - b.rank || b.at - a.at || a.label.localeCompare(b.label));
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
  /** the operations part, and M & I's start while it has not started */
  ops: OpsProgress | null; miStartsAt: number | null;
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
    ops: opsProgress(steps, d.settings, now), miStartsAt: now < miStart(d.settings) ? miStart(d.settings) : null,
    attention: attention(steps, eqs), ready: [...steps.values()].filter((v) => v.state === 'READY'),
    notes: log?.notes ?? '', temps: log?.temps ?? {},
  };
}

const BANNER_ICON = { AHEAD: '🟢', BEHIND: '🔴', ON_PLAN: '🟡' } as const;
export const bannerText = (b: Banner) => `${b.state === 'ON_PLAN' ? 'ON PLAN' : b.state}${b.state !== 'ON_PLAN' && b.days ? ` ${b.state === 'BEHIND' ? '−' : '+'}${b.days} d` : ''}`;
const FLAG_TEXT: Record<string, string> = { CHECK_HO: 'CHECK HO STEP', HO_LATE: 'HO LATE', LATE: 'LATE', PENDING: 'Pending', IAT_OPEN: 'IAT open', STEP_LATE: 'LATE', STEP_PENDING: 'Pending' };
export const flagText = (f: string) => FLAG_TEXT[f] ?? f;

/** The WhatsApp message: short, the PDF carries the details. */
export function reportText(r: ShiftReport, opts: { test?: boolean; by?: string } = {}): string {
  const o = r.ops;
  const lines = [`${opts.test ? '[TEST] ' : ''}${r.title}`,
    ...(o && o.state !== 'NOT_STARTED' && o.state !== 'DONE' ? [`🛠 Operations day ${o.day}/${o.days}: Plan ${o.planPct}% · Actual ${o.actualPct}%`] : []),
    r.miStartsAt ? `🔧 M & I starts ${kwDay(r.miStartsAt)} ${kwTime(r.miStartsAt)}` : `${BANNER_ICON[r.banner.state]} M & I ${bannerText(r.banner)}  (Plan ${r.banner.planPct}% · Actual ${r.banner.actualPct}%)`,
    `✅ Steps ${r.totals.stepsDone}/${r.totals.steps} · HO ${r.totals.hoDone}/${r.totals.ho}`];
  if (r.stepsDone.length) lines.push(`✔️ Done this shift: ${r.stepsDone.map((s) => s.stepId).join(', ')}`);
  if (r.stageChanges.length) lines.push(`🔧 Moved: ${r.stageChanges.map((c) => `${c.tag} → ${STAGE_SHORT[c.to]}`).join(', ')}`);
  const fin = r.activities.filter((x) => x.field === 'actual_finish').length, sta = r.activities.filter((x) => x.field === 'actual_start').length;
  if (fin || sta) lines.push(`⏱ Mechanical: ${sta} started · ${fin} finished`);
  lines.push(`⚠️ Needs attention (${r.attention.length})`);
  for (const a of r.attention.slice(0, 8)) lines.push(`• ${a.label} ${flagText(a.flag)}${a.detail ? ` – ${a.detail}` : ''}`);
  if (r.attention.length > 8) lines.push(`• +${r.attention.length - 8} more`);
  if (r.ready.length) lines.push(`▶️ Ready next: ${r.ready.slice(0, 6).map((v) => `${v.step.stepId} ${v.step.shortName}`).join(', ')}${r.ready.length > 6 ? ` +${r.ready.length - 6}` : ''}`);
  const temps = REACTORS.filter((k) => r.temps[k]).map((k) => `${k.slice(1)}:${r.temps[k]}`);
  if (temps.length) lines.push(`🌡 Max bed °F ${temps.join(' ')}`);
  if (r.notes.trim()) lines.push(`📝 ${r.notes.trim()}`);
  if (opts.by) lines.push(`— ${opts.by}`);
  return lines.join('\n');
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
export interface OpsProgress { state: Banner['state'] | 'NOT_STARTED' | 'DONE'; planPct: number; actualPct: number; day: number; days: number; offDays: number; start: number; end: number }
/** Operations shutdown: the guideline steps done against the time gone in its window (start → M & I start). */
export function opsProgress(steps: Map<string, StepView>, s: TrkSettings, now: number): OpsProgress | null {
  const start = ms(s.opsStart), end = ms(s.miStart ?? s.hoTarget);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const sv = [...steps.values()].filter((v) => v.state !== 'NA');
  const actual = sv.length ? sv.filter((v) => v.state === 'DONE').length / sv.length : 0;
  const plan = Math.min(1, Math.max(0, (now - start) / (end - start)));
  const days = Math.round((end - start) / DAY), day = Math.min(days, Math.max(1, Math.floor((now - start) / DAY) + 1));
  const state = now < start ? 'NOT_STARTED' : actual >= 1 ? 'DONE' : actual >= plan + 0.05 ? 'AHEAD' : actual < plan - 0.05 ? 'BEHIND' : 'ON_PLAN';
  return { state, planPct: Math.round(plan * 100), actualPct: Math.round(actual * 100), day, days, offDays: r1((actual - plan) * (end - start) / DAY), start, end };
}
/** M & I: before its start, when it starts; then the bar-chart banner. */
export function miStart(s: TrkSettings): number { return ms(s.miStart ?? s.hoTarget); }
