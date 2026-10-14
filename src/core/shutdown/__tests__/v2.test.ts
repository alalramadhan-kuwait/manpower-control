// Shutdown rules v2: the approved acceptance tests (G1–G15; G16, the Excel file, is in the shutdown feature tests).
import { describe, expect, it } from 'vitest';
import type { Crew } from '../../roster';
import { addDaysIso, isWorkingDay } from '../../roster';
import type { MpPerson } from '../../manpower';
import { checkSchedule, DEFAULT_RULES, personDays, type DayLine } from '../../validation';
import { planDates, type SdMember, type SdPlan, type SdTeam } from '..';
import { suggestFollow } from '../overlap';
import { spreadGroups, spreadGroup, V2_MAX_RUN } from '../spread';
import {
  adjacent, allocateOvertime, checkPlan, coverageGaps, effectiveCrew, eligibility, memberOtDetail, memberOvertime, personOvertime, restDayPairs,
  sickState, transitions, type PersonInfo, type PlanCheckInput, type SdException,
} from '../v2';

const plan: SdPlan = { id: 'p', title: 'Train-1 SD', kind: 'train', areas: [], sections: [], start: '2026-11-01', end: '2026-11-30', eventId: null,
  daysOn: 3, daysOff: 1, shiftHours: 12, rampDays: 2, rampHours: 12, normalHours: 8, maxOvertime: 72, maxOvertimeYear: 380, maxOvertimeHard: 80, maxOvertimeYearHard: 440, rulesVersion: 2 };
const needs = { controller: 2, senior: 2, good: 2, new: 1 }, reduced = { controller: 1, senior: 1, good: 1, new: 0 };
const day: SdTeam = { id: 'day', planId: 'p', name: 'Morning', sort: 0, needs, rampNeeds: reduced, shiftCode: 'M', hoursLabel: '07:00 - 19:00' };
const night: SdTeam = { ...day, id: 'night', name: 'Night', sort: 1, shiftCode: 'N', hoursLabel: '19:00 - 07:00' };
const dates = planDates(plan);

const person = (id: string, crew: Crew | null, role: MpPerson['role'] = 'field_operator', grade = 13, sd = true): MpPerson => ({
  id, employeeNumber: id, name: id.toUpperCase(), role, crew, grade, employmentType: 'knpc', takeCharge: null, panelQualified: null, actingController: null,
  moves: sd ? [{ start: plan.start, end: plan.end, crew: 'SD', kind: 'sd' }] : [] });
const member = (id: string, slot: SdMember['slot'], teamId = 'day', extra: Partial<SdMember> = {}): SdMember => ({ id, planId: 'p', teamId, employeeId: id, slot, offset: 0, start: plan.start, end: plan.end, ...extra });
const infoOf = (list: { id: string; level?: PersonInfo['foLevel']; ctl?: boolean }[]) => new Map(list.map((x) => [x.id, { id: x.id, name: x.id.toUpperCase(), position: x.ctl ? 'controller' : 'field_operator', grade: x.ctl ? 16 : 13, foLevel: x.level ?? null } as PersonInfo]));

/** Days as the v2 balancing writes them (each place: one on the full shift, the others 8 h on their crew's duty days). */
function balance(list: SdMember[], crews: Record<string, Crew>, team = day): SdMember[] {
  const out = list.map((m) => ({ ...m, days: {} as NonNullable<SdMember['days']> }));
  for (const g of spreadGroups(plan, team, out.filter((m) => m.teamId === team.id), [])) {
    if (!g.memberIds.length) continue;
    const r = spreadGroup(plan, g, out, { crewOf: (id) => crews[id] ?? null, away: () => false, maxRun: 6, v2: true });
    for (const m of out) { const d = r.days.get(m.id); if (!d) continue; for (const [date, w] of Object.entries(d)) m.days![date] = { works: w, hours: w ? r.hours.get(m.id)?.[date] ?? null : null }; }
  }
  return out;
}

