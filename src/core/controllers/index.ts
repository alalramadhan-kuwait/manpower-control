// Controller Management (Stage H): where cover is needed, and who can cover a crew for a period.
// The same rules are enforced by the database (controller_assignments); these give the screen early answers.
import { evaluateRange, FULL_OPERATION, type MpAbsence, type MpAssignment, type MpPerson } from '../manpower';
import { addDaysIso, isWorkingDay, type Crew } from '../roster';

export const COVER_GRADE = 15;
const CONTROLLER_ROLES = new Set(['controller', 'vr_controller', 'morning_controller']);

/** Last allowed end date for an assignment starting on `start`: strictly less than two calendar months later. */
export function maxEndDate(start: string): string {
  const [y, m, d] = start.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + 2, d));
  // JS rolls 31 Dec + 2 months to 3 Mar; the database uses PostgreSQL, which clamps to the month end (28/29 Feb)
  if (target.getUTCDate() !== d) target.setUTCDate(0);
  return addDaysIso(target.toISOString().slice(0, 10), -1);
}

export interface CoverageNeed { crew: Crew; start: string; end: string; dutyDays: number; who: string[]; absentIds: string[] }

/**
 * Periods in [from, to] where a crew's Controller line is "coverage required". Duty days separated only by the
 * crew's Off days belong to one period, so a 14-day leave shows as one need, not as three.
 */
export function coverageNeeds(from: string, to: string, people: MpPerson[], absences: MpAbsence[], assignments: MpAssignment[]): CoverageNeed[] {
  const out: CoverageNeed[] = [];
  const open = new Map<Crew, CoverageNeed>();
  for (const day of evaluateRange(from, to, people, absences, FULL_OPERATION, assignments)) {
    for (const c of day.crews) {
      if (!c.working) continue;
      const need = c.controller.finding === 'coverage_required';
      const cur = open.get(c.crew);
      if (!need) { if (cur) { out.push(cur); open.delete(c.crew); } continue; }
      const ids = [...c.controller.onLeave.map((p) => p.id), ...c.controller.away.map((w) => w.person.id)];
      const names = [...c.controller.onLeave.map((p) => p.name), ...c.controller.away.map((w) => w.person.name)];
      if (cur) {
        cur.end = day.date; cur.dutyDays++;
        for (let i = 0; i < ids.length; i++) if (!cur.absentIds.includes(ids[i])) { cur.absentIds.push(ids[i]); cur.who.push(names[i]); }
      } else open.set(c.crew, { crew: c.crew, start: day.date, end: day.date, dutyDays: 1, who: names, absentIds: ids });
    }
  }
  out.push(...open.values());
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.crew.localeCompare(b.crew));
}

export interface CandidateCheck {
  person: MpPerson;
  /** Hard problems: the database would refuse the assignment. */
  blocked: string[];
  /** Soft problems worth seeing before choosing (the cover does not count on these days). */
  warnings: string[];
}

/** Every Controller who could be assigned, with what stands in the way for these dates. */
export function checkCandidates(kind: MpAssignment['kind'], crew: Crew | null, start: string, end: string,
  people: MpPerson[], absences: MpAbsence[], assignments: MpAssignment[], editingId?: string): CandidateCheck[] {
  const counted = (a: MpAbsence) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false;
  return people
    .filter((p) => p.role && CONTROLLER_ROLES.has(p.role))
    .map((p) => {
      const blocked: string[] = []; const warnings: string[] = [];
      if (p.grade == null || p.grade < COVER_GRADE) blocked.push(`Grade ${p.grade ?? '—'}; Grade ${COVER_GRADE}+ required`);
      if (kind === 'shift_cover' && crew && p.crew === crew) blocked.push('Own crew');
      const clash = assignments.find((a) => a.id !== editingId && a.employeeId === p.id && a.start <= end && a.end >= start);
      if (clash) blocked.push(`Already ${clash.kind === 'morning_rotation' ? 'on Morning rotation' : `covering ${clash.crew} Shift`} ${clash.start} – ${clash.end}`);
      const leaveDays = new Set<string>();
      for (const a of absences) if (a.employeeId === p.id && counted(a)) for (let d = a.start < start ? start : a.start; d <= a.end && d <= end; d = addDaysIso(d, 1)) leaveDays.add(d);
      if (leaveDays.size) warnings.push(`On leave ${leaveDays.size} of these days`);
      if (p.crew) {
        let clashDays = 0;
        for (let d = start; d <= end; d = addDaysIso(d, 1)) if (isWorkingDay(d, p.crew) && (kind === 'morning_rotation' || !crew || isWorkingDay(d, crew))) clashDays++;
        if (clashDays) warnings.push(`Own crew (${p.crew}) loses them on ${clashDays} duty day${clashDays === 1 ? '' : 's'}`);
      }
      return { person: p, blocked, warnings };
    })
    .sort((a, b) => a.blocked.length - b.blocked.length || a.warnings.length - b.warnings.length || rank(a.person) - rank(b.person) || a.person.name.localeCompare(b.person.name));
}
const rank = (p: MpPerson) => (p.role === 'vr_controller' ? 0 : p.role === 'morning_controller' ? 1 : 2);
