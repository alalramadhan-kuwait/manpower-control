// Validation (Phase 1 step 3): what a person works day by day, with real duty times, and the checks a change must
// pass. One engine for the rota, temporary moves, day duty, Controller covers and shutdown 12-hour shifts.
// Severities (configurable per rule in validation_rules): info · warning · critical (the Section Head may accept it) ·
// hard_stop (never approved). The 7th duty day in a row and a rest of 0 hours or less are always hard stops.
import { DAY_DUTY, isDayDutyWorkday, personOn, type MpAbsence, type MpAssignment, type MpCrewMove, type MpPerson } from '@/core/manpower';
import { addDaysIso, dutyFor, stateOf, type Crew } from '@/core/roster';

export type Severity = 'info' | 'warning' | 'critical' | 'hard_stop';
export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2, hard_stop: 3 };
export const SEVERITY_LABEL: Record<Severity, string> = { info: 'Info', warning: 'Warning', critical: 'Critical', hard_stop: 'Hard stop' };

export type RuleCode = 'max_consecutive_duty_days' | 'rest_between_duties' | 'min_rest_hours' | 'leave_overlap' | 'assignment_overlap' | 'crew_minimum' | 'shift_times';
export interface RuleConfig { code: RuleCode; severity: Severity; enabled: boolean; params: Record<string, unknown> }

/** Duty start times (Asia/Kuwait, UTC+3, no daylight saving) and lengths. */
export interface ShiftTimes { M: string; A: string; N: string; hours: number; dayDutyStart: string; dayDutyHours: number }
export const DEFAULT_SHIFT_TIMES: ShiftTimes = { M: '07:00', A: '15:00', N: '23:00', hours: 8, dayDutyStart: '07:00', dayDutyHours: 8 };

/** The rules as stored in validation_rules (the database seeds the same values). */
export const DEFAULT_RULES: RuleConfig[] = [
  { code: 'max_consecutive_duty_days', severity: 'hard_stop', enabled: true, params: { max: 6 } },
  { code: 'rest_between_duties', severity: 'hard_stop', enabled: true, params: {} },
  { code: 'min_rest_hours', severity: 'warning', enabled: false, params: { hours: null } },
  { code: 'leave_overlap', severity: 'hard_stop', enabled: true, params: {} },
  { code: 'assignment_overlap', severity: 'hard_stop', enabled: true, params: {} },
  { code: 'crew_minimum', severity: 'critical', enabled: true, params: {} },
  { code: 'shift_times', severity: 'info', enabled: true, params: { ...DEFAULT_SHIFT_TIMES } }
];

export function ruleOf(rules: RuleConfig[], code: RuleCode): RuleConfig {
  return rules.find((r) => r.code === code) ?? DEFAULT_RULES.find((r) => r.code === code)!;
}
export function shiftTimesOf(rules: RuleConfig[]): ShiftTimes {
  return { ...DEFAULT_SHIFT_TIMES, ...(ruleOf(rules, 'shift_times').params as Partial<ShiftTimes>) };
}

