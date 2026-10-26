// Annual vacation planning, step 1–2: the manpower allocation of the plan year (owner, 27 Oct 2026).
// A planning snapshot, never the employee directory: each person gets a planning group (Controller / Panel / Field /
// Relief / left out) and a shift; Relief people follow the rota of one shift for their vacation cycles. The Panel group
// of a shift is four people: its Panel Operators (company or contractor), filled up by acting Grade 13+ Field Operators
// chosen by the same rule as the daily engine (ACTING_PANEL). Pure functions, no I/O.
import { ACTING_PANEL, byNumberDesc, sickExcludesActing, DAY_DUTY, type MpPerson, type QualStatus, type Role } from '../manpower';
import { CREWS, type Crew } from '../roster';
import { VAC_RULES, fieldSlots, panelSlots } from './rules';

export type PlanGroup = 'controller' | 'panel' | 'field' | 'relief' | 'excluded';
/** vr: Vacation Relief Controller · day_supervisor: the Day Supervisor (Morning Controller post) · float_panel: floating
 *  Panel relief across shifts · day_duty: an operator on day duty (Sun–Thu with the Morning shift). */
export type ReliefKind = 'vr' | 'day_supervisor' | 'float_panel' | 'day_duty';
export type ActingChoice = 'auto' | 'yes' | 'no';

/** A person as the plan sees them: directory facts plus where the dated assignments put them at the start of the year. */
export interface PlanPerson {
  id: string; name: string; number: string; grade: number | null;
  /** Directory position. */
  position: Role | null;
  employmentType: 'knpc' | 'contractor';
  takeCharge: QualStatus; panelQualified: QualStatus; actingController: QualStatus;
  /** Shift in the directory record. */
  dirCrew: Crew | null;
  /** Shift on the first day of the plan year from the role history and dated moves (what the engine uses). */
  crew: Crew | null;
  /** On day duty at the start of the year. */
  dayDuty: boolean;
  /** VR Controller: the shift they are placed in at the start of the year. */
  placement: Crew | null;
  /** Rolling 12-month sick leave (latest confirmed figure), or null when not known. */
  sick: { days: number; asOf: string } | null;
}

export interface AllocRow {
  employeeId: string;
  group: PlanGroup;
  /** Shift for Controller / Panel / Field. */
  crew: Crew | null;
  relief: ReliefKind | null;
  /** Relief: the shift whose rota (and vacation cycles) they follow. */
  cycleCrew: Crew | null;
  /** Field Operator of Grade 13+: auto (the rule decides), yes (always acting Panel), no (never). */
  acting: ActingChoice;
  note: string | null;
}

export const GROUP_LABEL: Record<PlanGroup, string> = { controller: 'Controller', panel: 'Panel', field: 'Field', relief: 'Relief', excluded: 'Left out' };
export const RELIEF_LABEL: Record<ReliefKind, string> = { vr: 'VR Controller', day_supervisor: 'Day Supervisor', float_panel: 'Floating Panel', day_duty: 'Day duty' };
const CONTROLLER_ROLES: (Role | null)[] = ['controller', 'vr_controller', 'morning_controller'];
export const isControllerGroup = (r: AllocRow) => r.group === 'controller' || (r.group === 'relief' && (r.relief === 'vr' || r.relief === 'day_supervisor'));

/** The starting allocation: everyone where their dated assignments put them on 1 January. Never invents a shift. */
export function initialAllocation(people: PlanPerson[]): AllocRow[] {
  return people.map((p): AllocRow => {
    const base = { employeeId: p.id, acting: 'auto' as const, note: null };
    if (p.position === 'controller') return { ...base, group: 'controller', crew: p.crew ?? p.dirCrew, relief: null, cycleCrew: null };
    if (p.position === 'vr_controller') return { ...base, group: 'relief', crew: null, relief: 'vr', cycleCrew: p.placement };
    if (p.position === 'morning_controller') return { ...base, group: 'relief', crew: null, relief: 'day_supervisor', cycleCrew: p.dirCrew };
    if (p.position === 'panel_operator' || p.position === 'field_operator') {
      if (p.dayDuty) return { ...base, group: 'relief', crew: null, relief: 'day_duty', cycleCrew: p.dirCrew };
      return { ...base, group: p.position === 'panel_operator' ? 'panel' : 'field', crew: p.crew ?? p.dirCrew, relief: null, cycleCrew: null };
    }
    return { ...base, group: 'excluded', crew: null, relief: null, cycleCrew: null, note: 'No operating position in the directory' };
  });
}

/** The shift whose roster cycles a person's vacation follows. */
export const cycleCrewOf = (r: AllocRow): Crew | null => (r.group === 'relief' ? r.cycleCrew : r.group === 'excluded' ? null : r.crew);

