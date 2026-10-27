import { afterEach, describe, expect, it } from 'vitest';
import { RULE_DEFS, RULE_GROUPS, applyRuleValues, checkRuleValue, resetRuleValues, ruleDef } from '..';
import { CONTROLLER_LEAVE_RULES } from '../../controllers/leaveRules';
import { ACTING_PANEL, sickExcludesActing } from '../../manpower';
import { PV_RULES } from '../../pv';
import { SD_MINIMUM, SICK_RULES, V2_DEFAULTS } from '../../shutdown/v2';
import { STALE_H } from '../../tracker';
import { DEFAULT_TOLERANCE, withinTolerance } from '../../tracker/intel/reconcile';
import { VAC_RULES, fieldSlots, panelSlots, slotFloor } from '../../vacation/rules';

afterEach(() => resetRuleValues());

describe('rules registry', () => {
  it('every rule is in a known group, keys are unique, mode and section instances find their template', () => {
    const groups = new Set(RULE_GROUPS.map((g) => g.key));
    expect(RULE_DEFS.every((d) => groups.has(d.group))).toBe(true);
    expect(new Set(RULE_DEFS.map((d) => d.key)).size).toBe(RULE_DEFS.length);
    expect(ruleDef('crew.mode.full_operation')?.key).toBe('crew.mode');
    expect(ruleDef('crew.section.train_1')?.key).toBe('crew.section');
    expect(ruleDef('ctl.cover_max')?.pill({ days: null })).toBe('No limit');
  });
});

describe('checkRuleValue (same as the server)', () => {
  const b = { warn: { min: 0, max: 200 }, hard: { min: 0, max: 250 } };
  it('ranges, order and nothing changed', () => {
    expect(checkRuleValue('sd.ot_month', { warn: 72, hard: 80 }, b)).toBeNull();
    expect(checkRuleValue('sd.ot_month', { warn: 300, hard: 80 }, b)).toMatch(/between 0 and 200/);
    expect(checkRuleValue('sd.ot_month', { warn: 90, hard: 80 }, b)).toMatch(/warning cannot be above/);
    expect(checkRuleValue('sd.ot_month', { warn: 72, hard: 80 }, b, { warn: 72, hard: 80 })).toBe('Nothing changed.');
    expect(checkRuleValue('sd.ot_month', { warn: 72 }, b)).toMatch(/missing/);
  });
  it('nullable and times', () => {
    expect(checkRuleValue('ctl.cover_max', { days: null }, { days: { min: 1, max: 60, nullable: true } })).toBeNull();
    expect(checkRuleValue('chk.change_rest', { hours: null }, { hours: { min: 0, max: 48 } })).toMatch(/needs a value/);
    expect(checkRuleValue('chk.shift_times', { M: '7:00' }, { M: { time: true } })).toMatch(/time/);
    expect(checkRuleValue('trk.stale', { critical: 12, normal: 6, small: 24 }, {})).toMatch(/Critical/);
  });
});

describe('applyRuleValues: the numbers in code follow the database', () => {
  it('writes every rule into the objects the app computes with', () => {
    applyRuleValues({
      'crew.acting_panel': { grade: 14, sickMax: 20 }, 'leave.pv_seats': { panelSeats: 5 }, 'leave.pv_on_duty': { panel: 2, field: 5 },
      'leave.summer': { fromMonth: 7, toMonth: 8, maxCycles: 1, maxPeriods: 1 }, 'vac.periods': { min: 3, max: 6 }, 'vac.per_slot': { perSlot: 3 },
      'vac.panel_group': { panelGroup: 5 }, 'ctl.leaves': { maxLeavesPerYear: 5, minDaysPerYear: 20 }, 'sd.ot_month': { warn: 60, hard: 70 },
      'sd.ot_year': { warn: 300, hard: 400 }, 'sd.team_min': { controller: 2, experienced: 1, qualifiedFo: 3 }, 'sd.sick': { okMax: 10, warnMax: 30, freshDays: 60 },
      'trk.stale': { critical: 4, normal: 8, small: 16 }, 'trk.qty_tol': { abs: 5, relPct: 2 }
    });
    expect(ACTING_PANEL).toEqual({ grade: 14, sickMax: 20 }); expect(PV_RULES.actingGrade).toBe(14);
    expect(sickExcludesActing({ sick12: 25 })).toBe(true);
    expect(PV_RULES).toMatchObject({ panelSeats: 5, panelMinOnDuty: 2, fieldMinOnDuty: 5, summerFromMonth: 7, summerToMonth: 8, summerMaxCycles: 1, controllerMaxLeaves: 5 });
    expect(VAC_RULES).toMatchObject({ minPeriods: 3, maxPeriods: 6, perSlot: 3, panelGroup: 5, panelMinOnDuty: 2, fieldMinOnDuty: 5, summerMaxPeriods: 1 });
    expect(fieldSlots(9)).toBe(3); expect(panelSlots(4)).toBe(1); expect(slotFloor(5)).toBe(6);
    expect(CONTROLLER_LEAVE_RULES).toEqual({ maxLeavesPerYear: 5, minDaysPerYear: 20 });
    expect(V2_DEFAULTS).toMatchObject({ monthWarn: 60, monthHard: 70, yearWarn: 300, yearHard: 400 });
    expect(SD_MINIMUM).toEqual({ controller: 2, experienced: 1, qualifiedFo: 3 });
    expect(SICK_RULES).toEqual({ okMax: 10, warnMax: 30, freshDays: 60 });
    expect(STALE_H).toEqual({ critical: 4, normal: 8, small: 16 });
    expect(DEFAULT_TOLERANCE).toEqual({ abs: 5, rel: 0.02 }); expect(withinTolerance(100, 106)).toBe(false);
  });
  it('the seeded values change nothing; a missing or broken rule keeps the value in code', () => {
    const before = { ...PV_RULES, ...VAC_RULES };
    applyRuleValues({ 'leave.pv_seats': { panelSeats: 4 }, 'vac.periods': { min: 4, max: 5 }, 'vac.per_slot': null, 'sd.sick': { okMax: 'x' as unknown as number } });
    expect({ ...PV_RULES, ...VAC_RULES }).toEqual(before);
    expect(SICK_RULES.okMax).toBe(21);
  });
  it('resets to the values in code', () => {
    applyRuleValues({ 'trk.stale': { critical: 1, normal: 2, small: 3 } }); resetRuleValues();
    expect(STALE_H).toEqual({ normal: 12, critical: 6, small: 24 });
  });
});