const KUWAIT_OFFSET_H = 3;
/** Milliseconds (UTC) of `HH:MM` Kuwait time on `date`. */
export function kuwaitMs(date: string, hhmm: string): number {
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh - KUWAIT_OFFSET_H, mm);
}
const H = 3600_000;
const hhmmOf = (ms: number) => { const d = new Date(ms + KUWAIT_OFFSET_H * H); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const dayOf = (ms: number) => new Date(ms + KUWAIT_OFFSET_H * H).toISOString().slice(0, 10);

export type DutyCode = 'M' | 'A' | 'N' | 'D' | 'SD-D' | 'SD-N' | 'OFF' | '—';
export interface Duty { code: DutyCode; start?: number; end?: number; crew?: Crew | null; note?: string }
/** A shutdown team duty for a person on a date (start `HH:MM`, hours), or null when off the team that day. */
export type SdDutyOf = (employeeId: string, date: string) => { code: 'SD-D' | 'SD-N'; start: string; hours: number } | null;

export interface DayLine {
  date: string;
  duty: Duty;
  /** On leave / released that day (the duty is not worked). */
  absence: { short: string; label: string; first: boolean; last: boolean } | null;
  works: boolean;
  other: string[];
}

export interface ScheduleContext {
  absences: MpAbsence[];
  assignments: MpAssignment[];
  times?: ShiftTimes;
  sdDuty?: SdDutyOf;
}

const ON = new Set(['approved', 'planned', 'unresolved']);
const shiftDuty = (date: string, state: 'M' | 'A' | 'N', t: ShiftTimes, crew: Crew | null, note?: string): Duty => {
  const start = kuwaitMs(date, t[state]);
  return { code: state, start, end: start + t.hours * H, crew, note };
};

/** What `person` works on each date from `from` to `to`, with duty times, leave and notes. */
export function personDays(person: MpPerson, from: string, to: string, ctx: ScheduleContext): DayLine[] {
  const t = ctx.times ?? DEFAULT_SHIFT_TIMES;
  const absences = ctx.absences.filter((a) => a.employeeId === person.id && ON.has(a.status) && a.inCurrentPlan !== false);
  const assignments = ctx.assignments.filter((a) => a.employeeId === person.id);
  const out: DayLine[] = [];
  for (let date = from; date <= to; date = addDaysIso(date, 1)) {
    const p = personOn(person, date);
    const other: string[] = [];
    const asg = assignments.find((a) => a.start <= date && date <= a.end) ?? null;
    let duty: Duty;
    if (asg?.kind === 'shift_cover' && asg.crew) {
      const st = stateOf(dutyFor(date, asg.crew));
      duty = st === 'Off' ? { code: 'OFF', crew: asg.crew } : shiftDuty(date, st, t, asg.crew, `covering ${asg.crew} Shift`);
      other.push(`Controller cover · ${asg.crew} Shift`);
    } else if (asg?.kind === 'morning_rotation') {
      duty = isDayDutyWorkday(date) ? { ...shiftDuty(date, 'M', t, null), code: 'M', note: 'Morning post' } : { code: 'OFF' };
      other.push('Morning rotation');
    } else if (asg?.kind === 'sd_team' || p.sdTeam) {
      const sd = ctx.sdDuty?.(person.id, date) ?? null;
      if (sd) { const start = kuwaitMs(date, sd.start); duty = { code: sd.code, start, end: start + sd.hours * H, note: 'Shutdown team' }; }
      else if (asg?.kind === 'sd_team' && asg.works && !asg.works(date)) duty = { code: 'OFF', note: 'Shutdown team' };
      else if (asg?.kind === 'sd_team' && !ctx.sdDuty) duty = { code: 'SD-D', note: 'Shutdown team (hours not known)' };
      else duty = { code: 'OFF', note: 'Shutdown team' };
      other.push('Shutdown team');
    } else if (p.dayDuty) {
      duty = isDayDutyWorkday(date) ? (() => { const start = kuwaitMs(date, t.dayDutyStart); return { code: 'D' as const, start, end: start + t.dayDutyHours * H }; })() : { code: 'OFF' };
      other.push('Day duty');
    } else if (p.crew) {
      const st = stateOf(dutyFor(date, p.crew));
      duty = st === 'Off' ? { code: 'OFF', crew: p.crew } : shiftDuty(date, st, t, p.crew);
      if (p.movedFrom) other.push(`With ${p.crew} Shift`);
    } else duty = { code: '—' };
    const ab = absences.find((a) => a.start <= date && date <= a.end) ?? null;
    const absence = ab ? { short: ab.typeShort ?? ab.typeCode ?? 'Leave', label: ab.typeLabel ?? 'Leave', first: date === ab.start, last: date === ab.end } : null;
    if (absence) other.unshift(absence.first && ab!.start !== ab!.end ? `${absence.short} starts` : absence.last && ab!.start !== ab!.end ? `${absence.short} ends` : absence.short);
    out.push({ date, duty, absence, works: !absence && duty.start !== undefined, other });
  }
  return out;
}

export interface Finding {
  rule: RuleCode;
  severity: Severity;
  message: string;
  /** The day the problem falls on (for the timeline). */
  date?: string;
  /** Rest checks: the rest in hours. */
  hours?: number;
  /** Stable key: the same problem before and after a change has the same key. */
  key: string;
}

const fmt = (d: string) => { const [, m, day] = d.split('-').map(Number); return `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`; };
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Consecutive duty days and rest between duties over `days` (one person, dates in order). */
export function checkSchedule(days: DayLine[], rules: RuleConfig[]): Finding[] {
  const out: Finding[] = [];
  const consec = ruleOf(rules, 'max_consecutive_duty_days');
  if (consec.enabled) {
    const max = Number(consec.params.max ?? 6);
    let run: DayLine[] = [];
    const flush = () => {
      if (run.length > max) {
        const day = run[max];
        out.push({ rule: consec.code, severity: 'hard_stop', date: day.date, key: `consec:${run[0].date}`,
          message: `${run.length} duty days in a row (${fmt(run[0].date)} – ${fmt(run[run.length - 1].date)}): ${fmt(day.date)} is day ${max + 1}. At most ${max}.` });
      }
      run = [];
    };
    for (const d of days) { if (d.works && (!run.length || addDaysIso(run[run.length - 1].date, 1) === d.date)) run.push(d); else { flush(); if (d.works) run.push(d); } }
    flush();
  }
  const rest = ruleOf(rules, 'rest_between_duties'), minRest = ruleOf(rules, 'min_rest_hours');
  const minHours = minRest.enabled && minRest.params.hours != null ? Number(minRest.params.hours) : null;
  const worked = days.filter((d) => d.works && d.duty.start !== undefined && d.duty.end !== undefined);
  for (let i = 1; i < worked.length; i++) {
    const a = worked[i - 1], b = worked[i];
    const hours = round1((b.duty.start! - a.duty.end!) / H);
    const what = `${a.duty.code} on ${fmt(a.date)} ends ${hhmmOf(a.duty.end!)}${dayOf(a.duty.end!) !== a.date ? ` ${fmt(dayOf(a.duty.end!))}` : ''}; ${b.duty.code} on ${fmt(b.date)} starts ${hhmmOf(b.duty.start!)}`;
    if (rest.enabled && hours <= 0) out.push({ rule: rest.code, severity: 'hard_stop', date: b.date, hours, key: `rest:${b.date}`, message: `${hours < 0 ? 'Duties overlap' : 'No rest'}: ${what} (${hours} h).` });
    else if (minHours !== null && hours < minHours) out.push({ rule: minRest.code, severity: minRest.severity, date: b.date, hours, key: `minrest:${b.date}`, message: `Rest ${hours} h, below ${minHours} h: ${what}.` });
  }
  return out;
}

/** Rest in hours before each worked day (for the timeline), keyed by date. */
export function restBefore(days: DayLine[]): Map<string, number> {
  const out = new Map<string, number>();
  const worked = days.filter((d) => d.works && d.duty.start !== undefined && d.duty.end !== undefined);
  for (let i = 1; i < worked.length; i++) out.set(worked[i].date, round1((worked[i].duty.start! - worked[i - 1].duty.end!) / H));
  return out;
}

/** A change to check before it is made. */
export type Proposal =
  | { kind: 'absence'; employeeId: string; start: string; end: string; typeCode: string | null; typeShort: string; typeLabel?: string }
  | { kind: 'reschedule'; employeeId: string; recordIds: string[]; start: string; end: string; typeCode: string | null; typeShort: string }
  | { kind: 'move'; employeeId: string; start: string; end: string | null; crew: Crew | typeof DAY_DUTY; moveKind?: 'temporary' | 'permanent' | 'placement' }
  | { kind: 'release'; employeeId: string; start: string; end: string }
  | { kind: 'cover'; employeeId: string; crew: Crew; start: string; end: string; coverKind?: 'shift_cover' | 'morning_rotation' };

export interface ProposalInputs { people: MpPerson[]; absences: MpAbsence[]; assignments: MpAssignment[] }

/** The inputs as they would be with the change made. */
export function applyProposal(inp: ProposalInputs, pr: Proposal): ProposalInputs {
  switch (pr.kind) {
    case 'absence':
    case 'release':
      return { ...inp, absences: [...inp.absences, { id: 'proposed', employeeId: pr.employeeId, start: pr.start, end: pr.end, status: 'approved', inCurrentPlan: true,
        typeCode: pr.kind === 'release' ? 'task_release' : pr.typeCode, typeShort: pr.kind === 'release' ? 'REL' : pr.typeShort, typeLabel: pr.kind === 'release' ? 'Task release' : pr.typeLabel ?? pr.typeShort }] };
    case 'reschedule':
      return { ...inp, absences: [...inp.absences.filter((a) => !pr.recordIds.includes(a.id ?? '')),
        { id: 'proposed', employeeId: pr.employeeId, start: pr.start, end: pr.end, status: 'approved', inCurrentPlan: true, typeCode: pr.typeCode, typeShort: pr.typeShort, typeLabel: pr.typeShort }] };
    case 'move': {
      const mv: MpCrewMove = { start: pr.start, end: pr.moveKind === 'permanent' ? null : pr.end, crew: pr.crew, kind: pr.moveKind === 'placement' ? 'placement' : 'temporary' };
      return { ...inp, people: inp.people.map((p) => (p.id === pr.employeeId ? { ...p, moves: [...(p.moves ?? []), mv] } : p)) };
    }
    case 'cover':
      return { ...inp, assignments: [...inp.assignments, { id: 'proposed', kind: pr.coverKind ?? 'shift_cover', employeeId: pr.employeeId, crew: pr.crew, start: pr.start, end: pr.end }] };
  }
}

/** The dates a proposal touches. */
export function proposalSpan(pr: Proposal): { start: string; end: string } {
  return { start: pr.start, end: pr.end ?? addDaysIso(pr.start, 27) };
}

/** Leave of the same person already on any of the dates (the records a reschedule replaces excluded). */
export function leaveOverlap(inp: ProposalInputs, pr: Proposal, rules: RuleConfig[]): Finding[] {
  const rule = ruleOf(rules, 'leave_overlap');
  if (!rule.enabled || (pr.kind !== 'absence' && pr.kind !== 'reschedule' && pr.kind !== 'release')) return [];
  const skip = pr.kind === 'reschedule' ? pr.recordIds : [];
  return inp.absences.filter((a) => a.employeeId === pr.employeeId && ON.has(a.status) && a.inCurrentPlan !== false && !skip.includes(a.id ?? '') && a.start <= pr.end && pr.start <= a.end)
    .map((a) => ({ rule: rule.code, severity: rule.severity, date: a.start > pr.start ? a.start : pr.start, key: `leave:${a.id ?? a.start}`,
      message: `Already on ${a.typeShort ?? 'leave'} ${fmt(a.start)} – ${fmt(a.end)}.` }));
}

/** Another move, cover or shutdown team of the same person on any of the dates. */
export function assignmentOverlap(inp: ProposalInputs, pr: Proposal, rules: RuleConfig[]): Finding[] {
  const rule = ruleOf(rules, 'assignment_overlap');
  if (!rule.enabled || (pr.kind !== 'move' && pr.kind !== 'cover')) return [];
  const { start, end } = proposalSpan(pr);
  const person = inp.people.find((p) => p.id === pr.employeeId);
  const moves = (person?.moves ?? []).filter((m) => (pr.kind === 'move' && pr.moveKind === 'placement' ? m.kind !== 'placement' : true) && m.start <= end && (m.end === null || start <= m.end));
  const asg = inp.assignments.filter((a) => a.employeeId === pr.employeeId && a.start <= end && start <= a.end);
  return [
    ...moves.map((m) => ({ rule: rule.code, severity: rule.severity, date: m.start > start ? m.start : start, key: `move:${m.start}:${m.crew}`,
      message: `Already ${m.crew === DAY_DUTY ? 'on day duty' : m.crew === 'SD' ? 'on a shutdown team' : `with ${m.crew} Shift`} from ${fmt(m.start)}${m.end ? ` to ${fmt(m.end)}` : ''}.` })),
    ...asg.map((a) => ({ rule: rule.code, severity: rule.severity, date: a.start > start ? a.start : start, key: `asg:${a.id}`,
      message: `Already ${a.kind === 'sd_team' ? 'on a shutdown team' : a.kind === 'morning_rotation' ? 'on the Morning rotation' : `covering ${a.crew} Shift`} ${fmt(a.start)} – ${fmt(a.end)}.` }))
  ];
}

export interface TimelineRow { date: string; duty: DutyCode; other: string; changed: boolean; restHours: number | null; flagged: Severity | null }
export interface Validation {
  /** Problems the change creates (not there before). */
  findings: Finding[];
  /** Problems already there before the change (shown, not counted against it). */
  existing: Finding[];
  worst: Severity | null;
  timeline: TimelineRow[];
}

const worstOf = (f: Finding[]): Severity | null => f.reduce<Severity | null>((w, x) => (w === null || SEVERITY_RANK[x.severity] > SEVERITY_RANK[w] ? x.severity : w), null);

/**
 * Check `pr` for its person: overlaps, then the schedule before and after (consecutive duty days and rest, over the
 * change and 7 days either side), and the ±`around`-day timeline with the changed days marked.
 */
export function validateProposal(inp: ProposalInputs, pr: Proposal, rules: RuleConfig[], ctx: Omit<ScheduleContext, 'absences' | 'assignments'> = {}, around = 7): Validation {
  const person = inp.people.find((p) => p.id === pr.employeeId);
  const { start, end } = proposalSpan(pr);
  const from = addDaysIso(start, -around), to = addDaysIso(end, around);
  if (!person) return { findings: [], existing: [], worst: null, timeline: [] };
  const after = applyProposal(inp, pr);
  const personAfter = after.people.find((p) => p.id === pr.employeeId)!;
  // the schedule checks look further out, so a long run that starts before the window is still seen
  const wideFrom = addDaysIso(from, -7), wideTo = addDaysIso(to, 7);
  const before = personDays(person, wideFrom, wideTo, { ...ctx, absences: inp.absences, assignments: inp.assignments });
  const later = personDays(personAfter, wideFrom, wideTo, { ...ctx, absences: after.absences, assignments: after.assignments });
  const was = checkSchedule(before, rules), now = checkSchedule(later, rules);
  const wasKeys = new Set(was.map((f) => f.key));
  const findings = [...leaveOverlap(inp, pr, rules), ...assignmentOverlap(inp, pr, rules), ...now.filter((f) => !wasKeys.has(f.key))];
  const existing = was.filter((f) => f.date !== undefined && f.date >= from && f.date <= to);
  const restAfter = restBefore(later);
  const flag = new Map<string, Severity>();
  for (const f of findings) if (f.date && (!flag.has(f.date) || SEVERITY_RANK[f.severity] > SEVERITY_RANK[flag.get(f.date)!])) flag.set(f.date, f.severity);
  // a long change shows its first three weeks: the timeline answers before, during and after
  const shownEnd = addDaysIso(end < addDaysIso(start, 20) ? end : addDaysIso(start, 20), around);
  const timeline = later.filter((d) => d.date >= from && d.date <= shownEnd).map((d) => {
    const b = before.find((x) => x.date === d.date)!;
    const changed = b.duty.code !== d.duty.code || b.other.join('·') !== d.other.join('·') || b.works !== d.works;
    return { date: d.date, duty: d.duty.code, other: d.other.join(' · '), changed, restHours: restAfter.get(d.date) ?? null, flagged: flag.get(d.date) ?? null };
  });
  return { findings, existing, worst: worstOf(findings), timeline };
}

/** Findings the Section Head accepts by approving (warning and critical); a hard stop is never approved. */
export const acceptable = (f: Finding[]) => f.filter((x) => x.severity === 'warning' || x.severity === 'critical');
export const hasHardStop = (f: Finding[]) => f.some((x) => x.severity === 'hard_stop');
