// One leave's status, kept as four separate facts so they are never confused (owner, 26 Oct 2026):
// - plan: the version is current, or was rescheduled (replaced by a later version) or cancelled;
// - approval: the Section Head's approval in the app (leave_records.approved_at / declined_at; only a plan PV needs it);
// - oracle: the Oracle HR application, only as recorded in the Oracle log (oracle_requests). A leave with no recorded
//   confirmation is "not recorded", never assumed submitted; the entries made for past leave on 24 Sep are "assumed";
// - time: upcoming, on leave, taken (from the dates; it says nothing about the application).
// A pending request (request_headers, status submitted) is a fifth fact, kept apart: it has no leave record yet.
import { isPlanPv } from '../oracle';
import { addDaysIso } from '../roster';
import { isOpenEnd } from './index';
import { personOn, type MpCrewMove, type MpPerson } from '../manpower';

export type PlanState = 'current' | 'rescheduled' | 'cancelled';
export type ApprovalState = 'approved' | 'awaiting' | 'declined' | 'lapsed' | 'not_required';
export type OracleState = 'submitted' | 'approved' | 'rejected' | 'assumed' | 'not_recorded';
export type TimeState = 'upcoming' | 'on_leave' | 'taken' | 'open';
export interface LeaveState { plan: PlanState; approval: ApprovalState; oracle: OracleState; time: TimeState }

/** One line of the Oracle log for a leave's dates. */
export interface OracleLogEntry { rootId: string; start: string; end: string; status: 'submitted' | 'approved' | 'rejected' | 'cancelled'; source: 'recorded' | 'assumed_past'; at: string }

export interface StatusRecord {
  root_id: string; start_date: string; end_date: string; status: string; in_current_plan: boolean; absence_type_code: string | null;
  approved_at?: string | null; declined_at?: string | null; return_confirmed_at?: string | null;
}

export function planState(r: Pick<StatusRecord, 'status' | 'in_current_plan'>): PlanState {
  if (r.in_current_plan && (r.status === 'approved' || r.status === 'planned' || r.status === 'unresolved')) return 'current';
  return r.status === 'cancelled' ? 'cancelled' : 'rescheduled';
}

/** The Section Head's approval in the app. Only a plan PV needs it; it lapses when not given by the first day. */
export function approvalState(r: StatusRecord, today: string): ApprovalState {
  if (!isPlanPv(r.absence_type_code)) return 'not_required';
  if (r.declined_at) return 'declined';
  if (r.approved_at) return 'approved';
  return r.start_date <= today ? 'lapsed' : 'awaiting';
}

/** The Oracle application for exactly these dates, from the log only (latest entry that is not cancelled). */
export function oracleState(r: Pick<StatusRecord, 'root_id' | 'start_date' | 'end_date'>, log: OracleLogEntry[]): OracleState {
  const e = log.filter((x) => x.rootId === r.root_id && x.start === r.start_date && x.end === r.end_date && x.status !== 'cancelled')
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!e) return 'not_recorded';
  if (e.source === 'assumed_past') return 'assumed';
  return e.status as Exclude<OracleState, 'assumed' | 'not_recorded'>;
}

export function timeState(r: Pick<StatusRecord, 'start_date' | 'end_date' | 'return_confirmed_at'>, today: string): TimeState {
  if (isOpenEnd(r.end_date) && !r.return_confirmed_at) return r.start_date > today ? 'upcoming' : 'open';
  if (r.end_date < today) return 'taken';
  return r.start_date <= today ? 'on_leave' : 'upcoming';
}

export function leaveState(r: StatusRecord, log: OracleLogEntry[], today: string): LeaveState {
  return { plan: planState(r), approval: approvalState(r, today), oracle: oracleState(r, log), time: timeState(r, today) };
}

