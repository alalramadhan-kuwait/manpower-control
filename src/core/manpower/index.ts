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

export interface MpAbsence {
  id?: string;
  employeeId: string;
  start: string;
  end: string;
  status: string; // approved | planned | unresolved | cancelled | rescheduled
  typeCode: string | null;
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
}

/** Full operation of the unit. Shutdown / one-train modes are Stage I and will supply their own Rules. */
export const FULL_OPERATION: Rules = {
  controllerMin: 1, controllerGrade: 15, actingControllerGrade: 14,
  panelMin: 3, panelGrade14Min: 1, panelGrade14: 14,
  fieldMin: 6
};

export interface NotCounted { person: MpPerson; reason: string }
export interface PositionResult {
  key: 'controller' | 'panel' | 'field';
  label: string;
  count: number;
  min: number;
  buffer: number;
  status: Status;
  counted: MpPerson[];
  notCounted: NotCounted[];
  issues: string[];
}
export interface ControllerResult extends PositionResult {
  /** Grade-14 Acting Controller in use on this duty, if any (displayed as "Acting Controller"). */
  acting: MpPerson | null;
}
export interface PanelResult extends PositionResult { grade14: number }
export interface AbsenceOnDay { person: MpPerson; absence: MpAbsence; reducesManpower: boolean }

export interface CrewDay {
  crew: Crew;
  duty: DutyCode;
  state: State;
  shift: string;
  dutyLabel: string;
  working: boolean;
  /** null when the crew is Off. */
  status: Status | null;
  noBuffer: boolean;
  controller: ControllerResult;
  panel: PanelResult;
  field: PositionResult;
  absences: AbsenceOnDay[];
  unresolved: AbsenceOnDay[];
  members: number;
}
export interface DayStaff { person: MpPerson; absence: MpAbsence | null; unresolved: MpAbsence | null }
export interface DayResult {
  date: string;
  crews: CrewDay[]; // ordered Morning, Afternoon, Night, Off
  dayStaff: DayStaff[]; // VR and Morning Controllers (no crew; coverage is recorded in Stage H)
  overall: Status;
  noBuffer: boolean;
}

const SHIFT_ORDER: State[] = ['M', 'A', 'N', 'Off'];
const RANK: Record<Status, number> = { green: 0, amber: 1, red: 2 };
export const worst = (list: Status[]): Status => list.reduce<Status>((w, s) => (RANK[s] > RANK[w] ? s : w), 'green');

/** GREEN above minimum, AMBER exactly minimum, RED below minimum. */
export function statusFor(count: number, min: number): Status {
  return count > min ? 'green' : count === min ? 'amber' : 'red';
}

const covers = (a: MpAbsence, date: string) => a.start <= date && date <= a.end;
const isLeave = (a: MpAbsence) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false;
const isUnresolved = (a: MpAbsence) => a.status === 'unresolved' && a.inCurrentPlan !== false;
const gradeText = (p: MpPerson) => (p.grade == null ? 'grade not recorded' : `Grade ${p.grade}`);

function qualReason(label: string, s: QualStatus): string {
  return s === 'no' ? `${label} = No` : s === 'not_yet_confirmed' ? `${label} not yet confirmed` : `${label} not recorded`;
}

