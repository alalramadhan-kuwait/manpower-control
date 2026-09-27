// Shutdown teams (Stage K): plans, teams and members; the Field Operator level. Staff read and write; every change is audited.
import { supabase } from './supabase';
import { dataChanged } from './changes';
import type { FoLevel, SdMember, SdPlan, SdSlot, SdTeam } from '@/core/shutdown';

interface PlanRow { id: string; event_id: string | null; title: string; start_date: string; end_date: string; days_on: number; days_off: number; shift_hours: number; ramp_days: number; ramp_hours: number; normal_hours: number; max_overtime: number; status: string }
interface TeamRow { id: string; plan_id: string; name: string; sort: number; controller_n: number; senior_n: number; good_n: number; new_n: number; ramp_controller_n: number; ramp_senior_n: number; ramp_good_n: number; ramp_new_n: number }
interface MemberRow { id: string; plan_id: string; team_id: string; employee_id: string; slot: SdSlot; day_offset: number; start_date: string; end_date: string }

const toPlan = (r: PlanRow): SdPlan => ({ id: r.id, eventId: r.event_id, title: r.title, start: r.start_date, end: r.end_date, daysOn: r.days_on, daysOff: r.days_off,
  shiftHours: Number(r.shift_hours), rampDays: r.ramp_days, rampHours: Number(r.ramp_hours), normalHours: Number(r.normal_hours), maxOvertime: Number(r.max_overtime) });
const toTeam = (r: TeamRow): SdTeam => ({ id: r.id, planId: r.plan_id, name: r.name, sort: r.sort,
  needs: { controller: r.controller_n, senior: r.senior_n, good: r.good_n, new: r.new_n }, rampNeeds: { controller: r.ramp_controller_n, senior: r.ramp_senior_n, good: r.ramp_good_n, new: r.ramp_new_n } });
export const toMember = (r: MemberRow): SdMember => ({ id: r.id, planId: r.plan_id, teamId: r.team_id, employeeId: r.employee_id, slot: r.slot, offset: r.day_offset, start: r.start_date, end: r.end_date });

export async function fetchSdPlans(): Promise<SdPlan[]> {
  const { data, error } = await supabase.from('sd_plans').select('*').eq('status', 'active').order('start_date');
  if (error) throw error;
  return (data as PlanRow[]).map(toPlan);
}

export async function fetchSdPlan(id: string): Promise<{ plan: SdPlan; teams: SdTeam[]; members: SdMember[] }> {
  const [p, t, m] = await Promise.all([
    supabase.from('sd_plans').select('*').eq('id', id).single(),
    supabase.from('sd_teams').select('*').eq('plan_id', id).eq('status', 'active').order('sort'),
    supabase.from('sd_members').select('*').eq('plan_id', id).eq('status', 'active')
  ]);
  const err = [p, t, m].find((r) => r.error)?.error; if (err) throw err;
  return { plan: toPlan(p.data as PlanRow), teams: (t.data as TeamRow[]).map(toTeam), members: (m.data as MemberRow[]).map(toMember) };
}

/** Active shutdown team members overlapping [from, to] (plans not cancelled), for the manpower engine. */
export async function fetchSdMembers(from: string, to: string): Promise<SdMember[]> {
  const { data, error } = await supabase.from('sd_members').select('*, sd_plans!inner(status)').eq('status', 'active').eq('sd_plans.status', 'active').lte('start_date', to).gte('end_date', from);
  if (error) throw error;
  return (data as MemberRow[]).map(toMember);
}

export async function createSdPlan(v: { title: string; start: string; end: string; eventId: string | null }): Promise<string> {
  const { data, error } = await supabase.from('sd_plans').insert({ title: v.title, start_date: v.start, end_date: v.end, event_id: v.eventId }).select('id').single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  const t = await supabase.from('sd_teams').insert([{ plan_id: id, name: 'Day', sort: 0 }, { plan_id: id, name: 'Night', sort: 1 }]);
  if (t.error) throw t.error;
  dataChanged();
  return id;
}

export async function updateSdPlan(id: string, v: Partial<{ title: string; start_date: string; end_date: string; days_on: number; days_off: number; shift_hours: number; ramp_days: number; ramp_hours: number; normal_hours: number; max_overtime: number; status: 'active' | 'cancelled' }>) {
  const { error } = await supabase.from('sd_plans').update(v).eq('id', id);
  if (error) throw error;
  dataChanged();
}

export async function updateSdTeam(id: string, v: Partial<Record<'controller_n' | 'senior_n' | 'good_n' | 'new_n' | 'ramp_controller_n' | 'ramp_senior_n' | 'ramp_good_n' | 'ramp_new_n', number>>) {
  const { error } = await supabase.from('sd_teams').update(v).eq('id', id);
  if (error) throw error;
  dataChanged();
}

export async function addSdMember(v: { planId: string; teamId: string; employeeId: string; slot: SdSlot; offset: number; start: string; end: string }) {
  const { error } = await supabase.from('sd_members').insert({ plan_id: v.planId, team_id: v.teamId, employee_id: v.employeeId, slot: v.slot, day_offset: v.offset, start_date: v.start, end_date: v.end });
  if (error) throw new Error(error.message.includes('sd_members_one_place') ? 'Already on a team of this shutdown.' : error.message);
  dataChanged();
}

export async function updateSdMember(id: string, v: Partial<{ day_offset: number; start_date: string; end_date: string; team_id: string; slot: SdSlot }>) {
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
