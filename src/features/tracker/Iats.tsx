// The IATs of the shutdown, from the daily IAT tracking sheet; the status and remark are kept up to date here (logged).
// Status tiles, search, filters, one card per IAT with where its line runs (P&ID lineup) and the checks it needs; a tap
// opens the whole IAT: status, where, finding, recommendation, inspection checks, painting IAT, work order and material.
import { Fragment, useState } from 'react';
import { IAT_LABELS, IAT_STATUSES, iatClosedBy, kwDay, kwTime, iatChecks, iatStatus, lineOnEquipment, lineStreams, loopLines, streamItems, type LuEquip, type LuStream, type TrkIat, type TrkPoint } from '@/core/tracker';
import { BottomSheet, ErrorBox, cx } from '@/ui/components';
import { restoreIat, setIatLabel, setIatStatus } from '@/data/tracker';
import type { IatLabel } from '@/core/tracker';

const CLS: Record<string, string> = { 'In progress': 'bg-blue-100 text-blue-800', 'To start': 'bg-amber-100 text-amber-800', 'New IAT': 'bg-slate-100 text-slate-700', Hold: 'bg-red-100 text-red-800', Completed: 'bg-green-100 text-green-800', Cancelled: 'bg-slate-100 text-slate-500' };
const TILES = ['In progress', 'To start', 'New IAT', 'Completed'] as const;
type Filter = 'open' | 'items' | 'lines' | 'material' | 'all';

