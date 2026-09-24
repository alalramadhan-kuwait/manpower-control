import { describe, expect, it } from 'vitest';
import { evaluateDay, FULL_OPERATION, personOn, statusFor } from '..';
import type { MpAbsence, MpAssignment, MpPerson } from '..';
import type { Crew } from '../../roster';

// 23 Sep 2026: A = Morning M2, C = Afternoon A2, B = Night N2, D = Off 2.
const DAY = '2026-09-23';

let seq = 0;
function person(crew: Crew | null, role: MpPerson['role'], over: Partial<MpPerson> = {}): MpPerson {
  seq++;
  return {
    id: `p${seq}`, employeeNumber: String(10000 + seq), name: `${role}-${crew ?? 'x'}-${seq}`, role, crew,
    grade: role === 'controller' ? 16 : role === 'panel_operator' ? 13 : role === 'field_operator' ? 11 : 16,
    employmentType: 'knpc', takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null,
    ...over
  };
}
/** A crew with 1 Controller (G16), `panel` Panel Operators (first one Grade 14) and `field` Take-Charge Field Operators. */
function crewOf(crew: Crew, panel = 4, field = 7): MpPerson[] {
  return [
    person(crew, 'controller'),
    ...Array.from({ length: panel }, (_, i) => person(crew, 'panel_operator', { grade: i === 0 ? 14 : 13 })),
    ...Array.from({ length: field }, () => person(crew, 'field_operator'))
  ];
}
const leave = (p: MpPerson, start: string, end: string, over: Partial<MpAbsence> = {}): MpAbsence =>
  ({ employeeId: p.id, start, end, status: 'approved', typeCode: 'annual_leave_planned', typeLabel: 'Planned Annual Leave', inCurrentPlan: true, ...over });
const crewResult = (r: ReturnType<typeof evaluateDay>, c: Crew) => r.crews.find((x) => x.crew === c)!;

describe('status thresholds', () => {
  it('GREEN above minimum, AMBER exactly minimum, RED below', () => {
    expect(statusFor(4, 3)).toBe('green');
    expect(statusFor(3, 3)).toBe('amber');
    expect(statusFor(2, 3)).toBe('red');
  });
  it('uses the full-operation minimums 1 / 3 / 6', () => {
    expect(FULL_OPERATION).toMatchObject({ controllerMin: 1, panelMin: 3, fieldMin: 6, controllerGrade: 15, actingControllerGrade: 14, panelGrade14: 14 });
  });
});

describe('day layout', () => {
  it('orders crews Morning, Afternoon, Night, Off and marks the Off crew', () => {
    const r = evaluateDay(DAY, [...crewOf('A'), ...crewOf('B'), ...crewOf('C'), ...crewOf('D')], []);
    expect(r.crews.map((c) => `${c.crew}:${c.duty}`)).toEqual(['A:M2', 'C:A2', 'B:N2', 'D:Off2']);
    const off = crewResult(r, 'D');
    expect(off.working).toBe(false);
    expect(off.status).toBeNull();
  });
});

