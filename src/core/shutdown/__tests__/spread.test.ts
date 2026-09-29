import { describe, expect, it } from 'vitest';
import { memberWorks, planDates, teamDay, type SdMember, type SdPlan, type SdTeam } from '..';
import { defaultMaxRun, spreadGroup, spreadGroups, spreadPlan, type SpreadContext } from '../spread';

const plan: SdPlan = { id: 'p', title: 'Train-2 SD', kind: 'train', areas: [], sections: [], start: '2026-11-01', end: '2026-11-30', eventId: null, daysOn: 3, daysOff: 1, shiftHours: 12, rampDays: 2, rampHours: 8, normalHours: 8, maxOvertime: 80 };
const team: SdTeam = { id: 'day', planId: 'p', name: 'Day', sort: 0, needs: { controller: 1, senior: 2, good: 2, new: 1 }, rampNeeds: { controller: 1, senior: 1, good: 1, new: 1 }, shiftCode: 'M', hoursLabel: null };
const m = (id: string, slot: SdMember['slot'], offset = 0): SdMember => ({ id, planId: 'p', teamId: 'day', employeeId: id, slot, offset, start: plan.start, end: plan.end });
const ctx: SpreadContext = { crewOf: () => 'A', away: () => false, maxRun: defaultMaxRun(plan) };
const grp = (list: SdMember[], key: string) => spreadGroups(plan, team, list, []).find((g) => g.key === key)!;
const runs = (days: Record<string, boolean>) => { let best = 0, cur = 0; for (const d of planDates(plan)) { cur = days[d] ? cur + 1 : 0; best = Math.max(best, cur); } return best; };

describe('spread the days off', () => {
  it('a Controller alone cannot cover every day; two, staggered, can', () => {
    const one = spreadGroup(plan, grp([m('c1', 'controller')], 'controller'), [m('c1', 'controller')], ctx);
    expect(one.after.gapDays).toBeGreaterThan(0);
    expect(one.minPeople).toBe(2);
    const two = [m('c1', 'controller'), m('c2', 'controller')];
    const r = spreadGroup(plan, grp(two, 'controller'), two, ctx);
    expect(r.after).toMatchObject({ short: 0, gapDays: 0 });
    expect(r.minPeople).toBeNull();
    for (const days of r.days.values()) expect(runs(days)).toBeLessThanOrEqual(3);
  });
  it('an extra person gives everybody more days off, and less overtime, with the same cover', () => {
    const three = [m('s1', 'senior', 0), m('s2', 'senior', 1), m('s3', 'senior', 2)];
    const r = spreadGroup(plan, grp(three, 'senior'), three, ctx);
    expect(r.after.short).toBe(0);
    expect(r.after.overtime).toBeLessThan(r.before.overtime);
    expect(r.after.worst).toBeLessThanOrEqual(r.before.worst);
    // never more people than the day needs
    const members = three.map((x) => ({ ...x, days: Object.fromEntries(Object.entries(r.days.get(x.id)!).map(([d, w]) => [d, { works: w, hours: null }])) }));
    for (const d of planDates(plan)) expect(teamDay(plan, team, members, d).senior.have).toBe(team.needs.senior > 0 ? (d <= '2026-11-02' || d >= '2026-11-29' ? 1 : 2) : 0);
  });
  it('leave is respected and the run limit holds', () => {
    const two = [m('c1', 'controller'), m('c2', 'controller'), m('c3', 'controller')];
    const away = (id: string, d: string) => id === 'c1' && d >= '2026-11-10' && d <= '2026-11-14';
    const r = spreadGroup(plan, grp(two, 'controller'), two, { ...ctx, away });
    expect(r.after.short).toBe(0);
    for (const d of planDates(plan)) if (away('c1', d)) expect(r.days.get('c1')![d]).toBe(false);
    for (const days of r.days.values()) expect(runs(days)).toBeLessThanOrEqual(3);
  });
  it('a member released early is only scheduled up to their last day', () => {
    const list = [m('c1', 'controller'), { ...m('c2', 'controller'), end: '2026-11-10' }];
    const r = spreadGroup(plan, grp(list, 'controller'), list, ctx);
    expect(Object.keys(r.days.get('c2')!).every((d) => d <= '2026-11-10')).toBe(true);
  });
  it('spreadPlan gives one result per group of every team; operators without a level are left alone', () => {
    const list = [m('c1', 'controller'), m('c2', 'controller'), m('x', 'member')];
    const res = spreadPlan(plan, [team], list, [], ctx);
    expect(res.map((x) => x.group.key)).toEqual(['controller', 'senior', 'good', 'new']);
    expect(res.every((x) => !x.group.memberIds.includes('x'))).toBe(true);
    // the pattern stays as is where nothing was changed
    expect(memberWorks(plan, list[0], '2026-11-01')).toBe(true);
  });
  it('one person alone keeps the same cover with no more overtime than the plain pattern, and rests within the limit', () => {
    const one = [m('c1', 'controller')];
    const away = (id: string, d: string) => id === 'c1' && d >= '2026-11-10' && d <= '2026-11-12';
    const r = spreadGroup(plan, grp(one, 'controller'), one, { ...ctx, crewOf: () => 'B', away });
    expect(r.after.short).toBeLessThanOrEqual(r.before.short);
    expect(r.after.overtime).toBeLessThanOrEqual(r.before.overtime);
    expect(runs(r.days.get('c1')!)).toBeLessThanOrEqual(3);
  });
  it('a big total-turnaround style group is spread quickly and keeps every day covered', () => {
    const ta: SdPlan = { ...plan, kind: 'total', areas: ['TR-II'], sections: [], daysOn: 1, daysOff: 0, rampDays: 0, start: '2026-05-02', end: '2026-06-30' };
    const list = Array.from({ length: 14 }, (_, i) => ({ ...m(`t${i}`, 'member'), start: ta.start, end: ta.end, area: 'TR-II' }));
    const phases = [{ id: 'a', start: ta.start, end: ta.end, needs: { day: { controller: 0, areas: { 'TR-II': 10 } } } }];
    const t0 = Date.now();
    const res = spreadPlan(ta, [team], list, phases, { ...ctx, maxRun: 6 });
    expect(Date.now() - t0).toBeLessThan(3000);
    const area = res.find((x) => x.group.key === 'area:TR-II')!;
    expect(area.after.short).toBe(0);
    expect(area.after.overtime).toBeLessThan(area.before.overtime);
  });
});
