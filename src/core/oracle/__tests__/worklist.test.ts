import { describe, expect, it } from 'vitest';
import { buildWorklist } from '../worklist';
import { checkControllerLeave } from '../../controllers/leaveRules';
import { evaluateRange, type MpAbsence, type MpPerson } from '../../manpower';

const P = (id: string, role: MpPerson['role'], crew: MpPerson['crew'], grade = 16): MpPerson => ({ id, employeeNumber: id, name: id, role, crew, grade, employmentType: 'knpc', takeCharge: null, panelQualified: null, actingController: null });
const people = [P('ctlB', 'controller', 'B'), P('ctlA', 'controller', 'A'), P('fB', 'field_operator', 'B', 10), { ...P('vr', 'vr_controller', null), moves: [{ start: '2026-09-01', end: null, crew: 'B' as const, kind: 'placement' as const }] }];
let n = 0;
const lv = (who: string, start: string, end: string, oracle: MpAbsence['oracle'] = 'not_submitted'): MpAbsence => ({ id: `r${++n}`, employeeId: who, start, end, status: 'approved', typeCode: 'annual_leave_planned', typeShort: 'PV', inCurrentPlan: true, oracle });
const today = '2026-09-26';

describe('Requests work list', () => {
  const abs = [lv('vr', '2026-09-26', '2026-10-09', 'approved'), lv('vr', '2026-10-10', '2026-10-19'), lv('ctlA', '2026-10-08', '2026-10-21'), lv('fB', '2026-12-01', '2026-12-10'), lv('ctlB', '2026-08-01', '2026-08-05')];
  const rows = buildWorklist({ today, days: 30, people, absences: abs, results: evaluateRange(today, '2026-11-30', people, abs), check: checkControllerLeave(people, abs, [], [2026, 2027]) });
  it('lists leave running now or starting within 30 days, back-to-back records as one leave', () => {
    expect(rows.map((r) => [r.person.id, r.start, r.end, r.records.length])).toEqual([['vr', '2026-09-26', '2026-10-19', 2], ['ctlA', '2026-10-08', '2026-10-21', 1]]);
  });
  it('the VR works with the crew he is placed in: the expected request leaves out B rest days', () => {
    expect(rows[0]).toMatchObject({ crew: 'B', now: true, oracle: 'not_submitted' });
    expect(rows[0].expected).toMatchObject({ start: '2026-09-26', end: '2026-10-17', days: 19, backOn: '2026-10-20' });
  });
  it('flags two Controllers on leave together', () => {
    expect(rows[0].clashWith).toEqual(['ctlA']);
    expect(rows[1].clashWith).toEqual(['vr']);
  });
});
