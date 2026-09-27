// Shutdown teams (Stage K): who works which day of a shutdown, the hours, the overtime and whether each team has the
// people it needs. Pure functions; the members are taken off their crew for their dates (see the manpower engine).
import { addDaysIso, isWorkingDay, type Crew } from '../roster';

export type SdSlot = 'controller' | 'senior' | 'good' | 'new';
export const SD_SLOTS: SdSlot[] = ['controller', 'senior', 'good', 'new'];
export const SD_SLOT_LABEL: Record<SdSlot, string> = { controller: 'Controller', senior: 'Senior FO', good: 'Good FO', new: 'New FO' };
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
export interface SdTeam { id: string; planId: string; name: string; sort: number; needs: Record<SdSlot, number>; rampNeeds: Record<SdSlot, number> }
export interface SdMember { id: string; planId: string; teamId: string; employeeId: string; slot: SdSlot; offset: number; start: string; end: string }

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
export const cycleOf = (p: SdPlan) => Math.max(1, p.daysOn + p.daysOff);
export const isRampDay = (p: SdPlan, date: string) => date >= p.start && date <= p.end && (days(p.start, date) < p.rampDays || days(date, p.end) < p.rampDays);
export const hoursOn = (p: SdPlan, date: string) => (isRampDay(p, date) ? p.rampHours : p.shiftHours);
export function planDates(p: SdPlan): string[] { const out: string[] = []; for (let d = p.start; d <= p.end; d = addDaysIso(d, 1)) out.push(d); return out; }

/** Does the member work on `date`? Days on / off repeat from the plan's first day, shifted by the member's offset. */
export function memberWorks(p: SdPlan, m: SdMember, date: string): boolean {
  if (date < m.start || date > m.end || date < p.start || date > p.end) return false;
  return ((days(p.start, date) + m.offset) % cycleOf(p)) < p.daysOn;
}

export interface SlotDay { need: number; have: number }
/** People working per slot of one team on one date against what the team needs that day (reduced days use the reduced needs). */
export function teamDay(p: SdPlan, t: SdTeam, members: SdMember[], date: string, away: (employeeId: string, date: string) => boolean = () => false): Record<SdSlot, SlotDay> {
  const needs = isRampDay(p, date) ? t.rampNeeds : t.needs;
  const out = {} as Record<SdSlot, SlotDay>;
  for (const s of SD_SLOTS) out[s] = { need: needs[s], have: members.filter((m) => m.teamId === t.id && m.slot === s && memberWorks(p, m, date) && !away(m.employeeId, date)).length };
  return out;
}
export const dayShort = (d: Record<SdSlot, SlotDay>) => SD_SLOTS.reduce((n, s) => n + Math.max(0, d[s].need - d[s].have), 0);
/** A day is critical when a slot the team needs has nobody at all that day (e.g. no Controller); short = fewer than needed. */
export const dayCritical = (d: Record<SdSlot, SlotDay>) => SD_SLOTS.some((s) => d[s].need > 0 && d[s].have === 0);
export type DayState = 'full' | 'short' | 'critical';
export const dayState = (d: Record<SdSlot, SlotDay>): DayState => (dayCritical(d) ? 'critical' : dayShort(d) > 0 ? 'short' : 'full');

export interface MonthHours { month: string; sd: number; normal: number; overtime: number; over: boolean }
/**
 * Hours per calendar month for one member: shutdown hours on the days worked, the normal hours of the duties the person
 * would have worked on the same dates (`crew` = their crew's roster; null = day staff, Sunday–Thursday), overtime = the difference.
 */
export function memberHours(p: SdPlan, m: SdMember, crew: Crew | null): MonthHours[] {
  const by = new Map<string, MonthHours>();
  for (let d = m.start < p.start ? p.start : m.start; d <= m.end && d <= p.end; d = addDaysIso(d, 1)) {
    const k = d.slice(0, 7);
    const row = by.get(k) ?? { month: k, sd: 0, normal: 0, overtime: 0, over: false };
    if (memberWorks(p, m, d)) row.sd += hoursOn(p, d);
    if (crew ? isWorkingDay(d, crew) : new Date(`${d}T00:00:00Z`).getUTCDay() <= 4) row.normal += p.normalHours;
    by.set(k, row);
  }
  return [...by.values()].map((r) => { const overtime = Math.max(0, r.sd - r.normal); return { ...r, overtime, over: overtime > p.maxOvertime }; });
}

/** The pattern offset for a new member of a slot: the least used one, so the days off of a slot are spread. */
export function nextOffset(p: SdPlan, teamId: string, slot: SdSlot, members: SdMember[]): number {
  const used = new Array(cycleOf(p)).fill(0);
  for (const m of members) if (m.teamId === teamId && m.slot === slot) used[m.offset % used.length]++;
  return used.indexOf(Math.min(...used));
}
