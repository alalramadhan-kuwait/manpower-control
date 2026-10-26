// Leave row colours (owner, 26 Oct 2026): one subdued fill and a thin left bar per row state, with its word in the
// state's colour. The same in the List, the leave sheet and the Week / day lists. Colour is never the only signal.
import type { RowState } from '@/core/leave/status';

export const ROW_STYLE: Record<RowState, { row: string; text: string; key: string }> = {
  done: { row: 'bg-slate-50 border-l-slate-400', text: 'text-slate-600', key: 'Taken' },
  now: { row: 'bg-blue-50/70 border-l-blue-500', text: 'text-blue-700', key: 'On leave now' },
  next: { row: 'bg-green-50/70 border-l-green-600', text: 'text-green-700', key: 'Approved, upcoming' },
  pending: { row: 'bg-amber-50/80 border-l-amber-500', text: 'text-amber-800', key: 'Awaiting approval' },
  cancelled: { row: 'bg-red-50/70 border-l-red-600', text: 'text-red-700', key: 'Cancelled / not approved' },
  rescheduled: { row: 'bg-violet-50/70 border-l-violet-500', text: 'text-violet-700', key: 'Rescheduled' }
};
/** A request waiting for the Section Head: the amber row with a dashed bar. */
export const REQUEST_BAR = 'border-dashed';
export const ROW_ORDER: RowState[] = ['now', 'next', 'pending', 'done', 'cancelled', 'rescheduled'];

/** The row state of a counted leave in the manpower data (Week and day lists): a plan PV not approved is pending,
 *  a declined one not approved; otherwise by its dates. "Approved" = the Section Head's approval in the app. */
export function absenceState(a: { typeCode: string | null; oracle?: string | null; start: string; end: string }, today: string): RowState {
  const pv = a.typeCode === 'annual_leave_planned' || a.typeCode === 'annual_leave_rescheduled';
  if (pv && a.oracle === 'rejected') return 'cancelled';
  if (pv && a.oracle !== 'approved') return 'pending';
  return a.end < today ? 'done' : a.start <= today ? 'now' : 'next';
}
export const SHORT_LABEL: Record<RowState, string> = { done: 'taken', now: 'on leave', next: 'approved', pending: 'not approved', cancelled: 'not approved', rescheduled: 'rescheduled' };
