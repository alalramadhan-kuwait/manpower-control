// Loop diagram in the loop sheet: the verified drawing excerpt(s) attached to the loop, a full-screen viewer with
// pinch / drag / double-tap zoom, revisions kept, and attach / withdraw for the Section Head, Coordinators and
// Engineers. The app never draws a connection itself: no verified drawing → "Drawing not available".
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DRAWING_SOURCES, DRAWING_TYPES, REFERENCE_NOTE, drawingLabel, drawingProblem, isPdf, loopDrawings, type TrkDrawing } from '@/core/tracker/drawings';
import { SCHEMATIC_LABEL } from '@/core/tracker/schematic';
import { attachDrawing, drawingFile, fetchDrawings, withdrawDrawing } from '@/data/drawings';
import { ErrorBox, cx } from '@/ui/components';
import { LoopSchematic, SchematicButton, type SchematicData } from './LoopSchematic';
import type { TrkPoint } from '@/core/tracker';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuwait' }) : '');
const meta = (d: TrkDrawing) => `${d.source}${d.uploadedBy ? ` · added by ${d.uploadedBy}` : ''}, ${when(d.uploadedAt)}`;

/** The field card's compact entry: one tap to the loop's current drawing; nothing when none is attached (the loop
 *  sheet says "Drawing not available"). One fetch per tracker for all cards. */
