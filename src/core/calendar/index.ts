// Manpower Calendar and Annual Leave Plan (Stage E): month grids, per-crew day status and year strips.
// Pure functions over the manpower engine's results; no I/O.
import type { DayResult } from '../manpower';
import { addDaysIso, type Crew } from '../roster';

/** A crew's result on one day, as the calendar shows it. 'pending' = not final (coverage required / data incomplete). */
export type DayMark = 'green' | 'amber' | 'red' | 'pending' | 'off';

export interface CrewMark { crew: Crew; shift: 'M' | 'A' | 'N' | 'Off'; mark: DayMark }

/** Kuwait working week: the calendar starts on Sunday. */
export const WEEK_START = 0;
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');
export const monthStart = (year: number, month: number) => `${year}-${pad(month)}-01`;
export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const monthEnd = (year: number, month: number) => `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
const weekday = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay();

/** Weeks of a month (Sunday first); days outside the month are null. */
export function monthWeeks(year: number, month: number): (string | null)[][] {
  const first = monthStart(year, month);
  const lead = (weekday(first) - WEEK_START + 7) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = first; d <= monthEnd(year, month); d = addDaysIso(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Month before / after, as [year, month]. */
export function shiftMonth(year: number, month: number, by: number): [number, number] {
  const i = year * 12 + (month - 1) + by;
  return [Math.floor(i / 12), (i % 12) + 1];
}

const SHIFT_ORDER = { M: 0, A: 1, N: 2, Off: 3 } as const;

/**
 * Per-crew marks for one day, Morning → Afternoon → Night → Off. The same rule as the Day Overview:
 * a confirmed shortage is red; anything still pending (Controller coverage required, qualification data
 * incomplete) is grey; otherwise the final Green / Amber.
 */
export function crewMarks(day: DayResult): CrewMark[] {
  return day.crews
    .map((c) => ({ crew: c.crew, shift: c.state, mark: (!c.working ? 'off' : c.confirmedShortage ? 'red' : c.finalStatus ?? 'pending') as DayMark }))
    .sort((a, b) => SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift]);
}

/** The whole day's mark: the worst working crew (red > pending > amber > green). */
export function dayMark(day: DayResult): Exclude<DayMark, 'off'> {
  const marks = crewMarks(day).map((m) => m.mark);
  return marks.includes('red') ? 'red' : marks.includes('pending') ? 'pending' : marks.includes('amber') ? 'amber' : 'green';
}

export interface MonthSummary { days: number; red: number; pending: number; amber: number; green: number; redCrewDuties: number; pendingCrewDuties: number }

/** Counts for a month header: days by worst mark, plus crew duties that are short or pending. */
export function summarizeMonth(days: DayResult[], crew: Crew | null = null): MonthSummary {
  const s: MonthSummary = { days: 0, red: 0, pending: 0, amber: 0, green: 0, redCrewDuties: 0, pendingCrewDuties: 0 };
  for (const d of days) {
    const marks = crewMarks(d).filter((m) => m.mark !== 'off' && (!crew || m.crew === crew));
    if (!marks.length) continue;
    s.days++;
    const worst = marks.some((m) => m.mark === 'red') ? 'red' : marks.some((m) => m.mark === 'pending') ? 'pending' : marks.some((m) => m.mark === 'amber') ? 'amber' : 'green';
    s[worst]++;
    s.redCrewDuties += marks.filter((m) => m.mark === 'red').length;
    s.pendingCrewDuties += marks.filter((m) => m.mark === 'pending').length;
  }
  return s;
}

// ------------------------------------------------------------------ Annual Leave Plan

/** Day of the year, 0-based (1 Jan = 0). */
export function dayOfYear(iso: string): number {
  const y = Number(iso.slice(0, 4));
  return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(y, 0, 1)) / 86_400_000);
}
export const daysInYear = (year: number) => (new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365);

/** A block clipped to the year, as fractions of the year's width (for the year strip). */
export function yearSegment(start: string, end: string, year: number): { left: number; width: number } | null {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  if (end < from || start > to) return null;
  const s = dayOfYear(start < from ? from : start), e = dayOfYear(end > to ? to : end);
  const n = daysInYear(year);
  return { left: s / n, width: (e - s + 1) / n };
}

/** Calendar days in [start, end] that fall inside `year`. */
export function daysInYearRange(start: string, end: string, year: number): number {
  const seg = yearSegment(start, end, year);
  return seg ? Math.round(seg.width * daysInYear(year)) : 0;
}

export interface CoverPeriod { employeeId: string; start: string; end: string }

/**
 * How a Controller's leave block is covered: the assignments for their crew overlapping it, and the
 * days of the block (on the crew's duty days, `isDuty`) that no cover reaches.
 */
export function coverOfBlock(start: string, end: string, covers: CoverPeriod[], isDuty: (date: string) => boolean): { covers: CoverPeriod[]; uncoveredDutyDays: number } {
  const hits = covers.filter((c) => c.start <= end && c.end >= start);
  let uncovered = 0;
  for (let d = start; d <= end; d = addDaysIso(d, 1)) if (isDuty(d) && !hits.some((c) => c.start <= d && d <= c.end)) uncovered++;
  return { covers: hits, uncoveredDutyDays: uncovered };
}

export interface AttentionPeriod { crew: Crew; kind: 'shortage' | 'coverage_required' | 'data_incomplete'; text: string; start: string; end: string; duties: number }

/**
 * Crew duties that need attention in a range, joined into periods: consecutive duty days of one crew with
 * the same finding (roster Off days in between do not break a period). Shortage first, then pending items.
 */
export function attentionPeriods(days: DayResult[]): AttentionPeriod[] {
  const out: AttentionPeriod[] = [];
  const open = new Map<Crew, AttentionPeriod>();
  for (const d of days) {
    for (const c of d.crews) {
      if (!c.working) continue;
      const positions = [c.controller, c.panel, c.field];
      const short = positions.filter((p) => p.finding === 'shortage');
      const item = short.length ? { kind: 'shortage' as const, text: short.map((p) => `${p.label} ${p.count} of ${p.min}`).join(', ') }
        : c.pending.includes('coverage_required') ? { kind: 'coverage_required' as const, text: 'Controller cover needed' }
        : c.pending.includes('data_incomplete') ? { kind: 'data_incomplete' as const, text: 'Grade data missing' } : null;
      const cur = open.get(c.crew);
      if (cur && item && cur.kind === item.kind && cur.text === item.text) { cur.end = d.date; cur.duties++; continue; }
      if (cur) { out.push(cur); open.delete(c.crew); }
      if (item) open.set(c.crew, { crew: c.crew, ...item, start: d.date, end: d.date, duties: 1 });
    }
  }
  out.push(...open.values());
  const rank = { shortage: 0, coverage_required: 1, data_incomplete: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.start.localeCompare(b.start) || a.crew.localeCompare(b.crew));
}
