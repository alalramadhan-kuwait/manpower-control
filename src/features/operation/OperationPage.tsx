import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { minimumsText, type OperatingMode } from '@/core/modes';
import { isValidIsoDate } from '@/core/roster';
import { cancelPeriod, fetchOperationPlan, saveMode, schedulePeriod, type PeriodRow } from '@/data/modes';
import type { UserProfile } from '@/data/types';
import { BottomSheet, Button, Card, ErrorBox, Field, PageHeader, Spinner, cx } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';

type Sheet = { kind: 'period' } | { kind: 'mode'; mode: OperatingMode | null } | { kind: 'cancel'; period: PeriodRow };

/** Stage I: operating modes and the dates they apply. Each mode sets the minimums per crew; days without a period use Full operation. */
export default function OperationPage({ profile }: { profile: UserProfile }) {
  const head = profile.role_code === 'section_head';
  const today = localToday();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchOperationPlan>> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const load = useCallback(() => { fetchOperationPlan().then(setData).catch(setError); }, []);
  useEffect(load, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const modeOf = (code: string) => data.plan.modes.find((m) => m.code === code);
    const live = data.periods.filter((p) => p.status === 'active' && p.end_date >= today);
    const past = data.periods.filter((p) => p.status === 'cancelled' || p.end_date < today).reverse();
    return { modeOf, live, past, modes: data.plan.modes, choosable: data.plan.modes.filter((m) => !m.isDefault && m.isActive) };
  }, [data, today]);
  const done = (m: string) => { setSheet(null); setFlash(m); load(); };

  const PeriodRowView = ({ p, actions }: { p: PeriodRow; actions?: boolean }) => {
    const m = view!.modeOf(p.mode_code);
    const now = p.start_date <= today && today <= p.end_date && p.status === 'active';
    return (
      <li className="flex items-start justify-between gap-3 py-2.5">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">{m?.label ?? p.mode_code}{now && <span className="rounded bg-brand-700 px-1.5 text-[10px] font-semibold leading-4 text-white">Now</span>}</span>
          <span className="block text-xs text-slate-600">{shortDate(p.start_date)} – {shortDate(p.end_date)}{p.status === 'cancelled' ? ' · cancelled' : ''}</span>
          {m && <span className="block text-[11px] text-slate-500">{minimumsText(m)}</span>}
          {p.note && <span className="block text-[11px] text-slate-500">{p.note}</span>}
          {p.cancel_reason && <span className="block text-[11px] text-slate-400">Cancelled: {p.cancel_reason}</span>}
        </span>
        {actions && <button type="button" className="shrink-0 text-xs font-medium text-status-red" onClick={() => setSheet({ kind: 'cancel', period: p })}>Cancel</button>}
      </li>
    );
  };

  return (
    <div>
      <PageHeader title="Operating modes" info={<><p>Lower minimums per crew for shutdown or one-train periods. Days without a period use Full operation.</p><p>A mode changes only the minimums. Panel still needs its Grade 14+, only Take-Charge = Yes counts in Field, and Grade 13+ covers both Panel and Field.</p><p>Only the Section Head adds modes or changes the numbers. Periods never overlap; a cancelled period stays in the history.</p></>}
        action={<Button className="min-h-10 shrink-0 px-3" disabled={!view?.choosable.length} onClick={() => setSheet({ kind: 'period' })}><Plus className="h-4 w-4" /> Period</Button>} />
      {flash && <div role="status" className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">{flash}</div>}
      {error ? <ErrorBox error={error} /> : !view ? <Spinner /> : (
        <div className="space-y-3">
          <Card className="py-2">
            <h2 className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Periods ({view.live.length})</h2>
            {view.live.length ? <ul className="divide-y divide-slate-100">{view.live.map((p) => <PeriodRowView key={p.id} p={p} actions />)}</ul>
              : <p className="py-2 text-sm text-slate-500">{view.choosable.length ? 'None · Full operation every day' : 'None · add a mode first'}</p>}
          </Card>

          <Card className="py-2">
            <div className="flex items-center justify-between pt-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Modes · min per crew</h2>
              {head && <button type="button" className="text-xs font-medium text-brand-700" onClick={() => setSheet({ kind: 'mode', mode: null })}>+ New mode</button>}
            </div>
            <ul className="divide-y divide-slate-100">
              {view.modes.map((m) => (
                <li key={m.code} className={cx('flex items-start justify-between gap-3 py-2.5', !m.isActive && 'opacity-50')}>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{m.label}{m.isDefault ? <span className="ml-1.5 text-[11px] font-normal text-slate-500">default</span> : null}{!m.isActive ? <span className="ml-1.5 text-[11px] font-normal text-slate-500">switched off</span> : null}</span>
                    <span className="block text-xs text-slate-600">{minimumsText(m)}</span>
                    {m.note && <span className="block text-[11px] text-slate-500">{m.note}</span>}
                  </span>
                  {head && <button type="button" className="shrink-0 text-xs font-medium text-brand-700" onClick={() => setSheet({ kind: 'mode', mode: m })}>Edit</button>}
                </li>
              ))}
            </ul>
          </Card>

          {view.past.length > 0 && (
            <Card className="p-0">
              <button type="button" onClick={() => setHistory(!history)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Past and cancelled ({view.past.length})</span>{history ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
              </button>
              {history && <ul className="divide-y divide-slate-100 px-4 pb-2">{view.past.map((p) => <PeriodRowView key={p.id} p={p} />)}</ul>}
            </Card>
          )}
        </div>
      )}
      {sheet?.kind === 'period' && view && <PeriodSheet modes={view.choosable} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === 'mode' && <ModeSheet mode={sheet.mode} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === 'cancel' && view && <CancelSheet period={sheet.period} label={view.modeOf(sheet.period.mode_code)?.label ?? ''} onClose={() => setSheet(null)} onDone={done} />}
    </div>
  );
}

function useRun(onDone: (m: string) => void) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); setErr(null); try { await fn(); onDone(msg); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return { busy, err, run };
}

function PeriodSheet({ modes, onClose, onDone }: { modes: OperatingMode[]; onClose: () => void; onDone: (m: string) => void }) {
  const { busy, err, run } = useRun(onDone);
  const [mode, setMode] = useState(modes[0]?.code ?? '');
  const [start, setStart] = useState(localToday()); const [end, setEnd] = useState(localToday());
  const [note, setNote] = useState('');
  const m = modes.find((x) => x.code === mode);
  const problem = !m ? 'Choose the mode.' : !isValidIsoDate(start) ? 'Enter the first day.' : !isValidIsoDate(end) || end < start ? 'The last day must be on or after the first day.' : null;
  return (
    <BottomSheet open onClose={onClose} title="Schedule a period">
      <div className="space-y-4">
        <Field label="Mode"><select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>{modes.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
        {m && <p className="-mt-2 text-xs text-slate-500">{minimumsText(m)}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
          <Field label="Last day"><input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Train 2 turnaround" /></Field>
        {problem && <p className="text-xs text-slate-500">{problem}</p>}
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button>
          <Button className="flex-1" disabled={busy || !!problem} onClick={() => run(() => schedulePeriod({ modeCode: mode, start, end, note: note.trim() || null }), `${m!.label}: ${shortDate(start)} – ${shortDate(end)} scheduled.`)}>{busy ? 'Saving…' : 'Schedule'}</Button></div>
      </div>
    </BottomSheet>
  );
}

function ModeSheet({ mode, onClose, onDone }: { mode: OperatingMode | null; onClose: () => void; onDone: (m: string) => void }) {
  const { busy, err, run } = useRun(onDone);
  const [label, setLabel] = useState(mode?.label ?? '');
  const [n, setN] = useState({ controllerMin: mode?.controllerMin ?? 1, panelMin: mode?.panelMin ?? 3, panelGrade14Min: mode?.panelGrade14Min ?? 1, fieldMin: mode?.fieldMin ?? 6 });
  const [note, setNote] = useState(mode?.note ?? '');
  const [active, setActive] = useState(mode?.isActive ?? true);
  const num = (k: keyof typeof n, label: string, max: number) => (
    <Field label={label}><input type="number" inputMode="numeric" min={0} max={max} className="input" value={n[k]} onChange={(e) => setN({ ...n, [k]: Math.max(0, Math.min(max, Number(e.target.value) || 0)) })} /></Field>
  );
  const problem = label.trim().length < 2 ? 'Give the mode a name.' : n.panelGrade14Min > n.panelMin ? 'Panel Grade 14+ cannot be more than the Panel minimum.' : null;
  return (
    <BottomSheet open onClose={onClose} title={mode ? `Edit ${mode.label}` : 'New operating mode'}>
      <div className="space-y-4">
        <Field label="Name"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Shutdown, One train" /></Field>
        <p className="-mt-2 text-xs text-slate-500">Minimum per crew:</p>
        <div className="-mt-2 grid grid-cols-2 gap-3">{num('controllerMin', 'Controller', 5)}{num('panelMin', 'Panel', 10)}{num('panelGrade14Min', 'of them Grade 14+', 10)}{num('fieldMin', 'Field', 20)}</div>
        <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {mode && !mode.isDefault && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Can be scheduled</label>}
        {mode?.isDefault && <p className="text-xs text-slate-500">Applies to every day without a period.</p>}
        {problem && <p className="text-xs text-slate-500">{problem}</p>}
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button>
          <Button className="flex-1" disabled={busy || !!problem} onClick={() => run(() => saveMode({ code: mode?.code, label, ...n, note: note.trim() || null, ...(mode && !mode.isDefault ? { isActive: active } : {}) }), `${label.trim()} saved: ${minimumsText(n)}.`)}>{busy ? 'Saving…' : 'Save'}</Button></div>
      </div>
    </BottomSheet>
  );
}

function CancelSheet({ period, label, onClose, onDone }: { period: PeriodRow; label: string; onClose: () => void; onDone: (m: string) => void }) {
  const { busy, err, run } = useRun(onDone);
  const [reason, setReason] = useState('');
  return (
    <BottomSheet open onClose={onClose} title="Cancel the period">
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{label} · {shortDate(period.start_date)} – {shortDate(period.end_date)}</p>
        <Field label="Reason" hint="The period is kept in the history as cancelled; those days go back to Full operation."><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Back</Button>
          <Button variant="danger" className="flex-1" disabled={busy || !reason.trim()} onClick={() => run(() => cancelPeriod(period.id, reason.trim()), 'Period cancelled. Those days use Full operation again.')}>Cancel period</Button></div>
      </div>
    </BottomSheet>
  );
}
