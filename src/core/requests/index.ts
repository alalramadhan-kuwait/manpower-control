// Leave requests (Stage F): what a request would do to the crew's manpower, following the MAB leave request form.
// Pure functions over the manpower engine; no I/O.
import { crewMarks, type DayMark } from '../calendar';
import { evaluateRange, FULL_OPERATION, type MpAbsence, type MpAssignment, type MpPerson, type RulesSource } from '../manpower';
import { addDaysIso, isWorkingDay, type Crew } from '../roster';

export type RequestType = 'scheduled' | 'unscheduled' | 'unpaid';
export const REQUEST_TYPES: RequestType[] = ['scheduled', 'unscheduled', 'unpaid'];
export const REQUEST_TYPE_LABEL: Record<RequestType, string> = { scheduled: 'Scheduled', unscheduled: 'Unscheduled', unpaid: 'Unpaid' };
/** The leave type an approved request becomes (the same mapping as request_type_code in the database). */
export const REQUEST_TYPE_CODE: Record<RequestType, string> = { scheduled: 'annual_leave_planned', unscheduled: 'annual_leave_unscheduled', unpaid: 'unpaid_leave' };

export interface ImpactDay { date: string; shift: 'M' | 'A' | 'N'; before: DayMark; after: DayMark }
export interface RequestImpact {
  crew: Crew | null;
  calendarDays: number;
  /** Duty days of the employee's crew inside the request (all days for day staff). */
  dutyDays: number;
  /** Each crew duty in the request with the crew's result without and with this leave. */
  duties: ImpactDay[];
  /** Duties whose result gets worse (green → amber → pending → red). */
  worse: ImpactDay[];
  /** Duties that would become a confirmed shortage (RED): overtime is likely needed. */
  red: ImpactDay[];
  /** Duties that would need Controller cover (the employee is the crew's Controller). */
  coverNeeded: ImpactDay[];
  /** Leave already counted for this employee that overlaps the request. */
  overlaps: MpAbsence[];
}

const RANK: Record<DayMark, number> = { off: -1, green: 0, amber: 1, pending: 2, red: 3 };
// current leave (as request_decide counts it): approved or planned, and unresolved absences still in the plan
const counted = (a: MpAbsence) => (a.status === 'approved' || a.status === 'planned' || a.status === 'unresolved') && a.inCurrentPlan !== false;

export function requestImpact(req: { employeeId: string; start: string; end: string; typeCode: string }, people: MpPerson[], absences: MpAbsence[], assignments: MpAssignment[] = [], rules: RulesSource = FULL_OPERATION): RequestImpact {
  const person = people.find((p) => p.id === req.employeeId) ?? null;
  const crew = person?.crew ?? null;
  const overlaps = absences.filter((a) => a.employeeId === req.employeeId && counted(a) && a.start <= req.end && a.end >= req.start);
  let calendarDays = 0, dutyDays = 0;
  for (let d = req.start; d <= req.end; d = addDaysIso(d, 1)) { calendarDays++; if (!crew || isWorkingDay(d, crew)) dutyDays++; }
  const duties: ImpactDay[] = [];
  if (crew) {
    const withLeave: MpAbsence[] = [...absences, { employeeId: req.employeeId, start: req.start, end: req.end, status: 'approved', typeCode: req.typeCode, typeLabel: null, inCurrentPlan: true }];
    const before = evaluateRange(req.start, req.end, people, absences, rules, assignments);
    const after = evaluateRange(req.start, req.end, people, withLeave, rules, assignments);
    before.forEach((day, i) => {
      const b = crewMarks(day).find((m) => m.crew === crew)!;
      if (b.shift === 'Off') return;
      const a = crewMarks(after[i]).find((m) => m.crew === crew)!;
      duties.push({ date: day.date, shift: b.shift, before: b.mark, after: a.mark });
    });
  }
  const worse = duties.filter((d) => RANK[d.after] > RANK[d.before]);
  return {
    crew, calendarDays, dutyDays, duties, worse, overlaps,
    red: worse.filter((d) => d.after === 'red'),
    coverNeeded: person?.role === 'controller' ? worse.filter((d) => d.after === 'pending') : []
  };
}

export type ApprovalOutcome =
  | { kind: 'add' }
  | { kind: 'confirm'; record: MpAbsence; setsType: boolean }
  | { kind: 'move'; record: MpAbsence }
  | { kind: 'refused'; records: MpAbsence[] };

/**
 * What approving would do to the plan: the same rule as request_decide in the database, so the Section Head sees it
 * before deciding. One leave is never recorded twice.
 * - nothing on those dates → a new record;
 * - one record with the same dates → confirmed (its type set from the request if it differs);
 * - a Scheduled request and one planned / rescheduled PV block on other dates → the block moves to the request dates;
 * - anything else → refused until the overlapping leave is corrected or cancelled.
 * `overlaps` are the employee's current leave records overlapping the request (requestImpact().overlaps).
 */
export function approvalOutcome(req: { type: RequestType; start: string; end: string }, overlaps: MpAbsence[]): ApprovalOutcome {
  if (overlaps.length === 0) return { kind: 'add' };
  if (overlaps.length === 1) {
    const o = overlaps[0];
    if (o.status !== 'unresolved' && o.start === req.start && o.end === req.end) return { kind: 'confirm', record: o, setsType: o.typeCode !== REQUEST_TYPE_CODE[req.type] };
    if (o.status !== 'unresolved' && req.type === 'scheduled' && (o.typeCode === 'annual_leave_planned' || o.typeCode === 'annual_leave_rescheduled')) return { kind: 'move', record: o };
  }
  return { kind: 'refused', records: overlaps };
}
