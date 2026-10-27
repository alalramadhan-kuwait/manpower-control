// Rules (owner, 27 Oct 2026): every organization rule of the app on one page, grouped and in order. The Section Head
// changes a number with a reason; it applies from today forward. The numbers the app used to keep in code are read
// from the database at start and written into the rule objects below, so every screen and every server check uses the
// same value. Pure: no database here.
import { CONTROLLER_LEAVE_RULES } from '../controllers/leaveRules';
import { ACTING_PANEL } from '../manpower';
import { PV_RULES } from '../pv';
import { SD_MINIMUM, SICK_RULES, V2_DEFAULTS } from '../shutdown/v2';
import { STALE_H } from '../tracker';
import { DEFAULT_TOLERANCE } from '../tracker/intel/reconcile';
import { VAC_RULES } from '../vacation/rules';

export type RuleGroup = 'crew' | 'leave' | 'vacation' | 'controllers' | 'checks' | 'shutdown' | 'tracker';
export const RULE_GROUPS: { key: RuleGroup; label: string; icon: string }[] = [
  { key: 'crew', label: 'Crew minimums', icon: '👥' },
  { key: 'leave', label: 'Leave', icon: '🌴' },
  { key: 'vacation', label: 'Vacation plan', icon: '🗓' },
  { key: 'controllers', label: 'Controllers', icon: '🎧' },
  { key: 'checks', label: 'Shift checks', icon: '⏱' },
  { key: 'shutdown', label: 'Shutdowns', icon: '🛠' },
  { key: 'tracker', label: 'Tracker', icon: '📋' }
];

export type RuleValue = Record<string, number | string | null>;
export interface RuleField { name: string; label: string; unit?: string; kind?: 'number' | 'time'; step?: number; nullLabel?: string }
export interface RuleBound { min?: number; max?: number; nullable?: boolean; time?: boolean }
export type RuleBounds = Record<string, RuleBound>;

export interface RuleDef {
  key: string; group: RuleGroup; label: string;
  /** what the rule does, in one or two sentences */
  description: string;
  /** what changing it does (shown in the yellow note) */
  effect: string;
  fields: RuleField[];
  /** the value pill */
  pill: (v: RuleValue) => string;
}

