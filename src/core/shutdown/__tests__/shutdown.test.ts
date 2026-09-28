import { describe, expect, it } from 'vitest';
import { dayOvertime, dayShort, dayState, hoursOn, neighbours, isRampDay, memberHours, memberWorks, nextOffset, teamDay, type SdMember, type SdPlan, type SdTeam } from '..';

const plan: SdPlan = { id: 'p', title: 'Train-2 SD', start: '2026-11-01', end: '2026-11-30', eventId: null, daysOn: 3, daysOff: 1, shiftHours: 12, rampDays: 2, rampHours: 8, normalHours: 8, maxOvertime: 80 };
const team: SdTeam = { id: 'day', planId: 'p', name: 'Day', sort: 0, needs: { controller: 1, senior: 2, good: 2, new: 1 }, rampNeeds: { controller: 1, senior: 1, good: 1, new: 1 }, shiftCode: 'M', hoursLabel: null };
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
  it('operators without a level fill the open Field Operator places, Senior first', () => {
    const d = teamDay(plan, team, [m('c', 'controller', 0), m('o1', 'member', 0), m('o2', 'member', 0), m('o3', 'member', 0)], '2026-11-05');
    expect([d.senior.have, d.good.have, d.new.have]).toEqual([2, 1, 0]);
  });
  it('overtime day by day: 12 h on a duty day = 4, on a rest day = 12, off = 0 (Ashkanani, January 2026 sheet: 104 h)', () => {
    const tr1: SdPlan = { ...plan, start: '2025-12-26', end: '2026-01-24', rampDays: 0 };
    const worked = new Set(['03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '21', '22']);
    const own: SdMember['days'] = {};
    for (let d = new Date('2025-12-26T00:00:00Z'); d <= new Date('2026-01-24T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      own[iso] = { works: iso.startsWith('2026-01') && worked.has(iso.slice(8)), hours: null };
    }
    const ash: SdMember = { ...m('ash', 'controller', 0), start: tr1.start, end: tr1.end, days: own };
    const jan = memberHours(tr1, ash, 'B').find((h) => h.month === '2026-01')!;
    expect(jan).toMatchObject({ days: 18, sd: 216, overtime: 104, over: true });
    expect(['2026-01-03', '2026-01-05', '2026-01-19'].map((d) => dayOvertime(tr1, ash, 'B', d))).toEqual([12, 4, 0]);
  });
  it('a full month of 3 on / 1 off with reduced 8 h days', () => {
    const [nov] = memberHours(plan, m('x', 'senior', 0), 'B');
    expect(nov).toMatchObject({ days: 23, sd: 4 * 8 + 19 * 12 });
    expect(memberHours(plan, m('y', 'controller', 0), null)[0].days).toBe(23);
  });
  it('the shutdowns right before and after a plan', () => {
    const p = (id: string, start: string, end: string): SdPlan => ({ ...plan, id, start, end });
    const all = [p('aug', '2026-08-01', '2026-08-20'), p('may', '2026-05-01', '2026-05-10'), plan, p('feb', '2027-02-01', '2027-02-15'), p('jun27', '2027-06-01', '2027-06-10')];
    const n = neighbours(all, plan);
    expect([n.prev?.id, n.next?.id]).toEqual(['aug', 'feb']);
  });
});
