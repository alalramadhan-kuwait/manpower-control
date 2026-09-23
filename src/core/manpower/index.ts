// Core manpower engine (Stage B). Pure functions, no I/O, no UI.
//
// For a date, every crew's duty comes from the roster engine (src/core/roster — the single roster logic).
// For each crew on Morning / Afternoon / Night the engine counts QUALIFIED available manpower per position
// against the full-operation minimums and returns GREEN (above minimum), AMBER (exactly minimum = No Buffer)
// or RED (below minimum, or a mandatory qualification / grade requirement missing).
//
// Availability: approved/planned absences in the CURRENT approved plan remove a person only on days their crew
// is scheduled to work. Absences on Off days stay on the record but do not reduce manpower. Unresolved absences
// are warnings only and never reduce manpower. Rescheduled / cancelled records are ignored.

import { CREWS, SHIFT_LABEL, dutyFor, dutyLabel, stateOf } from '../roster';
import type { Crew, DutyCode, State } from '../roster';

export type Status = 'green' | 'amber' | 'red';
export type Role = 'controller' | 'vr_controller' | 'morning_controller' | 'panel_operator' | 'field_operator';
export type QualStatus = 'yes' | 'no' | 'not_yet_confirmed' | null;

export interface MpPerson {
  id: string;
  employeeNumber: string;
  name: string;
  role: Role | null;
  crew: Crew | null;
  grade: number | null;
  employmentType: 'knpc' | 'contractor';
  takeCharge: QualStatus;
  panelQualified: QualStatus;
  actingController: QualStatus;
}

/**
 * A Controller Management assignment (Stage H), already filtered to active (not cancelled) records.
 * - shift_cover: `employeeId` acts as the Controller of `crew` from `start` to `end` (inclusive);
 * - morning_rotation: `employeeId` holds the Morning Controller post from `start` to `end`.
 * On those dates the person is away from their own crew (if they have one).
 */
export interface MpAssignment {
  id: string;
  kind: 'shift_cover' | 'morning_rotation';
  employeeId: string;
  crew: Crew | null;
  start: string;
  end: string;
  coversEmployeeId?: string | null;
}

export interface MpAbsence {
  id?: string;
  employeeId: string;
  start: string;
  end: string;
  status: string; // approved | planned | unresolved | cancelled | rescheduled
  typeCode: string | null;
  /** Short display code (PV, SL, UL …) from absence_types.short_code. */
  typeShort?: string | null;
  typeLabel?: string | null;
  sourceRef?: string | null;
  inCurrentPlan?: boolean;
}

export interface Rules {
  controllerMin: number;
  /** Normal Controller grade (and above). */
  controllerGrade: number;
  /** Grade that may act as Controller when formally qualified as Acting Controller. */
  actingControllerGrade: number;
  panelMin: number;
  /** Minimum number of Grade-14 Panel Operators among the qualified Panel Operators. */
  panelGrade14Min: number;
  /** Grade that satisfies the Panel Grade-14 requirement (this grade and above). */
  panelGrade14: number;
  fieldMin: number;
  /** One Controller per crew is the normal complement, so meeting the minimum is GREEN, not No Buffer. */
  controllerGreenAtMinimum: boolean;
}

/** Full operation of the unit. Shutdown / one-train modes are Stage I and will supply their own Rules. */
export const FULL_OPERATION: Rules = {
  controllerMin: 1, controllerGrade: 15, actingControllerGrade: 14,
  panelMin: 3, panelGrade14Min: 1, panelGrade14: 14,
  fieldMin: 6,
  controllerGreenAtMinimum: true
};

export interface NotCounted { person: MpPerson; reason: string; /** true when the reason is missing data (not yet confirmed / not recorded), not a No */ pendingData?: boolean }

/**
 * What a position's result means operationally:
 * - above_minimum / no_buffer: final GREEN / AMBER.
 * - staffed: exactly at minimum where that is the normal complement (one Controller). Final GREEN.
 * - shortage: CONFIRMED manpower shortage — below minimum (or grade requirement missing) even if every
 *   unconfirmed qualification turned out to be Yes. Final RED.
 * - data_incomplete: below minimum only because qualification data is not yet confirmed. Not final.
 * - coverage_required: the crew Controller is on leave and no cover is recorded (Vacation Relief coverage
 *   is not implemented yet). Not final; becomes final once coverage is assigned.
 */