describe('Controller rule', () => {
  it('one Grade 15+ Controller = 1/1 GREEN: one Controller is the normal complement, not No Buffer', () => {
    const c = crewResult(evaluateDay(DAY, crewOf('A'), []), 'A');
    expect(c.controller).toMatchObject({ count: 1, min: 1, status: 'green', finding: 'staffed', final: true, acting: null });
    expect(c.status).toBe('green');
    expect(c.noBuffer).toBe(false);
  });
  it('the Controller exception is a rule: without it 1/1 would be AMBER No Buffer', () => {
    const c = crewResult(evaluateDay(DAY, crewOf('A'), [], { ...FULL_OPERATION, controllerGreenAtMinimum: false }), 'A');
    expect(c.controller).toMatchObject({ status: 'amber', finding: 'no_buffer' });
  });
  it('Panel and Field exactly at minimum stay AMBER No Buffer', () => {
    const c = crewResult(evaluateDay(DAY, crewOf('A', 3, 6), []), 'A');
    expect(c.panel).toMatchObject({ status: 'amber', finding: 'no_buffer' });
    expect(c.field).toMatchObject({ status: 'amber', finding: 'no_buffer' });
    expect(c.status).toBe('amber');
    expect(c.noBuffer).toBe(true);
  });
  it('Grade 14 without Acting Controller qualification does not count → RED', () => {
    const people = crewOf('A'); people[0].grade = 14;
    const c = crewResult(evaluateDay(DAY, people, []), 'A');
    expect(c.controller.count).toBe(0);
    expect(c.controller.status).toBe('red');
    expect(c.controller.notCounted[0].reason).toContain('Grade 14');
  });
  it('qualified Grade 14 counts and is shown as Acting Controller', () => {
    const people = crewOf('A'); people[0].grade = 14; people[0].actingController = 'yes';
    const c = crewResult(evaluateDay(DAY, people, []), 'A');
    expect(c.controller).toMatchObject({ count: 1, status: 'green', finding: 'staffed' });
    expect(c.controller.acting?.id).toBe(people[0].id);
    expect(c.controller.issues[0]).toContain('Acting Controller');
  });
  it('Grade 13 can never be Controller', () => {
    const people = crewOf('A'); people[0].grade = 13; people[0].actingController = 'yes';
    expect(crewResult(evaluateDay(DAY, people, []), 'A').controller.count).toBe(0);
  });
  it('Controller on leave on a working day → 0/1 RED', () => {
    const people = crewOf('A');
    const c = crewResult(evaluateDay(DAY, people, [leave(people[0], '2026-09-20', '2026-09-30')]), 'A');
    expect(c.controller).toMatchObject({ count: 0, status: 'red' });
    expect(c.status).toBe('red');
    expect(c.absences).toHaveLength(1);
    expect(c.absences[0].reducesManpower).toBe(true);
  });
  it('draws a qualified Grade 14 Panel Operator as Acting Controller and removes them from Panel', () => {
    const people = crewOf('A', 5);
    const g14 = people[1]; g14.actingController = 'yes';
    people[2].grade = 14; // second Grade 14 keeps the Panel rule satisfied
    const c = crewResult(evaluateDay(DAY, people, [leave(people[0], DAY, DAY)]), 'A');
    expect(c.controller.acting?.id).toBe(g14.id);
    expect(c.controller.count).toBe(1);
    expect(c.panel.count).toBe(4);
    expect(c.panel.counted.map((p) => p.id)).not.toContain(g14.id);
    expect(c.panel.grade14).toBe(1);
  });
});

describe('Panel rule', () => {
  it('4 qualified incl. one Grade 14 → GREEN', () => {
    expect(crewResult(evaluateDay(DAY, crewOf('A', 4), []), 'A').panel).toMatchObject({ count: 4, status: 'green', grade14: 1 });
  });
  it('3 qualified incl. one Grade 14 → AMBER', () => {
    expect(crewResult(evaluateDay(DAY, crewOf('A', 3), []), 'A').panel).toMatchObject({ count: 3, status: 'amber' });
  });
  it('3/3 but Grade 14 = 0 → RED', () => {
    const people = crewOf('A', 3); people[1].grade = 13;
    const p = crewResult(evaluateDay(DAY, people, []), 'A').panel;
    expect(p).toMatchObject({ count: 3, grade14: 0, status: 'red' });
    expect(p.issues.join(' ')).toContain('Grade 14');
  });
  it('the only Grade 14 on leave → RED even with 3 left', () => {
    const people = crewOf('A', 4);
    const p = crewResult(evaluateDay(DAY, people, [leave(people[1], DAY, DAY)]), 'A').panel;
    expect(p).toMatchObject({ count: 3, grade14: 0, status: 'red' });
  });
  it('a Grade 15 Panel Operator satisfies the Grade 14 requirement', () => {
    const people = crewOf('A', 3); people[1].grade = 15;
    expect(crewResult(evaluateDay(DAY, people, []), 'A').panel).toMatchObject({ grade14: 1, status: 'amber' });
  });
  it('2 qualified → RED', () => {
    expect(crewResult(evaluateDay(DAY, crewOf('A', 2), []), 'A').panel.status).toBe('red');
  });
  it('unqualified Panel Operators are listed but not counted; contractors count when qualified', () => {
    const people = crewOf('A', 3);
    people[3].employmentType = 'contractor'; people[3].grade = null;
    const extra = person('A', 'panel_operator', { panelQualified: 'not_yet_confirmed' });
    const p = crewResult(evaluateDay(DAY, [...people, extra], []), 'A').panel;
    expect(p.count).toBe(3);
    expect(p.counted.map((x) => x.id)).toContain(people[3].id);
    expect(p.notCounted).toEqual([{ person: extra, reason: 'Panel qualification not yet confirmed', pendingData: true }]);
  });
});

