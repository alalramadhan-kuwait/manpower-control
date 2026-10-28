import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { minimumsText, modeOn, unitsOn, type OperatingMode, type UnitSection } from '@/core/modes';
import { isValidIsoDate } from '@/core/roster';
import { fetchShutdownOutlook, type UnitEvent } from '@/data/calendar';
import { cancelPeriod, fetchOperationPlan, fetchUnitStatusHistory, saveMode, schedulePeriod, type PeriodRow, type UnitStatusChange } from '@/data/modes';
import type { UserProfile } from '@/data/types';
import { BottomSheet, Button, Card, ErrorBox, Field, PageHeader, Spinner, cx } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';

type Sheet = { kind: 'period' } | { kind: 'mode'; mode: OperatingMode | null } | { kind: 'cancel'; period: PeriodRow } | { kind: 'unit'; unit: UnitSection };
const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
/** A range with its year when it is not this year (far-off shutdowns of the five-year plan). */
const rangeY = (a: string, b: string, today: string) => `${range(a, b)}${b.slice(0, 4) !== today.slice(0, 4) ? ` ${b.slice(0, 4)}` : ''}`;

/**
 * Unit status and the minimums per crew. Each unit section needs its own Panel and Field Operators; a section is down
 * on the dates of a calendar shutdown / outage that names it, and the minimums follow. A manual period overrides it.
 */
