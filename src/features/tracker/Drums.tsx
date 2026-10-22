// Progress engine, phase 2: the reactor drum account on the equipment sheet, and the quick equipment update (no
// change · delay). One shift entry per method; a second person verifies; a mistake is corrected by a new entry; the
// Section Head revises the estimate (with a reason) and confirms the vessel empty. Planned % and the forecast are
// provisional and say so.
import { useState } from 'react';
import { METHOD_LABEL, kwDay, kwTime, plannedPct, qtyForecast, qtyProgress, recentShifts, variancePts, type QtyMethod, type TrkActivity, type TrkQtyEntry, type TrkQtyEstimate, type TrkQtyScope, type TrkSettings, type TrkUpdate } from '@/core/tracker';
import { addQtyEntry, addUpdate, confirmEmpty, reviseEstimate, setActivity, verifyQtyEntry } from '@/data/tracker';
import { ErrorBox, cx } from '@/ui/components';
import { RowBtn } from './ui';

const when = (iso: string | null) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '');
const fmt = (n: number) => n.toLocaleString('en-US');
const dayLabel = (d: string, s: 'D' | 'N') => `${kwDay(`${d}T12:00:00+03:00`)} ${s === 'D' ? 'day' : 'night'}`;
const METHODS: QtyMethod[] = ['vacuum', 'free_fall', 'cone', 'other'];