/** A complete Morning team: two Controllers, Senior and Good FOs from different crews, a New FO. */
const crews: Record<string, Crew> = { c1: 'A', c2: 'C', s1: 'A', s2: 'C', g1: 'B', g2: 'D', n1: 'B' };
const roster = [member('c1', 'controller', 'day', { controllerRole: 'primary' }), member('c2', 'controller', 'day', { controllerRole: 'assistant' }), member('s1', 'senior'), member('s2', 'senior'), member('g1', 'good'), member('g2', 'good'), member('n1', 'new')];
const info = infoOf([{ id: 'c1', ctl: true }, { id: 'c2', ctl: true }, { id: 's1', level: 'senior' }, { id: 's2', level: 'senior' }, { id: 'g1', level: 'good' }, { id: 'g2', level: 'good' }, { id: 'n1', level: 'new' }]);
const people = Object.entries(crews).map(([id, c]) => person(id, c, id.startsWith('c') ? 'controller' : 'field_operator', id.startsWith('c') ? 16 : 13));
const ready = () => balance(roster, crews);
const input = (members: SdMember[], over: Partial<PlanCheckInput> = {}): PlanCheckInput => ({
  plan, teams: [day], members, people, absences: [], assignments: [], rules: DEFAULT_RULES, info, plans: [], otherDuties: [],
  otEntries: new Map(members.map((m) => [m.employeeId, { asOf: '2026-10-20', ytd: 100, mtd: 0, verified: true }])),
  sickEntries: new Map(members.map((m) => [m.employeeId, { asOf: '2026-10-20', days: 3 }])), exceptions: [], today: '2026-10-25', ...over });

describe('G1 · two shutdowns in a row', () => {
  const prev = { plan: { ...plan, id: 'prev', title: 'Train-2 SD', start: '2026-09-01', end: '2026-09-30' }, employeeIds: new Set(['s1', 'c1']) };
  const around = adjacent([prev, { plan, employeeIds: new Set() }], plan);
  const ok = sickState({ asOf: '2026-10-20', days: 0 }, '2026-10-25', false);
  it('an FO on the previous shutdown is not eligible, with no exception possible', () => {
    const e = eligibility(plan, info.get('s1'), false, around, ok, [{ planId: 'p', employeeId: 's1', kind: 'consecutive_shutdown', reason: 'x', approvedAt: 'x' }]);
    expect(e).toMatchObject({ ok: false, level: 'blocked' });
  });
  it('a Controller needs the Section Head exception, and is eligible with it', () => {
    expect(eligibility(plan, info.get('c1'), true, around, ok, [])).toMatchObject({ ok: false, level: 'needs_exception' });
    const ex: SdException[] = [{ planId: 'p', employeeId: 'c1', kind: 'consecutive_shutdown', reason: 'Only Grade 16 free', approvedAt: '2026-10-20' }];
    expect(eligibility(plan, info.get('c1'), true, around, ok, ex)).toMatchObject({ ok: true, level: 'ok' });
  });
  it('the order follows the start dates', () => {
    const later = { plan: { ...plan, id: 'n', start: '2027-01-10', end: '2027-01-30' }, employeeIds: new Set<string>() };
    expect(adjacent([later, prev, { plan, employeeIds: new Set() }], plan)).toMatchObject({ prev: { plan: { id: 'prev' } }, next: { plan: { id: 'n' } } });
  });
});

describe('G2 · sick leave in the rolling 12 months', () => {
  it('30 days: warning; 36: excluded; 36 with an exception: eligible; unknown: verification needed, never zero; older than 45 days: outdated', () => {
    expect(sickState({ asOf: '2026-10-01', days: 30 }, '2026-10-20', false).state).toBe('warn');
    expect(sickState({ asOf: '2026-10-01', days: 21 }, '2026-10-20', false).state).toBe('ok');
    expect(sickState({ asOf: '2026-10-01', days: 36 }, '2026-10-20', false).state).toBe('excluded');
    expect(sickState({ asOf: '2026-10-01', days: 36 }, '2026-10-20', true).state).toBe('excepted');
    expect(sickState(null, '2026-10-20', false)).toMatchObject({ state: 'verify', days: null });
    expect(sickState({ asOf: '2026-08-01', days: 2 }, '2026-10-20', false).state).toBe('outdated');
  });
  it('an unconfirmed figure blocks approval but not picking', () => {
    const c = checkPlan(input(ready(), { sickEntries: new Map() }));
    expect(c.status).toBe('verify');
    expect(c.issues.filter((i) => i.level === 'block')).toEqual([]);
  });
});