export const PLAN_LABEL: Record<PlanState, string> = { current: 'In the plan', rescheduled: 'Rescheduled', cancelled: 'Cancelled' };
export const APPROVAL_LABEL: Record<ApprovalState, string> = {
  approved: 'Approved', awaiting: 'Awaiting approval', declined: 'Not approved', lapsed: 'Not approved by its first day', not_required: 'Recorded'
};
export const ORACLE_STATE_LABEL: Record<OracleState, string> = {
  submitted: 'Oracle submitted', approved: 'Oracle approved', rejected: 'Oracle rejected', assumed: 'Oracle assumed (not recorded)', not_recorded: 'Oracle not recorded'
};
/** Short form for list rows (the detail keeps the full label). */
export const ORACLE_SHORT: Record<OracleState, string> = {
  submitted: 'Oracle submitted', approved: 'Oracle approved', rejected: 'Oracle rejected', assumed: 'Oracle assumed', not_recorded: 'No Oracle record'
};
export const TIME_LABEL: Record<TimeState, string> = { upcoming: 'Upcoming', on_leave: 'On leave', taken: 'Taken', open: 'Return not confirmed' };

/** Records of one person that touch or overlap, as one leave: back-to-back records are one absence, never two. */
export interface JoinedLeave<T> { employeeId: string; start: string; end: string; records: T[] }
export function joinTouching<T extends { employee_id: string; start_date: string; end_date: string }>(records: T[]): JoinedLeave<T>[] {
  const sorted = [...records].sort((a, b) => a.employee_id.localeCompare(b.employee_id) || a.start_date.localeCompare(b.start_date));
  const out: JoinedLeave<T>[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.employeeId === r.employee_id && !isOpenEnd(last.end) && r.start_date <= addDaysIso(last.end, 1)) {
      last.records.push(r);
      if (r.end_date > last.end) last.end = r.end_date;
    } else out.push({ employeeId: r.employee_id, start: r.start_date, end: r.end_date, records: [r] });
  }
  return out;
}

/** A leave request waiting for the Section Head (no leave record yet, or a change to one). */
export interface PendingLeaveRequest {
  id: string; employeeId: string; typeCode: string | null; start: string; end: string | null;
  action: 'new' | 'extend' | 'return' | 'cancel'; targetRecordId: string | null; requestedAt: string; summary: string;
}

/** Where a person works on a date, as the manpower engine places them (personOn): their own crew, and where they
 *  actually are when a VR placement, a temporary cover, day duty or a Controller shift cover moves them. */
export interface CrewPlace { home: string | null; actual: string | null; text: string }
export function crewPlace(p: { role: string | null; crew: string | null }, date: string,
  moves: { start: string; end: string | null; crew: string; kind: 'temporary' | 'placement' }[], coverCrew: string | null = null): CrewPlace {
  const role = (['controller', 'vr_controller', 'morning_controller', 'panel_operator', 'field_operator'] as const).find((r) => r === p.role) ?? null;
  const q = personOn({ id: '', employeeNumber: '', name: '', grade: null, employmentType: 'knpc', takeCharge: null, panelQualified: null, actingController: null,
    role, crew: (p.crew as MpPerson['crew']) ?? null, moves: moves.map((m) => ({ start: m.start, end: m.end, crew: m.crew as MpCrewMove['crew'], kind: m.kind })) }, date);
  const home = role === 'vr_controller' ? null : p.crew;
  if (coverCrew) return { home, actual: coverCrew, text: home ? `${home} · covering ${coverCrew}` : `covering ${coverCrew}` };
  if (role === 'vr_controller') return { home: null, actual: q.crew, text: q.crew ? `placed in ${q.crew}` : 'not placed' };
  if (q.dayDuty) return { home, actual: null, text: `${home ?? ''} · day duty`.replace(/^ · /, '') };
  if (q.movedFrom && q.crew) return { home, actual: q.crew, text: `${home} · with ${q.crew}` };
  return { home, actual: home, text: home ?? 'Day' };
}
