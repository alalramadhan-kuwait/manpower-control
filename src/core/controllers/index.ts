// Controller Management (Stage H): where cover is needed, and who can cover a crew for a period.
// The same rules are enforced by the database (controller_assignments); these give the screen early answers.
import { evaluateRange, FULL_OPERATION, type MpAbsence, type MpAssignment, type MpPerson } from '../manpower';
import { addDaysIso, isWorkingDay, type Crew } from '../roster';

export const COVER_GRADE = 15;
const CONTROLLER_ROLES = new Set(['controller', 'vr_controller', 'morning_controller']);

/** Last allowed end date of a Morning rotation starting on `start`: strictly less than two calendar months later. */
export function maxEndDate(start: string): string {
  const [y, m, d] = start.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + 2, d));
  // JS rolls 31 Dec + 2 months to 3 Mar; the database uses PostgreSQL, which clamps to the month end (28/29 Feb)
  if (target.getUTCDate() !== d) target.setUTCDate(0);
  return addDaysIso(target.toISOString().slice(0, 10), -1);
}

export interface CoverageNeed {
  /** 'crew': a crew has no Controller; 'morning': the Morning Controller is away covering a shift and the post is empty. */
  kind: 'crew' | 'morning';
  crew: Crew | null;
  start: string; end: string; dutyDays: number; who: string[]; absentIds: string[];
  /** Suggested VR Controller for this crew need (free for the whole period), or null. */
  vr: MpPerson | null;
  /** True when another need in the same period already takes the VR: an additional Controller is required. */
  additional: boolean;
  /** Why the VR cannot take it (e.g. "VR covers C Shift 1 Dec – 14 Dec", "VR on leave"). */
  vrNote: string | null;
}

/**
 * Periods in [from, to] needing Controller cover: crews whose Controller line is "coverage required" (duty days
 * separated only by the crew's Off days form one period) and days when the Morning post is empty because the
 * Morning Controller covers a shift. Crew needs are then planned against the VR Controller(s) in date order: the
 * first need in a period gets a free VR, an overlapping one is "Additional Controller required".
 */
export function coverageNeeds(from: string, to: string, people: MpPerson[], absences: MpAbsence[], assignments: MpAssignment[]): CoverageNeed[] {
  const out: CoverageNeed[] = [];
  const open = new Map<string, CoverageNeed>();
  const close = (key: string) => { const cur = open.get(key); if (cur) { out.push(cur); open.delete(key); } };
  const blank = { vr: null, additional: false, vrNote: null };
  for (const day of evaluateRange(from, to, people, absences, FULL_OPERATION, assignments)) {
    for (const c of day.crews) {
      if (!c.working) continue;
      const key = `crew:${c.crew}`;
      if (c.controller.finding !== 'coverage_required') { close(key); continue; }
      const ids = [...c.controller.onLeave.map((p) => p.id), ...c.controller.away.map((w) => w.person.id)];
      const names = [...c.controller.onLeave.map((p) => p.name), ...c.controller.away.map((w) => w.person.name)];
      const cur = open.get(key);
      if (cur) {
        cur.end = day.date; cur.dutyDays++;
        for (let i = 0; i < ids.length; i++) if (!cur.absentIds.includes(ids[i])) { cur.absentIds.push(ids[i]); cur.who.push(names[i]); }
      } else open.set(key, { kind: 'crew', crew: c.crew, start: day.date, end: day.date, dutyDays: 1, who: names, absentIds: ids, ...blank });
    }
    const mp = day.morningPost;
    if (mp.status !== 'coverage_required') close('morning');
    else {
      const cur = open.get('morning');
      const mc = people.find((p) => p.role === 'morning_controller');
      if (cur) { cur.end = day.date; cur.dutyDays++; }
      else open.set('morning', { kind: 'morning', crew: null, start: day.date, end: day.date, dutyDays: 1, who: mc ? [mc.name] : [], absentIds: mc ? [mc.id] : [], ...blank });
    }
  }
  for (const key of [...open.keys()]) close(key);
  out.sort((a, b) => a.start.localeCompare(b.start) || (a.crew ?? 'Z').localeCompare(b.crew ?? 'Z'));
  planVr(out.filter((n) => n.kind === 'crew'), people, absences, assignments);
  return out;
}

/** Offers each crew need, in date order, to a VR Controller who is free for the whole period. */
function planVr(needs: CoverageNeed[], people: MpPerson[], absences: MpAbsence[], assignments: MpAssignment[]) {
  const vrs = people.filter((p) => p.role === 'vr_controller' && p.grade != null && p.grade >= COVER_GRADE);
  const taken: { id: string; start: string; end: string; crew: Crew | null }[] = assignments.map((a) => ({ id: a.employeeId, start: a.start, end: a.end, crew: a.crew }));
  const counted = (a: MpAbsence) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false;
  const onLeaveThroughout = (id: string, n: CoverageNeed) => absences.some((a) => a.employeeId === id && counted(a) && a.start <= n.start && a.end >= n.end);
  const leaveInside = (id: string, n: CoverageNeed) => absences.filter((a) => a.employeeId === id && counted(a) && a.start <= n.end && a.end >= n.start);
  for (const n of needs) {
    if (!vrs.length) { n.additional = true; n.vrNote = 'No VR Controller recorded'; continue; }
    const candidates = vrs.filter((v) => !onLeaveThroughout(v.id, n) && !taken.some((t) => t.id === v.id && t.start <= n.end && t.end >= n.start))
      .sort((a, b) => leaveInside(a.id, n).length - leaveInside(b.id, n).length);
    const free = candidates[0];
    if (free) {
      n.vr = free; taken.push({ id: free.id, start: n.start, end: n.end, crew: n.crew });
      // clip the VR's leave to the gap and join back-to-back records into one period
      const spans = leaveInside(free.id, n).map((a) => ({ start: a.start < n.start ? n.start : a.start, end: a.end > n.end ? n.end : a.end })).sort((x, y) => x.start.localeCompare(y.start));
      const joined: { start: string; end: string }[] = [];
      for (const sp of spans) { const last = joined[joined.length - 1]; if (last && addDaysIso(last.end, 1) >= sp.start) { if (sp.end > last.end) last.end = sp.end; } else joined.push({ ...sp }); }
      if (joined.length) n.vrNote = `VR on leave part of this period (${joined.map((x) => (x.start === x.end ? x.start : `${x.start} – ${x.end}`)).join(', ')})`;
      continue;
    }
    n.additional = true;
    const busy = taken.find((t) => vrs.some((v) => v.id === t.id) && t.start <= n.end && t.end >= n.start);
    n.vrNote = busy ? `VR covers ${busy.crew ?? 'another'} Shift ${busy.start} – ${busy.end}` : 'VR on leave';
  }
}

/** Last allowed end date of a shift cover: no limit unless a maximum number of days is configured. */
export function shiftCoverMaxEnd(start: string, maxDays: number | null): string | null {
  return maxDays ? addDaysIso(start, maxDays - 1) : null;
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
