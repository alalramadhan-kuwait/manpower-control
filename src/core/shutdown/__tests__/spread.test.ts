import { describe, expect, it } from 'vitest';
import type { Crew } from '../../roster';
import { dayState, planDates, teamDay, type SdMember, type SdPlan, type SdTeam } from '..';
import { defaultMaxRun, spreadGroup, spreadGroups, spreadPlan, type SpreadContext } from '../spread';

const plan: SdPlan = { id: 'p', title: 'Train-2 SD', kind: 'train', areas: [], sections: [], start: '2026-11-01', end: '2026-11-30', eventId: null, daysOn: 3, daysOff: 1, shiftHours: 12, rampDays: 2, rampHours: 8, normalHours: 8, maxOvertime: 80 };
const team: SdTeam = { id: 'day', planId: 'p', name: 'Day', sort: 0, needs: { controller: 1, senior: 2, good: 2, new: 1 }, rampNeeds: { controller: 1, senior: 1, good: 1, new: 1 }, shiftCode: 'M', hoursLabel: null };
const night: SdTeam = { ...team, id: 'night', name: 'Night', shiftCode: 'N' };
const m = (id: string, slot: SdMember['slot'], teamId = 'day'): SdMember => ({ id, planId: 'p', teamId, employeeId: id, slot, offset: 0, start: plan.start, end: plan.end });
/** Member ids are written c1 / s1 ...; their crew is given by the map. */
const ctxOf = (crews: Record<string, Crew | null>, over: Partial<SpreadContext> = {}): SpreadContext => ({ crewOf: (id) => crews[id] ?? null, away: () => false, maxRun: defaultMaxRun(plan), ...over });
const grp = (list: SdMember[], key: string, t = team) => spreadGroups(plan, t, list, []).find((g) => g.key === key)!;
const dates = planDates(plan);
const run12 = (hours: Record<string, number>) => { let best = 0, cur = 0; for (const d of dates) { cur = hours[d] === 12 ? cur + 1 : 0; best = Math.max(best, cur); } return best; };

