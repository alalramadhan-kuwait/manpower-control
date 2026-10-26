// Leave Impact Preview (Calendar Stage 2, owner 26 Oct 2026): what one leave does to the person's crew, duty by duty,
// using only the manpower engine (evaluateRange) and the Controller leave rules; no rule of its own.
// "Without" = the plan without this leave's records; "with" = the plan with it (for a request, or a leave that does not
// count yet — e.g. started without approval — "with" shows what counting it would do).
import { crewMarks, type DayMark } from '../calendar';
import { leaveGroup } from '../calendar/board';
import { checkCandidates } from '../controllers';
import { CONTROLLER_LEAVE_RULES, checkControllerLeave, isControllerRole, joinPeriods, type LeaveApproval } from '../controllers/leaveRules';
import { evaluateRange, personOn, type CrewDay, type MpAbsence, type MpAssignment, type MpPerson, type RulesSource } from '../manpower';
import { addDaysIso, isWorkingDay, type Crew } from '../roster';

export type Shift = 'M' | 'A' | 'N';
/** Why a duty is not safe: a confirmed shortage, Controller cover not recorded, or qualification data missing. */
export type DutyIssue = 'short' | 'cover_needed' | 'data_missing' | null;
export interface PositionCount { before: number; after: number; min: number }
export interface PreviewDuty {
  date: string; shift: Shift; crew: Crew; before: DayMark; after: DayMark; issue: DutyIssue;
  controller: PositionCount; panel: PositionCount; field: PositionCount;
  /** Others of the crew on leave on this duty (not this person). */
  othersOff: { id: string; name: string; role: string | null }[];
}
export interface LeavePreview {
  /** Duties of the person's crew inside the leave (the crew can change with a placement or cover). */
  duties: PreviewDuty[];
  worse: number; short: number; coverNeeded: number; dataMissing: number;
  lastDuty: { date: string; shift: string } | null; nextDuty: { date: string; shift: string } | null;
  /** Annual-leave periods of this person in the leave's year, with this leave counted. */
  year: { count: number; days: number };
  controller: null | {
    /** Other Controllers (crew or VR) on leave on any of these days, with the shared days. */
    offTogether: { id: string; name: string; crew: Crew | null; vr: boolean; start: string; end: string }[];
    /** Rule: at most this many annual leaves a year without the Section Head's approval. */
    nth: number; extra: boolean;
    /** Controllers free for a shift cover of the person's crew over these dates (no blocking problem). */
    candidates: { id: string; name: string; warnings: string[] }[];
  };
}

const RANK: Record<DayMark, number> = { off: -1, green: 0, amber: 1, pending: 2, red: 3 };
const issueOf = (c: CrewDay): DutyIssue => (c.confirmedShortage ? 'short' : c.pending.includes('coverage_required') ? 'cover_needed' : c.pending.includes('data_incomplete') ? 'data_missing' : null);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
/** The longest stretch the preview evaluates (an open-ended absence is checked for this many days). */
export const PREVIEW_MAX_DAYS = 62;

