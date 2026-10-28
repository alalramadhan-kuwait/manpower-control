// The auto-generated loop schematic: built from the records when opened (src/core/tracker/schematic), shown in the
// drawing viewer, corrected by the Section Head, Coordinators and Engineers with recorded edits (trk_loop_fix).
import { dateTime12 } from '@/core/clock';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { buildSchematic, LINK_STYLE, renderSchematic, type LoopFix, type LoopItem, type MarkKind, type Schematic, type SchematicInfo } from '@/core/tracker/schematic';
import type { LuStream, TrkPoint, TrkPointStep } from '@/core/tracker';
import type { TrkDrawing } from '@/core/tracker/drawings';
import { addLoopFix, fetchLoopFixes, fetchLoopItems, withdrawLoopFix } from '@/data/drawings';
import { ErrorBox } from '@/ui/components';
import { DrawingViewer } from './LoopDiagram';

export interface SchematicData { points: TrkPoint[]; steps: TrkPointStep[]; lineup: LuStream[] }
type Loop = TrkPoint;
const when = (ms: number) => dateTime12(ms, true);

// one fetch of the corrections per tracker, shared by the cards; reload after a change
const cache = new Map<string, Promise<{ fixes: LoopFix[]; items: LoopItem[] }>>();
function useFixes(trackerId: string) {
  const [v, setV] = useState<{ fixes: LoopFix[]; items: LoopItem[] } | null>(null); const [n, setN] = useState(0);
  useEffect(() => { let live = true;
    if (!cache.has(trackerId)) cache.set(trackerId, Promise.all([fetchLoopFixes(trackerId), fetchLoopItems(trackerId)]).then(([fixes, items]) => ({ fixes, items })).catch(() => { cache.delete(trackerId); return { fixes: [], items: [] }; }));
    void cache.get(trackerId)!.then((x) => { if (live) setV(x); }); return () => { live = false; }; }, [trackerId, n]);
  return { fixes: v?.fixes ?? null, items: v?.items ?? [], reload: () => { cache.delete(trackerId); setN((x) => x + 1); } };
}
const asDrawing = (loop: Loop, at: number): TrkDrawing => ({ id: `auto-${loop.id}`, trackerId: '', pointId: loop.id, items: loop.items, sheet: 'Auto-generated schematic', rev: 'auto', source: 'Built from the records',
  title: null, path: '', mime: 'image/svg+xml', note: null, status: 'current', uploadedBy: null, uploadedAt: new Date(at).toISOString(), closedAt: null, closedBy: null, closedReason: null });

function Viewer({ loop, data, fixes, items, reload, onClose }: { loop: Loop; data: SchematicData; fixes: LoopFix[]; items: LoopItem[]; reload: () => void; onClose: () => void }) {
  const [at, setAt] = useState(() => Date.now());
  const r = useMemo(() => renderSchematic(buildSchematic(loop, { ...data, fixes, items }), when(at), { compact: COMPACT.has(loop.ref) }), [loop, data, fixes, items, at]);
  return <DrawingViewer d={asDrawing(loop, at)} title={loop.ref} svg={r.svg} details={<Details info={r.info} />} canWithdraw={false} onClose={onClose} onWithdrawn={onClose} onRegenerate={() => { reload(); setAt(Date.now()); }} />;
}

/** loops drawn with the compact layout (trial on FT-681 before it applies to all) */
const COMPACT = new Set(['FT-681', 'S318']);

/** what the compact sheet keeps off the drawing: procedure points, notes, unknowns, sources and revision */
function Details({ info }: { info: SchematicInfo }) {
  return <div className="space-y-2">
    {info.sections.map((sec) => <section key={sec.title}><h4 className="font-bold text-amber-200">{sec.title}</h4>
      <ul className="mt-0.5 space-y-0.5">{sec.lines.map((l, i) => <li key={i}>{l.text}{l.sub && <span className="block text-[11px] text-white/60">{l.sub}</span>}</li>)}</ul></section>)}
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t border-white/20 pt-1.5">{info.meta.map(([k, v]) => <Fragment key={k}><dt className="font-semibold text-white/70">{k}</dt><dd>{v}</dd></Fragment>)}</dl>
  </div>;
}

/** The field card's entry when no verified drawing is attached. */
export function SchematicButton({ trackerId, loop, data }: { trackerId: string; loop: Loop; data: SchematicData }) {
  const { fixes, items, reload } = useFixes(trackerId); const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="min-h-9 rounded-xl px-3 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-300">📐 Schematic (auto)</button>
    {open && <Viewer loop={loop} data={data} fixes={fixes ?? []} items={items} reload={reload} onClose={() => setOpen(false)} />}
  </>;
}

