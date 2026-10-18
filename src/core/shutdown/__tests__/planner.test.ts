import { describe, expect, it } from 'vitest';
import type { Crew } from '../../roster';
import type { MpAbsence, MpPerson } from '../../manpower';
import { DEFAULT_RULES } from '../../validation';
import { planDates, type SdMember, type SdPlan, type SdTeam } from '..';
import { spreadGroups, spreadGroup } from '../spread';
import { checkPlan, memberOtDetail, plannerContext, type PersonInfo, type PlanCheckInput } from '../v2';

// The real Train-2 team (crews and levels from the database, names replaced), moved to 20 Oct – 20 Nov 2026.
type Row = { id: string; team: 'D' | 'N'; slot: SdMember['slot']; crew: Crew | null; role: MpPerson['role']; level: PersonInfo['foLevel']; follow?: Crew };
const TEAM: Row[] = [
  { id: 'd-ctl-a', team: 'D', slot: 'controller', crew: 'A', role: 'controller', level: null },
  { id: 'd-ctl-c', team: 'D', slot: 'controller', crew: 'C', role: 'controller', level: null },
  { id: 'd-good-a', team: 'D', slot: 'good', crew: 'A', role: 'field_operator', level: 'good' },
  { id: 'd-good-d', team: 'D', slot: 'good', crew: 'D', role: 'field_operator', level: 'good' },
  { id: 'd-new-c', team: 'D', slot: 'new', crew: 'C', role: 'field_operator', level: 'new' },
  { id: 'd-sen-c1', team: 'D', slot: 'senior', crew: 'C', role: 'field_operator', level: 'senior' },
  { id: 'd-sen-c2', team: 'D', slot: 'senior', crew: 'C', role: 'field_operator', level: 'senior', follow: 'D' },
  { id: 'n-ctl-day', team: 'N', slot: 'controller', crew: null, role: 'vr_controller', level: null },
  { id: 'n-ctl-b', team: 'N', slot: 'controller', crew: 'B', role: 'controller', level: null },
  { id: 'n-good-c', team: 'N', slot: 'good', crew: 'C', role: 'field_operator', level: 'good' },
  { id: 'n-good-a', team: 'N', slot: 'good', crew: 'A', role: 'field_operator', level: 'good' },
  { id: 'n-new-b', team: 'N', slot: 'new', crew: 'B', role: 'field_operator', level: 'good' },
  { id: 'n-sen-c', team: 'N', slot: 'senior', crew: 'C', role: 'field_operator', level: 'senior' },
  { id: 'n-sen-a', team: 'N', slot: 'senior', crew: 'A', role: 'panel_operator', level: 'senior' },
];
const needs = { controller: 1, senior: 1, good: 1, new: 0 };
const basePlan: SdPlan = { id: 'p', title: 'Train-2 SD', kind: 'train', areas: [], sections: [], start: '2026-10-20', end: '2026-11-20', eventId: null,
  daysOn: 3, daysOff: 1, shiftHours: 12, rampDays: 2, rampHours: 12, normalHours: 8, maxOvertime: 72, maxOvertimeYear: 380, maxOvertimeHard: 80, maxOvertimeYearHard: 440, rulesVersion: 2, cycleUntil: '2026-11-20' };
const teams = (p: SdPlan): SdTeam[] => [
  { id: 'D', planId: p.id, name: 'Day', sort: 0, needs, rampNeeds: needs, shiftCode: 'M', hoursLabel: '07:00 - 19:00' },
  { id: 'N', planId: p.id, name: 'Night', sort: 1, shiftCode: 'N', needs, rampNeeds: needs, hoursLabel: '19:00 - 07:00' },
];
const person = (r: Row, p: SdPlan): MpPerson => ({ id: r.id, employeeNumber: r.id, name: r.id, role: r.role, crew: r.crew, grade: (r.role ?? '').includes('controller') ? 16 : 13, employmentType: 'knpc', takeCharge: null, panelQualified: null, actingController: null,
  moves: [{ start: p.start, end: p.end, crew: 'SD', kind: 'sd' }] });
const info = (rows: Row[]) => new Map(rows.map((r) => [r.id, { id: r.id, name: r.id, position: r.role, grade: (r.role ?? '').includes('controller') ? 16 : 13, foLevel: r.level } as PersonInfo]));