export type Finding = 'above_minimum' | 'staffed' | 'no_buffer' | 'shortage' | 'data_incomplete' | 'coverage_required';
export const PENDING_FINDINGS: Finding[] = ['data_incomplete', 'coverage_required'];

export interface PositionResult {
  key: 'controller' | 'panel' | 'field';
  label: string;
  /** Qualified and available (confirmed data only). */
  count: number;
  min: number;
  buffer: number;
  /** Strict rule result on confirmed data only. */
  status: Status;
  finding: Finding;
  /** false while the finding is data_incomplete or coverage_required. */
  final: boolean;
  /** Count if every unconfirmed qualification were confirmed (for data_incomplete). */
  potential: number;
  /** Status to expect once pending items are resolved (coverage assigned / data confirmed as Yes). */
  provisionalStatus: Status;
  counted: MpPerson[];
  notCounted: NotCounted[];
  issues: string[];
}
export interface ControllerResult extends PositionResult {
  /** Grade-14 Acting Controller in use on this duty, if any (displayed as "Acting Controller"). Only an
   *  explicitly recorded Acting Controller qualification (= Yes) is used; it is never inferred. */
  acting: MpPerson | null;
  /** Crew Controllers on leave on this working day (they need cover). */
  onLeave: MpPerson[];
  /** Crew Controllers away on another assignment (Morning rotation, covering another crew) on this working day. */
  away: { person: MpPerson; assignment: MpAssignment }[];
  /** The recorded cover for this crew today, and whether it counts (it does not while the cover is on leave). */
  cover: { person: MpPerson; assignment: MpAssignment; counted: boolean; absence: MpAbsence | null } | null;
}
export interface PanelResult extends PositionResult { grade14: number; potentialGrade14: number }
export interface AbsenceOnDay { person: MpPerson; absence: MpAbsence; reducesManpower: boolean }

export interface CrewDay {
  crew: Crew;
  duty: DutyCode;
  state: State;
  shift: string;
  dutyLabel: string;
  working: boolean;
  /** Strict rule result on confirmed data only (null when Off). */
  status: Status | null;
  /** Final GREEN/AMBER/RED: RED when there is a confirmed shortage; null while anything is pending
   *  (coverage required / data incomplete) and nothing is confirmed short; null when Off. */
  finalStatus: Status | null;
  /** Expected result once pending items are resolved (null when Off). */
  provisionalStatus: Status | null;
  /** Pending findings on this duty (coverage_required, data_incomplete). */
  pending: Finding[];
  confirmedShortage: boolean;
  noBuffer: boolean;
  controller: ControllerResult;
  panel: PanelResult;
  field: PositionResult;
  absences: AbsenceOnDay[];
  unresolved: AbsenceOnDay[];
  members: number;
}
export interface DayStaff {
  person: MpPerson; absence: MpAbsence | null; unresolved: MpAbsence | null;
  /** What the person is assigned to today (covering a crew, or holding the Morning post on rotation). */
  assignment: MpAssignment | null;
  /** Holds the Morning Controller post today (the rotation holder when one is active, else the Morning Controller). */
  morningPost: boolean;
}
export interface DayResult {
  date: string;
  crews: CrewDay[]; // ordered Morning, Afternoon, Night, Off
  dayStaff: DayStaff[]; // VR and Morning Controllers, and anyone on Morning rotation
  /** Strict rule result on confirmed data only. */
  overall: Status;
  /** Final day status (see CrewDay.finalStatus). */
  finalStatus: Status | null;
  provisionalStatus: Status;
  noBuffer: boolean;
  counts: { confirmedShortage: number; coverageRequired: number; dataIncomplete: number; unresolvedWarnings: number };
}