/** In the loop sheet: open the schematic; correct it (authorized). */
export function LoopSchematic({ trackerId, loop, data, canCorrect }: { trackerId: string; loop: Loop; data: SchematicData; canCorrect: boolean }) {
  const { fixes, items, reload } = useFixes(trackerId); const [open, setOpen] = useState(false); const [edit, setEdit] = useState(false);
  const mine = (fixes ?? []).filter((f) => f.pointId === loop.id);
  const s = useMemo(() => buildSchematic(loop, { ...data, fixes: fixes ?? [], items }), [loop, data, fixes, items]);
  const counts = `${s.status} · ${s.counts.verified} verified / ${s.counts.unverified} unverified connections · ${s.marks.filter((m) => m.kind !== 'before').length} points · ${s.unknown.length} unknown · rev auto-${s.revision}`;
  return (
    <div className="space-y-1.5">
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-xl bg-white px-2.5 py-2 text-left ring-1 ring-slate-200 active:bg-slate-50">
        <span aria-hidden>🧩</span>
        <span className="min-w-0 flex-1"><b className="block text-[13px] text-slate-800">View auto-generated process schematic</b><span className="block truncate text-[11px] text-slate-500">Not a verified P&amp;ID · {counts}{mine.some((f) => f.status === 'active') ? ` · ${mine.filter((f) => f.status === 'active').length} corrections` : ''}</span></span>
        <span className="text-slate-400">›</span>
      </button>
      {canCorrect && <button type="button" onClick={() => setEdit((x) => !x)} className="text-[12px] font-bold text-brand-700">{edit ? '▾' : '▸'} Correct the schematic</button>}
      {canCorrect && edit && <Corrections trackerId={trackerId} loop={loop} s={s} fixes={mine} onDone={reload} />}
      {open && <Viewer loop={loop} data={data} fixes={fixes ?? []} items={items} reload={reload} onClose={() => setOpen(false)} />}
    </div>
  );
}

