// Shared by the Requests pages: one person's leaves (back-to-back records joined) and what moving one does to the crews.
import { checkControllerLeave, isControllerRole, type LeaveApproval } from '@/core/controllers/leaveRules';
import { evaluateRange, personOn, type MpAbsence, type MpPerson } from '@/core/manpower';
import type { OracleStatus } from '@/core/oracle';
import { addDaysIso } from '@/core/roster';
import type { ManpowerInputs } from '@/data/manpower';

export interface MergedLeave { start: string; end: string; codes: string[]; oracle: OracleStatus | undefined; records: MpAbsence[]; estimated: boolean }
const RANK: OracleStatus[] = ['rejected', 'not_submitted', 'submitted', 'approved'];

/** A person's leaves in the current plan, oldest first; records that touch are one leave. */
export function mergedLeaves(absences: MpAbsence[], personId: string, estimated: Set<string> = new Set()): MergedLeave[] {
  const mine = absences.filter((a) => a.employeeId === personId && (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false).sort((a, b) => a.start.localeCompare(b.start));
  const out: MergedLeave[] = [];
  for (const a of mine) {
    const last = out[out.length - 1];
    const code = a.typeShort ?? a.typeCode ?? '';
    if (last && a.start <= addDaysIso(last.end, 1)) {
      if (a.end > last.end) last.end = a.end;
      last.records.push(a);
      if (a.id && estimated.has(a.id)) last.estimated = true;
      if (code && !last.codes.includes(code)) last.codes.push(code);
      if (a.oracle && (!last.oracle || RANK.indexOf(a.oracle) < RANK.indexOf(last.oracle))) last.oracle = a.oracle;
    } else out.push({ start: a.start, end: a.end, codes: code ? [code] : [], oracle: a.oracle, records: [a], estimated: !!a.id && estimated.has(a.id) });
  }
  return out;
}

export interface LeaveImpact { short: number; dates: string[]; clash: string[] }
/** What moving a leave to `start`–`end` does: duties of the person's crew that fall short (with their dates), and Controllers off together. */
export function leaveImpact(person: MpPerson, records: MpAbsence[], inputs: ManpowerInputs, approvals: LeaveApproval[], start: string, end: string, today: string): LeaveImpact {
  const ids = new Set(records.map((x) => x.id));
  const first = records[0];
  const moved: MpAbsence[] = [...inputs.absences.filter((a) => !ids.has(a.id)), { ...first, id: `${first.id}-new`, start, end }];
  const from = start < today ? today : start;
  const dates: string[] = [];
  for (const d of evaluateRange(from, end, inputs.people, moved, inputs.rules, inputs.assignments)) {
    const q = personOn(person, d.date); const c = q.crew && !q.dayDuty ? d.crews.find((x) => x.crew === q.crew) : undefined;
    if (c?.working && c.confirmedShortage) dates.push(d.date);
  }
  const y = Number(today.slice(0, 4));
  const clash = isControllerRole(person.role)
    ? checkControllerLeave(inputs.people, moved, approvals, [y, y + 1]).overlaps.filter((o) => !o.approval && (o.a.ids.includes(`${first.id}-new`) || o.b.ids.includes(`${first.id}-new`)))
      .map((o) => inputs.people.find((p) => p.id === (o.a.employeeId === person.id ? o.b.employeeId : o.a.employeeId))?.name ?? '')
    : [];
  return { short: dates.length, dates, clash };
}
