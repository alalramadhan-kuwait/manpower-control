import { describe, expect, it } from 'vitest';
import { FULL_OPERATION, type MpAbsence, type MpPerson } from '../../manpower';
import { addDaysIso, isWorkingDay } from '../../roster';
import { leavePreview } from '../preview';

const person = (id: string, role: MpPerson['role'], grade: number, o: Partial<MpPerson> = {}): MpPerson => ({
  id, employeeNumber: id, name: id, role, crew: 'A', grade, employmentType: 'knpc', takeCharge: 'yes', panelQualified: 'yes', actingController: null, ...o
});
// crew A at full strength: Controller, 3 Panel (one Grade 14), 6 Field
const crewA: MpPerson[] = [person('ctl', 'controller', 16), ...['p1', 'p2', 'p3'].map((x) => person(x, 'panel_operator', 14)), ...['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((x) => person(x, 'field_operator', 12))];
const firstWork = (from: string) => { let d = from; while (!isWorkingDay(d, 'A')) d = addDaysIso(d, 1); return d; };
const firstOff = (from: string) => { let d = from; while (isWorkingDay(d, 'A')) d = addDaysIso(d, 1); return d; };

describe('leavePreview', () => {
  it('the crew Controller away: each duty goes to cover needed, never to a confirmed shortage', () => {
    const d = firstWork('2026-12-01');
    const r = leavePreview({ employeeId: 'ctl', start: d, end: d, typeCode: 'annual_leave_unscheduled', recordIds: [] }, crewA, [], [], FULL_OPERATION, []);
    expect(r.duties).toHaveLength(1);
    expect(r.duties[0]).toMatchObject({ crew: 'A', issue: 'cover_needed', controller: { before: 1, after: 0, min: 1 } });
    expect(r.short).toBe(0);
    expect(r.coverNeeded).toBe(1);
  });
  it('a Field Operator away at the minimum is a confirmed shortage', () => {
    const d = firstWork('2026-12-01');
    const r = leavePreview({ employeeId: 'f1', start: d, end: d, typeCode: 'annual_leave_unscheduled', recordIds: [] }, crewA, [], [], FULL_OPERATION, []);
    expect(r.duties[0]).toMatchObject({ issue: 'short', field: { before: 6, after: 5, min: 6 } });
    expect(r.short).toBe(1);
  });
  it('leave on Off days touches no duty', () => {
    const d = firstOff('2026-12-01');
    expect(leavePreview({ employeeId: 'f1', start: d, end: d, typeCode: 'sick_leave', recordIds: [] }, crewA, [], [], FULL_OPERATION, []).duties).toHaveLength(0);
  });
  it('an existing leave is compared with the plan without its own records (no double counting)', () => {
    const d = firstWork('2026-12-01');
    const rec: MpAbsence = { id: 'x1', employeeId: 'f1', start: d, end: d, status: 'approved', typeCode: 'annual_leave_planned', inCurrentPlan: true };
    const r = leavePreview({ employeeId: 'f1', start: d, end: d, typeCode: rec.typeCode, recordIds: ['x1'] }, crewA, [rec], [], FULL_OPERATION, []);
    expect(r.duties[0].field).toEqual({ before: 6, after: 5, min: 6 });
    expect(r.duties[0].othersOff).toHaveLength(0);
  });
  it('finds the last duty before and the next duty after the leave', () => {
    const d = firstWork('2026-12-10');
    const r = leavePreview({ employeeId: 'f1', start: d, end: d, typeCode: 'sick_leave', recordIds: [] }, crewA, [], [], FULL_OPERATION, []);
    expect(r.lastDuty && r.lastDuty.date < d).toBe(true);
    expect(r.nextDuty && r.nextDuty.date > d).toBe(true);
    expect(isWorkingDay(r.nextDuty!.date, 'A')).toBe(true);
  });
});