const KINDS: [MarkKind, string][] = [['fill', 'Fill point (soda ash in)'], ['drain', 'Drain point'], ['vent', 'Vent / overflow'], ['isolation', 'Isolation / boundary'], ['blind', 'Boundary blind']];
function Corrections({ trackerId, loop, s, fixes, onDone }: { trackerId: string; loop: Loop; s: Schematic; fixes: LoopFix[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [why, setWhy] = useState<{ target: string; label: string; text: string; withdraw?: string } | null>(null);
  const [add, setAdd] = useState<'link' | 'mark' | 'note' | null>(null);
  const [f, setF] = useState({ a: '', b: '', line: '', sheet: '', kind: 'fill' as MarkKind, text: '' });
  const run = async (x: () => Promise<void>) => { setBusy(true); setErr(null); try { await x(); setWhy(null); setAdd(null); setF({ a: '', b: '', line: '', sheet: '', kind: 'fill', text: '' }); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const inp = 'input min-h-9 w-full text-[13px]';
  const row = (target: string, label: string, sub: string) => (
    <li key={target} className="flex items-start gap-2 border-t border-slate-100 py-1 first:border-t-0">
      <span className="min-w-0 flex-1 text-[12px]"><span className="block text-slate-800">{label}</span><span className="block text-[11px] text-slate-500">{sub}</span></span>
      <button type="button" onClick={() => setWhy({ target, label, text: '' })} className="shrink-0 text-[11px] font-bold text-red-700">Remove…</button>
    </li>);
  return (
    <div className="space-y-2 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
      <p className="text-[12px] text-slate-600">Corrections are recorded with your name and apply each time the schematic is built. Mark a connection or point as checked only with the P&amp;ID sheet you checked it on.</p>
      <ul className="max-h-60 overflow-y-auto rounded-lg bg-white px-2 ring-1 ring-slate-200">
        {s.links.map((l) => row(l.key, `${l.a} → ${l.b}${l.lines.length ? ` · ${l.lines.join(', ')}` : ''}`, LINK_STYLE[l.basis].label))}
        {s.nodes.filter((n) => !s.links.some((l) => l.a === n.key || l.b === n.key)).map((n) => row(`node:${n.key}`, n.tag, 'Item without a recorded connection'))}
        {s.marks.filter((m) => !m.key.startsWith('fix:')).map((m) => row(m.key, m.text, `${KINDS.find(([k]) => k === m.kind)?.[1] ?? 'Procedure step'} · ${m.source}`))}
      </ul>
      {why && !why.withdraw && <div className="space-y-1"><p className="text-[12px] font-semibold text-slate-800">Remove: {why.label}</p>
        <div className="flex gap-1.5"><input autoFocus className={inp} placeholder="Why (wrong item, not on this loop…)" value={why.text} onChange={(e) => setWhy({ ...why, text: e.target.value })} />
          <button type="button" disabled={busy || !why.text.trim()} onClick={() => run(() => addLoopFix(trackerId, loop.id, { op: 'remove', target: why.target, reason: why.text }))} className="min-h-9 rounded-lg bg-red-600 px-3 text-[12px] font-bold text-white disabled:opacity-50">Remove</button>
          <button type="button" onClick={() => setWhy(null)} className="min-h-9 rounded-lg bg-white px-2.5 text-[12px] font-bold text-slate-700 ring-1 ring-slate-300">Cancel</button></div></div>}
      <div className="flex flex-wrap gap-1.5 text-[12px]">
        {([['link', '＋ Connection'], ['mark', '＋ Fill / drain / boundary point'], ['note', '＋ Note']] as const).map(([k, l]) =>
          <button key={k} type="button" onClick={() => setAdd(add === k ? null : k)} className="min-h-8 rounded-lg bg-white px-2.5 font-bold text-brand-700 ring-1 ring-slate-300">{l}</button>)}
      </div>
      {add === 'link' && <div className="space-y-1.5">
        <div className="flex gap-1.5"><input className={inp} placeholder="From (tag)" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} /><input className={inp} placeholder="To (tag)" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} /></div>
        <div className="flex gap-1.5"><input className={inp} placeholder="Line no. (if known)" value={f.line} onChange={(e) => setF({ ...f, line: e.target.value })} /><input className={inp} placeholder="Checked on P&ID sheet (optional)" value={f.sheet} onChange={(e) => setF({ ...f, sheet: e.target.value })} /></div>
        <button type="button" disabled={busy || !f.a.trim() || !f.b.trim()} onClick={() => run(() => addLoopFix(trackerId, loop.id, { op: 'add_link', a: f.a, b: f.b, line: f.line, sheet: f.sheet }))} className="min-h-9 rounded-lg bg-brand-700 px-3 text-[12px] font-bold text-white disabled:opacity-50">Add connection</button>
      </div>}
      {add === 'mark' && <div className="space-y-1.5">
        <select className={inp} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as MarkKind })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className={inp} placeholder="Where (e.g. FV-681 D/S drain)" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
        <input className={inp} placeholder="Checked on P&ID sheet (optional)" value={f.sheet} onChange={(e) => setF({ ...f, sheet: e.target.value })} />
        <button type="button" disabled={busy || !f.text.trim()} onClick={() => run(() => addLoopFix(trackerId, loop.id, { op: 'add_mark', kind: f.kind, text: f.text, sheet: f.sheet }))} className="min-h-9 rounded-lg bg-brand-700 px-3 text-[12px] font-bold text-white disabled:opacity-50">Add point</button>
      </div>}
      {add === 'note' && <div className="flex gap-1.5"><input className={inp} placeholder="Note on the schematic" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
        <button type="button" disabled={busy || !f.text.trim()} onClick={() => run(() => addLoopFix(trackerId, loop.id, { op: 'note', text: f.text }))} className="min-h-9 rounded-lg bg-brand-700 px-3 text-[12px] font-bold text-white disabled:opacity-50">Add</button></div>}
      {fixes.length > 0 && <div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Corrections</p>
        <ul className="text-[12px] text-slate-700">{fixes.map((x) => <li key={x.id} className="flex items-start gap-2 py-0.5">
          <span className="min-w-0 flex-1"><span className={x.status === 'withdrawn' ? 'line-through' : ''}>{x.op === 'remove' ? `Removed ${x.target?.replace(/^(link|node|mark):/, '')}` : x.op === 'add_link' ? `Added ${x.a} → ${x.b}${x.line ? ` (${x.line})` : ''}` : x.op === 'add_mark' ? `Added ${x.kind}: ${x.text}` : `Note: ${x.text}`}</span>
            <span className="block text-[11px] text-slate-500">{x.by}{x.sheet ? ` · checked on ${x.sheet}` : ''}{x.reason ? ` · ${x.reason}` : ''}{x.status === 'withdrawn' ? ' · withdrawn' : ''}</span></span>
          {x.status === 'active' && <button type="button" onClick={() => setWhy({ target: x.id, label: 'this correction', text: '', withdraw: x.id })} className="shrink-0 text-[11px] font-bold text-slate-600">Withdraw…</button>}
        </li>)}</ul></div>}
      {why?.withdraw && <div className="flex gap-1.5"><input autoFocus className={inp} placeholder="Why withdraw" value={why.text} onChange={(e) => setWhy({ ...why, text: e.target.value })} />
        <button type="button" disabled={busy || !why.text.trim()} onClick={() => run(() => withdrawLoopFix(why.withdraw!, why.text))} className="min-h-9 rounded-lg bg-slate-700 px-3 text-[12px] font-bold text-white disabled:opacity-50">Withdraw</button>
        <button type="button" onClick={() => setWhy(null)} className="min-h-9 rounded-lg bg-white px-2.5 text-[12px] font-bold text-slate-700 ring-1 ring-slate-300">Cancel</button></div>}
      {err != null && <ErrorBox error={err} />}
    </div>
  );
}
