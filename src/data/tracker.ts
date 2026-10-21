// Shutdown progress tracker: the trackers of the calendar shutdowns (template / test / live), their steps, equipment,
// IATs, bar chart, shift log and change log. Who and when are stamped by the database on every change.
import { supabase } from './supabase';
import type { QtyKind, QtyMethod, Shift, TrkEngine, TrkQtyEntry, TrkUpdate, PointStatus, StepStatus, TrkActivity, TrkData, TrkEquipment, TrkIat, TrkLog, LuEquip, LuStream, TrkPoint, TrkPointStep, TrkSettings, TrkStep } from '@/core/tracker';

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
interface EqRow { id: string; tag: string; grp: string; description: string | null; fo: string | null; ho_step: string | null; procedure: string | null; barchart_key: string | null; ops_item: boolean; critical: boolean; tracked: boolean; disabled_reason: string | null; planned_ho: string | null; planned_finish: string | null; sort: number; stage: number; pending_reason: string | null; remark: string | null; blinds_in_at: string | null; blinds_out_at: string | null; updated_by_name: string | null; updated_at: string | null; combine?: string | null }
interface IatRow { id: string; tag: string; iat_no: string; job_text: string | null; discipline: string | null; issued_at: string; status: 'open' | 'closed'; closed_at: string | null; wo?: string | null; line?: string | null; sheet_status?: string | null; remark?: string | null;
  finding?: string | null; recommendation?: string | null; line_class?: string | null; material?: string | null; checks?: Record<string, string> | null; painting?: Record<string, string> | null; action_by?: string | null }
interface ActRow { id: string; activity_id: string; grp: string | null; equipment_key: string; activity: string; duration_h: number | null; planned_start: string | null; planned_finish: string | null; stage: number | null; tracked: boolean; baseline: number; actual_start: string | null; actual_finish: string | null; actual_note: string | null; disabled_reason: string | null; seq?: number | null; detail?: boolean | null; updated_by_name: string | null; updated_at: string | null }
interface PointRow { id: string; kind: TrkPoint['kind']; grp: TrkPoint['grp']; ref: string; name: string; detail: string | null; fo: string | null; step_id: string | null; items: string[] | null; requires?: string[] | null; method?: string | null; part_of?: string[] | null; after_acts?: string[] | null; before_ho: boolean; sort: number; status: PointStatus;
  in_at: string | null; out_at: string | null; fill_at: string | null; soak_at: string | null; drain_at: string | null; done_at: string | null; soak_h: number | null; remark: string | null; updated_by_name: string | null; updated_at: string | null }
interface LogRow { kind: TrkLog['kind']; ref: string; field: string; old_value: string | null; new_value: string | null; by_name: string | null; at: string }
export interface ShiftLog { id: string; shiftDate: string; shift: 'D' | 'N'; notes: string | null; temps: Record<string, string>; updatedBy: string | null }

export interface TrackerData extends TrkData { tracker: Tracker; shiftLogs: ShiftLog[] }

