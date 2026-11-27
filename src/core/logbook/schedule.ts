// Sample schedule (owner, 27 Nov 2026: "if the result is overdue the schedule, it should show them in a different colour,
// so I can know the sample was not updated or it's old"). The schedule rows (which test, at which point, daily on the
// morning shift or weekly on Sunday morning) live in the database only. Pure: for a moment in time it works out when each
// test was last due and whether a result has come in since.
//   daily       due every day at 07:00 (Kuwait); counted late 12 h after that (results normally come the same day)
//   weekly_sun  due on Sunday at 07:00; counted late 36 h after (weekly lab tests take longer)
// A result collected any time on the due day or later counts. Request-only and unscheduled tests are not tracked.
import { kuwaitParts, type StoredSample } from './view';

export type Frequency = 'daily' | 'weekly_sun';
export interface ScheduleItem { id: number; point: string; material: string; equipment: string | null; test: string; components: string[]; frequency: Frequency }
export interface DueState { item: ScheduleItem; due: string; last: string | null; value: string | null; overdue: boolean }

const H = 3600_000, KW = 3 * H, SAMPLE_HOUR = 7;
const GRACE: Record<Frequency, number> = { daily: 12 * H, weekly_sun: 36 * H };

/** The last due time (UTC ISO) that is already past its grace at `asOf`. */
export function lastDue(freq: Frequency, asOf: Date): Date {
  const k = new Date(asOf.getTime() + KW);                                   // Kuwait wall clock in UTC fields
  let due = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), SAMPLE_HOUR) - KW;
  const step = freq === 'daily' ? 24 * H : 7 * 24 * H;
  if (freq === 'weekly_sun') due -= k.getUTCDay() * 24 * H;                  // back to Sunday
  while (due + GRACE[freq] > asOf.getTime()) due -= step;
  return new Date(due);
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();
/** Every scheduled test's state at `asOf`, from the lab samples collected up to then. */
export function scheduleStatus(lab: StoredSample[], items: ScheduleItem[], asOf: Date): DueState[] {
  const upTo = asOf.toISOString();
  return items.map((item) => {
    const due = lastDue(item.frequency, asOf);
    const dayStart = new Date(due.getTime() - SAMPLE_HOUR * H);              // 00:00 Kuwait on the due day
    const comps = item.components.map(norm);
    let last: string | null = null, value: string | null = null;
    for (const s of lab) {
      if (!s.collectedAt || s.collectedAt > upTo || norm(s.material) !== norm(item.material) || (item.equipment && norm(s.equipment) !== norm(item.equipment))) continue;
      const r = s.results.find((x) => comps.includes(norm(x.component)));
      if (r && (!last || Date.parse(s.collectedAt) > Date.parse(last))) { last = s.collectedAt; value = r.value; }
    }
    return { item, due: due.toISOString(), last, value, overdue: !last || Date.parse(last) < dayStart.getTime() };
  });
}

/** The state of the test a lab result belongs to (by material, point and the lab's test name), if it is scheduled. */
export function dueFor(states: DueState[], material: string | null, equipment: string | null, component: string): DueState | undefined {
  return states.find((d) => norm(d.item.material) === norm(material) && (!d.item.equipment || norm(d.item.equipment) === norm(equipment)) && d.item.components.map(norm).includes(norm(component)));
}

/** "25 Nov" or "never in 30 days". */
export function lastLabel(d: DueState): string {
  const k = kuwaitParts(d.last);
  return k ? new Date(`${k.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'none in 30 days';
}

/** Overdue tests grouped by sample point: [{ point, tests, last }] — for the Lab tab and the alert. */
export function overdueByPoint(states: DueState[]): { point: string; tests: string[]; last: string }[] {
  const m = new Map<string, DueState[]>();
  for (const d of states) if (d.overdue) m.set(d.item.point, [...(m.get(d.item.point) ?? []), d]);
  return [...m.entries()].map(([point, ds]) => {
    const newest = ds.map((d) => d.last).filter((x): x is string => !!x).sort().pop() ?? null;
    return { point, tests: ds.map((d) => d.item.test), last: newest ? lastLabel({ ...ds[0], last: newest }) : 'none in 30 days' };
  });
}
