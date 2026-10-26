import { describe, expect, it, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { controllerCover } from '../validation';
import { gateVerdict } from '@/core/requests/gate';
import { DEFAULT_RULES, ruleOf, type ProposalInputs, type RuleConfig } from '@/core/validation';
import { FULL_OPERATION, type MpAbsence, type MpPerson } from '@/core/manpower';
import type { ManpowerInputs } from '../manpower';
import type { Crew } from '@/core/roster';

// 23 Sep 2026: A = Morning, C = Afternoon, B = Night, D = Off.
const DAY = '2026-09-23';
let seq = 0;
const person = (crew: Crew, role: MpPerson['role'], grade: number): MpPerson => ({
  id: `p${++seq}`, employeeNumber: String(10000 + seq), name: `${role}-${seq}`, role, crew, grade, employmentType: 'knpc',
  takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null
});
const crewOf = (c: Crew) => [person(c, 'controller', 16), ...[14, 13, 13, 13].map((g) => person(c, 'panel_operator', g)), ...Array.from({ length: 7 }, () => person(c, 'field_operator', 11))];
const leave = (p: MpPerson, start: string, end: string): MpAbsence =>
  ({ employeeId: p.id, start, end, status: 'approved', typeCode: 'annual_leave_planned', typeLabel: 'Planned Annual Leave', inCurrentPlan: true });

const people = [...crewOf('A'), ...crewOf('B')];
const inp = { rules: () => FULL_OPERATION } as unknown as ManpowerInputs;
const base: ProposalInputs = { people, absences: [], assignments: [] };
const run = (after: MpAbsence[], before: MpAbsence[] = [], rules: RuleConfig[] = DEFAULT_RULES) =>
  controllerCover(inp, { ...base, absences: before }, { ...base, absences: after }, DAY, DAY, rules);

describe('request check: Controller cover needed', () => {
  it('a Controller leave with no cover gives a warning for that crew', () => {
    const f = run([leave(people[0], DAY, DAY)]);
    expect(f).toEqual([expect.objectContaining({ rule: 'controller_coverage', severity: 'warning', date: DAY, key: 'cover:A' })]);
    expect(f[0].message).toBe('A Shift: Controller cover needed on 1 duty, from 23/9.');
  });
  it('nothing new when the crew already needed cover, or the leave is not a Controller', () => {
    expect(run([leave(people[0], DAY, DAY)], [leave(people[0], DAY, DAY)])).toEqual([]);
    expect(run([leave(people[5], DAY, DAY)])).toEqual([]);
  });
  it('switched off from the rules table like every other check', () => {
    expect(run([leave(people[0], DAY, DAY)], [], [{ ...ruleOf(DEFAULT_RULES, 'controller_coverage'), enabled: false }])).toEqual([]);
  });
  it('never blocks the decision', () => {
    expect(gateVerdict(run([leave(people[0], DAY, DAY)]), false)).toMatchObject({ allowed: true, blocking: [] });
  });
});
