// Approvals: changes the Manpower Coordinator makes (unplanned / sick leave added by hand, shift movements, VR placements,
// task releases, Controller covers) wait for the Section Head; the Section Head's own apply at once and are kept as approved.
// Kept in request_headers with a typed detail row (request_leave / request_shift / request_assignment).
// Leave forms and PV reschedule requests are still written by their own screens; the database keeps one linked header
// for each (legacy_table + legacy_id, unique) in the same transaction, so the inbox and the counts read request_headers only.
import { supabase } from './supabase';
import { dataChanged } from './changes';
import { checkProposal, checkRecord, type Check } from './validation';
import { DAY_DUTY } from '@/core/manpower';
import { hasHardStop, acceptable, type Proposal } from '@/core/validation';
import type { Crew } from '@/core/roster';

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

/** The change an approval asks for, as the validation engine sees it. */
export function proposalOf(v: { kind: ApprovalKind; employee: string; start: string; end: string | null; payload: Record<string, unknown> }, typeShort?: string | null): Proposal {
  const p = v.payload as Record<string, string | null | undefined>;
  switch (v.kind) {
    case 'leave': return { kind: 'absence', employeeId: v.employee, start: v.start, end: v.end ?? v.start, typeCode: p.type ?? null, typeShort: typeShort ?? p.type ?? 'Leave' };
    case 'task_release': return { kind: 'release', employeeId: v.employee, start: v.start, end: v.end ?? v.start };
    case 'movement': return { kind: 'move', employeeId: v.employee, start: v.start, end: v.end, crew: p.to === 'DAY' ? DAY_DUTY : (p.to as Crew), moveKind: p.kind === 'permanent' ? 'permanent' : 'temporary' };
    case 'vr_placement': return { kind: 'move', employeeId: v.employee, start: v.start, end: v.end, crew: p.crew as Crew, moveKind: 'placement' };
    case 'controller_cover': return { kind: 'cover', employeeId: v.employee, crew: p.crew_code as Crew, start: v.start, end: v.end ?? v.start, coverKind: p.kind === 'morning_rotation' ? 'morning_rotation' : 'shift_cover' };
  }
}
const shortOf = async (code: unknown) => {
  if (typeof code !== 'string') return null;
  const { data } = await supabase.from('absence_types').select('short_code').eq('code', code).maybeSingle();
  return (data as { short_code: string } | null)?.short_code ?? null;
};

/** Checks the change first: a hard stop is never sent. The check is kept with the request. */
export async function submitApproval(v: { kind: ApprovalKind; employee: string; start: string; end: string | null; summary: string; payload: Record<string, unknown> }): Promise<SubmitResult> {
  const check = await checkProposal(proposalOf(v, v.kind === 'leave' ? await shortOf(v.payload.type) : null));
  if (hasHardStop(check.findings)) throw new Error(`Not sent, hard stop: ${check.findings.filter((f) => f.severity === 'hard_stop').map((f) => f.message).join(' ')}`);
  let r: SubmitResult;
  if (v.kind === 'leave') {
    // leave goes in with its check: an accepted overlap (critical) lets the other leave give up those days
    const type = String(v.payload.type ?? '');
    const { data, error } = await supabase.rpc('request_header_submit', { p_type: type === 'annual_leave_unscheduled' ? 'unscheduled_pv' : 'absence', p_employee: v.employee,
      p_plan_year: Number(v.start.slice(0, 4)), p_summary: v.summary, p_remarks: (v.payload.note as string | undefined) ?? null,
      p_detail: { absence_type_code: type, start_date: v.start, end_date: v.end ?? v.start }, p_check: checkRecord(check), p_workflow: 'approval' });
    if (error) throw plain(error);
    const d = data as { id: string; status: string; result?: string };
    r = { id: d.id, status: d.status === 'submitted' ? 'pending' : 'approved', result: d.result };
  } else {
    const { data, error } = await supabase.rpc('approval_submit', { p_kind: v.kind, p_employee: v.employee, p_start: v.start, p_end: v.end, p_summary: v.summary, p_payload: v.payload });
    if (error) throw plain(error);
    r = data as SubmitResult;
    await supabase.rpc('request_header_record_check', { p_id: r.id, p_check: checkRecord(check) });
  }
  notify();
  return r;
}
/** Approve (with the check seen: its warnings and critical findings are accepted, a hard stop is refused) or not approve. */
export async function decideApproval(id: string, approve: boolean, note: string, check?: Check | null): Promise<void> {
  const { error } = check
    ? await supabase.rpc('request_header_decide', { p_id: id, p_approve: approve, p_note: note, p_check: checkRecord(check), p_accepted: approve ? acceptable(check.findings).map(({ rule, severity, message }) => ({ rule, severity, message })) : [] })
    : await supabase.rpc('approval_decide', { p_id: id, p_approve: approve, p_note: note });
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
export type LegacyTable = 'leave_requests' | 'leave_change_requests';
/** A leave form or reschedule request, as its linked header sees it. */
export interface LegacyLink { id: string; table: LegacyTable; legacyId: string; status: ApprovalStatus; legacyStatus: string | null; requestedAt: string; decidedAt: string | null }
const SKIP_SHUTDOWN = 'shutdown_adjustment';

/** Every request in the history: the Coordinator's changes, and the links to leave forms and reschedule requests. */
export async function fetchRequestLog(): Promise<{ approvals: ApprovalRequest[]; legacy: LegacyLink[] }> {
  const { data, error } = await supabase.from('request_headers').select('*, request_leave(*), request_shift(*), request_assignment(*)')
    .neq('type', SKIP_SHUTDOWN).order('requested_at', { ascending: false }).limit(2000);
  if (error) throw error;
  const rows = data as Row[];
  return {
    approvals: rows.filter((h) => !h.legacy_table).map(toApproval).filter((r): r is ApprovalRequest => r !== null),
    legacy: rows.filter((h) => h.legacy_table).map((h) => ({
      id: h.id as string, table: h.legacy_table as LegacyTable, legacyId: h.legacy_id as string, status: STATUS[h.status as string] ?? 'pending',
      legacyStatus: (h.legacy_status as string) ?? null, requestedAt: h.requested_at as string, decidedAt: (h.decided_at as string) ?? null
    }))
  };
}
export async function fetchApprovals(): Promise<ApprovalRequest[]> {
  return (await fetchRequestLog()).approvals;
}
/** Everything waiting for the Section Head (leave forms and reschedule requests included). */
export async function countPendingApprovals(): Promise<number> {
  const { count, error } = await supabase.from('request_headers').select('id', { count: 'exact', head: true })
    .eq('status', 'submitted').neq('type', SKIP_SHUTDOWN);
  if (error) throw error;
  return count ?? 0;
}
/** The message for the person who made the change. */
export const submittedText = (r: SubmitResult, done: string) => (r.status === 'approved' ? done : `Sent to the Section Head for approval: ${done.replace(/\.$/, '')}.`);
