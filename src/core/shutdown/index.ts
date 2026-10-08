// Shutdown teams (Stage K): who works which day of a shutdown, the hours, the overtime and whether each team has the
// people it needs. Pure functions; the members are taken off their crew for their dates (see the manpower engine).
import { addDaysIso, isWorkingDay, type Crew } from '../roster';

/** Slots a team needs, plus 'member' for someone without a level (records of past shutdowns, Panel Operators). */
export type SdSlot = 'controller' | 'senior' | 'good' | 'new' | 'member';
export type NeedSlot = Exclude<SdSlot, 'member'>;
export const SD_SLOTS: NeedSlot[] = ['controller', 'senior', 'good', 'new'];
export const SD_SLOT_LABEL: Record<SdSlot, string> = { controller: 'Controller', senior: 'Senior FO', good: 'Good FO', new: 'New FO', member: 'Operator' };
/** The Section Head's grading for shutdown teams; 'below' = below average (ranks after everyone else when a team is picked). */
export type FoLevel = 'senior' | 'good' | 'new' | 'below';
/** Panel Operators of this grade and below (and contractor Panel Operators) can work on a shutdown team. */
export const SD_PO_MAX_GRADE = 13;
/** Can this person fill an operator place on a shutdown team? Field Operators; Panel Operators up to Grade 13 or contractors. */
export const sdOperatorEligible = (p: { role: string | null; grade: number | null; employmentType: string | null }) =>
  p.role === 'field_operator' || (p.role === 'panel_operator' && (p.employmentType === 'contractor' || (p.grade != null && p.grade <= SD_PO_MAX_GRADE)));
export const FO_LEVEL_LABEL: Record<FoLevel, string> = { senior: 'Senior', good: 'Good', new: 'New', below: 'Below' };

/** 'train': one train down, the crews keep running. 'total': the whole unit down (turnaround), everyone on the teams. */
export type SdKind = 'train' | 'total';
export interface SdPlan {
  id: string; title: string; start: string; end: string; eventId: string | null;
  kind: SdKind;
  /** Area groups of a total turnaround (e.g. TR-II, L.P & TR-I); each team needs operators per area. */
  areas: string[];
  /** Total turnaround: the sections a Controller handles (e.g. TR-I, TR-II, L.P); none = Controllers counted together. */
  sections: string[];
  daysOn: number; daysOff: number; shiftHours: number;
  /** The first and the last `rampDays` days are reduced: fewer people needed, `rampHours` a shift. */
  rampDays: number; rampHours: number;
  /** Hours of a normal crew duty (overtime = shutdown hours − the normal hours the person would have worked). */
  normalHours: number;
  /** Overtime cap per person per calendar month, and per calendar year (with the hours already taken that year). */
  maxOvertime: number; maxOvertimeYear?: number;
}
export interface SdTeam { id: string; planId: string; name: string; sort: number; needs: Record<NeedSlot, number>; rampNeeds: Record<NeedSlot, number>; shiftCode: 'M' | 'N'; hoursLabel: string | null }
export interface SdDay { works: boolean; hours: number | null }
export interface SdMember {
  id: string; planId: string; teamId: string; employeeId: string; slot: SdSlot; offset: number; start: string; end: string;
  /** Area group (total turnaround). */
  area?: string | null;
  /** Instruction: the crew whose rota the member follows on the team (its duty and rest days) instead of their own; null = their own. */
  followCrew?: Crew | null;
  /** Place on the section's own sheet (S.No), when recorded from one. */
  order?: number | null;
  /** The member's own days (date → works / hours), overriding the pattern. */
  days?: Record<string, SdDay>;
}

/** Total turnaround: people needed per team, from a first to a last day (Controllers, and operators per area). */
export interface PhaseNeed { controller: number; sections?: Record<string, number>; areas: Record<string, number> }
export interface SdPhase { id: string; start: string; end: string; needs: Record<string, PhaseNeed> }
export const phaseOn = (phases: SdPhase[], date: string) => phases.find((x) => x.start <= date && date <= x.end) ?? null;

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
  return Math.max(0, h - (isDutyDay(crew, date) ? p.normalHours : 0));
}
/** A normal duty day of the person: their crew's roster; day staff (no crew) Sunday to Thursday. */
export const isDutyDay = (crew: Crew | null, date: string) => (crew ? isWorkingDay(date, crew) : new Date(`${date}T00:00:00Z`).getUTCDay() <= 4);

export interface SlotDay { need: number; have: number }
/** Keys of a team day: the level slots (train shutdown), or 'controller' and 'area:<name>' (total turnaround). */
export type DaySlots = Record<string, SlotDay>;
export const slotLabel = (key: string) => (key.startsWith('area:') ? key.slice(5) || 'Operators' : key.startsWith('ctl:') ? `Controller ${key.slice(4)}` : SD_SLOT_LABEL[key as SdSlot] ?? key);
/** The group a member counts in: its own area / section, or the first one when it has none (or one no longer on the plan). */
export const groupOf = (names: string[], own: string | null | undefined) => (names.includes(own ?? '') ? own ?? '' : names[0] ?? '');
/** Areas of a total turnaround ('' = one group when the plan has none). */
export const areasOf = (p: SdPlan) => (p.areas.length ? p.areas : ['']);
/**
 * People working per slot of one team on one date against what the team needs that day.
 * Train shutdown: per level slot (reduced days use the reduced needs); operators without a level ('member') fill the
 * open Field Operator places. Total turnaround: Controllers and operators per area, as the phase of that date needs.
 */