function useRun(onDone: (msg: string, undo?: () => Promise<unknown>) => void) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const run = async (f: () => Promise<void>, msg: string, after?: () => void) => { setBusy(true); setErr(null); try { await f(); after?.(); onDone(msg); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return { busy, err, run };
}

export function DrumPanel({ scope, entries, estimates, activities, settings, now, canEdit, isHead, me, onDone }: {
  scope: TrkQtyScope; entries: TrkQtyEntry[]; estimates: TrkQtyEstimate[]; activities: TrkActivity[]; settings: TrkSettings; now: number; canEdit: boolean; isHead: boolean; me: string | null; onDone: (msg: string, undo?: () => Promise<unknown>) => void;
}) {
  const { busy, err, run } = useRun(onDone);
  const [fix, setFix] = useState<string | null>(null); const [fixQty, setFixQty] = useState(''); const [fixWhy, setFixWhy] = useState('');
  const [est, setEst] = useState(false); const [estV, setEstV] = useState(''); const [estWhy, setEstWhy] = useState('');
  const [empty, setEmpty] = useState(false); const [all, setAll] = useState(false);

  const p = qtyProgress({ working: scope.working, initial: scope.initial, completeAt: scope.completeAt }, entries);
  const lines = activities.filter((a) => scope.activityIds.includes(a.activityId) && a.start && a.finish).map((a) => ({ start: a.start!, finish: a.finish! }));
  const planned = plannedPct(lines, now);
  const variance = variancePts(p.actualPct, planned);
  const fc = scope.completeAt ? null : qtyForecast(entries, p.remaining, now, { window: settings.fcWindow, min: settings.fcMin });
  const planEnd = lines.length ? Math.max(...lines.map((l) => Date.parse(l.finish))) : null;
  const shown = [...entries].reverse();
  // the dumping lines of this account: drums are entered once dumping has started; "vessel empty" finishes the running ones
  const acts = activities.filter((a) => a.key === scope.key && scope.activityIds.includes(a.activityId));
  const started = acts.some((a) => a.actualStart) || entries.length > 0;
  const toStart = acts.find((a) => !a.actualStart);
  const running = acts.filter((a) => a.actualStart && !a.actualFinish);
  const closeOut = async () => { await confirmEmpty(scope.id); const at = new Date().toISOString(); for (const a of running) await setActivity(a.id, { actual_finish: at }); };

  return (
    <section className="space-y-2 rounded-xl bg-white p-2.5 ring-1 ring-amber-300" aria-label="Catalyst removal">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Catalyst removal · drums</h3>
        {scope.completeAt ? <span className="rounded bg-green-100 px-1.5 text-[11px] font-bold text-green-800">✓ Empty {when(scope.completeAt)}</span>
          : p.awaitingEmpty ? <span className="rounded bg-amber-100 px-1.5 text-[11px] font-bold text-amber-900">Awaiting "vessel empty"</span> : null}
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-lg bg-slate-50 py-1.5"><b className="block text-lg tabular-nums">{fmt(p.verified)}</b><span className="text-[10.5px] text-slate-500">of {scope.working ? fmt(scope.working) : '—'} drums</span></div>
        <div className="rounded-lg bg-slate-50 py-1.5"><b className="block text-lg tabular-nums">{p.actualPct === null ? '—' : `${p.actualPct}%`}</b><span className="text-[10.5px] text-slate-500">plan {planned === null ? '—' : `${planned}%`}*</span></div>
        <div className="rounded-lg bg-slate-50 py-1.5"><b className={cx('block text-lg tabular-nums', variance !== null && variance < 0 ? 'text-[#E02028]' : 'text-slate-900')}>{variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance}`}</b><span className="text-[10.5px] text-slate-500">pts vs plan</span></div>
      </div>
      <div className="space-y-0.5 text-[12px] text-slate-700">
        <p>Remaining <b>{p.remaining === null ? '—' : fmt(p.remaining)}</b> drums{p.pending ? <> · <span className="text-amber-800">{fmt(p.pending)} awaiting verification</span></> : null}</p>
        <p>Estimate {scope.working ? fmt(scope.working) : '—'}{scope.low && scope.high ? ` (range ${fmt(scope.low)}–${fmt(scope.high)})` : ''}{scope.initial && scope.initial !== scope.working ? ` · first estimate ${fmt(scope.initial)}` : ''}{estimates.length > 1 ? ` · revised ${estimates.length - 1}×` : ''}</p>
        {planEnd && <p>Plan finish {when(new Date(planEnd).toISOString())}</p>}
        {fc && (fc.status === 'ok'
          ? <p>Forecast* <b>{when(new Date(fc.finish).toISOString())}</b> · {fmt(fc.ratePerShift)} drums/shift over {fc.shifts} {METHOD_LABEL[fc.method].toLowerCase()} shifts{fc.availability < 1 ? ` · ${Math.round(fc.availability * 100)}% of shifts productive` : ''}</p>
          : <p className="text-slate-500">Forecast unavailable: {fc.reason}.</p>)}
        <p className="text-[10.5px] text-slate-400">* Provisional: planned % is a straight line over the baseline dumping dates (no production targets yet); the forecast uses verified shifts only.</p>
      </div>

      {canEdit && !scope.completeAt && !started && toStart && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-[12px] text-amber-900">
          <span className="min-w-0 flex-1">Dumping not started. Start it to enter the drums.</span>
          <RowBtn tone="navy" disabled={busy} onClick={() => run(() => setActivity(toStart.id, { actual_start: new Date().toISOString() }), `${scope.key}: ${toStart.activity} started.`)}>▶ Start dumping</RowBtn>
        </div>
      )}
      {canEdit && !scope.completeAt && started && <DrumEntry scope={scope} entries={entries} now={now} onDone={onDone} />}

      {shown.length > 0 && <div className="space-y-1">
        {(all ? shown : shown.slice(0, 4)).map((e) => { const mine = !!me && e.enteredBy === me;
          return (
            <div key={e.id} className={cx('rounded-lg px-2 py-1.5 text-[12px] ring-1', e.verify === 'rejected' ? 'bg-slate-50 text-slate-400 ring-slate-200 line-through' : 'bg-white ring-slate-200')}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1"><b className="tabular-nums">{e.qty > 0 && e.kind === 'correction' ? '+' : ''}{fmt(e.qty)}</b> {e.kind === 'removal' ? '' : e.kind === 'transfer' ? 'transfer · ' : 'correction · '}{METHOD_LABEL[e.method].toLowerCase()} · {dayLabel(e.shiftDate, e.shift)}
                  <span className="block text-[11px] text-slate-500">{e.stoppage ? `Stopped: ${e.stoppage} · ` : ''}{e.remark ? `${e.remark} · ` : ''}by {e.enteredByName ?? '—'}{e.verify !== 'pending' ? ` · ${e.verify} by ${e.verifiedByName ?? '—'}` : ''}</span></span>
                {e.verify === 'pending' ? (canEdit && (!mine || isHead)
                  ? <span className="flex shrink-0 gap-1"><RowBtn tone="green" disabled={busy} onClick={() => run(() => verifyQtyEntry(e.id, 'verified'), `${fmt(e.qty)} drums verified.`)}>Verify</RowBtn><RowBtn tone="ghost" disabled={busy} onClick={() => run(() => verifyQtyEntry(e.id, 'rejected'), 'Entry rejected.')}>✕</RowBtn></span>
                  : <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[10.5px] font-bold text-amber-900">{mine ? 'awaiting a 2nd person' : 'pending'}</span>)
                  : e.verify === 'verified' && canEdit && e.kind !== 'correction' && !scope.completeAt ? <button type="button" className="shrink-0 text-[11px] font-semibold text-[#0850A0]" onClick={() => { setFix(fix === e.id ? null : e.id); setFixQty(''); setFixWhy(''); }}>Correct</button> : null}
              </div>
              {fix === e.id && <div className="mt-1.5 grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-1.5">
                <input className="input" inputMode="numeric" aria-label="Correction (+/−)" placeholder="−10" value={fixQty} onChange={(x) => setFixQty(x.target.value.replace(/[^0-9-]/g, ''))} />
                <input className="input" aria-label="Why" placeholder="Why (recount…)" value={fixWhy} onChange={(x) => setFixWhy(x.target.value)} />
                <RowBtn tone="navy" disabled={busy || !Number(fixQty) || !fixWhy.trim()} onClick={() => run(() => addQtyEntry(scope.id, { shiftDate: e.shiftDate, shift: e.shift, kind: 'correction', method: e.method, qty: Number(fixQty), remark: fixWhy, corrects: e.id }), 'Correction entered (awaiting verification).', () => setFix(null))}>Save</RowBtn>
              </div>}
            </div>); })}
        {shown.length > 4 && <button type="button" onClick={() => setAll((x) => !x)} className="text-[11.5px] font-semibold text-slate-500">{all ? 'Show less' : `All ${shown.length} entries`}</button>}
      </div>}

      {isHead && !scope.completeAt && <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
        <button type="button" className="text-[11.5px] font-semibold text-[#0850A0]" onClick={() => setEst((x) => !x)}>Revise estimate</button>
        <span className="text-slate-300">·</span>
        <button type="button" className="text-[11.5px] font-semibold text-[#08A048]" onClick={() => setEmpty((x) => !x)}>Confirm vessel empty</button>
      </div>}
      {est && <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-1.5">
        <input className="input" inputMode="numeric" aria-label="New estimate" placeholder={scope.working ? String(scope.working) : 'Drums'} value={estV} onChange={(x) => setEstV(x.target.value.replace(/[^0-9]/g, ''))} />
        <input className="input" aria-label="Reason" placeholder="Reason (plant information)" value={estWhy} onChange={(x) => setEstWhy(x.target.value)} />
        <RowBtn tone="navy" disabled={busy || !Number(estV) || !estWhy.trim()} onClick={() => run(() => reviseEstimate(scope.id, Number(estV), estWhy), `Estimate revised to ${fmt(Number(estV))} drums.`, () => setEst(false))}>Save</RowBtn>
      </div>}
      {empty && <div className="rounded-lg bg-green-50 p-2 text-xs text-green-900">Confirm that {scope.key} is physically empty? The recorded drums stay as they are; this closes the removal at 100%{running.length ? `, finishes ${running.map((a) => a.activity).join(' and ')} now` : ''} and cannot be undone.
        <div className="mt-1.5 flex gap-1.5"><RowBtn tone="green" disabled={busy} onClick={() => run(closeOut, `${scope.key} confirmed empty${running.length ? ', dumping finished' : ''}.`, () => setEmpty(false))}>Confirm empty</RowBtn><RowBtn tone="ghost" onClick={() => setEmpty(false)}>Cancel</RowBtn></div></div>}
      {err != null && <ErrorBox error={err} />}
    </section>
  );
}

/** The shift's drum entry, two ways: the drums dumped this shift, or the total dumped so far (the shift's drums are
 *  the difference from what is already recorded). One entry per shift and method; a second person verifies it. */
export function DrumEntry({ scope, entries, now, onDone, autoFocus = false }: { scope: TrkQtyScope; entries: TrkQtyEntry[]; now: number; onDone: (msg: string, undo?: () => Promise<unknown>) => void; autoFocus?: boolean }) {
  const { busy, err, run } = useRun(onDone);
  const shifts = recentShifts(now);
  const lastMethod = [...entries].reverse().find((e) => e.kind === 'removal')?.method ?? (scope.key === 'R-12-205' ? 'vacuum' : 'free_fall');
  const [sh, setSh] = useState(0); const [method, setMethod] = useState<QtyMethod>(lastMethod);
  const [mode, setMode] = useState<'shift' | 'total'>('shift');
  const [qty, setQty] = useState(''); const [stop, setStop] = useState(''); const [remark, setRemark] = useState(''); const [transfer, setTransfer] = useState(false);
  // recorded so far: every counting entry not rejected (verified and awaiting verification)
  const recorded = entries.filter((e) => e.kind !== 'transfer' && e.verify !== 'rejected').reduce((t, e) => t + e.qty, 0);
  const typed = Number(qty);
  const n = mode === 'total' ? typed - recorded : typed;
  const zero = qty !== '' && n === 0;
  const valid = qty.trim() !== '' && Number.isFinite(n) && n >= 0 && (n > 0 || stop.trim() !== '');
  const save = () => { const s = shifts[sh]; const tr = mode === 'shift' && transfer;
    const note = [mode === 'total' ? `total reported ${fmt(typed)}` : '', remark, tr ? 'transfer of drums already counted' : ''].filter(Boolean).join(' · ') || null;
    run(() => addQtyEntry(scope.id, { shiftDate: s.date, shift: s.shift, kind: tr ? 'transfer' : 'removal', method, qty: n, stoppage: n === 0 ? stop : null, remark: note }),
      `${scope.key}: ${fmt(n)} drums ${tr ? 'transfer ' : ''}entered for ${dayLabel(s.date, s.shift)}${mode === 'total' ? ` (total ${fmt(typed)})` : ''}, awaiting verification.`,
      () => { setQty(''); setStop(''); setRemark(''); setTransfer(false); }); };
  return (
    <div className="space-y-1.5 rounded-lg bg-amber-50 p-2">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/70 p-0.5">{([['shift', 'Drums this shift'], ['total', 'Total so far']] as const).map(([k, l]) =>
        <button key={k} type="button" onClick={() => { setMode(k); setQty(''); }} className={cx('min-h-9 rounded-md text-xs font-semibold', mode === k ? 'bg-[#0d2a5e] text-white' : 'text-slate-700')}>{l}</button>)}</div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <input className="input text-lg font-semibold tabular-nums" inputMode="numeric" enterKeyHint="done" autoFocus={autoFocus} aria-label={mode === 'total' ? 'Total drums so far' : 'Drums this shift'} placeholder={mode === 'total' ? `Total (≥ ${fmt(recorded)})` : 'Drums'} value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))} />
        <RowBtn tone="navy" disabled={busy || !valid} onClick={save}>Save drums{qty && valid ? ` · ${fmt(n)}` : ''}</RowBtn>
      </div>
      {mode === 'total' && <p className={cx('text-[11.5px]', qty && n < 0 ? 'font-semibold text-red-700' : 'text-slate-600')}>Recorded so far {fmt(recorded)}{qty ? (n < 0 ? ' · the total cannot be less than that (use Correct on an entry)' : ` · this shift = ${fmt(n)} drums`) : ''}</p>}
      <input className="input" aria-label="Remark" placeholder={zero ? 'Why 0? (stoppage)' : 'Remark (optional)'} value={zero ? stop : remark} onChange={(e) => (zero ? setStop(e.target.value) : setRemark(e.target.value))} />
      <div className="flex flex-wrap gap-1">{shifts.map((s, i) => <button key={i} type="button" onClick={() => setSh(i)} className={cx('min-h-9 rounded-full px-2.5 text-xs font-semibold', sh === i ? 'bg-[#0d2a5e] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{dayLabel(s.date, s.shift)}</button>)}</div>
      <div className="flex flex-wrap gap-1">{METHODS.map((m) => <button key={m} type="button" onClick={() => setMethod(m)} className={cx('min-h-9 rounded-full px-2.5 text-xs font-semibold', method === m ? 'bg-[#0850A0] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{METHOD_LABEL[m]}</button>)}</div>
      {mode === 'shift' && <label className="flex items-center gap-1.5 text-[11.5px] text-slate-600"><input type="checkbox" checked={transfer} onChange={(e) => setTransfer(e.target.checked)} /> Transfer of drums already counted (does not add)</label>}
      {err != null && <ErrorBox error={err} />}
    </div>
  );
}

/** The drums of a reactor in one sheet, from the equipment list: progress and the shift entry, nothing else. */
export function DrumQuick({ scope, entries, now, canEdit, onOpen, onDone }: { scope: TrkQtyScope; entries: TrkQtyEntry[]; now: number; canEdit: boolean; onOpen: () => void; onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  const p = qtyProgress({ working: scope.working, initial: scope.initial, completeAt: scope.completeAt }, entries);
  const last = [...entries].reverse().find((e) => e.kind !== 'transfer' && e.verify !== 'rejected');
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-slate-800"><b className="tabular-nums">{fmt(p.verified)}</b> of {scope.working ? fmt(scope.working) : '—'} drums verified{p.actualPct !== null ? ` · ${p.actualPct}%` : ''}{p.pending ? <span className="text-amber-800"> · {fmt(p.pending)} awaiting verification</span> : null}</p>
      {last && <p className="text-[11.5px] text-slate-500">Last entry: {fmt(last.qty)} · {dayLabel(last.shiftDate, last.shift)} · {METHOD_LABEL[last.method].toLowerCase()} · {last.verify}</p>}
      {canEdit && !scope.completeAt && <DrumEntry scope={scope} entries={entries} now={now} onDone={onDone} />}
      <button type="button" onClick={onOpen} className="text-xs font-semibold text-[#0850A0]">Open {scope.key} (verify, correct, vessel empty) ›</button>
    </div>
  );
}

/** The quick update of any item: nothing changed this shift, or a delay with its reason and the new expected date. */
export function ItemUpdate({ trackerId, itemKey, updates, canEdit, onDone }: { trackerId: string; itemKey: string; updates: TrkUpdate[]; canEdit: boolean; onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  const { busy, err, run } = useRun(onDone);
  const [delay, setDelay] = useState(false); const [why, setWhy] = useState(''); const [exp, setExp] = useState('');
  const last = updates.find((u) => u.key === itemKey && (u.kind === 'no_change' || u.kind === 'delay'));
  if (!canEdit && !last) return null;
  return (
    <div className="space-y-1.5 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="min-w-0 flex-1 text-[11.5px] text-slate-600">{last ? <>Last update: <b>{last.kind === 'delay' ? 'delay' : 'no change'}</b>{last.reason ? ` · ${last.reason}` : ''}{last.expectedFinish ? ` · expected ${when(last.expectedFinish)}` : ''} · {last.byName ?? '—'} {when(last.at)}</> : 'No shift update yet.'}</span>
        {canEdit && <><RowBtn tone="ghost" disabled={busy} onClick={() => run(() => addUpdate(trackerId, { key: itemKey, kind: 'no_change' }), `${itemKey}: no change this shift.`)}>No change</RowBtn>
          <RowBtn tone="ghost" disabled={busy} onClick={() => setDelay((x) => !x)}>Delay…</RowBtn></>}
      </div>
      {delay && <div className="flex flex-wrap gap-1.5">
        <input className="input min-w-0 flex-1" aria-label="Delay reason" placeholder="Reason for the delay" value={why} onChange={(e) => setWhy(e.target.value)} />
        <input className="input w-44" type="datetime-local" aria-label="New expected finish" value={exp} onChange={(e) => setExp(e.target.value)} />
        <RowBtn tone="navy" disabled={busy || !why.trim()} onClick={() => run(() => addUpdate(trackerId, { key: itemKey, kind: 'delay', reason: why, expectedFinish: exp ? new Date(`${exp}:00+03:00`).toISOString() : null }), `${itemKey}: delay recorded.`, () => { setDelay(false); setWhy(''); setExp(''); })}>Save</RowBtn>
      </div>}
      {err != null && <ErrorBox error={err} />}
    </div>
  );
}