export interface ActingCandidate { person: PlanPerson; state: 'picked' | 'eligible' | 'sick' | 'unknown_sick' | 'manual_no'; reason: string }
export interface CrewAlloc {
  crew: Crew;
  controllers: PlanPerson[];
  /** Panel group members by role (company and contractor Panel Operators). */
  panel: PlanPerson[];
  /** Field Operators taking a Panel seat (counted in Panel, never in Field). */
  acting: PlanPerson[];
  /** Field group without the acting ones. */
  field: PlanPerson[];
  /** Field Operators who count (Take-Charge = Yes). */
  fieldEligible: PlanPerson[];
  panelGroup: number; grade14: number;
  panelSlots: number; fieldSlots: number;
  candidates: ActingCandidate[];
  status: 'ok' | 'warning' | 'error';
}
export type IssueLevel = 'error' | 'warning';
export interface AllocIssue { level: IssueLevel; code: string; crew: Crew | null; employeeId?: string; text: string }
export interface AllocEval {
  crews: Record<Crew, CrewAlloc>;
  relief: { person: PlanPerson; row: AllocRow }[];
  excluded: { person: PlanPerson; row: AllocRow }[];
  issues: AllocIssue[];
  /** Everyone in the plan: their row and, for acting Panel, the flag. */
  placed: Map<string, { row: AllocRow; acting: boolean }>;
}

const pct = (s: { days: number } | null) => (s ? `${s.days} sick days` : 'sick figure not known');

