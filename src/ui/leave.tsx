import { Plane } from 'lucide-react';
import type { OnLeave } from '@/core/leave';
import { cx } from './components';

/** Today on this device, as YYYY-MM-DD. */
export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const short = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * "On leave" marker for employee screens: a plane on pale yellow with the last day of leave.
 * `compact` (lists) shows only the plane and the date; the full wording and dates are in the tooltip.
 */
export function OnLeaveChip({ leave, compact, className }: { leave: OnLeave; compact?: boolean; className?: string }) {
  const full = `On leave: ${leave.typeLabel ?? 'Leave'} ${short(leave.start)} – ${short(leave.until)}`;
  return (
    <span title={full} aria-label={full}
      className={cx('inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full bg-yellow-100 font-semibold text-yellow-900 ring-1 ring-yellow-400',
        compact ? 'px-1.5 py-px text-[10px]' : 'px-2.5 py-1 text-xs', className)}>
      <Plane className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} /> {compact ? short(leave.until) : `On leave · until ${short(leave.until)}`}
    </span>
  );
}
