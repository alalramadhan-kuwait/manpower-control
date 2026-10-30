// Shutdown progress tracker: the trackers of the calendar shutdowns (template / test / live), their steps, equipment,
// IATs, bar chart, shift log and change log. Who and when are stamped by the database on every change.
import { dateTime12 } from '@/core/clock';
import { supabase } from './supabase';
import type { TrkReturnItem, QtyKind, QtyMethod, Shift, TrkEngine, TrkQtyEntry, TrkUpdate, PointStatus, StepStatus, TrkActivity, TrkData, TrkEquipment, TrkIat, TrkRtj, TrkLog, LuEquip, LuStream, TrkPoint, TrkPointStep, TrkEvent, TrkSettings, TrkStep } from '@/core/tracker';

export interface Tracker { id: string; eventId: string | null; title: string; mode: 'template' | 'test' | 'live'; settings: TrkSettings; status: 'active' | 'closed'; eventStart: string | null; eventEnd: string | null; eventTitle: string | null }
interface TrackerRow { id: string; event_id: string | null; title: string; mode: Tracker['mode']; settings: TrkSettings | null; status: Tracker['status']; unit_events?: { start_date: string; end_date: string; unit: string | null; title: string | null } | null }
const toTracker = (r: TrackerRow): Tracker => ({ id: r.id, eventId: r.event_id, title: r.title, mode: r.mode, settings: r.settings ?? {}, status: r.status,
  eventStart: r.unit_events?.start_date ?? null, eventEnd: r.unit_events?.end_date ?? null, eventTitle: r.unit_events ? [r.unit_events.unit, r.unit_events.title].filter(Boolean).join(' ') : null });

