import { describe, expect, it } from 'vitest';
import { approvalOutcome, requestImpact } from '..';
import type { MpAbsence, MpPerson } from '../../manpower';
import { isWorkingDay, type Crew } from '../../roster';

let seq = 0;
function person(crew: Crew | null, role: MpPerson['role'], grade: number): MpPerson {
  seq++;
  return { id: `p${seq}`, employeeNumber: String(10000 + seq), name: `p${seq}`, role, crew, grade, employmentType: 'knpc',
    takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null };
}
// Panel Operators below Grade 13, so Panel lends no buffer to Field (Field thresholds tested on their own)
const crew = (c: Crew, field: number) => [person(c, 'controller', 16), person(c, 'panel_operator', 14), ...[1, 2, 3].map(() => person(c, 'panel_operator', 12)), ...Array.from({ length: field }, () => person(c, 'field_operator', 11))];
const A = crew('A', 7), B = crew('B', 6), C = crew('C', 8), D = crew('D', 8);
const vr = person(null, 'vr_controller', 16);
const people = [...A, ...B, ...C, ...D, vr];
const leave = (p: MpPerson, start: string, end: string): MpAbsence => ({ employeeId: p.id, start, end, status: 'approved', typeCode: 'annual_leave_planned', typeLabel: 'PV', inCurrentPlan: true });
const req = (p: MpPerson, start: string, end: string) => ({ employeeId: p.id, start, end, typeCode: 'annual_leave_unscheduled' });

describe('leave request impact', () => {
  it('counts calendar and duty days and lists each crew duty with the result before and after', () => {
    const r = requestImpact(req(A[6], '2026-09-20', '2026-09-27'), people, []);
    expect(r.crew).toBe('A');
    expect(r.calendarDays).toBe(8);
    const duty = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'].filter((d) => isWorkingDay(d, 'A'));
    expect(r.dutyDays).toBe(duty.length);
    expect(r.duties.map((d) => d.date)).toEqual(duty);
    // A has 7 Field Operators: one away leaves exactly 6 → green becomes amber (no buffer), never red
    expect(r.duties.every((d) => d.before === 'green' && d.after === 'amber')).toBe(true);
    expect(r.red).toEqual([]);
  });
  it('flags duties that would become a confirmed shortage (overtime likely needed)', () => {
    const r = requestImpact(req(B[6], '2026-09-20', '2026-09-27'), people, []);
    expect(r.red.length).toBe(r.dutyDays);
    expect(r.red.every((d) => d.before === 'amber' && d.after === 'red')).toBe(true);
  });
  it('a Controller\'s leave needs cover (pending), not red', () => {
    const r = requestImpact(req(C[0], '2026-09-20', '2026-09-27'), people, []);
    expect(r.coverNeeded.length).toBe(r.dutyDays);
    expect(r.red).toEqual([]);
  });
  it('shows leave already recorded on the same dates, and day staff have no crew duties', () => {
    const r = requestImpact(req(D[5], '2026-09-20', '2026-09-27'), people, [leave(D[5], '2026-09-25', '2026-10-02')]);
    expect(r.overlaps).toHaveLength(1);
    const day = requestImpact(req(vr, '2026-09-20', '2026-09-21'), people, []);
    expect(day).toMatchObject({ crew: null, calendarDays: 2, dutyDays: 2, duties: [] });
  });
});

describe('what approval does (one leave, one record)', () => {
  const pv = (start: string, end: string, typeCode = 'annual_leave_planned', status = 'approved'): MpAbsence => ({ employeeId: 'x', start, end, status, typeCode, typeLabel: null, inCurrentPlan: true });
  it('adds a record when nothing is recorded on those dates', () => {
    expect(approvalOutcome({ type: 'unscheduled', start: '2026-10-04', end: '2026-10-08' }, [])).toEqual({ kind: 'add' });
  });
  it('confirms leave already recorded on the same dates, setting the type when it differs', () => {
    expect(approvalOutcome({ type: 'scheduled', start: '2026-10-04', end: '2026-10-08' }, [pv('2026-10-04', '2026-10-08')])).toMatchObject({ kind: 'confirm', setsType: false });
    expect(approvalOutcome({ type: 'unscheduled', start: '2026-10-04', end: '2026-10-08' }, [pv('2026-10-04', '2026-10-08')])).toMatchObject({ kind: 'confirm', setsType: true });
  });
  it('moves a planned block for a Scheduled request on other dates', () => {
    expect(approvalOutcome({ type: 'scheduled', start: '2026-10-04', end: '2026-10-08' }, [pv('2026-10-01', '2026-10-14')])).toMatchObject({ kind: 'move' });
    expect(approvalOutcome({ type: 'scheduled', start: '2026-10-04', end: '2026-10-08' }, [pv('2026-10-01', '2026-10-14', 'annual_leave_rescheduled')])).toMatchObject({ kind: 'move' });
  });
  it('refuses other overlaps: another leave type, an unscheduled request, several records or an unresolved absence', () => {
    expect(approvalOutcome({ type: 'scheduled', start: '2026-10-04', end: '2026-10-08' }, [pv('2026-10-05', '2026-10-05', 'sick_leave')]).kind).toBe('refused');
    expect(approvalOutcome({ type: 'unscheduled', start: '2026-10-04', end: '2026-10-08' }, [pv('2026-10-01', '2026-10-14')]).kind).toBe('refused');
    expect(approvalOutcome({ type: 'scheduled', start: '2026-10-04', end: '2026-10-08' }, [pv('2026-10-01', '2026-10-05'), pv('2026-10-07', '2026-10-09')]).kind).toBe('refused');
    expect(approvalOutcome({ type: 'scheduled', start: '2026-10-04', end: '2026-10-08' }, [pv('2026-10-04', '2026-10-08', null as unknown as string, 'unresolved')]).kind).toBe('refused');
  });
});
