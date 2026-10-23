// Events of the shutdown that are not one item's work: the nitrogen supply (trailers) and issues common to the
// reactors. Recorded above the reactors on the equipment page: open until ended, with how long they lasted.
import { useState } from 'react';
import { EVENT_LABEL, hoursText, kwDay, kwTime, type TrkEvent } from '@/core/tracker';
import { addEvent, endEvent } from '@/data/tracker';
import { ErrorBox, cx } from '@/ui/components';
import { RowBtn } from './ui';

const when = (iso: string) => `${kwDay(iso)} ${kwTime(iso)}`;
const CAT_CLS: Record<TrkEvent['category'], string> = { nitrogen: 'bg-sky-100 text-sky-900', reactors: 'bg-amber-100 text-amber-900', other: 'bg-slate-100 text-slate-700' };

export function EventsCard({ events, trackerId, canEdit, now, onDone }: { events: TrkEvent[]; trackerId: string; canEdit: boolean; now: number; onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  const [add, setAdd] = useState(false); const [cat, setCat] = useState<TrkEvent['category']>('nitrogen'); const [text, setText] = useState('');
  const [past, setPast] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const open = events.filter((e) => !e.endedAt), ended = events.filter((e) => e.endedAt);
  async function run(f: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>, after?: () => void) {
    setBusy(true); setErr(null); try { await f(); after?.(); onDone(msg, undo); } catch (e) { setErr(e); } finally { setBusy(false); } }
  const row = (e: TrkEvent) => (
    <div key={e.id} className={cx('flex items-start gap-2 px-2.5 py-1.5', e.endedAt && 'opacity-70')}>
      <span className={cx('mt-0.5 shrink-0 rounded px-1.5 text-[10.5px] font-bold', CAT_CLS[e.category])}>{EVENT_LABEL[e.category]}</span>
      <span className="min-w-0 flex-1 text-[12.5px] text-slate-800">{e.key && <b>{e.key.replace(/^([A-Z]{1,3})-12-/, '$1-')}: </b>}{e.text}
        <span className="block text-[11px] text-slate-500">{when(e.startedAt)}{e.endedAt ? ` → ${when(e.endedAt)} · ${hoursText(Date.parse(e.endedAt) - Date.parse(e.startedAt))}` : ` · ${hoursText(now - Date.parse(e.startedAt))} so far`}{e.by ? ` · ${e.by}` : ''}</span></span>
      {canEdit && !e.endedAt && <RowBtn tone="ghost" disabled={busy} onClick={() => run(() => endEvent(e.id, true), `${EVENT_LABEL[e.category]}: ended.`, () => endEvent(e.id, false))}>End</RowBtn>}
    </div>);
  return (
    <section className="rounded-xl bg-white ring-1 ring-slate-200">
      <div className="flex items-center justify-between px-2.5 pt-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Events · N₂ & reactors{open.length ? ` · ${open.length} open` : ''}</h3>
        {canEdit && !add && <button type="button" onClick={() => setAdd(true)} className="text-xs font-semibold text-[#0850A0]">+ Event</button>}
      </div>
      {add && <div className="space-y-1.5 px-2.5 pt-1.5">
        <div className="flex gap-1">{(Object.keys(EVENT_LABEL) as TrkEvent['category'][]).map((k) => <button key={k} type="button" onClick={() => setCat(k)} className={cx('min-h-8 rounded-full px-2.5 text-xs font-semibold', cat === k ? 'bg-[#0d2a5e] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{EVENT_LABEL[k]}</button>)}</div>
        <input className="input" placeholder={cat === 'nitrogen' ? 'e.g. N₂ trailer empty, waiting next trailer' : cat === 'reactors' ? 'e.g. vacuum truck down, dumping stopped on all reactors' : 'What happened'} value={text} onChange={(x) => setText(x.target.value)} />
        <div className="flex gap-1.5"><RowBtn tone="navy" disabled={busy || !text.trim()} onClick={() => run(() => addEvent(trackerId, cat, text.trim()), `${EVENT_LABEL[cat]}: event recorded.`, undefined, () => { setAdd(false); setText(''); })}>Record</RowBtn><RowBtn tone="ghost" onClick={() => setAdd(false)}>Cancel</RowBtn></div>
      </div>}
      {open.length > 0 ? <div className="divide-y divide-slate-100">{open.map(row)}</div> : !add && <p className="px-2.5 py-1.5 text-xs text-slate-500">No open event.</p>}
      {ended.length > 0 && <button type="button" onClick={() => setPast((x) => !x)} className="px-2.5 pb-1.5 text-[11px] font-semibold text-slate-500">{past ? '▾' : '▸'} Ended ({ended.length})</button>}
      {past && <div className="divide-y divide-slate-100 pb-1">{ended.map(row)}</div>}
      {err != null && <div className="px-2.5 pb-2"><ErrorBox error={err} /></div>}
    </section>
  );
}
