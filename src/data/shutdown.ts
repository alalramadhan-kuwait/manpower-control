// Shutdown teams (Stage K): plans, teams and members; the Field Operator level. Staff read and write; every change is audited.
import { supabase } from './supabase';
import { dataChanged } from './changes';
import type { Crew } from '@/core/roster';
import { cancelMovement, fetchMovements, recordMovement } from './movements';
import type { FoLevel, SdKind, SdMember, SdPhase, SdPlan, SdSlot, SdTeam } from '@/core/shutdown';

export interface Signature { title: string; name: string }
interface PlanRow { signatures: Signature[]; kind: SdKind; areas: string[] | null; sections: string[] | null; id: string; event_id: string | null; title: string; start_date: string; end_date: string; days_on: number; days_off: number; shift_hours: number; ramp_days: number; ramp_hours: number; normal_hours: number; max_overtime: number; status: string }
interface TeamRow { id: string; plan_id: string; name: string; sort: number; shift_code: 'M' | 'N'; shift_hours_label: string | null; controller_n: number; senior_n: number; good_n: number; new_n: number; ramp_controller_n: number; ramp_senior_n: number; ramp_good_n: number; ramp_new_n: number }
interface MemberRow { id: string; plan_id: string; team_id: string; employee_id: string; slot: SdSlot; day_offset: number; start_date: string; end_date: string; area: string | null; note: string | null; follow_crew: Crew | null }
interface PhaseRow { id: string; plan_id: string; start_date: string; end_date: string; needs: SdPhase['needs'] }

const toPlan = (r: PlanRow): SdPlan => ({ id: r.id, eventId: r.event_id, title: r.title, kind: r.kind ?? 'train', areas: r.areas ?? [], sections: r.sections ?? [], start: r.start_date, end: r.end_date, daysOn: r.days_on, daysOff: r.days_off,
  shiftHours: Number(r.shift_hours), rampDays: r.ramp_days, rampHours: Number(r.ramp_hours), normalHours: Number(r.normal_hours), maxOvertime: Number(r.max_overtime) });
const toTeam = (r: TeamRow): SdTeam => ({ id: r.id, planId: r.plan_id, name: r.name, sort: r.sort,
  needs: { controller: r.controller_n, senior: r.senior_n, good: r.good_n, new: r.new_n }, rampNeeds: { controller: r.ramp_controller_n, senior: r.ramp_senior_n, good: r.ramp_good_n, new: r.ramp_new_n },
  shiftCode: r.shift_code, hoursLabel: r.shift_hours_label });
export const toMember = (r: MemberRow): SdMember => ({ id: r.id, planId: r.plan_id, teamId: r.team_id, employeeId: r.employee_id, slot: r.slot, offset: r.day_offset, start: r.start_date, end: r.end_date, area: r.area, followCrew: r.follow_crew ?? null,
  order: Number(/^S\.No (\d+)/.exec(r.note ?? '')?.[1]) || null });
const toPhase = (r: PhaseRow): SdPhase => ({ id: r.id, start: r.start_date, end: r.end_date, needs: r.needs ?? {} });

export async function fetchSdPlans(): Promise<SdPlan[]> {
  const { data, error } = await supabase.from('sd_plans').select('*').eq('status', 'active').order('start_date');
  if (error) throw error;
  return (data as PlanRow[]).map(toPlan);
}

export async function fetchSdPlan(id: string): Promise<{ plan: SdPlan; teams: SdTeam[]; members: SdMember[]; phases: SdPhase[]; signatures: Signature[] }> {
  const [p, t, m, ph] = await Promise.all([
    supabase.from('sd_plans').select('*').eq('id', id).single(),
    supabase.from('sd_teams').select('*').eq('plan_id', id).eq('status', 'active').order('sort'),
    supabase.from('sd_members').select('*').eq('plan_id', id).eq('status', 'active'),
    supabase.from('sd_phases').select('*').eq('plan_id', id).eq('status', 'active').order('start_date')
  ]);
  const err = [p, t, m, ph].find((r) => r.error)?.error; if (err) throw err;
  const members = (m.data as MemberRow[]).map(toMember);
  // each member's own days (overriding the pattern)
  if (members.length) {
    const d = await supabase.from('sd_days').select('member_id,work_date,works,hours').in('member_id', members.map((x) => x.id)).limit(10000);
    if (d.error) throw d.error;
    const by = new Map(members.map((x) => [x.id, x]));
    for (const r of d.data as { member_id: string; work_date: string; works: boolean; hours: number | null }[]) {
      const mem = by.get(r.member_id); if (!mem) continue;
      (mem.days ??= {})[r.work_date] = { works: r.works, hours: r.hours == null ? null : Number(r.hours) };
    }
  }
  return { plan: toPlan(p.data as PlanRow), teams: (t.data as TeamRow[]).map(toTeam), members, phases: (ph.data as PhaseRow[]).map(toPhase), signatures: (p.data as PlanRow).signatures ?? [] };
}

