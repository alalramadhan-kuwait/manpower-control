import { cancelLeave, fetchLeavePlan, saveLeave } from './leave';
import { dataChanged } from './changes';
import { supabase } from './supabase';
import { fetchAllSdMembers, fetchSdPlans, fetchSickTotals } from './shutdown';
import type { EmployeeDirectoryRow, LeaveRecord } from './types';

export interface PvData {
  year: number;
  people: EmployeeDirectoryRow[];
  leaves: LeaveRecord[];
  /** Sick-leave days per person over the two years before the plan year. */
  sick: Map<string, number>;
  shutdowns: { employeeId: string; start: string; end: string; title: string }[];
  /** The year's PV plan (draft until published). While it is not published, its blocks are shown as the PV, not leave_records. */
  pvPlan: PvPlan | null;
}

export type PvPlanStatus = 'draft' | 'submitted' | 'approved' | 'published';
export interface PvPlanEvent { action: 'created' | 'submitted' | 'returned' | 'approved' | 'published'; version: number; blocks: number; note: string | null; at: string }
export interface PvPlan { id: string; year: number; status: PvPlanStatus; version: number; note: string | null; events: PvPlanEvent[] }
const plain = (e: { message: string }) => new Error(e.message);

export async function fetchPvPlan(year: number): Promise<PvPlan | null> {
  const { data, error } = await supabase.from('pv_plans').select('id,year,status,version,note').eq('year', year).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: ev, error: e2 } = await supabase.from('pv_plan_events').select('action,version,blocks,note,at').eq('plan_id', data.id).order('at', { ascending: false });
  if (e2) throw e2;
  return { ...(data as Omit<PvPlan, 'events'>), events: (ev ?? []) as PvPlanEvent[] };
}

/** The draft's live blocks, shaped as planned annual leave so the planner reads them like the live plan. */
async function draftLeaves(plan: PvPlan): Promise<LeaveRecord[]> {
  const { data, error } = await supabase.from('pv_plan_blocks').select('id,employee_id,start_date,end_date,created_at').eq('plan_id', plan.id).is('removed_at', null).order('start_date');
  if (error) throw error;
  return (data ?? []).map((b) => ({ ...(b as { id: string; employee_id: string; start_date: string; end_date: string; created_at: string }), absence_type_code: 'annual_leave_planned', status: 'planned', source_kind: 'pv_schedule', source_ref: null, source_batch_id: null, review_status: 'none', note: null, in_current_plan: true, in_original_plan: true } as unknown as LeaveRecord));
}

export async function submitPvPlan(year: number, note: string) { const { error } = await supabase.rpc('pv_plan_submit', { p_year: year, p_note: note || null }); if (error) throw plain(error); dataChanged(); }
export async function decidePvPlan(year: number, approve: boolean, note: string) { const { error } = await supabase.rpc('pv_plan_decide', { p_year: year, p_approve: approve, p_note: note || null }); if (error) throw plain(error); dataChanged(); }
export async function publishPvPlan(year: number): Promise<number> { const { data, error } = await supabase.rpc('pv_plan_publish', { p_year: year }); if (error) throw plain(error); dataChanged(); return data as number; }

/** Everything the PV planner shows for one year. */
export async function fetchPv(year: number): Promise<PvData> {
  const [plan, totals, sdPlans, sdMembers, pvPlan] = await Promise.all([fetchLeavePlan(year), fetchSickTotals([year - 2, year - 1]), fetchSdPlans(), fetchAllSdMembers(), fetchPvPlan(year)]);
  const planOf = new Map(sdPlans.map((p) => [p.id, p]));
  const sick = new Map([...totals].map(([id, byYear]) => [id, (byYear[year - 1] ?? 0) + (byYear[year - 2] ?? 0)]));
  const shutdowns = sdMembers.map((m) => ({ m, p: planOf.get(m.planId) })).filter((x) => x.p && x.m.start <= `${year}-12-31` && x.m.end >= `${year}-01-01`)
    .map(({ m, p }) => ({ employeeId: m.employeeId, start: m.start, end: m.end, title: p!.title }));
  // an unpublished plan: its draft blocks are the PV; the other leave of the year (sick, courses…) still shows beside them
  const draft = pvPlan && pvPlan.status !== 'published';
  const leaves = draft ? [...plan.leaves.filter((l) => !(l.absence_type_code ?? '').startsWith('annual_leave')), ...await draftLeaves(pvPlan)] : plan.leaves;
  return { year, people: plan.people, leaves, sick, shutdowns, pvPlan };
}

/** Make a person's whole-cycle leave match `blocks` (each a first and last day): cancels the blocks no longer wanted, then adds the new ones. */
export async function applyPvBlocks(v: { employeeId: string; year: number; draft?: boolean; existing: { id: string; start: string; end: string }[]; blocks: { start: string; end: string }[] }): Promise<void> {
  if (v.draft) {   // the draft: the person's blocks are replaced in one go, nothing reaches leave_records
    const { error } = await supabase.rpc('pv_draft_set', { p_year: v.year, p_employee: v.employeeId, p_blocks: v.blocks });
    if (error) throw plain(error);
    return;
  }
  const key = (b: { start: string; end: string }) => `${b.start}|${b.end}`;
  const want = new Set(v.blocks.map(key)), have = new Set(v.existing.map(key));
  for (const e of v.existing) if (!want.has(key(e))) await cancelLeave(e.id, `PV ${v.year} plan changed`);
  for (const b of v.blocks) if (!have.has(key(b))) await saveLeave({ record: null, employee: v.employeeId, type: 'annual_leave_planned', start: b.start, end: b.end, note: `PV ${v.year}` });
}
