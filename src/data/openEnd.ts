// Leave rows with an open end (an operational absence whose return is not confirmed: end_date NULL in the database).
// Every read of leave_records that filters by date uses openFrom so an open absence is never dropped, and passes the
// rows through withOpenEnd so the app sees OPEN_END (unavailable on every later date) instead of null.
import { OPEN_END } from '@/core/leave';

/** PostgREST filter: the row ends on or after `from`, or has no end yet. */
export const openFrom = (from: string) => `end_date.is.null,end_date.gte.${from}`;

export function withOpenEnd<T extends { end_date?: string | null }>(rows: T[] | null | undefined): (T & { end_date: string; open_end: boolean })[] {
  return (rows ?? []).map((r) => ({ ...r, end_date: r.end_date ?? OPEN_END, open_end: r.end_date == null }));
}
