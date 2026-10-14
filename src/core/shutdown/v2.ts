// Shutdown rules v2 (approved 11 Oct 2026). Used only by plans with rules_version 2; the plans made before keep the
// v1 rules exactly as they were. Pure functions: the plan page and the server-side approval run the same check.
//
// Kept apart on purpose: candidate eligibility, team composition, actual 12-hour coverage (by the clock), the duty and
// rest checks (including joining and returning), overtime accounting, and the plan check that puts them together.
// Priority: continuous qualified coverage → leave and roster feasibility → hard limits → fairness and New FO development.
import { addDaysIso, type Crew } from '../roster';
import { personOn, type MpAbsence, type MpAssignment, type MpPerson } from '../manpower';
import { checkSchedule, kuwaitMs, personDays, shiftTimesOf, type DayLine, type Finding, type RuleConfig, type SdDutyOf } from '../validation';
import { areasOf, groupOf, hoursOn, isDutyDay, isRampDay, memberHoursOn, memberWorks, phaseOn, planDates, type FoLevel, type SdMember, type SdPhase, type SdPlan, type SdTeam } from './index';
import { cycleOvertime, type OtBasis, type OtResult, type WorkedDuty } from './overtime';

export const SD_RULES_V2 = 2;
export const isV2 = (p: Pick<SdPlan, 'rulesVersion'>) => (p.rulesVersion ?? 1) >= SD_RULES_V2;

/** Defaults of a new v2 plan (all editable per plan / team). */
export const V2_DEFAULTS = {
  shiftHours: 12, normalHours: 8, reducedDays: 2, reducedHours: 12,
  monthWarn: 72, monthHard: 80, yearWarn: 380, yearHard: 440,
  teamNeeds: { controller: 2, senior: 2, good: 2, new: 1 },
  reducedNeeds: { controller: 1, senior: 1, good: 1, new: 0 },
} as const;
export const SICK_RULES = { okMax: 21, warnMax: 35, freshDays: 45 } as const;
export const CONTROLLER_GRADE = 15;
const CONTROLLER_ROLES = ['controller', 'vr_controller', 'morning_controller'];

export interface Limits { monthWarn: number; monthHard: number; yearWarn: number; yearHard: number }
export const limitsOf = (p: SdPlan): Limits => ({ monthWarn: p.maxOvertime, monthHard: p.maxOvertimeHard ?? V2_DEFAULTS.monthHard, yearWarn: p.maxOvertimeYear ?? V2_DEFAULTS.yearWarn, yearHard: p.maxOvertimeYearHard ?? V2_DEFAULTS.yearHard });

