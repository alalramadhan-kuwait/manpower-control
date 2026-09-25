// Morning rotation plan: who holds the Morning Controller post on each working day (Sun–Thu), where the post is
// empty, and how the turns are shared. Pure functions over the same inputs as the manpower engine.
import { isDayDutyWorkday, type MpAbsence, type MpAssignment, type MpPerson } from '../manpower';
import { addDaysIso, isWorkingDay, type Crew } from '../roster';
import { COVER_GRADE, checkCandidates, maxEndDate } from '.';

export interface MorningSegment {
  /** held: someone holds the post; gap: the post is empty. */
  kind: 'held' | 'gap';
  employeeId: string | null;
  /** The Morning rotation behind it (null: the regular Morning Controller, or a gap). */
  assignmentId: string | null;
  start: string; end: string;
  /** Working days (Sun–Thu) in the segment. */
  workdays: number;
  /** Working days the holder is on leave (the post is then empty in practice). */
  leaveDays: number;
  /** A crew Controller holding the post leaves their crew: its duty days in the segment. */
  crewDuties: { crew: Crew; duties: number } | null;
}

const counted = (a: MpAbsence) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false;

/**
 * The post day by day over [from, to], joined into segments: a Morning rotation holds it; otherwise the regular
 * Morning Controller (unless away covering a shift); otherwise it is empty. Segments with no working day are dropped.
 */
export function morningPlan(from: string, to: string, people: MpPerson[], absences: MpAbsence[], assignments: MpAssignment[]): MorningSegment[] {
  const regular = people.find((p) => p.role === 'morning_controller') ?? null;
  const byId = new Map(people.map((p) => [p.id, p]));
  const out: MorningSegment[] = [];
  let cur: MorningSegment | null = null;
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const rotation = assignments.find((a) => a.kind === 'morning_rotation' && a.start <= d && d <= a.end) ?? null;
    const regularAway = regular && assignments.some((a) => a.kind === 'shift_cover' && a.employeeId === regular.id && a.start <= d && d <= a.end);
    const holder = rotation?.employeeId ?? (regular && !regularAway ? regular.id : null);
    const key = `${holder}|${rotation?.id ?? ''}`;
    if (!cur || `${cur.employeeId}|${cur.assignmentId ?? ''}` !== key) {
      if (cur) out.push(cur);
      const crew = holder ? byId.get(holder)?.crew ?? null : null;
      cur = { kind: holder ? 'held' : 'gap', employeeId: holder, assignmentId: rotation?.id ?? null, start: d, end: d, workdays: 0, leaveDays: 0, crewDuties: crew ? { crew, duties: 0 } : null };
    }
    cur.end = d;
    if (cur.crewDuties && isWorkingDay(d, cur.crewDuties.crew)) cur.crewDuties.duties++;
    if (!isDayDutyWorkday(d)) continue;
    cur.workdays++;
    if (holder && absences.some((a) => a.employeeId === holder && counted(a) && a.start <= d && d <= a.end)) cur.leaveDays++;
  }
  if (cur) out.push(cur);
  return out.filter((s) => s.workdays > 0).map((s) => (s.crewDuties?.duties === 0 ? { ...s, crewDuties: null } : s));
}

export interface MorningTurn { person: MpPerson; byYear: Record<number, number>; rotations: number; lastEnd: string | null }

/** Everyone who may hold the post (Grade 15+ Controllers) with their Morning working days per year and last turn. */
export function morningTurns(people: MpPerson[], rotations: MpAssignment[], years: number[]): MorningTurn[] {
  const eligible = people.filter((p) => (p.role === 'controller' || p.role === 'vr_controller' || p.role === 'morning_controller') && (p.grade ?? 0) >= COVER_GRADE);
  return eligible.map((person) => {
    const mine = rotations.filter((a) => a.kind === 'morning_rotation' && a.employeeId === person.id);
    const byYear: Record<number, number> = Object.fromEntries(years.map((y) => [y, 0]));
    for (const a of mine) for (let d = a.start; d <= a.end; d = addDaysIso(d, 1)) { const y = Number(d.slice(0, 4)); if (y in byYear && isDayDutyWorkday(d)) byYear[y]++; }
    const lastEnd = mine.reduce<string | null>((m, a) => (!m || a.end > m ? a.end : m), null);
    return { person, byYear, rotations: mine.length, lastEnd };
  }).sort((a, b) => a.person.name.localeCompare(b.person.name));
}

export interface MorningSuggestion { employeeId: string; start: string; end: string; warnings: string[] }

/**
 * A proposal for the first part of a gap (at most 2 months): the eligible Controller with no blocking clash, fewest
 * Morning days that year, then fewest warnings (leave, own crew losing them), VR before crew Controllers.
 */
export function suggestForGap(gap: { start: string; end: string }, people: MpPerson[], absences: MpAbsence[], assignments: MpAssignment[], turns: MorningTurn[]): MorningSuggestion | null {
  const limit = maxEndDate(gap.start);
  const end = gap.end < limit ? gap.end : limit;
  const year = Number(gap.start.slice(0, 4));
  const days = new Map(turns.map((t) => [t.person.id, t.byYear[year] ?? 0]));
  const ok = checkCandidates('morning_rotation', null, gap.start, end, people, absences, assignments).filter((c) => c.blocked.length === 0);
  if (!ok.length) return null;
  const best = [...ok].sort((a, b) => (days.get(a.person.id) ?? 0) - (days.get(b.person.id) ?? 0) || a.warnings.length - b.warnings.length)[0];
  return { employeeId: best.person.id, start: gap.start, end, warnings: best.warnings };
}

export interface ProposedRotation { start: string; end: string; workdays: number; suggestion: MorningSuggestion | null }

/**
 * Fills the empty periods with proposed rotations: each gap is cut into turns of at most 2 months, and each turn is
 * offered (suggestForGap) as if the earlier proposals were already assigned, so the turns go round the Controllers.
 */
export function proposeRotations(gaps: { start: string; end: string }[], people: MpPerson[], absences: MpAbsence[], assignments: MpAssignment[], turns: MorningTurn[]): ProposedRotation[] {
  const planned = [...assignments];
  const tally = turns.map((t) => ({ ...t, byYear: { ...t.byYear } }));
  const out: ProposedRotation[] = [];
  for (const gap of gaps) {
    for (let start = gap.start; start <= gap.end;) {
      const limit = maxEndDate(start);
      const end = gap.end < limit ? gap.end : limit;
      let workdays = 0;
      for (let d = start; d <= end; d = addDaysIso(d, 1)) if (isDayDutyWorkday(d)) workdays++;
      if (workdays > 0) {
        const suggestion = suggestForGap({ start, end }, people, absences, planned, tally);
        out.push({ start, end, workdays, suggestion });
        if (suggestion) {
          planned.push({ id: `proposed-${start}`, kind: 'morning_rotation', employeeId: suggestion.employeeId, crew: null, start, end });
          const t = tally.find((x) => x.person.id === suggestion.employeeId);
          if (t) for (let d = start; d <= end; d = addDaysIso(d, 1)) { const y = Number(d.slice(0, 4)); if (y in t.byYear && isDayDutyWorkday(d)) t.byYear[y]++; }
        }
      }
      start = addDaysIso(end, 1);
    }
  }
  return out;
}
