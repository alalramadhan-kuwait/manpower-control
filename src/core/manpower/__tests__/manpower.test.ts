import { describe, expect, it } from 'vitest';
import { evaluateDay, FULL_OPERATION, statusFor } from '..';
import type { MpAbsence, MpPerson } from '..';
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
  it('one Grade 15+ Controller = 1/1 AMBER (No Buffer)', () => {
    const c = crewResult(evaluateDay(DAY, crewOf('A'), []), 'A');
    expect(c.controller).toMatchObject({ count: 1, min: 1, status: 'amber', acting: null });
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
    expect(c.controller).toMatchObject({ count: 1, status: 'amber' });
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
    expect(p.notCounted).toEqual([{ person: extra, reason: 'Panel qualification not yet confirmed' }]);
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
    const a = crewOf('A', 4, 7); // green except controller amber
    const b = crewOf('B', 4, 7);
    const c = crewOf('C', 4, 7);
    const d = crewOf('D', 0, 0); // Off crew with no one: must not affect the day
    const r = evaluateDay(DAY, [...a, ...b, ...c, ...d], []);
    expect(r.crews.filter((x) => x.working).map((x) => x.status)).toEqual(['amber', 'amber', 'amber']);
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