const cache = new Map<string, Promise<TrkDrawing[]>>();
export function LoopDiagramButton({ trackerId, loop, data }: { trackerId: string; loop: TrkPoint; data?: SchematicData }) {
  const [d, setD] = useState<TrkDrawing | null | undefined>(undefined); const [open, setOpen] = useState(false);
  useEffect(() => { let live = true; if (!cache.has(trackerId)) cache.set(trackerId, fetchDrawings(trackerId).catch(() => { cache.delete(trackerId); return []; }));
    void cache.get(trackerId)!.then((all) => { if (live) setD(loopDrawings(all, loop).current[0] ?? null); }); return () => { live = false; }; }, [trackerId, loop.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return d === null ? (data ? <SchematicButton trackerId={trackerId} loop={loop} data={data} /> : <span className="text-[11px] text-slate-500">Drawing not available</span>) : null;
  return <>
    <button type="button" onClick={() => setOpen(true)} className="min-h-9 rounded-xl px-3 text-[12px] font-semibold text-brand-700 ring-1 ring-slate-300">📐 Diagram</button>
    {open && <DrawingViewer d={d} title={loop.ref} canWithdraw={false} onClose={() => setOpen(false)} onWithdrawn={() => setOpen(false)} />}
  </>;
}

export function LoopDiagrams({ trackerId, loop, canAttach, data }: { trackerId: string; loop: TrkPoint; canAttach: boolean; data?: SchematicData }) {
  const [all, setAll] = useState<TrkDrawing[] | null>(null); const [err, setErr] = useState<unknown>(null);
  const [open, setOpen] = useState<TrkDrawing | null>(null); const [add, setAdd] = useState(false); const [old, setOld] = useState(false);
  const load = () => fetchDrawings(trackerId).then(setAll, setErr);
  useEffect(() => { void load(); }, [trackerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = all ? loopDrawings(all, loop) : null;
  const viewBtn = (d: TrkDrawing, label: string) => (
    <button key={d.id} type="button" onClick={() => setOpen(d)} className="flex w-full items-center gap-2 rounded-xl bg-white px-2.5 py-2 text-left ring-1 ring-slate-200 active:bg-slate-50">
      <span aria-hidden>📐</span>
      <span className="min-w-0 flex-1"><b className="block text-[13px] text-brand-700">{label}</b><span className="block truncate text-[11px] text-slate-500">{drawingLabel(d)}{d.title ? ` · ${d.title}` : ''} · {meta(d)}</span></span>
      <span className="text-slate-400">›</span>
    </button>);
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Loop diagram</h3>
      {err != null && <ErrorBox error={err} />}
      {!v && err == null && <p className="text-[12px] text-slate-500">Loading…</p>}
      {v && <div className="space-y-1.5">
        {v.current.map((d) => viewBtn(d, 'View loop diagram'))}
        {!v.current.length && <p className="rounded-xl border border-dashed border-slate-300 px-2.5 py-2 text-[12px] text-slate-600"><b>Drawing not available.</b> No verified drawing is attached for this loop.</p>}
        {data && <LoopSchematic trackerId={trackerId} loop={loop} data={data} canCorrect={canAttach} />}
        {v.equipment.map((d) => viewBtn(d, `Equipment drawing · ${d.items.join(', ')} (not loop-specific)`))}
        {v.history.length > 0 && <>
          <button type="button" onClick={() => setOld((x) => !x)} className="text-[12px] font-semibold text-slate-600">{old ? '▾' : '▸'} Earlier revisions ({v.history.length})</button>
          {old && <ul className="space-y-1 text-[12px] text-slate-600">{v.history.map((d) => <li key={d.id}>
            <button type="button" onClick={() => setOpen(d)} className="font-semibold text-brand-600">{drawingLabel(d)}</button> · {d.status === 'withdrawn' ? `withdrawn${d.closedReason ? `: ${d.closedReason}` : ''}` : `superseded by ${d.closedReason ?? 'a newer revision'}`}{d.closedAt ? ` · ${when(d.closedAt)}` : ''}</li>)}</ul>}
        </>}
        {canAttach && !add && <button type="button" onClick={() => setAdd(true)} className="text-[12px] font-bold text-brand-700">＋ {v.current.length ? 'Attach a new revision or another sheet' : 'Attach drawing'}</button>}
        {canAttach && add && <AttachForm trackerId={trackerId} loop={loop} prev={v.current[0]} onCancel={() => setAdd(false)} onDone={() => { setAdd(false); void load(); }} />}
      </div>}
      {open && <DrawingViewer d={open} title={loop.ref} canWithdraw={canAttach && open.status !== 'withdrawn'} onClose={() => setOpen(null)} onWithdrawn={() => { setOpen(null); void load(); }} />}
    </section>
  );
}

function AttachForm({ trackerId, loop, prev, onCancel, onDone }: { trackerId: string; loop: { id: string; items: string[] }; prev?: TrkDrawing; onCancel: () => void; onDone: () => void }) {
  const [sheet, setSheet] = useState(prev?.sheet ?? ''); const [rev, setRev] = useState(''); const [source, setSource] = useState<string>(prev?.source ?? DRAWING_SOURCES[0]);
  const [items, setItems] = useState(loop.items.join(', ')); const [title, setTitle] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const problem = file ? drawingProblem({ sheet, rev, source, type: file.type, sizeBytes: file.size }) : 'Choose the file.';
  async function save() {
    setBusy(true); setErr(null);
    try { await attachDrawing(trackerId, file!, { pointId: loop.id, items: items.split(/[,;]\s*/).map((t) => t.trim()).filter(Boolean), sheet, rev, source, title }); onDone(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const inp = 'input min-h-10 w-full text-[13px]';
  return (
    <div className="space-y-1.5 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
      <p className="text-[12px] text-slate-600">Only a drawing from an approved source. A new revision of the same sheet replaces the current one; the old one stays under Earlier revisions.</p>
      <input className={inp} placeholder="Sheet no. (e.g. 1-R-12-0-206)" value={sheet} onChange={(e) => setSheet(e.target.value)} />
      <div className="flex gap-1.5"><input className={inp} placeholder="Revision" value={rev} onChange={(e) => setRev(e.target.value)} />
        <select className={inp} value={source} onChange={(e) => setSource(e.target.value)}>{DRAWING_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></div>
      <input className={inp} placeholder="Title (optional, e.g. H-201 pass inlets)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className={inp} placeholder="Equipment (comma separated)" value={items} onChange={(e) => setItems(e.target.value)} />
      <input type="file" accept={DRAWING_TYPES.join(',')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-[12px]" />
      {file && problem && <p className="text-[12px] font-semibold text-status-red">{problem}</p>}
      {err != null && <ErrorBox error={err} />}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg bg-white px-3 text-[13px] font-bold text-slate-700 ring-1 ring-slate-300">Cancel</button>
        <button type="button" disabled={busy || !!problem} onClick={save} className="min-h-10 rounded-lg bg-brand-700 px-3 text-[13px] font-bold text-white disabled:opacity-50">{busy ? 'Attaching…' : 'Attach'}</button>
      </div>
    </div>
  );
}

/** Full screen, outside the sheet (its drag-to-close must not take the pinch). Images: pinch, drag, double-tap, ± and
 *  Fit. PDFs: shown in the browser's own viewer, with Open for a separate tab. */
export function DrawingViewer({ d, title, canWithdraw, onClose, onWithdrawn, svg, onRegenerate }: { d: TrkDrawing; title: string; canWithdraw: boolean; onClose: () => void; onWithdrawn: () => void;
  /** an auto-generated schematic: shown from this SVG instead of a stored file */ svg?: string; onRegenerate?: () => void }) {
  const [url, setUrl] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 }); const [why, setWhy] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>()); const g = useRef<{ d: number; s: number; cx: number; cy: number; x: number; y: number } | null>(null); const tap = useRef<{ x: number; y: number; at: number } | null>(null); const press = useRef<{ x: number; y: number; at: number } | null>(null);
  useEffect(() => { let u: string | null = null;
    if (svg !== undefined) { u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); setUrl(u); }
    else drawingFile(d.path).then((x) => { u = x; setUrl(x); }, setErr);
    return () => { if (u) URL.revokeObjectURL(u); }; }, [d.path, svg]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const clamp = (s: number) => Math.min(8, Math.max(1, s));
  // zoom about a point of the screen (relative to the centre of the view), keeping that point still
  const zoomAt = (s1: number, px: number, py: number, from = t) => { const s = clamp(s1), k = s / from.s; return s === 1 ? { s, x: 0, y: 0 } : { s, x: px - (px - from.x) * k, y: py - (py - from.y) * k }; };
  const rel = (cx: number, cy: number) => { const r = box.current!.getBoundingClientRect(); return { x: cx - r.left - r.width / 2, y: cy - r.top - r.height / 2 }; };
  const down = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    (e.target as Element).setPointerCapture?.(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...pts.current.values()];
    press.current = p.length === 1 ? { x: e.clientX, y: e.clientY, at: Date.now() } : null;   // a second finger: a pinch, not a tap
    const c = rel((p[0].x + (p[1]?.x ?? p[0].x)) / 2, (p[0].y + (p[1]?.y ?? p[0].y)) / 2);
    g.current = { d: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0, s: t.s, cx: c.x, cy: c.y, x: t.x, y: t.y };
  };
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId) || !g.current) return; pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...pts.current.values()], s0 = g.current;
    const c = rel((p[0].x + (p[1]?.x ?? p[0].x)) / 2, (p[0].y + (p[1]?.y ?? p[0].y)) / 2);
    if (p.length > 1 && s0.d) { const z = zoomAt(s0.s * (Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / s0.d), s0.cx, s0.cy, { s: s0.s, x: s0.x, y: s0.y }); setT({ ...z, x: z.x + c.x - s0.cx, y: z.y + c.y - s0.cy }); }
    else if (t.s > 1) setT({ s: t.s, x: s0.x + c.x - s0.cx, y: s0.y + c.y - s0.cy });
  };
  const up = (e: React.PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return;
    const p = [...pts.current.values()], pr = press.current;
    // a double tap (two short taps in the same place) zooms in there, or back to Fit
    if (!p.length && pr && Date.now() - pr.at < 250 && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < 10) {
      const last = tap.current; tap.current = { x: e.clientX, y: e.clientY, at: Date.now() };
      if (last && Date.now() - last.at < 350 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) { const c = rel(e.clientX, e.clientY); setT(t.s > 1.5 ? { s: 1, x: 0, y: 0 } : zoomAt(3, c.x, c.y)); tap.current = null; }
    } else if (!p.length) tap.current = null;
    press.current = null;
    if (p.length) { const c = rel(p[0].x, p[0].y); g.current = { d: 0, s: t.s, cx: c.x, cy: c.y, x: t.x, y: t.y }; } else g.current = null; };
  const wheel = (e: React.WheelEvent) => { const c = rel(e.clientX, e.clientY); setT(zoomAt(t.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), c.x, c.y)); };
  const btn = 'flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-lg font-bold text-white active:bg-white/30';
  async function withdraw() { setBusy(true); try { await withdrawDrawing(d.id, why!); onWithdrawn(); } catch (e) { setErr(e); } finally { setBusy(false); } }
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-neutral-950 text-white" role="dialog" aria-label={`Loop diagram ${title}`}>
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="min-w-0 flex-1"><b className="block truncate text-[14px]">{title} · {svg !== undefined ? 'Auto-generated schematic' : drawingLabel(d)}</b><span className="block truncate text-[11px] text-white/70">{svg !== undefined ? `Built ${when(d.uploadedAt)} from the records` : `${d.title ? `${d.title} · ` : ''}${meta(d)}`}</span></span>
        <button type="button" onClick={onClose} aria-label="Close" className={btn}>✕</button>
      </div>
      {svg !== undefined && <p className="bg-red-700 px-3 py-1 text-[12px] font-bold uppercase">{SCHEMATIC_LABEL}</p>}
      <p className="bg-amber-600 px-3 py-1 text-[12px] font-bold">{REFERENCE_NOTE}</p>
      {d.status !== 'current' && <p className="bg-red-700 px-3 py-1 text-[12px] font-bold">{d.status === 'withdrawn' ? 'WITHDRAWN' : 'SUPERSEDED'} — not the current drawing{d.closedReason ? ` (${d.closedReason})` : ''}</p>}
      <div ref={box} className="relative min-h-0 flex-1 touch-none overflow-hidden" onPointerDown={isPdf(d) ? undefined : down} onPointerMove={isPdf(d) ? undefined : move} onPointerUp={up} onPointerCancel={up} onWheel={isPdf(d) ? undefined : wheel}>
        {err != null && <div className="p-3"><ErrorBox error={err} /></div>}
        {!url && err == null && <p className="p-4 text-sm text-white/70">Loading the drawing…</p>}
        {url && (isPdf(d)
          ? <iframe title={drawingLabel(d)} src={url} className="h-full w-full bg-white" />
          : <img src={url} alt={`${title} ${drawingLabel(d)}`} draggable={false} className="absolute inset-0 h-full w-full select-none object-contain"
              style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, transformOrigin: 'center', transition: g.current ? 'none' : 'transform 120ms' }} />)}
        {url && !isPdf(d) && <div className="absolute bottom-3 right-3 flex flex-col gap-2">
          <button type="button" aria-label="Zoom in" className={btn} onClick={() => setT(zoomAt(t.s * 1.5, 0, 0))}>＋</button>
          <button type="button" aria-label="Zoom out" className={btn} onClick={() => setT(zoomAt(t.s / 1.5, 0, 0))}>－</button>
          <button type="button" aria-label="Fit" className={cx(btn, 'text-[12px]')} onClick={() => setT({ s: 1, x: 0, y: 0 })}>Fit</button>
        </div>}
      </div>
      <div className="space-y-1 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 text-[11px] text-white/80">
        <p>{svg !== undefined ? 'Rebuilt each time it is opened from the loop record, procedure, blind list and P&ID line-up.' : `Linked: ${[title, ...d.items].join(', ')}${d.note ? ` · ${d.note}` : ''}`}</p>
        <div className="flex items-center gap-3">
          {onRegenerate && <button type="button" onClick={onRegenerate} className="font-bold text-sky-300">↻ Rebuild from the latest data</button>}
          {url && isPdf(d) && <a href={url} target="_blank" rel="noreferrer" className="font-bold text-sky-300">Open PDF in a new tab</a>}
          {canWithdraw && why === null && <button type="button" onClick={() => setWhy('')} className="font-semibold text-white/70">Withdraw this drawing…</button>}
        </div>
        {why !== null && <div className="flex gap-1.5"><input autoFocus className="input min-h-10 flex-1 text-[13px] text-slate-900" placeholder="Why (wrong sheet, not approved…)" value={why} onChange={(e) => setWhy(e.target.value)} />
          <button type="button" disabled={busy || !why.trim()} onClick={withdraw} className="min-h-10 rounded-lg bg-red-600 px-3 text-[13px] font-bold disabled:opacity-50">Withdraw</button>
          <button type="button" onClick={() => setWhy(null)} className="min-h-10 rounded-lg bg-white/15 px-3 text-[13px] font-bold">Cancel</button></div>}
      </div>
    </div>, document.body);
}
