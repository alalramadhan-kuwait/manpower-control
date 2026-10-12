// The server check of a request (run by the request-gate edge function, and shown the same way in the app): what the
// change does to the plan, and whether it may be recorded or approved.
// - A hard stop is never allowed.
// - A change that makes a crew short of its operating minimum on a day it was not short before is not allowed either:
//   neither the Coordinator's request nor the Section Head's own entry can push a crew below the minimum.
// - A factual absence (an operational absence that is already happening: injury, surgery, long sick) is recorded even
//   when it leaves a crew short: the person is not there whatever the paperwork says. The shortage stays visible as a
//   critical alert until it is covered.
// - Returning, cancelling and withdrawing only add people back: nothing to block.
import { DAY_DUTY } from '../manpower';
import { addDaysIso, type Crew } from '../roster';
import type { Finding, Proposal } from '../validation';

/** Days of an open-ended absence that are checked (it stays unavailable after them too; the check looks this far). */
export const OPEN_CHECK_DAYS = 90;

export type GateType = 'pv_reschedule' | 'unscheduled_pv' | 'personal_pc' | 'absence' | 'leave_form' | 'shift_change' | 'vr_placement' | 'controller_cover' | 'task_release';
export interface GateRequest {
  type: GateType;
  employeeId: string;
  /** The request detail as sent to request_header_submit (or read back from the detail tables). */
  detail: Record<string, unknown>;
  /** The leave type's short code / label / entry mode (leave types only). */
  typeShort?: string | null;
  typeLabel?: string | null;
  entryMode?: string | null;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** The change as the validation engine sees it; null when it only gives people back (return, cancel). */
export function gateProposal(r: GateRequest): Proposal | null {
  const d = r.detail;
  const start = str(d.start_date)!;
  switch (r.type) {
    case 'unscheduled_pv': case 'personal_pc': case 'absence': case 'leave_form': {
      const action = str(d.action) ?? 'new';
      if (action === 'return' || action === 'cancel') return null;
      const typeCode = str(d.absence_type_code);
      const base = { kind: 'absence' as const, employeeId: r.employeeId, typeCode, typeShort: r.typeShort ?? typeCode ?? 'Leave', typeLabel: r.typeLabel ?? undefined };
      if (action === 'extend') {
        // only the added days: from the day after the current end (an open absence already covers everything)
        const oldEnd = str(d.old_end);
        if (!oldEnd) return null;
        const from = addDaysIso(oldEnd, 1);
        return { ...base, start: from, end: str(d.end_date) ?? addDaysIso(from, OPEN_CHECK_DAYS) };
      }
      return { ...base, start, end: str(d.end_date) ?? addDaysIso(start, OPEN_CHECK_DAYS) };
    }
    case 'pv_reschedule':
      return { kind: 'reschedule', employeeId: r.employeeId, recordIds: ((d.replaces_record_ids as string[] | undefined) ?? []), start, end: str(d.end_date)!,
        typeCode: str(d.absence_type_code) ?? 'annual_leave_planned', typeShort: r.typeShort ?? 'PV' };
    case 'shift_change': {
      const ret = str(d.return_date);
      const permanent = d.kind === 'permanent';
      return { kind: 'move', employeeId: r.employeeId, start, end: permanent || !ret ? null : addDaysIso(ret, -1),
        crew: d.kind === 'day_duty' || d.to_crew === 'DAY' ? DAY_DUTY : (str(d.to_crew) as Crew), moveKind: permanent ? 'permanent' : 'temporary' };
    }
    case 'vr_placement':
      return { kind: 'move', employeeId: r.employeeId, start, end: null, crew: str(d.crew_code) as Crew, moveKind: 'placement' };
    case 'controller_cover':
      return { kind: 'cover', employeeId: r.employeeId, crew: str(d.crew_code) as Crew, start, end: str(d.end_date) ?? start, coverKind: d.cover_kind === 'morning_rotation' ? 'morning_rotation' : 'shift_cover' };
    case 'task_release':
      return { kind: 'release', employeeId: r.employeeId, start, end: str(d.end_date) ?? start };
  }
}

/** An operational absence that is already a fact (recorded even when a crew falls short; the shortage stays an alert). */
export const isFactual = (r: GateRequest) => r.entryMode === 'tracked' && ['new', 'extend'].includes(str(r.detail.action) ?? 'new');

export interface GateVerdict { allowed: boolean; reason: string | null; blocking: Finding[] }

export function gateVerdict(findings: Finding[], factual: boolean): GateVerdict {
  const hard = findings.filter((f) => f.severity === 'hard_stop');
  if (hard.length) return { allowed: false, reason: `Hard stop: ${hard.map((f) => f.message).join(' ')}`, blocking: hard };
  const short = findings.filter((f) => f.rule === 'crew_minimum');
  if (short.length && !factual) return { allowed: false, reason: `Below the operating minimum: ${short.map((f) => f.message).join(' ')} Cover the crew first, then try again.`, blocking: short };
  return { allowed: true, reason: null, blocking: [] };
}

/** The dates the server check is bound to (the same rule as the database: end_date, or the day before return_date). */
export function gateDates(detail: Record<string, unknown>): { start: string; end: string | null } {
  const ret = str(detail.return_date);
  return { start: str(detail.start_date)!, end: str(detail.end_date) ?? (ret ? addDaysIso(ret, -1) : null) };
}
