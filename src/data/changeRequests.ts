// Leave change requests: the Manpower Coordinator asks to move a leave (or to give new dates to a cancelled PV, the
// leave owed), the Section Head decides, and may change the dates first. The Section Head's own change is approved at once. Every write goes through a
// database function (only the Section Head decides; approval moves the leave through leave_save and resets Oracle).
import { supabase } from './supabase';
import { gateDecide, headerOfLegacy } from './gate';
import { dataChanged } from './changes';
import type { Check } from './validation';
import { acceptable } from '@/core/validation';

const changed = () => { dataChanged(); if (typeof window !== 'undefined') window.dispatchEvent(new Event('requests-changed')); };

export type ChangeStatus = 'requested' | 'approved' | 'not_approved' | 'withdrawn';
export interface ChangeImpact { short: number; dates: string[]; clash: string[] }
export interface ChangeRequest {
  id: string; employee_id: string; record_ids: string[]; old_start: string; old_end: string; new_start: string; new_end: string;
  remark: string; impact: ChangeImpact | null; status: ChangeStatus; requested_by: string | null; requested_at: string;
  decision_remarks: string | null; decided_by: string | null; decided_at: string | null; withdraw_reason: string | null; result_record_id: string | null;
  /** the new dates are an estimate (the new leave is marked so until confirmed) */ estimated: boolean;
  /** new dates for a cancelled planned PV: approval adds a new leave */ replan: boolean;
}
export const isChangeOpen = (r: { status: ChangeStatus }) => r.status === 'requested';

export async function fetchChangeRequests(): Promise<ChangeRequest[]> {
  const { data, error } = await supabase.from('leave_change_requests').select('*').order('requested_at', { ascending: false }).limit(500);
  if (error) throw error;
  return data as ChangeRequest[];
}

export async function countOpenChangeRequests(): Promise<number> {
  const { count, error } = await supabase.from('leave_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'requested');
  if (error) throw error;
  return count ?? 0;
}

/** Who entered requests: auth user id → display name (staff can read the profiles). */
export async function fetchRequesterNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await supabase.from('user_profiles').select('auth_user_id,display_name').in('auth_user_id', ids);
  for (const r of (data ?? []) as { auth_user_id: string; display_name: string }[]) out.set(r.auth_user_id, r.display_name);
  return out;
}

export async function createChangeRequest(v: { records: string[]; start: string; end: string; remark: string; impact: ChangeImpact; estimated?: boolean }): Promise<string> {
  const { data, error } = await supabase.rpc('change_request_create', { p_records: v.records, p_start: v.start, p_end: v.end, p_remark: v.remark, p_impact: v.impact, p_estimated: !!v.estimated });
  if (error) throw new Error(error.message);
  changed();
  return data as string;
}

/** Decide a reschedule. With the check seen, it goes through its request record (the check is kept with it). */
export async function decideChangeRequest(id: string, approve: boolean, remarks: string, check?: Check | null) {
  // through its request record and the server check (approval is checked again on the server)
  await gateDecide(await headerOfLegacy('leave_change_requests', id), approve, remarks,
    approve && check ? acceptable(check.findings).map(({ rule, severity, message }) => ({ rule, severity, message })) : []);
  changed();
}

/** Section Head: other dates for an open request, before deciding it. */
export async function amendChangeRequest(id: string, start: string, end: string, estimated: boolean) {
  const { error } = await supabase.rpc('change_request_amend', { p_id: id, p_start: start, p_end: end, p_estimated: estimated });
  if (error) throw new Error(error.message);
}

/** A planned PV cancelled (e.g. for a shutdown) and not given new dates yet: the leave owed, per person. */
export interface OwedLeave { id: string; employeeId: string; start: string; end: string; typeCode: string; note: string | null; open: boolean }
export async function fetchOwedLeave(employeeId?: string): Promise<OwedLeave[]> {
  const since = `${new Date().getFullYear() - 1}-01-01`;
  let q = supabase.from('leave_records').select('id,employee_id,start_date,end_date,absence_type_code,note,absence_types!inner(entry_mode)')
    .eq('status', 'cancelled').is('superseded_by', null).eq('absence_types.entry_mode', 'pv').gte('end_date', since).order('start_date');
  if (employeeId) q = q.eq('employee_id', employeeId);
  const [{ data, error }, open] = await Promise.all([q, supabase.from('leave_change_requests').select('record_ids').eq('status', 'requested').eq('replan', true)]);
  if (error) throw error;
  const asked = new Set(((open.data ?? []) as { record_ids: string[] }[]).map((r) => r.record_ids[0]));
  return ((data ?? []) as { id: string; employee_id: string; start_date: string; end_date: string; absence_type_code: string; note: string | null }[])
    .map((r) => ({ id: r.id, employeeId: r.employee_id, start: r.start_date, end: r.end_date, typeCode: r.absence_type_code, note: r.note, open: asked.has(r.id) }));
}

export async function withdrawChangeRequest(id: string, reason: string) {
  const { error } = await supabase.rpc('change_request_withdraw', { p_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
  changed();
}

/** Approved leave changes per employee in a calendar year: each one is counted on the employee (the section cooperated with him). */
export async function fetchChangeCounts(year: number): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('leave_change_requests').select('employee_id').eq('status', 'approved')
    .gte('decided_at', `${year}-01-01`).lt('decided_at', `${year + 1}-01-01`);
  if (error) throw error;
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { employee_id: string }[]) out.set(r.employee_id, (out.get(r.employee_id) ?? 0) + 1);
  return out;
}