export function IatsTab({ iats, tags, lineup = [], lineupEq = [], points = [], canEdit = false, canLabel = false, onDone, onItem }: { iats: TrkIat[]; tags: string[]; lineup?: LuStream[]; lineupEq?: LuEquip[]; points?: TrkPoint[]; canEdit?: boolean; canLabel?: boolean; onDone?: (msg: string, undo?: () => Promise<unknown>) => void; onItem: (tag: string) => void }) {
  const [q, setQ] = useState(''); const [f, setF] = useState<Filter>('open'); const [done, setDone] = useState(false); const [open, setOpen] = useState<TrkIat | null>(null);
  const items = new Set(tags);
  const onItemTag = (i: TrkIat) => items.has(i.tag);
  const isOpen = (i: TrkIat) => i.status === 'open';
  const match = (i: TrkIat) => !q || `${i.iatNo} ${i.line ?? ''} ${i.tag} ${i.jobText ?? ''}`.toLowerCase().includes(q.trim().toLowerCase());
  const pick: Record<Filter, (i: TrkIat) => boolean> = { open: isOpen, items: (i) => isOpen(i) && onItemTag(i), lines: (i) => isOpen(i) && !onItemTag(i), material: (i) => isOpen(i) && !!i.material, all: () => true };
  const order = (a: TrkIat, b: TrkIat) => TILES.indexOf(iatStatus(a) as typeof TILES[number]) - TILES.indexOf(iatStatus(b) as typeof TILES[number]) || a.iatNo.localeCompare(b.iatNo);
  const list = iats.filter(pick[f]).filter(match).sort(order);
  const shown = f === 'all' ? list : list.filter(isOpen);
  const closed = f === 'all' ? [] : iats.filter((i) => !isOpen(i)).filter(match);
  const where = (i: TrkIat) => { const s = lineStreams(i.line, lineup)[0]; if (s) return `${s.from} → ${s.to}`; const e = lineOnEquipment(i.line, lineupEq)[0]; return e ? `On ${e.eq.tag} ${e.what}` : null; };
  const card = (i: TrkIat) => { const w = where(i); const st = iatStatus(i);
    return (
      <button key={i.id} type="button" onClick={() => setOpen(i)} className="w-full rounded-xl bg-white p-2.5 text-left ring-1 ring-slate-200 active:bg-slate-50">
        <span className="flex items-center gap-2"><b className="text-[13px]">{i.iatNo}</b>{i.opsLabel && <span className={cx('whitespace-nowrap rounded px-1.5 py-px text-[10px] font-bold', LABEL_CLS[i.opsLabel].chip)}>{IAT_LABELS.find(([k]) => k === i.opsLabel)?.[1]}</span>}<span className={cx('whitespace-nowrap rounded px-1.5 py-px text-[10px] font-bold', CLS[st] ?? CLS['New IAT'])}>{st}</span>
          {onItemTag(i) ? <span className="ml-auto text-xs font-bold text-brand-500">{i.tag} ›</span> : <span className="ml-auto text-[11px] text-slate-500">line</span>}</span>
        <span className="mt-0.5 block text-[12px] text-slate-700">{i.jobText}</span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-500">📍 {[w, i.line, i.lineClass].filter(Boolean).join(' · ') || '—'}</span>
        <span className="mt-1 flex flex-wrap gap-1">{iatChecks(i).map((c) => <span key={c.key} className={cx('rounded px-1.5 text-[10px] font-bold', c.optional ? 'border border-dashed border-slate-300 text-slate-500' : 'bg-slate-100 text-slate-600')}>{c.label}{c.optional ? ' if req.' : ''}</span>)}
          {i.painting?.ref && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">Painting IAT {i.painting.ref}</span>}
          {i.material && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">Material</span>}
</span>
      </button>); };
  if (!iats.length) return <p className="py-6 text-center text-sm text-slate-500">No IATs yet: they come from the daily IAT tracking sheet.</p>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1.5">{TILES.map((t) => { const n = iats.filter((i) => iatStatus(i) === t).length;
        return <div key={t} className="rounded-xl bg-white py-1.5 text-center ring-1 ring-slate-200"><b className={cx('block text-lg', t === 'In progress' ? 'text-blue-800' : t === 'To start' ? 'text-amber-800' : t === 'Completed' ? 'text-green-800' : 'text-slate-900')}>{n}</b><span className="text-[11px] text-slate-500">{t === 'New IAT' ? 'New' : t}</span></div>; })}</div>
      <input className="input" placeholder="🔎 IAT no., line, tag…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">{([['open', 'Open'], ['items', 'On items'], ['lines', 'On lines'], ['material', 'Material'], ['all', 'All']] as const).map(([k, l]) =>
        <button key={k} type="button" onClick={() => setF(k)} className={cx('min-h-8 shrink-0 rounded-full px-3 text-xs font-semibold', f === k ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{l} <span className="opacity-60">{iats.filter(pick[k]).length}</span></button>)}</div>
      {shown.length ? <div className="space-y-1.5">{shown.map(card)}</div> : <p className="py-3 text-center text-sm text-slate-500">No IAT here.</p>}
      {closed.length > 0 && <button type="button" onClick={() => setDone((x) => !x)} className="text-sm font-semibold text-status-green">{done ? '▾' : '▸'} ✓ Completed ({closed.length})</button>}
      {done && <div className="space-y-1.5 opacity-80">{closed.map(card)}</div>}
      <p className="text-[11px] text-slate-500">Updated from the daily IAT tracking sheet. Tap an IAT for the full details.</p>
      {open && <IatDetail i={iats.find((x) => x.id === open.id) ?? open} canEdit={canEdit} canLabel={canLabel} onDone={onDone} items={items} lineup={lineup} lineupEq={lineupEq} points={points} onItem={(t) => { setOpen(null); onItem(t); }} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function IatDetail({ i, items, lineup, lineupEq, points, canEdit = false, canLabel = false, onDone, onItem, onClose }: { i: TrkIat; items: Set<string>; lineup: LuStream[]; lineupEq: LuEquip[]; points: TrkPoint[]; canEdit?: boolean; canLabel?: boolean; onDone?: (msg: string, undo?: () => Promise<unknown>) => void; onItem: (tag: string) => void; onClose: () => void }) {
  const st = iatStatus(i); const streams = lineStreams(i.line, lineup); const onEq = streams.length ? [] : lineOnEquipment(i.line, lineupEq);
  const ends = [...new Set([...streams.flatMap((s) => streamItems(s, [...items])), ...onEq.map((x) => x.eq.plantTag ?? '').filter((t) => items.has(t)), ...(items.has(i.tag) ? [i.tag] : [])])];
  const loop = points.find((p) => p.kind === 'neut' && i.line && loopLines(p, lineup).lines.includes(i.line));
  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => <><b className="font-semibold text-slate-500">{k}</b><span className="min-w-0">{children}</span></>;
  const Sec = ({ t, children }: { t: string; children: React.ReactNode }) => <section><h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{t}</h3><div className="rounded-xl bg-white p-2.5 text-[12px] text-slate-800 ring-1 ring-slate-200">{children}</div></section>;
  return (
    <BottomSheet open onClose={onClose} title={`IAT ${i.iatNo}`}>
      <div className="space-y-2.5">
        <div><span className={cx('rounded px-1.5 py-px text-[11px] font-bold', CLS[st] ?? CLS['New IAT'])}>{st}</span> <b className="text-sm">{i.jobText}</b></div>
        {canEdit && <IatStatus key={`${i.id}|${i.sheetStatus ?? ''}|${i.remark ?? ''}`} i={i} onDone={onDone} />}
        <div className="flex items-center gap-2"><span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Operations</span><OpsLabel i={i} canEdit={canLabel} onDone={onDone} /></div>
        {oldTicks(i) && <p className="text-[11px] text-slate-500">Earlier Operations ticks (kept for the record): {oldTicks(i)}</p>}
        <Sec t="Where"><div className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1">
          <Row k="Line">{i.line ?? '—'}{i.lineClass ? ` · ${i.lineClass}` : ''}</Row>
          {streams.map((s) => <Row key={s.id} k="From → To">{s.from} → {s.to}{s.fluid ? ` · ${s.fluid}` : ''}</Row>)}
          {onEq.map((x) => <Row key={x.eq.tag} k="On">{x.eq.tag} ({x.what}){x.eq.name ? ` · ${x.eq.name}` : ''}</Row>)}
          {(streams[0]?.sheets[0] || onEq[0]?.eq.sheet) && <Row k="P&ID">{streams[0]?.sheets[0] ?? onEq[0]?.eq.sheet} <span className="text-slate-500">(Train-1 sheet, Train-2 by rule)</span></Row>}
          {ends.length > 0 && <Row k="Items"><span className="flex flex-wrap gap-1">{ends.map((t) => <button key={t} type="button" onClick={() => onItem(t)} className="rounded bg-slate-50 px-1.5 text-xs font-bold text-brand-500 ring-1 ring-slate-200">{t} ›</button>)}</span></Row>}
          <Row k="Loop">{loop ? `🧪 ${loop.ref} · ${loop.name}` : '— (not in a neutralization loop)'}</Row>
          {!streams.length && !onEq.length && <Row k="">Line not found in the P&amp;ID lineup.</Row>}
        </div></Sec>
        {i.finding && <Sec t="Finding"><p className="whitespace-pre-line">{i.finding}</p></Sec>}
        <Sec t="Inspection checks"><div className="grid grid-cols-[1fr_auto] gap-y-1">
          {iatChecks(i).map((c) => <Fragment key={c.key}><span>{c.label}</span><span className={cx('justify-self-end rounded px-1.5 text-[11px] font-bold', c.optional ? 'border border-dashed border-slate-300 text-slate-500' : 'bg-slate-100 text-slate-700')}>{c.optional ? 'IF REQ' : c.mark}</span></Fragment>)}
          <span>Painting IAT</span><span className="justify-self-end text-[11px] font-bold text-slate-600">{i.painting?.ref ? `${i.painting.ref}${i.painting.status ? ` · ${i.painting.status}` : ''}` : /painting/i.test(i.recommendation ?? '') ? 'separate IAT' : '—'}</span>
        </div></Sec>
        {i.recommendation && <Sec t="Recommendation"><p className="whitespace-pre-line text-[12px]">{i.recommendation}</p></Sec>}
        <Sec t="Work"><div className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1">
          <Row k="WO">{i.wo ?? '—'}</Row><Row k="Material">{i.material ?? '—'}</Row><Row k="Action by">{i.actionBy ?? '—'}</Row><Row k="Remark">{i.remark ?? '—'}</Row>
        </div></Sec>
        <p className="text-[11px] text-slate-500">From the daily IAT tracking sheet. The status, remark and Operations label are set here.</p>
      </div>
    </BottomSheet>
  );
}

/** The IAT status (as in the tracking sheet) and its remark: one tap saves, with undo; Completed / Cancelled close it. */
function IatStatus({ i, onDone }: { i: TrkIat; onDone?: (msg: string, undo?: () => Promise<unknown>) => void }) {
  const st = iatStatus(i);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [remark, setRemark] = useState(i.remark ?? '');
  const was = { sheetStatus: i.sheetStatus ?? null, status: i.status, closedAt: i.closedAt, remark: i.remark ?? null };
  const cur = shown ?? st;
  async function save(next: string, rm?: string | null) {
    setBusy(true); setErr(null); if (next !== st) setShown(next);
    try {
      await setIatStatus(i.id, next, iatClosedBy(next), rm);
      onDone?.(`IAT ${i.iatNo}: ${rm !== undefined && next === st ? 'remark saved' : next}.`, () => restoreIat(i.id, was));
    } catch (e) { setErr(e); setShown(null); } finally { setBusy(false); }
  }
  const dirty = remark.trim() !== (i.remark ?? '').trim();
  return (
    <section className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Status</h3>
      <div className="flex flex-wrap gap-1.5">{IAT_STATUSES.map((s) => (
        <button key={s} type="button" disabled={busy || s === cur} onClick={() => save(s)} aria-pressed={s === cur}
          className={cx('min-h-9 rounded-full px-3 text-xs font-bold', s === cur ? cx(CLS[s], 'ring-2 ring-slate-900/20') : 'bg-white text-slate-600 ring-1 ring-slate-200 active:bg-slate-100')}>{s === 'New IAT' ? 'New' : s}</button>))}
      </div>
      <div className="mt-2 flex gap-1.5">
        <input className="input min-w-0 flex-1" placeholder="Remark (e.g. spool dropped, waiting material)" value={remark} onChange={(e) => setRemark(e.target.value)} />
        {dirty && <button type="button" disabled={busy} onClick={() => save(cur, remark.trim() || null)} className="shrink-0 rounded-lg bg-brand-700 px-3 text-xs font-bold text-white">Save</button>}
      </div>
      {i.updatedAt && <p className="mt-1 text-[11px] text-slate-500">Last update {kwDay(i.updatedAt)} {kwTime(i.updatedAt)}{i.updatedBy ? ` · ${i.updatedBy}` : ''}</p>}
      {err != null && <div className="mt-1.5"><ErrorBox error={err} /></div>}
    </section>
  );
}

/** The operations label of an IAT (owner, 24 Oct 2026: the one Operations classification in both views). */
export const LABEL_CLS: Record<IatLabel, { edge: string; chip: string }> = {
  painting: { edge: 'border-l-violet-500', chip: 'bg-violet-100 text-violet-800' }, spool: { edge: 'border-l-orange-500', chip: 'bg-orange-100 text-orange-800' },
  ready: { edge: 'border-l-status-green', chip: 'bg-green-100 text-green-800' }, progress: { edge: 'border-l-brand-500', chip: 'bg-blue-100 text-blue-800' } };
const labelText = (x: IatLabel | null) => (x ? IAT_LABELS.find(([k]) => k === x)![1] : 'none');
/** The earlier Operations ticks (replaced by the label): shown read-only when any was set, never changed. */
export const oldTicks = (i: TrkIat) => [i.opsNone && 'no action', i.spoolOnly && 'spool drop only', i.opsAction && 'Operations action', i.hoRequired && 'handover needed'].filter(Boolean).join(', ');

/** Set the operations label: one select, saved at once, with Undo. Read-only as a chip without the right. */
export function OpsLabel({ i, canEdit, onDone, className }: { i: TrkIat; canEdit: boolean; onDone?: (msg: string, undo?: () => Promise<unknown>) => void; className?: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const lab = i.opsLabel ?? null;
  if (!canEdit) return lab ? <span className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-bold', LABEL_CLS[lab].chip)}>{labelText(lab)}</span> : <span className="text-[12px] text-slate-500">—</span>;
  const set = async (x: IatLabel | null) => { setBusy(true); setErr(null);
    try { await setIatLabel(i.id, x); onDone?.(`IAT ${i.iatNo}: ${x ? labelText(x).replace(/^\S+ /, '') : 'label cleared'}.`, () => setIatLabel(i.id, lab)); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (<>
    <select aria-label={`Operations label of IAT ${i.iatNo}`} disabled={busy} value={lab ?? ''} onChange={(x) => void set((x.target.value || null) as IatLabel | null)}
      className={cx('min-h-9 min-w-0 flex-1 rounded-lg border-0 px-2 text-[12px] font-bold ring-1 ring-slate-200', lab ? LABEL_CLS[lab].chip : 'bg-white text-slate-600', className)}>
      <option value="">Ops: none</option>{IAT_LABELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    {err != null && <ErrorBox error={err} />}
  </>);
}
