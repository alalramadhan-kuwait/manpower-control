// Shutdown progress tracker: the trackers of the calendar shutdowns (template / test / live), their steps, equipment,
// IATs, bar chart, shift log and change log. Who and when are stamped by the database on every change.
import { supabase } from './supabase';
import type { StepStatus, TrkActivity, TrkData, TrkEquipment, TrkIat, TrkLog, TrkSettings, TrkStep } from '@/core/tracker';

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
interface EqRow { id: string; tag: string; grp: string; description: string | null; fo: string | null; ho_step: string | null; procedure: string | null; barchart_key: string | null; ops_item: boolean; critical: boolean; tracked: boolean; disabled_reason: string | null; planned_ho: string | null; planned_finish: string | null; sort: number; stage: number; pending_reason: string | null; remark: string | null; blinds_in_at: string | null; blinds_out_at: string | null; updated_by_name: string | null; updated_at: string | null }
interface IatRow { id: string; tag: string; iat_no: string; job_text: string | null; discipline: string | null; issued_at: string; status: 'open' | 'closed'; closed_at: string | null }
interface ActRow { id: string; activity_id: string; grp: string | null; equipment_key: string; activity: string; duration_h: number | null; planned_start: string | null; planned_finish: string | null; stage: number | null; tracked: boolean; baseline: number; actual_start: string | null; actual_finish: string | null; actual_note: string | null; updated_by_name: string | null; updated_at: string | null }
interface LogRow { kind: TrkLog['kind']; ref: string; field: string; old_value: string | null; new_value: string | null; by_name: string | null; at: string }
export interface ShiftLog { id: string; shiftDate: string; shift: 'D' | 'N'; notes: string | null; temps: Record<string, string>; updatedBy: string | null }

export interface TrackerData extends TrkData { tracker: Tracker; shiftLogs: ShiftLog[] }

export async function fetchTrackerData(id: string): Promise<TrackerData> {
  const since = new Date(Date.now() - 4 * 864e5).toISOString();
  const [t, s, e, i, a, l, sl] = await Promise.all([
    supabase.from('trk_trackers').select('id,event_id,title,mode,settings,status,unit_events(start_date,end_date,unit,title)').eq('id', id).single(),
    supabase.from('trk_steps').select('*').eq('tracker_id', id).order('step_id'),
    supabase.from('trk_equipment').select('*').eq('tracker_id', id).order('sort'),
    supabase.from('trk_iat').select('*').eq('tracker_id', id).order('issued_at'),
    supabase.from('trk_activities').select('id,activity_id,grp,equipment_key,activity,duration_h,planned_start,planned_finish,stage,tracked,baseline,actual_start,actual_finish,actual_note,updated_by_name,updated_at').eq('tracker_id', id).limit(5000),
    supabase.from('trk_log').select('kind,ref,field,old_value,new_value,by_name,at').eq('tracker_id', id).gte('at', since).order('at').limit(5000),
    supabase.from('trk_shift_log').select('*').eq('tracker_id', id).order('shift_date', { ascending: false }).limit(20),
  ]);
  const err = [t, s, e, i, a, l, sl].find((r) => r.error)?.error; if (err) throw err;
  const acts = a.data as ActRow[]; const base = Math.max(0, ...acts.map((x) => x.baseline));
  return {
    tracker: toTracker(t.data as unknown as TrackerRow),
    steps: (s.data as StepRow[]).map((r): TrkStep => ({ id: r.id, stepId: r.step_id, fo: r.fo, gate: r.gate, gateName: r.gate_name, shortName: r.short_name, text: r.step_text, procedure: r.procedure,
      prereq: r.prereq ?? [], estHours: r.est_hours, note: r.note, target: r.target_at, status: r.status, pendingReason: r.pending_reason, remark: r.remark, updatedBy: r.updated_by_name, updatedAt: r.updated_at, startedAt: r.started_at, doneAt: r.done_at })),
    equipment: (e.data as EqRow[]).map((r): TrkEquipment => ({ id: r.id, tag: r.tag, group: r.grp, description: r.description, fo: r.fo, hoStep: r.ho_step, procedure: r.procedure, barchartKey: r.barchart_key,
      opsItem: r.ops_item, critical: r.critical, tracked: r.tracked, disabledReason: r.disabled_reason, plannedHo: r.planned_ho, plannedFinish: r.planned_finish, sort: r.sort, stage: r.stage,
      pendingReason: r.pending_reason, remark: r.remark, blindsIn: r.blinds_in_at, blindsOut: r.blinds_out_at, updatedBy: r.updated_by_name, updatedAt: r.updated_at })),
    iats: (i.data as IatRow[]).map((r): TrkIat => ({ id: r.id, tag: r.tag, iatNo: r.iat_no, jobText: r.job_text, discipline: r.discipline, issuedAt: r.issued_at, status: r.status, closedAt: r.closed_at })),
    activities: acts.filter((x) => x.baseline === base).map((r): TrkActivity => ({ id: r.id, activityId: r.activity_id, group: r.grp, key: r.equipment_key, activity: r.activity, durationH: r.duration_h,
      start: r.planned_start, finish: r.planned_finish, stage: r.stage, tracked: r.tracked,
      actualStart: r.actual_start, actualFinish: r.actual_finish, actualNote: r.actual_note, updatedBy: r.updated_by_name, updatedAt: r.updated_at })),
    log: (l.data as LogRow[]).map((r): TrkLog => ({ kind: r.kind, ref: r.ref, field: r.field, oldValue: r.old_value, newValue: r.new_value, byName: r.by_name, at: r.at })),
    shiftLogs: (sl.data as { id: string; shift_date: string; shift: 'D' | 'N'; notes: string | null; temps: Record<string, string> | null; updated_by_name: string | null }[])
      .map((r) => ({ id: r.id, shiftDate: r.shift_date, shift: r.shift, notes: r.notes, temps: r.temps ?? {}, updatedBy: r.updated_by_name })),
    settings: (t.data as unknown as TrackerRow).settings ?? {},
  };
}

const upd = async (table: string, id: string, patch: Record<string, unknown>) => { const { error } = await supabase.from(table).update(patch).eq('id', id); if (error) throw error; };
export const setStep = (id: string, patch: Partial<{ status: StepStatus; pending_reason: string | null; remark: string | null; prereq: string[]; target_at: string | null; started_at: string | null; done_at: string | null; est_hours: number | null }>) => upd('trk_steps', id, patch);
export const setEquipment = (id: string, patch: Partial<{ stage: number; pending_reason: string | null; remark: string | null; blinds_in_at: string | null; blinds_out_at: string | null; tracked: boolean; disabled_reason: string | null; critical: boolean; planned_ho: string | null; planned_finish: string | null }>) => upd('trk_equipment', id, patch);
export const setActivity = (id: string, patch: Partial<{ planned_start: string | null; planned_finish: string | null; duration_h: number | null; tracked: boolean; disabled_reason: string | null; stage: number | null; actual_start: string | null; actual_finish: string | null; actual_note: string | null }>) => upd('trk_activities', id, patch);
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
export async function resetTest(trackerId: string): Promise<string> { const { data, error } = await supabase.rpc('trk_reset', { p_tracker: trackerId }); if (error) throw error; return data as string; }
export async function publishTracker(trackerId: string): Promise<string> { const { data, error } = await supabase.rpc('trk_publish', { p_tracker: trackerId }); if (error) throw error; return data as string; }
