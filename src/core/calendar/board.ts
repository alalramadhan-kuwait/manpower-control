// Calendar board: pieces for the monthly view that are not manpower rules themselves.
// - event bars across a week (continuous where dates run on; stacked in lanes when they overlap)
// - how many people a crew is short on a duty ("B −1")
// - leave reasons grouped the way the Section Head reads them
import type { CrewDay } from '../manpower';

export interface Span { id: string; start: string; end: string }
export interface WeekBar<T extends Span> { item: T; col: number; span: number; lane: number; startsHere: boolean; endsHere: boolean }

/**
 * Bars for one calendar week. `week` is the 7 dates of the row (null outside the month is allowed and still counts
 * as a column). Items overlapping the week get the lowest free lane; longer items first so they stay on top.
 */
export function weekBars<T extends Span>(week: (string | null)[], items: T[], weekDates: string[]): WeekBar<T>[] {
  const first = weekDates[0], last = weekDates[6];
  const hits = items.filter((i) => i.start <= last && i.end >= first)
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.id.localeCompare(b.id));
  const lanes: number[][] = [];                         // per lane: occupied columns
  const out: WeekBar<T>[] = [];
  void week;
  for (const item of hits) {
    const s = weekDates.findIndex((d) => d >= item.start);
    let e = -1; for (let k = 6; k >= 0; k--) if (weekDates[k] <= item.end) { e = k; break; }
    if (s < 0 || e < s) continue;
    let lane = 0;
    while (lanes[lane]?.some((c) => c >= s && c <= e)) lane++;
    (lanes[lane] ??= []).push(...Array.from({ length: e - s + 1 }, (_, k) => s + k));
    out.push({ item, col: s, span: e - s + 1, lane, startsHere: item.start >= first, endsHere: item.end <= last });
  }
  return out;
}

/** The 7 dates of a calendar row, filling the blanks before / after the month with the real dates. */
export function fillWeek(week: (string | null)[]): string[] {
  const i = week.findIndex((d) => d !== null);
  const anchor = new Date(`${week[i]}T00:00:00Z`);
  return week.map((_, k) => { const d = new Date(anchor); d.setUTCDate(d.getUTCDate() + (k - i)); return d.toISOString().slice(0, 10); });
}

/** People short on this duty: sum of (minimum − counted) over the positions below minimum; 0 when not short. */
export function shortfall(c: CrewDay): number {
  if (!c.working) return 0;
  return [c.controller, c.panel, c.field].reduce((n, p) => n + (p.finding === 'shortage' ? Math.max(0, p.min - p.count) : 0), 0);
}

export type LeaveGroup = 'Annual leave' | 'Sick leave' | 'Short leave' | 'Personal Compassion Leave' | 'Injury / surgery' | 'Other approved absence';
export const LEAVE_GROUPS: LeaveGroup[] = ['Annual leave', 'Sick leave', 'Short leave', 'Personal Compassion Leave', 'Injury / surgery', 'Other approved absence'];
/** Leave type code → the reason group shown on the calendar. */
export function leaveGroup(typeCode: string | null | undefined): LeaveGroup {
  const c = typeCode ?? '';
  if (c.startsWith('annual_leave') || c === 'leave_extension') return 'Annual leave';
  if (c === 'sick_leave' || c === 'long_sick') return 'Sick leave';
  if (c === 'short_leave') return 'Short leave';
  if (c === 'personal_qb') return 'Personal Compassion Leave';
  if (c === 'medical_absence') return 'Injury / surgery';
  return 'Other approved absence';
}
