// Who is on leave on a given day, and when they are back, for the leave markers and the Day Overview.
import { addDaysIso, isWorkingDay, type Crew } from '../roster';

export interface LeaveSpan { employeeId: string; start: string; end: string; status: string; inCurrentPlan: boolean; typeLabel: string | null; typeShort?: string | null }
export interface OnLeave {
  start: string;
  /** Last day of the unbroken absence run. */
  until: string;
  /** First day the person is available to work again: after the run, and on a working day of their crew. */
  returnOn: string;
  typeLabel: string | null;
  typeShort: string | null;
}

/** Leave that counts: approved or planned and part of the current plan (the same rule the manpower engine uses). */
const counts = (l: LeaveSpan) => (l.status === 'approved' || l.status === 'planned') && l.inCurrentPlan;

/**
 * First day available after `lastDay`: skips any day still inside another absence and, for crew members,
 * the crew's roster Off days (people return on their next duty day). Day staff return the next free day.
 */
export function firstDayBack(lastDay: string, crew: Crew | null, absentOn: (date: string) => boolean): string {
  let d = addDaysIso(lastDay, 1);
  for (let i = 0; i < 400 && (absentOn(d) || (crew !== null && !isWorkingDay(d, crew))); i++) d = addDaysIso(d, 1);
  return d;
}

/**
 * Employees on counted leave on `date`, with the unbroken run (back-to-back records such as annual leave
 * followed by an extension are joined) and the return date. `crewOf` gives a person's permanent crew.
 */
export function onLeaveOn(date: string, leaves: LeaveSpan[], crewOf: (employeeId: string) => Crew | null = () => null): Map<string, OnLeave> {
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
    const absentOn = (d: string) => list.some((l) => l.start <= d && d <= l.end);
    out.set(emp, { start, until, returnOn: firstDayBack(until, crewOf(emp), absentOn), typeLabel: now.typeLabel, typeShort: now.typeShort ?? null });
  }
  return out;
}