describe('G3 · same crew allowed, with the fewest transfers to cover', () => {
  it('two Senior FOs of crew A share their rest days: the planner covers them (never both days of a pair); a transfer also fixes it', () => {
    const list = balance(roster, { ...crews, s2: 'A' });
    const gaps = coverageGaps(plan, [day], list, info, () => false).filter((g) => g.role === 'senior');
    expect(gaps).toEqual([]);
    for (const m of list.filter((x) => x.slot === 'senior')) expect(restDayPairs(plan, m, person(m.employeeId, 'A')).pairs).toEqual([]);
    // the Field Operators are planned together (an Experienced may stand in for a Good): a crew instruction, when one is
    // suggested for them, still leaves no gap
    const s = suggestFollow(plan, [day], roster, [], (m) => ({ ...crews, s2: 'A' } as Record<string, Crew>)[m.employeeId]);
    const change = s.find((g) => g.key === 'fo');
    if (change?.changes.length) {
      const fixed = balance(roster.map((m) => (m.id === change.changes[0].memberId ? { ...m, followCrew: change.changes[0].to } : m)), { ...crews, s2: 'A', [change.changes[0].memberId]: change.changes[0].to });
      expect(coverageGaps(plan, [day], fixed, info, () => false)).toEqual([]);
    }
  });
});

describe('G4 / G5 · 12-hour coverage by the clock', () => {
  it('a complete team covers every moment; the Assistant covers alone when the Primary is off', () => {
    const list = ready();
    expect(coverageGaps(plan, [day], list, info, () => false)).toEqual([]);
    const primaryOff = dates.find((d) => !list[0].days![d]?.works && list[1].days![d]?.works)!;
    expect(primaryOff).toBeDefined();
    expect(coverageGaps(plan, [day], list, info, () => false).filter((g) => g.date === primaryOff && g.role === 'controller')).toEqual([]);
  });
  it('an 8-hour Senior alone leaves 15:00–19:00 uncovered', () => {
    const list = ready().map((m) => (m.slot === 'senior' ? { ...m, days: Object.fromEntries(dates.map((d) => [d, { works: m.id === 's1', hours: 8 }])) } : m));
    const g = coverageGaps(plan, [day], list, info, () => false).filter((x) => x.role === 'senior');
    expect(g[0]).toMatchObject({ from: '15:00', to: '19:00', hours: 4 });
    expect(g).toHaveLength(dates.length);
  });
  it('an operator without a level never counts as a Senior or Good FO', () => {
    const list = ready().map((m) => (m.slot === 'senior' ? { ...m, slot: 'member' as const } : m));
    expect(coverageGaps(plan, [day], list, info, () => false).some((g) => g.role === 'senior')).toBe(true);
  });
  it('night shifts are checked 19:00–07:00 across midnight', () => {
    const list = balance(roster.map((m) => ({ ...m, teamId: 'night' })), crews, night).map((m) => (m.slot === 'good' ? { ...m, days: Object.fromEntries(dates.map((d) => [d, { works: m.id === 'g1', hours: 8 }])) } : m));
    expect(coverageGaps(plan, [night], list, info, () => false).find((x) => x.role === 'good')).toMatchObject({ from: '03:00', to: '07:00' });
  });
});

describe('G6 · New FO is a training place', () => {
  it('no New FO: an information notice, and the plan is still ready', () => {
    const c = checkPlan(input(ready().filter((m) => m.slot !== 'new')));
    expect(c.issues.find((i) => i.code === 'new_fo')?.level).toBe('info');
    expect(c.status).toBe('ready');
  });
});

