// Isolation & neutralization: the critical blinds (segregation points) and the neutralization loops and items, entered
// once here. The database moves the rest: the items (handed over when all their blinds are in and the neutralization
// before handover is done), the guideline step of each row and the soda-ash bar-chart lines.
import { useState } from 'react';
import { NEUT_FLOW, NEUT_LABEL, hoursText, kwDay, kwTime, pointComplete, soakLeft, type PointStatus, type TrkPoint, type TrkStep } from '@/core/tracker';
import { setPoint } from '@/data/tracker';
import { Button, ErrorBox, cx } from '@/ui/components';
import { Tile } from './ui';

const when = (iso: string | null) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '');
const CHIP: Record<PointStatus, string> = {
  open: 'bg-[#EDEFF2] text-slate-600', in: 'bg-[#C6EFCE] text-green-900', out: 'bg-[#D6E6F5] text-[#004080]',
  filling: 'bg-[#FFE699] text-amber-950', soaking: 'bg-[#FFE699] text-amber-950', draining: 'bg-[#FFE699] text-amber-950', done: 'bg-[#C6EFCE] text-green-900',
};
const BLIND_LABEL: Record<string, string> = { open: 'Not blinded', in: 'Blinded', out: 'Deblinded' };
const NEXT: Record<string, [PointStatus, string] | undefined> = {
  open: ['filling', '▶ Start filling'], filling: ['soaking', 'Soaking'], soaking: ['draining', 'Draining'], draining: ['done', '✓ Neutralized'],
};

