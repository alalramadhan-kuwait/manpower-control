import { useCallback, useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { APP_VERSION, fetchRemoteVersion, hardUpdate, type RemoteVersion } from './version';

const RECHECK_ON_RETURN = 5 * 60 * 1000;
const RECHECK_WHILE_OPEN = 15 * 60 * 1000;

/**
 * Says when a newer version of the app has been published and updates on request (so nobody loses what they are typing to an
 * automatic reload). The published version is read from version.json (never cached) and compared with the version this app
 * was built as; the service worker's own "waiting" signal counts too. Update drops the cached copies and loads the app again,
 * which works where the service-worker update alone stays stuck (a phone's Home Screen app).
 */
export function UpdatePrompt() {
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState<RemoteVersion | null>(null);
  const { needRefresh: [needRefresh] } = useRegisterSW({
    onRegisteredSW(_url, reg) { if (reg) window.setInterval(() => { reg.update().catch(() => {}); }, RECHECK_WHILE_OPEN); }
  });
  const check = useCallback(() => { fetchRemoteVersion().then((r) => { if (r) setRemote(r); }); }, []);
  useEffect(() => {
    check();
    let last = Date.now();
    const back = () => { if (document.visibilityState === 'visible' && Date.now() - last >= RECHECK_ON_RETURN) { last = Date.now(); check(); } };
    document.addEventListener('visibilitychange', back);
    const t = window.setInterval(check, RECHECK_WHILE_OPEN);
    return () => { document.removeEventListener('visibilitychange', back); window.clearInterval(t); };
  }, [check]);

  const newer = !!remote && APP_VERSION !== 'dev' && remote.version !== APP_VERSION;
  if ((!newer && !needRefresh) || later) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[100] flex justify-center px-3 sm:bottom-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl bg-slate-900 py-2 pl-4 pr-2 text-sm text-white shadow-lg">
        <span className="min-w-0">A new version is ready.{newer && <span className="block text-[11px] text-slate-400">You have {APP_VERSION} · new {remote!.version}</span>}</span>
        <button type="button" disabled={busy} onClick={() => { setBusy(true); void hardUpdate(remote?.version); }} className="shrink-0 rounded-full bg-amber-400 px-3 py-1.5 text-[13px] font-semibold text-slate-900 disabled:opacity-60">{busy ? 'Updating…' : 'Update'}</button>
        <button type="button" onClick={() => setLater(true)} className="shrink-0 rounded-full px-2 py-1.5 text-[13px] font-medium text-slate-400">Later</button>
      </div>
    </div>
  );
}
