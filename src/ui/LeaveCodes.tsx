import { cx } from './components';
import { leaveToneShort } from './leaveTypes';

/** The short codes of a leave (PV, UL, SL …), each in its own colour. */
export function LeaveCodes({ codes, className }: { codes: string[]; className?: string }) {
  return (
    <>
      {codes.map((c) => <span key={c} className={cx('mr-1 inline-block rounded px-1 text-[10px] font-semibold leading-4 ring-1', leaveToneShort(c).chip, className)}>{c}</span>)}
    </>
  );
}

/** Marks leave whose dates are an estimate until the final notice. */
export function EstimatedTag({ className }: { className?: string }) {
  return <span className={cx('inline-block rounded border border-dashed border-amber-500 bg-amber-50 px-1 text-[10px] font-semibold leading-4 text-amber-800', className)}>Est. dates</span>;
}
