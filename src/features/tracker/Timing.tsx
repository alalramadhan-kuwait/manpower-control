// Mechanical activity timing: the actual start and finish of each bar-chart activity (two taps, the time can be
// corrected), plan vs actual durations, and the record exported for future shutdowns.
import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { STAGES, sortActs, blindLink, neutLink, kwDay, kwTime, stepTiming, stepTimingCsv, timing, timingCsv, timingSummary, type StepTiming, type Timing as T, type TrkActivity, type TrkStep } from '@/core/tracker';
import { addActivity, setActivity, setOrder, setStep } from '@/data/tracker';
import { Button, ErrorBox, Field, cx } from '@/ui/components';
import { CRow, MenuBtn, RowBtn, RowList, Tile } from './ui';

const when = (iso: string | null | undefined) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '—');
const local = (iso: string | null | undefined) => (iso ? new Date(Date.parse(iso) + 3 * 36e5).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? `${v}:00+03:00` : null);
const h = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : ''}${x} h`);
const STATE = { NOT_STARTED: { cls: 'bg-[#EDEFF2] text-slate-600', label: 'Not started' }, RUNNING: { cls: 'bg-[#D6E6F5] text-[#004080]', label: 'Running' }, FINISHED: { cls: 'bg-[#C6EFCE] text-green-900', label: 'Finished' } } as const;

export function TimingChip({ t }: { t: T }) {
  const late = t.lateStart || t.lateFinish;
  return <span className={cx('inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold', late ? 'bg-[#E06666] text-white' : STATE[t.state].cls)}>{t.lateStart ? 'START LATE' : t.lateFinish ? 'FINISH LATE' : STATE[t.state].label}</span>;
}

/** One activity as a thin row: Start / Finish stamp now; ⋯ holds the time and note correction, the bar-chart dates
 *  (Section Head), Not required and Undo. */
export function ActivityRow({ t, canEdit, isHead = false, neutCovered = false, neutLabel, onNeut, onDone }: { t: T; canEdit: boolean; isHead?: boolean; neutCovered?: boolean; neutLabel?: string; onNeut?: () => void; onDone: (msg: string) => void }) {
  const a = t.a; const link = blindLink(a); const nlink = neutCovered && neutLink(a);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [s, setS] = useState(local(a.actualStart)); const [f, setF] = useState(local(a.actualFinish)); const [note, setNote] = useState(a.actualNote ?? '');
  const [ps, setPs] = useState(local(a.start)); const [pf, setPf] = useState(local(a.finish));
  async function run(patch: Parameters<typeof setActivity>[1], msg: string, close?: () => void) { setBusy(true); setErr(null); try { await setActivity(a.id, patch); close?.(); onDone(msg); } catch (e) { setErr(e); } finally { setBusy(false); } }
  const late = t.lateStart || t.lateFinish;
  const dot = !a.tracked ? 'grey' : t.state === 'FINISHED' ? 'green' : late ? 'red' : t.state === 'RUNNING' ? 'blue' : 'grey';
  const sub = !a.tracked ? 'Not required'
    : t.state === 'FINISHED' ? `✓ ${when(a.actualStart)} → ${kwTime(a.actualFinish!)}${t.actualH !== null ? ` · ${t.actualH} h` : ''}${t.overrunH ? ` (${h(t.overrunH)})` : ''}`
    : t.state === 'RUNNING' ? `▶ since ${when(a.actualStart)} · ${t.actualH ?? 0} h of ${t.plannedH ?? '—'} h${t.lateFinish ? ' · finish late' : ''}`
    : a.group === 'Operations' ? `Operations${a.durationH ? ` · ${a.durationH} h` : ''}`
    : `Plan ${when(a.start)} · ${t.plannedH ?? '—'} h${t.lateStart ? ' · start late' : ''}`;
  const free = canEdit && a.tracked && !link && !nlink;
  const action = !a.tracked ? (isHead ? <RowBtn tone="ghost" disabled={busy} onClick={() => run({ tracked: true, disabled_reason: null }, `${a.key}: ${a.activityId} required again.`)}>↺ Required</RowBtn> : null)
    : link ? <span className="shrink-0 text-[11px] font-bold text-[#004080]">= Stage {link}</span>
    // done on the Isolation page: names which neutralization, one tap opens it there
    : nlink ? (onNeut ? <button type="button" onClick={onNeut} className="max-w-[45%] shrink-0 truncate rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 ring-1 ring-amber-200">🧪 {neutLabel ?? 'Neutralization'} ›</button>
      : <span className="shrink-0 text-[11px] font-bold text-amber-800">= {neutLabel ?? 'Neutralization'}</span>)
    : !free ? null
    : !a.actualStart ? <RowBtn disabled={busy} onClick={() => run({ actual_start: new Date().toISOString() }, `${a.key}: ${a.activityId} started.`)}>▶ Start</RowBtn>
    : !a.actualFinish ? <RowBtn tone="green" disabled={busy} onClick={() => run({ actual_finish: new Date().toISOString() }, `${a.key}: ${a.activityId} finished.`)}>✓ Finish</RowBtn>
    : <span className="shrink-0 text-[11px] font-bold text-[#08A048]">Done</span>;
  const menu = canEdit && a.tracked ? (close: () => void) => (
    <>
      <div className="flex flex-wrap gap-1.5">
        {free && a.actualFinish && <MenuBtn danger disabled={busy} onClick={() => run({ actual_finish: null }, `${a.key}: ${a.activityId} back to running.`, close)}>↶ Undo finish</MenuBtn>}
        {free && a.actualStart && !a.actualFinish && <MenuBtn danger disabled={busy} onClick={() => run({ actual_start: null }, `${a.key}: ${a.activityId} back to not started.`, close)}>↶ Undo start</MenuBtn>}
        {isHead && free && !a.actualStart && <MenuBtn disabled={busy} onClick={() => run({ tracked: false, disabled_reason: 'not required' }, `${a.key}: ${a.activityId} not required.`, close)}>Not required</MenuBtn>}
        <span className="self-center text-[10px] text-slate-400">{a.activityId}{a.updatedBy ? ` · ${a.updatedBy}` : ''}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Field label="Started"><input type="datetime-local" className="input" value={s} onChange={(e) => setS(e.target.value)} /></Field>
        <Field label="Finished"><input type="datetime-local" className="input" value={f} onChange={(e) => setF(e.target.value)} /></Field>
      </div>
      <input className="input" placeholder="Note (why late / longer, for next time)" value={note} onChange={(e) => setNote(e.target.value)} />
      {isHead && <div className="grid grid-cols-2 gap-1.5">
        <Field label="Bar chart start"><input type="datetime-local" className="input" value={ps} onChange={(e) => setPs(e.target.value)} /></Field>
        <Field label="Bar chart finish"><input type="datetime-local" className="input" value={pf} onChange={(e) => setPf(e.target.value)} /></Field>
      </div>}
      <Button className="w-full" disabled={busy || (!!s && !!f && f < s) || (!!ps && !!pf && pf < ps)} onClick={() => run({ actual_start: fromLocal(s), actual_finish: fromLocal(f), actual_note: note.trim() || null,
        ...(isHead && (ps !== local(a.start) || pf !== local(a.finish)) ? { planned_start: fromLocal(ps), planned_finish: fromLocal(pf), duration_h: ps && pf ? Math.round((Date.parse(pf) - Date.parse(ps)) / 36e5 * 10) / 10 : null } : {}) }, `${a.key}: ${a.activityId} times saved.`, close)}>Save</Button>
      {!!s && !!f && f < s && <p className="text-xs text-status-red">The finish is before the start.</p>}
    </>
  ) : undefined;
  return (
    <>
      <CRow dot={dot} faded={!a.tracked} title={a.activity} sub={<>{sub}{a.actualNote ? <i> · {a.actualNote}</i> : null}</>} action={action}
        menu={menu} />
      {err != null && <ErrorBox error={err} />}
    </>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Filter = 'open' | 'running' | 'finished' | 'late' | 'all';
export function TimingTab({ activities, steps, now, canEdit, isHead, title, neutKeys, onDone }: { activities: TrkActivity[]; steps: TrkStep[]; now: number; canEdit: boolean; isHead: boolean; title: string; neutKeys?: Set<string>; onDone: (msg: string) => void }) {
  const [kind, setKind] = useState<'mech' | 'steps'>('mech');
  const seg = <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/60 p-1">{([['mech', 'Mechanical (bar chart)'], ['steps', 'Guideline steps']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setKind(k)} className={cx('min-h-10 rounded-lg text-xs font-semibold', kind === k ? 'bg-white text-[#004080] shadow-sm' : 'text-slate-600')}>{l}</button>)}</div>;
  if (kind === 'steps') return <div className="space-y-3">{seg}<StepTimingList steps={steps} now={now} canEdit={canEdit} isHead={isHead} title={title} onDone={onDone} /></div>;
  return <div className="space-y-3">{seg}<MechTiming activities={activities} now={now} canEdit={canEdit} isHead={isHead} title={title} neutKeys={neutKeys} onDone={onDone} /></div>;
}

function MechTiming({ activities, now, canEdit, isHead, title, neutKeys, onDone }: { activities: TrkActivity[]; now: number; canEdit: boolean; isHead: boolean; title: string; neutKeys?: Set<string>; onDone: (msg: string) => void }) {
  const [filter, setFilter] = useState<Filter>('open'); const [q, setQ] = useState('');
  const all = activities.filter((a) => a.tracked && !a.detail).map((a) => timing(a, now)).sort((x, y) => (x.a.start ?? '').localeCompare(y.a.start ?? '') || x.a.key.localeCompare(y.a.key));
  const sum = timingSummary(all);
  const pick = (t: T) => (filter === 'all' ? true : filter === 'running' ? t.state === 'RUNNING' : filter === 'finished' ? t.state === 'FINISHED' : filter === 'late' ? t.lateStart || t.lateFinish
    : t.state !== 'FINISHED' && !!t.a.start && Date.parse(t.a.start) <= now + 2 * 864e5);
  const list = all.filter(pick).filter((t) => !q || `${t.a.key} ${t.a.activity} ${t.a.activityId}`.toLowerCase().includes(q.toLowerCase()));
  const keys = [...new Set(list.map((t) => t.a.key))];
  if (!activities.length) return <p className="py-6 text-center text-sm text-slate-500">Import the bar chart first (Admin).</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <Tile value={`${sum.finished}/${sum.total}`} label="finished" tone="green" />
        <Tile value={sum.running} label="running" />
        <Tile value={h(sum.avgStartDelayH)} label="avg start" tone={(sum.avgStartDelayH ?? 0) > 0 ? 'red' : undefined} />
        <Tile value={h(sum.avgOverrunH)} label="avg duration" tone={(sum.avgOverrunH ?? 0) > 0 ? 'red' : undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {([['open', 'Due now'], ['running', 'Running'], ['late', 'Late'], ['finished', 'Finished'], ['all', 'All']] as [Filter, string][]).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={cx('min-h-9 rounded-full px-3 text-xs font-semibold', filter === k ? 'bg-[#0850A0] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{l}</button>))}
        <Button variant="secondary" className="ml-auto min-h-9 px-3 text-xs" onClick={() => download(`${title.replace(/\s+/g, '_')}_mechanical_timing.csv`, timingCsv(all))}><Download className="h-3.5 w-3.5" />Export</Button>
      </div>
      <input className="input" placeholder="Search equipment or activity" value={q} onChange={(e) => setQ(e.target.value)} />
      {keys.slice(0, 40).map((k) => (
        <section key={k} className="space-y-1">
          <h3 className="text-xs font-bold text-[#004080]">{k}</h3>
          <RowList>{sortActs(list.filter((t) => t.a.key === k), (t) => t.a).map((t) => <ActivityRow key={t.a.id} t={t} canEdit={canEdit} isHead={isHead} neutCovered={!!neutKeys?.has(t.a.key)} onDone={onDone} />)}</RowList>
        </section>
      ))}
      {!list.length && <p className="py-4 text-center text-sm text-slate-500">Nothing here.</p>}
      {keys.length > 40 && <p className="text-xs text-slate-500">{keys.length - 40} more items: search to narrow.</p>}
      <p className="text-[11px] text-slate-500">"Due now": not finished and planned to start within 2 days. Export keeps plan and actual of every activity (Kuwait time) for the next shutdown's planning.</p>
    </div>
  );
}

/** The item's work steps (bar chart, and procedure steps added by the Section Head) inside the equipment sheet: open,
 *  the one running and the next one on top. */
export function EquipActivities({ trackerId, itemKey, activities, now, canEdit, isHead, neutCovered = false, neutLabel, onNeut, onDone }: { trackerId: string; itemKey: string; activities: TrkActivity[]; now: number; canEdit: boolean; isHead: boolean; neutCovered?: boolean; neutLabel?: string; onNeut?: () => void; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(true); const [add, setAdd] = useState(false);
  const [showDone, setShowDone] = useState(false); const [showField, setShowField] = useState(false); const [order, setOrderIds] = useState<string[] | null>(null);
  // the Section Head follows the milestones: the field-operator detail steps are hidden (one tap shows them)
  const all = sortActs(activities.filter((a) => a.tracked).map((a) => timing(a, now)), (t) => t.a);
  const ts = all.filter((t) => !t.a.detail), field = all.filter((t) => t.a.detail);
  const running = ts.filter((t) => t.state === 'RUNNING'), fin = ts.filter((t) => t.state === 'FINISHED'), rest = ts.filter((t) => t.state !== 'FINISHED');
  const next = ts.find((t) => t.state === 'NOT_STARTED');
  const off = activities.filter((a) => !a.tracked).map((a) => timing(a, now));
  const row = (t: T) => <ActivityRow key={t.a.id} t={t} canEdit={canEdit} isHead={isHead} neutCovered={neutCovered} neutLabel={neutLabel} onNeut={onNeut} onDone={onDone} />;
  return (
    <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((x) => !x)} className="flex min-w-0 flex-1 items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-600"><span>Work steps · {fin.length}/{ts.length} finished{running.length ? ` · ${running.length} running` : ''}</span><span>{open ? '▾' : '▸'}</span></button>
        {canEdit && open && ts.length > 1 && !order && <button type="button" onClick={() => setOrderIds(all.map((t) => t.a.id))} className="shrink-0 text-xs font-bold text-[#0850A0]">↕ Reorder</button>}
      </div>
      {!ts.length && !off.length && <p className="mt-1 text-xs text-slate-500">None yet: import the bar chart (Admin){isHead ? ' or add the procedure steps here' : ''}.</p>}
      {ts.length > 0 && !order && <p className="mt-1 text-xs text-slate-700">{running.length ? <>Now: <b>{running.map((t) => t.a.activity).join(' · ')}</b></> : null}{running.length && next ? ' · ' : ''}{next ? <>Next: <b>{next.a.activity}</b></> : null}</p>}
      {open && order && <Reorder trackerId={trackerId} itemKey={itemKey} rows={all} ids={order} setIds={setOrderIds} onDone={(m) => { setOrderIds(null); onDone(m); }} />}
      {open && !order && <>
        {fin.length > 0 && <button type="button" onClick={() => setShowDone((x) => !x)} className="mt-1.5 flex w-full justify-between rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-semibold text-[#08A048] ring-1 ring-green-100"><span>{showDone ? '▾' : '▸'} ✓ Done ({fin.length})</span><span className="font-normal text-slate-500">{showDone ? 'hide' : 'show'}</span></button>}
        {showDone && fin.length > 0 && <RowList className="mt-1">{fin.map(row)}</RowList>}
        {rest.length > 0 && <RowList className="mt-1.5">{rest.map(row)}</RowList>}
        {field.length > 0 && <button type="button" onClick={() => setShowField((x) => !x)} className="mt-1.5 text-[11px] font-semibold text-slate-500">{showField ? '▾' : '▸'} Field steps ({field.length}) · for the field operator</button>}
        {showField && <RowList className="mt-1 opacity-80">{field.map(row)}</RowList>}
      </>}
      {open && !order && off.length > 0 && <div className="mt-1.5 space-y-1.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Not required · {off.length}</p>
        <RowList>{off.map((t) => <ActivityRow key={t.a.id} t={t} canEdit={canEdit} isHead={isHead} onDone={onDone} />)}</RowList></div>}
      {isHead && !order && (add ? <AddActivity trackerId={trackerId} itemKey={itemKey} onDone={(m) => { setAdd(false); onDone(m); }} onCancel={() => setAdd(false)} />
        : <Button variant="ghost" className="mt-1 min-h-9 px-2 text-xs" onClick={() => setAdd(true)}>+ Add work step (procedure)</Button>)}
    </div>
  );
}

/** Put the work steps in order: hold a step (or press its ⋮⋮ handle) and drag it to its place, then save. The field
 *  steps keep their place among them, hidden. Saved and logged. */
function Reorder({ trackerId, itemKey, rows, ids, setIds, onDone }: { trackerId: string; itemKey: string; rows: T[]; ids: string[]; setIds: (x: string[] | null) => void; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [drag, setDrag] = useState<string | null>(null);
  const by = new Map(rows.map((t) => [t.a.id, t])); const start = rows.map((t) => t.a.id).filter((x) => !by.get(x)?.a.detail);
  const shown = ids.filter((id) => !by.get(id)?.a.detail);
  const els = useRef(new Map<string, HTMLDivElement>()); const list = useRef<HTMLDivElement>(null);
  const hold = useRef<{ id: string; y: number; timer: number } | null>(null); const dragRef = useRef<string | null>(null); const idsRef = useRef(ids); idsRef.current = ids;
  // while dragging, the page must not scroll under the finger
  useEffect(() => { const el = list.current; if (!el) return; const stop = (e: TouchEvent) => { if (dragRef.current) e.preventDefault(); };
    el.addEventListener('touchmove', stop, { passive: false }); return () => el.removeEventListener('touchmove', stop); }, []);
  const begin = (id: string, target: HTMLDivElement, pointer: number) => { dragRef.current = id; setDrag(id); try { target.setPointerCapture(pointer); } catch { /* not captured: moves still arrive */ } navigator.vibrate?.(15); };
  const down = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    const target = e.currentTarget; const pointer = e.pointerId;
    if ((e.target as HTMLElement).closest('[data-handle]')) { e.preventDefault(); begin(id, target, pointer); return; }
    hold.current = { id, y: e.clientY, timer: window.setTimeout(() => begin(id, target, pointer), 280) };
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) { if (hold.current && Math.abs(e.clientY - hold.current.y) > 8) { clearTimeout(hold.current.timer); hold.current = null; } return; }
    const id = dragRef.current; const cur = idsRef.current.filter((x) => !by.get(x)?.a.detail);
    // the place under the finger: past the middle of a row means after it
    let to = cur.length;
    for (let k = 0; k < cur.length; k++) { const r = els.current.get(cur[k])?.getBoundingClientRect(); if (r && e.clientY < r.top + r.height / 2) { to = k; break; } }
    const from = cur.indexOf(id);
    if (to !== from && to !== from + 1) {
      const next = cur.filter((x) => x !== id); next.splice(to > from ? to - 1 : to, 0, id);
      // put the moved visible order back among the hidden field steps (they keep their slots)
      let n = 0; setIds(idsRef.current.map((x) => (by.get(x)?.a.detail ? x : next[n++])));
    }
    // near the top or bottom of the screen, scroll the list along
    const vh = window.innerHeight; const dy = e.clientY < 90 ? -14 : e.clientY > vh - 90 ? 14 : 0;
    if (dy) { let p = list.current?.parentElement ?? null; while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement; (p ?? document.scrollingElement)?.scrollBy(0, dy); }
  };
  const up = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; } dragRef.current = null; setDrag(null); };
  async function save(order: string[], msg: string) { setBusy(true); setErr(null); try { await setOrder(trackerId, itemKey, order); onDone(msg); } catch (e) { setErr(e); setBusy(false); } }
  return (
    <div className="mt-1.5 space-y-1.5">
      <p className="text-[11px] font-semibold text-slate-500">Hold a step and drag it to its place, then save.</p>
      <div ref={list} className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">{shown.map((id, i) => { const t = by.get(id)!; const moved = start.indexOf(id) - i;
        return <div key={id} ref={(el) => { if (el) els.current.set(id, el); else els.current.delete(id); }} onPointerDown={(e) => down(e, id)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onContextMenu={(e) => e.preventDefault()} style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
          className={cx('flex items-center gap-2 px-2.5 py-2 transition-colors', drag === id ? 'relative z-10 scale-[1.02] bg-[#D6E6F5] shadow-lg' : moved !== 0 ? 'bg-amber-50' : '')}>
          <span data-handle className="-my-2 -ml-2.5 flex w-9 shrink-0 items-center justify-center self-stretch text-lg text-slate-400" style={{ touchAction: 'none' }}>⋮⋮</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-slate-900">{t.a.activity}</span>{moved !== 0 && !drag && <span className="block text-[11px] text-amber-800">moved {moved > 0 ? '↑' : '↓'} {Math.abs(moved)}</span>}</span>
        </div>; })}</div>
      {err != null && <ErrorBox error={err} />}
      <div className="flex gap-1.5">
        <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setIds(null)}>Cancel</Button>
        <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => save([], `${itemKey}: back to the plan order.`)}>Reset to plan</Button>
        <Button className="flex-1" disabled={busy} onClick={() => save(ids, `${itemKey}: order saved.`)}>✓ Save order</Button>
      </div>
    </div>
  );
}

function AddActivity({ trackerId, itemKey, onDone, onCancel }: { trackerId: string; itemKey: string; onDone: (msg: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(''); const [start, setStart] = useState(''); const [hours, setHours] = useState(''); const [stage, setStage] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function save() {
    setBusy(true); setErr(null);
    try { await addActivity(trackerId, { key: itemKey, activity: name.trim(), start: fromLocal(start), hours: hours ? Number(hours) : null, stage: stage === '' ? null : Number(stage) }); onDone(`${itemKey}: work step added.`); }
    catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <div className="mt-2 space-y-1.5 rounded-lg bg-white p-2 ring-1 ring-slate-200">
      <input className="input" placeholder="Work step (e.g. Gas test for basket removal)" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-3 gap-1.5">
        <Field label="Planned start"><input type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Hours"><input inputMode="decimal" className="input" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <Field label="Stage"><select className="input" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">–</option>{STAGES.map((x, i) => <option key={x} value={i}>{i} {x}</option>)}</select></Field>
      </div>
      {err != null && <ErrorBox error={err} />}
      <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button><Button className="flex-1" disabled={busy || !name.trim()} onClick={save}>Add</Button></div>
    </div>
  );
}


/** Step times inside the step sheet: estimate vs taken; the times can be corrected, the estimate by the Section Head. */
export function StepTimes({ t, canEdit, isHead, onDone }: { t: StepTiming; canEdit: boolean; isHead: boolean; onDone: (msg: string) => void }) {
  const s = t.s;
  const [edit, setEdit] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [a, setA] = useState(local(s.startedAt)); const [d, setD] = useState(local(s.doneAt)); const [est, setEst] = useState(s.estHours === null ? '' : String(s.estHours));
  async function save() {
    setBusy(true); setErr(null);
    try { await setStep(s.id, { started_at: fromLocal(a), done_at: fromLocal(d), ...(isHead ? { est_hours: est === '' ? null : Number(est) } : {}) }); onDone(`${s.stepId}: times saved.`); }
    catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <div className="rounded-xl bg-slate-50 p-2.5 text-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>⏱ Est <b>{t.estH ?? '—'}{t.estH !== null ? ' h' : ''}</b></span>
        <span>Took <b>{t.actualH === null ? '—' : `${t.actualH} h`}</b>{t.running ? ' (running)' : ''}</span>
        {t.overrunH !== null && <span className={cx('font-semibold', t.overrunH > 0 ? 'text-[#E02028]' : 'text-[#08A048]')}>{h(t.overrunH)}</span>}
        {canEdit && <button type="button" className="ml-auto text-xs font-semibold text-brand-700 underline" onClick={() => setEdit((x) => !x)}>{edit ? 'Close' : 'Edit times'}</button>}
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500">Started {when(s.startedAt)} · Done {when(s.doneAt)}</div>
      {edit && <div className="mt-2 space-y-1.5">
        <div className="grid grid-cols-2 gap-1.5">
          <Field label="Started"><input type="datetime-local" className="input" value={a} onChange={(e) => setA(e.target.value)} /></Field>
          <Field label="Done"><input type="datetime-local" className="input" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        </div>
        {isHead && <Field label="Estimate (h)"><input inputMode="decimal" className="input" value={est} onChange={(e) => setEst(e.target.value.replace(/[^\d.]/g, ''))} /></Field>}
        <Button className="w-full" disabled={busy || (!!a && !!d && d < a)} onClick={save}>Save</Button>
        {!!a && !!d && d < a && <p className="text-xs text-status-red">Done is before the start.</p>}
      </div>}
      {err != null && <ErrorBox error={err} />}
    </div>
  );
}

function StepTimingList({ steps, now, canEdit, isHead, title, onDone }: { steps: TrkStep[]; now: number; canEdit: boolean; isHead: boolean; title: string; onDone: (msg: string) => void }) {
  const [fo, setFo] = useState('all');
  const all = [...steps].sort((x, y) => x.stepId.localeCompare(y.stepId)).map((s) => stepTiming(s, now));
  const list = all.filter((t) => fo === 'all' || t.s.fo === fo);
  const timed = all.filter((t) => t.overrunH !== null);
  const avg = timed.length ? Math.round(timed.reduce((n, t) => n + t.overrunH!, 0) / timed.length * 10) / 10 : null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Tile value={all.filter((t) => t.s.doneAt).length} label="done with time" tone="green" />
        <Tile value={all.filter((t) => t.running).length} label="running" />
        <Tile value={h(avg)} label="avg vs estimate" tone={(avg ?? 0) > 0 ? 'red' : undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {['all', 'FO1', 'FO2', 'FO3'].map((k) => <button key={k} type="button" onClick={() => setFo(k)} className={cx('min-h-9 rounded-full px-3 text-xs font-semibold', fo === k ? 'bg-[#0850A0] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{k === 'all' ? 'All' : k}</button>)}
        <Button variant="secondary" className="ml-auto min-h-9 px-3 text-xs" onClick={() => download(`${title.replace(/\s+/g, '_')}_step_timing.csv`, stepTimingCsv(all))}><Download className="h-3.5 w-3.5" />Export</Button>
      </div>
      {list.map((t) => (
        <div key={t.s.id} className="space-y-1">
          <div className="text-xs font-semibold text-slate-700">{t.s.stepId} · {t.s.shortName}</div>
          <StepTimes t={t} canEdit={canEdit} isHead={isHead} onDone={onDone} />
        </div>
      ))}
      <p className="text-[11px] text-slate-500">Start and Done stamp the time; correct it here if it was entered late. Steps done before this was added have no time: enter it if known.</p>
    </div>
  );
}
