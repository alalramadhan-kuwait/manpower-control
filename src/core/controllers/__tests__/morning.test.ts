import { describe, expect, it } from 'vitest';
import { morningPlan, morningTurns, proposeRotations, suggestForGap } from '../morning';
import type { MpAbsence, MpAssignment, MpPerson } from '../../manpower';

const p = (id: string, role: MpPerson['role'], crew: MpPerson['crew'], grade = 16): MpPerson => ({ id, employeeNumber: id, name: id, role, crew, grade, employmentType: 'knpc', takeCharge: null, panelQualified: null, actingController: null });
const people = [p('ctlA', 'controller', 'A'), p('ctlB', 'controller', 'B'), p('vr1', 'vr_controller', null), p('vr2', 'vr_controller', null, 14)];
const rot = (id: string, who: string, start: string, end: string): MpAssignment => ({ id, kind: 'morning_rotation', employeeId: who, crew: null, start, end });

describe('Morning rotation plan', () => {
  // 1 Nov 2026 is a Sunday
  const assignments = [rot('r1', 'ctlA', '2026-11-01', '2026-11-12'), rot('r2', 'vr1', '2026-11-22', '2026-11-30')];
  const leave: MpAbsence[] = [{ employeeId: 'vr1', start: '2026-11-24', end: '2026-11-25', status: 'approved', typeCode: 'annual_leave_planned', inCurrentPlan: true }];
  const plan = morningPlan('2026-11-01', '2026-11-30', people, leave, assignments);

  it('joins days into held and empty segments, counting Sun–Thu only', () => {
    expect(plan.map((s) => [s.kind, s.employeeId, s.start, s.end, s.workdays])).toEqual([
      ['held', 'ctlA', '2026-11-01', '2026-11-12', 10],
      ['gap', null, '2026-11-13', '2026-11-21', 5],
      ['held', 'vr1', '2026-11-22', '2026-11-30', 7]
    ]);
  });
  it('counts the holder\'s leave and the duties a crew Controller\'s crew loses', () => {
    expect(plan[2].leaveDays).toBe(2);
    expect(plan[0].crewDuties?.crew).toBe('A');
    expect(plan[0].crewDuties!.duties).toBeGreaterThan(0);
    expect(plan[2].crewDuties).toBeNull();
  });
  it('a gap of only Friday and Saturday is not a gap', () => {
    const p2 = morningPlan('2026-11-01', '2026-11-14', people, [], [rot('a', 'ctlA', '2026-11-01', '2026-11-05'), rot('b', 'ctlB', '2026-11-08', '2026-11-14')]);
    expect(p2.map((s) => s.kind)).toEqual(['held', 'held']);
  });
  it('turns: Morning working days per year for Grade 15+ Controllers only', () => {
    const t = morningTurns(people, [...assignments, rot('r0', 'ctlB', '2026-12-27', '2027-01-07')], [2026, 2027]);
    expect(t.map((x) => x.person.id)).toEqual(['ctlA', 'ctlB', 'vr1']);
    expect(t.find((x) => x.person.id === 'ctlA')!.byYear).toEqual({ 2026: 10, 2027: 0 });
    expect(t.find((x) => x.person.id === 'ctlB')).toMatchObject({ byYear: { 2026: 5, 2027: 5 }, rotations: 1, lastEnd: '2027-01-07' });
  });
  it('suggests the free Controller with the fewest Morning days, capped at 2 months', () => {
    const turns = morningTurns(people, assignments, [2026, 2027]);
    const s = suggestForGap({ start: '2026-12-01', end: '2027-06-30' }, people, [], assignments, turns)!;
    expect(s.end).toBe('2027-01-31');
    expect(s.employeeId).toBe('ctlB');            // no Morning days yet (vr1 has 7, ctlA 10)
  });
  it('proposes rotations of at most 2 months that go round the Controllers', () => {
    const turns = morningTurns(people, [], [2026, 2027]);
    const r = proposeRotations([{ start: '2026-12-01', end: '2027-05-31' }], people, [], [], turns);
    expect(r.map((x) => [x.start, x.end])).toEqual([['2026-12-01', '2027-01-31'], ['2027-02-01', '2027-03-31'], ['2027-04-01', '2027-05-31']]);
    const who = r.map((x) => x.suggestion!.employeeId);
    expect(new Set(who).size).toBe(3);                  // three different Controllers, nobody twice
  });
});
