// Leave change requests: the Manpower Coordinator asks to move a leave, the Section Head decides. Every write goes through a
// database function (only the Section Head decides; approval moves the leave through leave_save and resets Oracle).
import { supabase } from './supabase';
import { dataChanged } from './changes';
import { checkRecord, type Check } from './validation';
import { acceptable } from '@/core/validation';

const changed = () => { dataChanged(); if (typeof window !== 'undefined') window.dispatchEvent(new Event('requests-changed')); };

export type ChangeStatus = 'requested' | 'approved' | 'not_approved' | 'withdrawn';
export interface ChangeImpact { short: number; dates: string[]; clash: string[] }
export interface ChangeRequest {
  id: string; employee_id: string; record_ids: string[]; old_start: string; old_end: string; new_start: string; new_end: string;
  remark: string; impact: ChangeImpact | null; status: ChangeStatus; requested_by: string | null; requested_at: string;
  decision_remarks: string | null; decided_by: string | null; decided_at: string | null; withdraw_reason: string | null; result_record_id: string | null;
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

export async function createChangeRequest(v: { records: string[]; start: string; end: string; remark: string; impact: ChangeImpact }): Promise<string> {
  const { data, error } = await supabase.rpc('change_request_create', { p_records: v.records, p_start: v.start, p_end: v.end, p_remark: v.remark, p_impact: v.impact });
  if (error) throw new Error(error.message);
  changed();
  return data as string;
}

/** Decide a reschedule. With the check seen, it goes through its request record (the check is kept with it). */
export async function decideChangeRequest(id: string, approve: boolean, remarks: string, check?: Check | null) {
  if (check) {
    const { data: h, error: e } = await supabase.from('request_headers').select('id').eq('legacy_table', 'leave_change_requests').eq('legacy_id', id).single();
    if (e) throw new Error(e.message);
    const { error } = await supabase.rpc('request_header_decide', { p_id: (h as { id: string }).id, p_approve: approve, p_note: remarks, p_check: checkRecord(check),
      p_accepted: approve ? acceptable(check.findings).map(({ rule, severity, message }) => ({ rule, severity, message })) : [] });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.rpc('change_request_decide', { p_id: id, p_approve: approve, p_remarks: remarks });
    if (error) throw new Error(error.message);
  }
  changed();
}

export async function withdrawChangeRequest(id: string, reason: string) {
  const { error } = await supabase.rpc('change_request_withdraw', { p_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
  changed();
}