describe('Field rule (only Take-Charge = Yes counts)', () => {
  it('7 → GREEN, 6 → AMBER, 5 → RED', () => {
    expect(crewResult(evaluateDay(DAY, crewOf('A', 4, 7), []), 'A').field.status).toBe('green');
    expect(crewResult(evaluateDay(DAY, crewOf('A', 4, 6), []), 'A').field.status).toBe('amber');
    expect(crewResult(evaluateDay(DAY, crewOf('A', 4, 5), []), 'A').field.status).toBe('red');
  });
  it('Not Yet Confirmed and No do not count, whatever the grade', () => {
    const people = crewOf('A', 4, 9);
    people.filter((p) => p.role === 'field_operator').slice(0, 4).forEach((p, i) => { p.takeCharge = i === 0 ? 'no' : 'not_yet_confirmed'; p.grade = 14; });
    const f = crewResult(evaluateDay(DAY, people, []), 'A').field;
    expect(f).toMatchObject({ count: 5, status: 'red' });
    expect(f.notCounted.map((n) => n.reason).sort()).toEqual(['Take-Charge = No', 'Take-Charge not yet confirmed', 'Take-Charge not yet confirmed', 'Take-Charge not yet confirmed']);
  });
  it('current data shape: 9 on duty, none confirmed → 0/6 RED', () => {
    const people = crewOf('A', 4, 9);
    people.forEach((p) => { if (p.role === 'field_operator') p.takeCharge = 'not_yet_confirmed'; });
    const c = crewResult(evaluateDay(DAY, people, []), 'A');
    expect(c.field).toMatchObject({ count: 0, status: 'red' });
    expect(c.field.notCounted).toHaveLength(9);
    expect(c.status).toBe('red');
  });
});

describe('leave and absences', () => {
  it('approved leave reduces manpower only on scheduled working days', () => {
    // Crew D is Off on 22–23 Sep 2026 and works Morning on 24 Sep.
    const people = crewOf('D', 4, 7);
    const f = people.filter((p) => p.role === 'field_operator')[0];
    const abs = [leave(f, '2026-09-22', '2026-09-24')];
    const offDay = crewResult(evaluateDay(DAY, people, abs), 'D');
    expect(offDay.working).toBe(false);
    expect(offDay.absences[0].reducesManpower).toBe(false);
    const workDay = crewResult(evaluateDay('2026-09-24', people, abs), 'D');
    expect(workDay.duty).toBe('M1');
    expect(workDay.field.count).toBe(6);
    expect(workDay.absences[0].reducesManpower).toBe(true);
  });
  it('unresolved absences are warnings only and never reduce manpower', () => {
    const people = crewOf('A', 3, 6);
    const abs = people.map((p) => leave(p, DAY, DAY, { status: 'unresolved', typeCode: null }));
    const c = crewResult(evaluateDay(DAY, people, abs), 'A');
    expect(c.unresolved).toHaveLength(people.length);
    expect(c.absences).toHaveLength(0);
    expect([c.controller.count, c.panel.count, c.field.count]).toEqual([1, 3, 6]);
    expect(c.status).toBe('amber');
  });
  it('rescheduled, cancelled and original-plan-only records are ignored', () => {
    const people = crewOf('A', 3, 6);
    const [ctrl, p1, , , f1] = people;
    const abs = [
      leave(ctrl, DAY, DAY, { status: 'rescheduled', inCurrentPlan: false }),
      leave(p1, DAY, DAY, { status: 'cancelled', inCurrentPlan: false }),
      leave(f1, DAY, DAY, { inCurrentPlan: false })
    ];
    const c = crewResult(evaluateDay(DAY, people, abs), 'A');
    expect([c.controller.count, c.panel.count, c.field.count]).toEqual([1, 3, 6]);
    expect(c.absences).toHaveLength(0);
  });
  it('leave outside the date has no effect', () => {
    const people = crewOf('A');
    const c = crewResult(evaluateDay(DAY, people, [leave(people[0], '2026-09-24', '2026-09-30')]), 'A');
    expect(c.controller.count).toBe(1);
  });
});