export function leavePreview(
  leave: { employeeId: string; start: string; end: string; typeCode: string | null; recordIds: string[] },
  people: MpPerson[], absences: MpAbsence[], assignments: MpAssignment[], rules: RulesSource, approvals: LeaveApproval[]
): LeavePreview {
  const person = people.find((p) => p.id === leave.employeeId);
  const end = days(leave.start, leave.end) > PREVIEW_MAX_DAYS ? addDaysIso(leave.start, PREVIEW_MAX_DAYS - 1) : leave.end;
  const ids = new Set(leave.recordIds);
  const without = absences.filter((a) => !a.id || !ids.has(a.id));
  const self: MpAbsence = { id: '__preview', employeeId: leave.employeeId, start: leave.start, end: leave.end, status: 'approved', typeCode: leave.typeCode, typeLabel: null, inCurrentPlan: true };
  const withIt = [...without, self];
  const before = evaluateRange(leave.start, end, people, without, rules, assignments);
  const after = evaluateRange(leave.start, end, people, withIt, rules, assignments);
  const byId = new Map(people.map((p) => [p.id, p]));
  const duties: PreviewDuty[] = [];
  before.forEach((day, i) => {
    // the crew the engine counts the person in that day (own crew, VR placement, cover, day duty), on a working duty
    const a = after[i].crews.find((c) => c.working && c.absences.some((x) => x.person.id === leave.employeeId && x.reducesManpower));
    if (!a) return;
    const b = day.crews.find((c) => c.crew === a.crew)!;
    const mb = crewMarks(day).find((m) => m.crew === b.crew)!, ma = crewMarks(after[i]).find((m) => m.crew === b.crew)!;
    duties.push({
      date: day.date, shift: b.state as Shift, crew: b.crew, before: mb.mark, after: ma.mark, issue: issueOf(a),
      controller: { before: b.controller.count, after: a.controller.count, min: a.controller.min },
      panel: { before: b.panel.count, after: a.panel.count, min: a.panel.min },
      field: { before: b.field.count, after: a.field.count, min: a.field.min },
      othersOff: a.absences.filter((x) => x.reducesManpower && x.person.id !== leave.employeeId)
        .map((x) => ({ id: x.person.id, name: byId.get(x.person.id)?.name ?? x.person.name, role: x.person.role }))
    });
  });
  // last duty before and next duty after: the crew's working days the person is not on other leave
  const otherLeave = (d: string) => without.some((a) => a.employeeId === leave.employeeId && (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && a.start <= d && d <= a.end);
  const dutyOn = (d: string) => { if (!person) return null; const q = personOn(person, d); const c = q.crew;
    return c && isWorkingDay(d, c) && !otherLeave(d) ? (evaluateRange(d, d, people, without, rules, assignments)[0].crews.find((x) => x.crew === c)?.state ?? null) : null; };
  const scan = (from: string, step: 1 | -1) => { for (let k = 0, d = from; k < 40; k++, d = addDaysIso(d, step)) { const s = dutyOn(d); if (s) return { date: d, shift: s }; } return null; };
  const y = leave.start.slice(0, 4);
  const annual = joinPeriods(withIt.filter((a) => a.employeeId === leave.employeeId && (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && leaveGroup(a.typeCode) === 'Annual leave' && a.id))
    .filter((p) => p.start.slice(0, 4) === y);
  let controller: LeavePreview['controller'] = null;
  if (person && isControllerRole(person.role)) {
    const check = checkControllerLeave(people, withIt, approvals, [Number(y)]);
    const mine = check.overlaps.filter((o) => (o.a.ids.includes('__preview') || o.b.ids.includes('__preview')) && !o.approval);
    const nthOf = annual.findIndex((p) => p.ids.includes('__preview')) + 1;
    const crew = personOn(person, leave.start).crew;
    controller = {
      offTogether: mine.map((o) => { const other = o.a.employeeId === person.id ? o.b : o.a; const p = byId.get(other.employeeId);
        return { id: other.employeeId, name: p?.name ?? '', crew: p ? personOn(p, o.start).crew : null, vr: p?.role === 'vr_controller', start: o.start, end: o.end }; }),
      nth: nthOf, extra: nthOf > CONTROLLER_LEAVE_RULES.maxLeavesPerYear,
      candidates: crew ? checkCandidates('shift_cover', crew, leave.start, end, people, withIt, assignments)
        .filter((c) => c.person.id !== person.id && c.blocked.length === 0).map((c) => ({ id: c.person.id, name: c.person.name, warnings: c.warnings })) : []
    };
  }
  const worse = duties.filter((d) => RANK[d.after] > RANK[d.before]);
  return {
    duties, worse: worse.length, short: worse.filter((d) => d.issue === 'short').length,
    coverNeeded: worse.filter((d) => d.issue === 'cover_needed').length, dataMissing: worse.filter((d) => d.issue === 'data_missing').length,
    lastDuty: scan(addDaysIso(leave.start, -1), -1), nextDuty: isFinite(Date.parse(leave.end)) && leave.end < '9999' ? scan(addDaysIso(leave.end, 1), 1) : null,
    year: { count: annual.length, days: annual.reduce((n, p) => n + days(p.start < `${y}-01-01` ? `${y}-01-01` : p.start, p.end > `${y}-12-31` ? `${y}-12-31` : p.end), 0) },
    controller
  };
}
