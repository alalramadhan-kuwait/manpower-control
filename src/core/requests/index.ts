// Leave requests (Stage F): what a request would do to the crew's manpower, following the MAB leave request form.
// Pure functions over the manpower engine; no I/O.
import { crewMarks, type DayMark } from '../calendar';
import { evaluateRange, FULL_OPERATION, type MpAbsence, type MpAssignment, type MpPerson } from '../manpower';
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
const counted = (a: MpAbsence) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false;

export function requestImpact(req: { employeeId: string; start: string; end: string; typeCode: string }, people: MpPerson[], absences: MpAbsence[], assignments: MpAssignment[] = []): RequestImpact {
  const person = people.find((p) => p.id === req.employeeId) ?? null;
  const crew = person?.crew ?? null;
  const overlaps = absences.filter((a) => a.employeeId === req.employeeId && counted(a) && a.start <= req.end && a.end >= req.start);
  let calendarDays = 0, dutyDays = 0;
  for (let d = req.start; d <= req.end; d = addDaysIso(d, 1)) { calendarDays++; if (!crew || isWorkingDay(d, crew)) dutyDays++; }
  const duties: ImpactDay[] = [];
  if (crew) {
    const withLeave: MpAbsence[] = [...absences, { employeeId: req.employeeId, start: req.start, end: req.end, status: 'approved', typeCode: req.typeCode, typeLabel: null, inCurrentPlan: true }];
    const before = evaluateRange(req.start, req.end, people, absences, FULL_OPERATION, assignments);
    const after = evaluateRange(req.start, req.end, people, withLeave, FULL_OPERATION, assignments);
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