describe('overall status', () => {
  it('crew status is the worst of its positions; day status is the worst working crew; Off crew ignored', () => {
    const a = crewOf('A', 4, 7); // all green
    const b = crewOf('B', 3, 7); // Panel exactly at minimum: amber
    const c = crewOf('C', 4, 7);
    const d = crewOf('D', 0, 0); // Off crew with no one: must not affect the day
    const r = evaluateDay(DAY, [...a, ...b, ...c, ...d], []);
    expect(r.crews.filter((x) => x.working).map((x) => `${x.crew}:${x.status}`)).toEqual(['A:green', 'C:green', 'B:amber']);
    expect(r.overall).toBe('amber');
    expect(r.noBuffer).toBe(true);
    const withLeave = evaluateDay(DAY, [...a, ...b, ...c, ...d], [leave(b[0], DAY, DAY)]);
    expect(crewResult(withLeave, 'B').status).toBe('red');
    expect(withLeave.overall).toBe('red');
  });
  it('lists VR and Morning Controllers as day staff, not as crew manpower', () => {
    const vr = person(null, 'vr_controller'); const mc = person(null, 'morning_controller', { grade: 15 });
    const r = evaluateDay(DAY, [...crewOf('A'), vr, mc], [leave(vr, DAY, DAY)]);
    expect(r.dayStaff.map((s) => [s.person.role, s.absence ? 'on leave' : 'available'])).toEqual([['vr_controller', 'on leave'], ['morning_controller', 'available']]);
    expect(crewResult(r, 'A').controller.count).toBe(1);
  });
});