const SHIFT_ORDER: State[] = ['M', 'A', 'N', 'Off'];
const RANK: Record<Status, number> = { green: 0, amber: 1, red: 2 };
export const worst = (list: Status[]): Status => list.reduce<Status>((w, s) => (RANK[s] > RANK[w] ? s : w), 'green');

/** GREEN above minimum, AMBER exactly minimum, RED below minimum. */
export function statusFor(count: number, min: number): Status {
  return count > min ? 'green' : count === min ? 'amber' : 'red';
}

const isUnknown = (q: QualStatus) => q !== 'yes' && q !== 'no';

function finishPosition(base: Omit<PositionResult, 'finding' | 'final' | 'provisionalStatus' | 'status'> & { requirementMet: boolean; potentialMet: boolean; coverage?: boolean; greenAtMinimum?: boolean }): PositionResult {
  const { requirementMet, potentialMet, coverage, greenAtMinimum, ...rest } = base;
  const rate = (count: number): Status => (greenAtMinimum && count >= base.min ? 'green' : statusFor(count, base.min));
  const status: Status = !requirementMet ? 'red' : rate(base.count);
  let finding: Finding; let provisionalStatus: Status;
  if (requirementMet) { finding = base.count > base.min ? 'above_minimum' : status === 'green' ? 'staffed' : 'no_buffer'; provisionalStatus = status; }
  else if (coverage) { finding = 'coverage_required'; provisionalStatus = rate(base.min); }
  else if (potentialMet) { finding = 'data_incomplete'; provisionalStatus = rate(base.potential); }
  else { finding = 'shortage'; provisionalStatus = 'red'; }
  return { ...rest, status, finding, final: !PENDING_FINDINGS.includes(finding), provisionalStatus };
}

const covers = (a: MpAbsence, date: string) => a.start <= date && date <= a.end;
const isLeave = (a: MpAbsence) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false;
const isUnresolved = (a: MpAbsence) => a.status === 'unresolved' && a.inCurrentPlan !== false;
const gradeText = (p: MpPerson) => (p.grade == null ? 'grade not recorded' : `Grade ${p.grade}`);

function qualReason(label: string, s: QualStatus): string {
  return s === 'no' ? `${label} = No` : s === 'not_yet_confirmed' ? `${label} not yet confirmed` : `${label} not recorded`;
}

