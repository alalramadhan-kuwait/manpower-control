import { Plane } from 'lucide-react';
import type { OnLeave } from '@/core/leave';
import { cx } from './components';

/** Today on this device, as YYYY-MM-DD. */
export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "27 Sep": day and three-letter month, the same on every device. */
const short = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/**
 * "On leave" marker for employee screens: pale yellow (plus a plane in the full version) with the leave code and return date
 * (first day available to work). `compact` is the list version; the full type and dates are in the tooltip.
 */
export function OnLeaveChip({ leave, compact, className }: { leave: OnLeave; compact?: boolean; className?: string }) {
  const full = `${leave.typeLabel ?? 'Leave'}: ${short(leave.start)} – ${short(leave.until)} · back to work ${short(leave.returnOn)}`;
  const code = leave.typeShort ? `${leave.typeShort} · ` : '';
  return (
    <span title={full} aria-label={`On leave. ${full}`}
      className={cx('inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full bg-yellow-100 font-semibold text-yellow-900 ring-1 ring-yellow-400',
        compact ? 'px-1 py-px text-[10px]' : 'px-2.5 py-1 text-xs', className)}>
      {compact ? `${code}Return ${short(leave.returnOn)}` : <><Plane className="h-3 w-3" /> On leave · {code}Return {short(leave.returnOn)}</>}
    </span>
  );
}

export { short as shortDate };
