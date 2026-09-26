// What an Oracle HR leave request should say for a leave in the team plan. The plan (workbook) often includes the
// rest days around a leave; the Oracle request covers duty days only, so it starts on the first duty day and ends on
// the last one (rest days are not taken from the balance). Oracle counts the days without Fridays.
import { addDaysIso, isWorkingDay, type Crew } from '../roster';

const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
/** A person's rest day: their crew's roster Off day, or Friday / Saturday for day staff (no crew). */
export const isRestDay = (date: string, crew: Crew | null) => (crew ? !isWorkingDay(date, crew) : weekday(date) >= 5);
/** Days Oracle HR counts for a request: the calendar days without Fridays. */
export const oracleDays = (start: string, end: string) => { let n = 0; for (let d = start; d <= end; d = addDaysIso(d, 1)) if (weekday(d) !== 5) n++; return n; };

export interface ExpectedRequest {
  start: string; end: string;
  /** Oracle's day count (no Fridays). */
  days: number;
  /** Rest days of the plan before the first / after the last duty day (not in the request). */
  restBefore: number; restAfter: number;
  /** First duty day after the leave. */
  backOn: string;
}

/** The Oracle request for a planned leave `start`..`end`; `crewOn` gives the person's crew on a date (null = day staff). */
export function expectedRequest(start: string, end: string, crewOn: (date: string) => Crew | null): ExpectedRequest | null {
  let s = start, e = end;
  while (s <= end && isRestDay(s, crewOn(s))) s = addDaysIso(s, 1);
  while (e >= s && isRestDay(e, crewOn(e))) e = addDaysIso(e, -1);
  if (s > e) return null;
  let back = addDaysIso(end, 1);
  for (let i = 0; i < 60 && isRestDay(back, crewOn(back)); i++) back = addDaysIso(back, 1);
  const between = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  return { start: s, end: e, days: oracleDays(s, e), restBefore: between(start, s), restAfter: between(e, end), backOn: back };
}

/** Does an Oracle request (as typed from EasyHR) match the planned leave once rest days are set aside? */
export function matchesPlan(request: { start: string; end: string }, plan: { start: string; end: string }, crewOn: (date: string) => Crew | null): boolean {
  const a = expectedRequest(request.start, request.end, crewOn), b = expectedRequest(plan.start, plan.end, crewOn);
  return !!a && !!b && a.start === b.start && a.end === b.end;
}
