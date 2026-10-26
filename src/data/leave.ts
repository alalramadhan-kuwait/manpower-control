// Leave entered or corrected by hand, and the data for the Annual Leave Plan.
// The database functions leave_save / leave_cancel do each change in one transaction, keep history and refuse
// overlaps; their refusal messages are already plain sentences.
import { supabase } from './supabase';
import { openFrom, withOpenEnd } from './openEnd';
import { dataChanged } from './changes';
import type { OracleStatus } from '@/core/oracle';
import type { OracleLogEntry, PendingLeaveRequest } from '@/core/leave/status';
import type { AbsenceType, ControllerAssignment, EmployeeDirectoryRow, LeavePlanChange, LeaveRecord } from './types';

const plain = (error: { message: string }) => new Error(error.message);


/** Mark a current leave's dates as an estimate (until the final notice) or confirmed. */
export async function setLeaveEstimated(record: string, estimated: boolean): Promise<void> {
  const { error } = await supabase.rpc('leave_set_estimated', { p_record: record, p_estimated: estimated });
  if (error) throw plain(error);
  dataChanged();
}

export interface EstimatedLeave { id: string; employee_id: string; start_date: string; end_date: string; absence_type_code: string | null }
/** Current leave whose dates are still an estimate. */
export async function fetchEstimatedLeaves(): Promise<EstimatedLeave[]> {
  const { data, error } = await supabase.from('leave_records').select('id,employee_id,start_date,end_date,absence_type_code')
    .eq('dates_estimated', true).eq('in_current_plan', true).in('status', ['approved', 'planned']).or(openFrom('2000-01-01')).order('start_date').limit(500);
  if (error) throw error;
  return withOpenEnd(data) as EstimatedLeave[];
}


/** The Section Head approves (or takes back the approval of) leave records; a planned PV counts only once approved. */
export async function approveLeave(records: string[], approve = true): Promise<number> {
  const { data, error } = await supabase.rpc('leave_approve', { p_records: records, p_approve: approve });
  if (error) throw plain(error);
  dataChanged();
  return data as number;
}

/** The Section Head refuses (or takes back the refusal of) planned PVs, with an optional reason. */
export async function declineLeave(records: string[], decline = true, reason?: string): Promise<number> {
  const { data, error } = await supabase.rpc('leave_decline', { p_records: records, p_decline: decline, p_reason: reason?.trim() || null });
  if (error) throw plain(error);
  dataChanged();
  return data as number;
}

/** The Section Head sends planned PVs to the Manpower Coordinator to fix the dates (or takes them back). */
export async function sendLeaveToFix(records: string[], note: string, send = true): Promise<number> {
  const { data, error } = await supabase.rpc('leave_send_fix', { p_records: records, p_note: note.trim() || null, p_send: send });
  if (error) throw plain(error);
  dataChanged();
  return data as number;
}

export interface LeaveDecision { id: string; declined_at: string | null; declined_reason: string | null; fix_note: string | null; fix_sent_at: string | null }
/** The decisions on current leave that the manpower inputs do not carry: refusals with their reason, and notes to fix. */
export async function fetchLeaveDecisions(): Promise<Map<string, LeaveDecision>> {
  const { data, error } = await supabase.from('leave_records').select('id,declined_at,declined_reason,fix_note,fix_sent_at')
    .eq('in_current_plan', true).or('declined_at.not.is.null,fix_sent_at.not.is.null').limit(2000);
  if (error) throw error;
  return new Map((data as LeaveDecision[]).map((r) => [r.id, r]));
}

/** A person's sick-leave days per year (the imported totals), newest year first. */
export async function fetchSickDays(employeeId: string): Promise<{ year: number; days: number; asOf: string | null }[]> {
  const { data, error } = await supabase.from('sick_leave_totals').select('year,days,reported_as_of').eq('employee_id', employeeId).order('year', { ascending: false }).limit(5);
  if (error) throw error;
  return (data as { year: number; days: number; reported_as_of: string | null }[]).map((r) => ({ year: r.year, days: Number(r.days), asOf: r.reported_as_of }));
}

/** Mark one or many current leave records in Oracle HR (the ref is kept unless a new one is given). Returns how many changed. */
export async function setOracleStatus(records: string[], status: OracleStatus, ref?: string): Promise<number> {
  const { data, error } = await supabase.rpc('leave_set_oracle', { p_records: records, p_status: status, p_ref: ref?.trim() || null });
  if (error) throw plain(error);
  dataChanged();
  return data as number;
}

export interface OracleRow { id: string; employee_id: string; start_date: string; end_date: string; absence_type_code: string | null; oracle_status: OracleStatus; oracle_ref: string | null; oracle_updated_at: string | null; absence_types: { label: string; short_code: string | null } | null }

/** Current-plan leave not finished before `from`, with its Oracle HR status. */
export async function fetchOracleLeaves(from: string): Promise<OracleRow[]> {
  const { data, error } = await supabase.from('leave_records')
    .select('id,employee_id,start_date,end_date,absence_type_code,oracle_status:approval_state,oracle_ref,oracle_updated_at,absence_types(label,short_code)')
    .eq('in_current_plan', true).in('status', ['approved', 'planned']).or(openFrom(from)).order('start_date').limit(5000);
  if (error) throw error;
  return withOpenEnd(data as { end_date: string | null }[]) as unknown as OracleRow[];
}