/** The active test and live trackers (the template is the seed, never shown). */
export async function fetchTrackers(): Promise<Tracker[]> {
  const { data, error } = await supabase.from('trk_trackers').select('id,event_id,title,mode,settings,status,unit_events(start_date,end_date,unit,title)').eq('status', 'active').neq('mode', 'template').order('created_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as TrackerRow[]).map(toTracker);
}
/** The tracker to open: the live one of a shutdown on today, else its test one, else the latest. */
export function currentTracker(list: Tracker[], today: string): Tracker | null {
  const on = (t: Tracker) => !!t.eventStart && !!t.eventEnd && t.eventStart <= today && today <= t.eventEnd;
  return list.find((t) => on(t) && t.mode === 'live') ?? list.find((t) => on(t)) ?? list.find((t) => t.mode === 'live') ?? list[0] ?? null;
}

interface StepRow { id: string; step_id: string; fo: string; gate: number; gate_name: string | null; short_name: string; step_text: string | null; procedure: string | null; prereq: string[] | null; est_hours: number | null; note: string | null; target_at: string | null; status: StepStatus; pending_reason: string | null; remark: string | null; updated_by_name: string | null; updated_at: string | null; started_at: string | null; done_at: string | null }
interface EqRow { id: string; tag: string; grp: string; description: string | null; fo: string | null; ho_step: string | null; procedure: string | null; barchart_key: string | null; ops_item: boolean; critical: boolean; tracked: boolean; disabled_reason: string | null; planned_ho: string | null; planned_finish: string | null; sort: number; stage: number; pending_reason: string | null; remark: string | null; blinds_in_at: string | null; blinds_out_at: string | null; updated_by_name: string | null; updated_at: string | null; combine?: string | null; linked?: string | null; system?: string | null; list?: string | null; insp_ref?: string | null; insp_work?: string | null; covered_by?: string | null }
interface IatRow { ops_label?: string | null; updated_by_name?: string | null; updated_at?: string | null; ops_none?: boolean | null; spool_only?: boolean | null; ops_action?: boolean | null; ho_required?: boolean | null; id: string; tag: string; iat_no: string; job_text: string | null; discipline: string | null; issued_at: string; status: 'open' | 'closed'; closed_at: string | null; wo?: string | null; line?: string | null; sheet_status?: string | null; remark?: string | null;
  finding?: string | null; recommendation?: string | null; line_class?: string | null; material?: string | null; checks?: Record<string, string> | null; painting?: Record<string, string> | null; action_by?: string | null }
interface ActRow { id: string; activity_id: string; grp: string | null; equipment_key: string; activity: string; duration_h: number | null; planned_start: string | null; planned_finish: string | null; stage: number | null; tracked: boolean; baseline: number; actual_start: string | null; actual_finish: string | null; actual_note: string | null; disabled_reason: string | null; seq?: number | null; detail?: boolean | null; p6_activity?: string | null; updated_by_name: string | null; updated_at: string | null }
interface PointRow { requirement?: TrkPoint['requirement']; requirement_reason?: string | null; requirement_by_name?: string | null; requirement_at?: string | null; hold_reason?: string | null; hold_at?: string | null; id: string; kind: TrkPoint['kind']; grp: TrkPoint['grp']; ref: string; name: string; detail: string | null; fo: string | null; step_id: string | null; items: string[] | null; requires?: string[] | null; method?: string | null; part_of?: string[] | null; after_acts?: string[] | null; before_ho: boolean; sort: number; status: PointStatus;
  in_at: string | null; out_at: string | null; fill_at: string | null; soak_at: string | null; drain_at: string | null; done_at: string | null; soak_h: number | null; remark: string | null; updated_by_name: string | null; updated_at: string | null }
interface LogRow { kind: TrkLog['kind']; ref: string; field: string; old_value: string | null; new_value: string | null; by_name: string | null; at: string }
export interface ShiftLog { id: string; shiftDate: string; shift: 'D' | 'N'; notes: string | null; temps: Record<string, string>; updatedBy: string | null }

export interface TrackerData extends TrkData { tracker: Tracker; shiftLogs: ShiftLog[] }

// the U-12 process lineup (P&ID streams) does not change during a session: fetched once
let lineupOnce: ReturnType<typeof fetchLineup> | null = null;
const fetchLineup = () => Promise.all([supabase.from('lu_streams').select('id,frm,to_tag,fluid,line,line_nos,sheets,size,conf').limit(2000),
  supabase.from('lu_equipment').select('tag,plant_tag,name,data,primary_sheet').limit(2000)]);

export async function fetchTrackerData(id: string): Promise<TrackerData> {
  const since = new Date(Date.now() - 4 * 864e5).toISOString();
  // everything in one round: the tracker, its lists, the lineup (cached), the SOP field steps and the drum records
  if (!lineupOnce) lineupOnce = fetchLineup().then((x) => { if (x.some((y) => y.error)) lineupOnce = null; return x; });
  const engineP = fetchEngine(id).catch(() => undefined);
  const extraP = Promise.all([lineupOnce,
    // the SOP field steps of each neutralization: optional as well
    supabase.from('trk_point_step').select('id,point_id,seq,phase,text,source,done_at,done_by_name,crane,kind,start_at,start_by_name,link_acts,link_points').eq('tracker_id', id).order('seq').limit(2000),
    // the shutdown's events (nitrogen, reactors): optional too
    supabase.from('trk_event').select('id,category,text,started_at,ended_at,by_name,ended_by_name,equipment_key').eq('tracker_id', id).order('started_at', { ascending: false }).limit(300),
    // the worklist RTJs, linked to their loops (reference only): optional
    supabase.from('trk_rtj').select('id,seq,point_id,line,iso_sheet,rtj_no,size,fitting,link,link_note').eq('tracker_id', id).order('seq').limit(2000),
    // the Put back list (small parts removed for the shutdown): optional
    supabase.from('trk_return_item').select('id,tag,kind,what,status,removed_at,serviced_at,installed_at,source,remark,updated_by_name,by_name').eq('tracker_id', id).eq('archived', false).order('tag').limit(1000),
    // the items this login does not follow (its own rows only): optional
    supabase.from('trk_follow_off').select('item_key').eq('tracker_id', id).eq('off', true).limit(2000)]);
  const [t, s, e, i, a, l, sl, pt] = await Promise.all([
    supabase.from('trk_trackers').select('id,event_id,title,mode,settings,status,unit_events(start_date,end_date,unit,title)').eq('id', id).single(),
    supabase.from('trk_steps').select('*').eq('tracker_id', id).order('step_id'),
    supabase.from('trk_equipment').select('*').eq('tracker_id', id).order('sort'),
    supabase.from('trk_iat').select('*').eq('tracker_id', id).order('issued_at'),
    supabase.from('trk_activities').select('id,activity_id,grp,equipment_key,activity,duration_h,planned_start,planned_finish,stage,tracked,baseline,actual_start,actual_finish,actual_note,disabled_reason,seq,detail,p6_activity,updated_by_name,updated_at').eq('tracker_id', id).limit(5000),
    supabase.from('trk_log').select('kind,ref,field,old_value,new_value,by_name,at').eq('tracker_id', id).gte('at', since).order('at').limit(5000),
    supabase.from('trk_shift_log').select('*').eq('tracker_id', id).order('shift_date', { ascending: false }).limit(20),
    supabase.from('trk_points').select('*').eq('tracker_id', id).eq('removed', false).order('sort'),
  ]);
  // the U-12 process lineup (P&ID streams): optional, the tracker works without it
  const [[lu, le], ps, ev, rj, rb, fo] = await extraP;
  const err = [t, s, e, i, a, l, sl, pt].find((r) => r.error)?.error; if (err) throw err;
  // what this screen has seen: a later save checks the fields it changes still hold these values
  seen('trk_steps', s.data); seen('trk_equipment', e.data); seen('trk_iat', i.data); seen('trk_activities', a.data); seen('trk_points', pt.data);
  if (!ps.error) seen('trk_point_step', ps.data); if (!ev.error) seen('trk_event', ev.data);
  const engine = (t.data as unknown as TrackerRow).settings?.progressV2 ? await engineP : undefined;
  const acts = a.data as ActRow[]; const base = Math.max(0, ...acts.map((x) => x.baseline));
  // an item out of the shutdown scope: its P6 lines stay as they are in the database, but are not counted
  const outKeys = new Set((e.data as EqRow[]).filter((r) => (r.disabled_reason ?? '').startsWith('out of scope')).map((r) => r.barchart_key ?? r.tag));
  // the items this login chose not to follow: off for this login only, as if switched off
  const offKeys = new Set(fo.error ? [] : (fo.data as { item_key: string }[]).map((r) => r.item_key));
  const eqMap = (r: EqRow): TrkEquipment => ({ id: r.id, tag: r.tag, group: r.grp, description: r.description, fo: r.fo, hoStep: r.ho_step, procedure: r.procedure, barchartKey: r.barchart_key,
    opsItem: r.ops_item, critical: r.critical, tracked: r.tracked && !offKeys.has(r.barchart_key ?? r.tag), notFollowed: offKeys.has(r.barchart_key ?? r.tag), disabledReason: r.disabled_reason, plannedHo: r.planned_ho, plannedFinish: r.planned_finish, sort: r.sort, stage: r.stage,
    pendingReason: r.pending_reason, remark: r.remark, blindsIn: r.blinds_in_at, blindsOut: r.blinds_out_at, updatedBy: r.updated_by_name, updatedAt: r.updated_at, combine: r.combine ?? null, linked: r.linked ?? null, system: r.system ?? null,
    list: r.list === 'rotating' ? 'rotating' : null, inspRef: r.insp_ref ?? null, inspWork: r.insp_work ?? null, coveredBy: r.covered_by ?? null });
  return {
    engine,
    // RTJ / injection locations covered by their loop: off the Equipment list, kept for the loop's handover
    loopItems: (e.data as EqRow[]).filter((r) => r.covered_by).map(eqMap),
    putBack: rb.error ? [] : (rb.data as { id: string; tag: string; kind: TrkReturnItem['kind']; what: string | null; status: TrkReturnItem['status']; removed_at: string | null; serviced_at: string | null; installed_at: string | null; source: string | null; remark: string | null; updated_by_name: string | null; by_name: string | null }[])
      .map((r) => ({ id: r.id, tag: r.tag, kind: r.kind, what: r.what, status: r.status, removedAt: r.removed_at, servicedAt: r.serviced_at, installedAt: r.installed_at, source: r.source, remark: r.remark, updatedBy: r.updated_by_name ?? r.by_name })),
    rtj: rj.error ? [] : (rj.data as { id: string; seq: number; point_id: string | null; line: string; iso_sheet: string | null; rtj_no: string; size: string | null; fitting: string | null; link: string | null; link_note: string | null }[])
      .map((r): TrkRtj => ({ id: r.id, seq: r.seq, pointId: r.point_id, line: r.line, isoSheet: r.iso_sheet, rtjNo: r.rtj_no, size: r.size, fitting: r.fitting, link: r.link === 'lineup' || r.link === 'unverified' ? r.link : null, linkNote: r.link_note })),
    events: ev.error ? [] : (ev.data as { id: string; category: TrkEvent['category']; text: string; started_at: string; ended_at: string | null; by_name: string | null; ended_by_name: string | null; equipment_key: string | null }[])
      .map((r): TrkEvent => ({ id: r.id, category: r.category, text: r.text, startedAt: r.started_at, endedAt: r.ended_at, by: r.by_name, endedBy: r.ended_by_name, key: r.equipment_key })),
    pointSteps: ps.error ? [] : (ps.data as { id: string; point_id: string; seq: number; phase: TrkPointStep['phase']; text: string; source: string | null; done_at: string | null; done_by_name: string | null; crane: boolean | null; kind: string | null; start_at: string | null; start_by_name: string | null; link_acts: string[] | null; link_points: string[] | null }[])
      .map((r): TrkPointStep => ({ id: r.id, pointId: r.point_id, seq: r.seq, phase: r.phase, text: r.text, source: r.source, doneAt: r.done_at, doneBy: r.done_by_name, crane: !!r.crane, kind: r.kind === 'step' ? 'step' : 'check', startAt: r.start_at, startBy: r.start_by_name, linkActs: r.link_acts ?? [], linkPoints: r.link_points ?? [] })),
    lineupEq: le.error ? [] : (le.data as { tag: string; plant_tag: string | null; name: string | null; data: string | null; primary_sheet: string | null }[])
      .map((r): LuEquip => ({ tag: r.tag, plantTag: r.plant_tag, name: r.name, data: r.data, sheet: r.primary_sheet })),
    lineup: lu.error ? [] : (lu.data as { id: string; frm: string; to_tag: string; fluid: string | null; line: string | null; line_nos: string[]; sheets: string[]; size: string | null; conf: string | null }[])
      .map((r): LuStream => ({ id: r.id, from: r.frm, to: r.to_tag, fluid: r.fluid, line: r.line, lineNos: r.line_nos ?? [], sheets: r.sheets ?? [], size: r.size, conf: r.conf })),
    tracker: toTracker(t.data as unknown as TrackerRow),
    steps: (s.data as StepRow[]).map((r): TrkStep => ({ id: r.id, stepId: r.step_id, fo: r.fo, gate: r.gate, gateName: r.gate_name, shortName: r.short_name, text: r.step_text, procedure: r.procedure,
      prereq: r.prereq ?? [], estHours: r.est_hours, note: r.note, target: r.target_at, status: r.status, pendingReason: r.pending_reason, remark: r.remark, updatedBy: r.updated_by_name, updatedAt: r.updated_at, startedAt: r.started_at, doneAt: r.done_at })),
    equipment: (e.data as EqRow[]).filter((r) => !r.covered_by).map(eqMap),
    iats: (i.data as IatRow[]).map((r): TrkIat => ({ id: r.id, tag: r.tag, iatNo: r.iat_no, jobText: r.job_text, discipline: r.discipline, issuedAt: r.issued_at, status: r.status, closedAt: r.closed_at, wo: r.wo ?? null, line: r.line ?? null, sheetStatus: r.sheet_status ?? null, remark: r.remark ?? null,
      finding: r.finding ?? null, recommendation: r.recommendation ?? null, lineClass: r.line_class ?? null, material: r.material ?? null, checks: r.checks ?? {}, painting: r.painting ?? {}, actionBy: r.action_by ?? null, opsAction: !!r.ops_action, hoRequired: !!r.ho_required, opsLabel: (r.ops_label ?? null) as TrkIat['opsLabel'], opsNone: !!r.ops_none, spoolOnly: !!r.spool_only, updatedBy: r.updated_by_name ?? null, updatedAt: r.updated_at ?? null })),
    // a combined bar-chart line split into its jobs (the database keeps it, off) is not shown: its parts are
    activities: acts.filter((x) => x.baseline === base && !['split', 'removed', 'unit'].includes(x.disabled_reason ?? '')).map((r): TrkActivity => ({ id: r.id, activityId: r.activity_id, group: r.grp, key: r.equipment_key, activity: r.activity, durationH: r.duration_h,
      start: r.planned_start, finish: r.planned_finish, stage: r.stage, tracked: r.tracked && !outKeys.has(r.equipment_key) && !offKeys.has(r.equipment_key), disabledReason: r.disabled_reason, outOfScope: outKeys.has(r.equipment_key),
      actualStart: r.actual_start, actualFinish: r.actual_finish, actualNote: r.actual_note, seq: r.seq ?? null, detail: !!r.detail, p6Activity: r.p6_activity ?? null, updatedBy: r.updated_by_name, updatedAt: r.updated_at })),
    log: (l.data as LogRow[]).map((r): TrkLog => ({ kind: r.kind, ref: r.ref, field: r.field, oldValue: r.old_value, newValue: r.new_value, byName: r.by_name, at: r.at })),
    shiftLogs: (sl.data as { id: string; shift_date: string; shift: 'D' | 'N'; notes: string | null; temps: Record<string, string> | null; updated_by_name: string | null }[])
      .map((r) => ({ id: r.id, shiftDate: r.shift_date, shift: r.shift, notes: r.notes, temps: r.temps ?? {}, updatedBy: r.updated_by_name })),
    settings: (t.data as unknown as TrackerRow).settings ?? {},
    points: (pt.data as PointRow[]).map((r): TrkPoint => ({ id: r.id, kind: r.kind, grp: r.grp ?? null, ref: r.ref, name: r.name, detail: r.detail, fo: r.fo, stepId: r.step_id, items: r.items ?? [], requires: r.requires ?? [], partOf: r.part_of ?? [], afterActs: r.after_acts ?? [], method: r.method === 'spray' ? 'spray' : 'soak', beforeHo: r.before_ho, sort: r.sort, status: r.status,
      inAt: r.in_at, outAt: r.out_at, fillAt: r.fill_at, soakAt: r.soak_at, drainAt: r.drain_at, doneAt: r.done_at, soakH: r.soak_h, remark: r.remark, updatedBy: r.updated_by_name, updatedAt: r.updated_at, holdReason: r.hold_reason ?? null, holdAt: r.hold_at ?? null,
      requirement: r.requirement ?? 'required', requirementReason: r.requirement_reason ?? null, requirementBy: r.requirement_by_name ?? null, requirementAt: r.requirement_at ?? null })),
  };
}

/** Follow an item again, or stop following it: for this login only (trk_follow_off). */
export async function setFollow(trackerId: string, key: string, follow: boolean): Promise<void> {
  const { error } = await supabase.from('trk_follow_off').upsert({ tracker_id: trackerId, item_key: key, off: !follow, updated_at: new Date().toISOString() }, { onConflict: 'tracker_id,user_id,item_key' });
  if (error) throw error;
}

// ── Saving without overwriting someone else's change ──────────────────────────────────────────────────────────
// Every row a screen loads is remembered. A save goes through only if the fields it changes still hold the values the
// screen showed; then the remembered row takes the new values, so an Undo goes through only if nobody changed those
// fields since. Otherwise nothing is written: who changed it is reported and the screens reload.
const SEEN = new Map<string, Record<string, unknown>>();
function seen(table: string, rows: unknown) { for (const r of (rows ?? []) as Record<string, unknown>[]) if (r && typeof r.id === 'string') SEEN.set(`${table}:${r.id}`, r); }
const scalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const same = (a: unknown, b: unknown) => a === b || (typeof a === 'string' && typeof b === 'string' && !Number.isNaN(Date.parse(a)) && /T\d/.test(a) && Date.parse(a) === Date.parse(b)) || (a != null && b != null && String(a) === String(b));
/** A save refused because the record changed after this screen loaded it (or the change is not allowed). */
export class ConflictError extends Error { constructor(msg: string) { super(msg); this.name = 'ConflictError'; } }
export const CONFLICT_EVENT = 'trk-conflict';
const when = (iso: string | null | undefined) => (iso ? dateTime12(iso) : '');
const upd = async (table: string, id: string, patch: Record<string, unknown>) => {
  const before = SEEN.get(`${table}:${id}`);
  let q = supabase.from(table).update(patch).eq('id', id);
  if (before) for (const k of Object.keys(patch)) {
    if (!(k in before) || !scalar(before[k])) continue;
    q = before[k] === null ? q.is(k, null) : q.eq(k, before[k] as string | number | boolean);
  }
  const { data, error } = await q.select('*');
  if (error) throw error;
  if (data && data.length) { seen(table, data); return; }
  // nothing written: someone changed it meanwhile, or this login may not change it
  const { data: now } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONFLICT_EVENT));
  if (now) {
    const row = now as Record<string, unknown>; seen(table, [row]);
    const moved = before && Object.keys(patch).some((k) => k in before && scalar(before[k]) && !same(before[k], row[k]));
    if (moved) throw new ConflictError(`Not saved: ${row.updated_by_name ?? 'someone'} changed this${row.updated_at ? ` at ${when(row.updated_at as string)}` : ''}. The screen is refreshed; check and try again.`);
  }
  throw new ConflictError('Not saved: this login may not change this record.');
};
export const setStep = (id: string, patch: Partial<{ status: StepStatus; pending_reason: string | null; remark: string | null; prereq: string[]; target_at: string | null; started_at: string | null; done_at: string | null; est_hours: number | null }>) => upd('trk_steps', id, patch);
export const setEquipment = (id: string, patch: Partial<{ stage: number; pending_reason: string | null; remark: string | null; blinds_in_at: string | null; blinds_out_at: string | null; tracked: boolean; disabled_reason: string | null; critical: boolean; planned_ho: string | null; planned_finish: string | null; description: string | null; grp: string; system: string | null; list: 'rotating' | null }>) => upd('trk_equipment', id, patch);
export const setActivity = (id: string, patch: Partial<{ activity: string; planned_start: string | null; planned_finish: string | null; duration_h: number | null; tracked: boolean; disabled_reason: string | null; stage: number | null; actual_start: string | null; actual_finish: string | null; actual_note: string | null; time_reason: string | null }>) => upd('trk_activities', id, patch);
/** A procedure activity the bar chart does not list, on an item (Section Head); in the bar chart's current baseline. */
export async function addActivity(trackerId: string, v: { key: string; activity: string; start: string | null; hours: number | null; stage: number | null }) {
  const { data: b, error: e0 } = await supabase.from('trk_activities').select('baseline').eq('tracker_id', trackerId).order('baseline', { ascending: false }).limit(1);
  if (e0) throw e0;
  const finish = v.start && v.hours ? new Date(Date.parse(v.start) + v.hours * 36e5).toISOString() : null;
  const { error } = await supabase.from('trk_activities').insert({ tracker_id: trackerId, activity_id: `P-${Date.now().toString(36).toUpperCase()}`, grp: 'Procedure', equipment_key: v.key, activity: v.activity,
    duration_h: v.hours, planned_start: v.start, planned_finish: finish, stage: v.stage, tracked: true, baseline: (b as { baseline: number }[])[0]?.baseline ?? 1 });
  if (error) throw error;
}
/** A work step added by an engineer (or anyone who updates the tracker): no planned dates, so it counts in neither
 *  the M & I % nor the forecast; placed after a step of the item (null = at the end). Returns its id. */
