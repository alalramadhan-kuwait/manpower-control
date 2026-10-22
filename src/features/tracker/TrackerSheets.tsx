// The two input sheets of the controllers: a guideline step (Start · Done · Pending) and an equipment item (stage,
// blinded = handed over, IATs, pending). Big buttons, the time and the name are stamped by the database.
import { useState } from 'react';
import { connectionsOf, iatsOf, type LuEquip, type LuStream, type TrkIat, PENDING_REASONS, neutLabel, neutName, partsOf, waitingSteps, isoState, missingBlinds, STAGES, kwDay, kwTime, pointComplete, stepTiming, type EquipView, type Isolation, type StepView, type TrkActivity, type TrkPoint, type TrkEngine, type TrkSettings } from '@/core/tracker';
import { EquipActivities, StepTimes } from './Timing';
import { DrumPanel, ItemUpdate } from './Drums';
import { addIat, closeIat, setEquipment, setStep } from '@/data/tracker';
import { BottomSheet, Button, ErrorBox, Field, cx } from '@/ui/components';
import { FlagChip, IsoChip, PlanChip, StageBar, StateChip } from './ui';
import { IatDetail, OpsTicks } from './Iats';

const when = (iso: string | null) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '');

export function PendingForm({ initial, onSave, busy }: { initial: string | null; onSave: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState(PENDING_REASONS.find((r) => initial?.startsWith(r)) ?? '');
  const [note, setNote] = useState(initial && !PENDING_REASONS.some((r) => initial === r) ? initial.replace(/^[^–]*–\s*/, '') : '');
  return (
    <div className="space-y-2 rounded-xl bg-red-50 p-2.5 ring-1 ring-red-200">
      <div className="flex flex-wrap gap-1.5">{PENDING_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={cx('rounded-full px-2.5 py-1 text-xs ring-1', reason === r ? 'bg-[#E02028] text-white ring-[#E02028]' : 'bg-white text-slate-700 ring-slate-300')}>{r}</button>)}</div>
      <input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button className="w-full" disabled={!reason || busy} onClick={() => onSave(note.trim() ? `${reason} – ${note.trim()}` : reason)}>Hold</Button>
    </div>
  );
}