const n = (v: RuleValue, k: string, none = '–') => (v[k] == null ? none : String(v[k]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mon = (v: RuleValue, k: string) => MONTHS[Number(v[k]) - 1] ?? '?';
const FROM_TODAY = 'From today on. Leave already approved and plans already published keep the rule they were made under.';

/** The rules, in page order. `crew.mode.<code>` and `crew.section.<code>` are made from the two crew templates. */
export const RULE_DEFS: RuleDef[] = [
  { key: 'crew.mode', group: 'crew', label: 'Minimum crew on duty', description: 'The fewest people on a shift in this operating mode. Below this, leave and changes are flagged.',
    effect: 'Checks from today use the new minimum. Leave already approved is not re-checked.',
    fields: [{ name: 'controller', label: 'Controller' }, { name: 'panel', label: 'Panel' }, { name: 'field', label: 'Field' }],
    pill: (v) => `C${n(v, 'controller')} · P${n(v, 'panel')} · F${n(v, 'field')}` },
  { key: 'crew.section', group: 'crew', label: 'Section minimum', description: 'The fewest Panel and Field Operators for this unit section while it runs.',
    effect: 'Checks from today use the new minimum.',
    fields: [{ name: 'panel', label: 'Panel' }, { name: 'field', label: 'Field' }],
    pill: (v) => `P${n(v, 'panel')} · F${n(v, 'field')}` },
  { key: 'crew.acting_panel', group: 'crew', label: 'Acting Panel', description: 'A Field Operator can sit in a Panel seat from this grade, if not over this many sick days in the last 12 months.',
    effect: 'New allocations and plans pick acting Panel with the new rule. An approved allocation keeps its people.',
    fields: [{ name: 'grade', label: 'From grade' }, { name: 'sickMax', label: 'Sick days at most', unit: 'days' }],
    pill: (v) => `G${n(v, 'grade')}+ · ≤${n(v, 'sickMax')} sick` },
  { key: 'leave.pv_seats', group: 'leave', label: 'Panel seats per shift', description: 'Each shift keeps this many Panel seats. Missing seats are filled by acting Panel.',
    effect: FROM_TODAY, fields: [{ name: 'panelSeats', label: 'Seats' }], pill: (v) => `${n(v, 'panelSeats')} seats` },
  { key: 'leave.pv_on_duty', group: 'leave', label: 'Left on duty during leave', description: 'Panel and Field Operators that must stay on duty in a shift while others are on leave.',
    effect: FROM_TODAY, fields: [{ name: 'panel', label: 'Panel' }, { name: 'field', label: 'Field' }], pill: (v) => `Panel ${n(v, 'panel')} · Field ${n(v, 'field')}` },
  { key: 'leave.summer', group: 'leave', label: 'Summer peak', description: 'Summer months (by a cycle\'s first day). In summer a person takes at most this many cycles, in this many periods.',
    effect: FROM_TODAY,
    fields: [{ name: 'fromMonth', label: 'From month' }, { name: 'toMonth', label: 'To month' }, { name: 'maxCycles', label: 'Cycles at most' }, { name: 'maxPeriods', label: 'Periods at most' }],
    pill: (v) => `${mon(v, 'fromMonth')}–${mon(v, 'toMonth')} · ${n(v, 'maxCycles')} cycles` },
  { key: 'vac.periods', group: 'vacation', label: 'Vacation periods per person', description: 'Each person plans at least and at most this many periods a year. A period is one run of whole cycles.',
    effect: 'Plans still in draft use the new numbers. A published plan is not changed.',
    fields: [{ name: 'min', label: 'At least' }, { name: 'max', label: 'At most' }], pill: (v) => `${n(v, 'min')}–${n(v, 'max')}` },
  { key: 'vac.per_slot', group: 'vacation', label: 'People per vacation slot', description: 'One person can be off at a time for every this many counted people in a shift.',
    effect: 'Plans still in draft use the new number.', fields: [{ name: 'perSlot', label: 'People' }], pill: (v) => `1 per ${n(v, 'perSlot')}` },
  { key: 'vac.panel_group', group: 'vacation', label: 'Panel group size', description: 'People in a shift\'s Panel group, filled by acting Panel when short.',
    effect: 'New allocations use the new size. An approved allocation is not changed.', fields: [{ name: 'panelGroup', label: 'People' }], pill: (v) => `${n(v, 'panelGroup')}` },
  { key: 'ctl.leaves', group: 'controllers', label: 'Controller annual leave', description: 'Leaves a Controller can take a year without the Section Head\'s approval, and the fewest leave days to plan.',
    effect: 'Leave from today is checked with the new numbers.',
    fields: [{ name: 'maxLeavesPerYear', label: 'Leaves at most' }, { name: 'minDaysPerYear', label: 'Days at least', unit: 'days' }],
    pill: (v) => `${n(v, 'maxLeavesPerYear')} leaves · ${n(v, 'minDaysPerYear')}d` },
  { key: 'ctl.cover_max', group: 'controllers', label: 'Shift cover length', description: 'The longest a Controller covers another shift in one go.',
    effect: 'New covers are checked with the new length.', fields: [{ name: 'days', label: 'Days at most', unit: 'days', nullLabel: 'No limit' }],
    pill: (v) => (v.days == null ? 'No limit' : `${v.days} days`) },
  { key: 'chk.consecutive', group: 'checks', label: 'Days on duty in a row', description: 'The most days a person works in a row before a day off.',
    effect: 'Checks from today use the new number.', fields: [{ name: 'max', label: 'Days at most', unit: 'days' }], pill: (v) => `${n(v, 'max')} days` },
  { key: 'chk.change_rest', group: 'checks', label: 'Rest when the shift changes', description: 'Hours off a person needs when moving from one shift type to another.',
    effect: 'Checks from today use the new number.', fields: [{ name: 'hours', label: 'Hours', unit: 'h' }], pill: (v) => `${n(v, 'hours')} h` },
  { key: 'chk.min_rest', group: 'checks', label: 'Rest between duties', description: 'Hours off between two duties. Off means not checked.',
    effect: 'Checks from today use the new number.', fields: [{ name: 'hours', label: 'Hours', unit: 'h', nullLabel: 'Off' }],
    pill: (v) => (v.hours == null ? 'Off' : `${v.hours} h`) },
  { key: 'chk.shift_times', group: 'checks', label: 'Shift times', description: 'When each shift starts and how long it lasts; the day duty start and length.',
    effect: 'Hours and rest are counted with the new times from today.',
    fields: [{ name: 'M', label: 'Morning', kind: 'time' }, { name: 'A', label: 'Afternoon', kind: 'time' }, { name: 'N', label: 'Night', kind: 'time' }, { name: 'hours', label: 'Shift length', unit: 'h' },
      { name: 'dayDutyStart', label: 'Day duty start', kind: 'time' }, { name: 'dayDutyHours', label: 'Day duty length', unit: 'h' }],
    pill: (v) => `${n(v, 'M')} · ${n(v, 'A')} · ${n(v, 'N')}` },
  { key: 'sd.ot_month', group: 'shutdown', label: 'Overtime a month', description: 'Shutdown overtime hours a person may do in a month: a warning, then a hard limit.',
    effect: 'Also changes the shutdown plans still to be approved. Approved and finished plans keep theirs.',
    fields: [{ name: 'warn', label: 'Warning', unit: 'h' }, { name: 'hard', label: 'Hard limit', unit: 'h' }], pill: (v) => `${n(v, 'warn')} / ${n(v, 'hard')} h` },
  { key: 'sd.ot_year', group: 'shutdown', label: 'Overtime a year', description: 'Shutdown overtime hours a person may do in a year: a warning, then a hard limit.',
    effect: 'Also changes the shutdown plans still to be approved. Approved and finished plans keep theirs.',
    fields: [{ name: 'warn', label: 'Warning', unit: 'h' }, { name: 'hard', label: 'Hard limit', unit: 'h' }], pill: (v) => `${n(v, 'warn')} / ${n(v, 'hard')} h` },
  { key: 'sd.team_min', group: 'shutdown', label: 'Shutdown team minimum', description: 'Each 12 hours of a shutdown needs at least this many qualified people.',
    effect: 'Shutdown plans are checked with the new minimum from today.',
    fields: [{ name: 'controller', label: 'Controller' }, { name: 'experienced', label: 'Experienced FO' }, { name: 'qualifiedFo', label: 'Qualified FO' }],
    pill: (v) => `${n(v, 'controller')} · ${n(v, 'experienced')} · ${n(v, 'qualifiedFo')}` },
  { key: 'sd.sick', group: 'shutdown', label: 'Sick days for shutdown', description: 'Sick days in the last 12 months: OK up to the first number, a warning up to the second, then not chosen. The sick list counts if not older than the last number.',
    effect: 'Shutdown teams are checked with the new numbers from today.',
    fields: [{ name: 'okMax', label: 'OK up to', unit: 'days' }, { name: 'warnMax', label: 'Warning up to', unit: 'days' }, { name: 'freshDays', label: 'List fresh for', unit: 'days' }],
    pill: (v) => `≤${n(v, 'okMax')} · ≤${n(v, 'warnMax')}` },
  { key: 'trk.stale', group: 'tracker', label: 'No update for', description: 'An item is flagged when nothing has been heard about it for this many hours.',
    effect: 'The tracker flags items with the new hours straight away.',
    fields: [{ name: 'critical', label: 'Critical', unit: 'h' }, { name: 'normal', label: 'Normal', unit: 'h' }, { name: 'small', label: 'Small jobs', unit: 'h' }],
    pill: (v) => `${n(v, 'critical')} · ${n(v, 'normal')} · ${n(v, 'small')} h` },
  { key: 'trk.qty_tol', group: 'tracker', label: 'Count tolerance', description: 'Two counts in reports (drums, bags) agree when they differ by no more than this many, or this percent.',
    effect: 'Reports read from now use the new tolerance.',
    fields: [{ name: 'abs', label: 'Count' }, { name: 'relPct', label: 'Percent', unit: '%', step: 0.5 }], pill: (v) => `±${n(v, 'abs')} or ${n(v, 'relPct')}%` }
];

/** The definition of a rule key (a mode or section instance uses its template). */
export const ruleDef = (key: string) => RULE_DEFS.find((d) => d.key === templateOf(key));
export const templateOf = (key: string) => (key.startsWith('crew.mode.') ? 'crew.mode' : key.startsWith('crew.section.') ? 'crew.section' : key);

/** Same checks as the server, so the sheet can say what is wrong before saving. */
export function checkRuleValue(key: string, v: RuleValue, bounds: RuleBounds, old?: RuleValue | null): string | null {
  for (const [f, b] of Object.entries(bounds)) {
    const x = v[f];
    if (x === undefined) return `${f} is missing.`;
    if (x === null) { if (b.nullable) continue; return `${labelOf(key, f)} needs a value.`; }
    if (b.time) { if (typeof x !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) return `${labelOf(key, f)} must be a time (HH:MM).`; continue; }
    if (typeof x !== 'number' || !Number.isFinite(x)) return `${labelOf(key, f)} must be a number.`;
    if ((b.min != null && x < b.min) || (b.max != null && x > b.max)) return `${labelOf(key, f)} must be between ${b.min} and ${b.max}.`;
  }
  const num = (k: string) => Number(v[k]);
  if ('min' in v && 'max' in v && num('min') > num('max')) return 'The least cannot be more than the most.';
  if ('warn' in v && 'hard' in v && num('warn') > num('hard')) return 'The warning cannot be above the hard limit.';
  if ('okMax' in v && 'warnMax' in v && num('okMax') > num('warnMax')) return 'OK cannot be above the warning.';
  if (key === 'trk.stale' && !(num('critical') <= num('normal') && num('normal') <= num('small'))) return 'Critical ≤ normal ≤ small jobs.';
  if (old && sameValue(old, v)) return 'Nothing changed.';
  return null;
}
const labelOf = (key: string, f: string) => ruleDef(key)?.fields.find((x) => x.name === f)?.label ?? f;
export const sameValue = (a: RuleValue, b: RuleValue) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => a[k] === b[k]); };

