// Controller leave rules (Section Head):
// 1. No two Controllers (crew Controllers and VR Controllers) on leave on the same day without the Section Head's approval.
// 2. At most 4 annual leaves per Controller per year; a 5th or later needs approval.
// 3. At least 25 days of annual leave per Controller per year (a reminder, no approval).
// Leave is never blocked: breaks are flagged until approved. An approval names the leave record(s) it covers.
import { leaveGroup } from '../calendar/board';
import type { MpAbsence, MpPerson } from '../manpower';
import { addDaysIso } from '../roster';

export const CONTROLLER_LEAVE_RULES = { maxLeavesPerYear: 4, minDaysPerYear: 25 } as const;
const ROLES = new Set(['controller', 'vr_controller', 'morning_controller']);
export const isControllerRole = (role: string | null | undefined) => ROLES.has(role ?? '');

export interface LeaveApproval { id: string; kind: 'overlap' | 'extra_leave'; leaveA: string; leaveB: string | null; note: string | null; createdAt: string }

/** One leave period: back-to-back or overlapping records of one person joined. `ids` in date order; ids[0] is its key. */
export interface LeavePeriod { employeeId: string; ids: string[]; start: string; end: string; codes: string[] }

const counted = (a: MpAbsence) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && !!a.id;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

export function joinPeriods(records: MpAbsence[]): LeavePeriod[] {
  const sorted = [...records].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.start.localeCompare(b.start));
  const out: LeavePeriod[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.employeeId === r.employeeId && r.start <= addDaysIso(last.end, 1)) {
      last.ids.push(r.id!); if (r.end > last.end) last.end = r.end;
      if (r.typeShort && !last.codes.includes(r.typeShort)) last.codes.push(r.typeShort);
      continue;
    }
    out.push({ employeeId: r.employeeId, ids: [r.id!], start: r.start, end: r.end, codes: r.typeShort ? [r.typeShort] : [] });
  }
  return out;
}

export interface Overlap { a: LeavePeriod; b: LeavePeriod; start: string; end: string; days: number; approval: LeaveApproval | null }
export interface ExtraLeave { period: LeavePeriod; year: number; nth: number; approval: LeaveApproval | null }
export interface ControllerYear { year: number; count: number; days: number; extras: ExtraLeave[] }
export interface ControllerLeaveCheck {
  overlaps: Overlap[];
  people: { person: MpPerson; years: ControllerYear[] }[];
}

const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/**
 * Checks every Controller's leave in `years`: overlapping leave between any two Controllers (all counted leave, as it
 * is about cover), and per year the number and total days of annual leave periods (a period belongs to the year it starts).
 */
export function checkControllerLeave(people: MpPerson[], absences: MpAbsence[], approvals: LeaveApproval[], years: number[]): ControllerLeaveCheck {
  const ctl = people.filter((p) => isControllerRole(p.role));
  const ids = new Set(ctl.map((p) => p.id));
  const mine = absences.filter((a) => counted(a) && ids.has(a.employeeId));
  const from = `${Math.min(...years)}-01-01`, to = `${Math.max(...years)}-12-31`;

  const overlapOk = new Map(approvals.filter((a) => a.kind === 'overlap' && a.leaveB).map((a) => [pairKey(a.leaveA, a.leaveB!), a]));
  const extraOk = new Map(approvals.filter((a) => a.kind === 'extra_leave').map((a) => [a.leaveA, a]));

  const all = joinPeriods(mine).filter((p) => p.end >= from && p.start <= to);
  const overlaps: Overlap[] = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.employeeId === b.employeeId || a.start > b.end || b.start > a.end) continue;
    const start = a.start > b.start ? a.start : b.start, end = a.end < b.end ? a.end : b.end;
    const [x, y] = a.start < b.start || (a.start === b.start && a.employeeId < b.employeeId) ? [a, b] : [b, a];
    overlaps.push({ a: x, b: y, start, end, days: days(start, end), approval: overlapOk.get(pairKey(a.ids[0], b.ids[0])) ?? null });
  }
  overlaps.sort((p, q) => p.start.localeCompare(q.start));

  const annual = joinPeriods(mine.filter((a) => leaveGroup(a.typeCode) === 'Annual leave'));
  return {
    overlaps,
    people: ctl.map((person) => ({
      person,
      years: years.map((year) => {
        const ys = `${year}-01-01`, ye = `${year}-12-31`;
        const periods = annual.filter((p) => p.employeeId === person.id && p.start.slice(0, 4) === String(year));
        const total = annual.filter((p) => p.employeeId === person.id && p.end >= ys && p.start <= ye)
          .reduce((n, p) => n + days(p.start < ys ? ys : p.start, p.end > ye ? ye : p.end), 0);
        const extras = periods.slice(CONTROLLER_LEAVE_RULES.maxLeavesPerYear)
          .map((period, k) => ({ period, year, nth: CONTROLLER_LEAVE_RULES.maxLeavesPerYear + k + 1, approval: extraOk.get(period.ids[0]) ?? null }));
        return { year, count: periods.length, days: total, extras };
      })
    }))
  };
}

/** What still needs the Section Head: unapproved overlaps and extra leaves not over by `today`. */
export function openIssues(check: ControllerLeaveCheck, today: string) {
  return {
    overlaps: check.overlaps.filter((o) => !o.approval && o.end >= today),
    extras: check.people.flatMap((p) => p.years.flatMap((y) => y.extras)).filter((x) => !x.approval && x.period.end >= today)
  };
}
