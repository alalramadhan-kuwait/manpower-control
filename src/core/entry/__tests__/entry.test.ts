import { describe, expect, it } from 'vitest';
import { crewImpact } from '..';
import { evaluateRange, type MpAbsence, type MpPerson } from '../../manpower';
import { CREWS, type Crew } from '../../roster';

let seq = 0;
const person = (crew: Crew, role: MpPerson['role'], grade: number): MpPerson => ({ id: `p${++seq}`, employeeNumber: String(seq), name: `P${seq}`, role, crew, grade, employmentType: 'knpc',
  takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null });
const crew = (c: Crew, field: number) => [person(c, 'controller', 16), person(c, 'panel_operator', 14), ...[1, 2].map(() => person(c, 'panel_operator', 12)), ...Array.from({ length: field }, () => person(c, 'field_operator', 10))];
const people = [...crew('A', 7), ...crew('B', 7), ...crew('C', 7), ...crew('D', 7)];
const leave = (p: MpPerson, start: string, end: string): MpAbsence => ({ employeeId: p.id, start, end, status: 'approved', typeCode: 'sick_leave', typeLabel: 'Sick', typeShort: 'SL', inCurrentPlan: true });

describe('entry: crew impact', () => {
  const from = '2026-10-12', to = '2026-10-18';
  const before = evaluateRange(from, to, people, []);
  it('one Field Operator off: his crew shows Field 7 → 6, the others unchanged', () => {
    const f = people.find((p) => p.crew === 'B' && p.role === 'field_operator')!;
    const out = crewImpact(before, evaluateRange(from, to, people, [leave(f, from, to)]), CREWS);
    const b = out.find((c) => c.crew === 'B')!;
    expect(b.changed).toBe(true);
    expect(b.positions.find((p) => p.key === 'field')).toMatchObject({ before: 7, after: 6 });
    expect(out.filter((c) => c.crew !== 'B').every((c) => !c.changed)).toBe(true);
  });
  it('below the minimum is flagged with the day', () => {
    const fs = people.filter((p) => p.crew === 'C' && p.role === 'field_operator');
    const out = crewImpact(before, evaluateRange(from, to, people, fs.slice(0, 5).map((p) => leave(p, from, to))), CREWS);
    const field = out.find((c) => c.crew === 'C')!.positions.find((p) => p.key === 'field')!;
    expect(field.after).toBe(2);
    expect(field.ok).toBe(false);
    expect(field.date).not.toBeNull();
  });
});