const H = 3600_000;
const ym = (d: string) => d.slice(0, 7);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (d: string) => `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;
export const fmtMonth = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const hhmm = (ms: number) => { const d = new Date(ms + 3 * H); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Who the person is (from the directory) ─────────────────────────────────────────────────────────────────────────
export interface PersonInfo { id: string; name: string; position: string | null; grade: number | null; foLevel: FoLevel | null }
export const isControllerPerson = (i: PersonInfo | undefined) => !!i && CONTROLLER_ROLES.includes(i.position ?? '') && (i.grade ?? 0) >= CONTROLLER_GRADE;

/** What a member counts for in the 12-hour coverage: only a qualified Controller, Senior FO or Good FO. An operator with no level never does. */
export function capabilities(m: SdMember, info: PersonInfo | undefined): { controller: boolean; senior: boolean; good: boolean } {
  const lvl = info?.foLevel ?? null;
  return {
    controller: m.slot === 'controller' && isControllerPerson(info),
    senior: m.slot === 'senior' && lvl === 'senior',
    good: m.slot === 'good' && (lvl === 'good' || lvl === 'senior'),
  };
}

// ── Duties and the effective roster ────────────────────────────────────────────────────────────────────────────────
/** The team's shift start, "07:00" / "19:00" (from its hours label, else by Morning / Night). */
export const teamStart = (t: SdTeam) => { const m = /(\d{1,2}):(\d{2})/.exec(t.hoursLabel ?? ''); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : t.shiftCode === 'N' ? '19:00' : '07:00'; };

/** The member's shutdown duty on a date: start and end (UTC ms, from Kuwait time) and hours; null when not working it. */
export function memberDuty(p: SdPlan, t: SdTeam, m: SdMember, date: string): { start: number; end: number; hours: number } | null {
  if (!memberWorks(p, m, date)) return null;
  const hours = memberHoursOn(p, m, date);
  if (!hours) return null;
  const start = kuwaitMs(date, teamStart(t));
  return { start, end: start + hours * H, hours };
}

/**
 * The roster the overtime is measured against on a date: the approved, effective-dated one. During the shutdown a member
 * keeps the rota of the crew he follows (else his own); outside it, his crew on that date with any temporary transfer.
 */
export function effectiveCrew(person: MpPerson | undefined, m: SdMember | null, date: string): Crew | null {
  if (m && m.followCrew && date >= m.start && date <= m.end) return m.followCrew;
  if (!person) return null;
  return personOn({ ...person, moves: person.moves?.filter((x) => x.kind !== 'sd') }, date).crew;
}

// ── Overtime ───────────────────────────────────────────────────────────────────────────────────────────────────────
// One engine for every overtime figure of a v2 plan: regular hours per 8-day rota cycle (day staff: per week), see
// ./overtime. A 12-hour duty on a crew rest day is not overtime by itself; it is set against the cycle's regular hours.

/**
 * Splits one duty's overtime between calendar months (Kuwait time) by the hours of the duty on each side of midnight.
 * (Kept for reference and tests; the cycle engine allocates the overtime hours themselves, see ./overtime.)
 */
export function allocateOvertime(date: string, start: number, hours: number, ot: number): { parts: { month: string; hours: number }[]; split: boolean } {
  const next = addDaysIso(date, 1);
  const midnight = kuwaitMs(next, '00:00');
  const end = start + hours * H;
  if (ot <= 0 || end <= midnight || ym(next) === ym(date)) return { parts: [{ month: ym(date), hours: ot }], split: false };
  const before = Math.max(0, Math.min(1, (midnight - start) / (hours * H)));
  const first = Math.round(ot * before * 100) / 100;
  return { parts: [{ month: ym(date), hours: first }, { month: ym(next), hours: Math.round((ot - first) * 100) / 100 }], split: true };
}

/** One duty with its regular and overtime hours and how the overtime falls in calendar months. */
export interface DutyOt { date: string; hours: number; regular: number; ot: number; crew: Crew | null; restDay: boolean; parts: { month: string; hours: number }[]; split: boolean }

/** The cycle engine's input for one member: the days on the team, the rota kept on each, approved leave credited. */
export function memberOtBasis(p: SdPlan, m: SdMember, person: MpPerson | undefined, leaveOn?: (date: string) => boolean): OtBasis {
  return { from: m.start > p.start ? m.start : p.start, to: m.end < p.end ? m.end : p.end, crewOn: (d) => effectiveCrew(person, m, d), leaveOn, normalHours: p.normalHours };
}
/** The member's shutdown duties with their regular and overtime hours, and the cycles they fall in. */
export function memberOtDetail(p: SdPlan, t: SdTeam, m: SdMember, person: MpPerson | undefined, leaveOn?: (date: string) => boolean): OtResult {
  const duties: WorkedDuty[] = [];
  for (const date of planDates(p)) { const d = memberDuty(p, t, m, date); if (d) duties.push({ date, start: d.start, hours: d.hours }); }
  return cycleOvertime(duties, memberOtBasis(p, m, person, leaveOn));
}
/** Every shutdown duty of a member with its overtime (the plan's calculation; the sheets and the Excel file read the same). */
export function memberOvertime(p: SdPlan, t: SdTeam, m: SdMember, person: MpPerson | undefined, leaveOn?: (date: string) => boolean): DutyOt[] {
  const r = memberOtDetail(p, t, m, person, leaveOn);
  return r.duties.map((d) => { const crew = effectiveCrew(person, m, d.date); return { date: d.date, hours: d.hours, regular: d.regular, ot: d.ot, crew, restDay: !isDutyDay(crew, d.date), parts: d.parts, split: d.split }; });
}

/** Overtime known from Oracle, typed in by the Manpower Coordinator: year to date and month to date, as of a date. */
export interface OtEntry { asOf: string; ytd: number; mtd: number; verified: boolean }
export type OtState = 'ok' | 'warn' | 'over' | 'unknown';
export interface OtPeriod { key: string; plan: number; prev: number | null; other: number; total: number; state: OtState }
export interface PersonOt { employeeId: string; duties: DutyOt[]; months: OtPeriod[]; years: OtPeriod[]; entry: OtEntry | null; entryState: 'missing' | 'unverified' | 'late' | 'ok'; plan: number }

/** Overtime of other shutdown plans (planned duties), to count once next to this one. */
export interface OtherDuty { employeeId: string; date: string; parts: { month: string; hours: number }[] }

const stateOf = (total: number, warn: number, hard: number, known: boolean): OtState => (total > hard ? 'over' : !known ? 'unknown' : total > warn ? 'warn' : 'ok');

/**
 * A person's overtime against the limits, per calendar month and year: what Oracle already shows (the typed entry),
 * other shutdowns planned after that date, and this plan. Nothing is counted twice: other plans count only on dates after
 * the entry's as-of date. A missing entry is unknown, never zero.
 */
export function personOvertime(p: SdPlan, employeeId: string, duties: DutyOt[], entry: OtEntry | null, others: OtherDuty[]): PersonOt {
  const L = limitsOf(p);
  const months = new Map<string, number>();
  for (const d of duties) for (const x of d.parts) months.set(x.month, (months.get(x.month) ?? 0) + x.hours);
  const keys = [...months.keys()].sort();
  const otherOf = (f: (month: string) => boolean) => others.filter((o) => o.employeeId === employeeId && (!entry || o.date > entry.asOf)).reduce((t, o) => t + o.parts.filter((x) => f(x.month)).reduce((u, x) => u + x.hours, 0), 0);
  const prevMonth = (k: string) => (!entry ? null : k === ym(entry.asOf) ? entry.mtd : k > ym(entry.asOf) ? 0 : null);
  const prevYear = (y: string) => (!entry ? null : y === entry.asOf.slice(0, 4) ? entry.ytd : y > entry.asOf.slice(0, 4) ? 0 : null);
  const known = !!entry;
  const mrows: OtPeriod[] = keys.map((k) => {
    const plan = r2(months.get(k)!), prev = prevMonth(k), other = r2(otherOf((x) => x === k));
    const total = r2(plan + (prev ?? 0) + other);
    return { key: k, plan, prev, other, total, state: stateOf(total, L.monthWarn, L.monthHard, known && prev !== null) };
  });
  const years = [...new Set(keys.map((k) => k.slice(0, 4)))];
  const yrows: OtPeriod[] = years.map((y) => {
    const plan = r2(keys.filter((k) => k.startsWith(y)).reduce((t, k) => t + months.get(k)!, 0)), prev = prevYear(y), other = r2(otherOf((x) => x.startsWith(y)));
    const total = r2(plan + (prev ?? 0) + other);
    return { key: y, plan, prev, other, total, state: stateOf(total, L.yearWarn, L.yearHard, known && prev !== null) };
  });
  const entryState = !entry ? 'missing' : entry.asOf > p.start ? 'late' : !entry.verified ? 'unverified' : 'ok';
  return { employeeId, duties, months: mrows, years: yrows, entry, entryState, plan: r2(duties.reduce((t, d) => t + d.ot, 0)) };
}

// ── Eligibility ───────────────────────────────────────────────────────────────────────────────────────────────────
export type ExceptionKind = 'consecutive_shutdown' | 'sick_leave' | 'rest_day_pair';
export interface SdException { planId: string; employeeId: string; kind: ExceptionKind; reason: string; approvedAt: string }
const hasException = (ex: SdException[], planId: string, employeeId: string, kind: ExceptionKind) => ex.some((e) => e.planId === planId && e.employeeId === employeeId && e.kind === kind);

/** Sick leave in the rolling 12 months, as confirmed (typed in) on a date. */
export interface SickEntry { asOf: string; days: number }
export type SickState = 'ok' | 'warn' | 'excluded' | 'excepted' | 'verify' | 'outdated';
/**
 * Rolling-12-month sick leave on `refDate`: 0–21 eligible, 22–35 eligible with a warning, over 35 excluded unless the
 * Section Head approves an exception. No confirmed figure: Verification needed (never zero). Older than 45 days: Data outdated.
 */
export function sickState(entry: SickEntry | null, refDate: string, excepted: boolean): { state: SickState; days: number | null; age: number | null } {
  if (!entry) return { state: 'verify', days: null, age: null };
  const age = days(entry.asOf, refDate);
  if (age > SICK_RULES.freshDays) return { state: 'outdated', days: entry.days, age };
  const state: SickState = entry.days <= SICK_RULES.okMax ? 'ok' : entry.days <= SICK_RULES.warnMax ? 'warn' : excepted ? 'excepted' : 'excluded';
  return { state, days: entry.days, age };
}
export const SICK_LABEL: Record<SickState, string> = { ok: 'Eligible', warn: 'Eligible · warning', excluded: 'Excluded (over 35 days)', excepted: 'Exception approved', verify: 'Verification needed', outdated: 'Data outdated — Update required' };

/** The shutdowns right before and right after one (by start date), each with who is on it. */
export interface PlanRef { plan: SdPlan; employeeIds: Set<string> }
export function adjacent(plans: PlanRef[], p: SdPlan): { prev: PlanRef | null; next: PlanRef | null } {
  const others = plans.filter((x) => x.plan.id !== p.id);
  const prev = others.filter((x) => x.plan.start < p.start).sort((a, b) => b.plan.start.localeCompare(a.plan.start))[0] ?? null;
  const next = others.filter((x) => x.plan.start > p.start).sort((a, b) => a.plan.start.localeCompare(b.plan.start))[0] ?? null;
  return { prev, next };
}

export type Eligibility = { ok: boolean; level: 'ok' | 'warn' | 'verify' | 'needs_exception' | 'blocked'; reasons: string[] };
/**
 * Can this person be put on (or stay on) this shutdown? Two shutdowns in a row: never for a Field / Panel Operator; a
 * Controller only with the Section Head's exception. Sick leave: as sickState. Missing overtime data never blocks picking.
 */
export function eligibility(p: SdPlan, info: PersonInfo | undefined, isController: boolean, around: { prev: PlanRef | null; next: PlanRef | null }, sick: ReturnType<typeof sickState>, ex: SdException[]): Eligibility {
  const reasons: string[] = []; let level = 'ok' as Eligibility['level'];
  const raise = (l: Eligibility['level']) => { const rank = ['ok', 'warn', 'verify', 'needs_exception', 'blocked']; if (rank.indexOf(l) > rank.indexOf(level)) level = l; };
  const id = info?.id ?? '';
  const nb = [around.prev, around.next].filter((x): x is PlanRef => !!x && x.employeeIds.has(id));
  if (nb.length) {
    const names = nb.map((x) => x.plan.title).join(' and ');
    if (!isController) { raise('blocked'); reasons.push(`On ${names}: two shutdowns in a row are not allowed for operators.`); }
    else if (hasException(ex, p.id, id, 'consecutive_shutdown')) reasons.push(`On ${names}: exception approved by the Section Head.`);
    else { raise('needs_exception'); reasons.push(`On ${names}: a Controller needs the Section Head's exception for two shutdowns in a row.`); }
  }
  if (sick.state === 'warn') { raise('warn'); reasons.push(`${sick.days} sick-leave days in 12 months (22–35).`); }
  if (sick.state === 'excluded') { raise('needs_exception'); reasons.push(`${sick.days} sick-leave days in 12 months (over 35): excluded unless the Section Head approves.`); }
  if (sick.state === 'excepted') reasons.push(`${sick.days} sick-leave days: exception approved.`);
  if (sick.state === 'verify') { raise('verify'); reasons.push('Sick leave: Verification needed.'); }
  if (sick.state === 'outdated') { raise('verify'); reasons.push(`Sick leave: Data outdated — Update required (${sick.age} days old).`); }
  return { ok: level !== 'blocked' && level !== 'needs_exception', level, reasons };
}

