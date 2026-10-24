// The two input sheets of the controllers: a guideline step (Start · Done · Pending) and an equipment item (stage,
// blinded = handed over, IATs, pending). Big buttons, the time and the name are stamped by the database.
import { useState } from 'react';
import { isOutOfScope, logText, scopeReasonText, type TrkLog, daysAsHours, connectionsOf, iatsOf, type LuEquip, type LuStream, type TrkIat, PENDING_REASONS, neutLabel, neutName, partsOf, waitingSteps, isoState, missingBlinds, STAGES, kwDay, kwTime, pointComplete, stepTiming, type EquipView, type Isolation, type StepView, type TrkActivity, type TrkPoint, type TrkEngine, type TrkSettings, type MiItem } from '@/core/tracker';
import { EquipActivities, StepTimes } from './Timing';
import { DrumPanel, ItemUpdate } from './Drums';
import { addIat, closeIat, fetchItemLog, setEquipment, setStep } from '@/data/tracker';
import { BottomSheet, Button, ErrorBox, Field, cx } from '@/ui/components';
import { FlagChip, IsoChip, PlanChip, StageBar, StateChip } from './ui';
import { IatDetail, OpsTicks } from './Iats';

const when = (iso: string | null) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '');

export function PendingForm({ initial, onSave, busy }: { initial: string | null; onSave: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState(PENDING_REASONS.find((r) => initial?.startsWith(r)) ?? '');
  const [note, setNote] = useState(initial && !PENDING_REASONS.some((r) => initial === r) ? initial.replace(/^[^–]*–\s*/, '') : '');
  return (
    <div className="space-y-2 rounded-xl bg-red-50 p-2.5 ring-1 ring-red-200">
      <div className="flex flex-wrap gap-1.5">{PENDING_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={cx('rounded-full px-2.5 py-1 text-xs ring-1', reason === r ? 'bg-status-red text-white ring-status-red' : 'bg-white text-slate-700 ring-slate-300')}>{r}</button>)}</div>
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
        {s.pendingReason && <p className="rounded-lg bg-red-100 px-2.5 py-1.5 text-sm text-red-900">⏸ {s.pendingReason}</p>}
        {(s.text || s.procedure) && <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-sm text-slate-800">{s.text}{s.procedure && <span className="mt-0.5 block text-xs font-semibold text-brand-600">{s.procedure}</span>}</div>}
        {points.length > 0 && (
          <div className="space-y-1.5 rounded-xl bg-brand-100/40 p-2.5 ring-1 ring-brand-500/30">
            <p className="text-sm text-slate-800">Ticks itself from the <b>Isolation</b> page · {points.filter(pointComplete).length}/{points.length} done</p>
            <div className="flex flex-wrap gap-1">{points.map((p) => <span key={p.id} className={cx('rounded px-1.5 py-0.5 text-[11px] font-semibold', pointComplete(p) ? 'bg-green-100 text-green-900' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{pointComplete(p) ? '✓ ' : ''}{p.kind === 'blind' ? p.ref : `${p.ref} ${neutLabel(p).toLowerCase()}`}</span>)}</div>
            {onIsolation && <Button variant="secondary" className="w-full" onClick={onIsolation}>Open on Isolation</Button>}
          </div>
        )}
        {items.length > 0 && <p className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">Ticks itself when its items are handed over: {items.map((e) => `${e.stage >= 1 ? '✓ ' : ''}${e.eq.tag}`).join(' · ')}</p>}
        {canEdit && !points.length && (
          <div className="grid grid-cols-3 gap-2">
            <button type="button" disabled={busy || v.state === 'IN_PROGRESS'} onClick={() => run({ status: 'in_progress', pending_reason: null }, `${s.stepId} started.`)} className="flex min-h-16 flex-col items-center justify-center rounded-xl bg-brand-100 text-brand-600 disabled:opacity-40"><span className="text-xl">▶</span><span className="text-sm font-semibold">Start</span></button>
            <button type="button" disabled={busy || v.state === 'DONE'} onClick={done} className="flex min-h-16 flex-col items-center justify-center rounded-xl bg-green-100 text-green-900 disabled:opacity-40"><span className="text-xl">✓</span><span className="text-sm font-semibold">Done</span></button>
            <button type="button" disabled={busy} onClick={() => setPending((x) => !x)} className="flex min-h-16 flex-col items-center justify-center rounded-xl bg-red-100 text-red-900 disabled:opacity-40"><span className="text-xl">⏸</span><span className="text-sm font-semibold">Pending</span></button>
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

export function EquipSheet({ system = [], groups = [], systems = [], canManage = false, canScope = false, totalH = 0, onItem, mi, related = [], allIats = [], lineup = [], lineupEq = [], tags = [], v, trackerId, canEdit, isHead, activities, now, iso = null, points = [], engine, settings = {}, me = null, twins = [], onTwin, onIsolation, onNeut, onClose, onDone }: { system?: EquipView[]; groups?: string[]; systems?: string[]; canManage?: boolean; canScope?: boolean; totalH?: number; onItem?: (tag: string) => void; mi?: MiItem; related?: TrkActivity[]; allIats?: TrkIat[]; lineup?: LuStream[]; lineupEq?: LuEquip[]; tags?: string[]; twins?: string[]; onTwin?: (tag: string) => void; v: EquipView; trackerId: string; canEdit: boolean; isHead: boolean; activities: TrkActivity[]; now: number; iso?: Isolation | null; points?: TrkPoint[]; engine?: TrkEngine; settings?: TrkSettings; me?: string | null; onIsolation?: () => void; onNeut?: () => void; onClose: () => void; onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  // the neutralization the soda-ash lines stand for: the item's own soda ash first, else its loop
  // the item's bar-chart steps by stage (what moves the stage), the field-detail steps left out
  const stageLines = activities.filter((a) => a.tracked && !a.detail && a.group !== 'Operations' && a.stage !== null);
  const soda = iso?.neut.find((p) => !p.stepId && p.method !== 'spray') ?? iso?.neut.find((p) => p.method !== 'spray');
  // a reactor's lines and the piping between the reactors: neutralized on their own, shown with it
  const parts = partsOf(v.eq.tag, points);
  const e = v.eq;
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [pending, setPending] = useState(false); const [iat, setIat] = useState(false); const [fixStage, setFixStage] = useState(false);
  // scope (Section Head / Engineers): out of scope keeps everything, only stops counting; the item's share of the planned work
  const out = isOutOfScope(e);
  const [scopeOpen, setScopeOpen] = useState(false); const [scopeWhy, setScopeWhy] = useState('');
  const itemH = activities.filter((a) => !a.detail && a.group !== 'Operations' && (a.tracked || a.outOfScope)).reduce((t, a) => t + (a.durationH ?? 0), 0);
  const impact = { hours: Math.round(itemH), pct: totalH ? Math.round((itemH / totalH) * 1000) / 10 : 0 };
  // editing the name, group and system (Section Head / Engineers)
  const [edit, setEdit] = useState(false); const [edName, setEdName] = useState(''); const [edGrp, setEdGrp] = useState(''); const [edSys, setEdSys] = useState('');
  // the item's history, read when its section is opened
  const [log, setLog] = useState<TrkLog[] | null>(null); const [logAll, setLogAll] = useState(false);
  const loadLog = () => { if (log === null) fetchItemLog(trackerId, e.tag, e.barchartKey ?? e.tag).then(setLog, () => setLog([])); };
  const [iatNo, setIatNo] = useState(''); const [job, setJob] = useState(''); const [disc, setDisc] = useState('');
  async function run(f: () => Promise<void>, msg: string, undo?: () => Promise<unknown>) { setBusy(true); setErr(null); try { await f(); setPending(false); setIat(false); setIatNo(''); setJob(''); setDisc(''); onDone(msg, undo); } catch (x) { setErr(x); } finally { setBusy(false); } }
  // its IATs: its own and those on a line to or from it (P&ID lineup)
  const rel = iatsOf(e.tag, allIats.length ? allIats : v.iatsOpen, lineup);
  const [iatOpen, setIatOpen] = useState<TrkIat | null>(null);
  return (
    <BottomSheet open onClose={onClose} title={e.tag}>
      <div className="space-y-3">
        {twins.length > 1 && <div className="flex gap-1">{twins.map((t) => <button key={t} type="button" onClick={() => t !== e.tag && onTwin?.(t)} className={cx('min-h-9 rounded-full px-3 text-xs font-semibold', t === e.tag ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{t}</button>)}<span className="self-center text-[11px] text-slate-500">worked as one</span></div>}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600"><FlagChip flag={v.flag} />{v.plan && <PlanChip variance={v.plan.variance} days={v.plan.days} />}{e.critical && <span className="font-bold text-status-red">★ Critical</span>}<span>{e.description}</span></div>
        {v.reason && <div className="flex items-center gap-2 rounded-lg bg-red-100 px-2.5 py-1.5 text-sm text-red-900"><span className="min-w-0 flex-1">⏸ On hold: {v.reason}</span>
          {canEdit && e.pendingReason && <button type="button" disabled={busy} onClick={() => { const was = e.pendingReason; run(() => setEquipment(e.id, { pending_reason: null }), `${e.tag}: resumed.`, () => setEquipment(e.id, { pending_reason: was })); }} className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-brand-700 ring-1 ring-red-200">▶ Resume</button>}</div>}
        {mi && <MiLine i={mi} />}
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
                  <span className={cx('mt-1 block text-[11px] font-semibold', v.stage >= 1 ? 'text-brand-500' : block.length ? 'text-red-800' : 'text-teal-800')}>
                    {v.stage >= 1 ? 'Handed over.' : block.length ? `Hand over blocked: ${[...new Set(block)].join(', ')}` : 'Ready: handed over automatically.'}</span>
                </>; })()}
            </span>
            <span className="text-xs font-semibold text-brand-500">Open ›</span>
          </button>
        )}
        <Field label={`Stage · ${STAGES[v.stage]}`}>
          <div className="space-y-1.5">
            <StageBar stage={v.stage} />
            {canEdit && fixStage && <div className="grid grid-cols-3 gap-1.5">
              {STAGES.slice(1).map((label, i) => { const s = i + 1; const next = s === v.stage + 1; const lines = stageLines.filter((a) => a.stage === s); const fin = lines.filter((a) => a.actualFinish).length;
                return <button key={s} type="button" disabled={busy || s === v.stage} onClick={() => run(() => setEquipment(e.id, { stage: s }), `${e.tag}: ${label}.`)}
                  className={cx('min-h-11 rounded-lg px-1 text-xs font-semibold ring-1 disabled:opacity-40', s === v.stage ? 'bg-brand-500 text-white ring-brand-500' : next ? 'bg-brand-100 text-brand-600 ring-brand-500' : 'bg-white text-slate-700 ring-slate-300')}>{s}. {label}{lines.length > 0 && <span className="block text-[11px] font-normal opacity-80">{fin}/{lines.length} steps</span>}</button>; })}
            </div>}
            <p className="flex items-baseline gap-2 text-[11px] text-slate-500"><span className="min-w-0 flex-1">{v.hoAt ? <>Handed over {when(v.hoAt)}{e.blindsOut ? <> · deblinded {when(e.blindsOut)}</> : null}. </> : null}Moves by itself with the work steps.</span>
              {canEdit && <button type="button" onClick={() => setFixStage((x) => !x)} className="shrink-0 font-semibold text-brand-500">{fixStage ? 'Done' : 'Correct stage'}</button>}</p>
          </div>
        </Field>
        {canEdit && !e.pendingReason && !pending && <Button variant="secondary" className="w-full" disabled={busy} onClick={() => setPending(true)}>⏸ Hold (with reason)</Button>}
        {pending && <PendingForm initial={e.pendingReason} busy={busy} onSave={(r) => run(() => setEquipment(e.id, { pending_reason: r }), `${e.tag}: on hold.`)} />}
        {iatOpen && <IatDetail i={allIats.find((x) => x.id === iatOpen.id) ?? iatOpen} items={new Set(tags)} lineup={lineup} lineupEq={lineupEq} points={points} canEdit={canEdit} onDone={(m, u) => onDone(m, u)} onItem={() => setIatOpen(null)} onClose={() => setIatOpen(null)} />}
        {err != null && <ErrorBox error={err} />}
        <Fold title={`IATs · ${rel.filter((x) => x.status === 'open').length} open${rel.some((x) => x.status === 'open' && x.opsAction) ? ` · ${rel.filter((x) => x.status === 'open' && x.opsAction).length} need Operations` : ''}`} open={rel.some((x) => x.status === 'open' && x.opsAction)}>
          <div className="space-y-1.5">
            {rel.filter((x) => x.status === 'open').map((i) => <div key={i.id} className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] ring-1 ring-amber-200">
              <button type="button" onClick={() => setIatOpen(i)} className="flex w-full items-baseline gap-1.5 text-left"><b>{i.iatNo}</b><span className="min-w-0 flex-1 truncate">{i.jobText}</span>
                <span className="shrink-0 text-[11px] font-semibold text-slate-600">{i.sheetStatus ?? 'open'}</span><span className="shrink-0 text-xs font-semibold text-brand-500">›</span></button>
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
        </Fold>
        <Fold title={`Related equipment${system.length + related.length ? ` · ${system.length + related.length}` : ''}`}>
          <div className="space-y-2 text-xs text-slate-700">
            {e.system && <div><b className="block text-[11px] uppercase tracking-wide text-slate-500">{e.system}</b><div className="mt-1 flex flex-wrap gap-1.5">{system.map((x) => <button key={x.eq.tag} type="button" onClick={() => onItem?.(x.eq.tag)} className={cx('rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1', isOutOfScope(x.eq) ? 'bg-slate-100 text-slate-500 ring-slate-200 line-through' : !x.eq.tracked ? 'bg-white text-slate-400 ring-slate-200' : x.stage >= 6 ? 'bg-green-50 text-green-800 ring-green-200' : 'bg-white text-slate-800 ring-slate-300')}>{x.eq.tag.replace(/^([A-Z]{1,3})-12-/, '$1-')} · {STAGES[x.stage]}</button>)}</div></div>}
            {related.length > 0 && <Related acts={related} />}
            {(() => { const c = connectionsOf(e.tag, lineup); if (!c.from.length && !c.to.length) return null;
              const li = (x: { other: string; fluid: string | null; line: string | null }, dir: string) => <li key={dir + x.other + x.line}>{dir} <b>{x.other}</b>{x.fluid ? ` · ${x.fluid}` : ''}{x.line ? <span className="text-slate-500"> · {x.line}</span> : null}</li>;
              return <div><b className="block text-[11px] uppercase tracking-wide text-slate-500">Connected (P&amp;ID line-up, unverified)</b><div><ul className="space-y-0.5">{c.from.map((x) => li(x, '← from'))}{c.to.map((x) => li(x, '→ to'))}</ul></div></div>; })()}
            {!e.system && !related.length && !connectionsOf(e.tag, lineup).from.length && !connectionsOf(e.tag, lineup).to.length && <p className="text-slate-500">No related equipment recorded.</p>}
          </div>
        </Fold>
        <Fold title="History" onOpen={loadLog}>
          {log === null ? <p className="text-xs text-slate-500">Loading…</p> : !log.length ? <p className="text-xs text-slate-500">No changes recorded.</p>
            : <ul className="space-y-1">{log.slice(0, logAll ? 200 : 12).map((l, i) => { const t = logText(l, activities); return <li key={i} className="grid grid-cols-[86px_minmax(0,1fr)] gap-2 text-[12px] text-slate-700"><span className="text-[11px] text-slate-500">{when(l.at)}</span><span className="min-w-0">{l.ref !== e.tag ? <b className="text-slate-500">step · </b> : null}{t.what}{l.reason && !/^(out of scope|not required)/.test(l.reason) ? <i className="text-slate-500"> · {l.reason}</i> : null}<span className="text-slate-400"> · {l.byName ?? 'system'}</span></span></li>; })}
              {!logAll && log.length > 12 && <li><button type="button" onClick={() => setLogAll(true)} className="text-[11px] font-semibold text-brand-500">Show all {log.length}</button></li>}</ul>}
        </Fold>
        <Fold title="Technical details">
          <dl className="space-y-1 text-xs text-slate-700">
            <div><dt className="font-semibold">Name</dt><dd>{e.description ?? '—'}</dd></div>
            {e.system && <div><dt className="font-semibold">System</dt><dd>{e.system}</dd></div>}
            <div><dt className="font-semibold">Group</dt><dd>{e.group}{e.fo ? ` · ${e.fo}` : ''}{e.hoStep ? ` · HO step ${e.hoStep}` : ''}</dd></div>
            {e.procedure && <div><dt className="font-semibold">Procedure</dt><dd>{e.procedure}</dd></div>}
            {(e.plannedHo || e.plannedFinish) && <div><dt className="font-semibold">Plan</dt><dd>{e.plannedHo ? `HO ${when(e.plannedHo)}` : ''}{e.plannedFinish ? ` · finish ${when(e.plannedFinish)}` : ''}</dd></div>}
            {v.plan && <div><dt className="font-semibold">Bar chart</dt><dd>Plan stage {v.plan.planned} ({STAGES[v.plan.planned]}), actual {v.stage}</dd></div>}
            {e.remark && <div><dt className="font-semibold">Remark</dt><dd>{e.remark}</dd></div>}
            {e.updatedAt && <div><dt className="font-semibold">Last change</dt><dd>{e.updatedBy} {when(e.updatedAt)}</dd></div>}
          </dl>
          {canManage && !edit && <button type="button" onClick={() => { setEdit(true); setEdName(e.description ?? ''); setEdGrp(e.group); setEdSys(e.system ?? ''); }} className="mt-2 text-xs font-semibold text-brand-500">✎ Edit name, group, system</button>}
          {canManage && edit && <div className="mt-2 space-y-1.5">
            <Field label="Name / description"><input className="input" value={edName} onChange={(x) => setEdName(x.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-1.5"><Field label="Group"><input className="input" list="eq-groups" value={edGrp} onChange={(x) => setEdGrp(x.target.value)} /></Field>
              <Field label="System (shown together)"><input className="input" list="eq-systems" value={edSys} placeholder="none" onChange={(x) => setEdSys(x.target.value)} /></Field></div>
            <datalist id="eq-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist><datalist id="eq-systems">{systems.map((g) => <option key={g} value={g} />)}</datalist>
            <div className="flex gap-1.5"><Button variant="secondary" className="flex-1" onClick={() => setEdit(false)}>Cancel</Button>
              <Button className="flex-1" disabled={busy || !edGrp.trim()} onClick={() => { const was = { description: e.description, grp: e.group, system: e.system ?? null };
                run(() => setEquipment(e.id, { description: edName.trim() || null, grp: edGrp.trim(), system: edSys.trim() || null }), `${e.tag}: details saved.`, () => setEquipment(e.id, was)).then(() => setEdit(false)); }}>Save</Button></div>
            <p className="text-[11px] text-slate-500">The tag stays as it is: it links the item to its P6 lines. Group and system change only where the item is listed.</p>
          </div>}
        </Fold>
        <div className={cx('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs', out ? 'bg-slate-100 text-slate-700' : 'text-slate-600')}>
          <span className="min-w-0 flex-1">{out ? <>⊘ <b>Out of scope</b> · {scopeReasonText(e.disabledReason)}</> : <>In scope{impact.hours ? ` · ${impact.hours} h planned work (${impact.pct}% of the shutdown)` : ''}</>}</span>
          {canScope && (out ? <button type="button" disabled={busy} onClick={() => { const was = e.disabledReason; run(() => setEquipment(e.id, { tracked: true, disabled_reason: null }), `${e.tag}: back in scope.`, () => setEquipment(e.id, { tracked: false, disabled_reason: was })); }} className="shrink-0 font-semibold text-brand-500">↺ Restore</button>
            : !scopeOpen && <button type="button" onClick={() => setScopeOpen(true)} className="shrink-0 font-semibold text-slate-600">Take out of scope</button>)}
        </div>
        {scopeOpen && !out && <div className="space-y-1.5 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
          <p className="text-[12px] text-slate-700">The item is removed from this shutdown's work. Its steps, P6 lines and history are kept; its {impact.hours} h of planned work ({impact.pct}% of the shutdown) stop counting in progress, and it is listed under Out of scope, apart from completed work. Restore brings it back.</p>
          <input className="input" placeholder="Reason (required)" value={scopeWhy} onChange={(x) => setScopeWhy(x.target.value)} />
          <div className="flex gap-1.5"><Button variant="secondary" className="flex-1" onClick={() => setScopeOpen(false)}>Cancel</Button>
            <Button className="flex-1" disabled={busy || scopeWhy.trim().length < 3} onClick={() => run(() => setEquipment(e.id, { tracked: false, disabled_reason: `out of scope: ${scopeWhy.trim()}` }), `${e.tag}: out of scope.`, () => setEquipment(e.id, { tracked: true, disabled_reason: null })).then(() => setScopeOpen(false))}>Out of scope</Button></div>
        </div>}
      </div>
    </BottomSheet>
  );
}

/** A compact section that opens on a tap (IATs, related equipment, history, technical details). */
function Fold({ title, open = false, onOpen, children }: { title: string; open?: boolean; onOpen?: () => void; children: React.ReactNode }) {
  const [o, setO] = useState(open);
  return (
    <section className="rounded-lg ring-1 ring-slate-200">
      <button type="button" aria-expanded={o} onClick={() => { if (!o) onOpen?.(); setO(!o); }} className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600">
        <span className="w-3 text-slate-400">{o ? '▾' : '▸'}</span>{title}</button>
      {o && <div className="border-t border-slate-100 px-2.5 py-2">{children}</div>}
    </section>
  );
}

/** The item's three indicators: physical progress, schedule variance (vs P6) and its float / delay to the shutdown end. */
function MiLine({ i }: { i: MiItem }) {
  const [why, setWhy] = useState(false);
  const pct = i.physHiPct > i.physPct ? `${i.physPct}–${i.physHiPct}%` : `${i.physPct}%`;
  const done = i.done >= i.lines;
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-700 ring-1 ring-slate-200">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span>Physical <b className="text-slate-900">{pct}</b> / plan {i.planPct}%</span>
        <span>vs P6 <b className={i.svD < 0 ? 'text-status-red' : 'text-status-green'}>{i.svD > 0 ? '+' : i.svD < 0 ? '−' : ''}{daysAsHours(i.svD)}</b></span>
        {!done && <span>{i.spareD < 0 ? <b className="text-status-red">delays shutdown {daysAsHours(i.impactD)}</b> : <>Float <b className="text-slate-900">{daysAsHours(i.spareD)}</b></>}</span>}
      </div>
      <div className="text-[11px] text-slate-500">{done ? `Finished ${kwDay(i.forecast)} ${kwTime(i.forecast)}` : `Forecast ${kwDay(i.forecast)} ${kwTime(i.forecast)} · ${daysAsHours(i.remainingD)} left · P6 ${kwDay(i.p6Finish)} ${kwTime(i.p6Finish)}`}
        {!done && i.unverified.length > 0 && <button type="button" onClick={() => setWhy((x) => !x)} className="ml-1 font-semibold text-amber-700">· unverified {why ? '▾' : '▸'}</button>}</div>
      {why && <ul className="mt-0.5 list-disc pl-4 text-[11px] text-amber-800">{i.unverified.map((u) => <li key={u}>{u}</li>)}</ul>}
    </div>
  );
}

/** The same tag's work in other lists (OPR list, valve drops in the procedures): each with its own status. */
function Related({ acts }: { acts: TrkActivity[] }) {
  return (
    <section className="rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Also in other lists</h3>
      <ul className="mt-0.5 space-y-0.5">{acts.map((a) => (
        <li key={a.id} className="flex items-start gap-2 text-[12px] text-slate-700">
          <span className="min-w-0 flex-1"><b className="text-slate-500">{a.key.startsWith('OPR') ? 'OPR list' : a.key}:</b> {a.activity.replace(/^OPlist-\d+\s*/, '')}</span>
          <span className={cx('shrink-0 rounded px-1.5 text-[10px] font-bold', a.actualFinish ? 'bg-green-100 text-green-800' : a.actualStart ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600')}>{a.actualFinish ? '✓ done' : a.actualStart ? 'I/P' : 'not started'}</span>
        </li>))}
      </ul>
    </section>
  );
}