export default function OperationPage({ profile }: { profile: UserProfile }) {
  const head = profile.role_code === 'section_head';
  const today = localToday();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchOperationPlan>> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [manual, setManual] = useState(false);
  const load = useCallback(() => { fetchOperationPlan().then(setData).catch(setError); }, []);
  useEffect(load, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const plan = data.plan;
    const modeOf = (code: string) => plan.modes.find((m) => m.code === code);
    const live = data.periods.filter((p) => p.status === 'active' && p.end_date >= today);
    const past = data.periods.filter((p) => p.status === 'cancelled' || p.end_date < today).reverse();
    const outages = (plan.outages ?? []).filter((o) => o.end >= today).map((o) => ({ o, mode: modeOn(o.start < today ? today : o.start, plan) }));
    return { plan, modeOf, live, past, modes: plan.modes, choosable: plan.modes.filter((m) => !m.isDefault && m.isActive), status: unitsOn(today, plan), now: modeOn(today, plan), outages };
  }, [data, today]);
  const done = (m: string) => { setSheet(null); setFlash(m); load(); };
  const yearOn = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  const soon = view ? view.outages.filter(({ o }) => o.start <= yearOn) : [];

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
          {p.cancel_reason && <span className="block text-[11px] text-slate-500">Cancelled: {p.cancel_reason}</span>}
        </span>
        {actions && <button type="button" className="shrink-0 text-xs font-medium text-status-red" onClick={() => setSheet({ kind: 'cancel', period: p })}>Cancel</button>}
      </li>
    );
  };

  return (
    <div>
      <PageHeader title="Unit status" info={<><p>Each unit section needs its own operators in every crew: Train-1, Train-2 and the Fractionator Section 1 Panel and 2 Field each. The Controller and one Panel Grade 14+ stay while any section runs.</p><p>A section is down on the dates of a Calendar shutdown or outage that names it, and the minimums drop with it. Without the Fractionator Section the unit cannot run: while it is down there is no minimum.</p><p>Move or change a shutdown on the Calendar (a shutdown plan's dates move its Calendar event too). A manual period, below, overrides the unit status on its dates.</p></>} />
      {flash && <div role="status" className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">{flash}</div>}
      {error ? <ErrorBox error={error} /> : !view ? <Spinner /> : (
        <div className="space-y-3">
          <Card className="py-2">
            <div className="flex items-baseline justify-between gap-2 pt-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Today · {shortDate(today)}</h2>
              <span className="text-[11px] font-semibold text-brand-800">{view.now.label}</span>
            </div>
            <ul className="mt-1 divide-y divide-slate-100">
              {view.status.map(({ unit, down }) => (
                <li key={unit.code} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{unit.label}{unit.essential ? <span className="ml-1.5 text-[11px] font-normal text-slate-500">unit runs only with it</span> : null}</span>
                    <span className="block text-[11px] text-slate-500">Panel {unit.panelMin} · Field {unit.fieldMin} per crew while running</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', down ? 'bg-status-red text-white' : 'bg-green-100 text-green-800')}>{down ? `Down to ${shortDate(down.end)}` : 'Running'}</span>
                    {head && <button type="button" className="text-xs font-medium text-brand-700" onClick={() => setSheet({ kind: 'unit', unit })}>Edit</button>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-slate-100 pt-2 text-sm font-semibold text-slate-800">Minimum per crew: {minimumsText(view.now)}</p>
          </Card>

          <Card className="py-2">
            <div className="flex items-baseline justify-between gap-2 pt-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sections down · next 12 months ({soon.length})</h2>
              <Link to="/calendar" className="text-xs font-medium text-brand-700">Calendar ›</Link>
            </div>
            {soon.length ? (
              <ul className="divide-y divide-slate-100">
                {soon.map(({ o, mode }) => (
                  <li key={o.id} className="py-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">{mode.label}{o.start <= today && <span className="rounded bg-brand-700 px-1.5 text-[10px] font-semibold leading-4 text-white">Now</span>}</span>
                    <span className="block text-xs text-slate-600">{rangeY(o.start, o.end, today)} · {o.title}</span>
                    <span className="block text-[11px] text-slate-500">{minimumsText(mode)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="py-2 text-sm text-slate-500">None. Add a shutdown or outage on the Calendar and choose the sections it takes down.</p>}
            {view.outages.length > soon.length && <p className="pb-1 text-[11px] text-slate-500">{view.outages.length - soon.length} later · see the 5-year plan below</p>}
          </Card>

          <Card className="p-0">
            <button type="button" onClick={() => setManual(!manual)} className="flex w-full items-center justify-between px-4 py-3 text-left">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual override · {view.live.length ? `${view.live.length} period${view.live.length === 1 ? '' : 's'}` : 'none'}</span>{manual ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
            </button>
            {manual && (
              <div className="px-4 pb-3">
                <p className="text-[11px] text-slate-500">For a case the unit status can't show (e.g. reduced rates): a mode with its own minimums on chosen dates, in place of the unit status.</p>
                {view.live.length ? <ul className="divide-y divide-slate-100">{view.live.map((p) => <PeriodRowView key={p.id} p={p} actions />)}</ul> : null}
                <Button variant="secondary" className="mt-2 min-h-10 w-full" disabled={!view.choosable.length} onClick={() => setSheet({ kind: 'period' })}><Plus className="h-4 w-4" /> Override period</Button>
                {!view.choosable.length && <p className="mt-1 text-[11px] text-slate-500">Add or switch on a mode first.</p>}
                <div className="mt-3 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Modes · min per crew</h3>
                  {head && <button type="button" className="text-xs font-medium text-brand-700" onClick={() => setSheet({ kind: 'mode', mode: null })}>+ New mode</button>}
                </div>
                <ul className="divide-y divide-slate-100">
                  {view.modes.map((m) => (
                    <li key={m.code} className={cx('flex items-start justify-between gap-3 py-2.5', !m.isActive && 'opacity-50')}>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900">{m.label}{m.isDefault ? <span className="ml-1.5 text-[11px] font-normal text-slate-500">base</span> : null}{!m.isActive ? <span className="ml-1.5 text-[11px] font-normal text-slate-500">switched off</span> : null}</span>
                        <span className="block text-xs text-slate-600">{m.isDefault && view.status.length ? `Controller ${m.controllerMin} · Panel Grade 14+ ${m.panelGrade14Min} · Panel and Field from the sections` : minimumsText(m)}</span>
                        {m.note && <span className="block text-[11px] text-slate-500">{m.note}</span>}
                      </span>
                      {head && <button type="button" className="shrink-0 text-xs font-medium text-brand-700" onClick={() => setSheet({ kind: 'mode', mode: m })}>Edit</button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <FiveYearPlan />

          <StatusHistory label={(code) => (view.plan.units ?? []).find((u) => u.code === code)?.label ?? code} mode={(code) => view.modeOf(code)?.label ?? code} />

          {view.past.length > 0 && (
            <Card className="p-0">
              <button type="button" onClick={() => setHistory(!history)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Past and cancelled periods ({view.past.length})</span>{history ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
              </button>
              {history && <ul className="divide-y divide-slate-100 px-4 pb-2">{view.past.map((p) => <PeriodRowView key={p.id} p={p} />)}</ul>}
            </Card>
          )}
        </div>
      )}
      {sheet?.kind === 'period' && view && <PeriodSheet modes={view.choosable} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === 'mode' && <ModeSheet mode={sheet.mode} fromSections={!!view?.status.length} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === 'unit' && <UnitSheet unit={sheet.unit} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === 'cancel' && view && <CancelSheet period={sheet.period} label={view.modeOf(sheet.period.mode_code)?.label ?? ''} onClose={() => setSheet(null)} onDone={done} />}
    </div>
  );
}

function UnitSheet({ unit, onClose }: { unit: UnitSection; onClose: () => void; onDone: (m: string) => void }) {
  return (
    <BottomSheet open onClose={onClose} title={unit.label}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Operators each crew needs for {unit.label} while it runs.</p>
        <p className="text-sm text-slate-800">Panel <b>{unit.panelMin}</b> · Field <b>{unit.fieldMin}</b> per crew</p>
        <RulesLink to={`/rules?group=crew`} />
        <Button variant="secondary" className="w-full" onClick={onClose}>Close</Button>
      </div>
    </BottomSheet>
  );
}

/** The minimums are organization rules now: changed on the Rules page, with a reason, kept in its history. */
function RulesLink({ to }: { to: string }) {
  return <Link to={to} className="flex min-h-10 items-center justify-between rounded-xl bg-brand-50 px-3 text-[12px] font-semibold text-brand-700">Change on the Rules page<span>›</span></Link>;
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

function ModeSheet({ mode, fromSections, onClose, onDone }: { mode: OperatingMode | null; fromSections: boolean; onClose: () => void; onDone: (m: string) => void }) {
  // the base mode: with unit sections, its Panel and Field come from the sections running
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
        {mode ? <>
          <p className="-mt-2 text-sm text-slate-800">{minimumsText({ controllerMin: mode.controllerMin, panelMin: mode.panelMin, panelGrade14Min: n.panelGrade14Min, fieldMin: mode.fieldMin })}</p>
          <RulesLink to="/rules?group=crew" />
          <div className="grid grid-cols-2 gap-3">{num('panelGrade14Min', 'of them Grade 14+', 10)}</div>
        </> : <div className="-mt-2 grid grid-cols-2 gap-3">{num('controllerMin', 'Controller', 5)}{num('panelMin', 'Panel', 10)}{num('panelGrade14Min', 'of them Grade 14+', 10)}{num('fieldMin', 'Field', 20)}</div>}
        <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {mode && !mode.isDefault && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Can be scheduled</label>}
        {mode?.isDefault && <p className="text-xs text-slate-500">{fromSections ? 'Applies while any unit section runs; Panel and Field are the sum of the sections running.' : 'Applies to every day without a period.'}</p>}
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
        <Field label="Reason" hint="The period is kept in the history as cancelled; those days go back to the unit status."><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Back</Button>
          <Button variant="danger" className="flex-1" disabled={busy || !reason.trim()} onClick={() => run(() => cancelPeriod(period.id, reason.trim()), 'Period cancelled. Those days follow the unit status again.')}>Cancel period</Button></div>
      </div>
    </BottomSheet>
  );
}

/** The unit status history (owner's notes): every change with its date and time, and the shutdown plan it belongs to. */
function StatusHistory({ label, mode }: { label: (code: string) => string; mode: (code: string) => string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<UnitStatusChange[] | null>(null); const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (!open || rows) return; fetchUnitStatusHistory().then(setRows).catch(setErr); }, [open, rows]);
  const at = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuwait' });
  const span = (a: string | null, b: string | null) => (a && b ? `${shortDate(a)} – ${shortDate(b)}` : '—');
  const what = (c: UnitStatusChange) => {
    if (c.action === 'insert') return `added · ${span(c.newStart, c.newEnd)}`;
    if (c.action === 'delete') return `removed · ${span(c.oldStart, c.oldEnd)}`;
    if (c.oldStatus !== c.newStatus && c.newStatus === 'cancelled') return `cancelled · ${span(c.oldStart, c.oldEnd)}`;
    if (c.oldStart !== c.newStart || c.oldEnd !== c.newEnd) return `dates ${span(c.oldStart, c.oldEnd)} → ${span(c.newStart, c.newEnd)}`;
    return `sections set · ${span(c.newStart, c.newEnd)}`;
  };
  const name = (c: UnitStatusChange) => (c.kind === 'mode' ? `Mode: ${mode(c.modeCode ?? '')}` : `${c.units.length ? c.units.map(label).join(' + ') : 'Unit'}${c.title ? ` · ${c.title}` : ''}`);
  return (
    <Card className="p-0">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unit status history{rows ? ` (${rows.length})` : ''}</span>{open ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
      </button>
      {open && (err != null ? <div className="px-4 pb-3"><ErrorBox error={err} /></div> : !rows ? <div className="pb-3"><Spinner /></div>
        : !rows.length ? <p className="px-4 pb-3 text-sm text-slate-500">No change recorded yet.</p>
        : <ul className="divide-y divide-slate-100 px-4 pb-2">{rows.map((c, i) => (
          <li key={`${c.at}-${i}`} className="flex items-start gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-slate-800">{name(c)}</span>
              <span className={cx('block text-[12px] tabular-nums', c.newStatus === 'cancelled' && c.oldStatus !== 'cancelled' ? 'text-status-red' : 'text-slate-600')}>{what(c)}</span>
              <span className="block text-[11px] tabular-nums text-slate-500">{at(c.at)}</span>
            </span>
            {c.planId && <Link to={`/shutdown/${c.planId}`} className="shrink-0 rounded-lg bg-brand-50 px-2 py-1 text-[12px] font-semibold text-brand-700">{c.planTitle ?? 'Plan'} ›</Link>}
          </li>))}</ul>)}
    </Card>
  );
}

/** The five-year shutdown plan (memo O-TS(MAB)-OP-26-0347, owner 28 Oct 2026): one strip per fiscal year (Apr–Mar),
 *  Train-1 and Train-2 lanes, a whole-unit shutdown across both; tentative ones lighter. Tap a year for its list. */
function FiveYearPlan() {
  const [rows, setRows] = useState<UnitEvent[] | null>(null); const [err, setErr] = useState<unknown>(null); const [openFy, setOpenFy] = useState<number | null>(null);
  useEffect(() => { const t = localToday(); fetchShutdownOutlook(`${Number(t.slice(0, 4)) - 1}-04-01`).then(setRows).catch(setErr); }, []);
  if (err) return <ErrorBox error={err} />;
  if (!rows) return null;
  const today = localToday(); const y0 = Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const last = rows.reduce((m, e) => Math.max(m, Number(e.end.slice(5, 7)) >= 4 ? Number(e.end.slice(0, 4)) : Number(e.end.slice(0, 4)) - 1), y0);
  const fys = Array.from({ length: Math.min(last, y0 + 6) - y0 + 1 }, (_, i) => y0 + i);
  const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const MON = ['A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D', 'J', 'F', 'M'];
  const fmt = (d: string) => shortDate(d);
  const lane = (e: UnitEvent) => (e.unitCodes.includes('train_1') && e.unitCodes.includes('train_2') ? 'both' : e.unitCodes.includes('train_1') ? 't1' : e.unitCodes.includes('train_2') ? 't2' : 'both');
  return (
    <Card className="p-0">
      <div className="flex items-baseline justify-between px-4 pt-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">5-year shutdown plan</span>
        <span className="whitespace-nowrap text-[11px] text-slate-500">Memo 26-0347</span>
      </div>
      <div className="space-y-2 px-4 pb-3 pt-2">
        <div className="ml-14 grid grid-cols-12 text-center text-[9px] font-semibold text-slate-400">{MON.map((m, i) => <span key={i}>{m}</span>)}</div>
        {fys.map((fy) => {
          const a = ms(`${fy}-04-01`), b = ms(`${fy + 1}-04-01`), span = b - a;
          const evs = rows.filter((e) => ms(e.end) >= a && ms(e.start) < b);
          const pos = (e: UnitEvent) => { const s0 = Math.max(ms(e.start), a), e0 = Math.min(ms(e.end) + 864e5, b); return { left: `${((s0 - a) / span) * 100}%`, width: `${Math.max(((e0 - s0) / span) * 100, 1.2)}%` }; };
          const nowX = ms(today) >= a && ms(today) < b ? `${((ms(today) - a) / span) * 100}%` : null;
          return (
            <div key={fy}>
              <button type="button" onClick={() => setOpenFy((x) => (x === fy ? null : fy))} className="flex w-full items-center gap-2 text-left">
                <span className="w-12 shrink-0 text-[11px] font-bold tabular-nums text-slate-700">FY{String(fy).slice(2)}/{String(fy + 1).slice(2)}</span>
                <span className="relative block h-7 flex-1 rounded-md bg-[repeating-linear-gradient(90deg,#f1f5f9_0,#f1f5f9_calc(8.333%-1px),#e2e8f0_calc(8.333%-1px),#e2e8f0_8.333%)]">
                  {evs.map((e) => { const l = lane(e); return <span key={e.id} title={`${e.unit ?? ''} ${e.title} · ${fmt(e.start)} – ${fmt(e.end)}`}
                    className={cx('absolute rounded', l === 'both' ? 'top-0.5 h-6 bg-red-500' : l === 't1' ? 'top-0.5 h-2.5 bg-sky-600' : 'top-[15px] h-2.5 bg-amber-500', e.tentative && 'opacity-60')} style={pos(e)} />; })}
                  {nowX && <span className="absolute -top-0.5 bottom-[-2px] w-0.5 bg-brand-800" style={{ left: nowX }} />}
                </span>
              </button>
              {openFy === fy && <ul className="ml-14 mt-1 space-y-0.5 text-[12px]">
                {evs.length ? evs.map((e) => <li key={e.id} className="text-slate-700"><b>{e.unit ?? 'Unit'}</b> · {e.title} · <span className="tabular-nums">{fmt(e.start)} – {fmt(e.end)}</span>{e.tentative ? <span className="text-slate-500"> · tentative</span> : ''}</li>) : <li className="text-slate-500">No shutdown planned.</li>}
              </ul>}
            </div>
          );
        })}
        <p className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-slate-500">
          <span><i className="mr-1 inline-block h-2 w-3 rounded bg-sky-600 align-middle" />Train-1</span>
          <span><i className="mr-1 inline-block h-2 w-3 rounded bg-amber-500 align-middle" />Train-2</span>
          <span><i className="mr-1 inline-block h-2 w-3 rounded bg-red-500 align-middle" />Whole unit</span>
          <span>Lighter: tentative · tap a year for dates</span>
        </p>
      </div>
    </Card>
  );
}
