// The Requests work list: leave running today or starting within the next days, one row per leave (back-to-back
// records joined), with what the Oracle request should say and what to watch before approving it.
import { joinPeriods, type ControllerLeaveCheck } from '../controllers/leaveRules';
import { personOn, type DayResult, type MpAbsence, type MpPerson, type Role } from '../manpower';
import { addDaysIso, type Crew } from '../roster';
import { expectedRequest, type ExpectedRequest } from './expected';
import type { OracleStatus } from '.';

export interface WorkRow {
  key: string;
  person: MpPerson;
  /** Leave records of this leave, in date order (the first one keys approvals). */
  records: MpAbsence[];
  start: string; end: string; codes: string[];
  oracle: OracleStatus;
  /** Crew the person works with at the (remaining) leave: crew letter, 'DAY' for day duty / day staff. */
  crew: Crew | 'DAY';
  role: Role | null;
  expected: ExpectedRequest | null;
  /** Running today. */
  now: boolean;
  /** Duty days of the leave (from today) on which the person's crew is confirmed short. */
  shortDuties: number;
  /** Controllers also on leave at the same time, without the Section Head's approval. */
  clashWith: string[];
  /** The n-th annual leave of the year when over the limit and not approved, else null. */
  extraNth: number | null;
  /** The person is on a shutdown team during this leave. */
  sdTeam: boolean;
}

const RANK: Record<OracleStatus, number> = { rejected: 0, not_submitted: 1, submitted: 2, approved: 3 };
const worst = (xs: OracleStatus[]): OracleStatus => xs.reduce((w, s) => (RANK[s] < RANK[w] ? s : w), 'approved' as OracleStatus);

export function buildWorklist(i: { today: string; days: number; people: MpPerson[]; absences: MpAbsence[]; results: DayResult[]; check: ControllerLeaveCheck | null; sd?: { employeeId: string; start: string; end: string }[] }): WorkRow[] {
  const horizon = addDaysIso(i.today, i.days);
  const people = new Map(i.people.map((p) => [p.id, p]));
  const counted = i.absences.filter((a) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && a.id && people.has(a.employeeId));
  const byId = new Map(counted.map((a) => [a.id!, a]));
  const byDate = new Map(i.results.map((d) => [d.date, d]));
  const name = (id: string) => people.get(id)?.name ?? '';
  const rows: WorkRow[] = [];
  for (const p of joinPeriods(counted)) {
    if (p.end < i.today || p.start > horizon) continue;
    const person = people.get(p.employeeId)!;
    const records = p.ids.map((id) => byId.get(id)!);
    const ids = new Set(p.ids);
    const crewOn = (d: string) => { const q = personOn(person, d); return q.dayDuty ? null : q.crew; };
    const from = p.start < i.today ? i.today : p.start;
    const at = personOn(person, from);
    let short = 0;
    for (let d = from; d <= p.end; d = addDaysIso(d, 1)) {
      const q = personOn(person, d);
      const c = q.crew && !q.dayDuty ? byDate.get(d)?.crews.find((x) => x.crew === q.crew) : undefined;
      if (c?.working && c.confirmedShortage) short++;
    }
    const clashWith = (i.check?.overlaps ?? []).filter((o) => !o.approval && o.end >= i.today && (o.a.ids.some((x) => ids.has(x)) || o.b.ids.some((x) => ids.has(x))))
      .map((o) => name(o.a.employeeId === p.employeeId ? o.b.employeeId : o.a.employeeId));
    const extra = (i.check?.people ?? []).flatMap((x) => x.years.flatMap((y) => y.extras)).find((x) => !x.approval && x.period.ids.some((id) => ids.has(id)));
    rows.push({
      key: p.ids[0], person, records, start: p.start, end: p.end, codes: p.codes,
      oracle: worst(records.map((r) => r.oracle ?? 'not_submitted')),
      crew: at.dayDuty || !at.crew ? 'DAY' : at.crew, role: person.role,
      expected: expectedRequest(p.start, p.end, crewOn), now: p.start <= i.today,
      shortDuties: short, clashWith: [...new Set(clashWith)], extraNth: extra ? extra.nth : null,
      sdTeam: (i.sd ?? []).some((m) => m.employeeId === p.employeeId && m.start <= p.end && m.end >= p.start)
    });
  }
  return rows.sort((a, b) => Number(b.now) - Number(a.now) || RANK[a.oracle] - RANK[b.oracle] || a.start.localeCompare(b.start) || a.person.name.localeCompare(b.person.name));
}
