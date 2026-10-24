// Engineer links (Section Head): a personal link for an ID to update the shutdown tracker without an app login.
// The link is shown once when made; turning it off stops it at once.
import { useEffect, useState } from 'react';
import { kwDay, kwTime } from '@/core/tracker';
import { createAccess, fetchAccess, setAccessActive, type TrkAccess } from '@/data/tracker';
import { Button, ErrorBox, cx } from '@/ui/components';

export function EngineerLinks({ trackerId, by }: { trackerId: string; by: string }) {
  const [list, setList] = useState<TrkAccess[]>([]);
  const [id, setId] = useState(''); const [made, setMade] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [copied, setCopied] = useState(false);
  const reload = () => fetchAccess(trackerId).then(setList).catch(setErr);
  useEffect(() => { void reload(); }, [trackerId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(f: () => Promise<unknown>) { setBusy(true); setErr(null); try { await f(); await reload(); } catch (e) { setErr(e); } finally { setBusy(false); } }
  const msg = made ? `Shutdown progress (U-12 TR-2). Open this link and type your ID ${made.id}:\n${made.url}` : '';
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-slate-600">The engineer opens the link and types the ID: no app login. They can update steps, status, drums, blinds, neutralization, reactor issues and IATs, nothing else. Each change shows their ID.</p>
      <div className="flex gap-2"><input className="input" placeholder="Engineer ID (e.g. Aad323)" value={id} onChange={(e) => setId(e.target.value)} />
        <Button disabled={busy || !id.trim()} onClick={() => run(async () => { const url = await createAccess(trackerId, id.trim(), by); setMade({ id: id.trim(), url }); setId(''); })}>Make link</Button></div>
      {made && <div className="space-y-2 rounded-xl bg-green-50 p-2.5 ring-1 ring-green-200">
        <p className="text-xs font-bold text-green-800">Link for {made.id}: shown only now, send it to them</p>
        <p className="break-all rounded-lg bg-white p-2 font-mono text-[11px]">{made.url}</p>
        <div className="grid grid-cols-2 gap-2">
          <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-whatsapp text-sm font-semibold text-white">WhatsApp</a>
          <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(msg); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ } }}>{copied ? 'Copied' : 'Copy'}</Button>
        </div></div>}
      {list.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200">
          <span className="min-w-0 flex-1"><b>{a.loginId}</b> <span className={cx('rounded px-1 text-[10px] font-bold', a.active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600')}>{a.active ? 'ON' : 'OFF'}</span>
            <span className="block text-[11px] text-slate-500">Made {kwDay(a.createdAt)} {kwTime(a.createdAt)}{a.lastSeenAt ? ` · last used ${kwDay(a.lastSeenAt)} ${kwTime(a.lastSeenAt)}` : ' · not used yet'}</span></span>
          <Button variant="secondary" disabled={busy} onClick={() => run(() => setAccessActive(a.id, !a.active))}>{a.active ? 'Turn off' : 'Turn on'}</Button>
        </div>))}
      {err != null && <ErrorBox error={err} />}
    </div>
  );
}
