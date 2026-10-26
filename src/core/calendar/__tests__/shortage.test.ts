import { describe, expect, it } from 'vitest';
import { evaluateRange, FULL_OPERATION, type MpAbsence, type MpPerson } from '../../manpower';
import { addDaysIso, isWorkingDay } from '../../roster';
import { leaveScenarios, shortageKinds } from '../index';

const person = (id: string, role: MpPerson['role'], grade: number): MpPerson => ({ id, employeeNumber: id, name: id, role, crew: 'A', grade, employmentType: 'knpc', takeCharge: 'yes', panelQualified: 'yes', actingController: null });
const crewA = [person('ctl', 'controller', 16), ...['p1', 'p2', 'p3'].map((x) => person(x, 'panel_operator', 14)), ...['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((x) => person(x, 'field_operator', 12))];
let d = '2026-12-01'; while (!isWorkingDay(d, 'A')) d = addDaysIso(d, 1);
const leave = (o: Partial<MpAbsence>): MpAbsence => ({ id: 'x', employeeId: 'f1', start: d, end: d, status: 'approved', typeCode: 'annual_leave_planned', inCurrentPlan: true, oracle: 'approved', ...o });
const kind = (abs: MpAbsence[]) => {
  const { approvedOnly, allPlanned } = leaveScenarios(abs);
  const run = (a: MpAbsence[]) => evaluateRange(d, d, crewA, a, FULL_OPERATION, []);
  return shortageKinds(run(abs), run(approvedOnly), run(allPlanned)).get(`${d}|A`);
};

describe('shortageKinds', () => {
  it('approved leave below the minimum is a confirmed shortage', () => expect(kind([leave({})])).toBe('confirmed'));
  it('planned leave not approved yet is a potential shortage', () => expect(kind([leave({ oracle: 'not_submitted' })])).toBe('potential'));
  it('planned leave that lapsed (not counted today) is still a potential shortage', () => expect(kind([leave({ oracle: 'not_submitted', inCurrentPlan: false, lapsed: true })])).toBe('potential'));
  it('sick leave needs no approval: confirmed', () => expect(kind([leave({ typeCode: 'sick_leave', oracle: 'approved' })])).toBe('confirmed'));
  it('nothing below the minimum: no mark', () => expect(kind([])).toBeUndefined());
});
