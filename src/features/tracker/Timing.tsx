// Mechanical activity timing: the actual start and finish of each bar-chart activity (two taps, the time can be
// corrected), plan vs actual durations, and the record exported for future shutdowns.
import { useState } from 'react';
import { Download } from 'lucide-react';
import { kwDay, kwTime, timing, timingCsv, timingSummary, type Timing as T, type TrkActivity } from '@/core/tracker';
import { setActivity } from '@/data/tracker';
import { Button, ErrorBox, Field, cx } from '@/ui/components';
import { Tile } from './ui';

const when = (iso: string | null | undefined) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '—');
const local = (iso: string | null | undefined) => (iso ? new Date(Date.parse(iso) + 3 * 36e5).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? `${v}:00+03:00` : null);
const h = (x: number | null) => (x === null ? '—' : `${x > 0 ? '+' : ''}${x} h`);
const STATE = { NOT_STARTED: { cls: 'bg-[#EDEFF2] text-slate-600', label: 'Not started' }, RUNNING: { cls: 'bg-[#D6E6F5] text-[#004080]', label: 'Running' }, FINISHED: { cls: 'bg-[#C6EFCE] text-green-900', label: 'Finished' } } as const;

export function TimingChip({ t }: { t: T }) {
  const late = t.lateStart || t.lateFinish;
  return <span className={cx('inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold', late ? 'bg-[#E06666] text-white' : STATE[t.state].cls)}>{t.lateStart ? 'START LATE' : t.lateFinish ? 'FINISH LATE' : STATE[t.state].label}</span>;
}

/** One activity: Started / Finished stamp now; the times and a note can be corrected. */
export function ActivityRow({ t, canEdit, onDone }: { t: T; canEdit: boolean; onDone: (msg: string) => void }) {
  const a = t.a;
  const [edit, setEdit] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [s, setS] = useState(local(a.actualStart)); const [f, setF] = useState(local(a.actualFinish)); const [note, setNote] = useState(a.actualNote ?? '');
  async function run(patch: Parameters<typeof setActivity>[1], msg: string) { setBusy(true); setErr(null); try { await setActivity(a.id, patch); onDone(msg); } catch (e) { setErr(e); setBusy(false); } }
  return (
    <div className={cx('rounded-xl bg-white p-2.5 ring-1 ring-slate-200', !a.tracked && 'opacity-50')}>
      <div className="flex items-start gap-2"><TimingChip t={t} /><span className="min-w-0 flex-1 text-sm leading-snug text-slate-900">{a.activity}</span><span className="shrink-0 text-[10px] text-slate-400">{a.activityId}</span></div>
      <div className="mt-1 grid grid-cols-2 gap-x-2 text-[11px] text-slate-600">
        <span>Plan {when(a.start)} · {t.plannedH ?? '—'} h</span>
        <span>Actual {a.actualStart ? when(a.actualStart) : '—'}{t.actualH !== null ? ` · ${t.actualH} h` : ''}</span>
        {(t.startDelayH !== null || t.overrunH !== null) && <span className="col-span-2">Start {h(t.startDelayH)}{t.overrunH !== null ? ` · duration ${h(t.overrunH)}` : ''}{a.updatedBy ? ` · ${a.updatedBy}` : ''}</span>}
        {a.actualNote && <span className="col-span-2 italic">{a.actualNote}</span>}
      </div>
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!a.actualStart && <Button className="min-h-9 px-3 text-xs" disabled={busy} onClick={() => run({ actual_start: new Date().toISOString() }, `${a.key}: ${a.activityId} started.`)}>▶ Started</Button>}
          {a.actualStart && !a.actualFinish && <Button className="min-h-9 bg-[#08A048] px-3 text-xs hover:bg-green-700" disabled={busy} onClick={() => run({ actual_finish: new Date().toISOString() }, `${a.key}: ${a.activityId} finished.`)}>✓ Finished</Button>}
          <Button variant="ghost" className="min-h-9 px-2 text-xs" onClick={() => setEdit((x) => !x)}>{edit ? 'Close' : 'Edit times · note'}</Button>
        </div>
      )}
      {edit && (
        <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Started"><input type="datetime-local" className="input" value={s} onChange={(e) => setS(e.target.value)} /></Field>
            <Field label="Finished"><input type="datetime-local" className="input" value={f} onChange={(e) => setF(e.target.value)} /></Field>
          </div>
          <input className="input" placeholder="Note (why late / longer, for next time)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button className="w-full" disabled={busy || (!!s && !!f && f < s)} onClick={() => run({ actual_start: fromLocal(s), actual_finish: fromLocal(f), actual_note: note.trim() || null }, `${a.key}: ${a.activityId} times saved.`)}>Save</Button>
          {!!s && !!f && f < s && <p className="text-xs text-status-red">The finish is before the start.</p>}
        </div>
      )}
      {err != null && <ErrorBox error={err} />}
    </div>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Filter = 'open' | 'running' | 'finished' | 'late' | 'all';
export function TimingTab({ activities, now, canEdit, title, onDone }: { activities: TrkActivity[]; now: number; canEdit: boolean; title: string; onDone: (msg: string) => void }) {
  const [filter, setFilter] = useState<Filter>('open'); const [q, setQ] = useState('');
  const all = activities.filter((a) => a.tracked).map((a) => timing(a, now)).sort((x, y) => (x.a.start ?? '').localeCompare(y.a.start ?? '') || x.a.key.localeCompare(y.a.key));
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
        <section key={k} className="space-y-1.5">
          <h3 className="text-xs font-bold text-[#004080]">{k}</h3>
          {list.filter((t) => t.a.key === k).map((t) => <ActivityRow key={t.a.id} t={t} canEdit={canEdit} onDone={onDone} />)}
        </section>
      ))}
      {!list.length && <p className="py-4 text-center text-sm text-slate-500">Nothing here.</p>}
      {keys.length > 40 && <p className="text-xs text-slate-500">{keys.length - 40} more items: search to narrow.</p>}
      <p className="text-[11px] text-slate-500">"Due now": not finished and planned to start within 2 days. Export keeps plan and actual of every activity (Kuwait time) for the next shutdown's planning.</p>
    </div>
  );
}

/** The item's activities inside the equipment sheet. */
export function EquipActivities({ activities, now, canEdit, onDone }: { activities: TrkActivity[]; now: number; canEdit: boolean; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const ts = activities.filter((a) => a.tracked).map((a) => timing(a, now)).sort((x, y) => (x.a.start ?? '').localeCompare(y.a.start ?? ''));
  if (!ts.length) return null;
  const running = ts.filter((t) => t.state === 'RUNNING').length, done = ts.filter((t) => t.state === 'FINISHED').length;
  return (
    <div>
      <button type="button" onClick={() => setOpen((x) => !x)} className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-600"><span>Mechanical activities · {done}/{ts.length} finished{running ? ` · ${running} running` : ''}</span><span>{open ? '▾' : '▸'}</span></button>
      {open && <div className="mt-1.5 space-y-1.5">{ts.map((t) => <ActivityRow key={t.a.id} t={t} canEdit={canEdit} onDone={onDone} />)}</div>}
    </div>
  );
}

