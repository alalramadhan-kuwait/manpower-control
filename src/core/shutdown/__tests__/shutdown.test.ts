import { describe, expect, it } from 'vitest';
import { dayShort, dayState, hoursOn, neighbours, isRampDay, memberHours, memberWorks, nextOffset, teamDay, type SdMember, type SdPlan, type SdTeam } from '..';

const plan: SdPlan = { id: 'p', title: 'Train-2 SD', start: '2026-11-01', end: '2026-11-30', eventId: null, daysOn: 3, daysOff: 1, shiftHours: 12, rampDays: 2, rampHours: 8, normalHours: 8, maxOvertime: 80 };
const team: SdTeam = { id: 'day', planId: 'p', name: 'Day', sort: 0, needs: { controller: 1, senior: 2, good: 2, new: 1 }, rampNeeds: { controller: 1, senior: 1, good: 1, new: 1 } };
const m = (id: string, slot: SdMember['slot'], offset: number): SdMember => ({ id, planId: 'p', teamId: 'day', employeeId: id, slot, offset, start: plan.start, end: plan.end });

describe('shutdown teams', () => {
  it('reduced first and last two days at 8 h, 12 h in between', () => {
    expect(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-28', '2026-11-29', '2026-11-30'].map((d) => isRampDay(plan, d))).toEqual([true, true, false, false, true, true]);
    expect([hoursOn(plan, '2026-11-01'), hoursOn(plan, '2026-11-10')]).toEqual([8, 12]);
  });
  it('3 on / 1 off from the first day, shifted by the offset', () => {
    const on = (o: number) => ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) => memberWorks(plan, m('x', 'senior', o), d));
    expect(on(0)).toEqual([true, true, true, false, true]);
    expect(on(1)).toEqual([true, true, false, true, true]);
  });
  it('coverage per slot against full or reduced needs; offsets spread the days off', () => {
    const members = [m('s1', 'senior', 0), m('s2', 'senior', 1)];
    expect(teamDay(plan, team, members, '2026-11-01').senior).toEqual({ need: 1, have: 2 });   // reduced day
    expect(teamDay(plan, team, members, '2026-11-03').senior).toEqual({ need: 2, have: 1 });   // s2 off
    expect(dayShort(teamDay(plan, team, members, '2026-11-05'))).toBe(1 + 2 + 1);             // no controller, good, new
    expect(nextOffset(plan, 'day', 'senior', members)).toBe(2);
    expect(dayState(teamDay(plan, team, members, '2026-11-03'))).toBe('critical');           // no controller at all
    const full = [m('c', 'controller', 0), ...members, m('g1', 'good', 0), m('g2', 'good', 1), m('n', 'new', 0)];
    expect(dayState(teamDay(plan, team, full, '2026-11-03'))).toBe('short');                  // s2, g2 off, all slots covered
    expect(dayState(teamDay(plan, team, full, '2026-11-05'))).toBe('full');
  });
  it('overtime: shutdown hours minus the normal crew hours of the month, over 80 h flagged', () => {
    const [nov] = memberHours(plan, m('x', 'senior', 0), 'B');
    expect(nov.sd).toBe(4 * 8 + 19 * 12);          // 23 days worked: 4 reduced days at 8 h, 19 at 12 h = 260
    expect(nov.normal).toBe(22 * 8);                // B has 22 duty days in November
    expect(nov.overtime).toBe(260 - 176);
    expect(nov.over).toBe(true);                    // 84 h > 80 h
    expect(memberHours(plan, m('y', 'controller', 0), null)[0]).toMatchObject({ normal: 22 * 8, overtime: 84 });   // day staff: Sun–Thu
  });
  it('the shutdowns right before and after a plan', () => {
    const p = (id: string, start: string, end: string): SdPlan => ({ ...plan, id, start, end });
    const all = [p('aug', '2026-08-01', '2026-08-20'), p('may', '2026-05-01', '2026-05-10'), plan, p('feb', '2027-02-01', '2027-02-15'), p('jun27', '2027-06-01', '2027-06-10')];
    const n = neighbours(all, plan);
    expect([n.prev?.id, n.next?.id]).toEqual(['aug', 'feb']);
  });
});
