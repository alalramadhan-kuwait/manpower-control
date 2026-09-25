import { describe, expect, it } from 'vitest';
import { fillWeek, leaveGroup, leaveInRange, shortfall, weekBars, weekDates, weekStartOf } from '../board';
import { evaluateDay, type MpPerson } from '../../manpower';

describe('calendar board', () => {
  const week = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
  it('bars run continuously across the week and stack when they overlap', () => {
    const bars = weekBars(week, [
      { id: 'sd', start: '2026-10-28', end: '2026-11-18' },   // before and after the week
      { id: 'cat', start: '2026-11-03', end: '2026-11-04' },
      { id: 'tr', start: '2026-11-06', end: '2026-11-06' }
    ], week);
    expect(bars.find((b) => b.item.id === 'sd')).toMatchObject({ col: 0, span: 7, lane: 0, startsHere: false, endsHere: false });
    expect(bars.find((b) => b.item.id === 'cat')).toMatchObject({ col: 2, span: 2, lane: 1, startsHere: true, endsHere: true });
    expect(bars.find((b) => b.item.id === 'tr')).toMatchObject({ col: 5, span: 1, lane: 1 });
  });
  it('fills a partial first week with the real dates', () => {
    expect(fillWeek([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])[0]).toBe('2026-09-28');
  });
  it('shortfall counts the people missing', () => {
    let n = 0;
    const p = (role: MpPerson['role'], grade: number): MpPerson => ({ id: `x${++n}`, employeeNumber: `${n}`, name: `x${n}`, role, crew: 'D', grade, employmentType: 'knpc',
      takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null });
    const d = evaluateDay('2026-09-24', [p('controller', 16), p('panel_operator', 14), p('panel_operator', 12), ...[1, 2, 3, 4, 5].map(() => p('field_operator', 10))], []);
    expect(shortfall(d.crews.find((c) => c.crew === 'D')!)).toBe(2);   // Panel 2 of 3, Field 5 of 6
  });
  it('groups leave reasons', () => {
    expect(['annual_leave_planned', 'sick_leave', 'short_leave', 'personal_qb', 'medical_absence', 'course'].map(leaveGroup))
      .toEqual(['Annual leave', 'Sick leave', 'Short leave', 'Personal Compassion Leave', 'Injury / surgery', 'Other approved absence']);
  });
  it('weeks start on Sunday', () => {
    expect(weekStartOf('2026-09-25')).toBe('2026-09-20');   // Friday
    expect(weekStartOf('2026-09-20')).toBe('2026-09-20');   // Sunday itself
    expect(weekStartOf('2027-01-01')).toBe('2026-12-27');   // across the year end
    expect(weekDates('2026-12-27')).toEqual(['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
  it('leave in a week: counted statuses only, real dates, joined per person', () => {
    const a = (employeeId: string, start: string, end: string, status = 'approved', typeShort = 'PV') => ({ employeeId, start, end, status, typeCode: 'annual_leave_planned', typeShort });
    const r = leaveInRange([
      a('p1', '2026-09-10', '2026-09-22'), a('p1', '2026-09-23', '2026-10-05'),   // back to back → one block
      a('p2', '2026-09-24', '2026-09-24', 'cancelled'),
      a('p3', '2026-09-21', '2026-09-21', 'planned', 'SL'), a('p3', '2026-09-22', '2026-09-23', 'approved', 'PV'),
      a('p4', '2026-10-01', '2026-10-03')
    ], '2026-09-20', '2026-09-26');
    expect(r).toEqual([
      { employeeId: 'p1', start: '2026-09-10', end: '2026-10-05', typeCode: 'annual_leave_planned', typeShort: 'PV' },
      { employeeId: 'p3', start: '2026-09-21', end: '2026-09-21', typeCode: 'annual_leave_planned', typeShort: 'SL' },
      { employeeId: 'p3', start: '2026-09-22', end: '2026-09-23', typeCode: 'annual_leave_planned', typeShort: 'PV' }
    ]);
  });
});
