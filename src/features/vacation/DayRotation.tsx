// The Day Supervisor (Morning Controller post) of the plan year in two-month turns: what the Controllers agreed, or a
// fair proposal for the empty turns (never over an agreed turn). Shown on the Controllers' vacation form.
import { useMemo, useState } from 'react';
import { dayTurns, isControllerGroup, proposeDayRotation, type AllocEval, type DayTurn } from '@/core/vacation';
import { saveDayRotation, type VacationData } from '@/data/vacation';
import { ErrorBox, cx } from '@/ui/components';
import { SectionHead, span } from './parts';

export function DayRotation({ d, ev, editable, onSaved }: { d: VacationData; ev: AllocEval; editable: boolean; onSaved?: () => void }) {
  const [saved, setSaved] = useState<DayTurn[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const turns = saved ?? (d.day.length ? d.day : dayTurns(d.year).map((t) => {
    const m = d.morning.find((x) => x.start <= t.end && t.start <= x.end);
    return { ...t, employeeId: m?.employeeId ?? null, source: 'agreed' as const };
  }));
  const candidates = useMemo(() => [...ev.placed.values()].filter(({ row }) => isControllerGroup(row)).map(({ row }) => d.people.find((p) => p.id === row.employeeId)!)
    .filter((p) => p && (p.grade ?? 0) >= 15).sort((a, b) => a.name.localeCompare(b.name)), [ev, d.people]);
  const name = (id: string | null) => (id ? d.people.find((p) => p.id === id)?.name ?? '—' : 'Empty');
  async function save(next: DayTurn[]) {
    setBusy(true); setErr(null);
    try { await saveDayRotation(d.year, next); setSaved(next); onSaved?.(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const empty = turns.filter((t) => !t.employeeId).length;
  return (
    <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 lg:max-w-2xl">
      <SectionHead title={`Day Supervisor · ${d.year}`} right={editable && empty > 0 ? <button type="button" disabled={busy || !candidates.length} onClick={() => save(proposeDayRotation(d.year, turns.filter((t) => t.employeeId), candidates.map((c) => ({ id: c.id, name: c.name, morningDays: 0 }))))}
        className="min-h-7 rounded-md px-1.5 text-[11px] font-semibold normal-case tracking-normal text-brand-700">Propose {empty} empty</button> : null} />
      {err != null && <div className="px-3"><ErrorBox error={err} /></div>}
      <ul className="divide-y divide-slate-100">
        {turns.map((t, i) => (
          <li key={t.start} className="flex min-h-10 items-center gap-2 px-3 py-1 text-[13px]">
            <span className="w-28 shrink-0 tabular-nums text-slate-600">{span(t.start, t.end)}</span>
            {editable ? (
              <select aria-label={`Day Supervisor ${span(t.start, t.end)}`} disabled={busy} value={t.employeeId ?? ''} onChange={(e) => save(turns.map((x, j) => (j === i ? { ...x, employeeId: e.target.value || null, source: 'agreed' as const } : x)))}
                className="input min-w-0 flex-1 py-1 text-[13px] sm:max-w-xs">
                <option value="">Empty</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : <span className="min-w-0 flex-1 font-medium">{name(t.employeeId)}</span>}
            <span className={cx('shrink-0 rounded px-1 text-[10px] font-bold', !t.employeeId ? 'bg-slate-100 text-slate-500' : t.source === 'agreed' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900')}>{t.employeeId ? (t.source === 'agreed' ? 'Agreed' : 'Proposed') : 'Empty'}</span>
          </li>
        ))}
      </ul>
      <p className="px-3 pb-2 pt-1 text-[11px] text-slate-500">The Controllers agree the turns first; a proposal only fills empty turns. Operational Morning rotations stay in Controllers › Morning rotation.</p>
    </section>
  );
}