// ── Coverage by the clock ─────────────────────────────────────────────────────────────────────────────────────────
export type CoverRole = 'controller' | 'senior' | 'good';
export const COVER_ROLES: CoverRole[] = ['controller', 'senior', 'good'];
export const COVER_LABEL: Record<CoverRole, string> = { controller: 'Controller', senior: 'Senior FO', good: 'Good FO' };
/** A stretch of a team shift with fewer qualified people on duty than the place needs (`have` of `need`). */
export interface CoverGap { teamId: string; team: string; date: string; role: string; label: string; from: string; to: string; hours: number; need: number; have: number }

/** One place a team shift must keep staffed every moment: who counts for it and how many it needs on a date. */
export interface CoverPlace { key: string; label: string; counts: (m: SdMember) => boolean; need: (date: string) => number }
/**
 * The places of a team and their minimum on duty at every moment. Train shutdown: a qualified Controller, Senior FO and
 * Good FO (v2: one of each on duty is the minimum, the rest of the team is relief; reduced days: the reduced needs).
 * Total turnaround: the Controllers (per section, when the plan has sections) and the operators of each area, as many
 * as the phase of that date needs.
 */
export function coverPlaces(p: SdPlan, t: SdTeam, info: Map<string, PersonInfo>, phases: SdPhase[] = []): CoverPlace[] {
  if (p.kind === 'total') {
    const n = (d: string) => phaseOn(phases, d)?.needs[t.id];
    const ctl = (m: SdMember) => m.slot === 'controller' && isControllerPerson(info.get(m.employeeId));
    const out: CoverPlace[] = p.sections.length
      ? p.sections.map((s) => ({ key: `ctl:${s}`, label: `Controller ${s}`, counts: (m: SdMember) => ctl(m) && groupOf(p.sections, m.area) === s, need: (d: string) => n(d)?.sections?.[s] ?? 0 }))
      : [{ key: 'controller', label: 'Controller', counts: ctl, need: (d: string) => n(d)?.controller ?? 0 }];
    const areas = areasOf(p);
    for (const a of areas) out.push({ key: `area:${a}`, label: a ? `Operators ${a}` : 'Operators', counts: (m: SdMember) => m.slot !== 'controller' && groupOf(areas, m.area) === a, need: (d: string) => n(d)?.areas[a] ?? 0 });
    return out;
  }
  const v2 = isV2(p);
  return COVER_ROLES.map((role) => ({ key: role, label: COVER_LABEL[role], counts: (m: SdMember) => capabilities(m, info.get(m.employeeId))[role],
    need: (d: string) => { const k = (isRampDay(p, d) ? t.rampNeeds : t.needs)[role]; return v2 ? Math.min(1, k) : k; } }));
}