export interface LeavePlanData {
  people: EmployeeDirectoryRow[];
  leaves: LeaveRecord[];
  changes: LeavePlanChange[];
  types: AbsenceType[];
  covers: ControllerAssignment[];
}

/** Everything the Annual Leave Plan shows for one year: in-scope people, every leave record touching the year
 *  (current and history), the change history, leave types and active Controller covers. */
export async function fetchLeavePlan(year: number): Promise<LeavePlanData> {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [dir, lv, ch, ty, ca] = await Promise.all([
    supabase.from('employee_directory_v').select('*').eq('in_unit12_scope', true).eq('is_active', true),
    supabase.from('leave_records').select('*').lte('start_date', to).or(openFrom(from)).order('start_date').limit(5000),
    supabase.from('leave_plan_changes').select('*').order('created_at', { ascending: false }).limit(5000),
    supabase.from('absence_types').select('*').order('sort_order'),
    supabase.from('controller_assignments').select('*').eq('status', 'active').eq('kind', 'shift_cover').lte('start_date', to).gte('end_date', from)
  ]);
  const err = [dir, lv, ch, ty, ca].find((r) => r.error)?.error;
  if (err) throw err;
  return {
    people: dir.data as EmployeeDirectoryRow[], leaves: withOpenEnd(lv.data as LeaveRecord[]) as LeaveRecord[], changes: ch.data as LeavePlanChange[],
    types: ty.data as AbsenceType[], covers: ca.data as ControllerAssignment[]
  };
}

/** Every version of one leave (its first record and all later ones), oldest first. */
export async function fetchLeaveVersions(rootId: string): Promise<LeaveRecord[]> {
  const { data, error } = await supabase.from('leave_records').select('*').eq('root_id', rootId).order('version_no').order('created_at').limit(50);
  if (error) throw error;
  return withOpenEnd(data as LeaveRecord[]) as LeaveRecord[];
}

export interface CrewMove { employeeId: string; start: string; end: string | null; crew: string; kind: 'temporary' | 'placement' }
/** What the leave lists need besides the records: the Oracle log (recorded applications only), leave requests waiting
 *  for the Section Head, and the shift movements (VR placements, temporary covers, day duty) for the actual crew. */
export interface LeaveContext { oracleLog: OracleLogEntry[]; pending: PendingLeaveRequest[]; moves: CrewMove[] }
export async function fetchLeaveContext(from: string, to: string): Promise<LeaveContext> {
  const [ol, rq, mv] = await Promise.all([
    supabase.from('oracle_requests').select('leave_root_id,start_date,end_date,status,source,status_at,recorded_at').lte('start_date', to).gte('end_date', from).limit(5000),
    supabase.from('request_headers').select('id,employee_id,summary,requested_at,start_date,end_date,request_leave(absence_type_code,start_date,end_date,action,target_record_id)')
      .eq('status', 'submitted').lte('start_date', to).or(`end_date.is.null,end_date.gte.${from}`).limit(500),
    supabase.from('crew_movements').select('employee_id,start_date,end_date,to_crew,kind').eq('status', 'active').in('kind', ['temporary', 'placement'])
      .lte('start_date', to).or(`end_date.is.null,end_date.gte.${from}`)
  ]);
  // the Oracle log and the request queue are staff data: a reader without them still gets the list
  const err = mv.error; if (err) throw err;
  type Ol = { leave_root_id: string; start_date: string; end_date: string; status: OracleLogEntry['status']; source: OracleLogEntry['source']; status_at: string | null; recorded_at: string };
  type Rl = { absence_type_code: string | null; start_date: string; end_date: string | null; action: string | null; target_record_id: string | null };
  type Rh = { id: string; employee_id: string; summary: string; requested_at: string; start_date: string; end_date: string | null; request_leave: Rl | Rl[] | null };
  const one = (x: Rl | Rl[] | null) => (Array.isArray(x) ? x[0] ?? null : x);
  return {
    oracleLog: ((ol.data ?? []) as Ol[]).map((o) => ({ rootId: o.leave_root_id, start: o.start_date, end: o.end_date, status: o.status, source: o.source, at: o.status_at ?? o.recorded_at })),
    pending: ((rq.data ?? []) as Rh[]).flatMap((h) => { const l = one(h.request_leave); if (!l) return [];
      const action = (['new', 'extend', 'return', 'cancel'] as const).find((a) => a === (l.action ?? 'new')) ?? 'new';
      return [{ id: h.id, employeeId: h.employee_id, typeCode: l.absence_type_code, start: l.start_date ?? h.start_date, end: l.end_date ?? h.end_date, action, targetRecordId: l.target_record_id, requestedAt: h.requested_at, summary: h.summary }]; }),
    moves: (mv.data as { employee_id: string; start_date: string; end_date: string | null; to_crew: string; kind: CrewMove['kind'] }[])
      .map((m) => ({ employeeId: m.employee_id, start: m.start_date, end: m.end_date, crew: m.to_crew, kind: m.kind }))
  };
}

/** Record the Oracle HR application of one leave version, as confirmed by a person (submitted / approved / rejected),
 *  in the Oracle log (oracle_request_record: staff only, who and when kept). Never set without that confirmation. */
export async function recordOracle(recordId: string, status: 'submitted' | 'approved' | 'rejected', ref?: string): Promise<void> {
  const { error } = await supabase.rpc('oracle_request_record', { p_leave: recordId, p_status: status, p_ref: ref?.trim() || null, p_start: null, p_end: null, p_note: null });
  if (error) throw plain(error);
  dataChanged();
}