function input(p: SdPlan, rows: Row[], extra: Partial<PlanCheckInput> = {}): PlanCheckInput {
  const members: SdMember[] = rows.map((r) => ({ id: r.id, planId: p.id, teamId: r.team, employeeId: r.id, slot: r.slot, offset: 0, start: p.start, end: p.end, followCrew: r.follow ?? null,
    controllerRole: r.slot === 'controller' ? (r.id.endsWith('-a') || r.id.endsWith('-day') ? 'primary' : 'assistant') : null, days: {} }));
  return { plan: p, teams: teams(p), members, people: rows.map((r) => person(r, p)), absences: [], assignments: [], rules: DEFAULT_RULES, info: info(rows), plans: [], otherDuties: [],
    otEntries: new Map(rows.map((r) => [r.id, { asOf: '2026-10-10', ytd: 100, mtd: 0, verified: true }])), sickEntries: new Map(rows.map((r) => [r.id, { asOf: '2026-10-10', days: 2 }])), exceptions: [], today: '2026-10-14', ...extra };
}
/** Runs the planner on every place, the way the plan page does, and returns the input with the planned days. */
function plan(inp: PlanCheckInput): PlanCheckInput {
  const ctx = plannerContext(inp);
  const out = inp.members.map((m) => ({ ...m, days: {} as NonNullable<SdMember['days']> }));
  for (const t of inp.teams) for (const g of spreadGroups(inp.plan, t, out.filter((m) => m.teamId === t.id), [])) {
    if (!g.memberIds.length) continue;
    const r = spreadGroup(inp.plan, g, out, { crewOf: ctx.crewOf, away: ctx.away, maxRun: 6, v2: true, transitionCost: ctx.transitionCost, monthTaken: ctx.monthTaken, crewOn: ctx.crewOn, levelOf: ctx.levelOf });
    for (const m of out) { const d = r.days.get(m.id); if (!d) continue; for (const [date, w] of Object.entries(d)) m.days![date] = { works: w, hours: w ? r.hours.get(m.id)?.[date] ?? null : null }; }
  }
  return { ...inp, members: out };
}
// a rest day before joining that leaves the crew without its Controller asks for a crew cover (Controller Management): the
// test teams have no other Controller on the crews, so that finding is checked on its own (cycleUntil case, transfer tests)
const blocks = (c: ReturnType<typeof checkPlan>) => c.issues.filter((i) => i.level === 'block' && i.code !== 'rest_cover').map((i) => `${i.code}: ${i.message}`);
const maxRun = (m: SdMember, p: SdPlan) => { let run = 0, worst = 0; for (const d of planDates(p)) { run = m.days?.[d]?.works ? run + 1 : 0; worst = Math.max(worst, run); } return worst; };

describe('planner · the real Train-2 team, 20 Oct – 20 Nov, 3 on / 1 off', () => {
  const inp = plan(input(basePlan, TEAM));
  const c = checkPlan(inp);
  it('passes every hard rule of the plan check: coverage, rest, 6 days, rest-day pairs, overtime limits', () => {
    expect(blocks(c)).toEqual([]);
    expect(c.gaps).toEqual([]);
  });
  it('keeps everyone at or below the 72 h monthly target, October and November counted apart', () => {
    for (const o of c.overtime) for (const mo of o.months) expect(mo.plan).toBeLessThanOrEqual(72);
    expect(new Set(c.overtime.flatMap((o) => o.months.map((m) => m.key)))).toEqual(new Set(['2026-10', '2026-11']));
  });
  it('a regular pattern: never more than 3 days in a row; 12 h preferred, 8 h only for qualified people; New FOs always 12 h', () => {
    for (const m of inp.members) expect(maxRun(m, basePlan)).toBeLessThanOrEqual(3);
    const hours = inp.members.flatMap((m) => Object.values(m.days ?? {}).filter((d) => d.works).map((d) => d.hours));
    expect(hours.every((h) => h === 12 || h === 8)).toBe(true);
    expect(hours.filter((h) => h === 12).length).toBeGreaterThan(hours.filter((h) => h === 8).length);
    for (const m of inp.members.filter((x) => x.slot === 'new')) expect(Object.values(m.days ?? {}).filter((d) => d.works).every((d) => d.hours === 12)).toBe(true);
  });
  it('one overtime engine: the check, the per-member detail and the months all agree (nothing counted twice)', () => {
    const t = new Map(inp.teams.map((x) => [x.id, x]));
    for (const m of inp.members) {
      const d = memberOtDetail(inp.plan, t.get(m.teamId)!, m, inp.people.find((p) => p.id === m.employeeId));
      const o = c.overtime.find((x) => x.employeeId === m.employeeId)!;
      expect(o.plan).toBeCloseTo(d.total, 2);
      expect(o.months.reduce((s, x) => s + x.plan, 0)).toBeCloseTo(d.total, 2);
      expect(d.cycles.reduce((s, x) => s + x.overtime, 0)).toBeCloseTo(d.total, 2);
    }
  });
  it('overtime is fair inside each group (lowest priority after 12 h duties and the target): within three 12 h duties, every month within 72 h', () => {
    for (const group of [['controller'], ['senior', 'good']]) for (const team of ['D', 'N']) {
      const ids = inp.members.filter((m) => group.includes(m.slot) && m.teamId === team).map((m) => m.employeeId);
      const tot = ids.map((id) => c.overtime.find((o) => o.employeeId === id)!.plan);
      expect(Math.max(...tot) - Math.min(...tot)).toBeLessThanOrEqual(36);
      for (const id of ids) for (const mo of c.overtime.find((o) => o.employeeId === id)!.months) expect(mo.plan).toBeLessThanOrEqual(72);
    }
  });
});

