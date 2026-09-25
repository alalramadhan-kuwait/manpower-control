import { ORACLE_LABEL, type OracleStatus } from '@/core/oracle';
import { cx } from './components';

/** Oracle HR status colours: amber not submitted (to do), blue submitted (waiting), green approved, red rejected. */
export const ORACLE_PILL: Record<OracleStatus, string> = {
  not_submitted: 'bg-amber-100 text-amber-900', submitted: 'bg-sky-100 text-sky-900', approved: 'bg-green-100 text-green-900', rejected: 'bg-status-red text-white'
};
export const ORACLE_DOT: Record<OracleStatus, string> = {
  not_submitted: 'bg-amber-500', submitted: 'bg-sky-500', approved: 'bg-status-green', rejected: 'bg-status-red'
};

/** Small dot for lists (the label is in the tooltip / screen-reader text). */
export function OracleDot({ status, className }: { status: OracleStatus | null | undefined; className?: string }) {
  if (!status) return null;
  return <span title={`Oracle: ${ORACLE_LABEL[status]}`} aria-label={`Oracle: ${ORACLE_LABEL[status]}`} className={cx('inline-block h-2 w-2 shrink-0 rounded-full', ORACLE_DOT[status], className)} />;
}

export function OraclePill({ status, className }: { status: OracleStatus; className?: string }) {
  return <span className={cx('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', ORACLE_PILL[status], className)}>{ORACLE_LABEL[status]}</span>;
}
