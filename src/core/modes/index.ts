// Stage I: operating modes. A mode sets the minimums per crew (Controller / Panel / Panel Grade 14+ / Field);
// a period says which mode applies from a first day to a last day. Dates with no period use the default mode
// (Full operation). Everything else in the rules (grades, Grade 13+ covering both, Take-Charge) stays the same.
import { FULL_OPERATION, type Rules } from '../manpower';

export interface OperatingMode {
  code: string; label: string;
  controllerMin: number; panelMin: number; panelGrade14Min: number; fieldMin: number;
  isDefault: boolean; isActive: boolean; note: string | null;
}
export interface OperationPeriod { id: string; modeCode: string; start: string; end: string; note: string | null; status: 'active' | 'cancelled' }
export interface OperationPlan { modes: OperatingMode[]; periods: OperationPeriod[] }

export const DEFAULT_MODE: OperatingMode = {
  code: FULL_OPERATION.modeCode, label: FULL_OPERATION.modeLabel, controllerMin: FULL_OPERATION.controllerMin, panelMin: FULL_OPERATION.panelMin,
  panelGrade14Min: FULL_OPERATION.panelGrade14Min, fieldMin: FULL_OPERATION.fieldMin, isDefault: true, isActive: true, note: null
};

/** The active period covering a date, if any. */
export const periodOn = (date: string, plan: OperationPlan): OperationPeriod | null =>
  plan.periods.find((p) => p.status === 'active' && p.start <= date && date <= p.end) ?? null;

/** The mode that applies on a date: its period's mode, else the default mode. */
export function modeOn(date: string, plan: OperationPlan): OperatingMode {
  const def = plan.modes.find((m) => m.isDefault) ?? DEFAULT_MODE;
  const p = periodOn(date, plan);
  return (p && plan.modes.find((m) => m.code === p.modeCode)) || def;
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
    let r = cache.get(m.code);
    if (!r) { r = rulesFor(m); cache.set(m.code, r); }
    return r;
  };
}

/** "Controller 1 · Panel 3 (1 Grade 14+) · Field 6" */
export const minimumsText = (r: Pick<Rules, 'controllerMin' | 'panelMin' | 'panelGrade14Min' | 'fieldMin'>) =>
  `Controller ${r.controllerMin} · Panel ${r.panelMin}${r.panelGrade14Min ? ` (${r.panelGrade14Min} Grade 14+)` : ''} · Field ${r.fieldMin}`;
