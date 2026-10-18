import { describe, expect, it } from 'vitest';
import { minimumsWithDown, modeOn, modeRuns, rulesByDate, sectionsName, unitsOn, type OperationPlan, type UnitSection } from '..';
import { evaluateDay, type MpPerson } from '../../manpower';
import { addDaysIso, isWorkingDay } from '../../roster';

const units: UnitSection[] = [
  { code: 'train_1', label: 'Train-1', panelMin: 1, fieldMin: 2, essential: false },
  { code: 'train_2', label: 'Train-2', panelMin: 1, fieldMin: 2, essential: false },
  { code: 'fractionator', label: 'Fractionator Section', panelMin: 1, fieldMin: 2, essential: true }
];
const base = { code: 'full_operation', label: 'Full operation', controllerMin: 1, panelMin: 3, panelGrade14Min: 1, fieldMin: 6, isDefault: true, isActive: true, note: null };
const plan = (outages: OperationPlan['outages'], periods: OperationPlan['periods'] = [], modes = [base]): OperationPlan => ({ modes, periods, units, outages });
const mins = (p: OperationPlan, d: string) => { const m = modeOn(d, p); return [m.controllerMin, m.panelMin, m.panelGrade14Min, m.fieldMin]; };

describe('unit status', () => {
  const t2 = plan([{ id: 'e1', units: ['train_2'], start: '2026-10-18', end: '2026-11-16', title: 'SD' }]);
  it('all three sections running: Controller 1 · Panel 3 (1 Grade 14+) · Field 6', () => {
    expect(mins(t2, '2026-10-17')).toEqual([1, 3, 1, 6]);
    expect(modeOn('2026-10-17', t2).label).toBe('Full operation');
  });
  it('one train down: one Panel and two Field fewer, the Controller and Grade 14+ stay, on exactly the shutdown dates', () => {
    expect(mins(t2, '2026-10-18')).toEqual([1, 2, 1, 4]);
    expect(mins(t2, '2026-11-16')).toEqual([1, 2, 1, 4]);
    expect(mins(t2, '2026-11-17')).toEqual([1, 3, 1, 6]);
    expect(modeOn('2026-10-18', t2).label).toBe('Train-2 down');
    expect(unitsOn('2026-10-18', t2).map((s) => !!s.down)).toEqual([false, true, false]);
  });
  it('both trains down: only the Fractionator Section runs (Panel 1 · Field 2)', () => {
    const p = plan([{ id: 'a', units: ['train_1'], start: '2026-11-01', end: '2026-11-05', title: 'SD' }, { id: 'b', units: ['train_2'], start: '2026-10-18', end: '2026-11-16', title: 'SD' }]);
    expect(mins(p, '2026-11-03')).toEqual([1, 1, 1, 2]);
    expect(modeOn('2026-11-03', p).label).toBe('Train-1 + Train-2 down');
    expect(mins(p, '2026-11-06')).toEqual([1, 2, 1, 4]);
  });
  it('Fractionator Section down: the unit cannot run, no minimum (even with the trains up)', () => {
    const p = plan([{ id: 'f', units: ['fractionator'], start: '2026-12-01', end: '2026-12-03', title: 'Outage' }]);
    expect(mins(p, '2026-12-02')).toEqual([0, 0, 0, 0]);
    expect(modeOn('2026-12-02', p).label).toBe('Unit down (Fractionator Section)');
  });
  it('whole unit down (total turnaround): no minimum', () => {
    const p = plan([{ id: 't', units: ['fractionator', 'train_1', 'train_2'], start: '2025-05-02', end: '2025-05-10', title: 'Total turnaround' }]);
    expect(mins(p, '2025-05-05')).toEqual([0, 0, 0, 0]);
    expect(modeOn('2025-05-05', p).label).toBe('Unit down (all sections)');
  });
  it('a manual override period wins over the unit status on its dates', () => {
    const reduced = { ...base, code: 'reduced', label: 'Reduced rate', panelMin: 2, fieldMin: 5, isDefault: false };
    const p = plan(t2.outages, [{ id: 'o', modeCode: 'reduced', start: '2026-10-20', end: '2026-10-21', note: null, status: 'active' }], [base, reduced]);
    expect(mins(p, '2026-10-20')).toEqual([1, 2, 1, 5]);
    expect(mins(p, '2026-10-22')).toEqual([1, 2, 1, 4]);
  });
  it('without unit sections the default mode applies as before', () => {
    expect(modeOn('2026-10-18', { modes: [base], periods: [] })).toMatchObject({ panelMin: 3, fieldMin: 6 });
  });
  it('the engine judges a crew with 2 Panel and 4 Field short in full operation, met while Train-2 is down', () => {
    let seq = 0;
    const person = (role: MpPerson['role'], grade: number): MpPerson => ({ id: `p${++seq}`, employeeNumber: String(seq), name: `p${seq}`, role, crew: 'D', grade, employmentType: 'knpc',
      takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null });
    const crew = [person('controller', 16), person('panel_operator', 14), person('panel_operator', 12), ...[1, 2, 3, 4].map(() => person('field_operator', 10))];
    const dDay = (from: string) => { let d = from; while (!isWorkingDay(d, 'D')) d = addDaysIso(d, 1); return d; };
    const rules = rulesByDate(t2);
    const inside = dDay('2026-10-18'), outside = dDay('2026-11-17');
    expect(evaluateDay(inside, crew, [], rules).crews.find((c) => c.crew === 'D')!.confirmedShortage).toBe(false);
    expect(evaluateDay(outside, crew, [], rules).crews.find((c) => c.crew === 'D')!.confirmedShortage).toBe(true);
  });
  it('names and previews a set of sections; joins days into runs', () => {
    expect(sectionsName(['train_2'], units)).toBe('Train-2');
    expect(sectionsName(['train_1', 'train_2', 'fractionator'], units)).toBe('Whole unit');
    expect(minimumsWithDown(['train_1'], units)).toMatchObject({ controllerMin: 1, panelMin: 2, fieldMin: 4 });
    expect(minimumsWithDown([], units)).toMatchObject({ panelMin: 3, fieldMin: 6 });
    const runs = modeRuns('2026-10-16', '2026-11-18', t2, (d) => addDaysIso(d, 1));
    expect(runs.map((r) => [r.start, r.end, r.mode.label])).toEqual([['2026-10-16', '2026-10-17', 'Full operation'], ['2026-10-18', '2026-11-16', 'Train-2 down'], ['2026-11-17', '2026-11-18', 'Full operation']]);
  });
});
