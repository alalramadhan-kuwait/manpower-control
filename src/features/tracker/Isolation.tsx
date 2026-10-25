// Isolation & neutralization pieces shared by the Handover page of both modes: a loop opened (its procedure, steps with
// times, field jobs, diagrams, items and RTJs, note) and the loop scope (its items handed over and its RTJs).
import { createContext, useContext, useState, type ReactNode } from 'react';
import { loopHandover, type TrkEquipment, type TrkRtj, linkedStep, NEUT_FLOW, neutLabel, loopLines, missingBlinds, waitingSteps, type LuStream, type TrkIat, hoursText, kwDay, kwTime, pointComplete, soakLeft, type TrkActivity, type TrkPoint, type TrkPointStep, type TrkStep } from '@/core/tracker';
import { addPointStep, setActivity, setEquipment, setPoint, setPointStep, setPointStepTime } from '@/data/tracker';
import { BottomSheet, Button, ErrorBox, cx } from '@/ui/components';
import { RowBtn } from './ui';
import { PendingForm } from './TrackerSheets';
import { LoopDiagrams } from './LoopDiagram';

/** The SOP lines the Section Head follows: the timed field jobs (crane, blinds, elbows, scaffolding) and the lab pH.
 *  The others (hoses, valves closed, draining, clear soda ash at the vents) are the procedure, shown for reference. */
export const followed = (c: TrkPointStep) => c.kind === 'step' || /\bpH\b/.test(c.text);

const when = (iso: string | null) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '');