/** Active shutdown team members overlapping [from, to] (plans not cancelled), for the manpower engine. */
export async function fetchSdMembers(from: string, to: string): Promise<SdMember[]> {
  const { data, error } = await supabase.from('sd_members').select('*, sd_plans!inner(status)').eq('status', 'active').eq('sd_plans.status', 'active').lte('start_date', to).gte('end_date', from);
  if (error) throw error;
  return (data as MemberRow[]).map(toMember);
}

/** A new plan with a Morning and a Night team. A total turnaround: everyone every day, two areas, one phase for all its days. */
export async function createSdPlan(v: { title: string; start: string; end: string; eventId: string | null; kind?: SdKind }): Promise<string> {
  const total = v.kind === 'total';
  const areas = total ? ['TR-II', 'L.P & TR-I'] : [];
  const sections = total ? ['TR-I', 'TR-II', 'L.P'] : [];
  const { data, error } = await supabase.from('sd_plans').insert({ title: v.title, start_date: v.start, end_date: v.end, event_id: v.eventId, kind: v.kind ?? 'train',
    ...(total ? { days_on: 1, days_off: 0, ramp_days: 0, areas, sections } : {}) }).select('id').single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  const t = await supabase.from('sd_teams').insert([{ plan_id: id, name: 'Morning', sort: 0, shift_code: 'M', shift_hours_label: '06:00 - 18:00' },
    { plan_id: id, name: 'Night', sort: 1, shift_code: 'N', shift_hours_label: '18:00 - 06:00' }]).select('id');
  if (t.error) throw t.error;
  if (total) {
    const needs = Object.fromEntries((t.data as { id: string }[]).map((x) => [x.id, { controller: sections.length, sections: Object.fromEntries(sections.map((x) => [x, 1])), areas: Object.fromEntries(areas.map((a) => [a, 5])) }]));
    const ph = await supabase.from('sd_phases').insert({ plan_id: id, start_date: v.start, end_date: v.end, needs });
    if (ph.error) throw ph.error;
  }
  dataChanged();
  return id;
}

export async function updateSdPlan(id: string, v: Partial<{ signatures: Signature[]; kind: SdKind; areas: string[]; sections: string[]; title: string; start_date: string; end_date: string; days_on: number; days_off: number; shift_hours: number; ramp_days: number; ramp_hours: number; normal_hours: number; max_overtime: number; status: 'active' | 'cancelled' }>) {
  const { error } = await supabase.from('sd_plans').update(v).eq('id', id);
  if (error) throw error;
  dataChanged();
}

export async function updateSdTeam(id: string, v: Partial<Record<'controller_n' | 'senior_n' | 'good_n' | 'new_n' | 'ramp_controller_n' | 'ramp_senior_n' | 'ramp_good_n' | 'ramp_new_n', number>>) {
  const { error } = await supabase.from('sd_teams').update(v).eq('id', id);
  if (error) throw error;
  dataChanged();
}

export async function addSdMember(v: { planId: string; teamId: string; employeeId: string; slot: SdSlot; offset: number; start: string; end: string; area?: string | null }) {
  const { error } = await supabase.from('sd_members').insert({ plan_id: v.planId, team_id: v.teamId, employee_id: v.employeeId, slot: v.slot, day_offset: v.offset, start_date: v.start, end_date: v.end, area: v.area ?? null });
  if (error) throw new Error(error.message.includes('sd_members_one_place') ? 'Already on a team of this shutdown.' : error.message);
  dataChanged();
}

