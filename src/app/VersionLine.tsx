import { useState } from 'react';
import { APP_BUILT, APP_VERSION, builtLabel, fetchRemoteVersion, hardUpdate, type RemoteVersion } from './version';

/** The version of this app (commit and build time), with a check against the published one and an Update that always works. */
export function VersionLine({ className }: { className?: string }) {
  const [state, setState] = useState<'idle' | 'checking' | 'same' | 'failed' | RemoteVersion>('idle');
  async function check() {
    setState('checking');
    const r = await fetchRemoteVersion();
    setState(!r ? 'failed' : r.version === APP_VERSION ? 'same' : r);
  }
  return (
    <div className={className}>
      <p>Version <b className="font-semibold text-slate-600">{APP_VERSION}</b>{APP_BUILT ? ` · built ${builtLabel(APP_BUILT)}` : ''}</p>
      {typeof state === 'object' ? (
        <p className="mt-0.5">Newer version <b className="font-semibold text-slate-600">{state.version}</b> is published.{' '}
          <button type="button" onClick={() => void hardUpdate(state.version)} className="font-semibold text-brand-700 underline">Update now</button></p>
      ) : (
        <p className="mt-0.5">
          <button type="button" disabled={state === 'checking'} onClick={check} className="font-semibold text-brand-700 underline disabled:opacity-60">{state === 'checking' ? 'Checking…' : 'Check for an update'}</button>
          {state === 'same' && <span className="ml-1 text-status-green">You have the latest.</span>}
          {state === 'failed' && <span className="ml-1 text-status-red">Could not check (offline?).</span>}
        </p>
      )}
    </div>
  );
}
