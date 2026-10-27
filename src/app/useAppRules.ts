import { useEffect, useState } from 'react';
import { ensureAppRules } from '@/data/rulesClient';

/** True once the organization rules are read (or after a short wait: the rules last seen on this device are already applied). */
export function useAppRules(enabled: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const t = window.setTimeout(() => live && setReady(true), 2500);
    ensureAppRules().finally(() => { if (live) setReady(true); window.clearTimeout(t); });
    return () => { live = false; window.clearTimeout(t); };
  }, [enabled]);
  return ready;
}
