// Isolation & neutralization: the critical blinds (segregation points) and the neutralization loops and items, entered
// once here. The database moves the rest: the items (handed over when all their blinds are in and the neutralization
// before handover is done), the guideline step of each row and the soda-ash bar-chart lines.
import { useEffect, useState, type ReactNode } from 'react';
import { linkedStep, withReactor, NEUT_FLOW, NEUT_LABEL, neutLabel, equipBlind, loopLines, missingBlinds, waitingSteps, type LuStream, type TrkIat, hoursText, kwDay, kwTime, pointComplete, soakLeft, type PointStatus, type TrkActivity, type TrkPoint, type TrkPointStep, type TrkStep } from '@/core/tracker';
import { addPointStep, setActivity, setPoint, setPointStep, setPointStepTime } from '@/data/tracker';
import { BottomSheet, Button, ErrorBox, cx } from '@/ui/components';
import { CRow, IsoChip, MenuBtn, RowBtn, RowList, Tile } from './ui';
import { PendingForm } from './TrackerSheets';

/** The SOP lines the Section Head follows: the timed field jobs (crane, blinds, elbows, scaffolding) and the lab pH.
 *  The others (hoses, valves closed, draining, clear soda ash at the vents) are the procedure, shown for reference. */
export const followed = (c: TrkPointStep) => c.kind === 'step' || /\bpH\b/.test(c.text);

const when = (iso: string | null) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '');
const BLIND_LABEL: Record<string, string> = { open: 'Not blinded', in: 'Blinded', out: 'Deblinded' };
const SPRAY: Record<string, [PointStatus, string] | undefined> = { open: ['filling', '▶ Spray'], filling: ['done', '✓ Done'] };
const NEXT: Record<string, [PointStatus, string] | undefined> = {
  open: ['filling', '▶ Fill'], filling: ['soaking', 'Soaking'], soaking: ['draining', 'Draining'], draining: ['done', '✓ Done'],
};

