import { describe, expect, it } from 'vitest';
import { OPEN_END, firstDayBack, isOpenEnd, onLeaveOn } from '..';
import { evaluateRange, type MpPerson } from '../../manpower';

describe('open-ended operational absence', () => {
  it('no return date is ever invented', () => {
    expect(isOpenEnd(null)).toBe(true); expect(isOpenEnd(OPEN_END)).toBe(true);
    expect(firstDayBack(OPEN_END, 'A', () => false)).toBe(OPEN_END);
    const m = onLeaveOn('2027-06-01', [{ employeeId: 'p', start: '2026-10-01', end: OPEN_END, status: 'approved', inCurrentPlan: true, typeLabel: 'Injury', typeShort: 'INJ' }]);
    expect(m.get('p')).toMatchObject({ until: OPEN_END, returnOn: OPEN_END });
  });
  it('stays unavailable in the forecast far beyond any review or estimate', () => {
    const p: MpPerson = { id: 'p', employeeNumber: '1', name: 'P', role: 'field_operator', crew: 'A', grade: 12, employmentType: 'knpc', takeCharge: 'yes', panelQualified: null, actingController: null };
    const days = evaluateRange('2027-03-01', '2027-03-08', [p], [{ employeeId: 'p', start: '2026-10-01', end: OPEN_END, status: 'approved', inCurrentPlan: true, typeCode: 'injury', typeShort: 'INJ' }]);
    for (const d of days) { const c = d.crews.find((x) => x.crew === 'A')!; if (c.working) expect(c.field.count).toBe(0); }
  });
});
