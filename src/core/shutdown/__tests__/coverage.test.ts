import { describe, expect, it } from 'vitest';
import { planDates, type SdMember, type SdPhase, type SdPlan, type SdTeam } from '..';
import { coverageGaps, type PersonInfo } from '../v2';

// Coverage by the clock: at every moment of each team shift, at least the place's minimum on duty. An 8-hour duty
// (07:00–15:00 / 19:00–03:00) counts only for its own hours.
const train: SdPlan = { id: 'p', title: 'T', kind: 'train', areas: [], sections: [], start: '2026-11-01', end: '2026-11-03', eventId: null,
  daysOn: 3, daysOff: 1, shiftHours: 12, rampDays: 0, rampHours: 12, normalHours: 8, maxOvertime: 72, maxOvertimeHard: 80, rulesVersion: 2 };
const one = { controller: 1, senior: 1, good: 1, new: 0 };
const day: SdTeam = { id: 'D', planId: 'p', name: 'Day', sort: 0, needs: one, rampNeeds: one, shiftCode: 'M', hoursLabel: '07:00 - 19:00' };
const night: SdTeam = { ...day, id: 'N', name: 'Night', shiftCode: 'N', hoursLabel: '19:00 - 07:00' };
const dates = planDates(train);
const m = (id: string, team: string, slot: SdMember['slot'], hours: (d: string) => number | null): SdMember => ({ id, planId: 'p', teamId: team, employeeId: id, slot, offset: 0, start: train.start, end: train.end,
  days: Object.fromEntries(dates.map((d) => { const h = hours(d); return [d, { works: h !== null, hours: h }]; })) });
const info = (ids: [string, PersonInfo['foLevel'], string?][]) => new Map(ids.map(([id, lvl, pos]) => [id, { id, name: id, position: pos ?? 'field_operator', grade: pos ? 16 : 13, foLevel: lvl } as PersonInfo]));
const nobodyAway = () => false;
const I = info([['c', null, 'controller'], ['e1', 'senior'], ['e2', 'senior'], ['g1', 'good'], ['g2', 'good'], ['n1', 'new'], ['n2', 'good']]);
/** The minimum on the Day team, every day of the plan, for a set of people (all on 12 h unless said). */
const day12 = (...ids: [string, SdMember['slot'], number?][]) => ids.map(([id, slot, h]) => m(id, 'D', slot, () => h ?? 12));
const short = (team: SdMember[]) => coverageGaps(train, [day], team, I, nobodyAway);

describe('the final shutdown minimum, every minute of the 12-hour shift: 1 Controller, 1 Experienced, 2 different Experienced/Good FOs', () => {
  it('valid: 1 Controller + 1 Experienced + 1 Good', () => {
    expect(short(day12(['c', 'controller'], ['e1', 'senior'], ['g1', 'good']))).toEqual([]);
  });
  it('valid: 1 Controller + 2 Experienced (an Experienced replaces the Good), whatever places they sit in', () => {
    expect(short(day12(['c', 'controller'], ['e1', 'senior'], ['e2', 'senior']))).toEqual([]);
    expect(short(day12(['c', 'controller'], ['e1', 'senior'], ['e2', 'good']))).toEqual([]);
  });
  it('invalid: 1 Controller + 1 Experienced only (one Field Operator short)', () => {
    const g = short(day12(['c', 'controller'], ['e1', 'senior']));
    expect(g.every((x) => x.role === 'good' && x.need === 2 && x.have === 1)).toBe(true);
    expect(g).toHaveLength(dates.length);
  });
  it('invalid: 1 Controller + 1 Good + 1 New (no Experienced; the New FO never counts)', () => {
    const g = short(day12(['c', 'controller'], ['g1', 'good'], ['n1', 'new']));
    expect(new Set(g.map((x) => x.role))).toEqual(new Set(['senior', 'good']));
  });
  it('invalid: 1 Controller + 2 Good (no Experienced)', () => {
    const g = short(day12(['c', 'controller'], ['g1', 'good'], ['g2', 'good']));
    expect(g.map((x) => x.role)).toEqual(dates.map(() => 'senior'));
  });
  it('invalid: no qualified Controller', () => {
    const g = short(day12(['e1', 'senior'], ['g1', 'good']));
    expect(g.every((x) => x.role === 'controller' && x.have === 0)).toBe(true);
  });
  it('the classification decides, never re-classified: a Good-level person placed in the New FO place does not count', () => {
    const g = short(day12(['c', 'controller'], ['e1', 'senior'], ['n2', 'new']));
    expect(g.every((x) => x.role === 'good' && x.have === 1)).toBe(true);
  });
});