export function evaluateDay(date: string, people: MpPerson[], absences: MpAbsence[], rules: Rules = FULL_OPERATION): DayResult {
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
    for (const p of members) {
      const leave = leaveOf(p);
      const unres = unresolvedOf(p);
      if (leave) absencesOnDay.push({ person: p, absence: leave, reducesManpower: working });
      if (unres) unresolved.push({ person: p, absence: unres, reducesManpower: false });
      if (!leave || !working) available.push(p);
    }

    // ---- Controller
    const ctrlCounted: MpPerson[] = []; const ctrlNot: NotCounted[] = []; const ctrlIssues: string[] = [];
    let acting: MpPerson | null = null;
    for (const p of available.filter((x) => x.role === 'controller')) {
      if (p.grade != null && p.grade >= rules.controllerGrade) ctrlCounted.push(p);
      else if (p.grade != null && p.grade >= rules.actingControllerGrade && p.actingController === 'yes') { ctrlCounted.push(p); acting ??= p; }
      else ctrlNot.push({ person: p, reason: `${gradeText(p)}; Controller needs Grade ${rules.controllerGrade}+ or an approved Grade-${rules.actingControllerGrade} Acting Controller` });
    }
    const pool = { panel: available.filter((x) => x.role === 'panel_operator'), field: available.filter((x) => x.role === 'field_operator') };
    if (ctrlCounted.length < rules.controllerMin) {
      // Draw a qualified Grade-14 Acting Controller from the crew, from the position with the larger buffer.
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
    const ctrlCount = ctrlCounted.length;
    const controller: ControllerResult = {
      key: 'controller', label: 'Controller', count: ctrlCount, min: rules.controllerMin, buffer: ctrlCount - rules.controllerMin,
      status: statusFor(ctrlCount, rules.controllerMin), counted: ctrlCounted, notCounted: ctrlNot, issues: ctrlIssues, acting
    };
    if (ctrlCount < rules.controllerMin) controller.issues.push(`No qualified Controller available (${ctrlCount}/${rules.controllerMin})`);

    // ---- Panel
    const panelCounted = pool.panel.filter((p) => p.panelQualified === 'yes');
    const panelNot: NotCounted[] = pool.panel.filter((p) => p.panelQualified !== 'yes').map((p) => ({ person: p, reason: qualReason('Panel qualification', p.panelQualified) }));
    const grade14 = panelCounted.filter((p) => p.grade != null && p.grade >= rules.panelGrade14).length;
    const panelIssues: string[] = [];
    let panelStatus = statusFor(panelCounted.length, rules.panelMin);
    if (panelCounted.length < rules.panelMin) panelIssues.push(`Panel below minimum (${panelCounted.length}/${rules.panelMin})`);
    if (grade14 < rules.panelGrade14Min) { panelStatus = 'red'; panelIssues.push(`No Grade ${rules.panelGrade14} Panel Operator available`); }
    const panel: PanelResult = {
      key: 'panel', label: 'Panel', count: panelCounted.length, min: rules.panelMin, buffer: panelCounted.length - rules.panelMin,
      status: panelStatus, counted: panelCounted, notCounted: panelNot, issues: panelIssues, grade14
    };

    // ---- Field (only Take-Charge = Yes counts)
    const fieldCounted = pool.field.filter((p) => p.takeCharge === 'yes');
    const fieldNot: NotCounted[] = pool.field.filter((p) => p.takeCharge !== 'yes').map((p) => ({ person: p, reason: qualReason('Take-Charge', p.takeCharge) }));
    const fieldIssues: string[] = [];
    if (fieldCounted.length < rules.fieldMin) fieldIssues.push(`Field below minimum (${fieldCounted.length}/${rules.fieldMin} Take-Charge confirmed${fieldNot.length ? `; ${fieldNot.length} on duty not counted` : ''})`);
    const field: PositionResult = {
      key: 'field', label: 'Field', count: fieldCounted.length, min: rules.fieldMin, buffer: fieldCounted.length - rules.fieldMin,
      status: statusFor(fieldCounted.length, rules.fieldMin), counted: fieldCounted, notCounted: fieldNot, issues: fieldIssues
    };

    const status = working ? worst([controller.status, panel.status, field.status]) : null;
    return {
      crew, duty, state, shift: SHIFT_LABEL[state], dutyLabel: dutyLabel(duty), working, status,
      noBuffer: status === 'amber', controller, panel, field, absences: absencesOnDay, unresolved, members: members.length
    };
  }).sort((a, b) => SHIFT_ORDER.indexOf(a.state) - SHIFT_ORDER.indexOf(b.state));

  const dayStaff: DayStaff[] = people
    .filter((p) => p.role === 'vr_controller' || p.role === 'morning_controller')
    .map((p) => ({ person: p, absence: leaveOf(p), unresolved: unresolvedOf(p) }));

  const overall = worst(crews.filter((c) => c.working).map((c) => c.status as Status));
  return { date, crews, dayStaff, overall, noBuffer: overall === 'amber' };
}

/** Status for each date in a range (for later calendar views and for tests). */
export function evaluateRange(from: string, to: string, people: MpPerson[], absences: MpAbsence[], rules: Rules = FULL_OPERATION): DayResult[] {
  const out: DayResult[] = [];
  for (let d = from; d <= to; ) {
    out.push(evaluateDay(d, people, absences, rules));
    const next = new Date(d + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1); d = next.toISOString().slice(0, 10);
  }
  return out;
}