function PointRow({ p, points, acts = [], lineup = [], iats = [], steps = [], checks: raw = [], trackerId, isHead, now, canEdit, onItem, onStep, onDone }: { p: TrkPoint; points: TrkPoint[]; acts?: TrkActivity[]; lineup?: LuStream[]; iats?: TrkIat[]; steps?: TrkStep[]; checks?: TrkPointStep[]; trackerId?: string; isHead: boolean; now: number; canEdit: boolean; onItem: (tag: string) => void; onStep?: (id: string) => void; onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  const [force, setForce] = useState(false); const [sheet, setSheet] = useState(false);
  const checks = raw.map((c) => linkedStep(c, acts, points));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState(p.remark ?? '');
  useEffect(() => { setBusy(false); }, [p.status, p.holdReason, p.remark, p.inAt, p.outAt]);
  async function run(patch: Parameters<typeof setPoint>[1], msg: string, close?: () => void, undo?: Parameters<typeof setPoint>[1]) { setBusy(true); setErr(null); try { await setPoint(p.id, patch); close?.(); onDone(msg, undo ? () => setPoint(p.id, undo) : undefined); window.setTimeout(() => setBusy(false), 8000); } catch (e) { setErr(e); setBusy(false); } }
  const blind = p.kind === 'blind';
  const left = soakLeft(p, now);
  const back = blind ? (p.status === 'out' ? 'in' : 'open') : p.method === 'spray' ? (p.status === 'done' ? 'filling' : 'open') : NEUT_FLOW[Math.max(0, NEUT_FLOW.indexOf(p.status as typeof NEUT_FLOW[number]) - 1)];
  const spray = p.method === 'spray';
  const next = blind ? undefined : (spray ? SPRAY : NEXT)[p.status];
  const items = p.items.join(', ');
  // the name often starts with the ref (E-12-205 · E-12-205 neutralization), show it once
  const name = p.name.startsWith(p.ref) ? p.name.slice(p.ref.length).trim() : p.name;
  // a loop waits for its blinds: locked until M & I has them in (the Section Head may start it anyway)
  const missing = !blind && p.status === 'open' ? missingBlinds(p, points) : [];
  // the reactor body spray waits for the catalyst dumping
  const waiting = !blind && p.status === 'open' ? waitingSteps(p, acts) : [];
  // and for its field jobs before the fill (crane lifts, blinding, scaffolding): started and finished first
  const jobs = !blind && p.status === 'open' ? checks.filter((c) => c.kind === 'step' && c.phase === 'before' && !c.doneAt) : [];
  const locked = missing.length + waiting.length + jobs.length > 0;
  const loopState = pointComplete(p) ? 'ready' : p.status !== 'open' ? 'neut' : locked ? 'blind' : 'idle';
  const dot = pointComplete(p) ? 'green' : locked ? 'red' : left !== null && left <= 0 ? 'amber' : p.status !== 'open' ? 'amber' : 'grey';
  const reqName = (r: string) => points.find((b) => b.kind === 'blind' && b.ref === r)?.name ?? '';
  const sub = blind
    ? (p.status === 'open' ? items || '—' : `✓ In ${when(p.inAt)}${p.outAt ? ` · out ${when(p.outAt)}` : ''}${p.updatedBy ? ` · ${p.updatedBy}` : ''}`)
    : locked ? <b className="text-red-800">🔒 {missing.length ? `Needs blinds: ${missing.map((r) => `${r} ${reqName(r)}`.trim()).join(', ')}` : waiting.length ? `After: ${waiting.every((x) => /dump/i.test(x)) ? 'catalyst dumping' : waiting.join(', ')}` : `Needs ${jobs.length} job${jobs.length > 1 ? 's' : ''} done: ${jobs.map((c) => c.text.split(',')[0]).join(' · ')}`}</b>
    : <>{p.holdReason ? <b className="text-red-800">⏸ On hold: {p.holdReason} · </b> : null}{(p.requires ?? []).length > 0 && p.status === 'open' ? 'Blinds ready ✓ · ' : ''}{neutLabel(p)}{left !== null ? <b className={left > 0 ? 'text-amber-800' : 'text-green-800'}> · {left > 0 ? `${hoursText(left)} left` : 'soak reached'}</b> : null}{p.status === 'done' && p.doneAt ? ` ${when(p.doneAt)}` : ''}</>;
  const extra = blind ? null : <>
    {locked && (p.requires ?? []).map((r) => <IsoChip key={r} state={missing.includes(r) ? 'blind' : 'ready'}>{r} {missing.includes(r) ? '✗' : '✓'}</IsoChip>)}
    {p.items.map((t) => <IsoChip key={t} state={loopState}>{t}</IsoChip>)}
    {checks.some((c) => c.kind === 'step' && c.startAt && !c.doneAt) && <span className="rounded bg-brand-600 px-1 text-[10px] font-bold text-white">▶ {checks.filter((c) => c.kind === 'step' && c.startAt && !c.doneAt).length} running</span>}
    {checks.some((c) => c.crane && !c.doneAt) && <span className="rounded bg-status-red px-1 text-[10px] font-bold text-white">🏗 Crane</span>}
    {checks.some(followed) && <span className={cx('rounded px-1 text-[10px] font-bold', checks.filter(followed).every((c) => c.doneAt) ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600')}>📋 {checks.filter(followed).filter((c) => c.doneAt).length}/{checks.filter(followed).length}</span>}
    {(p.partOf ?? []).length > 0 && <span className="text-[11px] font-semibold text-slate-500">part of {p.partOf!.map((t) => t.replace('-12-', '-')).join(', ')} · on its own</span>}
  </>;
  const action = !canEdit ? null
    : blind ? (p.status === 'open' ? <RowBtn disabled={busy} onClick={() => run({ status: 'in' }, `${p.ref} blinded.`)}>Blinded</RowBtn>
      : p.status === 'in' ? <RowBtn tone="ghost" disabled={busy} onClick={() => run({ status: 'out' }, `${p.ref} deblinded.`)}>Deblinded</RowBtn> : <span className="shrink-0 text-[11px] font-bold text-brand-600">Out</span>)
    : locked && !force ? <RoundBtn kind="lock" label={spray ? 'Spray' : 'Fill'} disabled={busy || !isHead} onClick={() => setForce(true)} />
    : next ? <RoundBtn kind={p.status === 'open' ? 'start' : 'finish'} label={next[1].replace(/^[▶✓]\s*/, '')} disabled={busy}
        onClick={() => run({ status: next[0], ...(p.holdReason ? { hold_reason: null } : {}) }, `${p.ref}: ${(next[0] === 'filling' && spray ? 'spraying' : NEUT_LABEL[next[0]].toLowerCase())}.${p.holdReason ? ' Hold ended.' : ''}`, undefined,
          { status: p.status, ...(p.holdReason ? { hold_reason: p.holdReason } : {}) })} />
    : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-sm font-bold text-status-green">✓</span>;
  return (
    <>
      {force && locked && <div className="mx-2.5 mt-1 rounded-lg bg-red-50 p-2 text-xs text-red-900">Start {p.ref} {missing.length ? `without ${missing.join(', ')}` : waiting.length ? `before ${waiting.join(', ')}` : `before ${jobs.length} job${jobs.length > 1 ? 's are' : ' is'} finished`}? It is logged as a Section Head override.
        <div className="mt-1.5 flex gap-1.5"><RowBtn tone="navy" disabled={busy} onClick={() => run({ status: 'filling' }, `${p.ref}: ${spray ? 'spraying' : 'filling'} (override).`, () => setForce(false))}>Start anyway</RowBtn><RowBtn tone="ghost" onClick={() => setForce(false)}>Cancel</RowBtn></div></div>}
      <CRow dot={dot} extra={extra} title={<>{p.ref}{name ? ` · ${name}` : ''}{p.remark ? <span className="font-normal text-slate-500"> · 📝</span> : null}</>} sub={blind ? sub : <span className="flex items-center gap-2"><PhaseDots p={p} /><span className="min-w-0 truncate">{sub}</span></span>} action={action}
        onTitle={!blind ? () => setSheet(true) : p.items.length === 1 ? () => onItem(p.items[0]) : undefined}
        menu={(close) => (
          <>
            {p.detail && p.detail !== p.name && <p className="text-[11px] text-slate-600">{p.detail}</p>}
            {p.remark && <p className="text-xs italic text-slate-600">{p.remark}</p>}
            {p.kind === 'neut' && (() => { const ll = loopLines(p, lineup).lines; const onLine = iats.filter((i) => i.status === 'open' && i.line && ll.includes(i.line));
              return ll.length > 0 ? <p className="text-[11px] text-slate-600">P&amp;ID lines: <b>{ll.join(', ')}</b>{onLine.map((i) => <span key={i.id} className="ml-1 rounded bg-amber-200 px-1 font-bold text-slate-800">IAT {i.iatNo} on {i.line}</span>)}</p> : null; })()}
            {p.items.length > 0 && <div className="flex flex-wrap gap-1">{p.items.map((t) => <button key={t} type="button" onClick={() => onItem(t)} className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-brand-600 ring-1 ring-slate-200">{t} ›</button>)}</div>}
            {canEdit && <div className="flex flex-wrap gap-1.5">
              {p.status !== 'open' && <MenuBtn danger disabled={busy} onClick={() => run({ status: back as PointStatus }, `${p.ref} back to ${(blind ? BLIND_LABEL[back] : NEUT_LABEL[back]).toLowerCase()}.`, close)}>↶ Undo</MenuBtn>}
            </div>}
            {canEdit && <div className="flex gap-1.5"><input className="input" placeholder="Note: pH, remark…" value={note} onChange={(e) => setNote(e.target.value)} /><Button variant="secondary" disabled={busy} onClick={() => run({ remark: note.trim() || null }, `${p.ref}: note saved.`, close)}>Save</Button></div>}
          </>
        )} />
      {err != null && <ErrorBox error={err} />}
      {sheet && <LoopSheet acts={acts} p={p} points={points} lineup={lineup} iats={iats} steps={steps} checks={checks} canEdit={canEdit} isHead={isHead} trackerId={trackerId} onDone={onDone} now={now} missing={missing} waiting={waiting} action={action} err={err}
        onClose={() => setSheet(false)} onItem={(t) => { setSheet(false); onItem(t); }} onStep={onStep ? (id) => { setSheet(false); onStep(id); } : undefined} />}
    </>
  );
}

/** The round step button of the rows (as on the equipment list): ▶ starts, ✓ finishes the phase, 🔒 waits. */
function RoundBtn({ kind, label, disabled, onClick }: { kind: 'start' | 'finish' | 'lock'; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <span className="flex shrink-0 flex-col items-center">
      <button type="button" disabled={disabled} onClick={onClick} aria-label={label} title={label}
        className={cx('flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shadow-sm disabled:opacity-60', kind === 'lock' ? 'bg-slate-200 text-slate-500' : kind === 'finish' ? 'bg-amber-400 text-slate-900 ring-1 ring-amber-500' : 'bg-brand-700 text-white')}>
        {kind === 'lock' ? '🔒' : kind === 'finish' ? '✓' : '▶'}
      </button>
      <span className="mt-0.5 text-[10px] font-semibold text-slate-500">{label}</span>
    </span>
  );
}
/** A loop's phases as dots (like the equipment stage bar): fill, soak, drain, done (spray: spray, done). */
function PhaseDots({ p }: { p: TrkPoint }) {
  const n = p.method === 'spray' ? 2 : 4;
  const at = p.status === 'done' ? n : p.method === 'spray' ? (p.status === 'open' ? 0 : 1) : Math.max(0, NEUT_FLOW.indexOf(p.status as typeof NEUT_FLOW[number]));
  return <span className="flex shrink-0 gap-0.5">{Array.from({ length: n }, (_, i) => <span key={i} className={cx('h-1.5 w-3 rounded-full', i < at ? 'bg-status-green' : i === at && p.status !== 'open' ? 'bg-amber-400' : 'bg-slate-200')} />)}</span>;
}

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
function LoopSheet({ acts = [], p, points, lineup, iats, steps, checks, canEdit, isHead, trackerId, onDone, now, missing, waiting, action, err, onClose, onItem, onStep }: { p: TrkPoint; points: TrkPoint[]; lineup: LuStream[]; iats: TrkIat[]; steps: TrkStep[]; checks: TrkPointStep[]; canEdit: boolean; isHead: boolean; trackerId?: string; onDone: (msg: string, undo?: () => Promise<unknown>) => void; now: number;
  missing: string[]; waiting: string[]; action: ReactNode; err: unknown; acts?: TrkActivity[]; onClose: () => void; onItem: (tag: string) => void; onStep?: (id: string) => void }) {
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
        {p.items.length > 0 && <section>
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Items{(p.partOf ?? []).length ? ` · part of ${p.partOf!.join(', ')}` : ''}</h3>
          <div className="flex flex-wrap gap-1">{p.items.map((t) => <button key={t} type="button" onClick={() => onItem(t)} className="rounded bg-white px-1.5 py-0.5 text-[12px] font-semibold text-brand-600 ring-1 ring-slate-200">{t} ›</button>)}</div>
        </section>}
        {ll.length > 0 && <p className="text-[12px] text-slate-600">P&amp;ID lines: <b>{ll.join(', ')}</b>{onLine.map((i) => <span key={i.id} className="ml-1 rounded bg-amber-200 px-1 font-bold text-slate-800">IAT {i.iatNo} on {i.line}</span>)}</p>}
        {p.remark && <p className="text-[12px] italic text-slate-600">📝 {p.remark}</p>}
        {p.updatedBy && <p className="text-[11px] text-slate-500">Last update {p.updatedBy}{p.updatedAt ? ` · ${when(p.updatedAt)}` : ''}</p>}
      </div>
    </BottomSheet>
  );
}

/** An item's blind (its blind line in the bar chart), installed by M & I: Blinded stamps the line finished. */
function EquipBlindRow({ a, canEdit, onItem, onDone }: { a: TrkActivity; canEdit: boolean; onItem: (tag: string) => void; onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function run(patch: Parameters<typeof setActivity>[1], msg: string, close?: () => void) { setBusy(true); setErr(null); try { await setActivity(a.id, patch); close?.(); onDone(msg); } catch (e) { setErr(e); } finally { setBusy(false); } }
  const done = !!a.actualFinish;
  return (
    <>
      <CRow dot={done ? 'green' : 'grey'} title={<>{a.key} · {a.activity}</>} onTitle={() => onItem(a.key)}
        sub={done ? `✓ In ${when(a.actualFinish ?? null)}${a.updatedBy ? ` · ${a.updatedBy}` : ''}` : a.start ? `Plan ${when(a.start)}` : '—'}
        action={canEdit && !done ? <RowBtn disabled={busy} onClick={() => { const t = new Date().toISOString(); run({ actual_start: a.actualStart ?? t, actual_finish: t }, `${a.key} blinded.`); }}>Blinded</RowBtn> : done ? <span className="shrink-0 text-[11px] font-bold text-status-green">Done</span> : null}
        menu={canEdit && done ? (close) => <MenuBtn danger disabled={busy} onClick={() => run({ actual_finish: null, actual_start: null }, `${a.key} back to not blinded.`, close)}>↶ Undo</MenuBtn> : undefined} />
      {err != null && <ErrorBox error={err} />}
    </>
  );
}

const GRP: [string, string][] = [['segregation', 'Segregation'], ['hp_critical', 'HP critical'], ['equipment', 'Equipment']];

export function IsolationTab({ trackerId, initialKind, activities = [], points, pointSteps = [], lineup = [], iats = [], steps, now, canEdit, isHead = false, focus, onFocus, onItem, onStep, onDone }: {
  trackerId?: string; initialKind?: 'blind' | 'neut'; activities?: TrkActivity[]; points: TrkPoint[]; pointSteps?: TrkPointStep[]; lineup?: LuStream[]; iats?: TrkIat[]; steps: TrkStep[]; now: number; canEdit: boolean; isHead?: boolean; focus: string | null; onFocus: (tag: string | null) => void; onItem: (tag: string) => void; onStep?: (id: string) => void; onDone: (msg: string, undo?: () => Promise<unknown>) => void;
}) {
  const [kind, setKind] = useState<'blind' | 'neut'>(() => initialKind ?? (focus && !points.some((p) => p.kind === 'blind' && p.items.includes(focus)) ? 'neut' : 'blind'));
  const [grp, setGrp] = useState('segregation');
  const eqBlinds = activities.filter(equipBlind).filter((a) => !focus || a.key === focus).sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || a.key.localeCompare(b.key));
  const [fo, setFo] = useState('All'); const [showDone, setShowDone] = useState(false);
  const blinds = points.filter((p) => p.kind === 'blind'), neut = points.filter((p) => p.kind === 'neut');
  const gate = neut.filter((p) => p.beforeHo);
  const soaking = neut.filter((p) => p.status === 'soaking').length;
  // the reactor body sprays stay with their reactor (covered there), not listed here
  const list = points.filter((p) => p.kind === kind && !(kind === 'neut' && withReactor(p)) && (kind === 'neut' || (p.grp ?? 'segregation') === grp) && (fo === 'All' || p.fo === fo) && (!focus || p.items.includes(focus) || (p.partOf ?? []).includes(focus))).sort((a, b) => a.sort - b.sort);
  const eqView = kind === 'blind' && grp === 'equipment';
  const open = list.filter((p) => !pointComplete(p)), closed = list.filter(pointComplete);
  const stepName = (id: string) => `${id} · ${steps.find((s) => s.stepId === id)?.shortName ?? ''}`;
  // a step with one row is shown in a shared section (the row already names the step), a step with 2+ rows keeps its own header
  const keyOf = (p: TrkPoint) => p.stepId ?? '';
  const per = new Map<string, number>(); for (const p of list) per.set(keyOf(p), (per.get(keyOf(p)) ?? 0) + 1);
  const secOf = (p: TrkPoint) => (!p.stepId ? (kind === 'neut' ? 'items' : 'loose') : (per.get(p.stepId) ?? 0) > 1 ? `step:${p.stepId}` : 'loose');
  const secTitle = (k: string) => (k.startsWith('step:') ? stepName(k.slice(5)) : k === 'items' ? 'Items' : kind === 'neut' ? 'Loops' : GRP.find(([g]) => g === grp)?.[1] ?? 'Blinds');
  const sections = (() => { const m = new Map<string, TrkPoint[]>(); for (const p of open) m.set(secOf(p), [...(m.get(secOf(p)) ?? []), p]); return [...m.entries()]; })();
  if (!points.length) return <p className="py-6 text-center text-sm text-slate-500">No blinds or neutralization set up for this shutdown.</p>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Tile value={`${blinds.filter(pointComplete).length + activities.filter(equipBlind).filter((a) => a.actualFinish).length}/${blinds.length + activities.filter(equipBlind).length}`} label="blinds in" onClick={() => setKind('blind')} />
        <Tile value={`${gate.filter(pointComplete).length}/${gate.length}`} label="neutralized" tone={gate.every(pointComplete) ? 'green' : undefined} onClick={() => setKind('neut')} />
        <Tile value={soaking} label="soaking now" tone={soaking ? 'amber' : undefined} onClick={() => setKind('neut')} />
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/60 p-1">
        {([['blind', 'Blinds (M & I)'], ['neut', 'Neutralization']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setKind(k)} className={cx('min-h-10 rounded-lg text-xs font-semibold', kind === k ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-600')}>{l}</button>)}
      </div>
      {kind === 'blind' && <div className="flex gap-1.5">{GRP.map(([k, l]) => { const n = k === 'equipment' ? `${eqBlinds.filter((a) => a.actualFinish).length}/${eqBlinds.length}` : `${blinds.filter((p) => (p.grp ?? 'segregation') === k && pointComplete(p)).length}/${blinds.filter((p) => (p.grp ?? 'segregation') === k).length}`;
        return <button key={k} type="button" onClick={() => setGrp(k)} className={cx('min-h-9 flex-1 rounded-lg px-2 text-xs font-semibold ring-1', grp === k ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-200')}>{l} <span className="opacity-70">{n}</span></button>; })}</div>}
      {eqView ? <div>{eqBlinds.length > 0 && <RowList>{eqBlinds.map((a) => <EquipBlindRow key={a.id} a={a} canEdit={canEdit} onItem={onItem} onDone={onDone} />)}</RowList>}{!eqBlinds.length && <p className="py-3 text-center text-sm text-slate-500">No blind lines in the bar chart{focus ? ` for ${focus}` : ''}.</p>}</div> : <>
      <div className="flex flex-wrap gap-1.5">
        {['All', 'FO1', 'FO2', 'FO3'].map((x) => <button key={x} type="button" onClick={() => setFo(x)} className={cx('min-h-9 rounded-full px-3 text-xs font-semibold', fo === x ? 'bg-brand-500 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{x}</button>)}
        {focus && <button type="button" onClick={() => onFocus(null)} className="min-h-9 rounded-full bg-amber-100 px-3 text-xs font-semibold text-amber-900">{focus} ✕</button>}
      </div>
      {sections.map(([k, xs]) => { const all = list.filter((p) => secOf(p) === k); return (
        <section key={k} className="space-y-1">
          <h3 className="flex justify-between text-[11px] font-bold uppercase tracking-wide text-slate-500"><span className="truncate">{secTitle(k)}</span><span>{all.filter(pointComplete).length}/{all.length}</span></h3>
          <RowList>{xs.map((p) => <PointRow key={p.id} p={p} points={points} acts={activities} lineup={lineup} iats={iats} steps={steps} checks={pointSteps.filter((c) => c.pointId === p.id)} trackerId={trackerId} isHead={isHead} now={now} canEdit={canEdit} onItem={onItem} onStep={onStep} onDone={onDone} />)}</RowList>
        </section>
      ); })}
      {!open.length && <p className="py-3 text-center text-sm text-status-green">All {kind === 'blind' ? 'blinds are in' : 'neutralization is done'}{fo !== 'All' ? ` for ${fo}` : ''}.</p>}
      {closed.length > 0 && <button type="button" onClick={() => setShowDone((x) => !x)} className="text-sm font-semibold text-status-green">{showDone ? '▾' : '▸'} ✓ {kind === 'blind' ? 'Blinded' : 'Neutralized'} ({closed.length})</button>}
      {showDone && <RowList>{closed.map((p) => <PointRow key={p.id} p={p} points={points} acts={activities} lineup={lineup} iats={iats} steps={steps} checks={pointSteps.filter((c) => c.pointId === p.id)} trackerId={trackerId} isHead={isHead} now={now} canEdit={canEdit} onItem={onItem} onStep={onStep} onDone={onDone} />)}</RowList>}
      </>}
      <p className="text-[11px] text-slate-500">One tap here updates the rest: operations hands an item over when its neutralization is done, M &amp; I then installs the blinds (an item blinded counts as handed over), the guideline step ticks when all its rows are done, and the soda-ash and blind bar-chart lines take the times.</p>
    </div>
  );
}