export function StepSheet({ v, isHead, canEdit, points = [], items = [], onIsolation, onClose, onDone }: { v: StepView; isHead: boolean; canEdit: boolean; points?: TrkPoint[]; items?: EquipView[]; onIsolation?: () => void; onClose: () => void; onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  const s = v.step;
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [pending, setPending] = useState(false); const [blocked, setBlocked] = useState(false); const [details, setDetails] = useState(false);
  async function run(patch: Parameters<typeof setStep>[1], msg: string) {
    setBusy(true); setErr(null);
    try { await setStep(s.id, patch); onDone(msg); } catch (e) { setErr(e); setBusy(false); }
  }
  const done = () => { if (v.state === 'WAITING' && !blocked) { setBlocked(true); return; } run({ status: 'done', pending_reason: null }, `${s.stepId} done.`); };
  return (
    <BottomSheet open onClose={onClose} title={`${s.stepId} · ${s.shortName}`}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600"><StateChip state={v.state} late={v.late} />{s.fo} · Gate {s.gate} {s.gateName}{s.updatedAt ? <span>· {s.updatedBy} {when(s.updatedAt)}</span> : null}</div>
        {v.waitingFor.length > 0 && <p className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm text-slate-700">Waiting for <b>{v.waitingFor.join(', ')}</b></p>}
        {s.pendingReason && <p className="rounded-lg bg-[#FFC7CE] px-2.5 py-1.5 text-sm text-red-900">⏸ {s.pendingReason}</p>}
        {(s.text || s.procedure) && <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-sm text-slate-800">{s.text}{s.procedure && <span className="mt-0.5 block text-xs font-semibold text-[#004080]">{s.procedure}</span>}</div>}
        {points.length > 0 && (
          <div className="space-y-1.5 rounded-xl bg-[#D6E6F5]/40 p-2.5 ring-1 ring-[#0850A0]/30">
            <p className="text-sm text-slate-800">Ticks itself from the <b>Isolation</b> page · {points.filter(pointComplete).length}/{points.length} done</p>
            <div className="flex flex-wrap gap-1">{points.map((p) => <span key={p.id} className={cx('rounded px-1.5 py-0.5 text-[11px] font-semibold', pointComplete(p) ? 'bg-[#C6EFCE] text-green-900' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{pointComplete(p) ? '✓ ' : ''}{p.kind === 'blind' ? p.ref : `${p.ref} ${neutLabel(p).toLowerCase()}`}</span>)}</div>
            {onIsolation && <Button variant="secondary" className="w-full" onClick={onIsolation}>Open on Isolation</Button>}
          </div>
        )}
        {items.length > 0 && <p className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">Ticks itself when its items are handed over: {items.map((e) => `${e.stage >= 1 ? '✓ ' : ''}${e.eq.tag}`).join(' · ')}</p>}
        {canEdit && !points.length && (
          <div className="grid grid-cols-3 gap-2">
            <button type="button" disabled={busy || v.state === 'IN_PROGRESS'} onClick={() => run({ status: 'in_progress', pending_reason: null }, `${s.stepId} started.`)} className="flex min-h-16 flex-col items-center justify-center rounded-xl bg-[#D6E6F5] text-[#004080] disabled:opacity-40"><span className="text-xl">▶</span><span className="text-sm font-semibold">Start</span></button>
            <button type="button" disabled={busy || v.state === 'DONE'} onClick={done} className="flex min-h-16 flex-col items-center justify-center rounded-xl bg-[#C6EFCE] text-green-900 disabled:opacity-40"><span className="text-xl">✓</span><span className="text-sm font-semibold">Done</span></button>
            <button type="button" disabled={busy} onClick={() => setPending((x) => !x)} className="flex min-h-16 flex-col items-center justify-center rounded-xl bg-[#FFC7CE] text-red-900 disabled:opacity-40"><span className="text-xl">⏸</span><span className="text-sm font-semibold">Pending</span></button>
          </div>
        )}
        {blocked && (
          <div className="rounded-xl bg-amber-50 p-2.5 text-sm text-amber-950 ring-1 ring-amber-200">
            Needs <b>{v.waitingFor.join(', ')}</b> first.
            {isHead ? <Button variant="secondary" className="mt-2 w-full" disabled={busy} onClick={() => run({ status: 'done', pending_reason: null }, `${s.stepId} done (override).`)}>Override: mark done</Button>
              : <span className="block text-xs">Only the Section Head can override.</span>}
          </div>
        )}
        {pending && <PendingForm initial={s.pendingReason} busy={busy} onSave={(r) => run({ status: 'pending', pending_reason: r }, `${s.stepId} pending.`)} />}
        <StepTimes t={stepTiming(s, Date.now())} canEdit={canEdit} isHead={isHead} onDone={onDone} />
        {canEdit && (v.state === 'DONE' || v.state === 'PENDING' || v.state === 'NA') && (
          <button type="button" className="text-xs font-semibold text-brand-700 underline" disabled={busy} onClick={() => run({ status: 'not_started', pending_reason: null }, `${s.stepId} reopened.`)}>Reopen (not started)</button>
        )}
        {canEdit && v.state !== 'NA' && v.state !== 'DONE' && <button type="button" className="ml-4 text-xs font-semibold text-slate-500 underline" disabled={busy} onClick={() => run({ status: 'na', pending_reason: null }, `${s.stepId} N/A.`)}>Not applicable</button>}
        {err != null && <ErrorBox error={err} />}
        <button type="button" onClick={() => setDetails((x) => !x)} className="text-xs font-semibold text-slate-600">{details ? '▾' : '▸'} Details</button>
        {details && (
          <dl className="space-y-1 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700">
            {s.text && <div><dt className="font-semibold">Step</dt><dd>{s.text}</dd></div>}
            {s.procedure && <div><dt className="font-semibold">Procedure</dt><dd>{s.procedure}</dd></div>}
            <div><dt className="font-semibold">Pre-requisites</dt><dd>{s.prereq.length ? s.prereq.join(', ') : 'None'}</dd></div>
            {s.estHours ? <div><dt className="font-semibold">Estimated</dt><dd>{s.estHours} h</dd></div> : null}
            {s.note && <div><dt className="font-semibold">Note</dt><dd>{s.note}</dd></div>}
            {s.remark && <div><dt className="font-semibold">Remark</dt><dd>{s.remark}</dd></div>}
          </dl>
        )}
      </div>
    </BottomSheet>
  );
}

// a spray that waits for work steps, in a few words (the reactor body spray waits for the catalyst dumping)
const waitAfter = (steps: string[]) => (!steps.length ? [] : [steps.every((x) => /dump/i.test(x)) ? 'after dumping' : steps.length === 1 ? `after ${steps[0]}` : `after ${steps.length} steps`]);

export function EquipSheet({ allIats = [], lineup = [], lineupEq = [], tags = [], v, trackerId, canEdit, isHead, activities, now, iso = null, points = [], engine, settings = {}, me = null, twins = [], onTwin, onIsolation, onNeut, onClose, onDone }: { allIats?: TrkIat[]; lineup?: LuStream[]; lineupEq?: LuEquip[]; tags?: string[]; twins?: string[]; onTwin?: (tag: string) => void; v: EquipView; trackerId: string; canEdit: boolean; isHead: boolean; activities: TrkActivity[]; now: number; iso?: Isolation | null; points?: TrkPoint[]; engine?: TrkEngine; settings?: TrkSettings; me?: string | null; onIsolation?: () => void; onNeut?: () => void; onClose: () => void; onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  // the neutralization the soda-ash lines stand for: the item's own soda ash first, else its loop
  // the item's bar-chart steps by stage (what moves the stage), the field-detail steps left out
  const stageLines = activities.filter((a) => a.tracked && !a.detail && a.group !== 'Operations' && a.stage !== null);
  const soda = iso?.neut.find((p) => !p.stepId && p.method !== 'spray') ?? iso?.neut.find((p) => p.method !== 'spray');
  // a reactor's lines and the piping between the reactors: neutralized on their own, shown with it
  const parts = partsOf(v.eq.tag, points);
  const e = v.eq;
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [pending, setPending] = useState(false); const [iat, setIat] = useState(false); const [details, setDetails] = useState(false); const [fixStage, setFixStage] = useState(false);
  const [iatNo, setIatNo] = useState(''); const [job, setJob] = useState(''); const [disc, setDisc] = useState('');
  async function run(f: () => Promise<void>, msg: string, undo?: () => Promise<unknown>) { setBusy(true); setErr(null); try { await f(); setPending(false); setIat(false); setIatNo(''); setJob(''); setDisc(''); onDone(msg, undo); } catch (x) { setErr(x); } finally { setBusy(false); } }
  // its IATs: its own and those on a line to or from it (P&ID lineup)
  const rel = iatsOf(e.tag, allIats.length ? allIats : v.iatsOpen, lineup);
  const [iatOpen, setIatOpen] = useState<TrkIat | null>(null);
  return (
    <BottomSheet open onClose={onClose} title={e.tag}>
      <div className="space-y-3">
        {twins.length > 1 && <div className="flex gap-1">{twins.map((t) => <button key={t} type="button" onClick={() => t !== e.tag && onTwin?.(t)} className={cx('min-h-9 rounded-full px-3 text-xs font-semibold', t === e.tag ? 'bg-[#0d2a5e] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{t}</button>)}<span className="self-center text-[11px] text-slate-500">worked as one</span></div>}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600"><FlagChip flag={v.flag} />{v.plan && <PlanChip variance={v.plan.variance} days={v.plan.days} />}{e.critical && <span className="font-bold text-[#E02028]">★ Critical</span>}<span>{e.description}</span></div>
        {v.reason && <div className="flex items-center gap-2 rounded-lg bg-[#FFC7CE] px-2.5 py-1.5 text-sm text-red-900"><span className="min-w-0 flex-1">⏸ On hold: {v.reason}</span>
          {canEdit && e.pendingReason && <button type="button" disabled={busy} onClick={() => { const was = e.pendingReason; run(() => setEquipment(e.id, { pending_reason: null }), `${e.tag}: resumed.`, () => setEquipment(e.id, { pending_reason: was })); }} className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-[#0d2a5e] ring-1 ring-red-200">▶ Resume</button>}</div>}
        <EquipActivities trackerId={trackerId} itemKey={e.barchartKey ?? e.tag} activities={activities} now={now} canEdit={canEdit} isHead={isHead} neutCovered={!!iso?.neut.length} neutLabel={soda ? `${neutName(soda)} · ${neutLabel(soda)}` : undefined} onNeut={onNeut} onDone={onDone} />
        {engine && (() => { const key = e.barchartKey ?? e.tag; const sc = engine.scopes.find((x) => x.key === key && x.scope === 'removal' && x.unit);
          return <>
            {sc && <DrumPanel scope={sc} entries={engine.entries.filter((x) => x.scopeId === sc.id)} estimates={engine.estimates.filter((x) => x.scopeId === sc.id)} activities={activities} settings={settings} now={now} canEdit={canEdit} isHead={isHead} me={me} onDone={onDone} />}
            <ItemUpdate trackerId={trackerId} itemKey={key} updates={engine.updates} canEdit={canEdit} onDone={onDone} />
          </>; })()}
        {iso && (
          <button type="button" onClick={onIsolation} className="flex w-full items-center gap-2 rounded-xl bg-slate-50 p-2.5 text-left ring-1 ring-slate-200">
            <span className="min-w-0 flex-1 text-xs text-slate-700">
              <b className="block text-[11px] uppercase tracking-wide text-slate-500">Isolation</b>
              {(() => { const st = isoState(v.eq.tag, v.stage, points); const open = iso.neut.filter((p) => p.beforeHo && !pointComplete(p));
                const block = [...(st?.missing ?? []), ...open.map((p) => (p.stepId ? p.ref : 'soda ash'))];
                return <>
                  {iso.blinds.length > 0 && <span className="mt-0.5 flex flex-wrap items-center gap-1">Blinds: {iso.blinds.map((b) => <IsoChip key={b.id} state={pointComplete(b) ? 'ready' : 'blind'}>{b.ref} {pointComplete(b) ? '✓' : '✗'}</IsoChip>)}</span>}
                  {iso.neut.length > 0 && <span className="mt-0.5 flex flex-wrap items-center gap-1">Neutralization: {iso.neut.map((p) => { const m = p.status === 'open' ? [...missingBlinds(p, points), ...waitAfter(waitingSteps(p, activities))] : [];
                    return <IsoChip key={p.id} state={pointComplete(p) ? 'ready' : p.status !== 'open' ? 'neut' : m.length ? 'blind' : 'idle'}>{neutName(p)} · {m.length ? `🔒 ${m.join(', ')}` : neutLabel(p)}</IsoChip>; })}</span>}
                  {parts.length > 0 && <span className="mt-0.5 flex flex-wrap items-center gap-1">Parts, on their own: {parts.map((p) => <IsoChip key={p.id} state={pointComplete(p) ? 'ready' : p.status !== 'open' ? 'neut' : 'idle'}>{p.ref} {p.name} · {neutLabel(p)}</IsoChip>)}</span>}
                  <span className={cx('mt-1 block text-[11px] font-semibold', v.stage >= 1 ? 'text-[#0850A0]' : block.length ? 'text-red-800' : 'text-teal-800')}>
                    {v.stage >= 1 ? 'Handed over.' : block.length ? `Hand over blocked: ${[...new Set(block)].join(', ')}` : 'Ready: handed over automatically.'}</span>
                </>; })()}
            </span>
            <span className="text-xs font-semibold text-[#0850A0]">Open ›</span>
          </button>
        )}
        <Field label={`IAT · ${rel.filter((x) => x.status === 'open').length} open${rel.some((x) => x.status === 'open' && x.opsAction) ? ` · ${rel.filter((x) => x.status === 'open' && x.opsAction).length} need Operations` : ''}`}>
          <div className="space-y-1.5">
            {rel.filter((x) => x.status === 'open').map((i) => <div key={i.id} className="rounded-lg bg-[#FFF4CC] px-2.5 py-1.5 text-[12.5px] ring-1 ring-amber-200">
              <button type="button" onClick={() => setIatOpen(i)} className="flex w-full items-baseline gap-1.5 text-left"><b>{i.iatNo}</b><span className="min-w-0 flex-1 truncate">{i.jobText}</span>
                <span className="shrink-0 text-[11px] font-semibold text-slate-600">{i.sheetStatus ?? 'open'}</span><span className="shrink-0 text-xs font-semibold text-[#0850A0]">›</span></button>
              {i.tag !== e.tag && <span className="block text-[11px] text-slate-500">on line {i.line ?? i.tag}</span>}
              <div className="mt-1 flex items-center gap-2"><span className="min-w-0 flex-1"><OpsTicks i={i} canEdit={canEdit} compact onDone={(m) => onDone(m)} /></span>
                {canEdit && <button type="button" disabled={busy} onClick={() => run(() => closeIat(i.id), `${i.iatNo} closed.`)} className="shrink-0 text-[11px] font-semibold text-slate-500">Close IAT</button>}</div>
            </div>)}
            {!rel.some((x) => x.status === 'open') && <p className="text-xs text-slate-500">No open IAT.</p>}
            {canEdit && !iat && <Button variant="secondary" className="w-full" onClick={() => setIat(true)}>+ IAT</Button>}
            {iat && <div className="space-y-1.5 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
              <div className="grid grid-cols-2 gap-1.5"><input className="input" placeholder="IAT no." value={iatNo} onChange={(x) => setIatNo(x.target.value)} /><input className="input" placeholder="Discipline" value={disc} onChange={(x) => setDisc(x.target.value)} /></div>
              <input className="input" placeholder="Job (short)" value={job} onChange={(x) => setJob(x.target.value)} />
              <Button className="w-full" disabled={busy || !iatNo.trim()} onClick={() => run(() => addIat(trackerId, { tag: e.tag, iatNo: iatNo.trim(), jobText: job.trim(), discipline: disc.trim() }), `${e.tag}: IAT ${iatNo.trim()} open.`)}>Add IAT</Button>
            </div>}
          </div>
        </Field>
        <Field label={`Stage · ${STAGES[v.stage]}`}>
          <div className="space-y-1.5">
            <StageBar stage={v.stage} />
            {canEdit && fixStage && <div className="grid grid-cols-3 gap-1.5">
              {STAGES.slice(1).map((label, i) => { const s = i + 1; const next = s === v.stage + 1; const lines = stageLines.filter((a) => a.stage === s); const fin = lines.filter((a) => a.actualFinish).length;
                return <button key={s} type="button" disabled={busy || s === v.stage} onClick={() => run(() => setEquipment(e.id, { stage: s }), `${e.tag}: ${label}.`)}
                  className={cx('min-h-11 rounded-lg px-1 text-xs font-semibold ring-1 disabled:opacity-40', s === v.stage ? 'bg-[#0850A0] text-white ring-[#0850A0]' : next ? 'bg-[#D6E6F5] text-[#004080] ring-[#0850A0]' : 'bg-white text-slate-700 ring-slate-300')}>{s}. {label}{lines.length > 0 && <span className="block text-[10.5px] font-normal opacity-80">{fin}/{lines.length} steps</span>}</button>; })}
            </div>}
            <p className="flex items-baseline gap-2 text-[11px] text-slate-500"><span className="min-w-0 flex-1">{v.hoAt ? <>Handed over {when(v.hoAt)}{e.blindsOut ? <> · deblinded {when(e.blindsOut)}</> : null}. </> : null}Moves by itself with the work steps.</span>
              {canEdit && <button type="button" onClick={() => setFixStage((x) => !x)} className="shrink-0 font-semibold text-[#0850A0]">{fixStage ? 'Done' : 'Correct stage'}</button>}</p>
          </div>
        </Field>
        {canEdit && !e.pendingReason && !pending && <Button variant="secondary" className="w-full" disabled={busy} onClick={() => setPending(true)}>⏸ Hold (with reason)</Button>}
        {pending && <PendingForm initial={e.pendingReason} busy={busy} onSave={(r) => run(() => setEquipment(e.id, { pending_reason: r }), `${e.tag}: on hold.`)} />}
        {iatOpen && <IatDetail i={allIats.find((x) => x.id === iatOpen.id) ?? iatOpen} items={new Set(tags)} lineup={lineup} lineupEq={lineupEq} points={points} canEdit={canEdit} onDone={(m) => onDone(m)} onItem={() => setIatOpen(null)} onClose={() => setIatOpen(null)} />}
        {err != null && <ErrorBox error={err} />}
        <button type="button" onClick={() => setDetails((x) => !x)} className="text-xs font-semibold text-slate-600">{details ? '▾' : '▸'} Details</button>
        {details && (
          <dl className="space-y-1 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700">
            <div><dt className="font-semibold">Group</dt><dd>{e.group}{e.fo ? ` · ${e.fo}` : ''}{e.hoStep ? ` · HO step ${e.hoStep}` : ''}</dd></div>
            {e.procedure && <div><dt className="font-semibold">Procedure</dt><dd>{e.procedure}</dd></div>}
            {(e.plannedHo || e.plannedFinish) && <div><dt className="font-semibold">Plan</dt><dd>{e.plannedHo ? `HO ${when(e.plannedHo)}` : ''}{e.plannedFinish ? ` · finish ${when(e.plannedFinish)}` : ''}</dd></div>}
            {v.plan && <div><dt className="font-semibold">Bar chart</dt><dd>Plan stage {v.plan.planned} ({STAGES[v.plan.planned]}), actual {v.stage}</dd></div>}
            {e.remark && <div><dt className="font-semibold">Remark</dt><dd>{e.remark}</dd></div>}
            {(() => { const c = connectionsOf(e.tag, lineup); if (!c.from.length && !c.to.length) return null;
              const li = (x: { other: string; fluid: string | null; line: string | null }, dir: string) => <li key={dir + x.other + x.line}>{dir} <b>{x.other}</b>{x.fluid ? ` · ${x.fluid}` : ''}{x.line ? <span className="text-slate-500"> · {x.line}</span> : null}</li>;
              return <div><dt className="font-semibold">Connected (P&amp;ID lineup)</dt><dd><ul className="space-y-0.5">{c.from.map((x) => li(x, '← from'))}{c.to.map((x) => li(x, '→ to'))}</ul></dd></div>; })()}
            {e.updatedAt && <div><dt className="font-semibold">Last change</dt><dd>{e.updatedBy} {when(e.updatedAt)}</dd></div>}
          </dl>
        )}
      </div>
    </BottomSheet>
  );
}
