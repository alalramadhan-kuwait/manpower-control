import { describe, expect, it, vi } from 'vitest';
vi.mock('@/data/supabase', () => ({ supabase: {} }));
import { leaveImpact } from '../leaveTools';
import { releaseAbsence } from '@/data/releases';
import { FULL_OPERATION, type MpAbsence, type MpPerson } from '@/core/manpower';
import type { ManpowerInputs } from '@/data/manpower';
import type { Crew } from '@/core/roster';

// 23 Sep 2026: A = Morning. Crew A has exactly the Field minimum (6).
const DAY = '2026-09-23';
let seq = 0;
const person = (crew: Crew, role: MpPerson['role'], grade: number): MpPerson => ({
  id: `p${++seq}`, employeeNumber: String(10000 + seq), name: `${role}-${seq}`, role, crew, grade, employmentType: 'knpc',
  takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null
});
const people = [person('A', 'controller', 16), ...[14, 13, 13, 13].map((g) => person('A', 'panel_operator', g)), ...Array.from({ length: 7 }, () => person('A', 'field_operator', 11))];
const leave: MpAbsence = { id: 'lv1', employeeId: people[5].id, start: '2026-10-01', end: '2026-10-01', status: 'approved', typeCode: 'annual_leave_planned', typeLabel: 'Planned Annual Leave', inCurrentPlan: true };
const release = releaseAbsence({ id: 'tr1', employee_id: people[6].id, start_date: DAY, end_date: DAY });
const inputs = { people, absences: [leave], absencesAll: [leave, release], assignments: [], rules: () => FULL_OPERATION } as unknown as ManpowerInputs;

describe('moving a leave: task releases count as away', () => {
  it('a Field Operator moved onto a day another is released to a task leaves the crew short', () => {
    const r = leaveImpact(people[5], [leave], inputs, [], DAY, DAY, '2026-09-01');
    expect(r.dates).toEqual([DAY]);
    expect(r.short).toBe(1);
  });
  it('without the release the same move keeps the minimum', () => {
    const r = leaveImpact(people[5], [leave], { ...inputs, absencesAll: [leave] }, [], DAY, DAY, '2026-09-01');
    expect(r.dates).toEqual([]);
  });
});
