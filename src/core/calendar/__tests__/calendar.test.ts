import { describe, expect, it } from 'vitest';
import { attentionPeriods, coverOfBlock, crewMarks, dayMark, daysInYearRange, monthWeeks, shiftMonth, summarizeMonth, yearSegment } from '..';
import { evaluateDay, evaluateRange } from '../../manpower';
import type { MpAbsence, MpPerson } from '../../manpower';
import { isWorkingDay, type Crew } from '../../roster';

let seq = 0;
function person(crew: Crew, role: MpPerson['role'], grade: number): MpPerson {
  seq++;
  return { id: `p${seq}`, employeeNumber: String(10000 + seq), name: `p${seq}`, role, crew, grade, employmentType: 'knpc',
    takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null };
}
const crew = (c: Crew, field = 7) => [person(c, 'controller', 16), person(c, 'panel_operator', 14), ...[1, 2, 3].map(() => person(c, 'panel_operator', 13)), ...Array.from({ length: field }, () => person(c, 'field_operator', 11))];
const leave = (p: MpPerson, start: string, end: string): MpAbsence => ({ employeeId: p.id, start, end, status: 'approved', typeCode: 'annual_leave_planned', typeLabel: 'PV', inCurrentPlan: true });

// 23 Sep 2026: A = Morning, C = Afternoon, B = Night, D = Off
const A = crew('A'), B = crew('B', 6), C = crew('C'), D = crew('D');
const people = [...A, ...B, ...C, ...D];

describe('month grid', () => {
  it('starts weeks on Sunday and pads days outside the month', () => {
    const w = monthWeeks(2026, 9); // 1 Sep 2026 is a Tuesday
    expect(w[0]).toEqual([null, null, '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
    expect(w.flat().filter(Boolean)).toHaveLength(30);
    expect(w.every((x) => x.length === 7)).toBe(true);
  });
  it('steps across year ends', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual([2027, 1]);
    expect(shiftMonth(2026, 1, -1)).toEqual([2025, 12]);
  });
});

describe('day marks', () => {
  it('orders crews Morning → Afternoon → Night → Off and uses the Day Overview rule', () => {
    const day = evaluateDay('2026-09-23', people, []);
    expect(crewMarks(day)).toEqual([
      { crew: 'A', shift: 'M', mark: 'green' }, { crew: 'C', shift: 'A', mark: 'green' },
      { crew: 'B', shift: 'N', mark: 'amber' }, { crew: 'D', shift: 'Off', mark: 'off' }
    ]);
    expect(dayMark(day)).toBe('amber');
  });
  it('a confirmed shortage is red; a Controller on leave with no cover is pending (grey), never red', () => {
    const short = evaluateDay('2026-09-23', people, [leave(B[6], '2026-09-20', '2026-09-25')]);
    expect(crewMarks(short).find((m) => m.crew === 'B')!.mark).toBe('red');
    const noCtrl = evaluateDay('2026-09-23', people, [leave(A[0], '2026-09-20', '2026-09-25')]);
    expect(crewMarks(noCtrl).find((m) => m.crew === 'A')!.mark).toBe('pending');
    expect(dayMark(noCtrl)).toBe('pending');
  });
  it('summarises a month per day and per crew', () => {
    const days = evaluateRange('2026-09-01', '2026-09-30', people, [leave(A[0], '2026-09-20', '2026-09-25')]);
    const all = summarizeMonth(days);
    expect(all.days).toBe(30);
    expect(all.red).toBe(0);
    expect(all.pending).toBeGreaterThan(0);
    const onlyD = summarizeMonth(days, 'D');
    expect(onlyD.days).toBe(days.filter((d) => isWorkingDay(d.date, 'D')).length);
    expect(onlyD.pending).toBe(0);
  });
});

describe('needs attention', () => {
  it('joins a crew\'s duties with the same finding into one period across its Off days', () => {
    // A's Controller away 20–25 Sep: A works 22–25 Sep (M1 M2 A1 A2); B short in the Field 23 Sep only
    const days = evaluateRange('2026-09-18', '2026-09-30', people, [leave(A[0], '2026-09-20', '2026-09-25'), leave(B[6], '2026-09-23', '2026-09-23')]);
    const list = attentionPeriods(days);
    expect(list[0]).toMatchObject({ crew: 'B', kind: 'shortage', text: 'Field 5 of 6', start: '2026-09-23', end: '2026-09-23', duties: 1 });
    const a = list.filter((x) => x.crew === 'A');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'coverage_required', duties: days.filter((d) => d.date >= '2026-09-20' && d.date <= '2026-09-25' && isWorkingDay(d.date, 'A')).length });
  });
});

describe('year strip', () => {
  it('clips blocks to the year', () => {
    expect(yearSegment('2025-12-28', '2026-01-03', 2026)).toEqual({ left: 0, width: 3 / 365 });
    expect(yearSegment('2027-01-01', '2027-01-05', 2026)).toBeNull();
    expect(daysInYearRange('2026-12-30', '2027-01-05', 2026)).toBe(2);
  });
  it('shows which Controller-leave duty days have no cover', () => {
    const duty = (d: string) => isWorkingDay(d, 'D');
    const none = coverOfBlock('2026-09-08', '2026-09-21', [], duty);
    const all = coverOfBlock('2026-09-08', '2026-09-21', [{ employeeId: 'vr', start: '2026-09-08', end: '2026-09-23' }], duty);
    const part = coverOfBlock('2026-09-08', '2026-09-21', [{ employeeId: 'vr', start: '2026-09-08', end: '2026-09-13' }], duty);
    expect(none.uncoveredDutyDays).toBeGreaterThan(0);
    expect(all).toMatchObject({ uncoveredDutyDays: 0 });
    expect(part.covers).toHaveLength(1);
    expect(part.uncoveredDutyDays).toBeGreaterThan(0);
    expect(part.uncoveredDutyDays).toBeLessThan(none.uncoveredDutyDays);
  });
});
