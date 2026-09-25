import { describe, expect, it } from 'vitest';
import { minimumsText, modeOn, rulesByDate, type OperationPlan } from '..';
import { evaluateDay, FULL_OPERATION, type MpPerson } from '../../manpower';
import { addDaysIso, isWorkingDay } from '../../roster';

const plan: OperationPlan = {
  modes: [
    { code: 'full_operation', label: 'Full operation', controllerMin: 1, panelMin: 3, panelGrade14Min: 1, fieldMin: 6, isDefault: true, isActive: true, note: null },
    { code: 'one_train', label: 'One train', controllerMin: 1, panelMin: 2, panelGrade14Min: 1, fieldMin: 4, isDefault: false, isActive: true, note: null }
  ],
  periods: [
    { id: 'p1', modeCode: 'one_train', start: '2026-11-01', end: '2026-11-10', note: null, status: 'active' },
    { id: 'p2', modeCode: 'one_train', start: '2026-12-01', end: '2026-12-05', note: null, status: 'cancelled' }
  ]
};
let seq = 0;
const person = (role: MpPerson['role'], grade: number): MpPerson => ({ id: `p${++seq}`, employeeNumber: String(seq), name: `p${seq}`, role, crew: 'D', grade, employmentType: 'knpc',
  takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null });

describe('operating modes', () => {
  it('a date takes its period\'s mode; other dates and cancelled periods use Full operation', () => {
    expect(modeOn('2026-11-05', plan).code).toBe('one_train');
    expect(modeOn('2026-11-11', plan).code).toBe('full_operation');
    expect(modeOn('2026-12-03', plan).code).toBe('full_operation');
    expect(rulesByDate(plan)('2026-11-01')).toMatchObject({ ...FULL_OPERATION, modeCode: 'one_train', modeLabel: 'One train', panelMin: 2, fieldMin: 4 });
  });
  it('the engine judges each date against its mode', () => {
    const crew = [person('controller', 16), person('panel_operator', 14), person('panel_operator', 12), ...[1, 2, 3, 4].map(() => person('field_operator', 10))];
    const rules = rulesByDate(plan);
    const dDay = (from: string) => { let d = from; while (!isWorkingDay(d, 'D')) d = addDaysIso(d, 1); return d; };
    const inside = dDay('2026-11-01'), outside = dDay('2026-11-11');
    expect(inside <= '2026-11-10').toBe(true);
    const inMode = evaluateDay(inside, crew, [], rules);        // Panel 2 of 2, Field 4 of 4 → met
    const normal = evaluateDay(outside, crew, [], rules);       // Panel 2 of 3, Field 4 of 6 → short
    expect(inMode.rules.modeLabel).toBe('One train');
    expect(inMode.crews.find((c) => c.crew === 'D')!.confirmedShortage).toBe(false);
    expect(normal.rules.modeLabel).toBe('Full operation');
    expect(normal.crews.find((c) => c.crew === 'D')!.confirmedShortage).toBe(true);
  });
  it('describes the minimums', () => {
    expect(minimumsText(FULL_OPERATION)).toBe('Controller 1 · Panel 3 (1 Grade 14+) · Field 6');
  });
});
