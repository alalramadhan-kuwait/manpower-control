// The working plan: cell edits go through the plan check; a change that makes a new problem stopping the plan is refused.
import { describe, expect, it } from 'vitest';
import type { Crew } from '../../roster';
import type { MpPerson } from '../../manpower';
import { DEFAULT_RULES } from '../../validation';
import { planDates, type SdMember, type SdPlan, type SdTeam } from '..';
import { spreadGroups, spreadGroup } from '../spread';
import { checkPlan, type PersonInfo, type PlanCheckInput } from '../v2';
import { applyEdits, cellOf, daysOf, newHardProblems, suggestions, swapEdits, tryEdits, withDays } from '../workingPlan';

const plan: SdPlan = { id: 'p', title: 'Train-1 SD', kind: 'train', areas: [], sections: [], start: '2026-11-01', end: '2026-11-30', eventId: null,
  daysOn: 3, daysOff: 1, shiftHours: 12, rampDays: 2, rampHours: 12, normalHours: 8, maxOvertime: 72, maxOvertimeYear: 380, maxOvertimeHard: 80, maxOvertimeYearHard: 440, rulesVersion: 2 };
const needs = { controller: 2, senior: 2, good: 2, new: 1 }, reduced = { controller: 1, senior: 1, good: 1, new: 0 };
const day: SdTeam = { id: 'day', planId: 'p', name: 'Morning', sort: 0, needs, rampNeeds: reduced, shiftCode: 'M', hoursLabel: '07:00 - 19:00' };
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


describe('working plan', () => {
  const inp = input(ready());
  const days = daysOf(inp);
  const now = checkPlan(withDays(inp, days));
  const d0 = dates[5];
  const working = (id: string, d: string) => ['W12', 'W8'].includes(cellOf(inp, inp.members.find((m) => m.id === id)!, d, days, {}));
  it('the grid reads the days the plan check reads (no change, no new problem)', () => {
    expect(newHardProblems(now, checkPlan(withDays(inp, daysOf(inp))))).toEqual([]);
  });
  it('a day off that leaves the place without a Controller on duty is refused, with options that pass', () => {
    const c = ['c1', 'c2'].find((id) => working(id, d0) && !working(id === 'c1' ? 'c2' : 'c1', d0));
    expect(c).toBeTruthy();
    const t = tryEdits(inp, days, now, [{ memberId: c!, date: d0, code: 'O' }]);
    expect(t.ok).toBe(false);
    expect(t.problems.some((p) => p.code === 'coverage')).toBe(true);
    for (const s of suggestions(inp, days, now, [{ memberId: c!, date: d0, code: 'O' }], (e) => e)) expect(tryEdits(inp, days, now, s.edits).ok).toBe(true);
  });
  it('7 duty days in a row are refused', () => {
    const id = 'g1';
    const run = dates.slice(0, 8).map((date) => ({ memberId: id, date, code: 'W12' as const }));
    const t = tryEdits(inp, days, now, run);
    expect(t.ok).toBe(false);
  });
  it('a change that keeps every rule is applied; Unavailable counts as a day off', () => {
    const id = 'n1';
    const d = dates.find((x) => working(id, x))!;
    const t = tryEdits(inp, days, now, [{ memberId: id, date: d, code: 'U' }]);
    expect(t.ok).toBe(true);
    expect(t.days[id][d]).toEqual({ works: false, hours: null });
  });
  it('approved leave is never painted over', () => {
    const away = { ...inp, absences: [{ id: 'l1', employeeId: 's1', start: dates[0], end: dates[6], status: 'approved' as const, oracle: 'approved' as const, inCurrentPlan: true, typeCode: 'annual_leave_planned', typeShort: 'PV' }] };
    const dd = daysOf(away);
    expect(cellOf(away, away.members.find((m) => m.id === 's1')!, dates[2], dd, {})).toBe('L');
    expect(applyEdits(away, dd, [{ memberId: 's1', date: dates[2], code: 'W12' }])).toEqual(dd);
  });
  it('a swap exchanges two cells as one change', () => {
    const d = dates.find((x) => working('g1', x) && !working('g2', x))!;
    const e = swapEdits(inp, days, {}, { memberId: 'g1', date: d }, { memberId: 'g2', date: d });
    expect(e?.map((x) => x.code).sort()).toEqual(['O', cellOf(inp, inp.members.find((m) => m.id === 'g1')!, d, days, {})].sort());
  });
});

describe('a move to the other team during the shutdown (two places of one person, one after the other)', () => {
  const whole = ready();
  const g1 = whole.find((m) => m.id === 'g1')!;
  const mid = dates[15];
  const first: SdMember = { ...g1, end: dates[14], days: Object.fromEntries(Object.entries(g1.days ?? {}).filter(([d]) => d < mid)) };
  const second: SdMember = { ...g1, id: 'g1b', start: mid, days: Object.fromEntries(Object.entries(g1.days ?? {}).filter(([d]) => d >= mid)) };
  const split = [...whole.filter((m) => m.id !== 'g1'), first, second];
  const about = (c: ReturnType<typeof checkPlan>) => c.issues.filter((i) => i.employeeId === 'g1').map((i) => `${i.level}|${i.code}|${i.date ?? ''}`).sort();
  it('is checked like one place: no joining or returning between the two, nothing new that stops the plan', () => {
    const a = checkPlan(input(whole)), b = checkPlan(input(split));
    expect(about(b)).toEqual(about(a));
    expect(newHardProblems(a, b)).toEqual([]);
    expect(b.overtime.find((o) => o.employeeId === 'g1')?.months).toEqual(a.overtime.find((o) => o.employeeId === 'g1')?.months);
  });
});

describe('a Good FO in the New FO place', () => {
  const list = ready().map((m) => (m.id === 'n1' ? m : m));
  const goodInfo = new Map(info); goodInfo.set('n1', { ...goodInfo.get('n1')!, foLevel: 'good' });
  const earlier = { ...plan, id: 'old', start: '2025-04-01', end: '2025-05-01' };
  it('on his first shutdown is a trainee (no warning)', () => {
    const c = checkPlan(input(list, { info: goodInfo }));
    expect(c.issues.some((i) => i.code === 'new_place_level')).toBe(false);
    expect(c.issues.some((i) => i.code === 'new_first' && i.level === 'info')).toBe(true);
  });
  it('after an earlier shutdown is asked to move to a Good place', () => {
    const c = checkPlan(input(list, { info: goodInfo, plans: [{ plan: earlier, employeeIds: new Set(['n1']) }] }));
    expect(c.issues.some((i) => i.code === 'new_place_level' && i.level === 'warn')).toBe(true);
  });
});
