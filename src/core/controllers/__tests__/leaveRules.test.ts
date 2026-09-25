import { describe, expect, it } from 'vitest';
import { checkControllerLeave, joinPeriods, openIssues, type LeaveApproval } from '../leaveRules';
import type { MpAbsence, MpPerson } from '../../manpower';

const p = (id: string, role: MpPerson['role'], crew: MpPerson['crew']): MpPerson => ({ id, employeeNumber: id, name: id, role, crew, grade: 16, employmentType: 'knpc', takeCharge: null, panelQualified: null, actingController: null });
const people = [p('yaser', 'controller', 'A'), p('jasem', 'controller', 'B'), p('vr', 'vr_controller', null), p('field', 'field_operator', 'A')];
let n = 0;
const lv = (who: string, start: string, end: string, typeCode = 'annual_leave_planned', status = 'approved'): MpAbsence =>
  ({ id: `r${++n}`, employeeId: who, start, end, status, typeCode, typeShort: typeCode === 'sick_leave' ? 'SL' : 'PV', inCurrentPlan: true });

describe('Controller leave rules', () => {
  it('joins back-to-back records into one leave', () => {
    const j = joinPeriods([lv('yaser', '2026-10-08', '2026-10-09'), lv('yaser', '2026-10-10', '2026-10-19'), lv('yaser', '2026-11-01', '2026-11-02')]);
    expect(j.map((x) => [x.start, x.end, x.ids.length])).toEqual([['2026-10-08', '2026-10-19', 2], ['2026-11-01', '2026-11-02', 1]]);
  });
  it('two Controllers (crew or VR) on leave together is an overlap until approved; other staff do not count', () => {
    const a = lv('yaser', '2026-10-08', '2026-10-19'), b = lv('vr', '2026-10-15', '2026-10-30'), c = lv('field', '2026-10-01', '2026-10-30');
    const check = checkControllerLeave(people, [a, b, c], [], [2026]);
    expect(check.overlaps).toHaveLength(1);
    expect(check.overlaps[0]).toMatchObject({ start: '2026-10-15', end: '2026-10-19', days: 5, approval: null });
    const ok: LeaveApproval = { id: 'x', kind: 'overlap', leaveA: b.id!, leaveB: a.id!, note: null, createdAt: '' };   // either order
    expect(checkControllerLeave(people, [a, b, c], [ok], [2026]).overlaps[0].approval).toBe(ok);
  });
  it('a sick leave overlapping counts too (it is about cover)', () => {
    const check = checkControllerLeave(people, [lv('yaser', '2026-10-08', '2026-10-19'), lv('jasem', '2026-10-10', '2026-10-11', 'sick_leave')], [], [2026]);
    expect(check.overlaps).toHaveLength(1);
  });
  it('per year: annual leaves counted, the 5th needs approval, total days against 25', () => {
    const recs = ['01', '03', '05', '07', '09'].map((m) => lv('jasem', `2027-${m}-01`, `2027-${m}-04`));
    recs.push(lv('jasem', '2027-11-01', '2027-11-02', 'sick_leave'));
    const y = checkControllerLeave(people, recs, [], [2027]).people.find((x) => x.person.id === 'jasem')!.years[0];
    expect(y).toMatchObject({ year: 2027, count: 5, days: 20 });
    expect(y.extras.map((e) => [e.nth, e.period.start])).toEqual([[5, '2027-09-01']]);
  });
  it('open issues: only unapproved ones not already over', () => {
    const a = lv('yaser', '2026-03-01', '2026-03-10'), b = lv('jasem', '2026-03-05', '2026-03-12');
    const c = lv('yaser', '2026-12-01', '2026-12-10'), d = lv('vr', '2026-12-05', '2026-12-06');
    const issues = openIssues(checkControllerLeave(people, [a, b, c, d], [], [2026]), '2026-09-25');
    expect(issues.overlaps.map((o) => o.start)).toEqual(['2026-12-05']);
  });
});
