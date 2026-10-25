// The one-tap step of an equipment row: finish the running step, else start the next one (the tracker's step action:
// twins move together, starting ends the hold, the message offers Undo).
import { useEffect, useState } from 'react';
import type { TrkActivity, TrkEquipment } from '@/core/tracker';
import { cx } from '@/ui/components';
import { stepNow } from './actions';

export function StepButton({ a, also = [], finish, more, eq, onDone }: { a: TrkActivity; also?: TrkActivity[]; finish: boolean; more: number; eq: TrkEquipment; onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  // saved: the spinner stays until the refreshed step arrives (no flash back to the old state)
  useEffect(() => { setBusy(false); }, [a.id, a.actualStart, a.actualFinish]);
  const go = async (x: React.MouseEvent) => {
    x.stopPropagation(); if (busy) return; setBusy(true); setErr(null);
    try {
      const r = await stepNow(a, also, finish, [eq]);
      onDone(r.msg, r.undo);
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Not saved'); setBusy(false); }
  };
  return (
    <span className="flex flex-col items-end">
      <button type="button" disabled={busy} onClick={go} title={`${finish ? 'Finish' : 'Start'}: ${a.activity}`} aria-label={`${finish ? 'Finish' : 'Start'} ${a.activity}`}
        className={cx('flex min-h-9 min-w-[4.5rem] items-center justify-center gap-1 rounded-lg px-2.5 text-[12px] font-bold disabled:opacity-50',
          finish ? 'bg-amber-400 text-amber-950 active:bg-amber-500' : 'bg-brand-700 text-white active:bg-brand-500')}>
        {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : finish ? '✓ Finish' : '▶ Start'}
      </button>
      {more > 0 && <span className="text-[10px] font-semibold text-slate-500">+{more} running</span>}
      {err && <span className="max-w-[7rem] text-right text-[10px] text-red-700">{err}</span>}
    </span>
  );
}
