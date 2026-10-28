// Black oil cut-in readiness (owner, 28 Oct 2026): only R-105 is heated and the heat reaches R-101..R-104 in turn.
// From the panel's temperatures along the train the app fits the delay of each step in the wave and estimates when
// every reactor reaches its cut-in temperature; the last one sets the cut-in. An estimate: it never changes a step.
import { useCallback, useEffect, useState } from 'react';
import { clock12, kwWeekDay, round30 } from '@/core/clock';
import { WAVE_POINTS, WAVE_REACTORS, cutinEstimate, type CutinSpec, type PointKey, type ReactorKey } from '@/core/shutdown/wave';
import { addWave, fetchWave, removeWave, type StartupStep, type WaveRow } from '@/data/sdPage';
import { Button, ErrorBox, Field, cx } from '@/ui/components';

const H = 3_600_000;
const local = (t: number) => new Date(t + 3 * H).toISOString().slice(0, 16);
const fromLocal = (v: string) => Date.parse(`${v}:00+03:00`);
const when = (t: number) => `${clock12(round30(t))} ${kwWeekDay(round30(t)).split(' ')[0]}`;
const hrs = (h: number) => `${Math.round(Math.abs(h) * 2) / 2} h`;
const SHORT: Record<PointKey, string> = { r105_in: '105 in', r105_out: '105 out', r101_in: '101 in', r102_in: '102 in', r103_in: '103 in', r104_in: '104 in', r104_out: '104 out' };

export function WaveCard({ step, canEdit, now }: { step: StartupStep; canEdit: boolean; now: number }) {
  const spec = step.cutin as CutinSpec;
  const [rows, setRows] = useState<WaveRow[] | null>(null); const [err, setErr] = useState<unknown>(null);
  const [adding, setAdding] = useState(false); const [list, setList] = useState(false);
  const load = useCallback(() => fetchWave([step.id]).then(setRows).catch(setErr), [step.id]);
  useEffect(() => { void load(); }, [load]);
  const e = rows ? cutinEstimate(rows.map((r) => ({ at: Date.parse(r.at), pts: r.pts, beds: r.beds })), spec) : null;
  const lim = e?.limiting ? WAVE_REACTORS.find((r) => r.key === e.limiting)!.name : null;
  return (
    <div className="space-y-2 rounded-xl ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between gap-2 px-2.5 pt-2"><b className="text-[12px] uppercase tracking-wide text-slate-500">Cut-in readiness</b>
        <span className="text-right text-[10.5px] text-slate-400">{spec.ref}</span></div>
      {err != null && <div className="mx-2.5"><ErrorBox error={err} /></div>}
      {rows && !e && <p className="px-2.5 text-[12px] text-slate-600">Needs two panel readings at least an hour apart, with the R-105 inlet, to estimate the wave.</p>}
      {e && <>
        <div className={cx('mx-2.5 rounded-xl px-2.5 py-1.5 ring-1', e.ready !== null && e.reactors.every((r) => r.done) ? 'bg-green-50 ring-green-200' : 'bg-amber-50 ring-amber-200')}>
          <span className="block text-[10px] font-bold uppercase text-slate-500">{e.reactors.every((r) => r.done) ? 'All reactors at temperature' : 'Expected ready for cut-in'}</span>
          <b className="block text-[22px] leading-tight tabular-nums">{e.ready !== null ? when(e.ready) : 'Not within 2 days at this rate'}</b>
          <span className="text-[11px] text-slate-600">{lim ? `${lim} sets it` : 'Ready now'}{e.ready !== null && e.ready > now ? ` · in ${hrs((e.ready - now) / H)}` : ''} · R-105 inlet up to {spec.inletMax} °F</span>
        </div>
        <ul className="mx-2.5 divide-y divide-slate-100 text-[12px] tabular-nums">
          <li className="flex gap-2 pb-0.5 text-[10.5px] text-slate-500"><span className="w-14">Reactor</span><span className="w-12 text-right">Needs</span><span className="flex-1 text-right">Now</span><span className="w-24 text-right">Reaches it</span></li>
          {e.reactors.map((r) => (
            <li key={r.key} className={cx('flex items-center gap-2 py-1', r.key === e.limiting && 'font-bold')}>
              <span className="w-14">{r.name}</span><span className="w-12 text-right">{r.target} °F</span>
              <span className="flex-1 text-right text-slate-600">{r.now !== null ? `${Math.round(r.now)} °F${r.bed ? ' bed' : ''}` : '—'}</span>
              <span className={cx('w-24 text-right', r.done ? 'text-status-green' : r.eta === null ? 'text-status-red' : '')}>{r.done ? '✓ there' : r.eta !== null ? when(r.eta) : 'not read'}</span></li>))}
        </ul>
        <p className="mx-2.5 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
          <b>Check at {clock12(e.check.at)}:</b> {(['r104_in', 'r104_out', 'r103_in'] as PointKey[]).filter((k) => e.check.expect[k] != null).map((k) => `${WAVE_POINTS.find((p) => p.key === k)!.label} ~${e.check.expect[k]} °F`).join(' · ')}.
          {' '}Delays in the wave {e.fit.tau.map((t) => t.toFixed(1)).join(' · ')} h, from {clock12(e.fit.from)} and {clock12(e.fit.to)}.</p>
      </>}
      {canEdit && (adding ? <WaveForm step={step} last={rows?.[rows.length - 1] ?? null} now={now} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); void load(); }} />
        : <div className="mx-2.5"><Button variant="secondary" className="min-h-9 w-full" onClick={() => setAdding(true)}>+ Panel temperatures</Button></div>)}
      {rows && rows.length > 0 && <>
        <button type="button" onClick={() => setList(!list)} className="block w-full px-2.5 pb-2 text-left text-[12px] font-semibold text-brand-700">{list ? 'Hide' : 'Show'} the readings ({rows.length})</button>
        {list && <ul className="mx-2.5 divide-y divide-slate-100 pb-2 text-[11px] tabular-nums">{[...rows].reverse().map((r) => (
          <li key={r.id} className="py-1"><div className="flex justify-between gap-2"><b>{clock12(Date.parse(r.at))} {kwWeekDay(Date.parse(r.at))}</b>
            {canEdit && <button type="button" className="text-slate-400" onClick={async () => { await removeWave(r.id); void load(); }}>✕</button>}</div>
            <span className="block text-slate-600">{WAVE_POINTS.filter((p) => r.pts[p.key] != null).map((p) => `${SHORT[p.key]} ${r.pts[p.key]}`).join(' · ')}</span>
            {Object.keys(r.beds).length > 0 && <span className="block text-slate-500">Coldest bed: {WAVE_REACTORS.filter((x) => r.beds[x.key] != null).map((x) => `${x.name.replace('R-', '')} ${r.beds[x.key]}`).join(' · ')}</span>}
            {r.note && <span className="block text-slate-500">{r.note}</span>}</li>))}</ul>}
      </>}
    </div>
  );
}

