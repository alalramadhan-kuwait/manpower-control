// Live refresh: the database counts every change to the manpower data (manpower_version, bumped by triggers on the
// plan, leave, assignment, shutdown and figure tables). A page that shows that data calls useLiveRefresh: when the
// count moves (a change from another phone, the server, or a script), the page reloads quietly. Checked every 15 s
// while the app is open, and at once when the app comes back to the screen.
import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

async function version(): Promise<number | null> {
  const { data, error } = await supabase.from('manpower_version').select('v').eq('id', 1).maybeSingle();
  if (error || !data) return null;
  return Number((data as { v: number }).v);
}

export function useLiveRefresh(onChange: () => void, enabled = true, everyMs = 15_000) {
  const cb = useRef(onChange); cb.current = onChange;
  useEffect(() => {
    if (!enabled) return;
    let seen: number | null = null; let busy = false; let live = true;
    // a change made on this phone: the page already reloads after it, so the next count is only taken in
    let ownUntil = 0; const own = () => { ownUntil = Date.now() + 20_000; };
    window.addEventListener('notices-changed', own);
    const poll = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const v = await version();
        if (!live || v === null) return;
        if (seen !== null && v !== seen && Date.now() > ownUntil) cb.current();
        seen = v;
      } finally { busy = false; }
    };
    poll();
    const t = window.setInterval(poll, everyMs);
    const wake = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', wake); window.addEventListener('focus', wake);
    return () => { live = false; window.clearInterval(t); document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); window.removeEventListener('notices-changed', own); };
  }, [enabled, everyMs]);
}
