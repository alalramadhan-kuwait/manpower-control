import { cancelLeave, fetchLeavePlan, saveLeave } from './leave';
import { fetchAllSdMembers, fetchSdPlans, fetchSickTotals } from './shutdown';
import type { EmployeeDirectoryRow, LeaveRecord } from './types';

export interface PvData {
  year: number;
  people: EmployeeDirectoryRow[];
  leaves: LeaveRecord[];
  /** Sick-leave days per person over the two years before the plan year. */
  sick: Map<string, number>;
  shutdowns: { employeeId: string; start: string; end: string; title: string }[];
}

/** Everything the PV planner shows for one year. */
export async function fetchPv(year: number): Promise<PvData> {
  const [plan, totals, sdPlans, sdMembers] = await Promise.all([fetchLeavePlan(year), fetchSickTotals([year - 2, year - 1]), fetchSdPlans(), fetchAllSdMembers()]);
  const planOf = new Map(sdPlans.map((p) => [p.id, p]));
  const sick = new Map([...totals].map(([id, byYear]) => [id, (byYear[year - 1] ?? 0) + (byYear[year - 2] ?? 0)]));
  const shutdowns = sdMembers.map((m) => ({ m, p: planOf.get(m.planId) })).filter((x) => x.p && x.m.start <= `${year}-12-31` && x.m.end >= `${year}-01-01`)
    .map(({ m, p }) => ({ employeeId: m.employeeId, start: m.start, end: m.end, title: p!.title }));
  return { year, people: plan.people, leaves: plan.leaves, sick, shutdowns };
}

/** Make a person's whole-cycle leave match `blocks` (each a first and last day): cancels the blocks no longer wanted, then adds the new ones. */
export async function applyPvBlocks(v: { employeeId: string; year: number; existing: { id: string; start: string; end: string }[]; blocks: { start: string; end: string }[] }): Promise<void> {
  const key = (b: { start: string; end: string }) => `${b.start}|${b.end}`;
  const want = new Set(v.blocks.map(key)), have = new Set(v.existing.map(key));
  for (const e of v.existing) if (!want.has(key(e))) await cancelLeave(e.id, `PV ${v.year} plan changed`);
  for (const b of v.blocks) if (!have.has(key(b))) await saveLeave({ record: null, employee: v.employeeId, type: 'annual_leave_planned', start: b.start, end: b.end, note: `PV ${v.year}` });
}
