// Oracle HR tracking: where each leave stands in Oracle HR (not submitted → submitted → approved, or rejected).
// Separate from the manpower plan: planned leave counts for manpower whatever its Oracle status.

export type OracleStatus = 'not_submitted' | 'submitted' | 'approved' | 'rejected';
export const ORACLE_STATUSES: OracleStatus[] = ['not_submitted', 'submitted', 'approved', 'rejected'];
export const ORACLE_LABEL: Record<OracleStatus, string> = { not_submitted: 'Not submitted', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' };
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