export async function fetchTrackerData(id: string): Promise<TrackerData> {
  const since = new Date(Date.now() - 4 * 864e5).toISOString();
  const [t, s, e, i, a, l, sl, pt] = await Promise.all([
    supabase.from('trk_trackers').select('id,event_id,title,mode,settings,status,unit_events(start_date,end_date,unit,title)').eq('id', id).single(),
    supabase.from('trk_steps').select('*').eq('tracker_id', id).order('step_id'),
    supabase.from('trk_equipment').select('*').eq('tracker_id', id).order('sort'),
    supabase.from('trk_iat').select('*').eq('tracker_id', id).order('issued_at'),
    supabase.from('trk_activities').select('id,activity_id,grp,equipment_key,activity,duration_h,planned_start,planned_finish,stage,tracked,baseline,actual_start,actual_finish,actual_note,disabled_reason,seq,detail,updated_by_name,updated_at').eq('tracker_id', id).limit(5000),
    supabase.from('trk_log').select('kind,ref,field,old_value,new_value,by_name,at').eq('tracker_id', id).gte('at', since).order('at').limit(5000),
    supabase.from('trk_shift_log').select('*').eq('tracker_id', id).order('shift_date', { ascending: false }).limit(20),
    supabase.from('trk_points').select('*').eq('tracker_id', id).eq('removed', false).order('sort'),
  ]);
  // the U-12 process lineup (P&ID streams): optional, the tracker works without it
  const [lu, le, ps] = await Promise.all([supabase.from('lu_streams').select('id,frm,to_tag,fluid,line,line_nos,sheets,size,conf').limit(2000),
    supabase.from('lu_equipment').select('tag,plant_tag,name,data,primary_sheet').limit(2000),
    // the SOP field steps of each neutralization: optional as well
    supabase.from('trk_point_step').select('id,point_id,seq,phase,text,source,done_at,done_by_name,crane,kind,start_at,start_by_name').eq('tracker_id', id).order('seq').limit(2000)]);
  const err = [t, s, e, i, a, l, sl, pt].find((r) => r.error)?.error; if (err) throw err;
  const engine = (t.data as unknown as TrackerRow).settings?.progressV2 ? await fetchEngine(id) : undefined;
  const acts = a.data as ActRow[]; const base = Math.max(0, ...acts.map((x) => x.baseline));
  return {
    engine,
    pointSteps: ps.error ? [] : (ps.data as { id: string; point_id: string; seq: number; phase: TrkPointStep['phase']; text: string; source: string | null; done_at: string | null; done_by_name: string | null; crane: boolean | null; kind: string | null; start_at: string | null; start_by_name: string | null }[])
      .map((r): TrkPointStep => ({ id: r.id, pointId: r.point_id, seq: r.seq, phase: r.phase, text: r.text, source: r.source, doneAt: r.done_at, doneBy: r.done_by_name, crane: !!r.crane, kind: r.kind === 'step' ? 'step' : 'check', startAt: r.start_at, startBy: r.start_by_name })),
    lineupEq: le.error ? [] : (le.data as { tag: string; plant_tag: string | null; name: string | null; data: string | null; primary_sheet: string | null }[])
      .map((r): LuEquip => ({ tag: r.tag, plantTag: r.plant_tag, name: r.name, data: r.data, sheet: r.primary_sheet })),
    lineup: lu.error ? [] : (lu.data as { id: string; frm: string; to_tag: string; fluid: string | null; line: string | null; line_nos: string[]; sheets: string[]; size: string | null; conf: string | null }[])
      .map((r): LuStream => ({ id: r.id, from: r.frm, to: r.to_tag, fluid: r.fluid, line: r.line, lineNos: r.line_nos ?? [], sheets: r.sheets ?? [], size: r.size, conf: r.conf })),
    tracker: toTracker(t.data as unknown as TrackerRow),
    steps: (s.data as StepRow[]).map((r): TrkStep => ({ id: r.id, stepId: r.step_id, fo: r.fo, gate: r.gate, gateName: r.gate_name, shortName: r.short_name, text: r.step_text, procedure: r.procedure,
      prereq: r.prereq ?? [], estHours: r.est_hours, note: r.note, target: r.target_at, status: r.status, pendingReason: r.pending_reason, remark: r.remark, updatedBy: r.updated_by_name, updatedAt: r.updated_at, startedAt: r.started_at, doneAt: r.done_at })),
    equipment: (e.data as EqRow[]).map((r): TrkEquipment => ({ id: r.id, tag: r.tag, group: r.grp, description: r.description, fo: r.fo, hoStep: r.ho_step, procedure: r.procedure, barchartKey: r.barchart_key,
      opsItem: r.ops_item, critical: r.critical, tracked: r.tracked, disabledReason: r.disabled_reason, plannedHo: r.planned_ho, plannedFinish: r.planned_finish, sort: r.sort, stage: r.stage,
      pendingReason: r.pending_reason, remark: r.remark, blindsIn: r.blinds_in_at, blindsOut: r.blinds_out_at, updatedBy: r.updated_by_name, updatedAt: r.updated_at, combine: r.combine ?? null })),
    iats: (i.data as IatRow[]).map((r): TrkIat => ({ id: r.id, tag: r.tag, iatNo: r.iat_no, jobText: r.job_text, discipline: r.discipline, issuedAt: r.issued_at, status: r.status, closedAt: r.closed_at, wo: r.wo ?? null, line: r.line ?? null, sheetStatus: r.sheet_status ?? null, remark: r.remark ?? null,
      finding: r.finding ?? null, recommendation: r.recommendation ?? null, lineClass: r.line_class ?? null, material: r.material ?? null, checks: r.checks ?? {}, painting: r.painting ?? {}, actionBy: r.action_by ?? null })),
    // a combined bar-chart line split into its jobs (the database keeps it, off) is not shown: its parts are
    activities: acts.filter((x) => x.baseline === base && !['split', 'removed', 'unit'].includes(x.disabled_reason ?? '')).map((r): TrkActivity => ({ id: r.id, activityId: r.activity_id, group: r.grp, key: r.equipment_key, activity: r.activity, durationH: r.duration_h,
      start: r.planned_start, finish: r.planned_finish, stage: r.stage, tracked: r.tracked,
      actualStart: r.actual_start, actualFinish: r.actual_finish, actualNote: r.actual_note, seq: r.seq ?? null, detail: !!r.detail, updatedBy: r.updated_by_name, updatedAt: r.updated_at })),
    log: (l.data as LogRow[]).map((r): TrkLog => ({ kind: r.kind, ref: r.ref, field: r.field, oldValue: r.old_value, newValue: r.new_value, byName: r.by_name, at: r.at })),
    shiftLogs: (sl.data as { id: string; shift_date: string; shift: 'D' | 'N'; notes: string | null; temps: Record<string, string> | null; updated_by_name: string | null }[])
      .map((r) => ({ id: r.id, shiftDate: r.shift_date, shift: r.shift, notes: r.notes, temps: r.temps ?? {}, updatedBy: r.updated_by_name })),
    settings: (t.data as unknown as TrackerRow).settings ?? {},
    points: (pt.data as PointRow[]).map((r): TrkPoint => ({ id: r.id, kind: r.kind, grp: r.grp ?? null, ref: r.ref, name: r.name, detail: r.detail, fo: r.fo, stepId: r.step_id, items: r.items ?? [], requires: r.requires ?? [], partOf: r.part_of ?? [], afterActs: r.after_acts ?? [], method: r.method === 'spray' ? 'spray' : 'soak', beforeHo: r.before_ho, sort: r.sort, status: r.status,
      inAt: r.in_at, outAt: r.out_at, fillAt: r.fill_at, soakAt: r.soak_at, drainAt: r.drain_at, doneAt: r.done_at, soakH: r.soak_h, remark: r.remark, updatedBy: r.updated_by_name, updatedAt: r.updated_at })),
  };
}