/** Groups, acting Panel picks, vacation slots and every check of the allocation (errors block approval). */
export function evaluateAllocation(people: PlanPerson[], rows: AllocRow[], minimums = { panel: 3, field: 6 }): AllocEval {
  const byId = new Map(people.map((p) => [p.id, p]));
  const issues: AllocIssue[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.employeeId)) issues.push({ level: 'error', code: 'duplicate', crew: r.crew, employeeId: r.employeeId, text: `${byId.get(r.employeeId)?.name ?? 'Employee'} is in the plan twice.` });
    seen.add(r.employeeId);
  }
  const live = rows.filter((r) => byId.has(r.employeeId));
  const floats = live.filter((r) => r.group === 'relief' && r.relief === 'float_panel');
  const crews = {} as Record<Crew, CrewAlloc>;
  const placed = new Map<string, { row: AllocRow; acting: boolean }>();
  for (const r of live) if (r.group !== 'excluded') placed.set(r.employeeId, { row: r, acting: false });

  for (const crew of CREWS) {
    const mine = live.filter((r) => r.crew === crew && (r.group === 'controller' || r.group === 'panel' || r.group === 'field'));
    const of = (g: PlanGroup) => mine.filter((r) => r.group === g).map((r) => byId.get(r.employeeId)!);
    const controllers = of('controller').sort((a, b) => a.name.localeCompare(b.name));
    const panel = of('panel').sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0) || a.name.localeCompare(b.name));
    const fieldAll = of('field');
    const rowOf = (p: PlanPerson) => mine.find((r) => r.employeeId === p.id)!;
    const qualifiedPanel = panel.filter((p) => p.panelQualified === 'yes');
    // acting Panel: manual "yes" first, then the rule fills up to the group of four
    const forced = fieldAll.filter((p) => rowOf(p).acting === 'yes');
    const need = Math.max(0, VAC_RULES.panelGroup - qualifiedPanel.length - forced.length);
    const pool = fieldAll.filter((p) => rowOf(p).acting === 'auto' && (p.grade ?? 0) >= ACTING_PANEL.grade).map((p) => ({ p, mp: { employeeNumber: p.number, sick12: p.sick?.days ?? null } }));
    const known = pool.filter((x) => x.p.sick && !sickExcludesActing(x.mp)).sort((a, b) => byNumberDesc(a.mp, b.mp));
    const unknown = pool.filter((x) => !x.p.sick).sort((a, b) => byNumberDesc(a.mp, b.mp));
    const ordered = [...known, ...unknown];
    const picks = ordered.slice(0, need).map((x) => x.p);
    const acting = [...forced, ...picks];
    const candidates: ActingCandidate[] = [
      ...ordered.map((x) => ({ person: x.p, state: picks.includes(x.p) ? 'picked' as const : x.p.sick ? 'eligible' as const : 'unknown_sick' as const,
        reason: `Grade ${x.p.grade} · ${pct(x.p.sick)} · no. ${x.p.number}` })),
      ...pool.filter((x) => x.p.sick && sickExcludesActing(x.mp)).map((x) => ({ person: x.p, state: 'sick' as const, reason: `${x.p.sick!.days} sick days in 12 months (over ${ACTING_PANEL.sickMax})` })),
      ...fieldAll.filter((p) => rowOf(p).acting === 'no' && (p.grade ?? 0) >= ACTING_PANEL.grade).map((p) => ({ person: p, state: 'manual_no' as const, reason: 'Kept in Field by hand' }))
    ];
    for (const p of acting) placed.set(p.id, { row: rowOf(p), acting: true });
    const field = fieldAll.filter((p) => !acting.includes(p)).sort((a, b) => a.name.localeCompare(b.name));
    const fieldEligible = field.filter((p) => p.takeCharge === 'yes');
    const panelGroup = qualifiedPanel.length + acting.length;
    const grade14 = [...qualifiedPanel, ...acting].filter((p) => (p.grade ?? 0) >= 14).length;
    const c: CrewAlloc = { crew, controllers, panel, acting, field, fieldEligible, panelGroup, grade14,
      panelSlots: panelSlots(panelGroup, minimums.panel), fieldSlots: fieldSlots(fieldEligible.length, minimums.field), candidates, status: 'ok' };
    const add = (level: IssueLevel, code: string, text: string, employeeId?: string) => issues.push({ level, code, crew, employeeId, text });
    if (!controllers.length) add('error', 'no_controller', `${crew} Shift: no Controller.`);
    if (controllers.length > 1) add('warning', 'two_controllers', `${crew} Shift: ${controllers.length} Controllers.`);
    for (const p of controllers) if (!((p.grade ?? 0) >= 15 || ((p.grade ?? 0) >= 14 && p.actingController === 'yes')))
      add('error', 'controller_grade', `${p.name}: Controller needs Grade 15+ or a recorded Acting Controller (Grade ${p.grade ?? 'not recorded'}).`, p.id);
    for (const p of panel) if (p.panelQualified !== 'yes') add('error', 'panel_qualification', `${p.name}: Panel qualification is not Yes; not counted.`, p.id);
    for (const p of forced) if ((p.grade ?? 0) < ACTING_PANEL.grade) add('error', 'acting_grade', `${p.name}: acting Panel needs Grade ${ACTING_PANEL.grade}+.`, p.id);
    for (const p of acting) {
      if (p.panelQualified !== 'yes') add('warning', 'acting_qualification', `${p.name} (acting Panel): Panel qualification ${p.panelQualified === 'no' ? 'is No' : 'not recorded'}.`, p.id);
      if (!p.sick) add('warning', 'acting_sick_unknown', `${p.name} (acting Panel): no rolling 12-month sick figure; check it.`, p.id);
      if (p.sick && sickExcludesActing({ sick12: p.sick.days })) add('error', 'acting_sick', `${p.name}: ${p.sick.days} sick days in 12 months; over ${ACTING_PANEL.sickMax}, not eligible for acting Panel.`, p.id);
    }
    const passedOver = pool.filter((x) => x.p.sick && sickExcludesActing(x.mp));
    if (need > picks.length && passedOver.length) add('warning', 'sick_excluded', `${crew} Shift: ${passedOver.map((x) => x.p.name).join(', ')} not eligible for acting Panel (over ${ACTING_PANEL.sickMax} sick days).`);
    if (acting.length >= 2) add('warning', 'acting_reliance', `${crew} Shift: ${acting.length} of the 4 Panel seats are acting Field Operators.`);
    if (panelGroup < minimums.panel) add('error', 'panel_short', `${crew} Shift: Panel ${panelGroup} of ${minimums.panel} on duty even with nobody on vacation.`);
    else if (panelGroup < VAC_RULES.panelGroup) add(floats.length ? 'warning' : 'error', 'panel_group', `${crew} Shift: Panel ${panelGroup} of 4: ${floats.length ? 'Panel vacations need the floating relief.' : 'no Panel Operator can take vacation (no floating relief).'}`);
    else if (panelGroup > VAC_RULES.panelGroup) add('warning', 'panel_extra', `${crew} Shift: Panel ${panelGroup} (group of 4 + ${panelGroup - VAC_RULES.panelGroup}).`);
    if (grade14 === 0) add('error', 'no_grade14', `${crew} Shift: no Grade 14+ in the Panel group.`);
    else if (grade14 === 1) add('warning', 'one_grade14', `${crew} Shift: one Grade 14+ in Panel; their vacation needs another Grade 14+ on duty.`);
    if (fieldEligible.length < minimums.field) add('error', 'field_short', `${crew} Shift: Field ${fieldEligible.length} of ${minimums.field} on duty even with nobody on vacation.`);
    else if (c.fieldSlots === 0) add('error', 'field_no_slot', `${crew} Shift: Field ${fieldEligible.length}: no Field vacation possible (7 needed for one slot).`);
    for (const p of field) if (p.takeCharge !== 'yes') add('warning', 'take_charge', `${p.name}: Take-Charge ${p.takeCharge === 'no' ? 'No' : 'not confirmed'}; not counted in Field.`, p.id);
    for (const p of [...controllers, ...panel, ...field]) {
      if (p.grade == null && p.employmentType === 'knpc') add('warning', 'no_grade', `${p.name}: grade not recorded.`, p.id);
      if (p.dirCrew && p.crew && p.dirCrew !== p.crew && rowOf(p).crew === p.crew) add('warning', 'crew_mismatch', `${p.name}: directory says ${p.dirCrew} Shift, the dated move says ${p.crew} Shift.`, p.id);
    }
    const lv = issues.filter((i) => i.crew === crew);
    c.status = lv.some((i) => i.level === 'error') ? 'error' : lv.length ? 'warning' : 'ok';
    crews[crew] = c;
  }
  const relief = live.filter((r) => r.group === 'relief').map((row) => ({ person: byId.get(row.employeeId)!, row }));
  for (const { person: p, row } of relief) {
    if (!row.relief) issues.push({ level: 'error', code: 'relief_kind', crew: null, employeeId: p.id, text: `${p.name}: choose the relief role.` });
    if (!row.cycleCrew) issues.push({ level: 'error', code: 'relief_rota', crew: null, employeeId: p.id, text: `${p.name}: choose the shift rota their vacation cycles follow.` });
    if ((row.relief === 'vr' || row.relief === 'day_supervisor') && !CONTROLLER_ROLES.includes(p.position) && !((p.grade ?? 0) >= 15))
      issues.push({ level: 'error', code: 'relief_controller', crew: null, employeeId: p.id, text: `${p.name}: ${RELIEF_LABEL[row.relief]} needs a Controller.` });
    if (row.relief === 'float_panel' && p.panelQualified !== 'yes') issues.push({ level: 'error', code: 'float_qualification', crew: null, employeeId: p.id, text: `${p.name}: floating Panel relief needs Panel qualification Yes.` });
  }
  for (const r of live) if ((r.group === 'controller' || r.group === 'panel' || r.group === 'field') && !r.crew)
    issues.push({ level: 'error', code: 'no_shift', crew: null, employeeId: r.employeeId, text: `${byId.get(r.employeeId)!.name}: no shift.` });
  // balance: Field counted manpower more than 2 apart between shifts
  const fc = CREWS.map((c) => crews[c].fieldEligible.length);
  if (Math.max(...fc) - Math.min(...fc) > 2) issues.push({ level: 'warning', code: 'unbalanced', crew: null, text: `Field is uneven: ${CREWS.map((c, i) => `${c} ${fc[i]}`).join(' · ')}.` });
  const excluded = live.filter((r) => r.group === 'excluded').map((row) => ({ person: byId.get(row.employeeId)!, row }));
  const missing = people.filter((p) => !seen.has(p.id) && p.position);
  for (const p of missing) issues.push({ level: 'warning', code: 'not_in_plan', crew: null, employeeId: p.id, text: `${p.name}: not in the plan yet.` });
  return { crews, relief, excluded, issues, placed };
}