describe('G7 / G8 · overtime limits, months and the month-end split', () => {
  const duty = (date: string, ot: number) => ({ date, hours: 12, regular: 8, ot, crew: 'A' as Crew, restDay: ot === 12, parts: [{ month: date.slice(0, 7), hours: ot }], split: false });
  const entry = (mtd: number, ytd = 0) => ({ asOf: '2026-11-01', ytd, mtd, verified: true });
  it('73–80 h in a month warns, 81 h is blocked; 441 h in a year is blocked', () => {
    expect(personOvertime(plan, 'x', [duty('2026-11-05', 12)], entry(61), []).months[0].state).toBe('warn');   // 73
    expect(personOvertime(plan, 'x', [duty('2026-11-05', 12)], entry(68), []).months[0].state).toBe('warn');   // 80
    expect(personOvertime(plan, 'x', [duty('2026-11-05', 12)], entry(69), []).months[0].state).toBe('over');   // 81
    expect(personOvertime(plan, 'x', [duty('2026-11-05', 12)], entry(0, 429), []).years[0].state).toBe('over'); // 441
    expect(personOvertime(plan, 'x', [duty('2026-11-05', 12)], entry(0, 428), []).years[0].state).toBe('warn'); // 440
  });
  it('no entry: unknown, never zero; other shutdowns count once, only after the entry date', () => {
    expect(personOvertime(plan, 'x', [duty('2026-11-05', 4)], null, []).months[0]).toMatchObject({ prev: null, state: 'unknown' });
    const other = [{ employeeId: 'x', date: '2026-10-30', parts: [{ month: '2026-10', hours: 12 }] }, { employeeId: 'x', date: '2026-11-20', parts: [{ month: '2026-11', hours: 12 }] }];
    const o = personOvertime(plan, 'x', [duty('2026-11-05', 4)], { asOf: '2026-11-01', ytd: 100, mtd: 0, verified: true }, other);
    expect(o.months[0]).toMatchObject({ other: 12, total: 16 });
    expect(o.years[0]).toMatchObject({ prev: 100, other: 12, total: 116 });
  });
  it('a night duty from 31 Oct 19:00 gives each month its share of the overtime (5/12 and 7/12)', () => {
    const start = Date.UTC(2026, 9, 31, 16);   // 19:00 Kuwait
    expect(allocateOvertime('2026-10-31', start, 12, 12)).toEqual({ parts: [{ month: '2026-10', hours: 5 }, { month: '2026-11', hours: 7 }], split: true });
    const a = allocateOvertime('2026-10-31', start, 12, 4);
    expect(a.parts.map((x) => Math.round(x.hours * 100) / 100)).toEqual([1.67, 2.33]);
    expect(allocateOvertime('2026-10-30', start - 864e5, 12, 4).split).toBe(false);
  });
  it('a shutdown over two months: separate monthly totals, one yearly total', () => {
    const two: SdPlan = { ...plan, start: '2026-10-20', end: '2026-11-10' };
    const m = { ...member('s1', 'senior'), start: two.start, end: two.end, offset: 0 };
    const o = personOvertime(two, 's1', memberOvertime(two, day, m, person('s1', 'A')), { asOf: '2026-10-10', ytd: 50, mtd: 10, verified: true }, []);
    expect(o.months.map((x) => x.key)).toEqual(['2026-10', '2026-11']);
    expect(o.years).toHaveLength(1);
    expect(o.years[0].total).toBeCloseTo(50 + o.months[0].plan + o.months[1].plan, 5);
  });
});

describe('G9 · shutdown overtime: 4 h per 12 h duty, the crew roster only for the transitions', () => {
  it('every 12 h duty = 4 h, a crew transfer changes nothing; the months add up', () => {
    const p: MpPerson = { ...person('x', 'A', 'field_operator', 13, false), moves: [{ start: '2026-11-10', end: '2026-11-30', crew: 'B', kind: 'temporary' }] };
    expect(effectiveCrew(p, null, '2026-11-12')).toBe('B');
    const m = { ...member('x', 'senior'), days: Object.fromEntries(dates.map((d) => [d, { works: true, hours: 12 }])) };
    const r = memberOtDetail(plan, day, m, p);
    expect(r.duties.every((d) => d.ot === 4)).toBe(true);
    expect(r.total).toBe(4 * dates.length);
    expect(Object.values(r.months).reduce((t, h) => t + h, 0)).toBeCloseTo(r.total, 5);
  });
});

describe('G10 · roster rest-day pairs (reported by restDayPairs, never a limit on the shutdown rotation)', () => {
  it('finds the pairs; the plan check does not block them', () => {
    const rest = dates.filter((d) => !isWorkingDay(d, 'A'));
    const pairFirst = rest.find((d) => rest.includes(addDaysIso(d, 1)))!;
    const one = { ...member('x', 'senior'), days: Object.fromEntries(dates.map((d) => [d, { works: d === pairFirst || isWorkingDay(d, 'A'), hours: 12 }])) };
    expect(restDayPairs(plan, one, person('x', 'A'))).toMatchObject({ pairs: [], single: [pairFirst] });
    const both = { ...one, days: { ...one.days, [addDaysIso(pairFirst, 1)]: { works: true, hours: 12 } } };
    expect(restDayPairs(plan, both, person('x', 'A')).pairs).toEqual([[pairFirst, addDaysIso(pairFirst, 1)]]);
  });
});