describe('Stage B refinement: confirmed shortage vs pending findings', () => {
  it('Controller on leave with no cover = Controller Coverage Required, not a final failure', () => {
    const people = crewOf('A');
    const r = evaluateDay(DAY, people, [leave(people[0], DAY, DAY)]);
    const c = crewResult(r, 'A');
    expect(c.controller).toMatchObject({ count: 0, status: 'red', finding: 'coverage_required', final: false, provisionalStatus: 'green' });
    expect(c.controller.onLeave.map((p) => p.id)).toEqual([people[0].id]);
    expect(c.controller.issues[0]).toContain('Controller coverage required');
    expect(c.confirmedShortage).toBe(false);
    expect(c.pending).toEqual(['coverage_required']);
    expect(c.finalStatus).toBeNull();
    expect(c.provisionalStatus).toBe('green');
    expect(r.counts.coverageRequired).toBe(1);
  });
  it('no qualified Controller in the crew at all (not on leave) = confirmed shortage', () => {
    const people = crewOf('A'); people[0].grade = 13;
    const c = crewResult(evaluateDay(DAY, people, []), 'A');
    expect(c.controller).toMatchObject({ finding: 'shortage', final: true });
    expect(c.finalStatus).toBe('red');
    expect(c.confirmedShortage).toBe(true);
  });
  it('Acting Controller is never inferred: Grade 14 without a recorded qualification does not act', () => {
    const people = crewOf('A', 5);
    people[1].actingController = null; people[2].actingController = 'not_yet_confirmed';
    const c = crewResult(evaluateDay(DAY, people, [leave(people[0], DAY, DAY)]), 'A');
    expect(c.controller.acting).toBeNull();
    expect(c.controller.finding).toBe('coverage_required');
  });
  it('an explicitly recorded Acting Controller resolves the coverage need (final result)', () => {
    const people = crewOf('A', 5); people[1].actingController = 'yes'; people[2].grade = 14;
    const c = crewResult(evaluateDay(DAY, people, [leave(people[0], DAY, DAY)]), 'A');
    expect(c.controller).toMatchObject({ finding: 'staffed', status: 'green', final: true });
    expect(c.controller.acting?.id).toBe(people[1].id);
    expect(c.pending).toEqual([]);
    expect(c.finalStatus).toBe('green');
  });
  it('Field below minimum only because Take-Charge is not confirmed = Qualification Data Incomplete', () => {
    const people = crewOf('A', 4, 9);
    people.forEach((p) => { if (p.role === 'field_operator') p.takeCharge = 'not_yet_confirmed'; });
    const c = crewResult(evaluateDay(DAY, people, []), 'A');
    expect(c.field).toMatchObject({ count: 0, potential: 9, status: 'red', finding: 'data_incomplete', final: false, provisionalStatus: 'green' });
    expect(c.field.issues[0]).toContain('data incomplete');
    expect(c.finalStatus).toBeNull();
    expect(c.pending).toEqual(['data_incomplete']);
    expect(c.confirmedShortage).toBe(false);
  });
  it('Not Yet Confirmed still never counts toward manpower', () => {
    const people = crewOf('A', 4, 9);
    people.forEach((p) => { if (p.role === 'field_operator') p.takeCharge = 'not_yet_confirmed'; });
    expect(crewResult(evaluateDay(DAY, people, []), 'A').field.count).toBe(0);
  });
  it('even with every unconfirmed person counted it is short = confirmed shortage', () => {
    const people = crewOf('A', 4, 5);
    people.filter((p) => p.role === 'field_operator').slice(0, 2).forEach((p) => { p.takeCharge = 'not_yet_confirmed'; });
    const c = crewResult(evaluateDay(DAY, people, []), 'A');
    expect(c.field).toMatchObject({ count: 3, potential: 5, finding: 'shortage', final: true });
    expect(c.finalStatus).toBe('red');
  });
  it('Take-Charge = No is not missing data: 5 Yes + 2 No is a confirmed shortage', () => {
    const people = crewOf('A', 4, 7);
    people.filter((p) => p.role === 'field_operator').slice(0, 2).forEach((p) => { p.takeCharge = 'no'; });
    expect(crewResult(evaluateDay(DAY, people, []), 'A').field.finding).toBe('shortage');
  });
  it('Panel with unconfirmed qualification that would meet the rule = data incomplete; Grade 14 missing outright = shortage', () => {
    const a = crewOf('A', 3); a[2].panelQualified = 'not_yet_confirmed';
    expect(crewResult(evaluateDay(DAY, a, []), 'A').panel).toMatchObject({ count: 2, potential: 3, finding: 'data_incomplete' });
    const b = crewOf('A', 3); b[1].grade = 13;
    expect(crewResult(evaluateDay(DAY, b, []), 'A').panel).toMatchObject({ grade14: 0, potentialGrade14: 0, finding: 'shortage' });
  });
  it('a confirmed shortage makes the crew RED even while other items are pending', () => {
    const people = crewOf('A', 2, 9);
    people.forEach((p) => { if (p.role === 'field_operator') p.takeCharge = 'not_yet_confirmed'; });
    const c = crewResult(evaluateDay(DAY, people, [leave(people[0], DAY, DAY)]), 'A');
    expect(c.panel.finding).toBe('shortage');
    expect(c.pending.sort()).toEqual(['coverage_required', 'data_incomplete']);
    expect(c.finalStatus).toBe('red');
    expect(c.confirmedShortage).toBe(true);
  });
  it('unresolved absences stay a separate warning category and change no finding', () => {
    const people = crewOf('A', 4, 7);
    const r = evaluateDay(DAY, people, [leave(people[0], DAY, DAY, { status: 'unresolved', typeCode: null })]);
    const c = crewResult(r, 'A');
    expect(c.controller.finding).toBe('staffed');
    expect(c.finalStatus).toBe('green');
    expect(r.counts.unresolvedWarnings).toBe(1);
  });
  it('day status: final only when nothing is pending', () => {
    const all = [...crewOf('A'), ...crewOf('B'), ...crewOf('C'), ...crewOf('D')];
    expect(evaluateDay(DAY, all, []).finalStatus).toBe('green');
    const ctrlB = all.find((p) => p.crew === 'B' && p.role === 'controller')!;
    const r = evaluateDay(DAY, all, [leave(ctrlB, DAY, DAY)]);
    expect(r.finalStatus).toBeNull();
    expect(r.provisionalStatus).toBe('green');
    expect(r.counts).toMatchObject({ confirmedShortage: 0, coverageRequired: 1, dataIncomplete: 0 });
  });
});

