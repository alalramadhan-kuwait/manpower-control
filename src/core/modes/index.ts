// Operating modes. The minimums per crew (Controller / Panel / Panel Grade 14+ / Field) come from the unit status:
// each unit section (Train-1, Train-2, Fractionator Section) needs its own Panel and Field Operators, and a section
// is down on the dates of a calendar shutdown / outage that names it. The Fractionator Section is essential: while it
// is down the whole unit is down (no minimum). A manual period (a mode with its own numbers) wins over the unit status
// on its dates. Everything else in the rules (grades, Grade 13+ covering both, Take-Charge) stays the same.
import { FULL_OPERATION, type Rules } from '../manpower';

export interface OperatingMode {
  code: string; label: string;
  controllerMin: number; panelMin: number; panelGrade14Min: number; fieldMin: number;
  isDefault: boolean; isActive: boolean; note: string | null;
}
export interface OperationPeriod { id: string; modeCode: string; start: string; end: string; note: string | null; status: 'active' | 'cancelled' }
/** A unit section and the operators each crew needs for it while it runs. essential: the unit cannot run without it. */
export interface UnitSection { code: string; label: string; panelMin: number; fieldMin: number; essential: boolean }
/** Unit sections down from a first to a last day (a calendar shutdown / outage). */
export interface UnitOutage { id: string; units: string[]; start: string; end: string; title: string }
export interface OperationPlan { modes: OperatingMode[]; periods: OperationPeriod[]; units?: UnitSection[]; outages?: UnitOutage[] }

export const DEFAULT_MODE: OperatingMode = {
  code: FULL_OPERATION.modeCode, label: FULL_OPERATION.modeLabel, controllerMin: FULL_OPERATION.controllerMin, panelMin: FULL_OPERATION.panelMin,
  panelGrade14Min: FULL_OPERATION.panelGrade14Min, fieldMin: FULL_OPERATION.fieldMin, isDefault: true, isActive: true, note: null
};
export const UNIT_DOWN_CODE = 'unit_down';

/** The active manual period covering a date, if any. */
export const periodOn = (date: string, plan: OperationPlan): OperationPeriod | null =>
  plan.periods.find((p) => p.status === 'active' && p.start <= date && date <= p.end) ?? null;

export interface UnitStatus { unit: UnitSection; down: UnitOutage | null }
/** Each unit section on a date: running, or down with the outage that takes it down. */
export const unitsOn = (date: string, plan: OperationPlan): UnitStatus[] =>
  (plan.units ?? []).map((unit) => ({ unit, down: (plan.outages ?? []).find((o) => o.start <= date && date <= o.end && o.units.includes(unit.code)) ?? null }));

/**
 * The minimums from the unit status: Panel and Field are the sum over the running sections; the Controller and the
 * Panel Grade 14+ stay while any section runs. Essential section down (or nothing running): the unit is down, no minimum.
 * No sections defined: the default mode.
 */
export function unitModeOn(date: string, plan: OperationPlan): OperatingMode {
  const def = plan.modes.find((m) => m.isDefault) ?? DEFAULT_MODE;
  const status = unitsOn(date, plan);
  if (!status.length) return def;
  const down = status.filter((s) => s.down);
  if (!down.length) {
    const panel = status.reduce((n, s) => n + s.unit.panelMin, 0);
    return { ...def, panelMin: panel, fieldMin: status.reduce((n, s) => n + s.unit.fieldMin, 0), panelGrade14Min: Math.min(def.panelGrade14Min, panel) };
  }
  const running = status.filter((s) => !s.down);
  const names = down.map((s) => s.unit.label).join(' + ');
  if (!running.length || down.some((s) => s.unit.essential))
    return { ...def, code: UNIT_DOWN_CODE, label: `Unit down (${running.length ? names : 'all sections'})`, controllerMin: 0, panelMin: 0, panelGrade14Min: 0, fieldMin: 0, isDefault: false };
  const panel = running.reduce((n, s) => n + s.unit.panelMin, 0);
  return {
    ...def, code: `down:${down.map((s) => s.unit.code).join('+')}`, label: `${names} down`, isDefault: false,
    panelMin: panel, fieldMin: running.reduce((n, s) => n + s.unit.fieldMin, 0), panelGrade14Min: Math.min(def.panelGrade14Min, panel)
  };
}

/** The mode that applies on a date: a manual period's mode, else the unit status. */
export function modeOn(date: string, plan: OperationPlan): OperatingMode {
  const p = periodOn(date, plan);
  return (p && plan.modes.find((m) => m.code === p.modeCode)) || unitModeOn(date, plan);
}

/** Engine rules for a mode: Full-operation rules with the mode's minimums. */
export const rulesFor = (m: OperatingMode): Rules => ({
  ...FULL_OPERATION, modeCode: m.code, modeLabel: m.label,
  controllerMin: m.controllerMin, panelMin: m.panelMin, panelGrade14Min: m.panelGrade14Min, fieldMin: m.fieldMin
});

/** Rules by date for the engine (evaluateDay / evaluateRange accept this function). */
export function rulesByDate(plan: OperationPlan): (date: string) => Rules {
  const cache = new Map<string, Rules>();
  return (date) => {
    const m = modeOn(date, plan);
    const key = `${m.code}|${m.controllerMin}|${m.panelMin}|${m.panelGrade14Min}|${m.fieldMin}`;
    let r = cache.get(key);
    if (!r) { r = rulesFor(m); cache.set(key, r); }
    return r;
  };
}

/** Days from..to joined into runs with the same minimums (for the calendar and the notices). */
export function modeRuns(from: string, to: string, plan: OperationPlan, next: (d: string) => string): { start: string; end: string; mode: OperatingMode; manual: boolean }[] {
  const out: { start: string; end: string; mode: OperatingMode; manual: boolean }[] = [];
  for (let d = from; d <= to; d = next(d)) {
    const manual = !!periodOn(d, plan); const mode = modeOn(d, plan);
    const last = out[out.length - 1];
    if (last && last.mode.code === mode.code && last.manual === manual && last.mode.label === mode.label) last.end = d;
    else out.push({ start: d, end: d, mode, manual });
  }
  return out;
}

/** "Controller 1 · Panel 3 (1 Grade 14+) · Field 6" */
export const minimumsText = (r: Pick<Rules, 'controllerMin' | 'panelMin' | 'panelGrade14Min' | 'fieldMin'>) =>
  `Controller ${r.controllerMin} · Panel ${r.panelMin}${r.panelGrade14Min ? ` (${r.panelGrade14Min} Grade 14+)` : ''} · Field ${r.fieldMin}`;

/** The name of a set of sections: "Train-2", "Train-1 + Train-2", or "Whole unit" for all of them. */
export const sectionsName = (codes: string[], units: UnitSection[]) =>
  units.length && units.every((u) => codes.includes(u.code)) ? 'Whole unit' : units.filter((u) => codes.includes(u.code)).map((u) => u.label).join(' + ');

/** The minimums while these sections are down (the rest running), from the default mode's Controller and Grade 14+. */
export const minimumsWithDown = (codes: string[], units: UnitSection[], modes: OperatingMode[] = []) =>
  unitModeOn('2000-01-01', { modes, periods: [], units, outages: codes.length ? [{ id: 'x', units: codes, start: '2000-01-01', end: '2000-01-01', title: '' }] : [] });
