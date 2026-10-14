// The v2 shutdown plan check: everything it needs, loaded the same way in the app and on the server (the sd-plan-approve
// function bundles this file), so the check the Section Head sees and the one that records the approval cannot differ.
import { supabase } from './supabase';
import { fetchStatCodes, fetchStats } from './oracleStats';
import { sickRolling } from '@/core/oracleStats';
import { dataChanged } from './changes';
import { fetchManpowerInputs } from './manpower';
import { fetchDirectory } from './queries';
import { fetchAllSdMembers, fetchSdDuties, fetchSdPlan, fetchSdPlans } from './shutdown';
import { fetchValidationRules } from './validation';
import { addDaysIso } from '@/core/roster';
import { checkPlan, memberOvertime, type ExceptionKind, type OtEntry, type OtherDuty, type PersonInfo, type PlanCheck, type PlanCheckInput, type SdException, type SickEntry } from '@/core/shutdown/v2';

export interface OtEntryRow { employee_id: string; as_of: string; ytd_hours: number; mtd_hours: number; verified_at: string | null; entered_at: string }
export interface SickRow { employee_id: string; as_of: string; days: number; entered_at: string }
export interface ExceptionRow { id: string; plan_id: string; employee_id: string; kind: ExceptionKind; reason: string; approved_at: string; revoked_at: string | null }

/** The latest overtime entry of each person (a new entry never replaces an old one). */
export async function fetchOtEntries(ids: string[]): Promise<Map<string, OtEntry>> {
  const out = new Map<string, OtEntry>();
  if (!ids.length) return out;
  const { data, error } = await supabase.from('overtime_entries').select('employee_id,as_of,ytd_hours,mtd_hours,verified_at,entered_at').in('employee_id', ids).order('entered_at', { ascending: false });
  if (error) throw error;
  for (const r of data as OtEntryRow[]) if (!out.has(r.employee_id)) out.set(r.employee_id, { asOf: r.as_of, ytd: Number(r.ytd_hours), mtd: Number(r.mtd_hours), verified: !!r.verified_at });
  return out;
}
/** The latest confirmed sick-leave figure of each person. */
export async function fetchSickEntries(ids: string[]): Promise<Map<string, SickEntry>> {
  const out = new Map<string, SickEntry>();
  if (!ids.length) return out;
  const { data, error } = await supabase.from('sick_checks').select('employee_id,as_of,days,entered_at').in('employee_id', ids).order('entered_at', { ascending: false });
  if (error) throw error;
  for (const r of data as SickRow[]) if (!out.has(r.employee_id)) out.set(r.employee_id, { asOf: r.as_of, days: r.days });
  // Oracle statistics: a report covering a rolling 12 months for the person (and every sick code) is a confirmed figure
  // as of the day it was taken; the newer of the two counts. A calendar-year total is never used here.
  const [codes, stats] = await Promise.all([fetchStatCodes(), fetchStats(ids)]);
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  for (const id of ids) {
    const r = sickRolling(id, today, stats.snapshots, stats.values, codes);
    if (r.days === null || !r.snapshot) continue;
    const prev = out.get(id);
    if (!prev || prev.asOf < r.snapshot.extractedOn) out.set(id, { asOf: r.snapshot.extractedOn, days: r.days });
  }
  return out;
}
export async function fetchExceptions(planId: string): Promise<(SdException & { id: string })[]> {
  const { data, error } = await supabase.from('sd_exceptions').select('id,plan_id,employee_id,kind,reason,approved_at,revoked_at').eq('plan_id', planId).is('revoked_at', null);
  if (error) throw error;
  return (data as ExceptionRow[]).map((r) => ({ id: r.id, planId: r.plan_id, employeeId: r.employee_id, kind: r.kind, reason: r.reason, approvedAt: r.approved_at }));
}

const plain = (e: { message: string }) => new Error(e.message);
export async function saveOtEntry(v: { employeeId: string; asOf: string; ytd: number; mtd: number; verified: boolean; note?: string }) {
  const { error } = await supabase.rpc('overtime_entry_save', { p_employee: v.employeeId, p_as_of: v.asOf, p_ytd: v.ytd, p_mtd: v.mtd, p_verified: v.verified, p_note: v.note ?? null });
  if (error) throw plain(error); dataChanged();
}
export async function saveSickCheck(v: { employeeId: string; asOf: string; days: number; note?: string }) {
  const { error } = await supabase.rpc('sick_check_save', { p_employee: v.employeeId, p_as_of: v.asOf, p_days: v.days, p_note: v.note ?? null });
  if (error) throw plain(error); dataChanged();
}
export async function grantException(v: { planId: string; employeeId: string; kind: ExceptionKind; reason: string }) {
  const { error } = await supabase.rpc('sd_exception_grant', { p_plan: v.planId, p_employee: v.employeeId, p_kind: v.kind, p_reason: v.reason });
  if (error) throw plain(error); dataChanged();
}
export async function revokeException(id: string, reason: string) {
  const { error } = await supabase.rpc('sd_exception_revoke', { p_id: id, p_reason: reason });
  if (error) throw plain(error); dataChanged();
}

