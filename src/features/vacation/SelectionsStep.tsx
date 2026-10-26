// Step 4 · Vacation selections: enter what each person marked (same form, same order, same cycle numbers as the paper)
// or read the returned forms from a scan or photo. Each tap is checked at once (slots, Controller turn, summer, other
// leave, shutdown team, crew minimums) and saved; a cycle that breaks a rule is refused with the reason (no bypass).
import { Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { blocksFromPicks, cellInfo, cyclesFor, prepare, runsOf, VAC_RULES, yearForms, type Block, type CellState, type FormDoc } from '@/core/vacation';
import { planCtx, saveBlocks } from '@/data/vacation';
import { ErrorBox, cx } from '@/ui/components';
import { dm, StatusChip } from './parts';
import { restrictedFor } from './restricted';
import { UploadPanel } from './UploadPanel';
import type { StepProps } from './VacationPlanPage';

const CELL: Record<CellState, string> = {
  selected: 'bg-brand-700 text-white ring-brand-700', available: 'bg-white text-slate-500 ring-slate-300',
  full: 'bg-slate-100 text-slate-400 ring-slate-200', conflict: 'bg-red-600 text-white ring-red-700', restricted: 'bg-slate-200 text-slate-500 ring-slate-200 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(100,116,139,.25)_3px,rgba(100,116,139,.25)_5px)]'
};
const MARK: Record<CellState, string> = { selected: '✓', available: '', full: '·', conflict: '!', restricted: '×' };

export default function SelectionsStep(props: StepProps) {
  const { d, ev, canEdit, toast, refreshPlan, check } = props;
  const [params, setParams] = useSearchParams();
  const mode = params.get('m') === 'upload' ? 'upload' : 'enter';
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v === null) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const forms = useMemo(() => (d.alloc?.status === 'approved' ? yearForms({ year: d.year, version: d.alloc.version, approvedOn: null, people: d.people, ev, restricted: restrictedFor(d) }) : []), [d, ev]);
  const editable = canEdit && d.plan?.status === 'draft' && d.alloc?.status === 'approved';
  if (!forms.length) return <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Approve the manpower allocation first.</p>;
  return (
    <div className="space-y-2">
      <div role="tablist" className="inline-flex gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {(['enter', 'upload'] as const).map((m) => (
          <button key={m} role="tab" type="button" aria-selected={mode === m} onClick={() => setParam('m', m === 'enter' ? null : m)}
            className={cx('min-h-9 rounded-lg px-3 font-semibold', mode === m ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{m === 'enter' ? 'Enter by hand' : <span className="inline-flex items-center gap-1"><Upload className="h-3.5 w-3.5" />Upload forms</span>}</button>
        ))}
      </div>
      {!editable && <p className="text-xs text-slate-600">{d.plan?.status === 'draft' ? 'View only.' : `The plan is ${d.plan?.status === 'submitted' ? 'waiting for approval' : d.plan?.status}: the Section Head returns it to change selections.`}</p>}
      {mode === 'enter' ? <EntryGrid {...props} forms={forms} editable={!!editable} /> : <UploadPanel d={d} forms={forms} editable={!!editable} toast={toast} refreshPlan={refreshPlan} />}
      {check && <p className="text-[11px] text-slate-500">Plan so far: {check.summary.complete}/{check.summary.people} complete · {check.summary.missing} missing periods · {check.summary.conflicts} conflicts.</p>}
    </div>
  );
}

