// The Coordinator's entry page: one place to record or send a change for one person (Phase 1 step 6).
// Leave goes through request_header_submit with no workflow given, so the database follows the leave type's route
// (absence_types.workflow: approval / record / record_notify). Shift moves use submitApproval; PV reschedule its own sheet.
import { supabase } from './supabase';
import { dataChanged } from './changes';
import { checkProposal, checkRecord, type Check } from './validation';
import { fetchManpowerInputs, type ManpowerInputs } from './manpower';
import { hasHardStop, applyProposal, type Proposal } from '@/core/validation';
import { evaluateRange } from '@/core/manpower';
import { crewImpact, type CrewImpact } from '@/core/entry';
import { CREWS, addDaysIso } from '@/core/roster';

export type EntryWorkflow = 'approval' | 'record' | 'record_notify';
export interface EntryType { code: string; label: string; short: string; workflow: EntryWorkflow | null }

export async function fetchEntryTypes(): Promise<EntryType[]> {
  const { data, error } = await supabase.from('absence_types').select('code,label,short_code,workflow,is_active').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return (data as { code: string; label: string; short_code: string; workflow: EntryWorkflow | null }[]).map((t) => ({ code: t.code, label: t.label, short: t.short_code, workflow: t.workflow }));
}

/** The check of the change and its effect on each crew, position by position, over the days it touches. */
export async function previewEntry(pr: Proposal, inputs?: ManpowerInputs): Promise<{ check: Check; impact: CrewImpact[] }> {
  const end = pr.end ?? addDaysIso(pr.start, 27);
  const [check, inp] = await Promise.all([checkProposal(pr), inputs ? Promise.resolve(inputs) : fetchManpowerInputs(pr.start, end)]);
  const base = { people: inp.people, absences: inp.absencesAll, assignments: inp.assignments };
  const after = applyProposal(base, pr);
  const impact = crewImpact(
    evaluateRange(pr.start, end, base.people, base.absences, inp.rules, base.assignments),
    evaluateRange(pr.start, end, after.people, after.absences, inp.rules, after.assignments), CREWS);
  return { check, impact };
}

export interface EntryResult { id: string; status: 'submitted' | 'approved' | 'recorded' }

/** Leave of any type: the type's route decides whether it is recorded at once or waits for the Section Head. A hard stop is never sent. */
export async function submitLeaveEntry(v: { type: 'unscheduled_pv' | 'personal_pc' | 'absence'; employee: string; code: string; start: string; end: string; summary: string; remark: string; check: Check }): Promise<EntryResult> {
  if (hasHardStop(v.check.findings)) throw new Error('Not sent: the check has a hard stop.');
  const { data, error } = await supabase.rpc('request_header_submit', {
    p_type: v.type, p_employee: v.employee, p_plan_year: Number(v.start.slice(0, 4)), p_summary: v.summary, p_remarks: v.remark.trim() || null,
    p_detail: { absence_type_code: v.code, start_date: v.start, end_date: v.end }, p_check: checkRecord(v.check), p_workflow: null
  });
  if (error) throw new Error(error.message);
  dataChanged(); window.dispatchEvent(new Event('requests-changed'));
  return data as EntryResult;
}

export interface MyEntry { id: string; type: string; employeeId: string; summary: string; status: string; workflow: string; start: string | null; end: string | null; at: string }

/** The last changes I made, newest first. */
export async function fetchMyEntries(authId: string, limit = 12): Promise<MyEntry[]> {
  const { data, error } = await supabase.from('request_headers').select('id,type,employee_id,summary,status,workflow,start_date,end_date,requested_at')
    .eq('requested_by', authId).neq('type', 'shutdown_adjustment').order('requested_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data as Record<string, string | null>[]).map((r) => ({ id: r.id!, type: r.type!, employeeId: r.employee_id!, summary: r.summary ?? '', status: r.status!, workflow: r.workflow ?? '', start: r.start_date, end: r.end_date, at: r.requested_at! }));
}

export async function withdrawEntry(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('request_header_withdraw', { p_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
  dataChanged(); window.dispatchEvent(new Event('requests-changed'));
}

/** Leave recorded with a notice to the Section Head since a date (sick, injury, escort…). */
export async function fetchRecordedNotices(since: string): Promise<{ id: string; employeeId: string; label: string; start: string; end: string }[]> {
  const { data, error } = await supabase.from('request_headers').select('id,employee_id,start_date,end_date,summary')
    .eq('workflow', 'record_notify').eq('status', 'recorded').gte('requested_at', since).order('requested_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data as Record<string, string>[]).map((r) => ({ id: r.id, employeeId: r.employee_id, label: r.summary, start: r.start_date, end: r.end_date ?? r.start_date }));
}
