// Leave approval. The field keeps its old Oracle name, but since 24 Oct it carries the Section Head's approval in the
// app (read through the database's approval_state): 'approved', or 'not_submitted' = a planned PV not approved yet.
// Leave outside the plan (short, unpaid, emergency …) is always 'approved'. A planned PV that is not approved by its
// first day does not take the person off the crew (see lapsedLeave).

export type OracleStatus = 'not_submitted' | 'submitted' | 'approved' | 'rejected';
export const ORACLE_STATUSES: OracleStatus[] = ['not_submitted', 'submitted', 'approved', 'rejected'];
export const ORACLE_LABEL: Record<OracleStatus, string> = { not_submitted: 'Planned', submitted: 'Planned', approved: 'Approved', rejected: 'Rejected' };
/** Today in Kuwait (UTC+3, no daylight saving). */
export const kuwaitToday = (now = Date.now()) => new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
/**
 * Annual leave (PV) that does not count: planned but not approved by the Section Head on or after its first day. It
 * stays on record (and in Requests › Leave) but does not take the person off their crew until it is approved; future
 * planned leave still shows in the plan. Other absence types always count.
 */
/** A PV of the plan (planned or rescheduled): the only leave that waits for the Section Head's approval. */
export const isPlanPv = (typeCode: string | null | undefined) => typeCode === 'annual_leave_planned' || typeCode === 'annual_leave_rescheduled';
export const lapsedLeave = (a: { typeCode?: string | null; oracle?: OracleStatus | null; start: string }, today: string) =>
  isPlanPv(a.typeCode) && (a.oracle === 'rejected' || ((a.oracle === 'not_submitted' || a.oracle === 'submitted') && a.start <= today));
/** Pending approval: planned but not yet approved in Oracle (not submitted or waiting). */
export const isPendingOracle = (s: OracleStatus | null | undefined) => s === 'not_submitted' || s === 'submitted';

export interface OracleLeave { id: string; employeeId: string; start: string; end: string; oracle: OracleStatus }

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
/** Days from today to the first day (0 = today or already started). */
export const daysUntil = (today: string, start: string) => Math.max(0, days(today, start));

/** Upcoming leave (not finished) by Oracle status. */
export function oracleCounts(leaves: OracleLeave[], today: string): Record<OracleStatus, number> {
  const c: Record<OracleStatus, number> = { not_submitted: 0, submitted: 0, approved: 0, rejected: 0 };
  for (const l of leaves) if (l.end >= today) c[l.oracle]++;
  return c;
}

/**
 * Leave that needs chasing: starting within `within` days (or already started) and not approved in Oracle,
 * rejected leave first, then by first day.
 */
export function oracleDue<T extends OracleLeave>(leaves: T[], today: string, within: number): T[] {
  return leaves.filter((l) => l.end >= today && l.oracle !== 'approved' && days(today, l.start) <= within)
    .sort((a, b) => Number(b.oracle === 'rejected') - Number(a.oracle === 'rejected') || a.start.localeCompare(b.start));
}
