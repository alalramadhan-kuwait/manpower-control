import { Plane } from 'lucide-react';
import type { OnLeave } from '@/core/leave';
import { cx } from './components';

/** Today on this device, as YYYY-MM-DD. */
export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const short = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * "On leave" marker for employee screens. Deliberately neither a status colour (green/amber/red/grey)
 * nor a crew colour: a plane on white with the last day of leave.
 */
export function OnLeaveChip({ leave, className }: { leave: OnLeave; className?: string }) {
  return (
    <span title={`${leave.typeLabel ?? 'Leave'} ${short(leave.start)} – ${short(leave.until)}`}
      className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-800 ring-1 ring-slate-400', className)}>
      <Plane className="h-3 w-3" /> On leave · until {short(leave.until)}
    </span>
  );
}