const upd = async (table: string, id: string, patch: Record<string, unknown>) => { const { error } = await supabase.from(table).update(patch).eq('id', id); if (error) throw error; };
export const setStep = (id: string, patch: Partial<{ status: StepStatus; pending_reason: string | null; remark: string | null; prereq: string[]; target_at: string | null; started_at: string | null; done_at: string | null; est_hours: number | null }>) => upd('trk_steps', id, patch);
export const setEquipment = (id: string, patch: Partial<{ stage: number; pending_reason: string | null; remark: string | null; blinds_in_at: string | null; blinds_out_at: string | null; tracked: boolean; disabled_reason: string | null; critical: boolean; planned_ho: string | null; planned_finish: string | null }>) => upd('trk_equipment', id, patch);
export const setActivity = (id: string, patch: Partial<{ planned_start: string | null; planned_finish: string | null; duration_h: number | null; tracked: boolean; disabled_reason: string | null; stage: number | null; actual_start: string | null; actual_finish: string | null; actual_note: string | null }>) => upd('trk_activities', id, patch);
/** A procedure activity the bar chart does not list, on an item (Section Head); in the bar chart's current baseline. */
export async function addActivity(trackerId: string, v: { key: string; activity: string; start: string | null; hours: number | null; stage: number | null }) {
  const { data: b, error: e0 } = await supabase.from('trk_activities').select('baseline').eq('tracker_id', trackerId).order('baseline', { ascending: false }).limit(1);
  if (e0) throw e0;
  const finish = v.start && v.hours ? new Date(Date.parse(v.start) + v.hours * 36e5).toISOString() : null;
  const { error } = await supabase.from('trk_activities').insert({ tracker_id: trackerId, activity_id: `P-${Date.now().toString(36).toUpperCase()}`, grp: 'Procedure', equipment_key: v.key, activity: v.activity,
    duration_h: v.hours, planned_start: v.start, planned_finish: finish, stage: v.stage, tracked: true, baseline: (b as { baseline: number }[])[0]?.baseline ?? 1 });
  if (error) throw error;
}
/** A blind or neutralization: its state (the time of each state is stamped, a time can be corrected) or a remark. */
export const setPointStep = (id: string, done: boolean) => upd('trk_point_step', id, { done_at: done ? new Date().toISOString() : null });
/** A timed field step: started / finished now, or undone (null). */
/** A field job added to a loop by the Section Head (scaffolding and the like). */
export async function addPointStep(r: { tracker_id: string; point_id: string; seq: number; phase: 'before' | 'fill' | 'after'; text: string; kind: 'check' | 'step'; crane: boolean }) {
  const { error } = await supabase.from('trk_point_step').insert({ ...r, source: 'Added on site' }); if (error) throw error;
}
export const setPointStepTime = (id: string, patch: Partial<{ start_at: string | null; done_at: string | null }>) => upd('trk_point_step', id, patch);
export const setPoint = (id: string, patch: Partial<{ status: PointStatus; in_at: string | null; out_at: string | null; fill_at: string | null; soak_at: string | null; drain_at: string | null; done_at: string | null; remark: string | null }>) => upd('trk_points', id, patch);
export async function addIat(trackerId: string, v: { tag: string; iatNo: string; jobText: string; discipline: string }) {
  const { error } = await supabase.from('trk_iat').insert({ tracker_id: trackerId, tag: v.tag, iat_no: v.iatNo, job_text: v.jobText || null, discipline: v.discipline || null });
  if (error) throw error;
}
export const closeIat = (id: string) => upd('trk_iat', id, { status: 'closed', closed_at: new Date().toISOString() });
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
export async function addQtyEntry(scopeId: string, v: { shiftDate: string; shift: Shift; kind: QtyKind; method: QtyMethod; qty: number; stoppage?: string | null; remark?: string | null; corrects?: string | null }) {
  const { error } = await supabase.from('trk_qty_entry').insert({ scope_id: scopeId, shift_date: v.shiftDate, shift: v.shift, kind: v.kind, method: v.method, qty: v.qty, stoppage: v.stoppage || null, remark: v.remark || null, corrects: v.corrects ?? null });
  if (error) throw qtyError(error);
}
export async function verifyQtyEntry(id: string, state: 'verified' | 'rejected') { const { error } = await supabase.from('trk_qty_entry').update({ verify_state: state }).eq('id', id); if (error) throw new Error(error.message); }
export async function reviseEstimate(scopeId: string, value: number, reason: string) { const { error } = await supabase.from('trk_qty_estimate').insert({ scope_id: scopeId, value, reason }); if (error) throw error; }
export async function confirmEmpty(scopeId: string) { const { error } = await supabase.from('trk_qty_scope').update({ complete_at: new Date().toISOString() }).eq('id', scopeId); if (error) throw new Error(error.message); }
export async function addUpdate(trackerId: string, v: { key: string; kind: TrkUpdate['kind']; reason?: string | null; expectedFinish?: string | null }) {
  const { error } = await supabase.from('trk_update').insert({ tracker_id: trackerId, equipment_key: v.key, kind: v.kind, reason: v.reason || null, expected_finish: v.expectedFinish || null });
  if (error) throw new Error(error.message);
}
