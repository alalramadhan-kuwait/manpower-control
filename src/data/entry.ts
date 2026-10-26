// Requests → Entry: the one place to put in a change for one person. Everything is sent through the server check
// (./gate.ts): the Section Head's own entries are recorded directly, the Coordinator's wait for the Section Head when the
// type needs approval. Leave types follow their route (absence_types.workflow) and entry mode (absence_types.entry_mode):
// pv (moved by a PV reschedule), fixed (dates known), tracked (an operational absence: the return may be unknown),
// statistics (sick, escort: Oracle figures only, never entered here) and retired (old types, readable only).
import { supabase } from './supabase';
import { dataChanged } from './changes';
import { checkProposal, type Check } from './validation';
import { fetchManpowerInputs, type ManpowerInputs } from './manpower';
import { gateSubmit, type GateResult, type SubmitInput } from './gate';
import { withOpenEnd } from './openEnd';
import { applyProposal, type Proposal } from '@/core/validation';
import { evaluateRange } from '@/core/manpower';
import { crewImpact, type CrewImpact } from '@/core/entry';
import { gateVerdict, type GateVerdict } from '@/core/requests/gate';
import { CREWS, addDaysIso } from '@/core/roster';

export type EntryWorkflow = 'approval' | 'record' | 'record_notify';
export type EntryMode = 'pv' | 'fixed' | 'tracked' | 'statistics' | 'retired';
export interface EntryType { code: string; label: string; short: string; workflow: EntryWorkflow | null; mode: EntryMode; oracle: string | null; reviewDays: number | null }

export async function fetchEntryTypes(): Promise<EntryType[]> {
  const { data, error } = await supabase.from('absence_types').select('code,label,short_code,workflow,is_active,entry_mode,oracle_code,review_days').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return (data as { code: string; label: string; short_code: string; workflow: EntryWorkflow | null; entry_mode: EntryMode; oracle_code: string | null; review_days: number | null }[])
    .map((t) => ({ code: t.code, label: t.label, short: t.short_code, workflow: t.workflow, mode: t.entry_mode, oracle: t.oracle_code, reviewDays: t.review_days }));
}

/** The check of the change, its effect on each crew position by position, and what the server will do with it. */
export async function previewEntry(pr: Proposal, factual = false, inputs?: ManpowerInputs): Promise<{ check: Check; impact: CrewImpact[]; verdict: GateVerdict }> {
  const end = pr.end ?? addDaysIso(pr.start, 27);
  const [check, inp] = await Promise.all([checkProposal(pr), inputs ? Promise.resolve(inputs) : fetchManpowerInputs(pr.start, end)]);
  const base = { people: inp.people, absences: inp.absencesAll, assignments: inp.assignments };
  const after = applyProposal(base, pr);
  const impact = crewImpact(
    evaluateRange(pr.start, end, base.people, base.absences, inp.rules, base.assignments),
    evaluateRange(pr.start, end, after.people, after.absences, inp.rules, after.assignments), CREWS);
  return { check, impact, verdict: gateVerdict(check.findings, factual) };
}

/** Send a change (through the server check). */
export const submitEntry = (v: SubmitInput): Promise<GateResult> => gateSubmit(v);

export interface MyEntry { id: string; type: string; employeeId: string; summary: string; status: string; workflow: string; start: string | null; end: string | null; at: string; source: string }

