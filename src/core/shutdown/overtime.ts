// Shutdown overtime, one engine for the planner, the plan check, the server approval, the sheets and the Excel file
// (rules v2). Pure functions.
//
// Regular hours are owed per duty cycle, not per day:
//   - a crew member: the crew's 8-day rota cycle (Morning, Morning, Afternoon, Afternoon, Night, Night, Off, Off), 6 duty
//     days × 8 h = 48 regular hours; the cycle starts on the crew's first Morning day (M1);
//   - day staff (no crew): the week Sunday–Saturday, Sunday–Thursday × 8 h = 40 regular hours.
// Overtime of a cycle = hours actually worked − the regular hours still owed in it, never below zero. Working a crew rest
// day is therefore not overtime by itself: it is set against the duty day the person had off in the same cycle.
//
// Only the person's days on the shutdown team count (their window): a cycle cut by the start or the end of the
// shutdown owes the regular hours of its duty days inside the window (a partial cycle); the days outside are their crew's
// normal duties, with no overtime. Approved leave on a duty day is credited (the regular hours of that day are not owed).
// Fewer hours than owed in a cycle: no overtime, and the hours short are reported.
//
// Month of the overtime: the hours worked in a cycle first fill the regular hours owed, in time order; the hours after
// that are the overtime, counted in the calendar month (Kuwait time) in which they were worked. A cycle that crosses
// month-end therefore gives each month exactly the overtime worked in it, nothing counted twice or lost; a night duty
// across midnight is split by the hours on each side.
import { addDaysIso, dutyFor, type Crew } from '../roster';
import { isDutyDay } from './index';

const H = 3600_000;
const KW = 3 * H;   // Kuwait, UTC+3, no daylight saving
const ym = (ms: number) => new Date(ms + KW).toISOString().slice(0, 7);
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Kuwait midnight starting the month after the one containing `ms`. */
const nextMonthStart = (ms: number) => { const d = new Date(ms + KW); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - KW; };

/** One duty actually planned: its date (the day it starts), start (UTC ms) and hours. */
export interface WorkedDuty { date: string; start: number; hours: number }

/** What a duty is measured against on each date of the window. */
export interface OtBasis {
  /** First and last day the person is on the shutdown team (only these days count). */
  from: string; to: string;
  /** The rota the person keeps on a date (a crew, or null for day staff). */
  crewOn: (date: string) => Crew | null;
  /** Approved leave on a date (credited when it is a duty day). */
  leaveOn?: (date: string) => boolean;
  /** Hours of a normal duty (8). */
  normalHours: number;
}

/** One duty cycle (or week) inside the window. */
export interface OtCycle {
  key: string; crew: Crew | null; from: string; to: string;
  /** All its days are inside the window on this rota (else a partial cycle: the start or end of the shutdown, a crew change). */
  complete: boolean;
  /** Days of the cycle inside the window. */
  days: number;
  /** Duty days of the rota inside the window, and of those the days on approved leave. */
  dutyDays: number; leaveDays: number;
  /** Regular hours of the duty days (dutyDays × normal), credited for leave, still owed (regular − credited). */
  regular: number; credited: number; owed: number;
  worked: number; overtime: number; short: number;
}

/** One duty with how much of it is regular and how much overtime, and the months the overtime falls in. */
export interface DutySplit { date: string; hours: number; regular: number; ot: number; parts: { month: string; hours: number }[]; split: boolean; cycle: string }

export interface OtResult { cycles: OtCycle[]; duties: DutySplit[]; months: Record<string, number>; total: number }

/** The first day (M1) of the 8-day rota cycle a crew is in on `date`. */
export function cycleStart(crew: Crew, date: string): string {
  let d = date;
  for (let i = 0; i < 8; i++) { if (dutyFor(d, crew) === 'M1') return d; d = addDaysIso(d, -1); }
  return date;
}
/** The Sunday starting the week of `date` (day staff). */
export const weekStart = (date: string) => addDaysIso(date, -new Date(`${date}T00:00:00Z`).getUTCDay());

/** Splits the stretch [a, b) of a duty between calendar months (Kuwait time). */
function byMonth(a: number, b: number): { month: string; hours: number }[] {
  const out: { month: string; hours: number }[] = [];
  for (let s = a; s < b;) { const e = Math.min(b, nextMonthStart(s)); out.push({ month: ym(s), hours: r2((e - s) / H) }); s = e; }
  return out;
}

/** The overtime of one person's duties on a shutdown, cycle by cycle (see the head of this file). */
export function cycleOvertime(duties: WorkedDuty[], basis: OtBasis): OtResult {
  const keyOf = (d: string) => { const c = basis.crewOn(d); return c ? `${c}:${cycleStart(c, d)}` : `day:${weekStart(d)}`; };
  // the cycles touching the window, with their duty days and leave inside it
  const cycles = new Map<string, OtCycle>();
  for (let d = basis.from; d <= basis.to; d = addDaysIso(d, 1)) {
    const c = basis.crewOn(d); const k = keyOf(d);
    let x = cycles.get(k);
    if (!x) {
      const from = c ? cycleStart(c, d) : weekStart(d), to = addDaysIso(from, c ? 7 : 6);
      x = { key: k, crew: c, from, to, complete: false, days: 0, dutyDays: 0, leaveDays: 0, regular: 0, credited: 0, owed: 0, worked: 0, overtime: 0, short: 0 };
      cycles.set(k, x);
    }
    x.days++;
    if (isDutyDay(c, d)) { x.dutyDays++; if (basis.leaveOn?.(d)) x.leaveDays++; }
  }
  for (const x of cycles.values()) { x.complete = x.days === (x.crew ? 8 : 7); x.regular = x.dutyDays * basis.normalHours; x.credited = x.leaveDays * basis.normalHours; x.owed = x.regular - x.credited; }
  // duties in time order: each fills what is still owed in its cycle, the rest of it is overtime
  const left = new Map([...cycles.values()].map((x) => [x.key, x.owed]));
  const out: DutySplit[] = [];
  const months: Record<string, number> = {};
  for (const d of [...duties].filter((x) => x.hours > 0 && x.date >= basis.from && x.date <= basis.to).sort((a, b) => a.start - b.start)) {
    const k = keyOf(d.date); const x = cycles.get(k)!;
    const regular = Math.min(left.get(k)!, d.hours); left.set(k, left.get(k)! - regular);
    const ot = r2(d.hours - regular);
    x.worked += d.hours;
    const parts = ot > 0 ? byMonth(d.start + regular * H, d.start + d.hours * H) : [{ month: d.date.slice(0, 7), hours: 0 }];
    for (const p of parts) months[p.month] = r2((months[p.month] ?? 0) + p.hours);
    out.push({ date: d.date, hours: d.hours, regular: r2(regular), ot, parts, split: parts.length > 1, cycle: k });
  }
  for (const x of cycles.values()) { x.worked = r2(x.worked); x.overtime = r2(Math.max(0, x.worked - x.owed)); x.short = r2(Math.max(0, x.owed - x.worked)); }
  return { cycles: [...cycles.values()].sort((a, b) => a.from.localeCompare(b.from)), duties: out, months, total: r2(out.reduce((t, d) => t + d.ot, 0)) };
}