/**
 * Coverage by the clock: every team shift (07:00–19:00, 19:00–07:00) must have, at every moment of its hours, at least
 * as many qualified people on duty as each place needs. Duties are taken with their real start and end, so an 8-hour duty
 * (07:00–15:00) counts only for its own 8 hours and the last 4 hours need somebody else on the full shift. Returns every
 * stretch below the minimum, with how many were on duty.
 */
export function coverageGaps(p: SdPlan, teams: SdTeam[], members: SdMember[], info: Map<string, PersonInfo>, away: (employeeId: string, date: string) => boolean, phases: SdPhase[] = []): CoverGap[] {
  const out: CoverGap[] = [];
  for (const t of teams) {
    const places = coverPlaces(p, t, info, phases);
    for (const date of planDates(p)) {
      // v2: the team shift is always the full 12 h (reduced days: fewer people, not fewer hours); before v2 a reduced
      // day is a shorter shift (the plan's reduced-day hours)
      const ws = kuwaitMs(date, teamStart(t)), we = ws + (isV2(p) ? p.shiftHours : hoursOn(p, date)) * H;
      for (const pl of places) {
        const need = pl.need(date);
        if (need <= 0) continue;
        const spans = members.filter((m) => m.teamId === t.id && pl.counts(m) && !away(m.employeeId, date))
          .map((m) => memberDuty(p, t, m, date)).filter((d): d is NonNullable<typeof d> => !!d)
          .map((d) => [Math.max(ws, d.start), Math.min(we, d.end)] as const).filter(([a, b]) => b > a);
        // the moments where the number on duty changes, then the count in each stretch between them
        const cuts = [...new Set([ws, we, ...spans.flatMap(([a, b]) => [a, b])])].sort((a, b) => a - b);
        let open: { a: number; have: number } | null = null;
        const close = (at: number) => { if (open) { out.push({ teamId: t.id, team: t.name, date, role: pl.key, label: pl.label, from: hhmm(open.a), to: hhmm(at), hours: (at - open.a) / H, need, have: open.have }); open = null; } };
        for (let i = 0; i + 1 < cuts.length; i++) {
          const a = cuts[i], b = cuts[i + 1];
          const have = spans.filter(([x, y]) => x <= a && y >= b).length;
          if (have < need) { if (open && open.have !== have) close(a); if (!open) open = { a, have }; } else close(a);
          if (i + 2 === cuts.length) close(b);
        }
      }
    }
  }
  return out;
}

