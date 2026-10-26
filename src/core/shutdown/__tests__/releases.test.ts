import { describe, expect, it } from 'vitest';
import { restDayShortage, type PlanCheckInput } from '../v2';
import type { SdMember } from '..';
import { FULL_OPERATION, type MpAbsence, type MpPerson } from '../../manpower';
import { RELEASE_TYPE } from '../../release';
import { DEFAULT_RULES } from '../../validation';
import type { Crew } from '../../roster';

// 23 Sep 2026: A = Morning. Crew A: 1 Controller, 4 Panel, 7 Field (one above the minimum of 6).
const DAY = '2026-09-23';
let seq = 0;
const person = (crew: Crew | null, role: MpPerson['role'], grade: number): MpPerson => ({
  id: `p${++seq}`, employeeNumber: String(10000 + seq), name: `${role}-${seq}`, role, crew, grade, employmentType: 'knpc',
  takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null
});
const crewA = [person('A', 'controller', 16), ...[14, 13, 13, 13].map((g) => person('A', 'panel_operator', g)), ...Array.from({ length: 7 }, () => person('A', 'field_operator', 11))];
const vr = person(null, 'vr_controller', 16);
const people = [...crewA, vr];
const release = (p: MpPerson): MpAbsence => ({ id: `release-${p.id}`, employeeId: p.id, start: DAY, end: DAY, status: 'approved', typeCode: RELEASE_TYPE, typeLabel: 'Task release', typeShort: 'TASK', inCurrentPlan: true });
const member = (p: MpPerson): SdMember => ({ id: `m-${p.id}`, planId: 'sd', teamId: 't', employeeId: p.id, slot: 'x', offset: 0, start: DAY, end: DAY, days: {} } as unknown as SdMember);
const input = (releases: MpAbsence[], members: SdMember[]): PlanCheckInput => ({
  plan: {} as never, teams: [], members, people, absences: [], releases, assignments: [], rules: DEFAULT_RULES, info: new Map(), plans: [], otherDuties: [],
  otEntries: new Map(), sickEntries: new Map(), exceptions: [], crewRules: FULL_OPERATION, today: '2026-09-01'
});

describe('shutdown check: task releases count against the crew minimums', () => {
  const fo = crewA[5];
  it('a rest day off the crew is fine at the minimum, short when another is released to a task', () => {
    expect(restDayShortage(input([], [member(fo)]), fo, member(fo), DAY)).toBeNull();
    expect(restDayShortage(input([release(crewA[6])], [member(fo)]), fo, member(fo), DAY)?.text).toContain('A Shift Field 5 of 6');
  });
  it('a Controller released to a task is not proposed as cover', () => {
    const ctl = crewA[0];
    expect(restDayShortage(input([], [member(ctl)]), ctl, member(ctl), DAY)?.fix?.employeeId).toBe(vr.id);
    expect(restDayShortage(input([release(vr)], [member(ctl)]), ctl, member(ctl), DAY)?.fix).toBeUndefined();
  });
});