export const personInfo = (r: { id: string; display_name: string; position_code: string | null; grade: number | null; fo_level?: PersonInfo['foLevel'] | null }): PersonInfo =>
  ({ id: r.id, name: r.display_name, position: r.position_code, grade: r.grade, foLevel: r.fo_level ?? null });

/** Everything the check reads, from the database as it is now. */
export async function loadPlanCheckInput(planId: string, today: string): Promise<PlanCheckInput> {
  const sd = await fetchSdPlan(planId);
  const { plan, teams, members } = sd;
  const ids = [...new Set(members.map((m) => m.employeeId))];
  const from = addDaysIso(plan.start, -21), to = addDaysIso(plan.end, 21);
  const [inputs, dir, plans, all, rules, otherSdDuty, otEntries, sickEntries, exceptions] = await Promise.all([
    fetchManpowerInputs(from, to), fetchDirectory(), fetchSdPlans(), fetchAllSdMembers(), fetchValidationRules(), fetchSdDuties(from, to),
    fetchOtEntries(ids), fetchSickEntries(ids), fetchExceptions(planId)]);
  // other shutdowns in the same calendar years: their planned overtime counts once next to this plan's
  const years = new Set([plan.start.slice(0, 4), plan.end.slice(0, 4)]);
  const others = plans.filter((p) => p.id !== plan.id && (years.has(p.start.slice(0, 4)) || years.has(p.end.slice(0, 4))) && all.some((m) => m.planId === p.id && ids.includes(m.employeeId)));
  const people = new Map(inputs.people.map((p) => [p.id, p]));
  const otherDuties: OtherDuty[] = [];
  for (const o of others) {
    const d = await fetchSdPlan(o.id);
    for (const m of d.members.filter((x) => ids.includes(x.employeeId))) {
      const t = d.teams.find((x) => x.id === m.teamId); if (!t) continue;
      for (const x of memberOvertime(d.plan, t, m, people.get(m.employeeId))) otherDuties.push({ employeeId: m.employeeId, date: x.date, parts: x.parts });
    }
  }
  return {
    plan, teams, members, phases: sd.phases, people: inputs.people, absences: inputs.absences, assignments: inputs.assignments, rules,
    info: new Map(dir.map((r) => [r.id, personInfo(r)])),
    plans: plans.map((p) => ({ plan: p, employeeIds: new Set(all.filter((m) => m.planId === p.id).map((m) => m.employeeId)) })),
    otherDuties, otherSdDuty, otEntries, sickEntries, exceptions, today,
  };
}

export async function runPlanCheck(planId: string, today: string): Promise<PlanCheck> {
  return checkPlan(await loadPlanCheckInput(planId, today));
}

export interface ApprovalState { status: 'draft' | 'approved'; approvedAt: string | null; fingerprint: string | null; check: PlanCheck | null }
export async function fetchApproval(planId: string): Promise<ApprovalState> {
  const { data, error } = await supabase.from('sd_plans').select('approval_status,approved_at,approval_fingerprint,approval_check').eq('id', planId).single();
  if (error) throw error;
  const r = data as { approval_status: 'draft' | 'approved'; approved_at: string | null; approval_fingerprint: string | null; approval_check: PlanCheck | null };
  return { status: r.approval_status, approvedAt: r.approved_at, fingerprint: r.approval_fingerprint, check: r.approval_check };
}

/** Ask the server to approve: it re-checks the plan from the database and records the approval only when it is Ready and
 *  the data is the same as the check the Section Head was looking at (`seen` = that check's fingerprint). */
export async function requestApproval(planId: string, seen: string): Promise<{ approved: boolean; check: PlanCheck; reason?: string }> {
  const { data, error } = await supabase.functions.invoke('sd-plan-approve', { body: { planId, fingerprint: seen } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    throw new Error(body?.error ?? error.message);
  }
  dataChanged();
  return data as { approved: boolean; check: PlanCheck; reason?: string };
}