/** The last changes I made, newest first. */
export async function fetchMyEntries(authId: string, limit = 12): Promise<MyEntry[]> {
  const { data, error } = await supabase.from('request_headers').select('id,type,employee_id,summary,status,workflow,start_date,end_date,requested_at,source')
    .eq('requested_by', authId).neq('type', 'shutdown_adjustment').order('requested_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data as Record<string, string | null>[]).map((r) => ({ id: r.id!, type: r.type!, employeeId: r.employee_id!, summary: r.summary ?? '', status: r.status!, workflow: r.workflow ?? '', start: r.start_date, end: r.end_date, at: r.requested_at!, source: r.source ?? '' }));
}

export interface EntryDetail {
  id: string; type: string; employeeId: string; summary: string; remarks: string | null; status: string; workflow: string; source: string;
  start: string; end: string | null; requestedAt: string; decidedAt: string | null; decisionNote: string | null; resultId: string | null;
  findings: { rule: string; severity: string; message: string }[]; detail: Record<string, unknown>;
}
/** One request with its detail and the check kept with it. */
export async function fetchEntryDetail(id: string): Promise<EntryDetail> {
  const { data, error } = await supabase.from('request_headers').select('*, request_leave(*), request_shift(*), request_assignment(*)').eq('id', id).single();
  if (error) throw error;
  const h = data as Record<string, unknown>;
  const one = (x: unknown) => (Array.isArray(x) ? (x[0] as Record<string, unknown> | undefined) : (x as Record<string, unknown> | undefined));
  const chk = (h.check_at_decision ?? h.check_at_submit) as { findings?: { rule: string; severity: string; message: string }[] } | null;
  return {
    id: h.id as string, type: h.type as string, employeeId: h.employee_id as string, summary: h.summary as string, remarks: (h.remarks as string) ?? null,
    status: h.status as string, workflow: h.workflow as string, source: h.source as string, start: h.start_date as string, end: (h.end_date as string) ?? null,
    requestedAt: h.requested_at as string, decidedAt: (h.decided_at as string) ?? null, decisionNote: (h.decision_note as string) ?? null, resultId: (h.result_id as string) ?? null,
    findings: chk?.findings ?? [], detail: { ...(one(h.request_leave) ?? one(h.request_shift) ?? one(h.request_assignment) ?? {}) }
  };
}

export async function withdrawEntry(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('request_header_withdraw', { p_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
  dataChanged(); window.dispatchEvent(new Event('requests-changed'));
}

/** A person's operational (tracked) absences in the current plan: open or still running, with the provisional fields. */
export interface TrackedCase { id: string; rootId: string; version: number; code: string; label: string; start: string; end: string | null; estimatedReturn: string | null; nextReview: string | null }
export async function fetchTrackedCases(employeeId: string, today: string): Promise<TrackedCase[]> {
  const { data, error } = await supabase.from('leave_records').select('id,root_id,version_no,absence_type_code,start_date,end_date,estimated_return,next_review,absence_types!inner(label,entry_mode)')
    .eq('employee_id', employeeId).eq('in_current_plan', true).eq('status', 'approved').eq('absence_types.entry_mode', 'tracked').or(`end_date.is.null,end_date.gte.${addDaysIso(today, -1)}`);
  if (error) throw error;
  return (data as unknown as { id: string; root_id: string; version_no: number; absence_type_code: string; start_date: string; end_date: string | null; estimated_return: string | null; next_review: string | null; absence_types: { label: string } }[])
    .map((r) => ({ id: r.id, rootId: r.root_id, version: r.version_no, code: r.absence_type_code, label: r.absence_types.label, start: r.start_date, end: r.end_date, estimatedReturn: r.estimated_return, nextReview: r.next_review }));
}

/** Open operational absences (all people): for Today and the review reminders. */
export async function fetchOpenCases(): Promise<(TrackedCase & { employeeId: string })[]> {
  const { data, error } = await supabase.from('leave_records').select('id,employee_id,root_id,version_no,absence_type_code,start_date,end_date,estimated_return,next_review,absence_types!inner(label,entry_mode)')
    .eq('in_current_plan', true).eq('status', 'approved').is('end_date', null);
  if (error) throw error;
  return (data as unknown as { id: string; employee_id: string; root_id: string; version_no: number; absence_type_code: string; start_date: string; end_date: string | null; estimated_return: string | null; next_review: string | null; absence_types: { label: string } }[])
    .map((r) => ({ id: r.id, employeeId: r.employee_id, rootId: r.root_id, version: r.version_no, code: r.absence_type_code, label: r.absence_types.label, start: r.start_date, end: r.end_date, estimatedReturn: r.estimated_return, nextReview: r.next_review }));
}

/** A person's leave in the plan that can be cancelled through a linked request (not PV: a PV is moved, not cancelled here). */
export async function fetchCancellableLeave(employeeId: string, today: string): Promise<{ id: string; code: string; label: string; start: string; end: string }[]> {
  const { data, error } = await supabase.from('leave_records').select('id,absence_type_code,start_date,end_date,absence_types!inner(label,entry_mode)')
    .eq('employee_id', employeeId).eq('in_current_plan', true).in('status', ['approved', 'planned']).eq('absence_types.entry_mode', 'fixed').gte('end_date', today).order('start_date');
  if (error) throw error;
  return withOpenEnd(data as unknown as { id: string; absence_type_code: string; start_date: string; end_date: string | null; absence_types: { label: string } }[])
    .map((r) => ({ id: r.id, code: r.absence_type_code, label: r.absence_types.label, start: r.start_date, end: r.end_date }));
}

// drafts: saved by hand, only for their owner; they change nothing and are never in Approvals
export interface Draft { id: string; kind: string; employeeId: string | null; title: string; payload: Record<string, unknown>; updatedAt: string }
export async function fetchDrafts(): Promise<Draft[]> {
  const { data, error } = await supabase.from('request_drafts').select('*').order('updated_at', { ascending: false }).limit(30);
  if (error) throw error;
  return (data as { id: string; kind: string; employee_id: string | null; title: string; payload: Record<string, unknown>; updated_at: string }[])
    .map((d) => ({ id: d.id, kind: d.kind, employeeId: d.employee_id, title: d.title, payload: d.payload, updatedAt: d.updated_at }));
}
export async function saveDraft(d: { id?: string | null; kind: string; employeeId: string | null; title: string; payload: Record<string, unknown> }): Promise<string> {
  const row = { kind: d.kind, employee_id: d.employeeId, title: d.title, payload: d.payload, updated_at: new Date().toISOString() };
  const q = d.id ? supabase.from('request_drafts').update(row).eq('id', d.id).select('id').single() : supabase.from('request_drafts').insert(row).select('id').single();
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
export async function deleteDraft(id: string): Promise<void> {
  const { error } = await supabase.from('request_drafts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Leave recorded with a notice to the Section Head since a date (operational absences). */
export async function fetchRecordedNotices(since: string): Promise<{ id: string; employeeId: string; label: string; start: string; end: string | null }[]> {
  const { data, error } = await supabase.from('request_headers').select('id,employee_id,start_date,end_date,summary')
    .eq('workflow', 'record_notify').eq('status', 'recorded').gte('requested_at', since).order('requested_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data as Record<string, string | null>[]).map((r) => ({ id: r.id!, employeeId: r.employee_id!, label: r.summary!, start: r.start_date!, end: r.end_date }));
}

/** The request type a leave becomes (the same mapping as Requests › Entry). */
export const leaveEntryType = (code: string) => (code === 'annual_leave_unscheduled' ? 'unscheduled_pv' : code === 'personal_qb' ? 'personal_pc' : 'absence') as 'unscheduled_pv' | 'personal_pc' | 'absence';
/** Cancel one leave through the same request as Requests › Entry › Cancel a leave: reason required, server check,
 *  the Section Head decides (their own is recorded), history kept. */
export function cancelLeaveEntry(v: { employeeId: string; recordId: string; code: string; label: string; start: string; end: string; reason: string; summaryDates: string }) {
  return submitEntry({ type: leaveEntryType(v.code), employeeId: v.employeeId, summary: `${v.label} ${v.summaryDates} cancelled`, remarks: v.reason,
    detail: { absence_type_code: v.code, start_date: v.start, end_date: v.end, action: 'cancel', target_record_id: v.recordId }, workflow: 'approval' });
}