describe('follow your own crew (train shutdown)', () => {
  it('two people from different crews: someone every day, one full shift, 52 h overtime each, the cap is not reached', () => {
    const list = [m('c1', 'controller'), m('c2', 'controller')];
    const r = spreadGroup(plan, grp(list, 'controller'), list, ctxOf({ c1: 'A', c2: 'C' }));
    expect(r.after).toMatchObject({ short: 0, gapDays: 0, noFullDays: 0 });
    expect(r.train!.people.map((x) => x.overtime)).toEqual([52, 52]);
    expect(r.after.over).toBe(0);
    for (const d of dates.slice(2, -2)) { const h = list.map((x) => r.hours.get(x.id)![d]).filter((x) => x != null); expect(h.filter((x) => x === 12).length).toBe(1); expect(h.every((x) => x === 12 || x === 8)).toBe(true); }
  });
  it('nobody works a rest day of their own crew, and the plan\'s reduced days are 8 h for everyone', () => {
    const list = [m('s1', 'senior'), m('s2', 'senior'), m('s3', 'senior')];
    const crews = { s1: 'A', s2: 'B', s3: 'C' } as const;
    const r = spreadGroup(plan, grp(list, 'senior'), list, ctxOf({ ...crews }));
    // crew A rests on 7, 8, 15, 16, 23, 24 Nov
    for (const d of ['2026-11-07', '2026-11-08', '2026-11-15', '2026-11-16']) expect(r.days.get('s1')![d]).toBe(false);
    for (const d of ['2026-11-01', '2026-11-02', '2026-11-29', '2026-11-30']) for (const id of ['s1', 's2', 's3']) if (r.days.get(id)![d]) expect(r.hours.get(id)![d]).toBe(8);
    expect(r.after).toMatchObject({ short: 0, gapDays: 0 });
    expect(r.train!.people.every((x) => x.overtime < 40)).toBe(true);
    expect(Math.max(...r.train!.people.map((x) => x.full)) - Math.min(...r.train!.people.map((x) => x.full))).toBeLessThanOrEqual(2);   // full shifts shared out
  });
  it('two people of the same crew rest together: days with nobody, a warning and the crews to add from', () => {
    const list = [m('c1', 'controller'), m('c2', 'controller')];
    const r = spreadGroup(plan, grp(list, 'controller'), list, ctxOf({ c1: 'A', c2: 'A' }));
    expect(r.after.gapDays).toBe(6);
    expect(r.train).toMatchObject({ sameCrew: true, wanted: 2 });
    expect(r.train!.addFrom).toEqual(['B', 'C', 'D']);
    expect(r.minPeople).toBe(2);
  });
  it('one person alone: his own rest days are empty and it says how many the slot needs', () => {
    const list = [m('c1', 'controller')];
    const r = spreadGroup(plan, grp(list, 'controller'), list, ctxOf({ c1: 'B' }));
    expect(r.after.gapDays).toBe(8);   // crew B rests on 3, 4, 11, 12, 19, 20, 27, 28 Nov
    expect(r.minPeople).toBe(2);
  });
  it('full shifts in a row stay within the limit (4 by day, 3 by night) when the crews are apart', () => {
    const ac = [m('c1', 'controller'), m('c2', 'controller')];
    const day = spreadGroup(plan, grp(ac, 'controller'), ac, ctxOf({ c1: 'A', c2: 'C' }));
    expect(Math.max(...ac.map((x) => run12(day.hours.get(x.id)!)))).toBeLessThanOrEqual(4);
    expect(day.train!.runBreaks).toBe(0);
    const nt = [m('c1', 'controller', 'night'), m('c2', 'controller', 'night')];
    const nr = spreadGroup(plan, grp(nt, 'controller', night), nt, ctxOf({ c1: 'A', c2: 'C' }));
    expect(Math.max(...nt.map((x) => run12(nr.hours.get(x.id)!)))).toBeLessThanOrEqual(3);
    expect(nr.train!.runBreaks).toBe(0);
  });
  it('leave takes a day away and the others cover it; the New FO slot may be empty', () => {
    const list = [m('c1', 'controller'), m('c2', 'controller'), m('c3', 'controller')];
    const away = (id: string, d: string) => id === 'c1' && d >= '2026-11-10' && d <= '2026-11-14';
    const r = spreadGroup(plan, grp(list, 'controller'), list, ctxOf({ c1: 'A', c2: 'B', c3: 'D' }, { away }));
    for (const d of dates) if (away('c1', d)) expect(r.days.get('c1')![d]).toBe(false);
    expect(r.after.gapDays).toBe(0);
    const full = [...list, m('s1', 'senior'), m('s2', 'senior'), m('g1', 'good'), m('g2', 'good')];
    const day = teamDay(plan, team, full, '2026-11-10');
    expect(day.new).toEqual({ need: 1, have: 0 });
    expect(dayState(day)).not.toBe('idle');
    expect(dayState({ ...day, controller: { need: 1, have: 1 }, senior: { need: 2, have: 1 }, good: { need: 2, have: 1 } })).toBe('short');   // New empty is not critical
  });
  it('spreadPlan gives one result per group; operators without a level are left alone', () => {
    const list = [m('c1', 'controller'), m('c2', 'controller'), m('x', 'member')];
    const res = spreadPlan(plan, [team], list, [], ctxOf({ c1: 'A', c2: 'C' }));
    expect(res.map((x) => x.group.key)).toEqual(['controller', 'senior', 'good', 'new']);
    expect(res.every((x) => !x.group.memberIds.includes('x'))).toBe(true);
  });
});

describe('total turnaround keeps the spread of days off', () => {
  it('a big group is spread quickly and keeps every day covered', () => {
    const ta: SdPlan = { ...plan, kind: 'total', areas: ['TR-II'], sections: [], daysOn: 1, daysOff: 0, rampDays: 0, start: '2026-05-02', end: '2026-06-30' };
    const list = Array.from({ length: 14 }, (_, i) => ({ ...m(`t${i}`, 'member'), start: ta.start, end: ta.end, area: 'TR-II' }));
    const phases = [{ id: 'a', start: ta.start, end: ta.end, needs: { day: { controller: 0, areas: { 'TR-II': 10 } } } }];
    const t0 = Date.now();
    const res = spreadPlan(ta, [team], list, phases, ctxOf({}, { maxRun: 6 }));
    expect(Date.now() - t0).toBeLessThan(3000);
    const area = res.find((x) => x.group.key === 'area:TR-II')!;
    expect(area.after.short).toBe(0);
    expect(area.after.overtime).toBeLessThan(area.before.overtime);
    expect(area.train).toBeNull();
  });
});