function WaveForm({ step, last, now, onCancel, onDone }: { step: StartupStep; last: WaveRow | null; now: number; onCancel: () => void; onDone: () => void }) {
  const [at, setAt] = useState(local(now)); const [pts, setPts] = useState<Partial<Record<PointKey, string>>>({}); const [beds, setBeds] = useState<Partial<Record<ReactorKey, string>>>({});
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const num = (v?: string) => (v == null || v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const P = Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, num(v)]).filter(([, v]) => v !== null)) as Partial<Record<PointKey, number>>;
  const B = Object.fromEntries(Object.entries(beds).map(([k, v]) => [k, num(v)]).filter(([, v]) => v !== null)) as Partial<Record<ReactorKey, number>>;
  const atMs = fromLocal(at); const future = atMs > Date.now() + 15 * 60_000;
  const ok = P.r105_in != null && Object.keys(P).length >= 2 && !future;
  async function save() {
    setBusy(true); setErr(null);
    try { await addWave({ stepId: step.id, at: new Date(atMs).toISOString(), pts: P, beds: B, note }); onDone(); } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <div className="mx-2.5 space-y-2 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
      <Field label="At"><input type="datetime-local" className="input w-full min-w-0 appearance-none" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
      <span className="block text-[11px] font-semibold text-slate-600">Inlet / outlet °F (R-105 inlet needed)</span>
      <div className="grid grid-cols-4 gap-1">{WAVE_POINTS.map((p) => (
        <label key={p.key} className="text-center text-[10px] text-slate-500">{SHORT[p.key]}
          <input className="input mt-0.5 w-full min-w-0 px-1 text-center" inputMode="decimal" value={pts[p.key] ?? ''} placeholder={last?.pts[p.key] != null ? String(last.pts[p.key]) : ''}
            onChange={(e) => setPts((x) => ({ ...x, [p.key]: e.target.value }))} /></label>))}</div>
      <span className="block text-[11px] font-semibold text-slate-600">Coldest bed °F (optional)</span>
      <div className="grid grid-cols-5 gap-1">{WAVE_REACTORS.map((r) => (
        <label key={r.key} className="text-center text-[10px] text-slate-500">{r.name.replace('R-', '')}
          <input className="input mt-0.5 w-full min-w-0 px-1 text-center" inputMode="decimal" value={beds[r.key] ?? ''} onChange={(e) => setBeds((x) => ({ ...x, [r.key]: e.target.value }))} /></label>))}</div>
      <input className="input w-full min-w-0" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {future && <p className="text-xs text-status-red">A time still to come cannot be recorded.</p>}
      {err != null && <ErrorBox error={err} />}
      <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button className="flex-1" disabled={busy || !ok} onClick={save}>Save temperatures</Button></div>
    </div>
  );
}