export async function addEngStep(trackerId: string, key: string, activity: string, order: string[], after: string | null): Promise<string> {
  const { data: b, error: e0 } = await supabase.from('trk_activities').select('baseline').eq('tracker_id', trackerId).order('baseline', { ascending: false }).limit(1);
  if (e0) throw e0;
  const id = crypto.randomUUID();
  const { error } = await supabase.from('trk_activities').insert({ id, tracker_id: trackerId, activity_id: `ENG-${Date.now().toString(36).toUpperCase()}`, grp: 'Procedure', equipment_key: key, activity,
    tracked: true, baseline: (b as { baseline: number }[])[0]?.baseline ?? 1 });
  if (error) throw error;
  const at = after ? order.indexOf(after) + 1 : order.length;
  await setOrder(trackerId, key, [...order.slice(0, at), id, ...order.slice(at)]);
  return id;
}
/** A blind or neutralization: its state (the time of each state is stamped, a time can be corrected) or a remark. */
export const setPointStep = (id: string, done: boolean) => upd('trk_point_step', id, { done_at: done ? new Date().toISOString() : null });
/** A timed field step: started / finished now, or undone (null). */
/** A field job added to a loop by the Section Head (scaffolding and the like). */
export async function addPointStep(r: { tracker_id: string; point_id: string; seq: number; phase: 'before' | 'fill' | 'after'; text: string; kind: 'check' | 'step'; crane: boolean }) {
  const { error } = await supabase.from('trk_point_step').insert({ ...r, source: 'Added on site' }); if (error) throw error;
}
export const setPointStepTime = (id: string, patch: Partial<{ start_at: string | null; done_at: string | null }>) => upd('trk_point_step', id, patch);
export const setPoint = (id: string, patch: Partial<{ requirement: 'required' | 'not_required' | 'pending' | 'n2'; requirement_reason: string | null; hold_reason: string | null; status: PointStatus; in_at: string | null; out_at: string | null; fill_at: string | null; soak_at: string | null; drain_at: string | null; done_at: string | null; remark: string | null }>) => upd('trk_points', id, patch);
export async function addIat(trackerId: string, v: { tag: string; iatNo: string; jobText: string; discipline: string }) {
  const { error } = await supabase.from('trk_iat').insert({ tracker_id: trackerId, tag: v.tag, iat_no: v.iatNo, job_text: v.jobText || null, discipline: v.discipline || null });
  if (error) throw error;
}
/** The two Operations ticks of an IAT (logged). */
export const setIatLabel = (id: string, label: string | null) => upd('trk_iat', id, { ops_label: label });
export const setIatTicks = (id: string, patch: Partial<{ ops_action: boolean; ho_required: boolean; ops_none: boolean; spool_only: boolean }>) => upd('trk_iat', id, patch);
/** A shutdown event (nitrogen, reactors, other): recorded now, ended later (logged). */
/** An event of the shutdown, or a problem on one item (key). */
export async function addEvent(trackerId: string, category: string, text: string, key: string | null = null) { const { error } = await supabase.from('trk_event').insert({ tracker_id: trackerId, category, text, equipment_key: key, started_at: new Date().toISOString() }); if (error) throw error; }
export const endEvent = (id: string, ended: boolean) => upd('trk_event', id, { ended_at: ended ? new Date().toISOString() : null });
/** The change log of the last days (newest first), for the Section Head's log page. */
export async function fetchChangeLog(trackerId: string, days: number): Promise<TrkLog[]> {
  const { data, error } = await supabase.from('trk_log').select('kind,ref,field,old_value,new_value,by_name,at').eq('tracker_id', trackerId)
    .gte('at', new Date(Date.now() - days * 864e5).toISOString()).order('at', { ascending: false }).limit(3000);
  if (error) throw error;
  return (data as { kind: TrkLog['kind']; ref: string; field: string; old_value: string | null; new_value: string | null; by_name: string | null; at: string }[])
    .map((r) => ({ kind: r.kind, ref: r.ref, field: r.field, oldValue: r.old_value, newValue: r.new_value, byName: r.by_name, at: r.at }));
}
/** One item's history (newest first): its own changes and its steps', with the reason given. */
export async function fetchItemLog(trackerId: string, tag: string, key: string): Promise<TrkLog[]> {
  const { data, error } = await supabase.from('trk_log').select('kind,ref,field,old_value,new_value,by_name,at,reason').eq('tracker_id', trackerId)
    .or(`ref.eq.${JSON.stringify(tag)},ref.like.${JSON.stringify(key + ' · %')}`).order('at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data as { kind: TrkLog['kind']; ref: string; field: string; old_value: string | null; new_value: string | null; by_name: string | null; at: string; reason: string | null }[])
    .map((r) => ({ kind: r.kind, ref: r.ref, field: r.field, oldValue: r.old_value, newValue: r.new_value, reason: r.reason, byName: r.by_name, at: r.at }));
}
export const setEventText = (id: string, text: string) => upd('trk_event', id, { text });
export const closeIat = (id: string) => upd('trk_iat', id, { status: 'closed', closed_at: new Date().toISOString(), sheet_status: 'Completed' });
/** The IAT status as in the tracking sheet (Completed / Cancelled close it) and its remark. */
export const setIatStatus = (id: string, sheetStatus: string, closed: boolean, remark?: string | null) =>
  upd('trk_iat', id, { sheet_status: sheetStatus, status: closed ? 'closed' : 'open', closed_at: closed ? new Date().toISOString() : null, ...(remark !== undefined ? { remark } : {}) });
/** Put an IAT back as it was (undo). */
export const restoreIat = (id: string, v: { sheetStatus: string | null; status: 'open' | 'closed'; closedAt: string | null; remark: string | null }) =>
  upd('trk_iat', id, { sheet_status: v.sheetStatus, status: v.status, closed_at: v.closedAt, remark: v.remark });
export async function saveShiftLog(trackerId: string, shiftDate: string, shift: 'D' | 'N', v: { notes: string; temps: Record<string, string> }) {
  const { error } = await supabase.from('trk_shift_log').upsert({ tracker_id: trackerId, shift_date: shiftDate, shift, notes: v.notes || null, temps: v.temps }, { onConflict: 'tracker_id,shift_date,shift' });
  if (error) throw error;
}
export async function setTrackerSettings(id: string, settings: TrkSettings) { const { error } = await supabase.from('trk_trackers').update({ settings }).eq('id', id); if (error) throw error; }
export async function importBarchart(trackerId: string, rows: Record<string, string>[]): Promise<number> {
  const { data, error } = await supabase.rpc('trk_import_barchart', { p_tracker: trackerId, p_rows: rows });
  if (error) throw error; return data as number;
}
/** Put an item's work steps in this order (empty = back to the plan order); logged. */
export async function setOrder(trackerId: string, key: string, ids: string[]): Promise<void> { const { error } = await supabase.rpc('trk_set_order', { p_tracker: trackerId, p_key: key, p_ids: ids }); if (error) throw error; }
export async function resetTest(trackerId: string): Promise<string> { const { data, error } = await supabase.rpc('trk_reset', { p_tracker: trackerId }); if (error) throw error; return data as string; }
export async function publishTracker(trackerId: string): Promise<string> { const { data, error } = await supabase.rpc('trk_publish', { p_tracker: trackerId }); if (error) throw error; return data as string; }

// ── progress engine (phase 2): drum accounts, shift entries, estimate revisions, equipment updates ──────────────
interface ScopeRow { id: string; equipment_key: string; scope: 'removal' | 'loading'; unit: string | null; range_low: number | null; range_high: number | null; initial_estimate: number | null; working_estimate: number | null; activity_ids: string[] | null; complete_at: string | null; complete_by_name: string | null }
interface EntryRow { id: string; scope_id: string; shift_date: string; shift: Shift; kind: QtyKind; method: QtyMethod; qty: number; corrects: string | null; stoppage: string | null; remark: string | null; source: 'field' | 'plant_report';
  entered_by: string | null; entered_by_name: string | null; entered_at: string; verify_state: TrkQtyEntry['verify']; verified_by_name: string | null; verified_at: string | null }
async function fetchEngine(id: string): Promise<TrkEngine> {
  const [sc, up] = await Promise.all([supabase.from('trk_qty_scope').select('*').eq('tracker_id', id), supabase.from('trk_update').select('*').eq('tracker_id', id).order('at', { ascending: false }).limit(500)]);
  if (sc.error) throw sc.error; if (up.error) throw up.error;
  const ids = (sc.data as ScopeRow[]).map((r) => r.id);
  const [en, es] = ids.length ? await Promise.all([supabase.from('trk_qty_entry').select('*').in('scope_id', ids).order('entered_at').limit(5000), supabase.from('trk_qty_estimate').select('*').in('scope_id', ids).order('at')])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (en.error) throw en.error; if (es.error) throw es.error;
  return {
    scopes: (sc.data as ScopeRow[]).map((r) => ({ id: r.id, key: r.equipment_key, scope: r.scope, unit: r.unit, low: r.range_low, high: r.range_high, initial: r.initial_estimate, working: r.working_estimate,
      activityIds: r.activity_ids ?? [], completeAt: r.complete_at, completeBy: r.complete_by_name })),
    entries: (en.data as EntryRow[]).map((r): TrkQtyEntry => ({ id: r.id, scopeId: r.scope_id, shiftDate: r.shift_date, shift: r.shift, kind: r.kind, method: r.method, qty: Number(r.qty), corrects: r.corrects, stoppage: r.stoppage,
      verify: r.verify_state, remark: r.remark, source: r.source, enteredBy: r.entered_by, enteredByName: r.entered_by_name, enteredAt: r.entered_at, verifiedByName: r.verified_by_name, verifiedAt: r.verified_at })),
    estimates: (es.data as { id: string; scope_id: string; value: number; reason: string; by_name: string | null; at: string }[]).map((r) => ({ id: r.id, scopeId: r.scope_id, value: Number(r.value), reason: r.reason, byName: r.by_name, at: r.at })),
    updates: (up.data as { id: string; equipment_key: string; kind: TrkUpdate['kind']; reason: string | null; expected_finish: string | null; by_name: string | null; at: string }[])
      .map((r) => ({ id: r.id, key: r.equipment_key, kind: r.kind, reason: r.reason, expectedFinish: r.expected_finish, byName: r.by_name, at: r.at })),
  };
}
/** The database's own wording for the rules a shift entry breaks, in plain words. */
function qtyError(e: { code?: string; message?: string }): Error {
  if (e.code === '23505') return new Error('Drums for this shift and method are already entered. Use Correct on that entry to change them.');
  if (e.code === '23514') return new Error(/check2/.test(e.message ?? '') ? 'A shift with 0 drums needs the reason (stoppage).' : /check1/.test(e.message ?? '') ? 'A correction needs the entry it corrects and a remark.' : 'Drums cannot be negative.');
  return new Error(e.message ?? 'Not saved.');
}
export async function addQtyEntry(scopeId: string, v: { shiftDate: string; shift: Shift; kind: QtyKind; method: QtyMethod; qty: number; stoppage?: string | null; remark?: string | null; corrects?: string | null; source?: 'field' | 'plant_report'; verified?: boolean }) {
  const { error } = await supabase.from('trk_qty_entry').insert({ scope_id: scopeId, shift_date: v.shiftDate, shift: v.shift, kind: v.kind, method: v.method, qty: v.qty, stoppage: v.stoppage || null, remark: v.remark || null, corrects: v.corrects ?? null, ...(v.source ? { source: v.source } : {}), ...(v.verified ? { verify_state: 'verified' } : {}) });
  if (error) throw qtyError(error);
}
export async function verifyQtyEntry(id: string, state: 'verified' | 'rejected') { const { error } = await supabase.from('trk_qty_entry').update({ verify_state: state }).eq('id', id); if (error) throw new Error(error.message); }
export async function reviseEstimate(scopeId: string, value: number, reason: string) { const { error } = await supabase.from('trk_qty_estimate').insert({ scope_id: scopeId, value, reason }); if (error) throw error; }
export async function confirmEmpty(scopeId: string) { const { error } = await supabase.from('trk_qty_scope').update({ complete_at: new Date().toISOString() }).eq('id', scopeId); if (error) throw new Error(error.message); }
export async function addUpdate(trackerId: string, v: { key: string; kind: TrkUpdate['kind']; reason?: string | null; expectedFinish?: string | null }) {
  const { error } = await supabase.from('trk_update').insert({ tracker_id: trackerId, equipment_key: v.key, kind: v.kind, reason: v.reason || null, expected_finish: v.expectedFinish || null });
  if (error) throw new Error(error.message);
}

// ── Engineer links: a personal link (hidden key) + an ID updates the tracker without an app login ─────────────────
export interface TrkAccess { id: string; loginId: string; active: boolean; createdAt: string; createdBy: string | null; lastSeenAt: string | null }
export async function fetchAccess(trackerId: string): Promise<TrkAccess[]> {
  const { data, error } = await supabase.from('trk_access').select('id,login_id,active,created_at,created_by_name,last_seen_at').eq('tracker_id', trackerId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data as { id: string; login_id: string; active: boolean; created_at: string; created_by_name: string | null; last_seen_at: string | null }[])
    .map((r) => ({ id: r.id, loginId: r.login_id, active: r.active, createdAt: r.created_at, createdBy: r.created_by_name, lastSeenAt: r.last_seen_at }));
}
/** A new link for an ID: the key is made here and only its hash is stored; the link is shown once. */
export async function createAccess(trackerId: string, loginId: string, by: string): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(24));
  const key = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const { error } = await supabase.from('trk_access').insert({ tracker_id: trackerId, login_id: loginId, key_hash: hash, created_by_name: by });
  if (error) throw error;
  return `${window.location.origin}${import.meta.env.BASE_URL}?sd=${key}`;
}
export const setAccessActive = (id: string, active: boolean) => upd('trk_access', id, { active });

// ── Earlier start / finish times ──────────────────────────────────────────────────────────────────────────────
/** A correction, or a time more than this far back, needs a reason (the database trigger enforces the same); only
 *  Engineers, engineer links and the Section Head enter times that far back. */
export const BACKDATE_LIMIT_H = 48;

/** The Put back list: a part's status (removed → serviced → installed), a new part, or taken off the list (kept). */
export async function setReturnItem(id: string, patch: { status?: TrkReturnItem['status']; remark?: string | null; archived?: boolean }) {
  const { error } = await supabase.from('trk_return_item').update(patch).eq('id', id); if (error) throw error;
}
export async function addReturnItem(trackerId: string, v: { tag: string; kind: TrkReturnItem['kind']; what: string | null }) {
  const { error } = await supabase.from('trk_return_item').insert({ tracker_id: trackerId, tag: v.tag, kind: v.kind, what: v.what, removed_at: new Date().toISOString() }); if (error) throw error;
}
