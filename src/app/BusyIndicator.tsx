// One indicator for the whole app, so a tap never meets silence: while something is being saved a "Saving…" pill
// shows and the screen takes no more taps (no double saves); while data loads a thin bar runs along the top. Both
// wait a moment before showing, so quick answers do not flicker.
import { useEffect, useState } from 'react';
import { onBusy } from '@/data/busy';

const SAVE_AFTER = 150, LOAD_AFTER = 300, UNBLOCK_AFTER = 20000;

export function BusyIndicator() {
  const [c, setC] = useState({ save: 0, load: 0 });
  const [saving, setSaving] = useState(false), [loading, setLoading] = useState(false), [stuck, setStuck] = useState(false);
  useEffect(() => onBusy(setC), []);
  useEffect(() => {
    if (!c.save) { setSaving(false); setStuck(false); return; }
    const a = window.setTimeout(() => setSaving(true), SAVE_AFTER);
    // never hold the screen for long: after 20 s taps go through again (the pill stays)
    const b = window.setTimeout(() => setStuck(true), UNBLOCK_AFTER);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [c.save > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!c.load) { setLoading(false); return; }
    const a = window.setTimeout(() => setLoading(true), LOAD_AFTER);
    return () => window.clearTimeout(a);
  }, [c.load > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  return (<>
    {loading && !saving && <div aria-hidden className="busy-bar pointer-events-none fixed inset-x-0 top-0 z-[200] h-[3px] overflow-hidden"><span /></div>}
    {saving && <div role="status" aria-live="polite" className={stuck ? 'pointer-events-none fixed inset-0 z-[200]' : 'fixed inset-0 z-[200] cursor-wait'}>
      <div className="busy-bar pointer-events-none fixed inset-x-0 top-0 h-[3px] overflow-hidden"><span /></div>
      <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] flex justify-center">
        <span className="flex items-center gap-2 rounded-full bg-slate-900/90 px-4 py-2 text-sm font-semibold text-white shadow-lg">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />Saving…</span>
      </div>
    </div>}
  </>);
}