// ── Duty and rest checks, joining and returning ──────────────────────────────────────────────────────────────────
export interface TransitionResult { employeeId: string; findings: Finding[]; joinOff: string[]; returnOff: string[]; returnOn: string | null }
/**
 * The person's duties around the shutdown (his crew before, the team shift, his crew after) against the hard rules: no
 * 7th day in a row, no overlap or zero rest, 24 h off when changing between Morning and Night. When joining or returning
 * breaks them, the fewest own-crew duty days to take off (before joining / before rejoining) are worked out.
 */
export function transitions(person: MpPerson, m: SdMember, sdDuty: SdDutyOf, absences: MpAbsence[], assignments: MpAssignment[], rules: RuleConfig[]): TransitionResult {
  const from = addDaysIso(m.start, -14), to = addDaysIso(m.end, 14);
  const lines = personDays(person, from, to, { absences, assignments, sdDuty, times: shiftTimesOf(rules) });
  const hard = (ls: DayLine[]) => checkSchedule(ls, rules).filter((f) => f.severity === 'hard_stop');
  const offOn = (ls: DayLine[], dates: string[]) => ls.map((l) => (dates.includes(l.date) ? { ...l, works: false, other: [...l.other, 'Off (shutdown transition)'] } : l));
  const crewDays = (dates: string[]) => dates.filter((d) => { const l = lines.find((x) => x.date === d); return !!l && l.works && !(l.other.includes('Shutdown team')); });
  const before = crewDays(Array.from({ length: 6 }, (_, i) => addDaysIso(m.start, -(i + 1))));        // nearest first
  const after = crewDays(Array.from({ length: 10 }, (_, i) => addDaysIso(m.end, i + 1)));
  const joinBad = (ls: DayLine[]) => hard(ls).some((f) => f.date !== undefined && f.date <= addDaysIso(m.start, 6));
  const retBad = (ls: DayLine[]) => hard(ls).some((f) => f.date !== undefined && f.date >= addDaysIso(m.end, -6));
  let joinOff: string[] = [];
  for (let k = 0; k <= Math.min(3, before.length); k++) { const off = before.slice(0, k); if (!joinBad(offOn(lines, off))) { joinOff = off; break; } if (k === Math.min(3, before.length)) joinOff = off; }
  let returnOff: string[] = [];
  for (let k = 0; k <= Math.min(6, after.length); k++) { const off = after.slice(0, k); if (!retBad(offOn(lines, [...joinOff, ...off]))) { returnOff = off; break; } if (k === Math.min(6, after.length)) returnOff = off; }
  const final = offOn(lines, [...joinOff, ...returnOff]);
  const returnOn = after.find((d) => !returnOff.includes(d)) ?? null;
  return { employeeId: m.employeeId, findings: hard(final), joinOff: joinOff.sort(), returnOff, returnOn };
}

/** Working both days of one of his rota's pairs of rest days (one is allowed; the other stays off unless approved). */
export function restDayPairs(p: SdPlan, m: SdMember, person: MpPerson | undefined): { pairs: string[][]; single: string[] } {
  const pairs: string[][] = [], single: string[] = [];
  const dates = planDates(p).filter((d) => d >= m.start && d <= m.end);
  for (const d of dates) {
    const crew = effectiveCrew(person, m, d);
    if (isDutyDay(crew, d) || !memberWorks(p, m, d)) continue;
    const prev = addDaysIso(d, -1), next = addDaysIso(d, 1);
    const partner = !isDutyDay(effectiveCrew(person, m, prev), prev) ? prev : !isDutyDay(effectiveCrew(person, m, next), next) ? next : null;
    if (partner && partner > d && memberWorks(p, m, partner)) pairs.push([d, partner]);
    else if (!(partner && partner < d && memberWorks(p, m, partner))) single.push(d);
  }
  return { pairs, single };
}

// ── The plan check ────────────────────────────────────────────────────────────────────────────────────────────────
export type IssueLevel = 'block' | 'verify' | 'warn' | 'info';
export interface Issue { level: IssueLevel; code: string; message: string; employeeId?: string; teamId?: string; date?: string }
export interface PlanCheckInput {
  plan: SdPlan; teams: SdTeam[]; members: SdMember[];
  people: MpPerson[]; absences: MpAbsence[]; assignments: MpAssignment[]; rules: RuleConfig[];
  info: Map<string, PersonInfo>;
  /** Active shutdown plans with their members (for two-in-a-row) and the duties of the others (overtime counted once). */
  plans: PlanRef[]; otherDuties: OtherDuty[];
  /** Total turnaround: the phases (people needed per area and section). */
  phases?: SdPhase[];
  /** Other shutdown teams' duties for the rest check (this plan's own come from its members). */
  otherSdDuty?: SdDutyOf;
  otEntries: Map<string, OtEntry>; sickEntries: Map<string, SickEntry>; exceptions: SdException[];
  /** The date of the check (Kuwait). */
  today: string;
}
export interface PlanCheck {
  status: 'ready' | 'not_ready' | 'verify';
  issues: Issue[]; gaps: CoverGap[]; overtime: PersonOt[]; transitions: TransitionResult[];
  /** Overtime of the whole team on this plan: highest minus lowest. */
  spread: { max: number; min: number; diff: number };
  fingerprint: string; rulesVersion: number; checkedOn: string;
}