describe('Controller Management assignments', () => {
  const vr = () => person(null, 'vr_controller', { grade: 16 });
  const cover = (who: MpPerson, crew: Crew, over: Partial<MpAssignment> = {}): MpAssignment =>
    ({ id: `as-${who.id}`, kind: 'shift_cover', employeeId: who.id, crew, start: DAY, end: DAY, ...over });

  it('a VR covering a crew whose Controller is on leave makes the Controller line staffed (final GREEN)', () => {
    const a = crewOf('A'); const v = vr();
    const c = crewResult(evaluateDay(DAY, [...a, v], [leave(a[0], DAY, DAY)], FULL_OPERATION, [cover(v, 'A')]), 'A');
    expect(c.controller).toMatchObject({ count: 1, finding: 'staffed', final: true, status: 'green' });
    expect(c.controller.cover).toMatchObject({ counted: true });
    expect(c.controller.cover!.person.id).toBe(v.id);
    expect(c.controller.issues).toContain(`Covered by ${v.name}`);
    expect(c.pending).toEqual([]);
  });
  it('a recorded cover who is on leave does not count: coverage required, and the reason says so', () => {
    const a = crewOf('A'); const v = vr();
    const c = crewResult(evaluateDay(DAY, [...a, v], [leave(a[0], DAY, DAY), leave(v, DAY, DAY)], FULL_OPERATION, [cover(v, 'A')]), 'A');
    expect(c.controller.finding).toBe('coverage_required');
    expect(c.controller.cover).toMatchObject({ counted: false });
    expect(c.controller.issues.join(' ')).toContain('is on leave');
  });
  it('a cover is used before a Grade-14 Acting Controller, so Panel and Field keep their people', () => {
    const a = crewOf('A', 4); a[1].actingController = 'yes'; const v = vr();
    const c = crewResult(evaluateDay(DAY, [...a, v], [leave(a[0], DAY, DAY)], FULL_OPERATION, [cover(v, 'A')]), 'A');
    expect(c.controller.acting).toBeNull();
    expect(c.panel.count).toBe(4);
  });
  it('a crew Controller on Morning rotation is away from the crew (coverage required) and holds the Morning post', () => {
    const a = crewOf('A'); const mc = person(null, 'morning_controller', { grade: 15 });
    const rot: MpAssignment = { id: 'r1', kind: 'morning_rotation', employeeId: a[0].id, crew: null, start: DAY, end: DAY };
    const r = evaluateDay(DAY, [...a, mc], [], FULL_OPERATION, [rot]);
    const c = crewResult(r, 'A');
    expect(c.controller.finding).toBe('coverage_required');
    expect(c.controller.away.map((w) => w.person.id)).toEqual([a[0].id]);
    expect(c.controller.issues.join(' ')).toContain('Morning rotation');
    expect(r.dayStaff.find((s) => s.person.id === a[0].id)).toMatchObject({ morningPost: true });
    expect(r.dayStaff.find((s) => s.person.id === mc.id)).toMatchObject({ morningPost: false });
  });
  it('a Controller covering another crew leaves their own working crew needing cover', () => {
    const a = crewOf('A'); const c = crewOf('C');
    const r = evaluateDay(DAY, [...a, ...c], [leave(a[0], DAY, DAY)], FULL_OPERATION, [cover(c[0], 'A')]);
    expect(crewResult(r, 'A').controller.finding).toBe('staffed');
    expect(crewResult(r, 'C').controller.finding).toBe('coverage_required');
  });
  it('an assignment outside its dates has no effect', () => {
    const a = crewOf('A'); const v = vr();
    const c = crewResult(evaluateDay(DAY, [...a, v], [leave(a[0], DAY, DAY)], FULL_OPERATION, [cover(v, 'A', { start: '2026-10-01', end: '2026-10-10' })]), 'A');
    expect(c.controller.finding).toBe('coverage_required');
    expect(c.controller.cover).toBeNull();
  });
});

