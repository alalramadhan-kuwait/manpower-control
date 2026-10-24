// Earlier start / finish times (more than 48 h back) sent from the field: the Section Head approves or rejects each one.
import { useState } from 'react';
import { decideTimeRequest, type TrackerData } from '@/data/tracker';
import { kwDay, kwTime } from '@/core/tracker';
import { ErrorBox } from '@/ui/components';

const at = (iso: string) => `${kwDay(iso).replace(/^\w+,\s*/, '')} ${kwTime(iso)}`;

export function TimeRequests({ data, isHead, onDone }: { data: TrackerData; isHead: boolean; onDone: () => void }) {
  const pending = data.timeRequests.filter((r) => r.status === 'pending');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [why, setWhy] = useState<{ id: string; text: string } | null>(null);
  if (!pending.length) return null;
  const act = (id: string) => data.activities.find((a) => a.id === id);
  async function decide(id: string, approve: boolean, note?: string) {
    setBusy(true); setErr(null);
    try { await decideTimeRequest(id, approve, note); setWhy(null); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <section className="mb-3 rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200">
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-amber-900">⏳ Earlier times to approve · {pending.length}</p>
      {pending.map((r) => { const a = act(r.activityRow);
        return <div key={r.id} className="border-t border-amber-200 py-2 first:border-t-0">
          <p className="text-[13px]"><b>{a ? a.key.replace(/^([A-Z]{1,3})-12-/, '$1-') : '—'}</b> · {a?.activity ?? 'step'}</p>
          <p className="text-[12px] text-slate-700">{r.actualStart ? `Start ${at(r.actualStart)}` : ''}{r.actualStart && r.actualFinish ? ' · ' : ''}{r.actualFinish ? `Finish ${at(r.actualFinish)}` : ''}
            {a ? <span className="text-slate-500"> (now: {a.actualStart ? `start ${at(a.actualStart)}` : 'not started'}{a.actualFinish ? `, finish ${at(a.actualFinish)}` : ''})</span> : null}</p>
          <p className="text-[12px] text-slate-600">“{r.reason}” · {r.byName ?? '—'} · sent {at(r.at)}</p>
          {isHead && (why?.id === r.id
            ? <div className="mt-1.5 flex gap-1.5"><input autoFocus className="input min-h-9 flex-1 text-[13px]" placeholder="Reason (optional)" value={why.text} onChange={(e) => setWhy({ id: r.id, text: e.target.value })} />
                <button type="button" disabled={busy} onClick={() => decide(r.id, false, why.text)} className="min-h-9 rounded-lg bg-status-red px-3 text-[12px] font-bold text-white">Reject</button>
                <button type="button" onClick={() => setWhy(null)} className="min-h-9 rounded-lg bg-white px-3 text-[12px] font-bold text-slate-700 ring-1 ring-slate-300">Cancel</button></div>
            : <div className="mt-1.5 flex gap-1.5">
                <button type="button" disabled={busy} onClick={() => decide(r.id, true)} className="min-h-9 rounded-lg bg-status-green px-3 text-[12px] font-bold text-white">✓ Approve</button>
                <button type="button" disabled={busy} onClick={() => setWhy({ id: r.id, text: '' })} className="min-h-9 rounded-lg bg-white px-3 text-[12px] font-bold text-slate-700 ring-1 ring-slate-300">Reject…</button>
              </div>)}
        </div>; })}
      {!isHead && <p className="mt-1 text-[11px] text-amber-900">The Section Head approves these.</p>}
      {err != null && <ErrorBox error={err} />}
    </section>
  );
}
