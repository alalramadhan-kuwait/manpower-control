// Approvals: changes the Manpower Coordinator makes (unplanned / sick leave added by hand, shift movements, VR placements,
// task releases, Controller covers) wait for the Section Head; the Section Head's own apply at once and are kept as approved.
import { supabase } from './supabase';
import { dataChanged } from './changes';

export type ApprovalKind = 'leave' | 'movement' | 'vr_placement' | 'task_release' | 'controller_cover';
export type ApprovalStatus = 'pending' | 'approved' | 'not_approved' | 'withdrawn';
export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  leave: 'Unplanned / sick leave', movement: 'Shift move', vr_placement: 'VR placement', task_release: 'Task release', controller_cover: 'Controller cover'
};
/** Leave types added by hand that wait for the Section Head (unplanned annual leave and sick leave). */
export const LEAVE_NEEDS_APPROVAL = new Set(['annual_leave_unscheduled', 'sick_leave']);

export interface ApprovalRequest {
  id: string; kind: ApprovalKind; employee_id: string; start_date: string; end_date: string | null; summary: string;
  payload: Record<string, unknown>; status: ApprovalStatus; requested_by: string | null; requested_at: string;
  decided_by: string | null; decided_at: string | null; decision_note: string | null; result_id: string | null;
}
/** What happened to a change: applied at once (the Section Head) or waiting for the Section Head. */
export interface SubmitResult { id: string; status: 'approved' | 'pending'; result?: string }

const plain = (error: { message: string }) => new Error(error.message);
const notify = () => { dataChanged(); window.dispatchEvent(new Event('requests-changed')); };

export async function submitApproval(v: { kind: ApprovalKind; employee: string; start: string; end: string | null; summary: string; payload: Record<string, unknown> }): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc('approval_submit', { p_kind: v.kind, p_employee: v.employee, p_start: v.start, p_end: v.end, p_summary: v.summary, p_payload: v.payload });
  if (error) throw plain(error);
  notify();
  return data as SubmitResult;
}
export async function decideApproval(id: string, approve: boolean, note: string): Promise<void> {
  const { error } = await supabase.rpc('approval_decide', { p_id: id, p_approve: approve, p_note: note });
  if (error) throw plain(error);
  notify();
}
export async function withdrawApproval(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('approval_withdraw', { p_id: id, p_reason: reason });
  if (error) throw plain(error);
  notify();
}
export async function fetchApprovals(): Promise<ApprovalRequest[]> {
  const { data, error } = await supabase.from('approval_requests').select('*').order('requested_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return data as ApprovalRequest[];
}
export async function countPendingApprovals(): Promise<number> {
  const { count, error } = await supabase.from('approval_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  if (error) throw error;
  return count ?? 0;
}
/** The message for the person who made the change. */
export const submittedText = (r: SubmitResult, done: string) => (r.status === 'approved' ? done : `Sent to the Section Head for approval: ${done.replace(/\.$/, '')}.`);
