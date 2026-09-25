import { supabase } from './supabase';
import { dataChanged } from './changes';
import type { MpAbsence, MpAssignment, MpPerson } from '@/core/manpower';
import type { LeaveApproval } from '@/core/controllers/leaveRules';
import type { ControllerAssignment, EmployeeDirectoryRow } from './types';
import { toMpAbsence, toMpPerson } from './manpower';

export const toMpAssignment = (a: ControllerAssignment): MpAssignment =>
  ({ id: a.id, kind: a.kind, employeeId: a.employee_id, crew: a.crew_code, start: a.start_date, end: a.end_date, coversEmployeeId: a.covers_employee_id });

/** The database enforces the Controller Management rules; turn its refusals into plain sentences. */
function friendly(error: { message: string; code?: string }): Error {
  const m = error.message;
  if (m.includes('ca_one_at_a_time')) return new Error('This Controller already has an assignment on some of these dates. One person cannot cover two shifts at the same time.');
  if (m.includes('ca_one_cover_per_crew')) return new Error('This crew already has a cover recorded on some of these dates.');
  if (m.includes('ca_one_morning_rotation')) return new Error('Another Morning rotation already covers some of these dates.');
  if (m.includes('ca_morning_rotation_max_two_months')) return new Error('A Morning rotation can last at most 2 months.');
  if (m.includes('A shift cover can last at most')) return new Error(m.replace(/^.*?(A shift cover)/, '$1'));
  if (m.includes('ca_dates')) return new Error('The end date is before the start date.');
  return new Error(m);
}

export async function fetchAssignments(): Promise<ControllerAssignment[]> {
  const { data, error } = await supabase.from('controller_assignments').select('*').order('start_date', { ascending: false });
  if (error) throw error;
  return data as ControllerAssignment[];
}

export async function createAssignment(a: { kind: ControllerAssignment['kind']; employee_id: string; crew_code: string | null; covers_employee_id: string | null; start_date: string; end_date: string; note: string | null }) {
  const { error } = await supabase.from('controller_assignments').insert(a);
  if (error) throw friendly(error);
  dataChanged();
}

export async function endAssignmentEarly(id: string, end_date: string, note: string | null) {
  const { error } = await supabase.from('controller_assignments').update({ end_date, ...(note ? { note } : {}) }).eq('id', id);
  if (error) throw friendly(error);
  dataChanged();
}

export async function cancelAssignment(id: string, reason: string) {
  const { error } = await supabase.from('controller_assignments').update({ status: 'cancelled', cancel_reason: reason }).eq('id', id);
  if (error) throw friendly(error);
  dataChanged();
}

/** Optional maximum length of a shift cover in days (null = no maximum; the cover lasts the actual period). */
export async function fetchShiftCoverMaxDays(): Promise<number | null> {
  const { data, error } = await supabase.from('controller_rules').select('shift_cover_max_days').eq('id', 1).maybeSingle();
  if (error) throw error;
  return (data as { shift_cover_max_days: number | null } | null)?.shift_cover_max_days ?? null;
}

export async function setShiftCoverMaxDays(days: number | null) {
  const { error } = await supabase.from('controller_rules').update({ shift_cover_max_days: days, updated_at: new Date().toISOString() }).eq('id', 1);
  if (error) throw error;
  dataChanged();
}

// ------------------------------------------------------------------ Controller leave rules (approvals)

interface ApprovalRow { id: string; kind: 'overlap' | 'extra_leave'; leave_a: string; leave_b: string | null; note: string | null; created_at: string }
const toApproval = (r: ApprovalRow): LeaveApproval => ({ id: r.id, kind: r.kind, leaveA: r.leave_a, leaveB: r.leave_b, note: r.note, createdAt: r.created_at });

/** The Section Head's active approvals of Controller leave exceptions. */
export async function fetchLeaveApprovals(): Promise<LeaveApproval[]> {
  const { data, error } = await supabase.from('controller_leave_approvals').select('id,kind,leave_a,leave_b,note,created_at').eq('status', 'active');
  if (error) throw error;
  return (data as ApprovalRow[]).map(toApproval);
}

/** Approve two Controllers on leave together (`leaveB` set) or an extra leave in the year (Section Head only). */
export async function approveLeaveException(v: { kind: 'overlap' | 'extra_leave'; leaveA: string; leaveB: string | null; note: string }) {
  const { error } = await supabase.from('controller_leave_approvals').insert({ kind: v.kind, leave_a: v.leaveA, leave_b: v.leaveB, note: v.note.trim() || null });
  if (error) throw new Error(error.message.includes('cla_one_active') ? 'This is already approved.' : error.code === '42501' ? 'Only the Section Head can approve.' : error.message);
  dataChanged();
}

export async function withdrawLeaveApproval(id: string, reason: string) {
  const { error } = await supabase.from('controller_leave_approvals').update({ status: 'withdrawn', withdraw_reason: reason }).eq('id', id);
  if (error) throw error;
  dataChanged();
}

/** Controllers, their counted leave overlapping [from, to] and the active approvals (for the rules check). */
export async function fetchControllerLeave(from: string, to: string): Promise<{ people: MpPerson[]; absences: MpAbsence[]; approvals: LeaveApproval[] }> {
  const { data: dir, error } = await supabase.from('employee_directory_v').select('*').eq('in_unit12_scope', true).eq('is_active', true)
    .in('position_code', ['controller', 'vr_controller', 'morning_controller']);
  if (error) throw error;
  const people = (dir as EmployeeDirectoryRow[]).map(toMpPerson);
  const [lv, approvals] = await Promise.all([
    people.length ? supabase.from('leave_records').select('id,employee_id,start_date,end_date,status,absence_type_code,source_ref,in_current_plan,oracle_status,absence_types(label,short_code)')
      .in('employee_id', people.map((p) => p.id)).eq('in_current_plan', true).in('status', ['approved', 'planned']).lte('start_date', to).gte('end_date', from)
      : Promise.resolve({ data: [], error: null }),
    fetchLeaveApprovals()
  ]);
  if (lv.error) throw lv.error;
  return { people, absences: (lv.data as unknown as Parameters<typeof toMpAbsence>[0][]).map(toMpAbsence), approvals };
}