describe('Morning Controller post', () => {
  const mc = () => person(null, 'morning_controller', { grade: 15 });
  it('is held by the Morning Controller on a normal day', () => {
    const m = mc(); const r = evaluateDay(DAY, [...crewOf('A'), m], []);
    expect(r.morningPost).toMatchObject({ status: 'held', viaRotation: false }); expect(r.morningPost.holder?.id).toBe(m.id);
    expect(r.counts.morningCoverageRequired).toBe(0);
  });
  it('is never silently empty: covering a shift makes it "coverage required"', () => {
    const a = crewOf('A'); const m = mc();
    const r = evaluateDay(DAY, [...a, m], [leave(a[0], DAY, DAY)], FULL_OPERATION, [{ id: 'c', kind: 'shift_cover', employeeId: m.id, crew: 'A', start: DAY, end: DAY }]);
    expect(r.morningPost).toMatchObject({ status: 'coverage_required', holder: null });
    expect(r.counts.morningCoverageRequired).toBe(1);
    expect(crewResult(r, 'A').controller.finding).toBe('staffed');
  });
  it('a Morning rotation fills the post', () => {
    const a = crewOf('A'); const d = crewOf('D'); const m = mc();
    const r = evaluateDay(DAY, [...a, ...d, m], [leave(a[0], DAY, DAY)], FULL_OPERATION, [
      { id: 'c', kind: 'shift_cover', employeeId: m.id, crew: 'A', start: DAY, end: DAY },
      { id: 'r', kind: 'morning_rotation', employeeId: d[0].id, crew: null, start: DAY, end: DAY }]);
    expect(r.morningPost).toMatchObject({ status: 'held', viaRotation: true }); expect(r.morningPost.holder?.id).toBe(d[0].id);
  });
});