/** The plan's people as the manpower engine sees them (acting Panel as Panel, relief where it works). */
export function planningPeople(people: PlanPerson[], ev: AllocEval): MpPerson[] {
  const out: MpPerson[] = [];
  for (const p of people) {
    const pl = ev.placed.get(p.id); if (!pl) continue;
    const { row, acting } = pl;
    const base: MpPerson = { id: p.id, employeeNumber: p.number, name: p.name, grade: p.grade, role: p.position, crew: null, employmentType: p.employmentType,
      takeCharge: p.takeCharge, panelQualified: p.panelQualified, actingController: p.actingController, sick12: p.sick?.days ?? null };
    if (row.group === 'controller') out.push({ ...base, role: 'controller', crew: row.crew });
    else if (row.group === 'panel') out.push({ ...base, role: 'panel_operator', crew: row.crew });
    else if (row.group === 'field') out.push(acting ? { ...base, role: 'panel_operator', crew: row.crew, panelQualified: 'yes' } : { ...base, role: 'field_operator', crew: row.crew });
    else if (row.group === 'relief' && row.relief === 'vr') out.push({ ...base, role: 'vr_controller', moves: row.cycleCrew ? [{ start: '1900-01-01', end: null, crew: row.cycleCrew, kind: 'placement' }] : [] });
    else if (row.group === 'relief' && row.relief === 'day_supervisor') out.push({ ...base, role: 'morning_controller' });
    else if (row.group === 'relief' && row.relief === 'day_duty' && row.cycleCrew && (p.position === 'panel_operator' || p.position === 'field_operator'))
      out.push({ ...base, role: p.position, crew: row.cycleCrew, moves: [{ start: '1900-01-01', end: null, crew: DAY_DUTY, kind: 'temporary' }] });
    // floating Panel relief is added to a shift only on the days it covers (see the plan check)
  }
  return out;
}