export function teamDay(p: SdPlan, t: SdTeam, members: SdMember[], date: string, away: (employeeId: string, date: string) => boolean = () => false, phases: SdPhase[] = []): DaySlots {
  const on = (f: (m: SdMember) => boolean) => members.filter((m) => m.teamId === t.id && f(m) && memberWorks(p, m, date) && !away(m.employeeId, date)).length;
  const out: DaySlots = {};
  if (p.kind === 'total') {
    const n = phaseOn(phases, date)?.needs[t.id];
    const areas = areasOf(p);
    // Controllers per section when the plan has sections, else together; a member without one counts in the first
    if (p.sections.length) for (const s of p.sections) out[`ctl:${s}`] = { need: n?.sections?.[s] ?? 0, have: on((m) => m.slot === 'controller' && groupOf(p.sections, m.area) === s) };
    else out.controller = { need: n?.controller ?? 0, have: on((m) => m.slot === 'controller') };
    for (const a of areas) out[`area:${a}`] = { need: n?.areas[a] ?? 0, have: on((m) => m.slot !== 'controller' && groupOf(areas, m.area) === a) };
    return out;
  }
  const needs = isRampDay(p, date) ? t.rampNeeds : t.needs;
  for (const s of SD_SLOTS) out[s] = { need: needs[s], have: on((m) => m.slot === s) };
  // Operators without a level fill whatever Field Operator places are still open (Senior first)
  let spare = on((m) => m.slot === 'member');
  for (const s of ['senior', 'good', 'new'] as const) { const k = Math.min(spare, Math.max(0, out[s].need - out[s].have)); out[s].have += k; spare -= k; }
  return out;
}
export const dayShort = (d: DaySlots) => Object.values(d).reduce((n, x) => n + Math.max(0, x.need - x.have), 0);
/**
 * A day is critical when a slot the team needs has nobody at all that day (e.g. no Controller, Senior or Good FO);
 * short = fewer than needed. The New Field Operator slot may be empty: it only counts as short.
 */
export const dayCritical = (d: DaySlots) => Object.entries(d).some(([k, x]) => k !== 'new' && x.need > 0 && x.have === 0);
/** idle = nobody needed that day (a total turnaround outside its phases). */
export type DayState = 'full' | 'short' | 'critical' | 'idle';
export const dayState = (d: DaySlots): DayState => (Object.values(d).every((x) => x.need === 0) ? 'idle' : dayCritical(d) ? 'critical' : dayShort(d) > 0 ? 'short' : 'full');

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

/** A place of a team that is short on some days: the team cannot work with fewer people than it needs. */
export interface TeamGap { teamId: string; team: string; slot: string; label: string; dates: string[]; emptyDates: string[]; missing: number }
/**
 * Every place of every team short of its need on some day (`away`: people not there that day, e.g. leave already
 * approved). New FO counts too: the team works only complete. Sorted by the number of days short.
 */
export function teamGaps(p: SdPlan, teams: SdTeam[], members: SdMember[], phases: SdPhase[] = [], away: (employeeId: string, date: string) => boolean = () => false): TeamGap[] {
  const out: TeamGap[] = [];
  for (const t of teams) {
    const by = new Map<string, TeamGap>();
    for (const date of planDates(p)) {
      for (const [k, x] of Object.entries(teamDay(p, t, members, date, away, phases))) {
        if (x.need <= x.have) continue;
        const g = by.get(k) ?? { teamId: t.id, team: t.name, slot: k, label: slotLabel(k), dates: [], emptyDates: [], missing: 0 };
        g.dates.push(date); if (x.have === 0) g.emptyDates.push(date); g.missing += x.need - x.have;
        by.set(k, g);
      }
    }
    out.push(...by.values());
  }
  return out.sort((a, b) => b.dates.length - a.dates.length);
}

/** "1–4 Nov, 7 Nov, 9–12 Nov": dates grouped into runs. */
export function dateRuns(dates: string[]): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const f = (d: string) => `${Number(d.slice(8))} ${M[Number(d.slice(5, 7)) - 1]}`;
  const sorted = [...new Set(dates)].sort(); const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i; while (j + 1 < sorted.length && addDaysIso(sorted[j], 1) === sorted[j + 1]) j++;
    runs.push(i === j ? f(sorted[i]) : sorted[i].slice(5, 7) === sorted[j].slice(5, 7) ? `${Number(sorted[i].slice(8))}–${f(sorted[j])}` : `${f(sorted[i])} – ${f(sorted[j])}`);
    i = j;
  }
  return runs.join(', ');
}