describe('G11 / G12 · seventh day and the Morning ↔ Night change', () => {
  const line = (date: string, code: DayLine['duty']['code'], startH: number, hours = 8): DayLine => {
    const start = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8)), startH - 3);
    return { date, duty: { code, start, end: start + hours * 3600_000 }, absence: null, works: true, other: [] };
  };
  it('the 7th day in a row is a hard stop across a crew change, a shutdown duty and month-end', () => {
    const ls = ['2026-10-28', '2026-10-29', '2026-10-30'].map((d) => line(d, 'M', 7)).concat(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'].map((d) => line(d, 'SD-D', 7, 12)));
    expect(checkSchedule(ls, DEFAULT_RULES).find((f) => f.rule === 'max_consecutive_duty_days')).toMatchObject({ date: '2026-11-03', severity: 'hard_stop' });
  });
  it('Night then Morning within 24 h is a hard stop, either way; the same kind back to back is not', () => {
    const n2m = [line('2026-11-01', 'N', 23), line('2026-11-03', 'M', 7)];                        // N ends 07:00 2 Nov, M 07:00 3 Nov: 24 h — allowed
    const n2mShort = [line('2026-11-01', 'N', 23), line('2026-11-02', 'SD-D', 19, 12)];          // N ends 07:00 2 Nov, a 19:00 day-team duty: 12 h
    const m2n = [line('2026-11-01', 'SD-D', 7, 12), line('2026-11-02', 'N', 23)];                 // ends 19:00, N 23:00 next day: 28 h — allowed
    const m2nShort = [line('2026-11-01', 'M', 7), line('2026-11-01', 'N', 23)];                   // M ends 15:00, N 23:00: 8 h
    const mm = [line('2026-11-01', 'SD-D', 7, 12), line('2026-11-02', 'SD-D', 7, 12)];            // 12 h, same kind
    const rule = (ls: DayLine[]) => checkSchedule(ls, DEFAULT_RULES).filter((f) => f.rule === 'shift_type_change_rest');
    expect(rule(n2m)).toEqual([]);
    expect(rule(n2mShort)).toHaveLength(1);
    expect(rule(m2n)).toEqual([]);
    expect(rule(m2nShort)).toHaveLength(1);
    expect(rule(mm)).toEqual([]);
  });
});

describe('G13 · joining and returning', () => {
  it('a night-team member returning to a Morning duty gets the days off the 24 h rule needs, and rejoins safely', () => {
    const p = person('x', 'A');
    const m = balance([{ ...member('x', 'senior', 'night') }], { x: 'A' }, night)[0];
    const sd = (_emp: string, date: string) => (m.days?.[date]?.works ? { code: 'SD-N' as const, start: '19:00', hours: m.days[date].hours ?? 12 } : null);
    const t = transitions(p, m, sd, [], [], DEFAULT_RULES);
    expect(t.findings).toEqual([]);
    expect(t.returnOn).not.toBeNull();
    const lines = personDays(p, addDaysIso(m.end, -3), addDaysIso(m.end, 10), { absences: [], assignments: [], sdDuty: sd });
    const firstBack = lines.find((l) => l.date > m.end && l.works && !t.returnOff.includes(l.date));
    expect(firstBack?.date).toBe(t.returnOn);
  });
});

