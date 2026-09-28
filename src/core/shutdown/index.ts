// Shutdown teams (Stage K): who works which day of a shutdown, the hours, the overtime and whether each team has the
// people it needs. Pure functions; the members are taken off their crew for their dates (see the manpower engine).
import { addDaysIso, isWorkingDay, type Crew } from '../roster';

/** Slots a team needs, plus 'member' for someone without a level (records of past shutdowns, Panel Operators). */
export type SdSlot = 'controller' | 'senior' | 'good' | 'new' | 'member';
export type NeedSlot = Exclude<SdSlot, 'member'>;
export const SD_SLOTS: NeedSlot[] = ['controller', 'senior', 'good', 'new'];
export const SD_SLOT_LABEL: Record<SdSlot, string> = { controller: 'Controller', senior: 'Senior FO', good: 'Good FO', new: 'New FO', member: 'Operator' };
export type FoLevel = 'senior' | 'good' | 'new';
export const FO_LEVEL_LABEL: Record<FoLevel, string> = { senior: 'Senior', good: 'Good', new: 'New' };

export interface SdPlan {
  id: string; title: string; start: string; end: string; eventId: string | null;
  daysOn: number; daysOff: number; shiftHours: number;
  /** The first and the last `rampDays` days are reduced: fewer people needed, `rampHours` a shift. */
  rampDays: number; rampHours: number;
  /** Hours of a normal crew duty (overtime = shutdown hours − the normal hours the person would have worked). */
  normalHours: number; maxOvertime: number;
}
export interface SdTeam { id: string; planId: string; name: string; sort: number; needs: Record<NeedSlot, number>; rampNeeds: Record<NeedSlot, number>; shiftCode: 'M' | 'N'; hoursLabel: string | null }
export interface SdDay { works: boolean; hours: number | null }
export interface SdMember {
  id: string; planId: string; teamId: string; employeeId: string; slot: SdSlot; offset: number; start: string; end: string;
  /** The member's own days (date → works / hours), overriding the pattern. */
  days?: Record<string, SdDay>;
}

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
export const cycleOf = (p: SdPlan) => Math.max(1, p.daysOn + p.daysOff);
export const isRampDay = (p: SdPlan, date: string) => date >= p.start && date <= p.end && (days(p.start, date) < p.rampDays || days(date, p.end) < p.rampDays);
export const hoursOn = (p: SdPlan, date: string) => (isRampDay(p, date) ? p.rampHours : p.shiftHours);
export function planDates(p: SdPlan): string[] { const out: string[] = []; for (let d = p.start; d <= p.end; d = addDaysIso(d, 1)) out.push(d); return out; }

/** Does the member work on `date`? Days on / off repeat from the plan's first day, shifted by the member's offset. */
export function memberWorks(p: SdPlan, m: SdMember, date: string): boolean {
  if (date < m.start || date > m.end || date < p.start || date > p.end) return false;
  const own = m.days?.[date];
  if (own) return own.works;
  return ((days(p.start, date) + m.offset) % cycleOf(p)) < p.daysOn;
}
/** Hours the member works on `date` (0 when off): their own hours for the day, else the plan's for that day. */
export const memberHoursOn = (p: SdPlan, m: SdMember, date: string) => (memberWorks(p, m, date) ? m.days?.[date]?.hours ?? hoursOn(p, date) : 0);

/**
 * Overtime of one day, the way the overtime sheet counts it: hours worked on the shutdown, less the normal duty the
 * person would have worked that day (their crew's roster; day staff Sunday–Thursday). A 12-hour shift on a normal duty
 * day = 4 h; on a rest day = 12 h; a day off = 0.
 */
export function dayOvertime(p: SdPlan, m: SdMember, crew: Crew | null, date: string): number {
  const h = memberHoursOn(p, m, date);
  if (!h) return 0;
  const duty = crew ? isWorkingDay(date, crew) : new Date(`${date}T00:00:00Z`).getUTCDay() <= 4;
  return Math.max(0, h - (duty ? p.normalHours : 0));
}

export interface SlotDay { need: number; have: number }
/** People working per slot of one team on one date against what the team needs that day (reduced days use the reduced needs).
 *  Operators without a level ('member') fill the open Field Operator places. */
export function teamDay(p: SdPlan, t: SdTeam, members: SdMember[], date: string, away: (employeeId: string, date: string) => boolean = () => false): Record<NeedSlot, SlotDay> {
  const needs = isRampDay(p, date) ? t.rampNeeds : t.needs;
  const out = {} as Record<NeedSlot, SlotDay>;
  const on = (s: SdSlot) => members.filter((m) => m.teamId === t.id && m.slot === s && memberWorks(p, m, date) && !away(m.employeeId, date)).length;
  for (const s of SD_SLOTS) out[s] = { need: needs[s], have: on(s) };
  // Operators without a level fill whatever Field Operator places are still open (Senior first)
  let spare = on('member');
  for (const s of ['senior', 'good', 'new'] as const) { const n = Math.min(spare, Math.max(0, out[s].need - out[s].have)); out[s].have += n; spare -= n; }
  return out;
}
export const dayShort = (d: Record<NeedSlot, SlotDay>) => SD_SLOTS.reduce((n, s) => n + Math.max(0, d[s].need - d[s].have), 0);
/** A day is critical when a slot the team needs has nobody at all that day (e.g. no Controller); short = fewer than needed. */
export const dayCritical = (d: Record<NeedSlot, SlotDay>) => SD_SLOTS.some((s) => d[s].need > 0 && d[s].have === 0);
export type DayState = 'full' | 'short' | 'critical';
export const dayState = (d: Record<NeedSlot, SlotDay>): DayState => (dayCritical(d) ? 'critical' : dayShort(d) > 0 ? 'short' : 'full');

export interface MonthHours { month: string; days: number; sd: number; overtime: number; over: boolean }
/** Days worked, shutdown hours and overtime (day by day, see dayOvertime) per calendar month, against the monthly cap. */
export function memberHours(p: SdPlan, m: SdMember, crew: Crew | null): MonthHours[] {
  const by = new Map<string, MonthHours>();
  for (let d = m.start < p.start ? p.start : m.start; d <= m.end && d <= p.end; d = addDaysIso(d, 1)) {
    const k = d.slice(0, 7);
    const row = by.get(k) ?? { month: k, days: 0, sd: 0, overtime: 0, over: false };
    const h = memberHoursOn(p, m, d);
    if (h) { row.days++; row.sd += h; row.overtime += dayOvertime(p, m, crew, d); }
    by.set(k, row);
  }
  return [...by.values()].map((r) => ({ ...r, over: r.overtime > p.maxOvertime }));
}

/** The pattern offset for a new member of a slot: the least used one, so the days off of a slot are spread. */
export function nextOffset(p: SdPlan, teamId: string, slot: SdSlot, members: SdMember[]): number {
  const used = new Array(cycleOf(p)).fill(0);
  for (const m of members) if (m.teamId === teamId && m.slot === slot) used[m.offset % used.length]++;
  return used.indexOf(Math.min(...used));
}

/** The shutdown plans right before and right after `plan` (by dates): nobody should work two shutdowns in a row. */
export function neighbours(plans: SdPlan[], plan: SdPlan): { prev: SdPlan | null; next: SdPlan | null } {
  const others = plans.filter((p) => p.id !== plan.id);
  const prev = others.filter((p) => p.end < plan.start).sort((a, b) => b.end.localeCompare(a.end))[0] ?? null;
  const next = others.filter((p) => p.start > plan.end).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;
  return { prev, next };
}
