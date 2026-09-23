import { describe, expect, it } from 'vitest';
import { actionsFor, eligibleFor } from '..';
import type { ActionRow } from '..';

const base: ActionRow = { position_category: 'field', position_code: 'field_operator', employment_type: 'knpc', employment_type_source: 'confirmed', grade: 12, take_charge_status: 'yes', panel_operator_status: null, acting_controller_status: null, unresolved_absences: 0 };
const codes = (r: Partial<ActionRow>) => actionsFor({ ...base, ...r }).map((a) => a.code);

describe('employees needing action', () => {
  it('a fully confirmed Field Operator needs nothing', () => expect(codes({})).toEqual([]));
  it('Take-Charge Not Yet Confirmed or not recorded needs action; No is a decision, not pending', () => {
    expect(codes({ take_charge_status: 'not_yet_confirmed' })).toEqual(['take_charge']);
    expect(codes({ take_charge_status: null })).toEqual(['take_charge']);
    expect(codes({ take_charge_status: 'no' })).toEqual([]);
  });
  it('Panel qualification applies to Panel Operators only', () => {
    expect(codes({ position_category: 'panel', position_code: 'panel_operator', panel_operator_status: 'not_yet_confirmed', take_charge_status: null })).toEqual(['panel_qualification']);
  });
  it('inferred classification, missing grade, low-grade Controller and unresolved absences are listed', () => {
    expect(codes({ employment_type: 'contractor', employment_type_source: 'inferred', grade: null })).toEqual(['employment_type']);
    expect(codes({ grade: null })).toEqual(['grade_missing']);
    expect(codes({ position_category: 'controller', position_code: 'controller', grade: 14, take_charge_status: null })).toEqual(['controller_grade']);
    expect(codes({ position_category: 'controller', position_code: 'controller', grade: 14, acting_controller_status: 'yes', take_charge_status: null })).toEqual([]);
    expect(actionsFor({ ...base, unresolved_absences: '3' })[0]).toMatchObject({ code: 'unresolved_absences', label: '3 unresolved absences', bulk: null });
  });
  it('only qualification and classification actions can be approved in bulk', () => {
    const bulk = actionsFor({ ...base, take_charge_status: null, employment_type_source: 'inferred', grade: null, unresolved_absences: 2 }).map((a) => [a.code, a.bulk]);
    expect(bulk).toEqual([['take_charge', 'take_charge'], ['employment_type', 'employment_type'], ['grade_missing', null], ['unresolved_absences', null]]);
  });
  it('a bulk action in a mixed selection applies only to eligible people', () => {
    const f = { ...base, take_charge_status: null }; const p = { ...base, position_category: 'panel' as const, position_code: 'panel_operator' };
    const c = { ...base, employment_type: 'contractor' as const, employment_type_source: 'inferred' as const };
    expect(eligibleFor([f, p, c], 'take_charge')).toEqual([f, c]);
    expect(eligibleFor([f, p, c], 'panel_qualification')).toEqual([p]);
    expect(eligibleFor([f, p, c], 'employment_type')).toEqual([c]);
  });
});