export function evaluateDay(date: string, people: MpPerson[], absences: MpAbsence[], rules: Rules = FULL_OPERATION, assignments: MpAssignment[] = []): DayResult {
  const todays = assignments.filter((a) => a.start <= date && date <= a.end);
  const assignmentOf = (p: MpPerson) => todays.find((a) => a.employeeId === p.id) ?? null;
  const byId = new Map(people.map((p) => [p.id, p]));
  const byEmp = new Map<string, MpAbsence[]>();
  for (const a of absences) if (covers(a, date)) { const l = byEmp.get(a.employeeId) ?? []; l.push(a); byEmp.set(a.employeeId, l); }
  const leaveOf = (p: MpPerson) => (byEmp.get(p.id) ?? []).find(isLeave) ?? null;
  const unresolvedOf = (p: MpPerson) => (byEmp.get(p.id) ?? []).find(isUnresolved) ?? null;

  const crews: CrewDay[] = CREWS.map((crew) => {
    const duty = dutyFor(date, crew);
    const state = stateOf(duty);
    const working = state !== 'Off';
    const members = people.filter((p) => p.crew === crew && (p.role === 'controller' || p.role === 'panel_operator' || p.role === 'field_operator'));
    const absencesOnDay: AbsenceOnDay[] = [];
    const unresolved: AbsenceOnDay[] = [];
    const available: MpPerson[] = [];
    const away: { person: MpPerson; assignment: MpAssignment }[] = [];
    for (const p of members) {
      const leave = leaveOf(p);
      const unres = unresolvedOf(p);
      const assigned = p.role === 'controller' ? assignmentOf(p) : null;
      if (leave) absencesOnDay.push({ person: p, absence: leave, reducesManpower: working });
      if (unres) unresolved.push({ person: p, absence: unres, reducesManpower: false });
      if (assigned && working && !leave) { away.push({ person: p, assignment: assigned }); continue; }
      if (!leave || !working) available.push(p);
    }

    // ---- Controller
    const ctrlCounted: MpPerson[] = []; const ctrlNot: NotCounted[] = []; const ctrlIssues: string[] = [];
    let acting: MpPerson | null = null;
    const qualifiesAsController = (p: MpPerson) => (p.grade != null && p.grade >= rules.controllerGrade) || (p.grade != null && p.grade >= rules.actingControllerGrade && p.actingController === 'yes');
    for (const p of available.filter((x) => x.role === 'controller')) {
      if (p.grade != null && p.grade >= rules.controllerGrade) ctrlCounted.push(p);
      else if (p.grade != null && p.grade >= rules.actingControllerGrade && p.actingController === 'yes') { ctrlCounted.push(p); acting ??= p; }
      else ctrlNot.push({ person: p, pendingData: p.grade == null, reason: `${gradeText(p)}; Controller needs Grade ${rules.controllerGrade}+ or a recorded Grade-${rules.actingControllerGrade} Acting Controller qualification` });
    }
    const pool = { panel: available.filter((x) => x.role === 'panel_operator'), field: available.filter((x) => x.role === 'field_operator') };
    // Recorded cover (Controller Management): counts as this crew's Controller unless the cover is on leave.
    const coverAssignment = todays.find((a) => a.kind === 'shift_cover' && a.crew === crew) ?? null;
    const coverPerson = coverAssignment ? byId.get(coverAssignment.employeeId) ?? null : null;
    let cover: ControllerResult['cover'] = null;
    if (coverAssignment && coverPerson) {
      const absence = leaveOf(coverPerson);
      const counted = working && !absence && coverPerson.grade != null && coverPerson.grade >= rules.controllerGrade;
      cover = { person: coverPerson, assignment: coverAssignment, counted, absence };
      if (counted && !ctrlCounted.includes(coverPerson)) ctrlCounted.push(coverPerson);
    }
    if (ctrlCounted.length < rules.controllerMin) {
      // Draw a Grade-14 Acting Controller from the crew — only someone with the Acting Controller qualification
      // explicitly recorded as Yes; never inferred — from the position with the larger buffer.
      const canAct = (p: MpPerson) => p.grade != null && p.grade >= rules.actingControllerGrade && p.grade < rules.controllerGrade && p.actingController === 'yes';
      const panelBuffer = pool.panel.filter((p) => p.panelQualified === 'yes').length - rules.panelMin;
      const fieldBuffer = pool.field.filter((p) => p.takeCharge === 'yes').length - rules.fieldMin;
      const order: ('panel' | 'field')[] = fieldBuffer > panelBuffer ? ['field', 'panel'] : ['panel', 'field'];
      for (const k of order) {
        const c = pool[k].find(canAct);
        if (c) { acting = c; ctrlCounted.push(c); pool[k] = pool[k].filter((p) => p !== c); break; }
      }
    }
    if (acting) ctrlIssues.push(`Acting Controller: ${acting.name} (Grade ${acting.grade})`);
    if (cover?.counted) ctrlIssues.push(`Covered by ${cover.person.name}`);
    const ctrlOnLeave = working ? members.filter((p) => p.role === 'controller' && leaveOf(p) && qualifiesAsController(p)) : [];
    const ctrlCount = ctrlCounted.length;
    const ctrlMet = ctrlCount >= rules.controllerMin;
    const ctrlCoverage = !ctrlMet && (ctrlOnLeave.length > 0 || away.length > 0 || (cover !== null && !cover.counted));
    const ctrlPotentialMet = ctrlCount + ctrlNot.filter((n) => n.pendingData).length >= rules.controllerMin;
    if (ctrlCoverage) {
      const why = [...ctrlOnLeave.map((p) => `${p.name} (${leaveOf(p)?.typeLabel ?? 'leave'})`), ...away.map((w) => `${w.person.name} (${w.assignment.kind === 'morning_rotation' ? 'Morning rotation' : `covering ${w.assignment.crew} Shift`})`)];
      ctrlIssues.push(`Controller coverage required: ${why.join(', ')}${cover && !cover.counted ? ` — recorded cover ${cover.person.name} is ${cover.absence ? 'on leave' : 'not Grade ' + rules.controllerGrade + '+'}` : ' — no cover recorded'}`);
    }
    else if (!ctrlMet && ctrlPotentialMet) ctrlIssues.push('Controller grade not recorded');
    else if (!ctrlMet) ctrlIssues.push(`Confirmed shortage: Controller ${ctrlCount} of ${rules.controllerMin} required`);
    const controller: ControllerResult = {
      ...finishPosition({ key: 'controller', label: 'Controller', count: ctrlCount, min: rules.controllerMin, buffer: ctrlCount - rules.controllerMin, potential: ctrlCount + ctrlNot.filter((n) => n.pendingData).length,
        counted: ctrlCounted, notCounted: ctrlNot, issues: ctrlIssues, requirementMet: ctrlMet, potentialMet: ctrlPotentialMet, coverage: ctrlCoverage, greenAtMinimum: rules.controllerGreenAtMinimum }),
      acting, onLeave: ctrlOnLeave, away, cover
    };

    // ---- Panel
    const panelCounted = pool.panel.filter((p) => p.panelQualified === 'yes');
    const panelNot: NotCounted[] = pool.panel.filter((p) => p.panelQualified !== 'yes').map((p) => ({ person: p, pendingData: isUnknown(p.panelQualified), reason: qualReason('Panel qualification', p.panelQualified) }));
    const isG14 = (p: MpPerson) => p.grade != null && p.grade >= rules.panelGrade14;
    const g14Unknown = (p: MpPerson) => p.grade == null && p.employmentType === 'knpc';
    const grade14 = panelCounted.filter(isG14).length;
    const panelPotentialPeople = [...panelCounted, ...pool.panel.filter((p) => isUnknown(p.panelQualified))];
    const potentialGrade14 = panelPotentialPeople.filter((p) => isG14(p) || g14Unknown(p)).length;
    const panelMet = panelCounted.length >= rules.panelMin && grade14 >= rules.panelGrade14Min;
    const panelPotentialMet = panelPotentialPeople.length >= rules.panelMin && potentialGrade14 >= rules.panelGrade14Min;
    const panelIssues: string[] = [];
    if (!panelMet) {
      const what = [panelCounted.length < rules.panelMin ? `${panelCounted.length}/${rules.panelMin} qualified` : null, grade14 < rules.panelGrade14Min ? `no Grade ${rules.panelGrade14}+ Panel Operator` : null].filter(Boolean).join(', ');
      const short = [panelCounted.length < rules.panelMin ? `${panelCounted.length} of ${rules.panelMin} required` : null, grade14 < rules.panelGrade14Min ? `no Grade ${rules.panelGrade14}+ Panel Operator available` : null].filter(Boolean).join(', ');
      panelIssues.push(panelPotentialMet ? `Panel qualification data incomplete: ${what} confirmed` : `Confirmed shortage: Panel ${short}`);
    }
    const panel: PanelResult = {
      ...finishPosition({ key: 'panel', label: 'Panel', count: panelCounted.length, min: rules.panelMin, buffer: panelCounted.length - rules.panelMin, potential: panelPotentialPeople.length,
        counted: panelCounted, notCounted: panelNot, issues: panelIssues, requirementMet: panelMet, potentialMet: panelPotentialMet }),
      grade14, potentialGrade14
    };

    // ---- Field (only Take-Charge = Yes counts)
    const fieldCounted = pool.field.filter((p) => p.takeCharge === 'yes');
    const fieldNot: NotCounted[] = pool.field.filter((p) => p.takeCharge !== 'yes').map((p) => ({ person: p, pendingData: isUnknown(p.takeCharge), reason: qualReason('Take-Charge', p.takeCharge) }));
    const fieldUnknown = fieldNot.filter((n) => n.pendingData).length;
    const fieldPotential = fieldCounted.length + fieldUnknown;
    const fieldMet = fieldCounted.length >= rules.fieldMin;
    const fieldPotentialMet = fieldPotential >= rules.fieldMin;
    const fieldIssues: string[] = [];
    if (!fieldMet) fieldIssues.push(fieldPotentialMet
      ? `Take-Charge data incomplete: ${fieldCounted.length}/${rules.fieldMin} confirmed, ${fieldUnknown} not yet confirmed (up to ${fieldPotential}/${rules.fieldMin} if confirmed)`
      : `Confirmed shortage: Field ${fieldCounted.length} of ${rules.fieldMin} required${fieldUnknown ? ` (at most ${fieldPotential} even if all unconfirmed are confirmed)` : ''}`);
    const field: PositionResult = finishPosition({ key: 'field', label: 'Field', count: fieldCounted.length, min: rules.fieldMin, buffer: fieldCounted.length - rules.fieldMin, potential: fieldPotential,
      counted: fieldCounted, notCounted: fieldNot, issues: fieldIssues, requirementMet: fieldMet, potentialMet: fieldPotentialMet });

    const positions = [controller, panel, field];
    const status = working ? worst(positions.map((p) => p.status)) : null;
    const confirmedShortage = working && positions.some((p) => p.finding === 'shortage');
    const pending = working ? [...new Set(positions.filter((p) => !p.final).map((p) => p.finding))] : [];
    const provisionalStatus = working ? worst(positions.map((p) => p.provisionalStatus)) : null;
    const finalStatus = !working ? null : confirmedShortage ? 'red' : pending.length ? null : status;
    return {
      crew, duty, state, shift: SHIFT_LABEL[state], dutyLabel: dutyLabel(duty), working, status, finalStatus, provisionalStatus, pending, confirmedShortage,
      noBuffer: finalStatus === 'amber', controller, panel, field, absences: absencesOnDay, unresolved, members: members.length
    };
  }).sort((a, b) => SHIFT_ORDER.indexOf(a.state) - SHIFT_ORDER.indexOf(b.state));

  const rotation = todays.find((a) => a.kind === 'morning_rotation') ?? null;
  const dayStaff: DayStaff[] = people
    .filter((p) => p.role === 'vr_controller' || p.role === 'morning_controller' || p.id === rotation?.employeeId)
    .map((p) => ({ person: p, absence: leaveOf(p), unresolved: unresolvedOf(p), assignment: assignmentOf(p),
      morningPost: rotation ? p.id === rotation.employeeId : p.role === 'morning_controller' }));

  const workingCrews = crews.filter((c) => c.working);
  const overall = worst(workingCrews.map((c) => c.status as Status));
  const anyShortage = workingCrews.some((c) => c.confirmedShortage);
  const anyPending = workingCrews.some((c) => c.pending.length > 0);
  const finalStatus: Status | null = anyShortage ? 'red' : anyPending ? null : overall;
  const provisionalStatus = worst(workingCrews.map((c) => c.provisionalStatus as Status));
  const counts = {
    confirmedShortage: workingCrews.filter((c) => c.confirmedShortage).length,
    coverageRequired: workingCrews.filter((c) => c.pending.includes('coverage_required')).length,
    dataIncomplete: workingCrews.filter((c) => c.pending.includes('data_incomplete')).length,
    unresolvedWarnings: crews.reduce((n, c) => n + c.unresolved.length, 0) + dayStaff.filter((s) => s.unresolved).length
  };
  return { date, crews, dayStaff, overall, finalStatus, provisionalStatus, noBuffer: finalStatus === 'amber', counts };
}

/** Status for each date in a range (for later calendar views and for tests). */
export function evaluateRange(from: string, to: string, people: MpPerson[], absences: MpAbsence[], rules: Rules = FULL_OPERATION, assignments: MpAssignment[] = []): DayResult[] {
  const out: DayResult[] = [];
  for (let d = from; d <= to; ) {
    out.push(evaluateDay(d, people, absences, rules, assignments));
    const next = new Date(d + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1); d = next.toISOString().slice(0, 10);
  }
  return out;
}