export async function updateSdMember(id: string, v: Partial<{ day_offset: number; start_date: string; end_date: string; team_id: string; slot: SdSlot; area: string | null; follow_crew: Crew | null }>) {
  const { error } = await supabase.from('sd_members').update(v).eq('id', id);
  if (error) throw error;
  dataChanged();
}

export async function removeSdMember(id: string) {
  const { error } = await supabase.from('sd_members').update({ status: 'removed' }).eq('id', id);
  if (error) throw error;
  dataChanged();
}

export async function setFoLevel(employeeId: string, level: FoLevel | null) {
  const { error } = await supabase.from('employees').update({ fo_level: level }).eq('id', employeeId);
  if (error) throw error;
  dataChanged();
}

/** Every active member of every active plan (to see who worked the shutdown before / after). */
export async function fetchAllSdMembers(): Promise<SdMember[]> {
  const { data, error } = await supabase.from('sd_members').select('*, sd_plans!inner(status)').eq('status', 'active').eq('sd_plans.status', 'active');
  if (error) throw error;
  return (data as MemberRow[]).map(toMember);
}

/** Sick-leave days per person per year (from the workbook import): employee id → year → days. */
export async function fetchSickTotals(years: number[]): Promise<Map<string, Record<number, number>>> {
  const { data, error } = await supabase.from('sick_leave_totals').select('employee_id,year,days').in('year', years);
  if (error) throw error;
  const out = new Map<string, Record<number, number>>();
  for (const r of data as { employee_id: string; year: number; days: number }[]) out.set(r.employee_id, { ...(out.get(r.employee_id) ?? {}), [r.year]: Number(r.days) });
  return out;
}

/** One person's shutdowns, newest first: the plan, the team and their place, with their own days (for the hours). */
export interface PersonShutdown { plan: SdPlan; team: SdTeam | null; member: SdMember }
export async function fetchPersonShutdowns(employeeId: string): Promise<PersonShutdown[]> {
  const m = await supabase.from('sd_members').select('*').eq('employee_id', employeeId).eq('status', 'active');
  if (m.error) throw m.error;
  const members = (m.data as MemberRow[]).map(toMember);
  if (!members.length) return [];
  const [p, t, d] = await Promise.all([
    supabase.from('sd_plans').select('*').eq('status', 'active').in('id', [...new Set(members.map((x) => x.planId))]),
    supabase.from('sd_teams').select('*').in('id', [...new Set(members.map((x) => x.teamId))]),
    supabase.from('sd_days').select('member_id,work_date,works,hours').in('member_id', members.map((x) => x.id)).limit(10000)
  ]);
  const err = [p, t, d].find((r) => r.error)?.error; if (err) throw err;
  const by = new Map(members.map((x) => [x.id, x]));
  for (const r of d.data as { member_id: string; work_date: string; works: boolean; hours: number | null }[]) (by.get(r.member_id)!.days ??= {})[r.work_date] = { works: r.works, hours: r.hours == null ? null : Number(r.hours) };
  const plans = new Map((p.data as PlanRow[]).map((x) => [x.id, toPlan(x)]));
  const teams = new Map((t.data as TeamRow[]).map((x) => [x.id, toTeam(x)]));
  return members.filter((x) => plans.has(x.planId)).map((x) => ({ plan: plans.get(x.planId)!, team: teams.get(x.teamId) ?? null, member: x }))
    .sort((a, b) => b.plan.start.localeCompare(a.plan.start));
}

/** One person's recorded sick leave (from the leave records), newest first. The yearly totals come from fetchSickTotals. */
export async function fetchPersonSickLeave(employeeId: string): Promise<{ start: string; end: string; long: boolean }[]> {
  const { data, error } = await supabase.from('leave_records').select('start_date,end_date,absence_type_code')
    .eq('employee_id', employeeId).in('absence_type_code', ['sick_leave', 'long_sick']).in('status', ['planned', 'approved']).eq('in_current_plan', true).order('start_date', { ascending: false });
  if (error) throw error;
  return (data as { start_date: string; end_date: string; absence_type_code: string }[]).map((r) => ({ start: r.start_date, end: r.end_date, long: r.absence_type_code === 'long_sick' }));
}