describe('shift movements (Stage G): role and crew by date', () => {
  it('a permanent move counts the person in the old crew before the date and in the new crew from it', () => {
    const c = crewOf('C', 4, 7), d = crewOf('D', 4, 6);
    const mover = { ...c[5], history: [{ from: '2026-01-01', to: '2026-02-28', role: 'field_operator' as const, crew: 'C' as const }, { from: '2026-03-01', to: null, role: 'field_operator' as const, crew: 'D' as const }], crew: 'D' as const };
    const people = [...c.filter((p) => p.id !== mover.id), mover, ...d];
    // both crews work on 28 Feb (C N1, D M1) and on 1 Mar (C N2, D M2)
    const feb = evaluateDay('2026-02-28', people, []);
    const mar = evaluateDay('2026-03-01', people, []);
    expect([crewResult(feb, 'C').field.count, crewResult(feb, 'D').field.count]).toEqual([7, 6]);
    expect([crewResult(mar, 'C').field.count, crewResult(mar, 'D').field.count]).toEqual([6, 7]);
    expect(crewResult(mar, 'D').field.counted.find((p) => p.id === mover.id)?.movedFrom).toBeUndefined();
  });
  it('a temporary cover moves a crew member into the covering crew only on its dates', () => {
    const a = crewOf('A', 4, 7), b = crewOf('B', 4, 5);
    const cover = { ...a[6], moves: [{ start: '2026-09-22', end: '2026-09-25', crew: 'B' as const }] };
    const people = [...a.filter((p) => p.id !== cover.id), cover, ...b];
    const during = evaluateDay('2026-09-23', people, []); // B on Night: 5 own + the cover = 6
    expect(crewResult(during, 'B').field.count).toBe(6);
    expect(crewResult(during, 'B').field.counted.find((p) => p.id === cover.id)?.movedFrom).toBe('A');
    expect(crewResult(during, 'A').members).toBe(a.length - 1);
    const after = evaluateDay('2026-09-26', people, []);
    expect(after.crews.find((x) => x.crew === 'A')!.members).toBe(a.length);
  });
  it('an open-ended cover lasts until further notice; role history applies before and after its periods', () => {
    const b = crewOf('B', 4, 5);
    const p = { ...b[5], role: 'field_operator' as const, crew: 'B' as const, moves: [{ start: '2026-09-01', end: null, crew: 'D' as const }],
      history: [{ from: '2026-01-01', to: null, role: 'field_operator' as const, crew: 'B' as const }] };
    expect(personOn(p, '2027-06-01').crew).toBe('D');
    expect(personOn(p, '2026-08-31').crew).toBe('B');
    expect(personOn({ ...p, moves: [] }, '2025-12-31').crew).toBe('B');
  });  it('day duty takes a crew member out of their crew and counts them with the Morning crew, Sunday to Thursday', () => {
    const a = crewOf('A', 4, 7), d = crewOf('D', 4, 6);
    const dd = { ...a[6], moves: [{ start: '2026-09-20', end: null, crew: 'DAY' as const }] };
    const people = [...a.filter((p) => p.id !== dd.id), dd, ...d];
    const inCrews = (r: ReturnType<typeof evaluateDay>) => r.crews.filter((c) => [...c.controller.counted, ...c.panel.counted, ...c.field.counted].some((p) => p.id === dd.id)).map((c) => c.crew);
    const thu = evaluateDay('2026-09-24', people, []);   // Thursday: D on Morning
    expect(crewResult(thu, 'A').members).toBe(a.length - 1);
    expect(inCrews(thu)).toEqual(['D']);
    expect(crewResult(thu, 'D').field.count).toBe(7);
    expect(thu.dayDuty).toHaveLength(1);
    expect(thu.dayDuty[0]).toMatchObject({ working: true, countedIn: 'D' });
    expect(inCrews(evaluateDay('2026-09-25', people, []))).toEqual([]);   // Friday: off
    expect(thu.dayDuty[0].person.movedFrom).toBe('A');
    expect(evaluateDay('2026-09-25', people, []).dayDuty[0].working).toBe(false); // Friday
    expect(evaluateDay('2026-09-26', people, []).dayDuty[0].working).toBe(false); // Saturday
    expect(evaluateDay('2026-09-27', people, []).dayDuty[0].working).toBe(true);  // Sunday
    const before = evaluateDay('2026-09-19', people, []);
    expect(before.dayDuty).toEqual([]);
    expect(crewResult(before, 'A').members).toBe(a.length);
    expect(personOn(dd, '2026-09-24')).toMatchObject({ crew: null, dayDuty: true });
  });
});
