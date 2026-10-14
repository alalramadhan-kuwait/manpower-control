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
const I = info([['c', null, 'controller'], ['s', 'senior'], ['g1', 'good'], ['g2', 'good']]);

describe('coverage hour by hour · train shutdown (one qualified person of each place at every moment)', () => {
  it('a 12 h duty covers the whole shift', () => {
    const team = [m('c', 'D', 'controller', () => 12), m('s', 'D', 'senior', () => 12), m('g1', 'D', 'good', () => 12)];
    expect(coverageGaps(train, [day], team, I, nobodyAway)).toEqual([]);
  });
  it('8 h + 12 h in the same place: covered (the 12 h person holds 15:00–19:00)', () => {
    const team = [m('c', 'D', 'controller', () => 12), m('s', 'D', 'senior', () => 12), m('g1', 'D', 'good', () => 8), m('g2', 'D', 'good', () => 12)];
    expect(coverageGaps(train, [day], team, I, nobodyAway)).toEqual([]);
  });
  it('only 8 h duties in a place: the last 4 hours are a gap (15:00–19:00), never Ready', () => {
    const team = [m('c', 'D', 'controller', () => 12), m('s', 'D', 'senior', () => 12), m('g1', 'D', 'good', () => 8), m('g2', 'D', 'good', () => 8)];
    const gaps = coverageGaps(train, [day], team, I, nobodyAway);
    expect(gaps).toHaveLength(dates.length);
    expect(gaps[0]).toMatchObject({ role: 'good', from: '15:00', to: '19:00', hours: 4, need: 1, have: 0 });
  });
  it('a night 8 h duty leaves 03:00–07:00 uncovered', () => {
    const team = [m('c', 'N', 'controller', () => 12), m('s', 'N', 'senior', () => 8), m('g1', 'N', 'good', () => 12)];
    const gaps = coverageGaps(train, [night], team, I, nobodyAway);
    expect(gaps.every((g) => g.role === 'senior' && g.from === '03:00' && g.to === '07:00' && g.hours === 4)).toBe(true);
    expect(gaps).toHaveLength(dates.length);
  });
  it('a 12 h person on approved leave does not count; the 8 h person alone leaves the last 4 hours open', () => {
    const team = [m('c', 'D', 'controller', () => 12), m('s', 'D', 'senior', () => 12), m('g1', 'D', 'good', () => 8), m('g2', 'D', 'good', () => 12)];
    const gaps = coverageGaps(train, [day], team, I, (e, d) => e === 'g2' && d === '2026-11-02');
    expect(gaps).toEqual([expect.objectContaining({ date: '2026-11-02', role: 'good', from: '15:00', to: '19:00', have: 0 })]);
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
