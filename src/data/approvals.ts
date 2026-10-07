// Approvals: changes the Manpower Coordinator makes (unplanned / sick leave added by hand, shift movements, VR placements,
// task releases, Controller covers) wait for the Section Head; the Section Head's own apply at once and are kept as approved.
// Kept in request_headers with a typed detail row (request_leave / request_shift / request_assignment); leave forms and PV
// reschedule requests are mirrored there too (legacy_table set) but still listed from their own tables.
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
  plan_year: number; source: string; workflow: string;
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
type Row = Record<string, unknown>;
const one = (x: unknown): Row | null => (Array.isArray(x) ? (x[0] as Row) ?? null : (x as Row) ?? null);
const hhmm = (t: unknown) => (typeof t === 'string' ? t.slice(0, 5) : null);
const LEAVE_TYPES = new Set(['unscheduled_pv', 'personal_pc', 'absence']);
const STATUS: Record<string, ApprovalStatus> = { submitted: 'pending', approved: 'approved', recorded: 'approved', not_approved: 'not_approved', withdrawn: 'withdrawn' };

/** A request header with its detail, in the shape the Approvals page reads. */
export function toApproval(h: Row): ApprovalRequest | null {
  const type = h.type as string;
  const l = one(h.request_leave), s = one(h.request_shift), a = one(h.request_assignment);
  let kind: ApprovalKind; let payload: Record<string, unknown>;
  if (LEAVE_TYPES.has(type) && l) { kind = 'leave'; payload = { type: l.absence_type_code, note: h.remarks ?? null }; }
  else if (type === 'shift_change' && s) { kind = 'movement'; payload = { to: s.kind === 'day_duty' ? 'DAY' : s.to_crew, kind: s.kind === 'permanent' ? 'permanent' : 'temporary', reason: s.reason ?? null }; }
  else if (type === 'vr_placement' && a) { kind = 'vr_placement'; payload = { crew: a.crew_code, reason: a.reason ?? null }; }
  else if (type === 'task_release' && a) { kind = 'task_release'; payload = { from_time: hhmm(a.from_time), to_time: hhmm(a.to_time), task: a.task ?? null }; }
  else if (type === 'controller_cover' && a) { kind = 'controller_cover'; payload = { kind: a.cover_kind, crew_code: a.crew_code, covers_employee_id: a.covers_employee_id, note: a.reason ?? null }; }
  else return null;
  return {
    id: h.id as string, kind, employee_id: h.employee_id as string, start_date: h.start_date as string, end_date: (h.end_date as string) ?? null,
    summary: h.summary as string, payload, status: STATUS[h.status as string] ?? 'pending', requested_by: (h.requested_by as string) ?? null,
    requested_at: h.requested_at as string, decided_by: (h.decided_by as string) ?? null, decided_at: (h.decided_at as string) ?? null,
    decision_note: (h.decision_note as string) ?? null, result_id: (h.result_id as string) ?? null,
    plan_year: h.plan_year as number, source: h.source as string, workflow: h.workflow as string
  };
}
export async function fetchApprovals(): Promise<ApprovalRequest[]> {
  const { data, error } = await supabase.from('request_headers').select('*, request_leave(*), request_shift(*), request_assignment(*)')
    .is('legacy_table', null).neq('type', 'shutdown_adjustment').order('requested_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return (data as Row[]).map(toApproval).filter((r): r is ApprovalRequest => r !== null);
}
export async function countPendingApprovals(): Promise<number> {
  const { count, error } = await supabase.from('request_headers').select('id', { count: 'exact', head: true })
    .eq('status', 'submitted').is('legacy_table', null).neq('type', 'shutdown_adjustment');
  if (error) throw error;
  return count ?? 0;
}
/** The message for the person who made the change. */
export const submittedText = (r: SubmitResult, done: string) => (r.status === 'approved' ? done : `Sent to the Section Head for approval: ${done.replace(/\.$/, '')}.`);
