import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const RECHECK_ON_RETURN = 15 * 60 * 1000;
const RECHECK_WHILE_OPEN = 60 * 60 * 1000;

/**
 * A new build installs in the background and waits. The app says so and reloads only when asked,
 * so nobody loses what they are typing to an automatic reload. Coming back to the app after a
 * quarter of an hour (and every hour while it stays open) is when it checks for a new version.
 */
export function UpdatePrompt() {
  const [later, setLater] = useState(false);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => { reg.update().catch(() => {}); };
      let last = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || Date.now() - last < RECHECK_ON_RETURN) return;
        last = Date.now(); check();
      });
      setInterval(check, RECHECK_WHILE_OPEN);
    }
  });
  if (!needRefresh || later) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[60] flex justify-center px-3 sm:bottom-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-slate-900 py-2 pl-4 pr-2 text-sm text-white shadow-lg">
        <span>A new version is ready.</span>
        <button type="button" onClick={() => updateServiceWorker(true)} className="rounded-full bg-amber-400 px-3 py-1.5 text-[13px] font-semibold text-slate-900">Update</button>
        <button type="button" onClick={() => setLater(true)} className="rounded-full px-2 py-1.5 text-[13px] font-medium text-slate-400">Later</button>
      </div>
    </div>
  );
}
