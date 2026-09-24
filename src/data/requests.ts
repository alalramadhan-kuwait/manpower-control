// Leave requests (Stage F). Every write goes through a database function that checks the step is allowed
// (open requests only; the decision is the Section Head's) and keeps the whole history on the request.
import { supabase } from './supabase';
import type { RequestType } from '@/core/requests';

export type RequestStatus = 'submitted' | 'reviewed' | 'approved' | 'not_approved' | 'withdrawn';
export interface LeaveRequest {
  id: string; employee_id: string; request_type: RequestType; start_date: string; end_date: string;
  reason: string | null; address: string | null; phone: string | null; balance_days: number | null; balance_as_of: string | null; form_date: string | null;
  status: RequestStatus; overtime_required: boolean | null; review_signed_by: string | null; review_remarks: string | null; reviewed_by: string | null; reviewed_at: string | null;
  decision_remarks: string | null; decided_by: string | null; decided_at: string | null; withdraw_reason: string | null; leave_record_id: string | null;
  entered_by: string | null; created_at: string; updated_at: string;
}
export const isOpen = (r: { status: RequestStatus }) => r.status === 'submitted' || r.status === 'reviewed';

const plain = (error: { message: string }) => new Error(error.message);

export async function fetchRequests(): Promise<LeaveRequest[]> {
  const { data, error } = await supabase.from('leave_requests').select('*').order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return data as LeaveRequest[];
}

export async function fetchRequest(id: string): Promise<LeaveRequest> {
  const { data, error } = await supabase.from('leave_requests').select('*').eq('id', id).single();
  if (error) throw error;
  return data as LeaveRequest;
}

export async function countOpenRequests(): Promise<number> {
  const { count, error } = await supabase.from('leave_requests').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'reviewed']);
  if (error) throw error;
  return count ?? 0;
}

export interface RequestForm {
  employee_id: string; request_type: RequestType; start_date: string; end_date: string; reason: string; address: string; phone: string;
  balance_days: number | null; balance_as_of: string | null; form_date: string | null;
}
export async function saveRequest(id: string | null, f: RequestForm): Promise<string> {
  const { data, error } = await supabase.rpc('request_save', {
    p_id: id, p_employee: f.employee_id, p_type: f.request_type, p_start: f.start_date, p_end: f.end_date, p_reason: f.reason, p_address: f.address, p_phone: f.phone,
    p_balance: f.balance_days, p_balance_as_of: f.balance_as_of, p_form_date: f.form_date
  });
  if (error) throw plain(error);
  return data as string;
}
export async function reviewRequest(id: string, overtime: boolean, signedBy: string, remarks: string) {
  const { error } = await supabase.rpc('request_review', { p_id: id, p_overtime: overtime, p_signed_by: signedBy, p_remarks: remarks });
  if (error) throw plain(error);
}
export async function decideRequest(id: string, approve: boolean, remarks: string) {
  const { error } = await supabase.rpc('request_decide', { p_id: id, p_approve: approve, p_remarks: remarks });
  if (error) throw plain(error);
}
export async function withdrawRequest(id: string, reason: string) {
  const { error } = await supabase.rpc('request_withdraw', { p_id: id, p_reason: reason });
  if (error) throw plain(error);
}