function PointRow({ p, now, canEdit, onItem, onDone }: { p: TrkPoint; now: number; canEdit: boolean; onItem: (tag: string) => void; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  async function run(patch: Parameters<typeof setPoint>[1], msg: string) { setBusy(true); setErr(null); try { await setPoint(p.id, patch); setNote(null); onDone(msg); } catch (e) { setErr(e); } finally { setBusy(false); } }
  const blind = p.kind === 'blind';
  const left = soakLeft(p, now);
  const back = blind ? (p.status === 'out' ? 'in' : 'open') : NEUT_FLOW[Math.max(0, NEUT_FLOW.indexOf(p.status as typeof NEUT_FLOW[number]) - 1)];
  const next = blind ? undefined : NEXT[p.status];
  return (
    <div className={cx('rounded-xl bg-white p-2.5 ring-1 ring-slate-200', pointComplete(p) && 'bg-green-50/40')}>
      <div className="flex items-start gap-2">
        <span className={cx('inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold', CHIP[p.status])}>{blind ? BLIND_LABEL[p.status] : NEUT_LABEL[p.status]}</span>
        <span className="min-w-0 flex-1 text-sm leading-snug text-slate-900"><b>{p.ref}</b> · {p.name}</span>
      </div>
      {p.detail && p.detail !== p.name && <p className="mt-0.5 text-[11px] text-slate-500">{p.detail}</p>}
      {p.items.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{p.items.map((t) => <button key={t} type="button" onClick={() => onItem(t)} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-[#004080]">{t}</button>)}</div>}
      <p className="mt-1 text-[11px] text-slate-600">
        {blind ? <>{p.inAt && <>In {when(p.inAt)}</>}{p.outAt && <> · out {when(p.outAt)}</>}</>
          : <>{p.fillAt && <>Fill {when(p.fillAt)}</>}{p.soakAt && <> · soak {kwTime(p.soakAt)}</>}{p.drainAt && <> · drain {kwTime(p.drainAt)}</>}{p.doneAt && <> · done {when(p.doneAt)}</>}</>}
        {p.updatedBy && p.status !== 'open' ? <> · {p.updatedBy}</> : null}
      </p>
      {left !== null && <p className={cx('mt-1 rounded-lg px-2 py-1 text-xs font-semibold', left > 0 ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-900')}>{left > 0 ? `Soak ${p.soakH} h · ${hoursText(left)} left` : `Soak ${p.soakH} h reached: drain`}</p>}
      {p.remark && <p className="mt-1 text-xs italic text-slate-600">{p.remark}</p>}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {blind && p.status === 'open' && <Button className="min-h-10 px-4 text-sm" disabled={busy} onClick={() => run({ status: 'in' }, `${p.ref} blinded.`)}>Blinded</Button>}
          {blind && p.status === 'in' && <Button variant="secondary" className="min-h-10 px-4 text-sm" disabled={busy} onClick={() => run({ status: 'out' }, `${p.ref} deblinded.`)}>Deblinded</Button>}
          {next && <Button className={cx('min-h-10 px-4 text-sm', next[0] === 'done' && 'bg-[#08A048] hover:bg-green-700')} disabled={busy} onClick={() => run({ status: next[0] }, `${p.ref}: ${NEUT_LABEL[next[0]].toLowerCase()}.`)}>{next[1]}</Button>}
          {p.status !== 'open' && <Button variant="ghost" className="min-h-9 px-2 text-xs" disabled={busy} onClick={() => run({ status: back as PointStatus }, `${p.ref} back to ${blind ? BLIND_LABEL[back] : NEUT_LABEL[back]}.`.toLowerCase().replace(/^./, (c) => c.toUpperCase()))}>↶ Undo</Button>}
          <Button variant="ghost" className="min-h-9 px-2 text-xs" onClick={() => setNote(note === null ? p.remark ?? '' : null)}>{note === null ? 'Note' : 'Close'}</Button>
        </div>
      )}
      {note !== null && <div className="mt-1.5 flex gap-1.5"><input className="input" placeholder="pH, remark…" value={note} onChange={(e) => setNote(e.target.value)} /><Button variant="secondary" disabled={busy} onClick={() => run({ remark: note.trim() || null }, `${p.ref}: note saved.`)}>Save</Button></div>}
      {err != null && <ErrorBox error={err} />}
    </div>
  );
}

export function IsolationTab({ points, steps, now, canEdit, focus, onFocus, onItem, onDone }: {
  points: TrkPoint[]; steps: TrkStep[]; now: number; canEdit: boolean; focus: string | null; onFocus: (tag: string | null) => void; onItem: (tag: string) => void; onDone: (msg: string) => void;
}) {
  const [kind, setKind] = useState<'blind' | 'neut'>(() => (focus && !points.some((p) => p.kind === 'blind' && p.items.includes(focus)) ? 'neut' : 'blind'));
  const [fo, setFo] = useState('All'); const [showDone, setShowDone] = useState(false);
  const blinds = points.filter((p) => p.kind === 'blind'), neut = points.filter((p) => p.kind === 'neut');
  const gate = neut.filter((p) => p.beforeHo);
  const soaking = neut.filter((p) => p.status === 'soaking').length;
  const list = points.filter((p) => p.kind === kind && (fo === 'All' || p.fo === fo) && (!focus || p.items.includes(focus))).sort((a, b) => a.sort - b.sort);
  const open = list.filter((p) => !pointComplete(p)), closed = list.filter(pointComplete);
  const stepName = (id: string | null) => (id ? `${id} · ${steps.find((s) => s.stepId === id)?.shortName ?? ''}` : kind === 'blind' ? 'Unit (no step)' : 'Items (bar chart)');
  // group by step, in the order of the rows
  const groups = (xs: TrkPoint[]) => { const m = new Map<string, TrkPoint[]>(); for (const p of xs) { const k = kind === 'neut' && !p.stepId ? '' : p.stepId ?? ''; m.set(k, [...(m.get(k) ?? []), p]); } return [...m.entries()]; };
  if (!points.length) return <p className="py-6 text-center text-sm text-slate-500">No blinds or neutralization set up for this shutdown.</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Tile value={`${blinds.filter(pointComplete).length}/${blinds.length}`} label="critical blinds in" tone={blinds.every(pointComplete) ? 'green' : undefined} onClick={() => setKind('blind')} />
        <Tile value={`${gate.filter(pointComplete).length}/${gate.length}`} label="neutralized" tone={gate.every(pointComplete) ? 'green' : undefined} onClick={() => setKind('neut')} />
        <Tile value={soaking} label="soaking now" tone={soaking ? 'amber' : undefined} onClick={() => setKind('neut')} />
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/60 p-1">
        {([['blind', 'Critical blinds'], ['neut', 'Neutralization']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setKind(k)} className={cx('min-h-10 rounded-lg text-xs font-semibold', kind === k ? 'bg-white text-[#004080] shadow-sm' : 'text-slate-600')}>{l}</button>)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {['All', 'FO1', 'FO2', 'FO3'].map((x) => <button key={x} type="button" onClick={() => setFo(x)} className={cx('min-h-9 rounded-full px-3 text-xs font-semibold', fo === x ? 'bg-[#0850A0] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{x}</button>)}
        {focus && <button type="button" onClick={() => onFocus(null)} className="min-h-9 rounded-full bg-amber-100 px-3 text-xs font-semibold text-amber-900">{focus} ✕</button>}
      </div>
      {groups(open).map(([k, xs]) => (
        <section key={k} className="space-y-1.5">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{stepName(k || null)} · {list.filter((p) => (p.stepId ?? '') === k && pointComplete(p)).length}/{list.filter((p) => (p.stepId ?? '') === k).length}</h3>
          {xs.map((p) => <PointRow key={p.id} p={p} now={now} canEdit={canEdit} onItem={onItem} onDone={onDone} />)}
        </section>
      ))}
      {!open.length && <p className="py-3 text-center text-sm text-[#08A048]">All {kind === 'blind' ? 'blinds are in' : 'neutralization is done'}{fo !== 'All' ? ` for ${fo}` : ''}.</p>}
      {closed.length > 0 && <button type="button" onClick={() => setShowDone((x) => !x)} className="text-sm font-semibold text-[#08A048]">{showDone ? '▾' : '▸'} ✓ {kind === 'blind' ? 'Blinded' : 'Neutralized'} ({closed.length})</button>}
      {showDone && <div className="space-y-1.5">{closed.map((p) => <PointRow key={p.id} p={p} now={now} canEdit={canEdit} onItem={onItem} onDone={onDone} />)}</div>}
      <p className="text-[11px] text-slate-500">One tap here updates the rest: an item is handed over when all its blinds are in and its neutralization is done, the guideline step ticks when all its rows are done, and the soda-ash bar-chart lines take the times.</p>
    </div>
  );
}