/** Leave that takes the person off the team on a date: leave already approved in Oracle (leave not yet approved is postponed). */
export const awayOn = (absences: MpAbsence[]) => (employeeId: string, date: string) => absences.some((a) => a.employeeId === employeeId && a.oracle === 'approved' && (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && a.start <= date && date <= a.end);

export function checkPlan(inp: PlanCheckInput): PlanCheck {
  const { plan: p, teams, members, info } = inp;
  const issues: Issue[] = [];
  const people = new Map(inp.people.map((x) => [x.id, x]));
  const name = (id: string) => info.get(id)?.name ?? 'Member';
  const teamOf = new Map(teams.map((t) => [t.id, t]));
  const away = awayOn(inp.absences);
  if (!members.length) issues.push({ level: 'block', code: 'empty', message: 'Nobody is on the teams yet.' });

  // eligibility of everyone on the plan
  const around = adjacent(inp.plans, p);
  for (const m of members) {
    const i = info.get(m.employeeId);
    const sick = sickState(inp.sickEntries.get(m.employeeId) ?? null, inp.today, hasException(inp.exceptions, p.id, m.employeeId, 'sick_leave'));
    const e = eligibility(p, i, m.slot === 'controller', around, sick, inp.exceptions);
    const lvl: IssueLevel = e.level === 'blocked' || e.level === 'needs_exception' ? 'block' : e.level === 'verify' ? 'verify' : e.level === 'warn' ? 'warn' : 'info';
    for (const r of e.reasons) issues.push({ level: lvl, code: 'eligibility', message: `${name(m.employeeId)}: ${r}`, employeeId: m.employeeId });
    if (m.slot === 'controller' && !isControllerPerson(i)) issues.push({ level: 'block', code: 'controller_grade', message: `${name(m.employeeId)}: a Controller place needs a Controller of Grade ${CONTROLLER_GRADE} or above.`, employeeId: m.employeeId });
    const cap = capabilities(m, i);
    if ((m.slot === 'senior' && !cap.senior) || (m.slot === 'good' && !cap.good)) issues.push({ level: 'warn', code: 'level', message: `${name(m.employeeId)}: in the ${m.slot === 'senior' ? 'Senior' : 'Good'} FO place but marked ${i?.foLevel ?? 'without a level'}: not counted for the 12-hour coverage.`, employeeId: m.employeeId });
    if (m.slot === 'member') issues.push({ level: 'info', code: 'unclassified', message: `${name(m.employeeId)}: Operator without a level, not counted as a Senior or Good FO.`, employeeId: m.employeeId });
  }

  // continuous 12-hour coverage
  const gaps = coverageGaps(p, teams, members, info, away, inp.phases ?? []);
  const byGap = new Map<string, CoverGap[]>();
  for (const g of gaps) { const k = `${g.teamId}|${g.role}`; byGap.set(k, [...(byGap.get(k) ?? []), g]); }
  for (const list of byGap.values()) {
    const g = list[0];
    const hrs = r2(list.reduce((t, x) => t + x.hours, 0));
    issues.push({ level: 'block', code: 'coverage', teamId: g.teamId, date: g.date, message: `${g.team} team: ${g.label} below the minimum of ${g.need} for ${hrs} h on ${new Set(list.map((x) => x.date)).size} shift${new Set(list.map((x) => x.date)).size === 1 ? '' : 's'}, first ${fmtDay(g.date)} ${g.from}–${g.to} (${g.have} on duty).` });
  }
  // composition: Primary / Assistant Controller, New FO (a training place, never blocking)
  for (const t of teams) {
    const ctl = members.filter((m) => m.teamId === t.id && m.slot === 'controller');
    if (ctl.length >= 2 && !ctl.some((m) => m.controllerRole === 'primary')) issues.push({ level: 'info', code: 'primary', teamId: t.id, message: `${t.name} team: mark the Primary and the Assistant Controller.` });
    if (!members.some((m) => m.teamId === t.id && m.slot === 'new')) issues.push({ level: 'info', code: 'new_fo', teamId: t.id, message: `${t.name} team: no New FO — a training opportunity for a future shutdown.` });
  }

  // duties, rest, joining and returning; rest-day pairs
  const own = (employeeId: string, date: string) => {
    for (const m of members.filter((x) => x.employeeId === employeeId)) {
      const t = teamOf.get(m.teamId); const d = t ? memberDuty(p, t, m, date) : null;
      if (d) return { code: t!.shiftCode === 'N' ? 'SD-N' as const : 'SD-D' as const, start: teamStart(t!), hours: d.hours };
    }
    return inp.otherSdDuty?.(employeeId, date) ?? null;
  };
  const trans: TransitionResult[] = [];
  for (const m of members) {
    const person = people.get(m.employeeId);
    if (!person) { issues.push({ level: 'verify', code: 'person', message: `${name(m.employeeId)}: not found in the staff list.`, employeeId: m.employeeId }); continue; }
    const tr = transitions(person, m, own, inp.absences, inp.assignments, inp.rules);
    trans.push(tr);
    for (const f of tr.findings) issues.push({ level: 'block', code: f.rule, date: f.date, employeeId: m.employeeId, message: `${name(m.employeeId)}: ${f.message}` });
    if (tr.joinOff.length) issues.push({ level: 'info', code: 'join_off', employeeId: m.employeeId, message: `${name(m.employeeId)}: off ${tr.joinOff.map(fmtDay).join(', ')} before joining (rest rules).` });
    if (tr.returnOff.length) issues.push({ level: 'info', code: 'return_off', employeeId: m.employeeId, message: `${name(m.employeeId)}: off ${tr.returnOff.map(fmtDay).join(', ')}, back with his crew ${tr.returnOn ? fmtDay(tr.returnOn) : ''}.` });
    const rp = restDayPairs(p, m, person);
    for (const pair of rp.pairs) if (!hasException(inp.exceptions, p.id, m.employeeId, 'rest_day_pair')) issues.push({ level: 'block', code: 'rest_day_pair', employeeId: m.employeeId, date: pair[0], message: `${name(m.employeeId)}: works both rest days ${fmtDay(pair[0])} and ${fmtDay(pair[1])}; one stays off unless the Section Head approves.` });
    // fatigue: long runs of 12-hour duties are reported (6 days in a row is the hard limit)
    const t = teamOf.get(m.teamId);
    if (t) { let run = 0, worst = 0; for (const d of planDates(p)) { const x = memberDuty(p, t, m, d); run = x && x.hours >= p.shiftHours ? run + 1 : 0; worst = Math.max(worst, run); }
      const lim = t.shiftCode === 'N' ? 3 : 4;
      if (worst > lim) issues.push({ level: 'info', code: 'fatigue', employeeId: m.employeeId, message: `${name(m.employeeId)}: ${worst} 12-hour ${t.shiftCode === 'N' ? 'nights' : 'days'} in a row (fatigue risk above ${lim}).` }); }
  }

  // overtime: limits, entries, month-end splits
  const L = limitsOf(p);
  const overtime: PersonOt[] = [];
  for (const id of [...new Set(members.map((m) => m.employeeId))]) {
    const leave = (d: string) => away(id, d);
    const details = members.filter((m) => m.employeeId === id).flatMap((m) => { const t = teamOf.get(m.teamId); return t ? [memberOtDetail(p, t, m, people.get(id), leave)] : []; });
    const duties = members.filter((m) => m.employeeId === id).flatMap((m) => { const t = teamOf.get(m.teamId); return t ? memberOvertime(p, t, m, people.get(id), leave) : []; });
    const short = details.flatMap((r) => r.cycles).filter((c) => c.short > 0);
    if (short.length) issues.push({ level: 'info', code: 'short_hours', employeeId: id, message: `${name(id)}: ${r2(short.reduce((t, c) => t + c.short, 0))} h below the regular hours (${short.map((c) => `${fmtDay(c.from < p.start ? p.start : c.from)}–${fmtDay(c.to > p.end ? p.end : c.to)}: ${c.short} h`).join(', ')}).` });
    const o = personOvertime(p, id, duties, inp.otEntries.get(id) ?? null, inp.otherDuties.filter((x) => x.employeeId === id));
    overtime.push(o);
    if (o.entryState === 'missing') issues.push({ level: 'verify', code: 'ot_missing', employeeId: id, message: `${name(id)}: overtime already taken not entered yet (from the Oracle report).` });
    if (o.entryState === 'unverified') issues.push({ level: 'verify', code: 'ot_unverified', employeeId: id, message: `${name(id)}: overtime entered but not verified.` });
    if (o.entryState === 'late') issues.push({ level: 'verify', code: 'ot_late', employeeId: id, message: `${name(id)}: overtime entry is dated after the shutdown starts; enter it as of a date before ${fmtDay(p.start)}.` });
    for (const x of o.months) {
      if (x.state === 'over') issues.push({ level: 'block', code: 'ot_month_hard', employeeId: id, message: `${name(id)}: ${x.total} h overtime in ${fmtMonth(x.key)}, over the ${L.monthHard} h limit.` });
      else if (x.state === 'warn') issues.push({ level: 'warn', code: 'ot_month_warn', employeeId: id, message: `${name(id)}: ${x.total} h overtime in ${fmtMonth(x.key)} (above ${L.monthWarn} h; ${r2(L.monthHard - x.total)} h left to the limit).` });
    }
    for (const x of o.years) {
      if (x.state === 'over') issues.push({ level: 'block', code: 'ot_year_hard', employeeId: id, message: `${name(id)}: ${x.total} h overtime in ${x.key}, over the ${L.yearHard} h limit.` });
      else if (x.state === 'warn') issues.push({ level: 'warn', code: 'ot_year_warn', employeeId: id, message: `${name(id)}: ${x.total} h overtime in ${x.key} (above ${L.yearWarn} h; ${r2(L.yearHard - x.total)} h left).` });
    }
    const split = o.duties.filter((d) => d.split);
    if (split.length) issues.push({ level: 'warn', code: 'ot_month_split', employeeId: id, message: `${name(id)}: night duty ${split.map((d) => fmtDay(d.date)).join(', ')} crosses month-end; its overtime is split by the hours in each month. Check against payroll practice.` });
  }
  const totals = overtime.map((o) => o.plan);
  const spread = { max: totals.length ? Math.max(...totals) : 0, min: totals.length ? Math.min(...totals) : 0, diff: totals.length ? r2(Math.max(...totals) - Math.min(...totals)) : 0 };

  const status: PlanCheck['status'] = issues.some((i) => i.level === 'block') ? 'not_ready' : issues.some((i) => i.level === 'verify') ? 'verify' : 'ready';
  return { status, issues, gaps, overtime, transitions: trans, spread, fingerprint: fingerprint(inp), rulesVersion: p.rulesVersion ?? 1, checkedOn: inp.today };
}

// ── Fingerprint: approval is tied to the exact data it was given for ─────────────────────────────────────────────
function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
/** A stable digest of everything the check depends on for this plan (changes to any of it make an approval stale). */
export function fingerprint(inp: Pick<PlanCheckInput, 'plan' | 'teams' | 'members' | 'people' | 'absences' | 'otEntries' | 'sickEntries' | 'exceptions' | 'info'>): string {
  const { plan: p } = inp;
  const ids = new Set(inp.members.map((m) => m.employeeId));
  const data = {
    plan: [p.id, p.start, p.end, p.daysOn, p.daysOff, p.shiftHours, p.rampDays, p.rampHours, p.normalHours, p.maxOvertime, p.maxOvertimeHard, p.maxOvertimeYear, p.maxOvertimeYearHard, p.rulesVersion],
    teams: inp.teams.map((t) => [t.id, t.shiftCode, t.hoursLabel, t.needs, t.rampNeeds]).sort(),
    members: inp.members.map((m) => [m.id, m.employeeId, m.teamId, m.slot, m.controllerRole ?? null, m.start, m.end, m.followCrew ?? null, m.offset,
      Object.entries(m.days ?? {}).sort(([a], [b]) => a.localeCompare(b))]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    levels: [...ids].sort().map((id) => [id, inp.info.get(id)?.foLevel ?? null, inp.info.get(id)?.grade ?? null, inp.info.get(id)?.position ?? null]),
    moves: [...ids].sort().map((id) => [id, (inp.people.find((x) => x.id === id)?.moves ?? []).filter((x) => x.kind !== 'sd').map((x) => [x.start, x.end, x.crew, x.kind]).sort()]),
    leave: inp.absences.filter((a) => ids.has(a.employeeId) && a.end >= addDaysIso(p.start, -14) && a.start <= addDaysIso(p.end, 14)).map((a) => [a.id, a.employeeId, a.start, a.end, a.status, a.oracle ?? null, a.inCurrentPlan ?? true]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ot: [...ids].sort().map((id) => [id, inp.otEntries.get(id) ?? null]),
    sick: [...ids].sort().map((id) => [id, inp.sickEntries.get(id) ?? null]),
    ex: inp.exceptions.filter((e) => e.planId === p.id).map((e) => [e.employeeId, e.kind, e.approvedAt]).sort(),
  };
  return hash(JSON.stringify(data));
}

/** Reduced days of a v2 plan: the first and last `rampDays` days (1 Controller, 1 Senior FO, 1 Good FO, 12 h). */
export const isReducedDay = (p: SdPlan, date: string) => isRampDay(p, date);

// ── The planner's view of the same data the check uses ────────────────────────────────────────────────────────────
/**
 * What the train-shutdown planner needs from the plan check's data, so the plan it proposes passes the same check:
 * approved leave as away, the rota each member keeps, the cost of joining / leaving the team with given days (own-crew
 * days to take off and broken rest rules, from `transitions`), and overtime already counted in each month (Oracle month
 * to date and other shutdowns after it).
 */
export function plannerContext(inp: PlanCheckInput): { away: (employeeId: string, date: string) => boolean; crewOf: (employeeId: string) => Crew | null; crewOn: (employeeId: string, date: string) => Crew | null; transitionCost: (m: SdMember, days: Record<string, boolean>) => number; monthTaken: (employeeId: string, ym: string) => number } {
  const p = inp.plan;
  const people = new Map(inp.people.map((x) => [x.id, x]));
  const teamOf = new Map(inp.teams.map((t) => [t.id, t]));
  const byEmp = new Map(inp.members.map((m) => [m.employeeId, m]));
  return {
    away: awayOn(inp.absences),
    crewOn: (e, d) => effectiveCrew(people.get(e), byEmp.get(e) ?? null, d),
    crewOf: (e) => { const m = byEmp.get(e); return effectiveCrew(people.get(e), m ?? null, m ? (m.start > p.start ? m.start : p.start) : p.start); },
    transitionCost: (m, days) => {
      const person = people.get(m.employeeId); const t = teamOf.get(m.teamId);
      if (!person || !t) return 0;
      const temp: SdMember = { ...m, days: Object.fromEntries(Object.entries(days).map(([d, w]) => [d, { works: w, hours: w ? p.shiftHours : null }])) };
      const own = (employeeId: string, date: string) => {
        if (employeeId !== m.employeeId) return inp.otherSdDuty?.(employeeId, date) ?? null;
        const d = memberDuty(p, t, temp, date);
        return d ? { code: t.shiftCode === 'N' ? 'SD-N' as const : 'SD-D' as const, start: teamStart(t), hours: d.hours } : inp.otherSdDuty?.(employeeId, date) ?? null;
      };
      const tr = transitions(person, temp, own, inp.absences, inp.assignments, inp.rules);
      return tr.joinOff.length + tr.returnOff.length + 5 * tr.findings.length;
    },
    monthTaken: (e, ym) => {
      const entry = inp.otEntries.get(e) ?? null;
      const prev = entry && entry.asOf.slice(0, 7) === ym ? entry.mtd : 0;
      const other = inp.otherDuties.filter((o) => o.employeeId === e && (!entry || o.date > entry.asOf)).reduce((t, o) => t + o.parts.filter((x) => x.month === ym).reduce((u, x) => u + x.hours, 0), 0);
      return prev + other;
    },
  };
}