/** The Section Head adds a field job to a loop (scaffolding and the like): a timed step, before the fill unless said. */
function AddJob({ onAdd }: { onAdd: (text: string, crane: boolean, after: boolean) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [text, setText] = useState(''); const [crane, setCrane] = useState(false); const [after, setAfter] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-brand-500">+ Add job (scaffolding…)</button>;
  const save = async () => { setBusy(true); setErr(null); try { await onAdd(text.trim(), crane, after); setOpen(false); setText(''); setCrane(false); setAfter(false); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
      <div className="flex flex-wrap gap-1">{(after ? ['Scaffolding removed'] : ['Scaffolding erected']).map((x) => <button key={x} type="button" onClick={() => setText(x)} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{x}</button>)}</div>
      <input className="input" placeholder="Job, e.g. Scaffolding erected at FV-1426" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={crane} onChange={(e) => setCrane(e.target.checked)} /> Needs a crane</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={after} onChange={(e) => setAfter(e.target.checked)} /> After the neutralization</label>
      </div>
      <div className="flex gap-1.5"><RowBtn tone="navy" disabled={busy || !text.trim()} onClick={save}>Add job</RowBtn><RowBtn tone="ghost" onClick={() => setOpen(false)}>Cancel</RowBtn></div>
      {err != null && <ErrorBox error={err} />}
    </div>
  );
}

/** The start / finish button of a timed field step: one tap, now (the message offers Undo). */
function JobButton({ c, busy, onStart, onFinish }: { c: TrkPointStep; busy: boolean; onStart: () => void; onFinish: () => void }) {
  if (c.doneAt) return <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-status-green text-[12px] font-bold text-white">✓</span>;
  const finish = !!c.startAt;
  return (
    <button type="button" disabled={busy} aria-label={`${finish ? 'Finish' : 'Start'} step ${c.seq}`} onClick={finish ? onFinish : onStart}
      className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold disabled:opacity-50', finish ? 'bg-amber-400 text-slate-900 ring-1 ring-amber-500' : 'bg-brand-700 text-white')}>
      {finish ? '✓' : '▶'}
    </button>
  );
}

/** A neutralization opened: its procedure (the guideline step), the steps of the loop with their times, and the next action. */
function LoopSheet({ acts = [], p, points, lineup, iats, steps, checks, canEdit, isHead, canAttach = false, trackerId, onDone, now, missing, waiting, action, err, onClose, onItem, onStep }: { p: TrkPoint; points: TrkPoint[]; lineup: LuStream[]; iats: TrkIat[]; steps: TrkStep[]; checks: TrkPointStep[]; canEdit: boolean; isHead: boolean; canAttach?: boolean; trackerId?: string; onDone: (msg: string, undo?: () => Promise<unknown>) => void; now: number;
  missing: string[]; waiting: string[]; action: ReactNode; err: unknown; acts?: TrkActivity[]; onClose: () => void; onItem: (tag: string) => void; onStep?: (id: string) => void }) {
  const scope = useContext(LoopScopeCtx);
  const spray = p.method === 'spray';
  const step = p.stepId ? steps.find((x) => x.stepId === p.stepId) : undefined;
  const left = soakLeft(p, now);
  const at = NEUT_FLOW.indexOf(p.status as typeof NEUT_FLOW[number]);
  const dur = (a: string | null, b: string | null) => (a && b ? ` · ${hoursText(Date.parse(b) - Date.parse(a))}` : '');
  type Row = { label: string; done: boolean; now?: boolean; info?: string; check?: TrkPointStep };
  const [busy, setBusy] = useState<string | null>(null); const [cErr, setCErr] = useState<unknown>(null); const [hold, setHold] = useState(false); const [ref, setRef] = useState(false);
  const tick = async (c: TrkPointStep) => { if ((c.linkActs ?? []).length || (c.linkPoints ?? []).length) return time(c, { done_at: c.doneAt ? null : new Date().toISOString() }, `step ${c.seq} ${c.doneAt ? 'undone' : 'done'}`); setBusy(c.id); setCErr(null); try { await setPointStep(c.id, !c.doneAt); onDone(`${p.ref}: step ${c.seq} ${c.doneAt ? 'undone' : 'done'}.`); } catch (e) { setCErr(e); } finally { setBusy(null); } };
  const stepInfo = (c: TrkPointStep) => c.doneAt ? `${c.startAt ? `${when(c.startAt)} → ` : ''}${when(c.doneAt)}${dur(c.startAt, c.doneAt)}${c.doneBy ? ` · ${c.doneBy}` : ''}`
    : c.startAt ? `started ${when(c.startAt)} · ${hoursText(now - Date.parse(c.startAt))} so far${c.startBy ? ` · ${c.startBy}` : ''}` : undefined;
  const sop = (ph: TrkPointStep['phase']): Row[] => checks.filter((c) => c.phase === ph && followed(c)).map((c) => ({ label: c.text, done: !!c.doneAt, now: c.kind === 'step' && !!c.startAt && !c.doneAt,
    info: c.kind === 'step' ? stepInfo(c) : c.doneAt ? `${when(c.doneAt)}${c.doneBy ? ` · ${c.doneBy}` : ''}` : undefined, check: c }));
  const time = async (c: TrkPointStep, patch: Parameters<typeof setPointStepTime>[1], msg: string) => { setBusy(c.id); setCErr(null);
    try {
      const la = acts.filter((a) => (c.linkActs ?? []).includes(a.id));
      const lp = points.filter((x) => (c.linkPoints ?? []).includes(x.id));
      if (lp.length && patch.done_at !== undefined) {
        // the same blinds as the segregation list: the update goes to them (one record, both views)
        const before = lp.map((x) => ({ id: x.id, status: x.status, in_at: x.inAt ?? null }));
        const at = new Date().toISOString();
        for (const x of lp) {
          if (patch.done_at && x.status === 'open') await setPoint(x.id, { status: 'in', in_at: at });
          else if (!patch.done_at && x.status === 'in') await setPoint(x.id, { status: 'open', in_at: null });
        }
        onDone(`${p.ref}: ${msg} (${lp.map((x) => x.ref).join(', ')})`, async () => { for (const b of before) await setPoint(b.id, { status: b.status, in_at: b.in_at }); });
      } else if (la.length) {
        // the same work as the equipment steps: the update goes to them (one record, both views)
        const before = la.map((a) => ({ id: a.id, actual_start: a.actualStart ?? null, actual_finish: a.actualFinish ?? null }));
        const at = new Date().toISOString();
        for (const a of la) {
          if (patch.done_at !== undefined) await setActivity(a.id, patch.done_at ? (a.actualFinish ? {} : { actual_finish: at, ...(a.actualStart ? {} : { actual_start: at }) }) : { actual_finish: null });
          else if (patch.start_at !== undefined) await setActivity(a.id, patch.start_at ? (a.actualStart ? {} : { actual_start: at }) : { actual_start: null, actual_finish: null });
        }
        onDone(`${p.ref}: ${msg} (${[...new Set(la.map((a) => a.key))].join(', ')})`, async () => { for (const b of before) await setActivity(b.id, { actual_start: b.actual_start, actual_finish: b.actual_finish, time_reason: 'Undo' }); });
      } else {
        const back = { start_at: c.startAt ?? null, done_at: c.doneAt ?? null };
        await setPointStepTime(c.id, patch); onDone(`${p.ref}: ${msg}`, () => setPointStepTime(c.id, back));
      }
    } catch (e) { setCErr(e); } finally { setBusy(null); } };
  const rows: Row[] = [
    ...(p.requires ?? []).map((r) => { const b = points.find((x) => x.kind === 'blind' && x.ref === r); const ok = !missing.includes(r);
      return { label: `Blind ${r}${b?.name ? ` · ${b.name}` : ''}`, done: ok, info: ok ? (b?.inAt ? `in ${when(b.inAt)}` : 'in') : 'not in yet' }; }),
    ...((p.afterActs ?? []).length ? [{ label: 'Catalyst dumping finished', done: !waiting.length, info: waiting.length ? `waiting: ${waiting.join(', ')}` : 'done' }] : []),
    ...sop('before'),
    ...(spray
      ? [{ label: 'Spray started', done: at >= 1, now: p.status === 'filling', info: when(p.fillAt) },
         { label: 'Spray done', done: p.status === 'done', info: `${when(p.doneAt)}${dur(p.fillAt, p.doneAt)}` }]
      : [{ label: 'Fill with soda ash', done: at >= 2, now: p.status === 'filling', info: `${when(p.fillAt)}${dur(p.fillAt, p.soakAt)}` },
         ...sop('fill'),
         { label: `Soak${p.soakH ? ` ${p.soakH} h` : ''}`, done: at >= 3, now: p.status === 'soaking', info: `${when(p.soakAt)}${at >= 3 ? dur(p.soakAt, p.drainAt) : left !== null ? (left > 0 ? ` · ${hoursText(left)} left` : ' · soak reached') : ''}` },
         { label: 'Drain', done: at >= 4, now: p.status === 'draining', info: `${when(p.drainAt)}${dur(p.drainAt, p.doneAt)}` },
         { label: 'Neutralized', done: p.status === 'done', info: when(p.doneAt) }]),
    ...sop('after'),
  ];
  const ll = loopLines(p, lineup).lines; const onLine = iats.filter((i) => i.status === 'open' && i.line && ll.includes(i.line));
  const total = rows.length, doneN = rows.filter((x) => x.done).length;
  return (
    <BottomSheet open onClose={onClose} title={`${p.ref}${p.name && !p.name.startsWith(p.ref) ? ` · ${p.name}` : ''}`}>
      <div className="space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className={cx('rounded px-1.5 py-0.5 font-bold', p.status === 'done' ? 'bg-green-100 text-green-800' : p.status === 'open' ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-900')}>{neutLabel(p)}</span>
          {p.fo && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">{p.fo}</span>}
          <span className="text-slate-500">{doneN}/{total} steps{p.beforeHo ? ' · needed for the handover' : ' · after the handover'}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-status-green" style={{ width: `${(doneN / Math.max(total, 1)) * 100}%` }} /></div>
        {(step || (p.detail && p.detail !== p.name) || checks.some((c) => !followed(c))) && <section className="rounded-xl bg-slate-50 p-2.5">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Procedure</h3>
          {step && <p className="mt-0.5 font-semibold text-slate-900">{step.stepId} · {step.shortName}{step.procedure ? <span className="font-normal text-slate-500"> · {step.procedure}</span> : null}</p>}
          {step?.text && <p className="mt-0.5 whitespace-pre-line text-[12px] text-slate-700">{step.text}</p>}
          {p.detail && p.detail !== p.name && p.detail !== step?.text && <p className="mt-0.5 text-[12px] text-slate-700">{p.detail}</p>}
          {step && onStep && <button type="button" onClick={() => onStep(step.stepId)} className="mt-1 text-xs font-semibold text-brand-500">Open step {step.stepId} ›</button>}
          {checks.some((c) => !followed(c)) && <>
            <button type="button" onClick={() => setRef((x) => !x)} className="mt-1 block text-xs font-semibold text-slate-600">{ref ? '▾' : '▸'} Field procedure ({checks.filter((c) => !followed(c)).length} line{checks.filter((c) => !followed(c)).length > 1 ? "s" : ""}, reference)</button>
            {ref && <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[12px] text-slate-600">{checks.filter((c) => !followed(c)).map((c) => <li key={c.id}>{c.phase === 'fill' ? <i>While filling: </i> : c.phase === 'after' ? <i>After: </i> : null}{c.text}</li>)}</ol>}
          </>}
        </section>}
        <section>
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Steps</h3>
          <ol className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
            {rows.map((x, i) => <li key={i} className="flex items-start gap-2 border-t border-slate-100 px-2.5 py-1.5 first:border-t-0">
              {x.check?.kind === 'step' && canEdit
                ? <JobButton c={x.check} busy={busy === x.check.id}
                    onStart={() => time(x.check!, { start_at: new Date().toISOString() }, `${x.check!.text.split(',')[0]} started.`)}
                    onFinish={() => time(x.check!, { done_at: new Date().toISOString() }, `${x.check!.text.split(',')[0]} finished.`)} />
                : x.check && canEdit
                ? <button type="button" disabled={busy === x.check.id} onClick={() => tick(x.check!)} aria-label={`${x.done ? 'Undo' : 'Tick'} step ${i + 1}`}
                    className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-bold ring-1 disabled:opacity-50', x.done ? 'bg-status-green text-white ring-status-green' : 'bg-white text-slate-500 ring-slate-300')}>{x.done ? '✓' : ''}</button>
                : <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', x.done ? 'bg-status-green text-white' : x.now ? 'bg-amber-400 text-white' : 'bg-slate-200 text-slate-500')}>{x.done ? '✓' : i + 1}</span>}
              <span className="min-w-0 flex-1"><span className={cx('block', x.check ? 'text-[12px] font-medium' : 'font-semibold', x.done ? 'text-slate-900' : x.now ? 'text-amber-900' : 'text-slate-600')}>{x.check?.crane && <span className={cx('mr-1 rounded px-1 text-[10px] font-bold', x.done ? 'bg-slate-200 text-slate-600' : 'bg-status-red text-white')}>🏗 CRANE · CRITICAL</span>}{x.label}{x.now ? ' · now' : ''}</span>
                {x.info && <span className="block text-[12px] text-slate-500">{x.info}</span>}
                {(x.check?.linkActs ?? []).length > 0 && <span className="block text-[11px] font-semibold text-brand-500">= {acts.filter((a) => x.check!.linkActs!.includes(a.id)).map((a) => `${a.key.replace('-12-', '-')}: ${a.activity}${a.actualFinish ? ' ✓' : a.actualStart ? ' ▶' : ''}`).join(' · ')}</span>}
                {(x.check?.linkPoints ?? []).length > 0 && <span className="block text-[11px] font-semibold text-brand-500">= {points.filter((b) => x.check!.linkPoints!.includes(b.id)).map((b) => `${b.ref} ${b.name}${b.status === 'in' || b.status === 'out' ? ' ✓' : ''}`).join(' · ')}</span>}
                {x.check?.kind === 'step' && canEdit && (x.check.startAt || x.check.doneAt) && <button type="button" disabled={busy === x.check.id} className="text-[11px] font-semibold text-slate-500"
                  onClick={() => time(x.check!, x.check!.doneAt ? { done_at: null } : { start_at: null }, `step ${x.check!.seq} ${x.check!.doneAt ? 'finish' : 'start'} undone.`)}>↶ undo {x.check.doneAt ? 'finish' : 'start'}</button>}</span>
            </li>)}
          </ol>
        </section>
        {checks.length > 0 && <p className="-mt-2 text-[11px] text-slate-500">Jobs from {checks.find((c) => c.source && c.source !== 'Added on site')?.source ?? 'site'}: ▶ starts, ✓ finishes. The rest of the procedure is under Procedure, for reference.</p>}
        {isHead && trackerId && <AddJob onAdd={(text, crane, after) => { const seqs = checks.map((c) => c.seq);
          return addPointStep({ tracker_id: trackerId, point_id: p.id, seq: after ? Math.max(0, ...seqs) + 1 : Math.min(1, ...seqs) - 1, phase: after ? 'after' : 'before', text, kind: 'step', crane }).then(() => onDone(`${p.ref}: ${text} added.`)); }} />}
        {cErr != null && <ErrorBox error={cErr} />}
        {p.holdReason && <div className="flex items-center gap-2 rounded-lg bg-red-100 px-2.5 py-1.5 text-sm text-red-900"><span className="min-w-0 flex-1">⏸ On hold: {p.holdReason}</span>
          {canEdit && <button type="button" onClick={async () => { const was = p.holdReason!; try { await setPoint(p.id, { hold_reason: null }); onDone(`${p.ref}: resumed.`, () => setPoint(p.id, { hold_reason: was })); } catch (e) { setCErr(e); } }} className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-brand-700 ring-1 ring-red-200">▶ Resume</button>}</div>}
        {action && <div className="flex items-center justify-end gap-2">{canEdit && !p.holdReason && !pointComplete(p) && !hold && <button type="button" onClick={() => setHold(true)} className="text-xs font-semibold text-slate-500">⏸ Hold</button>}{action}</div>}
        {hold && <PendingForm initial={null} busy={false} onSave={async (r) => { try { await setPoint(p.id, { hold_reason: r }); setHold(false); onDone(`${p.ref}: on hold.`); } catch (e) { setCErr(e); } }} />}
        {err != null && <ErrorBox error={err} />}
        {trackerId && <LoopDiagrams trackerId={trackerId} loop={p} canAttach={canAttach} data={{ points, steps: checks, lineup }} />}
        <LoopScope p={p} items={scope.items} rtj={scope.rtj} canEdit={canEdit} onDone={onDone} />
        {p.items.length > 0 && <section>
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Items{(p.partOf ?? []).length ? ` · part of ${p.partOf!.join(', ')}` : ''}</h3>
          <div className="flex flex-wrap gap-1">{p.items.map((t) => scope.items.find((e) => e.tag === t)?.coveredBy
            ? <span key={t} className="rounded bg-slate-50 px-1.5 py-0.5 text-[12px] text-slate-600 ring-1 ring-slate-200" title="Covered by this loop">{t}</span>
            : <button key={t} type="button" onClick={() => onItem(t)} className="rounded bg-white px-1.5 py-0.5 text-[12px] font-semibold text-brand-600 ring-1 ring-slate-200">{t} ›</button>)}</div>
        </section>}
        {ll.length > 0 && <p className="text-[12px] text-slate-600">P&amp;ID lines: <b>{ll.join(', ')}</b>{onLine.map((i) => <span key={i.id} className="ml-1 rounded bg-amber-200 px-1 font-bold text-slate-800">IAT {i.iatNo} on {i.line}</span>)}</p>}
        {canEdit ? <LoopNote p={p} onDone={onDone} /> : p.remark && <p className="text-[12px] italic text-slate-600">📝 {p.remark}</p>}
        {p.updatedBy && <p className="text-[11px] text-slate-500">Last update {p.updatedBy}{p.updatedAt ? ` · ${when(p.updatedAt)}` : ''}</p>}
      </div>
    </BottomSheet>
  );
}

/** The items and RTJs of every loop (equipment, the RTJ / injection locations covered by their loop, the worklist RTJs). */
const LoopScopeCtx = createContext<{ items: TrkEquipment[]; rtj: TrkRtj[] }>({ items: [], rtj: [] });

/** A loop's handover to M & I and its RTJs. The handover is what is recorded on the loop's items (never the
 *  neutralization); the RTJs have no progress of their own: handed over with the loop. A location covered by the loop
 *  (off the Equipment list) is recorded handed over here. */
export function LoopScope({ p, items, rtj, canEdit, onDone, compact = false }: { p: TrkPoint; items: TrkEquipment[]; rtj: TrkRtj[]; canEdit: boolean; onDone: (msg: string, undo?: () => Promise<unknown>) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [open, setOpen] = useState(false);
  const ho = loopHandover(p, items);
  const mine = rtj.filter((r) => r.pointId === p.id);
  const lines = [...new Set(mine.map((r) => r.line))];
  const unver = mine.filter((r) => r.link === 'unverified').length;
  const hoText = ho.state === 'ho' ? 'Handed over to M & I' : ho.state === 'unknown' ? 'No handover record for this loop' : `Not handed over yet${ho.open.length ? ` · ${ho.open.join(', ')}` : ''}`;
  const rtjText = mine.length ? `RTJs ${mine.length} · ${ho.state === 'ho' ? 'handed over with the loop' : 'not handed over yet'}${unver ? ` · ${unver} link unverified` : ''}` : '';
  if (compact) return mine.length || ho.state !== 'unknown' ? <p className="mt-1 text-xs text-slate-600">{ho.state === 'ho' ? '✓ ' : ''}{hoText}{rtjText ? ` · ${rtjText}` : ''}</p> : null;
  const mark = async (e: TrkEquipment) => { setBusy(true); setErr(null);
    try { await setEquipment(e.id, { stage: 1 }); onDone(`${e.tag}: handed over (${p.ref}).`, () => setEquipment(e.id, { stage: e.stage })); } catch (x) { setErr(x); } finally { setBusy(false); } };
  const own = p.items.map((t) => items.find((e) => e.tag === t)).filter((e): e is TrkEquipment => !!e);
  if (!own.length && !mine.length) return null;
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Handover to M &amp; I</h3>
      <p className={cx('rounded-lg px-2.5 py-1.5 text-[12px] font-semibold', ho.state === 'ho' ? 'bg-green-50 text-green-800' : 'bg-slate-50 text-slate-700')}>{ho.state === 'ho' ? '✓ ' : ''}{hoText}{ho.total ? ` (${ho.done}/${ho.total} items)` : ''}</p>
      {own.length > 0 && <div className="flex flex-wrap gap-1">{own.map((e) => <span key={e.id} className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold ring-1', e.stage >= 1 ? 'bg-green-50 text-green-800 ring-green-200' : 'bg-white text-slate-700 ring-slate-200')}>
        {e.tag}{e.stage >= 1 ? ' ✓' : ''}{e.coveredBy && e.stage < 1 && canEdit && <button type="button" disabled={busy} onClick={() => void mark(e)} className="ml-1 rounded px-1.5 text-[11px] font-bold text-brand-700 ring-1 ring-brand-200">Record handover</button>}</span>)}</div>}
      {mine.length > 0 && <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-700">
        <button type="button" onClick={() => setOpen((x) => !x)} className="w-full text-left font-semibold">{open ? '▾' : '▸'} {rtjText}</button>
        <p className="text-[11px] text-slate-500">Lines {lines.join(', ')} · inspection worklist. Handed over is not the RTJ inspection or repair: new work goes on an IAT.</p>
        {open && <ul className="mt-1 space-y-0.5">{lines.map((l) => { const xs = mine.filter((r) => r.line === l);
          return <li key={l}><b>{l}</b> · {xs.length} · {xs.map((r) => `${r.rtjNo.replace('RTJ # ', '#')}${r.size ? ` ${r.size}` : ''}${r.fitting && r.fitting !== 'Flange RTJ' ? ` ${r.fitting.replace(' RTJ', '').toLowerCase()}` : ''}`).join(', ')}
            {xs[0].link === 'unverified' && <span className="block text-[11px] text-amber-800">Link unverified: {xs[0].linkNote}</span>}</li>; })}</ul>}
      </div>}
      {err != null && <ErrorBox error={err} />}
    </section>
  );
}

/** A loop's note (pH, remark), saved on the loop. */
function LoopNote({ p, onDone }: { p: TrkPoint; onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  const [note, setNote] = useState(p.remark ?? ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const was = p.remark ?? null;
  return <div><div className="flex gap-1.5"><input className="input" placeholder="Note: pH, remark…" value={note} onChange={(e) => setNote(e.target.value)} />
    <Button variant="secondary" disabled={busy || (note.trim() || null) === was} onClick={async () => { setBusy(true); setErr(null); try { await setPoint(p.id, { remark: note.trim() || null }); onDone(`${p.ref}: note saved.`, () => setPoint(p.id, { remark: was })); } catch (e) { setErr(e); } finally { setBusy(false); } }}>Save</Button></div>
    {err != null && <ErrorBox error={err} />}</div>;
}

/** A loop opened from the Handover list: its procedure, steps with times, field jobs, diagrams, items and RTJs, note. */
export function LoopDetail({ p, d, isHead, canEdit, canAttach, now, onClose, onItem, onStep, onDone }: {
  p: TrkPoint; d: { trackerId: string; points?: TrkPoint[]; pointSteps?: TrkPointStep[]; activities: TrkActivity[]; lineup?: LuStream[]; iats: TrkIat[]; steps: TrkStep[]; equipment: TrkEquipment[]; loopItems?: TrkEquipment[]; rtj?: TrkRtj[] };
  isHead: boolean; canEdit: boolean; canAttach: boolean; now: number; onClose: () => void; onItem: (tag: string) => void; onStep?: (id: string) => void; onDone: (msg: string, undo?: () => Promise<unknown>) => void;
}) {
  const points = d.points ?? [];
  const checks = (d.pointSteps ?? []).filter((c) => c.pointId === p.id).map((c) => linkedStep(c, d.activities, points));
  const missing = p.status === 'open' ? missingBlinds(p, points) : [], waiting = p.status === 'open' ? waitingSteps(p, d.activities) : [];
  return <LoopScopeCtx.Provider value={{ items: [...d.equipment, ...(d.loopItems ?? [])], rtj: d.rtj ?? [] }}>
    <LoopSheet acts={d.activities} p={p} points={points} lineup={d.lineup ?? []} iats={d.iats} steps={d.steps} checks={checks} canEdit={canEdit} isHead={isHead} canAttach={canAttach} trackerId={d.trackerId}
      onDone={onDone} now={now} missing={missing} waiting={waiting} action={null} err={null} onClose={onClose} onItem={onItem} onStep={onStep} />
  </LoopScopeCtx.Provider>;
}
