// Task release: the Section Head releases one employee from the crew's duty for a time (a task elsewhere). Before it is
// recorded, this shows what it does to the crew on each day: the crew's counts against its minimums, whether a buffer is
// kept (green), the crew is left at the minimum (amber, no buffer) or short (red), and whether the Controller needs a cover.
// A release counts as the person being away for the whole shift of the day, whatever the hours (the careful reading).
import { evaluateDay, personOn, type CrewDay, type MpAbsence, type MpAssignment, type MpPerson, type RulesSource, type Status } from '../manpower';
import { addDaysIso, type Crew } from '../roster';

export const RELEASE_TYPE = 'task_release';
export interface ReleasePosition { key: 'controller' | 'panel' | 'field'; label: string; before: number; after: number; min: number }
export type ReleaseVerdict = 'safe' | 'no_buffer' | 'unclear' | 'cover' | 'shortage';
export interface ReleaseDay {
  date: string;
  /** duty: a duty day of his crew, counted there. rest: his crew is off (or day duty's weekend): nothing changes.
   *  absent: already away that day (leave, or another release). outside: not counted in a crew that day (e.g. a VR without a placement). */
  kind: 'duty' | 'rest' | 'absent' | 'outside';
  crew: Crew | null; shift: string | null;
  before: Status | null; after: Status | null;
  verdict: ReleaseVerdict | null;
  positions: ReleasePosition[];
  /** Why, in the engine's words (the position the person is in, after the release). */
  issues: string[];
  /** Who is the buffer of his position after the release, when there is one. */
  backup: string | null;
  /** Open before the release, not caused by it (a position short or needing cover that the release does not touch). */
  already: string[];
}
export interface ReleaseCheck { days: ReleaseDay[]; verdict: ReleaseVerdict | null; counts: Record<ReleaseVerdict, number> }

const RANK: Record<ReleaseVerdict, number> = { safe: 0, no_buffer: 1, unclear: 2, cover: 3, shortage: 4 };
const OPEN = ['shortage', 'coverage_required', 'data_incomplete'];
const verdictOf = (finding: string): ReleaseVerdict => (finding === 'shortage' ? 'shortage' : finding === 'coverage_required' ? 'cover' : finding === 'data_incomplete' ? 'unclear' : finding === 'no_buffer' ? 'no_buffer' : 'safe');

/** The crew of that day the person is counted in (engine result before the release), or null. */
function crewOf(day: ReturnType<typeof evaluateDay>, id: string): CrewDay | null {
  return day.crews.find((c) => [c.controller, c.panel, c.field].some((p) => p.counted.some((x) => x.id === id) || p.notCounted.some((x) => x.person.id === id)) || c.absences.some((a) => a.person.id === id)) ?? null;
}

export function checkRelease(person: MpPerson, start: string, end: string, people: MpPerson[], absences: MpAbsence[], rules: RulesSource, assignments: MpAssignment[]): ReleaseCheck {
  const extra: MpAbsence = { id: 'release-check', employeeId: person.id, start, end, status: 'approved', typeCode: RELEASE_TYPE, typeLabel: 'Task release', typeShort: 'TASK', inCurrentPlan: true };
  const days: ReleaseDay[] = [];
  for (let d = start; d <= end; d = addDaysIso(d, 1)) {
    const before = evaluateDay(d, people, absences, rules, assignments);
    const after = evaluateDay(d, people, [...absences, extra], rules, assignments);
    const c0 = crewOf(before, person.id);
    const base = { date: d, crew: null as Crew | null, shift: null as string | null, before: null as Status | null, after: null as Status | null, verdict: null as ReleaseVerdict | null, positions: [] as ReleasePosition[], issues: [] as string[], backup: null as string | null, already: [] as string[] };
    if (!c0) {
      // not counted in a crew today: his crew is off, or he is not in one
      const q = personOn(person, d);
      days.push({ ...base, kind: q.crew && !q.dayDuty ? 'rest' : 'outside', crew: q.crew ?? null });
      continue;
    }
    if (!c0.working) { days.push({ ...base, kind: 'rest', crew: c0.crew, shift: c0.shift }); continue; }
    if (c0.absences.some((a) => a.person.id === person.id)) { days.push({ ...base, kind: 'absent', crew: c0.crew, shift: c0.shift }); continue; }
    const c1 = after.crews.find((c) => c.crew === c0.crew)!;
    const positions: ReleasePosition[] = (['controller', 'panel', 'field'] as const).map((k) => ({ key: k, label: c1[k].label, before: c0[k].count, after: c1[k].count, min: c1[k].min }));
    // the position he is in tells the story: the ones whose count changed decide the verdict
    const changed = positions.filter((p) => p.after !== p.before).map((p) => p.key);
    const verdict = changed.reduce<ReleaseVerdict>((w, k) => (RANK[verdictOf(c1[k].finding)] > RANK[w] ? verdictOf(c1[k].finding) : w), 'safe');
    // what was already open before the release, in the positions it does not touch
    const already = (['controller', 'panel', 'field'] as const).filter((k) => !changed.includes(k) && OPEN.includes(c0[k].finding)).flatMap((k) => c0[k].issues);
    const issues = [...new Set((changed.length ? changed : (['controller', 'panel', 'field'] as const)).flatMap((k) => c1[k].issues))];
    const backup = (changed[0] ? c1[changed[0]].backup?.name : null) ?? null;
    days.push({ ...base, kind: 'duty', crew: c0.crew, shift: c0.shift, before: c0.finalStatus, after: c1.finalStatus, verdict, positions, issues, backup, already: [...new Set(already)] });
  }
  const counts: Record<ReleaseVerdict, number> = { safe: 0, no_buffer: 0, unclear: 0, cover: 0, shortage: 0 };
  for (const x of days) if (x.verdict) counts[x.verdict]++;
  const duty = days.filter((x) => x.verdict);
  const verdict = duty.length ? duty.reduce<ReleaseVerdict>((w, x) => (RANK[x.verdict!] > RANK[w] ? x.verdict! : w), 'safe') : null;
  return { days, verdict, counts };
}
