// Step 5 · Review the complete plan: one compact summary, one list with filters (shift, group, name, month, status,
// manual / system), a month table from the same data, the person's sheet on tap. Missing periods can be filled by the
// system (marked System, editable, never moving a chosen one); what cannot be filled is listed for the Section Head.
import { Search, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { autoAssign, cyclesFor, prepare, VAC_RULES, type AutoResult, type PlanIssue } from '@/core/vacation';
import { CREWS } from '@/core/roster';
import { planCtx, rowsOf, saveBlocks, submitPlan } from '@/data/vacation';
import { BottomSheet, Button, ErrorBox, cx } from '@/ui/components';
import { dm, span, StatusChip } from './parts';
import type { StepProps } from './VacationPlanPage';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
type Status = 'all' | 'conflict' | 'missing' | 'system' | 'manual' | 'ok';

export default function ReviewStep({ d, ev, canEdit, isHead, toast, refreshPlan, check, go }: StepProps) {
  const [params, setParams] = useSearchParams();
  const f = { crew: params.get('c') ?? 'all', group: params.get('g') ?? 'all', q: params.get('q') ?? '', month: Number(params.get('mo') ?? 0), status: (params.get('s') ?? 'all') as Status };
  const set = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (!v || v === 'all' || v === '0') n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const [open, setOpen] = useState<string | null>(null);
  const [auto, setAuto] = useState<AutoResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const editable = canEdit && d.plan?.status === 'draft';
  const pr = useMemo(() => prepare(planCtx(d)), [d]);
  const rows = rowsOf(d);
  const groupOf = (id: string) => { const pl = ev.placed.get(id); if (!pl) return null; const r = pl.row;
    return r.group === 'relief' ? (r.relief === 'vr' || r.relief === 'day_supervisor' ? 'controller' : r.relief === 'float_panel' ? 'panel' : 'field') : r.group === 'field' && pl.acting ? 'panel' : r.group; };
  const shiftOf = (id: string) => { const r = ev.placed.get(id)?.row; return r ? (r.group === 'relief' ? `R${r.cycleCrew ?? ''}` : r.crew ?? '') : ''; };
  const issuesOf = useMemo(() => { const m = new Map<string, PlanIssue[]>(); for (const i of check?.issues ?? []) for (const id of i.employeeIds) m.set(id, [...(m.get(id) ?? []), i]); return m; }, [check]);
  const list = useMemo(() => d.people.filter((p) => check?.persons.has(p.id)).map((p) => {
    const pp = check!.persons.get(p.id)!; const cyc = cyclesFor(pr, p.id);
    const blocks = d.blocks.filter((b) => b.employeeId === p.id);
    return { p, pp, cyc, blocks, group: groupOf(p.id), shift: shiftOf(p.id), issues: issuesOf.get(p.id) ?? [] };
  }).filter((x) => (f.crew === 'all' || x.shift === f.crew || (f.crew === 'R' && x.shift.startsWith('R'))) && (f.group === 'all' || x.group === f.group)
    && (!f.q || x.p.name.toLowerCase().includes(f.q.toLowerCase()) || x.p.number.includes(f.q))
    && (!f.month || x.blocks.some((b) => Number(b.start.slice(5, 7)) === f.month || Number(b.end.slice(5, 7)) === f.month))
    && (f.status === 'all' || (f.status === 'conflict' && (x.pp.status === 'conflict' || x.pp.status === 'over')) || (f.status === 'missing' && x.pp.periods.length < VAC_RULES.minPeriods)
      || (f.status === 'system' && x.blocks.some((b) => b.source === 'system')) || (f.status === 'manual' && x.blocks.length > 0 && x.blocks.every((b) => b.source !== 'system')) || (f.status === 'ok' && x.pp.status === 'ok')))
    .sort((a, b) => a.shift.localeCompare(b.shift) || (a.group ?? '').localeCompare(b.group ?? '') || a.p.name.localeCompare(b.p.name)), [d, check, pr, f.crew, f.group, f.q, f.month, f.status, issuesOf]);   // eslint-disable-line
  if (!check) return <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Approve the manpower allocation first.</p>;
  const s = check.summary;

  async function fill() {
    setBusy('Finding free cycles…'); setErr(null);
    try {
      await new Promise((r) => setTimeout(r, 0));
      const r = autoAssign(planCtx(d));
      setAuto(r);
      if (!r.blocks.length) { toast(r.exceptions.length ? 'No free cycle for the missing periods (see the list).' : 'Nobody is missing a period.'); return; }
      const by = new Map<string, typeof r.blocks>(); for (const b of r.blocks) by.set(b.employeeId, [...(by.get(b.employeeId) ?? []), b]);
      setBusy(`Saving ${r.blocks.length} periods…`);
      for (const [emp, add] of by) await saveBlocks(d.year, emp, [...d.blocks.filter((b) => b.employeeId === emp), ...add]);
      await refreshPlan();
      toast(`${r.blocks.length} periods assigned by the system (marked System, editable)${r.exceptions.length ? ` · ${r.exceptions.length} could not be placed` : ''}.`);
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }
  // month table: vacation periods starting per month, by shift and group (the same data as the list)
  const months = CREWS.flatMap((c) => (['controller', 'panel', 'field'] as const).map((g) => ({ c, g, n: MONTHS.map((_, m) => d.blocks.filter((b) => shiftOf(b.employeeId) === c && groupOf(b.employeeId) === g && Number(b.start.slice(5, 7)) === m + 1).length) })))
    .filter((x) => x.n.some((v) => v > 0));
  const sel = open ? list.find((x) => x.p.id === open) ?? null : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 text-[11px]">
        {[['People', s.people, 'ok'], ['Complete', `${s.complete}/${s.people}`, s.complete === s.people ? 'ok' : 'warning'], ['Missing periods', s.missing, s.missing ? 'warning' : 'ok'], ['System assigned', s.system, 'ok'],
          ['Conflicts', s.conflicts, s.conflicts ? 'error' : 'ok'], ['Shortages', s.shortages, s.shortages ? 'error' : 'ok'], ['Periods', s.periods, 'ok']].map(([l, v, lv]) => (
          <span key={l as string} className={cx('rounded-lg px-2 py-1 font-semibold ring-1', lv === 'error' ? 'bg-red-50 text-red-800 ring-red-200' : lv === 'warning' ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-white text-slate-700 ring-slate-200')}>{l} <b className="tabular-nums">{v}</b></span>))}
        <span className="rounded-lg bg-white px-2 py-1 font-semibold text-slate-700 ring-1 ring-slate-200">Free slot-cycles {CREWS.map((c) => `${c} P${s.byCrew[c].freePanel}/F${s.byCrew[c].freeField}`).join(' · ')}</span>
      </div>
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-10" disabled={!!busy || s.missing === 0} onClick={fill}><Wand2 className="h-4 w-4" />Fill missing periods ({s.missing})</Button>
          {!isHead && <Button className="min-h-10" disabled={!!busy || !d.blocks.length} onClick={async () => { setBusy('Sending…'); setErr(null); try { await submitPlan(d.year, note); await refreshPlan(); toast('Sent to the Section Head for approval.'); } catch (e) { setErr(e); } finally { setBusy(null); } }}>Send for approval</Button>}
          {isHead && <Button className="min-h-10" onClick={() => go(6)}>Approve & publish ›</Button>}
          {!isHead && <input aria-label="Note for the Section Head" placeholder="Note for the Section Head (optional)" className="input min-w-0 flex-1 py-1.5 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />}
        </div>
      )}
      {busy && <p className="text-xs text-slate-600">{busy}</p>}
      {err != null && <ErrorBox error={err} />}
      {auto && auto.exceptions.length > 0 && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-900"><b>Needs the Section Head: {auto.exceptions.length} period{auto.exceptions.length === 1 ? '' : 's'} could not be placed.</b>
          <ul className="mt-1 space-y-0.5">{auto.exceptions.map((x) => <li key={x.employeeId}>⛔ {x.text}</li>)}</ul></div>
      )}
      <div className="flex flex-wrap items-center gap-1 text-xs">
        {['all', ...CREWS, 'R'].map((c) => <button key={c} type="button" onClick={() => set('c', c)} className={cx('min-h-8 rounded-lg px-2 font-semibold ring-1', f.crew === c ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200')}>{c === 'all' ? 'All' : c === 'R' ? 'Relief' : c}</button>)}
        <span className="mx-0.5 w-px self-stretch bg-slate-200" />
        {['all', 'controller', 'panel', 'field'].map((g) => <button key={g} type="button" onClick={() => set('g', g)} className={cx('min-h-8 rounded-lg px-2 font-semibold ring-1', f.group === g ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200')}>{g === 'all' ? 'All roles' : g === 'controller' ? 'Ctl' : g === 'panel' ? 'Panel' : 'Field'}</button>)}
        <select aria-label="Status" value={f.status} onChange={(e) => set('s', e.target.value)} className="input min-h-8 w-auto py-1 text-xs">
          <option value="all">Any status</option><option value="conflict">Conflict</option><option value="missing">Missing periods</option><option value="system">System assigned</option><option value="manual">Selected only</option><option value="ok">Complete</option></select>
        <select aria-label="Month" value={f.month} onChange={(e) => set('mo', e.target.value)} className="input min-h-8 w-auto py-1 text-xs"><option value={0}>Any month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <label className="relative min-w-[8rem] flex-1"><Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" /><input aria-label="Employee" placeholder="Name or no." value={f.q} onChange={(e) => set('q', e.target.value)} className="input min-h-8 py-1 pl-7 text-xs" /></label>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {list.map((x) => {
          const lv = x.pp.status === 'conflict' || x.pp.status === 'over' ? 'error' : x.pp.periods.length < VAC_RULES.minPeriods ? 'warning' : 'ok';
          return (
            <li key={x.p.id}><button type="button" onClick={() => setOpen(x.p.id)} className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left active:bg-slate-50">
              <span className="w-7 shrink-0 text-center text-[11px] font-bold text-slate-500">{x.shift}</span>
              <span className="min-w-0 flex-1">
                <b className="block text-[13px] text-slate-900">{x.p.name}</b>
                <span className="block text-[11px] tabular-nums text-slate-500">{x.pp.periods.map(([a, z]) => `${span(x.cyc[a].start, x.cyc[z].end)}${x.blocks.some((b) => b.start === x.cyc[a].start && b.source === 'system') ? ' (S)' : ''}`).join(' · ') || 'No vacation yet'}</span>
              </span>
              <StatusChip level={lv} label={`${x.pp.periods.length}/${VAC_RULES.minPeriods}–${VAC_RULES.maxPeriods}`} />
            </button></li>
          );
        })}
        {!list.length && <li className="px-3 py-3 text-xs text-slate-500">Nobody matches these filters.</li>}
      </ul>
      {months.length > 0 && (
        <details className="rounded-2xl bg-white ring-1 ring-slate-200">
          <summary className="flex min-h-10 cursor-pointer items-center px-3 text-[13px] font-semibold text-slate-700">By month · vacations starting</summary>
          <div className="overflow-x-auto px-2 pb-2"><table className="text-[11px] tabular-nums"><thead><tr><th className="px-1 text-left text-slate-500">Shift</th>{MONTHS.map((m, i) => <th key={m} className="px-1 text-slate-500"><button type="button" onClick={() => set('mo', String(i + 1))} className="font-semibold">{m}</button></th>)}</tr></thead>
            <tbody>{months.map((r) => <tr key={r.c + r.g}><td className="px-1 font-semibold">{r.c} {r.g === 'controller' ? 'Ctl' : r.g === 'panel' ? 'P' : 'F'}</td>{r.n.map((v, i) => <td key={i} className={cx('px-1 text-center', v ? 'font-semibold text-slate-900' : 'text-slate-300')}>{v || '·'}</td>)}</tr>)}</tbody></table></div>
        </details>
      )}
      {sel && (
        <BottomSheet open title={sel.p.name} onClose={() => setOpen(null)}>
          <div className="space-y-2 text-sm">
            <p className="-mt-2 text-xs text-slate-600">#{sel.p.number} · {sel.shift.startsWith('R') ? `Relief, ${sel.shift.slice(1)} rota` : `${sel.shift} Shift`} · {sel.group} · {sel.pp.periods.length} periods ({VAC_RULES.minPeriods}–{VAC_RULES.maxPeriods})</p>
            <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
              {sel.blocks.map((b) => (
                <li key={b.start} className="flex min-h-10 items-center gap-2 px-3 py-1 text-[13px]">
                  <span className="min-w-0 flex-1 tabular-nums">{span(b.start, b.end)} <span className="text-[11px] text-slate-500">· {Math.round((Date.parse(b.end) - Date.parse(b.start)) / 864e5 + 1) / 8} cycle(s){sel.cyc.find((c) => c.start === b.start)?.summer ? ' · summer' : ''}</span></span>
                  <span className={cx('rounded px-1.5 text-[10px] font-bold', b.source === 'system' ? 'bg-amber-100 text-amber-900' : b.source === 'form' ? 'bg-sky-100 text-sky-900' : 'bg-slate-100 text-slate-700')}>{b.source === 'system' ? 'System' : b.source === 'form' ? 'Form' : 'Manual'}</span>
                  {editable && b.source === 'system' && <button type="button" className="text-xs font-semibold text-red-700" onClick={async () => { try { await saveBlocks(d.year, sel.p.id, sel.blocks.filter((x) => x !== b)); await refreshPlan(); toast('System period removed.'); } catch (e) { setErr(e); } }}>Remove</button>}
                </li>))}
              {!sel.blocks.length && <li className="px-3 py-2 text-xs text-slate-500">No vacation yet.</li>}
            </ul>
            {sel.issues.length > 0 && <ul className="space-y-1">{sel.issues.map((i, k) => <li key={k} className="flex items-start gap-1.5 text-xs"><StatusChip level={i.level} label={i.level === 'error' ? 'Blocking' : 'Review'} /><span>{i.text}</span></li>)}</ul>}
            <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => { setOpen(null); go(4); }}>Change in the cycle grid ›</button>
            <p className="text-[11px] text-slate-500">Rota cycles of {sel.cyc[0] ? dm(sel.cyc[0].start) : '—'} …; {rows.find((r) => r.employeeId === sel.p.id)?.group === 'relief' ? 'relief follows its chosen rota.' : 'the shift rota.'}</p>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
