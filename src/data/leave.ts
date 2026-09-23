// Leave entered or corrected by hand, and the data for the Annual Leave Plan.
// The database functions leave_save / leave_cancel do each change in one transaction, keep history and refuse
// overlaps; their refusal messages are already plain sentences.
import { supabase } from './supabase';
import type { AbsenceType, ControllerAssignment, EmployeeDirectoryRow, LeavePlanChange, LeaveRecord } from './types';

const plain = (error: { message: string }) => new Error(error.message);

/** Add leave (`record` null) or correct one current record. Returns the id of the record now in the plan. */
export async function saveLeave(v: { record: string | null; employee: string | null; type: string; start: string; end: string; note: string }): Promise<string> {
  const { data, error } = await supabase.rpc('leave_save', { p_record: v.record, p_employee: v.employee, p_type: v.type, p_start: v.start, p_end: v.end, p_note: v.note });
  if (error) throw plain(error);
  return data as string;
}

/** Take one current record out of the plan (kept in history as cancelled). */
export async function cancelLeave(record: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('leave_cancel', { p_record: record, p_reason: reason });
  if (error) throw plain(error);
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
    supabase.from('leave_records').select('*').lte('start_date', to).gte('end_date', from).order('start_date').limit(5000),
    supabase.from('leave_plan_changes').select('*').order('created_at', { ascending: false }).limit(5000),
    supabase.from('absence_types').select('*').order('sort_order'),
    supabase.from('controller_assignments').select('*').eq('status', 'active').eq('kind', 'shift_cover').lte('start_date', to).gte('end_date', from)
  ]);
  const err = [dir, lv, ch, ty, ca].find((r) => r.error)?.error;
  if (err) throw err;
  return {
    people: dir.data as EmployeeDirectoryRow[], leaves: lv.data as LeaveRecord[], changes: ch.data as LeavePlanChange[],
    types: ty.data as AbsenceType[], covers: ca.data as ControllerAssignment[]
  };
}