// ---- the numbers in code follow the database --------------------------------------------------------------------
type Mut = Record<string, unknown>;
const set = (o: object, patch: Mut) => Object.assign(o as Mut, patch);
const SNAPSHOT = {
  ACTING_PANEL: { ...ACTING_PANEL }, PV_RULES: { ...PV_RULES }, VAC_RULES: { ...VAC_RULES }, CONTROLLER_LEAVE_RULES: { ...CONTROLLER_LEAVE_RULES },
  V2_DEFAULTS: { monthWarn: V2_DEFAULTS.monthWarn, monthHard: V2_DEFAULTS.monthHard, yearWarn: V2_DEFAULTS.yearWarn, yearHard: V2_DEFAULTS.yearHard },
  SD_MINIMUM: { ...SD_MINIMUM }, SICK_RULES: { ...SICK_RULES }, STALE_H: { ...STALE_H }, DEFAULT_TOLERANCE: { ...DEFAULT_TOLERANCE }
};
/** Back to the values in code (tests). */
export function resetRuleValues() {
  set(ACTING_PANEL, SNAPSHOT.ACTING_PANEL); set(PV_RULES, SNAPSHOT.PV_RULES); set(VAC_RULES, SNAPSHOT.VAC_RULES); set(CONTROLLER_LEAVE_RULES, SNAPSHOT.CONTROLLER_LEAVE_RULES);
  set(V2_DEFAULTS, SNAPSHOT.V2_DEFAULTS); set(SD_MINIMUM, SNAPSHOT.SD_MINIMUM); set(SICK_RULES, SNAPSHOT.SICK_RULES); set(STALE_H, SNAPSHOT.STALE_H); set(DEFAULT_TOLERANCE, SNAPSHOT.DEFAULT_TOLERANCE);
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** Only the numbers that are present and numbers; a missing or broken rule keeps the value in code. */
const pick = (v: RuleValue | null | undefined, map: Record<string, string>): Mut => {
  const out: Mut = {};
  if (!v || typeof v !== 'object') return out;
  for (const [from, to] of Object.entries(map)) { const x = num(v[from]); if (x !== undefined) out[to] = x; }
  return out;
};

/** Write the rules kept in `app_rules` into the rule objects the app computes with. */
export function applyRuleValues(values: Record<string, RuleValue | null | undefined>) {
  const v = (k: string) => values[k];
  const acting = pick(v('crew.acting_panel'), { grade: 'grade', sickMax: 'sickMax' });
  set(ACTING_PANEL, acting); if (acting.grade !== undefined) set(PV_RULES, { actingGrade: acting.grade });
  set(PV_RULES, pick(v('leave.pv_seats'), { panelSeats: 'panelSeats' }));
  const duty = pick(v('leave.pv_on_duty'), { panel: 'panelMinOnDuty', field: 'fieldMinOnDuty' });
  set(PV_RULES, duty); set(VAC_RULES, pick(v('leave.pv_on_duty'), { panel: 'panelMinOnDuty', field: 'fieldMinOnDuty' }));
  const summer = pick(v('leave.summer'), { fromMonth: 'summerFromMonth', toMonth: 'summerToMonth', maxCycles: 'summerMaxCycles' });
  set(PV_RULES, summer); set(VAC_RULES, { ...summer, ...pick(v('leave.summer'), { maxPeriods: 'summerMaxPeriods' }) });
  set(VAC_RULES, pick(v('vac.periods'), { min: 'minPeriods', max: 'maxPeriods' }));
  set(VAC_RULES, pick(v('vac.per_slot'), { perSlot: 'perSlot' }));
  set(VAC_RULES, pick(v('vac.panel_group'), { panelGroup: 'panelGroup' }));
  const ctl = pick(v('ctl.leaves'), { maxLeavesPerYear: 'maxLeavesPerYear', minDaysPerYear: 'minDaysPerYear' });
  set(CONTROLLER_LEAVE_RULES, ctl); if (ctl.maxLeavesPerYear !== undefined) set(PV_RULES, { controllerMaxLeaves: ctl.maxLeavesPerYear });
  set(V2_DEFAULTS, pick(v('sd.ot_month'), { warn: 'monthWarn', hard: 'monthHard' }));
  set(V2_DEFAULTS, pick(v('sd.ot_year'), { warn: 'yearWarn', hard: 'yearHard' }));
  set(SD_MINIMUM, pick(v('sd.team_min'), { controller: 'controller', experienced: 'experienced', qualifiedFo: 'qualifiedFo' }));
  set(SICK_RULES, pick(v('sd.sick'), { okMax: 'okMax', warnMax: 'warnMax', freshDays: 'freshDays' }));
  set(STALE_H, pick(v('trk.stale'), { critical: 'critical', normal: 'normal', small: 'small' }));
  const tol = v('trk.qty_tol');
  if (tol) { const a = num(tol.abs), r = num(tol.relPct); set(DEFAULT_TOLERANCE, { ...(a !== undefined ? { abs: a } : {}), ...(r !== undefined ? { rel: r / 100 } : {}) }); }
}
