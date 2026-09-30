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
