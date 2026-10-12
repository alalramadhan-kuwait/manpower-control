import { Plane } from 'lucide-react';
import type { OnLeave } from '@/core/leave';
import { ORACLE_LABEL, type OracleStatus } from '@/core/oracle';
import { cx } from './components';

/** Today on this device, as YYYY-MM-DD. */
export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "27 Sep": day and three-letter month, the same on every device. */
const short = (iso: string | null) => (iso == null || iso >= '9999-01-01' ? 'open' : `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`);

/** The on-leave marker in the Oracle HR colours: green approved, blue submitted, amber not submitted, red (struck) rejected. */
const ORACLE_CHIP: Record<OracleStatus, string> = {
  approved: 'bg-green-100 text-green-900 ring-green-400', submitted: 'bg-sky-100 text-sky-900 ring-sky-400',
  not_submitted: 'bg-amber-100 text-amber-900 ring-amber-400', rejected: 'bg-red-100 text-red-800 ring-red-400 line-through',
};

/**
 * "On leave" marker for employee screens: pale yellow (plus a plane in the full version) with the leave code and return date
 * (first day available to work). `compact` is the list version ("PV · 8 Oct"); the full type, dates and return date are in the tooltip.
 */
export function OnLeaveChip({ leave, compact, className }: { leave: OnLeave; compact?: boolean; className?: string }) {
  const open = leave.until >= '9999-01-01';
  const full = `${leave.typeLabel ?? 'Leave'}: ${short(leave.start)} – ${open ? 'return not confirmed' : `${short(leave.until)} · back to work ${short(leave.returnOn)}`}${leave.oracle ? ` · Oracle: ${ORACLE_LABEL[leave.oracle]}` : ''}`;
  const code = leave.typeShort ? `${leave.typeShort} · ` : '';
  return (
    <span title={full} aria-label={`On leave. ${full}`}
      className={cx('inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full font-semibold ring-1', leave.oracle ? ORACLE_CHIP[leave.oracle] : 'bg-yellow-100 text-yellow-900 ring-yellow-400',
        compact ? 'px-1 py-px text-[10px]' : 'px-2.5 py-1 text-xs', className)}>
      {compact ? `${code}${open ? 'open' : short(leave.returnOn)}` : <><Plane className="h-3 w-3" /> On leave · {code}{open ? 'Return not confirmed' : `Return ${short(leave.returnOn)}`}</>}
    </span>
  );
}

export { short as shortDate };