function EntryGrid({ d, toast, refreshPlan, check, forms, editable }: StepProps & { forms: FormDoc[]; editable: boolean }) {
  const [params, setParams] = useSearchParams();
  const fIndex = Math.min(forms.length - 1, Number(params.get('f') ?? 0) || 0);
  const half = params.get('h') === '2' ? 2 : params.get('h') === 'y' ? 0 : 1;
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v === null) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const form = forms[fIndex];
  const [blocks, setBlocks] = useState<Block[]>(d.blocks);
  useEffect(() => setBlocks(d.blocks), [d.blocks]);
  const [err, setErr] = useState<unknown>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const pr = useMemo(() => prepare(planCtx(d, blocks)), [d, blocks]);
  const conflictCells = useMemo(() => { const s = new Set<string>(); for (const i of check?.issues ?? []) if (i.level === 'error' && i.cycle !== null) for (const id of i.employeeIds) s.add(`${id}|${i.cycle}`); return s; }, [check]);
  const sections = useMemo(() => {
    // one section per rota: the people in the form order, the cycles of the chosen half (or the year)
    const seen = new Map<string, { title: string; crew: string; slots: string; rows: { employeeId: string; no: number; name: string; number: string; detail: string }[] }>();
    for (const p of form.pages) for (const s of p.sections) { const key = s.title; if (!seen.has(key)) seen.set(key, { title: s.title, crew: s.crew, slots: s.slots, rows: s.rows }); }
    return [...seen.values()];
  }, [form]);
  const grid = useRef<HTMLDivElement>(null);

  async function toggle(id: string, index: number) {
    if (!editable || saving) return;
    const mine = new Set(pr.picks.get(id) ?? []);
    const selected = mine.has(index);
    if (!selected) {
      const info = cellInfo(pr, id, index);
      if (info.state !== 'available') { toast(info.reason ?? 'Not available.'); return; }
      mine.add(index);
    } else mine.delete(index);
    const cyc = cyclesFor(pr, id);
    const before = blocks.filter((b) => b.employeeId === id);
    const next = blocksFromPicks(cyc, id, mine, before, 'manual');
    setBlocks((all) => [...all.filter((b) => b.employeeId !== id), ...next]);
    setSaving(id); setErr(null);
    try {
      await saveBlocks(d.year, id, next);
      const name = pr.byId.get(id)?.name ?? '';
      toast(`${name}: cycle ${index + 1} ${selected ? 'removed' : 'added'} (${runsOf(mine).length} periods).`, async () => {
        try { await saveBlocks(d.year, id, before); await refreshPlan(); } catch (e) { setErr(e); }
      });
      await refreshPlan();
    } catch (e) { setErr(e); setBlocks(d.blocks); } finally { setSaving(null); }
  }
  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    const el = e.currentTarget; const r = Number(el.dataset.r), c = Number(el.dataset.c);
    const to = e.key === 'ArrowRight' ? [r, c + 1] : e.key === 'ArrowLeft' ? [r, c - 1] : e.key === 'ArrowDown' ? [r + 1, c] : e.key === 'ArrowUp' ? [r - 1, c] : null;
    if (!to) return;
    e.preventDefault();
    grid.current?.querySelector<HTMLButtonElement>(`button[data-r="${to[0]}"][data-c="${to[1]}"]`)?.focus();
  }
  let rowNo = 0;
  return (
    <div className="space-y-2">
      <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
        {forms.map((f, i) => <button key={f.file} type="button" onClick={() => setParam('f', i ? String(i) : null)} className={cx('min-h-9 shrink-0 rounded-lg px-2.5 text-xs font-semibold ring-1', i === fIndex ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200')}>
          {f.kind === 'controllers' ? 'Controllers' : f.kind === 'panel' ? 'Panel' : `Field ${f.crew}`}</button>)}
        <span className="mx-1 w-px shrink-0 bg-slate-200" />
        {([[1, 'Jan–Jun'], [2, 'Jul–Dec'], [0, 'Year']] as const).map(([h, l]) => <button key={h} type="button" onClick={() => setParam('h', h === 1 ? null : h === 2 ? '2' : 'y')} className={cx('min-h-9 shrink-0 rounded-lg px-2.5 text-xs font-semibold ring-1', half === h ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-slate-700 ring-slate-200')}>{l}</button>)}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
        {(['selected', 'available', 'full', 'conflict', 'restricted'] as CellState[]).map((s) => <span key={s} className="inline-flex items-center gap-1"><span className={cx('inline-flex h-4 w-4 items-center justify-center rounded text-[10px] ring-1', CELL[s])}>{MARK[s]}</span>{s === 'selected' ? 'Selected' : s === 'available' ? 'Available' : s === 'full' ? 'Full' : s === 'conflict' ? 'Conflict' : 'Restricted'}</span>)}
        <span>· tap or Space to choose, arrows to move</span>
      </p>
      {err != null && <ErrorBox error={err} />}
      <div ref={grid} className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        {sections.map((s) => {
          const cycles = (pr.cycles[s.crew as 'A'] ?? []).filter((c) => half === 0 || (Number(c.start.slice(5, 7)) <= 6) === (half === 1));
          return (
            <table key={s.title} className="border-separate border-spacing-0 text-[11px]">
              <thead>
                <tr><th colSpan={2 + cycles.length} className="sticky left-0 bg-white px-3 pb-0.5 pt-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">{s.title} · slots {s.slots}</th></tr>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[150px] bg-white px-2 text-left font-semibold text-slate-500">Name</th>
                  <th className="bg-white px-1 font-semibold text-slate-500">Per.</th>
                  {cycles.map((c) => <th key={c.index} className={cx('min-w-[34px] px-0.5 pb-1 text-center font-semibold leading-tight', c.summer ? 'bg-amber-50 text-amber-900' : 'text-slate-500')}>C{c.index + 1}<span className="block text-[9px] font-normal">{dm(c.start)}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => {
                  const pp = check?.persons.get(r.employeeId);
                  const periods = runsOf(pr.picks.get(r.employeeId) ?? []).length;
                  const rr = rowNo++;
                  return (
                    <tr key={r.employeeId} className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 max-w-[170px] border-t border-slate-100 bg-white px-2 py-0.5">
                        <span className="block truncate font-semibold text-slate-900" title={r.name}>{r.no}. {r.name}</span>
                        <span className="text-[10px] text-slate-500">#{r.number} · {r.detail}{saving === r.employeeId ? ' · saving…' : ''}</span>
                      </td>
                      <td className="border-t border-slate-100 px-1 text-center">
                        <StatusChip level={pp?.status === 'conflict' || pp?.status === 'over' ? 'error' : periods >= VAC_RULES.minPeriods ? 'ok' : 'warning'} label={`${periods}`} />
                      </td>
                      {cycles.map((c, ci) => {
                        const sel = pr.picks.get(r.employeeId)?.has(c.index) ?? false;
                        const info = sel ? null : cellInfo(pr, r.employeeId, c.index, { coverage: false });
                        const state: CellState = sel ? (conflictCells.has(`${r.employeeId}|${c.index}`) ? 'conflict' : 'selected') : info!.state;
                        return (
                          <td key={c.index} className={cx('border-t border-slate-100 p-0.5 text-center', c.summer && 'bg-amber-50/60')}>
                            <button type="button" data-r={rr} data-c={ci} onKeyDown={onKey} disabled={!editable || state === 'restricted'}
                              aria-label={`${r.name} cycle ${c.index + 1} ${dm(c.start)}: ${state}${info?.reason ? ` (${info.reason})` : ''}`} title={info?.reason ?? undefined}
                              onClick={() => toggle(r.employeeId, c.index)}
                              className={cx('h-8 w-8 rounded-md text-xs font-bold ring-1 focus:outline-none focus:ring-2 focus:ring-brand-500', CELL[state])}>{MARK[state]}</button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        })}
      </div>
    </div>
  );
}
