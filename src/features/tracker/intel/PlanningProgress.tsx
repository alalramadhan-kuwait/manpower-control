// Maintenance Planning progress on the Progress view: the official planned / actual %, the variance, the source and
// the verification state, with "How was this calculated?" (the candidate methods against the reported figures, what
// is missing), the daily history (a compact chart) and the reconciliation with the tracker's own progress. Never
// merged with the tracker's work progress or the finish forecast.
import { useMemo, useState } from 'react';
import { planningCandidates, planningView, reconciliationNotes, reconstruct, type PlanningRecord } from '@/core/tracker/intel';
import { addPlanning } from '@/data/trackerIntel';
import type { TrackerData } from '@/data/tracker';
import { Button, ErrorBox, cx } from '@/ui/components';

const r2 = (x: number) => Math.round(x * 100) / 100;
export function PlanningProgress({ d, records, tracker, canEdit, onDone }: { d: TrackerData; records: PlanningRecord[]; tracker: { planPct: number; actualPct: number } | null; canEdit: boolean; onDone: (msg: string) => void }) {
  const view = useMemo(() => planningView(records), [records]);
  const rec = useMemo(() => reconstruct(d, records), [d, records]);
  const [how, setHow] = useState(false); const [hist, setHist] = useState(false); const [add, setAdd] = useState(false);
  const [date, setDate] = useState(new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10)); const [pl, setPl] = useState(''); const [ac, setAc] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const latest = view.latest;
  const cutoff = latest ? (latest.cutoff ? Date.parse(latest.cutoff) : Date.parse(`${latest.reportDate}T16:00:00Z`)) : Date.now();
  const cands = useMemo(() => planningCandidates(d, cutoff), [d, cutoff]);
  const notes = reconciliationNotes(d, latest, tracker);
  const H3 = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{children}</p>;
  async function save() {
    setBusy(true); setErr(null);
    try { await addPlanning(d.tracker.id, { reportDate: date, planned: Number(pl), actual: Number(ac), source: 'Maintenance Planning' }); setAdd(false); setPl(''); setAc(''); onDone(`Planning ${date}: plan ${pl}% · actual ${ac}% stored.`); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between gap-2"><H3>Maintenance Planning · official</H3>
        <span className={cx('rounded px-1.5 py-px text-[10px] font-bold uppercase', rec.status === 'verified' ? 'bg-green-100 text-green-900' : rec.status === 'partial' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600')}>{rec.status === 'verified' ? 'Verified' : rec.status === 'partial' ? 'Partially reconstructed' : 'Unverified'}</span></div>
      {latest ? <>
        <p className="flex flex-wrap items-baseline gap-x-3"><span><b className="text-[20px] font-extrabold text-brand-700">{latest.actual}%</b> <span className="text-[12px] text-slate-600">actual</span></span>
          <span className="text-[13px] text-slate-700">plan <b>{latest.planned}%</b></span>
          <span className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-bold', view.variance! > 0 ? 'bg-green-100 text-green-900' : view.variance! < 0 ? 'bg-red-100 text-red-900' : 'bg-slate-100 text-slate-700')}>{view.variance! > 0 ? '+' : ''}{view.variance} pts</span></p>
        <p className="text-[11px] text-slate-500">{latest.source} · report {latest.reportDate}{latest.revision > 1 ? ` · revision ${latest.revision}` : ''} · {rec.status === 'verified' ? 'reproduced by the tracker' : 'as reported; calculation not reproduced'}</p>
      </> : <p className="text-[12px] text-slate-600">No official figure yet. Paste the Planning report, or enter the figure.</p>}
      <div className="mt-1 flex flex-wrap gap-x-3 text-[12px] font-semibold text-brand-700">
        <button type="button" onClick={() => setHow((x) => !x)}>{how ? '▾' : '▸'} How was this calculated?</button>
        {view.history.length > 0 && <button type="button" onClick={() => setHist((x) => !x)}>{hist ? '▾' : '▸'} History · {view.history.length}</button>}
        {canEdit && <button type="button" onClick={() => setAdd((x) => !x)}>{add ? '▾' : '＋'} Enter figure</button>}
      </div>
      {add && <div className="mt-1 grid grid-cols-[1fr_auto_auto_auto] items-end gap-1.5">
        <label className="text-[11px] text-slate-500">Date<input type="date" className="input py-1 text-[12px]" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="text-[11px] text-slate-500">Plan %<input inputMode="decimal" className="input w-20 py-1 text-[12px]" value={pl} onChange={(e) => setPl(e.target.value)} /></label>
        <label className="text-[11px] text-slate-500">Actual %<input inputMode="decimal" className="input w-20 py-1 text-[12px]" value={ac} onChange={(e) => setAc(e.target.value)} /></label>
        <Button className="min-h-8 px-3 text-[12px]" disabled={busy || !pl || !ac} onClick={save}>Save</Button>
        {err != null && <div className="col-span-4"><ErrorBox error={err} /></div>}
        <p className="col-span-4 text-[11px] text-slate-500">A second figure for the same day is kept as a revision; the first is never overwritten.</p></div>}
      {how && <div className="mt-1 space-y-1 text-[12px] text-slate-700">
        <p>{rec.note}</p>
        <table className="w-full text-[11px]"><thead><tr className="text-left text-slate-500"><th>Method</th><th className="text-right">Plan</th><th className="text-right">Actual</th><th className="text-right">Dates matched</th></tr></thead>
          <tbody>{cands.map((c) => { const m = rec.matches.find((x) => x.code === c.code); const hit = !!m && (m.dates.length + m.plannedOnly.length + m.actualOnly.length > 0); return <tr key={c.code} className={cx(hit && 'font-semibold')}><td title={c.formula}>{c.code} · {c.name}</td><td className="text-right tabular-nums">{c.planned ?? '—'}%</td><td className="text-right tabular-nums">{c.actual ?? '—'}%</td><td className="text-right tabular-nums">{m ? `${m.dates.length}${m.plannedOnly.length || m.actualOnly.length ? ` (+${m.plannedOnly.length + m.actualOnly.length} one side)` : ''}` : '—'}</td></tr>; })}</tbody></table>
        <p className="text-[11px] text-slate-500">At the cutoff {new Date(cutoff + 3 * 36e5).toISOString().slice(0, 16).replace('T', ' ')} · scope: {cands[0]?.basis ?? '—'} · a method counts as verified only when it reproduces several dated figures; no weight is invented to force a match.</p>
        {rec.missing.length > 0 && <><p className="font-semibold">Needed to reconstruct the official figure</p><ul className="list-disc pl-4">{rec.missing.map((m) => <li key={m}>{m}</li>)}</ul></>}
        {notes.length > 0 && <><p className="font-semibold">Planning vs tracker</p><ul className="list-disc pl-4">{notes.map((n) => <li key={n}>{n}</li>)}</ul></>}
      </div>}
      {hist && <div className="mt-1">
        <Chart rows={view.history} />
        <table className="mt-1 w-full text-[11px]"><thead><tr className="text-left text-slate-500"><th>Date</th><th className="text-right">Plan</th><th className="text-right">Actual</th><th className="text-right">Var.</th><th className="text-right">Δ actual</th><th>Source</th></tr></thead>
          <tbody>{[...view.history].reverse().map((h) => <tr key={h.date}><td>{h.date}{h.revision > 1 ? ` r${h.revision}` : ''}</td><td className="text-right tabular-nums">{h.planned}</td><td className="text-right tabular-nums">{h.actual}</td><td className={cx('text-right tabular-nums', h.variance < 0 ? 'text-red-800' : h.variance > 0 ? 'text-green-800' : '')}>{r2(h.variance)}</td><td className="text-right tabular-nums">{h.dActual === null ? '—' : `${h.dActual > 0 ? '+' : ''}${h.dActual}`}</td><td className="truncate">{h.source}</td></tr>)}</tbody></table>
      </div>}
    </section>
  );
}

/** Planned and actual % day by day, as two lines. */
function Chart({ rows }: { rows: { date: string; planned: number; actual: number }[] }) {
  if (rows.length < 2) return null;
  const W = 320, H = 80, p = 6;
  const x = (i: number) => p + (i * (W - 2 * p)) / (rows.length - 1), y = (v: number) => H - p - (v * (H - 2 * p)) / 100;
  const path = (k: 'planned' | 'actual') => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" role="img" aria-label="Planning progress history">
      {[25, 50, 75].map((g) => <line key={g} x1={p} x2={W - p} y1={y(g)} y2={y(g)} stroke="#e2e8f0" strokeWidth="1" />)}
      <path d={path('planned')} fill="none" stroke="#64748b" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d={path('actual')} fill="none" stroke="#1d4ed8" strokeWidth="2" />
      {rows.map((r, i) => <circle key={r.date} cx={x(i)} cy={y(r.actual)} r="2.5" fill="#1d4ed8" />)}
      <text x={p} y={H - 1} fontSize="8" fill="#64748b">{rows[0].date.slice(5)}</text><text x={W - p} y={H - 1} fontSize="8" fill="#64748b" textAnchor="end">{rows[rows.length - 1].date.slice(5)}</text>
      <text x={W - p} y={10} fontSize="8" fill="#64748b" textAnchor="end">— plan · — actual</text>
    </svg>
  );
}