/** Save a member's own days (works / off, hours) for the given dates. */
export async function setSdDays(memberId: string, days: { date: string; works: boolean; hours: number | null }[]) {
  if (!days.length) return;
  const { error } = await supabase.from('sd_days').upsert(days.map((d) => ({ member_id: memberId, work_date: d.date, works: d.works, hours: d.hours })), { onConflict: 'member_id,work_date' });
  if (error) throw error;
  dataChanged();
}

/** Many members' own days at once (spread the days off), in chunks. */
export async function setSdDaysMany(rows: { memberId: string; date: string; works: boolean; hours?: number | null }[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('sd_days').upsert(rows.slice(i, i + 500).map((r) => ({ member_id: r.memberId, work_date: r.date, works: r.works, hours: r.works ? r.hours ?? null : null })), { onConflict: 'member_id,work_date' });
    if (error) throw error;
  }
  dataChanged();
}

/** Back to the plan pattern: forget the member's own days. */
export async function clearSdDays(memberId: string) {
  const { error } = await supabase.from('sd_days').delete().eq('member_id', memberId);
  if (error) throw error;
  dataChanged();
}

/** Save the phases of a total turnaround: new ones added, changed ones updated, the rest removed (kept in the history). */
export async function saveSdPhases(planId: string, phases: SdPhase[], removed: string[]) {
  for (const x of phases) {
    const row = { start_date: x.start, end_date: x.end, needs: x.needs };
    const { error } = x.id.startsWith('new') ? await supabase.from('sd_phases').insert({ ...row, plan_id: planId }) : await supabase.from('sd_phases').update(row).eq('id', x.id);
    if (error) throw error;
  }
  if (removed.length) { const { error } = await supabase.from('sd_phases').update({ status: 'removed' }).in('id', removed); if (error) throw error; }
  dataChanged();
}

/** An area (or Controller section) renamed: its members follow. */
export async function renameSdArea(planId: string, from: string, to: string) {
  const { error } = await supabase.from('sd_members').update({ area: to }).eq('plan_id', planId).eq('area', from).eq('status', 'active');
  if (error) throw error;
}

/** Reason text of the shift movement that belongs to a shutdown instruction (to find it again). */
export const FOLLOW_MARK = 'Shutdown instruction';
/** The active shift movements made by shutdown instructions, per employee. */
export async function fetchFollowMovements(employeeIds: string[]): Promise<Map<string, { id: string; to: Crew; start: string; end: string | null }>> {
  const out = new Map<string, { id: string; to: Crew; start: string; end: string | null }>();
  if (!employeeIds.length) return out;
  const all = await fetchMovements();
  const ids = new Set(employeeIds);
  for (const m of all) if (m.status === 'active' && m.kind === 'temporary' && ids.has(m.employee_id) && m.to_crew !== 'DAY' && (m.reason ?? '').startsWith(FOLLOW_MARK)) out.set(m.employee_id, { id: m.id, to: m.to_crew as Crew, start: m.start_date, end: m.end_date });
  return out;
}

/**
 * The instruction "follow crew X's shift, then join the team": on the team the member keeps X's duty and rest days; before
 * joining (`from` to the day before `member.start`) they work X's shift, recorded as a temporary shift movement so the
 * crews' cover counts it. `to` null removes the instruction (and the movement it made). A VR Controller has no crew of his own
 * (the shift movement is refused for him; his placements are the Section Head's): only the rota on the team changes.
 */
export async function setFollow(v: { member: SdMember; title: string; to: Crew | null; from: string | null; previous?: { id: string } | null; vr?: boolean }) {
  const { member: m, to } = v;
  if (v.vr) { await updateSdMember(m.id, { follow_crew: to }); return; }
  if (v.previous) await cancelMovement(v.previous.id, to ? 'Instruction changed' : 'Instruction removed');
  if (to && v.from) {
    const last = new Date(Date.parse(m.start) - 864e5).toISOString().slice(0, 10);
    if (v.from <= last) await recordMovement({ employee: m.employeeId, kind: 'temporary', to, start: v.from, end: last, reason: `${FOLLOW_MARK} · ${v.title}: follow ${to} shift, take off, then join the team` });
  }
  await updateSdMember(m.id, { follow_crew: to });
}
