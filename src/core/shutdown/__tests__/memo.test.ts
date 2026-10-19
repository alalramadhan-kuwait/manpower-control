// The instruction memo is read from the plan: the groups, the crews' controllers left on 8 hrs, the day each one joins.
import { describe, expect, it } from 'vitest';
import type { MpPerson } from '../../manpower';
import { isWorkingDay, type Crew } from '../../roster';
import type { SdMember, SdPlan, SdTeam } from '..';
import { buildMemo, memoDays, trainOf } from '../memo';

const plan: SdPlan = { id: 'p', title: 'Train-2 SD', kind: 'train', areas: [], sections: [], start: '2026-10-18', end: '2026-11-16', eventId: null,
  daysOn: 3, daysOff: 1, shiftHours: 12, rampDays: 2, rampHours: 12, normalHours: 8, maxOvertime: 72, maxOvertimeYear: 380, maxOvertimeHard: 80, maxOvertimeYearHard: 440, rulesVersion: 2 };
const needs = { controller: 1, senior: 1, good: 1, new: 0 };
const day: SdTeam = { id: 'day', planId: 'p', name: 'Day', sort: 0, needs, rampNeeds: needs, shiftCode: 'M', hoursLabel: '07:00 - 19:00' };
const night: SdTeam = { id: 'night', planId: 'p', name: 'Night', sort: 1, needs, rampNeeds: needs, shiftCode: 'N', hoursLabel: '19:00 - 07:00' };
const off = (...ds: string[]) => Object.fromEntries(ds.map((d) => [d, { works: false, hours: null }]));
const member = (id: string, teamId: string, slot: SdMember['slot'], extra: Partial<SdMember> = {}): SdMember => ({ id, planId: 'p', teamId, employeeId: id, slot, offset: 0, start: plan.start, end: plan.end, ...extra });
const person = (id: string, role: MpPerson['role'], crew: Crew | null, moves: MpPerson['moves'] = []): MpPerson => ({ id, employeeNumber: id, name: id, role, crew, grade: 15, employmentType: 'knpc', takeCharge: null, panelQualified: null, actingController: null, moves });
const crewOff = (['A', 'B', 'C', 'D'] as Crew[]).find((c) => !isWorkingDay(plan.start, c))!;
const crewOn = (['A', 'B', 'C', 'D'] as Crew[]).find((c) => isWorkingDay(plan.start, c))!;

const members = [
  member('c1', 'day', 'controller', { days: off('2026-10-18') }),
  member('c2', 'day', 'controller'),
  member('c3', 'night', 'controller', { days: off('2026-10-18', '2026-10-19') }),
  member('c4', 'night', 'controller'),
  member('f1', 'day', 'senior', { followCrew: crewOff }),
  member('f2', 'day', 'good'),
  member('f3', 'night', 'new', { days: off('2026-10-18'), restDays: ['2026-10-17'] }),
  member('f4', 'day', 'good', { end: '2026-10-31', restDays: [] }),
  member('f4b', 'night', 'good', { employeeId: 'f4', start: '2026-11-01', days: { ...off('2026-11-01'), '2026-11-02': { works: true, hours: 12 } }, restDays: ['2026-11-17'] }),
];
const people = [person('c1', 'controller', 'C'), person('c4', 'controller', 'B'), person('c2', 'controller', 'A'), person('x1', 'controller', 'D'), person('x2', 'vr_controller', null, [{ start: '2026-01-01', end: null, crew: 'A', kind: 'placement' }]),
  person('f1', 'field_operator', 'C'), person('f2', 'field_operator', crewOn), person('f3', 'field_operator', 'B'), person('f4', 'field_operator', 'D')];
const who = (id: string) => ({ name: id.toUpperCase(), number: id });
const memo = buildMemo(plan, [day, night], members, people, who, (m) => m.followCrew ?? people.find((p) => p.id === m.employeeId)?.crew ?? null);

describe('shutdown memo', () => {
  it('names the train and the period', () => {
    expect(trainOf(plan)).toBe('II');
    expect(memo.heading).toBe('ARDS Unit-12 (Train-II) October – November 2026');
    expect(memo.intro).toContain('starting from 18/10/2026');
    expect(memo.intro).toContain('Two controllers in 12 hrs group shift');
    expect(memo.intro).toContain('will start from 07:00 hrs. to 19:00 hrs. and the night shift will start from 19:00 hrs. to 07:00 hrs.');
  });
  it('lists the groups with their basis, controllers apart from the field operators', () => {
    expect(memo.controllers.map((g) => [g.numeral, g.remark, g.people.map((p) => p.number)])).toEqual([['I', '12 hrs. Morning basis', ['c1', 'c2']], ['II', '12 hrs. Night basis', ['c3', 'c4']]]);
    expect(memo.operators[1].people.find((p) => p.number === 'f4')?.note).toBe('from 01/11/2026');
  });
  it('keeps the crews whose controller is on the shutdown empty, and the others with their controller', () => {
    expect(memo.remaining.map((r) => [r.crew, r.people.map((p) => p.number)])).toEqual([['A', ['x2']], ['B', []], ['C', []], ['D', ['x1']]]);
  });
  it('gives each one the day of joining: days off first, a crew off that day, a move, rest days after', () => {
    expect(memo.personnel).toContain('C1 #c1 to take off on 18/10/26 and join the Day Group on 19/10/2026.');
    expect(memo.personnel).toContain('C3 #c3 to take off on 18 & 19/10/26 and join the Night Group on 20/10/2026.');
    expect(memo.personnel).toContain('F3 #f3 to take off on 17 & 18/10/26 and join the Night Group on 19/10/2026.');
    expect(memo.personnel).toContain('F1 #f1 to join the Day Group on 18/10/2026.');
    expect(memo.personnel.some((l) => l.startsWith('F2 '))).toBe(false);
    expect(memo.personnel).toContain('F4 #f4 to take off on 01/11/26 and move to the Night Group on 02/11/2026.');
    expect(memo.personnel).toContain('F4 #f4 to take off on 17/11/26 after the shutdown before returning to his shift.');
  });
  it('writes days of two months in full', () => {
    expect(memoDays(['2026-11-01', '2026-10-31'])).toBe('31/10/26 & 01/11/26');
  });
});