describe('G14 / G15 · balancing without extra overtime; the reduced days', () => {
  it('final rules: 12-hour duties preferred, each person kept within the 72 h monthly target; the minimum on the full shift every day', () => {
    const list = ready();
    const c = checkPlan(input(list));
    expect(c.gaps).toEqual([]);
    for (const o of c.overtime) expect(o.months.every((x) => x.plan <= 72)).toBe(true);
    for (const d of dates) {
      const full = (f: (m: SdMember) => boolean) => list.filter((m) => f(m) && m.days![d]?.works && m.days![d].hours === 12);
      expect(full((m) => m.slot === 'controller').length).toBeGreaterThanOrEqual(1);
      const fos = full((m) => m.slot === 'senior' || m.slot === 'good');
      expect(fos.length).toBeGreaterThanOrEqual(2);
      expect(fos.some((m) => info.get(m.employeeId)?.foLevel === 'senior')).toBe(true);
    }
    // more 12-hour duties than the bare minimum where the target allows
    const twelve = list.flatMap((m) => Object.values(m.days!)).filter((x) => x.works && x.hours === 12).length;
    expect(twelve).toBeGreaterThan(dates.length * 3);
  });
  it('the first and last two days: the minimum is a floor, not the target (the others on their pattern stay on), all on 12 h', () => {
    const list = ready();
    for (const d of [dates[0], dates[1], dates[dates.length - 2], dates[dates.length - 1]]) {
      const on = list.filter((m) => m.days![d]?.works);
      expect(on.filter((m) => m.slot === 'controller').length).toBeGreaterThanOrEqual(1);
      const fos = on.filter((m) => m.slot === 'senior' || m.slot === 'good');
      expect(fos.length).toBeGreaterThanOrEqual(2);
      expect(fos.some((m) => info.get(m.employeeId)?.foLevel === 'senior')).toBe(true);
      expect(on.filter((m) => m.slot !== 'new' && m.days![d].hours === 12).length).toBeGreaterThanOrEqual(3);
      expect(on.filter((m) => m.slot === 'new').every((m) => m.days![d].hours === 12)).toBe(true);
    }
    // more than the minimum somewhere on the reduced days, and nobody above the 72 h target for it
    expect([dates[0], dates[1], dates[dates.length - 2], dates[dates.length - 1]].some((d) => list.filter((m) => m.days![d]?.works).length > 3)).toBe(true);
    for (const m of list) expect(memberOtDetail(plan, day, m, person(m.employeeId, crews[m.employeeId])).months['2026-11'] ?? 0).toBeLessThanOrEqual(plan.maxOvertime);
  });
  it('the run limit is 6 days in a row', () => { expect(V2_MAX_RUN).toBe(6); });
  it('the full check of a complete, verified team is Ready, with the overtime spread shown', () => {
    const c = checkPlan(input(ready()));
    expect(c.issues.filter((i) => i.level === 'block' || i.level === 'verify')).toEqual([]);
    expect(c.status).toBe('ready');
    expect(c.spread.diff).toBeGreaterThanOrEqual(0);
  });
  it('the approval fingerprint changes when the plan data changes', () => {
    const a = checkPlan(input(ready())).fingerprint;
    const b = checkPlan(input(ready().map((m, i) => (i === 0 ? { ...m, controllerRole: 'assistant' as const } : m)))).fingerprint;
    expect(a).not.toBe(b);
    expect(checkPlan(input(ready())).fingerprint).toBe(a);
  });
});

describe('New FO is extra and still earns overtime', () => {
  it('tops the New FO up to the monthly cap without changing the other slots', () => {
    const out = ready();
    const otOf = (id: string) => { const m = out.find((x) => x.id === id)!; return memberOtDetail(plan, day, m, person(m.employeeId, crews[m.employeeId])).total; };
    // topped up towards the cap, within the full-shift fatigue limit (4 days in a row on the day team)
    expect(otOf("n1")).toBeGreaterThanOrEqual(48);
    expect(otOf('n1')).toBeLessThanOrEqual(plan.maxOvertime);
    const without = balance(roster.filter((m) => m.slot !== 'new'), crews);
    for (const id of ['c1', 'c2', 's1', 's2', 'g1', 'g2']) expect(out.find((x) => x.id === id)!.days).toEqual(without.find((x) => x.id === id)!.days);
  });
});

describe('3 on / 1 off for part of a train shutdown', () => {
  it('works the cycle up to cycleUntil, then the own crew days, within the overtime limits', () => {
    const p: SdPlan = { ...plan, cycleUntil: '2026-11-14' };
    const out = roster.map((m) => ({ ...m, days: {} as NonNullable<SdMember['days']> }));
    for (const g of spreadGroups(p, day, out, [])) {
      if (!g.memberIds.length) continue;
      const r = spreadGroup(p, g, out, { crewOf: (id) => crews[id] ?? null, away: () => false, maxRun: 6, v2: true });
      for (const m of out) { const d = r.days.get(m.id); if (!d) continue; for (const [date, w] of Object.entries(d)) m.days![date] = { works: w, hours: w ? r.hours.get(m.id)?.[date] ?? null : null }; }
    }
    const inPhase = dates.filter((d) => d <= p.cycleUntil!);
    for (const m of out) {
      // the cycle: never more than 3 days on in a row before cycleUntil (the reduced days aside)
      let run = 0, worst = 0;
      for (const d of inPhase) { run = m.days![d]?.works ? run + 1 : 0; worst = Math.max(worst, run); }
      expect(worst).toBeLessThanOrEqual(3);
      // after it: only the own crew's duty days
      for (const d of dates.filter((x) => x > p.cycleUntil!)) if (m.days![d]?.works) expect(isWorkingDay(d, crews[m.employeeId])).toBe(true);
    }
    const c = checkPlan({ ...input(out), plan: p });
    expect(c.issues.filter((i) => i.code === 'ot_month_hard' || i.code === 'rest_day_pair').map((i) => i.message)).toEqual([]);
  });
});