describe('planner · scenarios', () => {
  it('own-crew days after the first two weeks (cycleUntil)', () => {
    const p = { ...basePlan, cycleUntil: '2026-11-02' };
    const inp = plan(input(p, TEAM));
    const c = checkPlan(inp);
    // the A Controller needs 19 Oct off before joining, and he is A Shift's only Controller: it blocks until a cover is recorded
    expect(c.issues.filter((i) => i.level === 'block' && i.code !== 'coverage' && i.employeeId === 'd-ctl-a').map((i) => `${i.code} ${i.employeeId} ${i.date}`)).toEqual(['rest_cover d-ctl-a 2026-10-19']);
    expect(c.issues.filter((i) => i.level === 'block' && i.code !== 'coverage').every((i) => i.code === 'rest_cover')).toBe(true);
    for (const o of c.overtime) for (const mo of o.months) expect(mo.total).toBeLessThanOrEqual(80);
    // a VR Controller recorded on A Shift that day: the crew keeps its Controller, the rest day stands
    const vr = { ...person({ id: 'vr', team: 'D', slot: 'controller', crew: null, role: 'vr_controller', level: null }, p), moves: [] };
    const covered = checkPlan({ ...inp, people: [...inp.people, vr], assignments: [{ id: 'cv', kind: 'shift_cover', employeeId: 'vr', crew: 'A', start: '2026-10-19', end: '2026-10-19', coversEmployeeId: 'd-ctl-a' }] });
    expect(covered.issues.filter((i) => i.level === 'block' && i.code !== 'coverage' && i.employeeId === 'd-ctl-a')).toEqual([]);
    expect(covered.issues.some((i) => i.code === 'join_off' && i.employeeId === 'd-ctl-a')).toBe(true);
    // no cover recorded yet, a free VR Controller on the staff list: the check proposes him (one tap records it)
    const proposed = checkPlan({ ...inp, people: [...inp.people, vr] }).issues.find((i) => i.code === 'rest_cover')!;
    expect(proposed.fix).toMatchObject({ kind: 'cover', employeeId: 'vr', crew: 'A', start: '2026-10-19', coversEmployeeId: 'd-ctl-a' });
    // the shutdown moved two days earlier and the days were not planned again: blocked until they are
    const moved = { ...inp.plan, start: '2026-10-18', end: '2026-11-18' };
    const stale = checkPlan({ ...inp, plan: moved, members: inp.members.map((m) => ({ ...m, start: moved.start, end: moved.end })) });
    expect(stale.issues.filter((i) => i.code === 'days_stale').length).toBe(inp.members.length);
    // recorded as his rest day: no longer worked out, still checked against his crew
    const recorded = checkPlan({ ...inp, members: inp.members.map((m) => (m.id === 'd-ctl-a' ? { ...m, restDays: ['2026-10-19'] } : m)) });
    expect(recorded.transitions.find((t) => t.employeeId === 'd-ctl-a')!.joinOff).toEqual([]);
    expect(recorded.issues.filter((i) => i.level === 'block' && i.code !== 'coverage' && i.employeeId === 'd-ctl-a').map((i) => i.code)).toEqual(['rest_cover']);
  });
  it('approved leave during the shutdown: the person is off, the place is still covered, the leave is credited', () => {
    const leave: MpAbsence = { id: 'l', employeeId: 'd-sen-c1', start: '2026-11-13', end: '2026-11-16', status: 'approved', typeCode: 'annual_leave_planned', inCurrentPlan: true, oracle: 'approved' };
    const inp = plan(input(basePlan, TEAM, { absences: [leave] }));
    const m = inp.members.find((x) => x.id === 'd-sen-c1')!;
    for (const d of ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']) expect(m.days?.[d]?.works).toBe(false);
    const c = checkPlan(inp);
    expect(c.gaps.filter((g) => g.role === 'senior' && g.teamId === 'D')).toEqual([]);
    expect(blocks(c)).toEqual([]);
    const t = inp.teams.find((x) => x.id === 'D')!;
    const d = memberOtDetail(inp.plan, t, m, inp.people.find((p) => p.id === m.employeeId), (x) => x >= leave.start && x <= leave.end);
    expect(d.cycles.reduce((s2, x) => s2 + x.credited, 0)).toBeGreaterThan(0);
  });
  it('a hard leave case (a week across a crew rest-day pair): covered when a legal arrangement exists, else reported, never a broken rule', () => {
    const leave: MpAbsence = { id: 'l', employeeId: 'd-sen-c1', start: '2026-11-03', end: '2026-11-07', status: 'approved', typeCode: 'annual_leave_planned', inCurrentPlan: true, oracle: 'approved' };
    const inp = plan(input(basePlan, TEAM, { absences: [leave] }));
    const c = checkPlan(inp);
    for (const m of inp.members) expect(maxRun(m, basePlan)).toBeLessThanOrEqual(6);
    expect(c.issues.filter((i) => i.code === 'rest_day_pair')).toEqual([]);
    expect(c.issues.filter((i) => i.level === 'block' && i.code !== 'coverage' && i.code !== 'rest_cover')).toEqual([]);
    if (c.gaps.length) { expect(c.status).toBe('not_ready'); expect(c.gaps.every((g) => g.role === 'senior' && g.teamId === 'D')).toBe(true); }
  });
  it('overtime already taken this month (Oracle month to date) lowers what the planner gives the person', () => {
    const plain = checkPlan(plan(input(basePlan, TEAM))).overtime.find((o) => o.employeeId === 'd-good-a')!.months.find((m) => m.key === '2026-11')!.plan;
    const ot = new Map(TEAM.map((r) => [r.id, { asOf: '2026-11-01', ytd: 100, mtd: r.id === 'd-good-a' ? 40 : 0, verified: true }]));
    const c = checkPlan(plan(input(basePlan, TEAM, { otEntries: ot })));
    const nov = c.overtime.find((o) => o.employeeId === 'd-good-a')!.months.find((m) => m.key === '2026-11')!;
    expect(nov.plan).toBeLessThanOrEqual(plain);
    // never silently over the limit: above 80 h the plan check blocks it (another person is needed)
    if (nov.total > 80) expect(c.issues.some((i) => i.level === 'block' && i.code === 'ot_month_hard' && i.employeeId === 'd-good-a')).toBe(true);
  });
  it('too few Field Operators (two for two places every day): never a 7th day; what cannot be covered is reported, Not ready', () => {
    const rows = TEAM.filter((r) => r.id !== 'd-good-d' && r.id !== 'd-good-a');
    const inp = plan(input(basePlan, rows));
    for (const m of inp.members) expect(maxRun(m, basePlan)).toBeLessThanOrEqual(6);
    const c = checkPlan(inp);
    expect(c.gaps.some((g) => g.role === 'good' && g.teamId === 'D')).toBe(true);
    expect(c.status).toBe('not_ready');
  });
  it('three people in a place share the 12 h shifts and stay well inside the target', () => {
    const rows: Row[] = [...TEAM, { id: 'd-good-b', team: 'D', slot: 'good', crew: 'B', role: 'field_operator', level: 'good' }];
    const c = checkPlan(plan(input(basePlan, rows)));
    expect(blocks(c)).toEqual([]);
    const goods = ['d-good-a', 'd-good-d', 'd-good-b'].map((id) => c.overtime.find((o) => o.employeeId === id)!.plan);
    expect(Math.max(...goods)).toBeLessThan(72 * 2);
  });
});

describe('planner · joining and leaving the team (rest rules against the crew duties before and after)', () => {
  it('no Morning ↔ Night change without 24 h off, no 7th day in a row, no zero rest around the shutdown', () => {
    const c = checkPlan(plan(input(basePlan, TEAM)));
    expect(c.transitions.flatMap((t) => t.findings)).toEqual([]);
  });
  it('the start of the pattern is chosen so joining needs as few own-crew days off as possible', () => {
    const inp = input(basePlan, TEAM);
    const withCost = checkPlan(plan(inp));
    const ctx = plannerContext(inp);
    const out = inp.members.map((m) => ({ ...m, days: {} as NonNullable<SdMember['days']> }));
    for (const t of inp.teams) for (const g of spreadGroups(inp.plan, t, out.filter((m) => m.teamId === t.id), [])) {
      if (!g.memberIds.length) continue;
      const r = spreadGroup(inp.plan, g, out, { crewOf: ctx.crewOf, away: ctx.away, maxRun: 6, v2: true, monthTaken: ctx.monthTaken });
      for (const m of out) { const d = r.days.get(m.id); if (!d) continue; for (const [date, w] of Object.entries(d)) m.days![date] = { works: w, hours: w ? r.hours.get(m.id)?.[date] ?? null : null }; }
    }
    const without = checkPlan({ ...inp, members: out });
    const offs = (c: ReturnType<typeof checkPlan>) => c.transitions.reduce((t, x) => t + x.joinOff.length + x.returnOff.length + 5 * x.findings.length, 0);
    expect(offs(withCost)).toBeLessThanOrEqual(offs(without));
  });
});

describe('planner · the final shutdown rules', () => {
  it('Experienced replacing Good: a Day team with three Experienced and no Good is fully covered', () => {
    const rows: Row[] = [...TEAM.filter((r) => !(r.team === 'D' && r.slot === 'good')),
      { id: 'd-sen-b', team: 'D', slot: 'senior', crew: 'B', role: 'field_operator', level: 'senior' }];
    const c = checkPlan(plan(input(basePlan, rows)));
    expect(c.gaps.filter((g) => g.teamId === 'D')).toEqual([]);
    expect(blocks(c)).toEqual([]);
  });
  it('New Field Operators: always 12 h, never counted, within the 72 h target by extra days off', () => {
    const inp = plan(input(basePlan, TEAM));
    const c = checkPlan(inp);
    for (const m of inp.members.filter((x) => x.slot === 'new')) {
      const worked = Object.values(m.days ?? {}).filter((d) => d.works);
      expect(worked.every((d) => d.hours === 12)).toBe(true);
      for (const mo of c.overtime.find((o) => o.employeeId === m.employeeId)!.months) expect(mo.plan).toBeLessThanOrEqual(72);
    }
    expect(c.issues.filter((i) => i.code === 'new_short')).toEqual([]);
    // without the New FOs the minimum still holds: they never count
    const without = { ...inp, members: inp.members.filter((m) => m.slot !== 'new') };
    expect(checkPlan(without).gaps).toEqual([]);
  });
  it('a New FO on a shortened duty is refused by the check', () => {
    const inp = plan(input(basePlan, TEAM));
    const n = inp.members.find((m) => m.slot === 'new')!;
    const d = Object.entries(n.days!).find(([, v]) => v.works)![0];
    n.days![d] = { works: true, hours: 8 };
    expect(checkPlan(inp).issues.some((i) => i.code === 'new_short' && i.level === 'block')).toBe(true);
  });
  it('only the selected team: the planner never uses anybody else, even when a place is short', () => {
    const rows = TEAM.filter((r) => r.id !== 'd-good-d' && r.id !== 'd-good-a');
    const base = input(basePlan, rows);
    // an Experienced FO in the staff list but not on the team
    const outsider: MpPerson = { id: 'outsider', employeeNumber: 'x', name: 'x', role: 'field_operator', crew: 'B', grade: 13, employmentType: 'knpc', takeCharge: null, panelQualified: null, actingController: null };
    const inp = plan({ ...base, people: [...base.people, outsider], info: new Map([...base.info, ['outsider', { id: 'outsider', name: 'x', position: 'field_operator', grade: 13, foLevel: 'senior' }]]) });
    expect(inp.members.map((m) => m.employeeId).sort()).toEqual(rows.map((r) => r.id).sort());
    expect(checkPlan(inp).status).toBe('not_ready');
  });
  it('a qualified person on 8 h only where the rest of the minimum is on the full shift (no 4-hour gap)', () => {
    const inp = plan(input(basePlan, TEAM));
    const eight = inp.members.flatMap((m) => Object.entries(m.days ?? {}).filter(([, d]) => d.works && d.hours === 8).map(([d]) => ({ m, d })));
    for (const { m, d } of eight) {
      const fullFos = inp.members.filter((x) => x.teamId === m.teamId && x !== m && (m.slot === 'controller' ? x.slot === 'controller' : x.slot === 'senior' || x.slot === 'good') && x.days?.[d]?.works && x.days[d].hours === 12);
      expect(fullFos.length).toBeGreaterThanOrEqual(m.slot === 'controller' ? 1 : 2);
    }
    expect(checkPlan(inp).gaps).toEqual([]);
  });
});
