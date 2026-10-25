// Engineer links (Section Head): a personal link for an ID to update the shutdown tracker without an app login.
// The link is shown once when made; turning it off stops it at once.
import { useEffect, useState } from 'react';
import { kwDay, kwTime } from '@/core/tracker';
import { fetchAccess, setAccessActive, type TrkAccess } from '@/data/tracker';
import { Button, ErrorBox, cx } from '@/ui/components';

export function EngineerLinks({ trackerId }: { trackerId: string; by?: string }) {
  const [list, setList] = useState<TrkAccess[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const reload = () => fetchAccess(trackerId).then(setList).catch(setErr);
  useEffect(() => { void reload(); }, [trackerId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(f: () => Promise<unknown>) { setBusy(true); setErr(null); try { await f(); await reload(); } catch (e) { setErr(e); } finally { setBusy(false); } }
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-slate-600">Engineer links (login ID, no app login) are no longer used: engineers sign in with their own login. The old links stay off and are kept for the record; what was entered through them keeps its ID in the history.</p>
      {list.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200">
          <span className="min-w-0 flex-1"><b>{a.loginId}</b> <span className={cx('rounded px-1 text-[10px] font-bold', a.active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600')}>{a.active ? 'ON' : 'OFF'}</span>
            <span className="block text-[11px] text-slate-500">Made {kwDay(a.createdAt)} {kwTime(a.createdAt)}{a.lastSeenAt ? ` · last used ${kwDay(a.lastSeenAt)} ${kwTime(a.lastSeenAt)}` : ' · not used yet'}</span></span>
          {a.active && <Button variant="secondary" disabled={busy} onClick={() => run(() => setAccessActive(a.id, false))}>Turn off</Button>}
        </div>))}
      {err != null && <ErrorBox error={err} />}
    </div>
  );
}