describe('coverage hour by hour · 8-hour duties', () => {
  it('Experienced on 8 h with a Good and a second Experienced on 12 h: valid replacement, covered all 12 hours', () => {
    expect(short(day12(['c', 'controller'], ['e1', 'senior', 8], ['e2', 'senior'], ['g1', 'good']))).toEqual([]);
  });
  it('the Good on 8 h with nobody else: 15:00–19:00 has 1 of 2 Field Operators, a 4-hour gap every day, never Ready', () => {
    const g = short(day12(['c', 'controller'], ['e1', 'senior'], ['g1', 'good', 8]));
    expect(g).toHaveLength(dates.length);
    expect(g[0]).toMatchObject({ role: 'good', from: '15:00', to: '19:00', hours: 4, need: 2, have: 1 });
  });
  it('the only Experienced on 8 h: no Experienced 15:00–19:00 even with two Good on 12 h', () => {
    const g = short(day12(['c', 'controller'], ['e1', 'senior', 8], ['g1', 'good'], ['g2', 'good']));
    expect(g.every((x) => x.role === 'senior' && x.from === '15:00' && x.to === '19:00' && x.have === 0)).toBe(true);
  });
  it('a night 8 h duty leaves 03:00–07:00 short', () => {
    const team = [m('c', 'N', 'controller', () => 12), m('e1', 'N', 'senior', () => 12), m('g1', 'N', 'good', () => 8)];
    const g = coverageGaps(train, [night], team, I, nobodyAway);
    expect(g.every((x) => x.role === 'good' && x.from === '03:00' && x.to === '07:00' && x.hours === 4 && x.have === 1)).toBe(true);
    expect(g).toHaveLength(dates.length);
  });
  it('a 12 h person on approved leave does not count; the 8 h person alone leaves the last 4 hours short', () => {
    const team = day12(['c', 'controller'], ['e1', 'senior'], ['g1', 'good', 8], ['g2', 'good']);
    const g = coverageGaps(train, [day], team, I, (e, d) => e === 'g2' && d === '2026-11-02');
    expect(g).toEqual([expect.objectContaining({ date: '2026-11-02', role: 'good', from: '15:00', to: '19:00', have: 1, need: 2 })]);
  });
});

describe('coverage hour by hour · counts, not just presence (a place needing 6)', () => {
  // a total turnaround: one area needing 6 operators on the day shift, the Controller 1
  const total: SdPlan = { ...train, kind: 'total', areas: ['TR-II'], daysOn: 1, daysOff: 0 };
  const phases: SdPhase[] = [{ id: 'ph', start: total.start, end: total.end, needs: { D: { controller: 1, areas: { 'TR-II': 6 } } } }];
  const ops = (n: number, h8 = 0, extra12 = 0) => [
    m('c', 'D', 'controller', () => 12),
    ...Array.from({ length: n }, (_, i) => ({ ...m(`o${i}`, 'D', 'member', () => (i < h8 ? 8 : 12)), area: 'TR-II' })),
    ...Array.from({ length: extra12 }, (_, i) => ({ ...m(`x${i}`, 'D', 'member', () => 12), area: 'TR-II' })),
  ];
  const TI = new Map([['c', { id: 'c', name: 'c', position: 'controller', grade: 16, foLevel: null } as PersonInfo]]);
  it('6 operators on 12 h: covered', () => {
    expect(coverageGaps(total, [day], ops(6), TI, nobodyAway, phases)).toEqual([]);
  });
  it('one of the 6 on 8 h (07:00–15:00): 15:00–19:00 has 5 of 6, a gap every day', () => {
    const gaps = coverageGaps(total, [day], ops(6, 1), TI, nobodyAway, phases);
    expect(gaps).toHaveLength(dates.length);
    expect(gaps[0]).toMatchObject({ role: 'area:TR-II', from: '15:00', to: '19:00', need: 6, have: 5, hours: 4 });
  });
  it('the same 8 h duty with a 7th operator on 12 h: 6 on duty at every moment, covered', () => {
    expect(coverageGaps(total, [day], ops(6, 1, 1), TI, nobodyAway, phases)).toEqual([]);
  });
  it('a headcount of 6 is not enough when two work 8 h: 4 of 6 from 15:00', () => {
    const gaps = coverageGaps(total, [day], ops(6, 2), TI, nobodyAway, phases);
    expect(gaps[0]).toMatchObject({ from: '15:00', to: '19:00', have: 4, need: 6 });
  });
});
