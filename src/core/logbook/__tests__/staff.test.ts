import { describe, expect, it } from 'vitest';
import { evaluateDay } from '../../manpower';
import type { MpAbsence, MpPerson } from '../../manpower';
import type { Crew } from '../../roster';
import { compareStaff } from '../staff';
import type { StaffRow } from '../parse';

// 23 Sep 2026: A = Morning, C = Afternoon, B = Night, D = Off. Made-up people.
const DAY = '2026-09-23';
let seq = 0;
const person = (crew: Crew, role: MpPerson['role']): MpPerson => {
  seq++;
  return { id: `p${seq}`, employeeNumber: String(80000 + seq), name: `Person ${seq}`, role, crew, grade: role === 'controller' ? 16 : 13,
    employmentType: 'knpc', takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null };
};
const row = (p: MpPerson, role: string): StaffRow => ({ role, empNo: p.employeeNumber, name: p.name.toUpperCase(), position: role === 'Controller' ? 'Controller' : 'Operator I', area: 'TR1' });

describe('compareStaff', () => {
  const ctl = person('A', 'controller'), pa = person('A', 'panel_operator'), pb = person('A', 'panel_operator');
  const fa = person('A', 'field_operator'), fb = person('A', 'field_operator'), fc = person('A', 'field_operator');
  const otherCrew = person('B', 'field_operator');
  const people = [ctl, pa, pb, fa, fb, fc, otherCrew];
  const leave: MpAbsence = { employeeId: fc.id, start: DAY, end: DAY, status: 'approved', typeCode: 'sick', typeLabel: 'Sick leave', inCurrentPlan: true };
  const day = evaluateDay(DAY, people, [leave]);
  const log = { date: DAY, shift: 'Morning', crew: 'A', manpower: [row(ctl, 'Controller'), row(pa, 'Panel Operator'), row(fa, 'Field Operator'), row(otherCrew, 'Field Operator'),
    { role: 'Field Operator', empNo: '700001', name: 'CONTRACTOR NAME', position: 'Operator, Field', area: 'LP' }] };
  const r = compareStaff(log, day, people)!;

  it('names the controller as planned for the crew', () => {
    expect(r.onRota).toBe(true);
    expect(r.controllers).toEqual([expect.objectContaining({ empNo: ctl.employeeNumber, name: ctl.name, how: 'planned' })]);
  });
  it('splits planned people into present, not in the log and on leave', () => {
    expect(r.present.map((x) => x.empNo).sort()).toEqual([ctl, pa, fa].map((p) => p.employeeNumber).sort());
    expect(r.missing.map((x) => x.empNo).sort()).toEqual([pb, fb].map((p) => p.employeeNumber).sort());
    expect(r.leave).toEqual([expect.objectContaining({ empNo: fc.employeeNumber, type: 'Sick leave' })]);
  });
  it('shows people from another crew and people not in the roster as extra', () => {
    expect(r.extra).toEqual([
      expect.objectContaining({ empNo: otherCrew.employeeNumber, homeCrew: 'B', inRoster: true }),
      expect.objectContaining({ empNo: '700001', name: 'Contractor Name', homeCrew: null, inRoster: false }),
    ]);
  });
  it('says nothing when the log has no Manpower section', () => {
    expect(compareStaff({ ...log, manpower: [] }, day, people)).toBeNull();
  });
});
