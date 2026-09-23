// Who is on leave on a given day, for the "On leave" markers on employee screens.
import { addDaysIso } from '../roster';

export interface LeaveSpan { employeeId: string; start: string; end: string; status: string; inCurrentPlan: boolean; typeLabel: string | null }
export interface OnLeave { start: string; until: string; typeLabel: string | null }

/** Leave that counts: approved or planned and part of the current plan (the same rule the manpower engine uses). */
const counts = (l: LeaveSpan) => (l.status === 'approved' || l.status === 'planned') && l.inCurrentPlan;

/**
 * Employees on counted leave on `date`, with the last day of the unbroken leave run
 * (back-to-back records such as annual leave followed by an extension are joined).
 */
export function onLeaveOn(date: string, leaves: LeaveSpan[]): Map<string, OnLeave> {
  const byEmp = new Map<string, LeaveSpan[]>();
  for (const l of leaves) if (counts(l)) byEmp.set(l.employeeId, [...(byEmp.get(l.employeeId) ?? []), l]);
  const out = new Map<string, OnLeave>();
  for (const [emp, list] of byEmp) {
    const now = list.find((l) => l.start <= date && date <= l.end);
    if (!now) continue;
    let start = now.start, until = now.end;
    for (let grew = true; grew;) {
      grew = false;
      for (const l of list) {
        if (l.start <= addDaysIso(until, 1) && l.end > until) { until = l.end; grew = true; }
        if (l.end >= addDaysIso(start, -1) && l.start < start) { start = l.start; grew = true; }
      }
    }
    out.set(emp, { start, until, typeLabel: now.typeLabel });
  }
  return out;
}
