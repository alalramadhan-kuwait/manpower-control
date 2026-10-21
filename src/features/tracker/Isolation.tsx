// Isolation & neutralization: the critical blinds (segregation points) and the neutralization loops and items, entered
// once here. The database moves the rest: the items (handed over when all their blinds are in and the neutralization
// before handover is done), the guideline step of each row and the soda-ash bar-chart lines.
import { useState, type ReactNode } from 'react';
import { NEUT_FLOW, NEUT_LABEL, neutLabel, equipBlind, loopLines, missingBlinds, waitingSteps, type LuStream, type TrkIat, hoursText, kwDay, kwTime, pointComplete, soakLeft, type PointStatus, type TrkActivity, type TrkPoint, type TrkPointStep, type TrkStep } from '@/core/tracker';
import { setActivity, setPoint, setPointStep } from '@/data/tracker';
import { BottomSheet, Button, ErrorBox, cx } from '@/ui/components';
import { CRow, IsoChip, MenuBtn, RowBtn, RowList, Tile } from './ui';

const when = (iso: string | null) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '');
const BLIND_LABEL: Record<string, string> = { open: 'Not blinded', in: 'Blinded', out: 'Deblinded' };
const SPRAY: Record<string, [PointStatus, string] | undefined> = { open: ['filling', '▶ Spray'], filling: ['done', '✓ Done'] };
const NEXT: Record<string, [PointStatus, string] | undefined> = {
  open: ['filling', '▶ Fill'], filling: ['soaking', 'Soaking'], soaking: ['draining', 'Draining'], draining: ['done', '✓ Done'],
};

function PointRow({ p, points, acts = [], lineup = [], iats = [], steps = [], checks = [], isHead, now, canEdit, onItem, onStep, onDone }: { p: TrkPoint; points: TrkPoint[]; acts?: TrkActivity[]; lineup?: LuStream[]; iats?: TrkIat[]; steps?: TrkStep[]; checks?: TrkPointStep[]; isHead: boolean; now: number; canEdit: boolean; onItem: (tag: string) => void; onStep?: (id: string) => void; onDone: (msg: string) => void }) {
  const [force, setForce] = useState(false); const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState(p.remark ?? '');
  async function run(patch: Parameters<typeof setPoint>[1], msg: string, close?: () => void) { setBusy(true); setErr(null); try { await setPoint(p.id, patch); close?.(); onDone(msg); } catch (e) { setErr(e); } finally { setBusy(false); } }
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
  const locked = missing.length + waiting.length > 0;
  const loopState = pointComplete(p) ? 'ready' : p.status !== 'open' ? 'neut' : locked ? 'blind' : 'idle';
  const dot = pointComplete(p) ? 'green' : locked ? 'red' : left !== null && left <= 0 ? 'amber' : p.status !== 'open' ? 'amber' : 'grey';
  const reqName = (r: string) => points.find((b) => b.kind === 'blind' && b.ref === r)?.name ?? '';
  const sub = blind
    ? (p.status === 'open' ? items || '—' : `✓ In ${when(p.inAt)}${p.outAt ? ` · out ${when(p.outAt)}` : ''}${p.updatedBy ? ` · ${p.updatedBy}` : ''}`)
    : locked ? <b className="text-red-800">🔒 {missing.length ? `Needs blinds: ${missing.map((r) => `${r} ${reqName(r)}`.trim()).join(', ')}` : `After: ${waiting.every((x) => /dump/i.test(x)) ? 'catalyst dumping' : waiting.join(', ')}`}</b>
    : <>{(p.requires ?? []).length > 0 && p.status === 'open' ? 'Blinds ready ✓ · ' : ''}{neutLabel(p)}{left !== null ? <b className={left > 0 ? 'text-amber-800' : 'text-green-800'}> · {left > 0 ? `${hoursText(left)} left` : 'soak reached'}</b> : null}{p.status === 'done' && p.doneAt ? ` ${when(p.doneAt)}` : ''}</>;
  const extra = blind ? null : <>
    {locked && (p.requires ?? []).map((r) => <IsoChip key={r} state={missing.includes(r) ? 'blind' : 'ready'}>{r} {missing.includes(r) ? '✗' : '✓'}</IsoChip>)}
    {p.items.map((t) => <IsoChip key={t} state={loopState}>{t}</IsoChip>)}
    {checks.length > 0 && <span className={cx('rounded px-1 text-[10.5px] font-bold', checks.every((c) => c.doneAt) ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600')}>📋 {checks.filter((c) => c.doneAt).length}/{checks.length}</span>}
    {(p.partOf ?? []).length > 0 && <span className="text-[10.5px] font-semibold text-slate-500">part of {p.partOf!.map((t) => t.replace('-12-', '-')).join(', ')} · on its own</span>}
  </>;
  const action = !canEdit ? null
    : blind ? (p.status === 'open' ? <RowBtn disabled={busy} onClick={() => run({ status: 'in' }, `${p.ref} blinded.`)}>Blinded</RowBtn>
      : p.status === 'in' ? <RowBtn tone="ghost" disabled={busy} onClick={() => run({ status: 'out' }, `${p.ref} deblinded.`)}>Deblinded</RowBtn> : <span className="shrink-0 text-[11px] font-bold text-[#004080]">Out</span>)
    : locked && !force ? (isHead ? <RowBtn tone="ghost" disabled={busy} onClick={() => setForce(true)}>🔒 {spray ? 'Spray' : 'Fill'}</RowBtn> : <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-500">🔒 {spray ? 'Spray' : 'Fill'}</span>)
    : next ? <RowBtn tone={next[0] === 'done' ? 'green' : 'navy'} disabled={busy} onClick={() => run({ status: next[0] }, `${p.ref}: ${(next[0] === 'filling' && spray ? 'spraying' : NEUT_LABEL[next[0]].toLowerCase())}.`)}>{next[1]}</RowBtn>
    : <span className="shrink-0 text-[11px] font-bold text-[#08A048]">Done</span>;
  return (
    <>
      {force && locked && <div className="mx-2.5 mt-1 rounded-lg bg-red-50 p-2 text-xs text-red-900">Start {p.ref} {missing.length ? `without ${missing.join(', ')}` : `before ${waiting.join(', ')}`}? It is logged as a Section Head override.
        <div className="mt-1.5 flex gap-1.5"><RowBtn tone="navy" disabled={busy} onClick={() => run({ status: 'filling' }, `${p.ref}: ${spray ? 'spraying' : 'filling'} (override).`, () => setForce(false))}>Start anyway</RowBtn><RowBtn tone="ghost" onClick={() => setForce(false)}>Cancel</RowBtn></div></div>}
      <CRow dot={dot} extra={extra} title={<>{p.ref}{name ? ` · ${name}` : ''}{p.remark ? <span className="font-normal text-slate-500"> · 📝</span> : null}</>} sub={sub} action={action}
        onTitle={!blind ? () => setSheet(true) : p.items.length === 1 ? () => onItem(p.items[0]) : undefined}
        menu={(close) => (
          <>
            {p.detail && p.detail !== p.name && <p className="text-[11px] text-slate-600">{p.detail}</p>}
            {p.remark && <p className="text-xs italic text-slate-600">{p.remark}</p>}
            {p.kind === 'neut' && (() => { const ll = loopLines(p, lineup).lines; const onLine = iats.filter((i) => i.status === 'open' && i.line && ll.includes(i.line));
              return ll.length > 0 ? <p className="text-[11px] text-slate-600">P&amp;ID lines: <b>{ll.join(', ')}</b>{onLine.map((i) => <span key={i.id} className="ml-1 rounded bg-[#FFE699] px-1 font-bold text-slate-800">IAT {i.iatNo} on {i.line}</span>)}</p> : null; })()}
            {p.items.length > 0 && <div className="flex flex-wrap gap-1">{p.items.map((t) => <button key={t} type="button" onClick={() => onItem(t)} className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-[#004080] ring-1 ring-slate-200">{t} ›</button>)}</div>}
            {canEdit && <div className="flex flex-wrap gap-1.5">
              {p.status !== 'open' && <MenuBtn danger disabled={busy} onClick={() => run({ status: back as PointStatus }, `${p.ref} back to ${(blind ? BLIND_LABEL[back] : NEUT_LABEL[back]).toLowerCase()}.`, close)}>↶ Undo</MenuBtn>}
            </div>}
            {canEdit && <div className="flex gap-1.5"><input className="input" placeholder="Note: pH, remark…" value={note} onChange={(e) => setNote(e.target.value)} /><Button variant="secondary" disabled={busy} onClick={() => run({ remark: note.trim() || null }, `${p.ref}: note saved.`, close)}>Save</Button></div>}
          </>
        )} />
      {err != null && <ErrorBox error={err} />}
      {sheet && <LoopSheet p={p} points={points} lineup={lineup} iats={iats} steps={steps} checks={checks} canEdit={canEdit} onDone={onDone} now={now} missing={missing} waiting={waiting} action={action} err={err}
        onClose={() => setSheet(false)} onItem={(t) => { setSheet(false); onItem(t); }} onStep={onStep ? (id) => { setSheet(false); onStep(id); } : undefined} />}
    </>
  );
}

/** A neutralization opened: its procedure (the guideline step), the steps of the loop with their times, and the next action. */
function LoopSheet({ p, points, lineup, iats, steps, checks, canEdit, onDone, now, missing, waiting, action, err, onClose, onItem, onStep }: { p: TrkPoint; points: TrkPoint[]; lineup: LuStream[]; iats: TrkIat[]; steps: TrkStep[]; checks: TrkPointStep[]; canEdit: boolean; onDone: (msg: string) => void; now: number;
  missing: string[]; waiting: string[]; action: ReactNode; err: unknown; onClose: () => void; onItem: (tag: string) => void; onStep?: (id: string) => void }) {
  const spray = p.method === 'spray';
  const step = p.stepId ? steps.find((x) => x.stepId === p.stepId) : undefined;
  const left = soakLeft(p, now);
  const at = NEUT_FLOW.indexOf(p.status as typeof NEUT_FLOW[number]);
  const dur = (a: string | null, b: string | null) => (a && b ? ` · ${hoursText(Date.parse(b) - Date.parse(a))}` : '');
  type Row = { label: string; done: boolean; now?: boolean; info?: string; check?: TrkPointStep };
  const [busy, setBusy] = useState<string | null>(null); const [cErr, setCErr] = useState<unknown>(null);
  const tick = async (c: TrkPointStep) => { setBusy(c.id); setCErr(null); try { await setPointStep(c.id, !c.doneAt); onDone(`${p.ref}: step ${c.seq} ${c.doneAt ? 'undone' : 'done'}.`); } catch (e) { setCErr(e); } finally { setBusy(null); } };
  const sop = (ph: TrkPointStep['phase']): Row[] => checks.filter((c) => c.phase === ph).map((c) => ({ label: c.text, done: !!c.doneAt, info: c.doneAt ? `${when(c.doneAt)}${c.doneBy ? ` · ${c.doneBy}` : ''}` : undefined, check: c }));
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
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-[#08A048]" style={{ width: `${(doneN / Math.max(total, 1)) * 100}%` }} /></div>
        {(step || (p.detail && p.detail !== p.name)) && <section className="rounded-xl bg-slate-50 p-2.5">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Procedure</h3>
          {step && <p className="mt-0.5 font-semibold text-slate-900">{step.stepId} · {step.shortName}{step.procedure ? <span className="font-normal text-slate-500"> · {step.procedure}</span> : null}</p>}
          {step?.text && <p className="mt-0.5 whitespace-pre-line text-[12.5px] text-slate-700">{step.text}</p>}
          {p.detail && p.detail !== p.name && p.detail !== step?.text && <p className="mt-0.5 text-[12.5px] text-slate-700">{p.detail}</p>}
          {step && onStep && <button type="button" onClick={() => onStep(step.stepId)} className="mt-1 text-xs font-semibold text-[#0850A0]">Open step {step.stepId} ›</button>}
        </section>}
        <section>
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Steps</h3>
          <ol className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
            {rows.map((x, i) => <li key={i} className="flex items-start gap-2 border-t border-slate-100 px-2.5 py-1.5 first:border-t-0">
              {x.check && canEdit
                ? <button type="button" disabled={busy === x.check.id} onClick={() => tick(x.check!)} aria-label={`${x.done ? 'Undo' : 'Tick'} step ${i + 1}`}
                    className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-bold ring-1 disabled:opacity-50', x.done ? 'bg-[#08A048] text-white ring-[#08A048]' : 'bg-white text-slate-400 ring-slate-300')}>{x.done ? '✓' : ''}</button>
                : <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', x.done ? 'bg-[#08A048] text-white' : x.now ? 'bg-amber-400 text-white' : 'bg-slate-200 text-slate-500')}>{x.done ? '✓' : i + 1}</span>}
              <span className="min-w-0 flex-1"><span className={cx('block', x.check ? 'text-[12.5px] font-medium' : 'font-semibold', x.done ? 'text-slate-900' : x.now ? 'text-amber-900' : 'text-slate-600')}>{x.label}{x.now ? ' · now' : ''}</span>
                {x.info && <span className="block text-[11.5px] text-slate-500">{x.info}</span>}</span>
            </li>)}
          </ol>
        </section>
        {checks[0]?.source && <p className="-mt-2 text-[10.5px] text-slate-400">Field steps from {checks[0].source}. Tick each as it is done.</p>}
        {cErr != null && <ErrorBox error={cErr} />}
        {action && <div className="flex justify-end">{action}</div>}
        {err != null && <ErrorBox error={err} />}
        {p.items.length > 0 && <section>
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Items{(p.partOf ?? []).length ? ` · part of ${p.partOf!.join(', ')}` : ''}</h3>
          <div className="flex flex-wrap gap-1">{p.items.map((t) => <button key={t} type="button" onClick={() => onItem(t)} className="rounded bg-white px-1.5 py-0.5 text-[12px] font-semibold text-[#004080] ring-1 ring-slate-200">{t} ›</button>)}</div>
        </section>}
        {ll.length > 0 && <p className="text-[12px] text-slate-600">P&amp;ID lines: <b>{ll.join(', ')}</b>{onLine.map((i) => <span key={i.id} className="ml-1 rounded bg-[#FFE699] px-1 font-bold text-slate-800">IAT {i.iatNo} on {i.line}</span>)}</p>}
        {p.remark && <p className="text-[12px] italic text-slate-600">📝 {p.remark}</p>}
        {p.updatedBy && <p className="text-[11px] text-slate-400">Last update {p.updatedBy}{p.updatedAt ? ` · ${when(p.updatedAt)}` : ''}</p>}
      </div>
    </BottomSheet>
  );
}

/** An item's blind (its blind line in the bar chart), installed by M & I: Blinded stamps the line finished. */
function EquipBlindRow({ a, canEdit, onItem, onDone }: { a: TrkActivity; canEdit: boolean; onItem: (tag: string) => void; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function run(patch: Parameters<typeof setActivity>[1], msg: string, close?: () => void) { setBusy(true); setErr(null); try { await setActivity(a.id, patch); close?.(); onDone(msg); } catch (e) { setErr(e); } finally { setBusy(false); } }
  const done = !!a.actualFinish;
  return (
    <>
      <CRow dot={done ? 'green' : 'grey'} title={<>{a.key} · {a.activity}</>} onTitle={() => onItem(a.key)}
        sub={done ? `✓ In ${when(a.actualFinish ?? null)}${a.updatedBy ? ` · ${a.updatedBy}` : ''}` : a.start ? `Plan ${when(a.start)}` : '—'}
        action={canEdit && !done ? <RowBtn disabled={busy} onClick={() => { const t = new Date().toISOString(); run({ actual_start: a.actualStart ?? t, actual_finish: t }, `${a.key} blinded.`); }}>Blinded</RowBtn> : done ? <span className="shrink-0 text-[11px] font-bold text-[#08A048]">Done</span> : null}
        menu={canEdit && done ? (close) => <MenuBtn danger disabled={busy} onClick={() => run({ actual_finish: null, actual_start: null }, `${a.key} back to not blinded.`, close)}>↶ Undo</MenuBtn> : undefined} />
      {err != null && <ErrorBox error={err} />}
    </>
  );
}

const GRP: [string, string][] = [['segregation', 'Segregation'], ['hp_critical', 'HP critical'], ['equipment', 'Equipment']];

export function IsolationTab({ initialKind, activities = [], points, pointSteps = [], lineup = [], iats = [], steps, now, canEdit, isHead = false, focus, onFocus, onItem, onStep, onDone }: {
  initialKind?: 'blind' | 'neut'; activities?: TrkActivity[]; points: TrkPoint[]; pointSteps?: TrkPointStep[]; lineup?: LuStream[]; iats?: TrkIat[]; steps: TrkStep[]; now: number; canEdit: boolean; isHead?: boolean; focus: string | null; onFocus: (tag: string | null) => void; onItem: (tag: string) => void; onStep?: (id: string) => void; onDone: (msg: string) => void;
}) {
  const [kind, setKind] = useState<'blind' | 'neut'>(() => initialKind ?? (focus && !points.some((p) => p.kind === 'blind' && p.items.includes(focus)) ? 'neut' : 'blind'));
  const [grp, setGrp] = useState('segregation');
  const eqBlinds = activities.filter(equipBlind).filter((a) => !focus || a.key === focus).sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || a.key.localeCompare(b.key));
  const [fo, setFo] = useState('All'); const [showDone, setShowDone] = useState(false);
  const blinds = points.filter((p) => p.kind === 'blind'), neut = points.filter((p) => p.kind === 'neut');
  const gate = neut.filter((p) => p.beforeHo);
  const soaking = neut.filter((p) => p.status === 'soaking').length;
  const list = points.filter((p) => p.kind === kind && (kind === 'neut' || (p.grp ?? 'segregation') === grp) && (fo === 'All' || p.fo === fo) && (!focus || p.items.includes(focus) || (p.partOf ?? []).includes(focus))).sort((a, b) => a.sort - b.sort);
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
        {([['blind', 'Blinds (M & I)'], ['neut', 'Neutralization']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setKind(k)} className={cx('min-h-10 rounded-lg text-xs font-semibold', kind === k ? 'bg-white text-[#004080] shadow-sm' : 'text-slate-600')}>{l}</button>)}
      </div>
      {kind === 'blind' && <div className="flex gap-1.5">{GRP.map(([k, l]) => { const n = k === 'equipment' ? `${eqBlinds.filter((a) => a.actualFinish).length}/${eqBlinds.length}` : `${blinds.filter((p) => (p.grp ?? 'segregation') === k && pointComplete(p)).length}/${blinds.filter((p) => (p.grp ?? 'segregation') === k).length}`;
        return <button key={k} type="button" onClick={() => setGrp(k)} className={cx('min-h-9 flex-1 rounded-lg px-2 text-xs font-semibold ring-1', grp === k ? 'bg-[#004080] text-white ring-[#004080]' : 'bg-white text-slate-700 ring-slate-200')}>{l} <span className="opacity-70">{n}</span></button>; })}</div>}
      {eqView ? <div>{eqBlinds.length > 0 && <RowList>{eqBlinds.map((a) => <EquipBlindRow key={a.id} a={a} canEdit={canEdit} onItem={onItem} onDone={onDone} />)}</RowList>}{!eqBlinds.length && <p className="py-3 text-center text-sm text-slate-500">No blind lines in the bar chart{focus ? ` for ${focus}` : ''}.</p>}</div> : <>
      <div className="flex flex-wrap gap-1.5">
        {['All', 'FO1', 'FO2', 'FO3'].map((x) => <button key={x} type="button" onClick={() => setFo(x)} className={cx('min-h-9 rounded-full px-3 text-xs font-semibold', fo === x ? 'bg-[#0850A0] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{x}</button>)}
        {focus && <button type="button" onClick={() => onFocus(null)} className="min-h-9 rounded-full bg-amber-100 px-3 text-xs font-semibold text-amber-900">{focus} ✕</button>}
      </div>
      {sections.map(([k, xs]) => { const all = list.filter((p) => secOf(p) === k); return (
        <section key={k} className="space-y-1">
          <h3 className="flex justify-between text-[11px] font-bold uppercase tracking-wide text-slate-500"><span className="truncate">{secTitle(k)}</span><span>{all.filter(pointComplete).length}/{all.length}</span></h3>
          <RowList>{xs.map((p) => <PointRow key={p.id} p={p} points={points} acts={activities} lineup={lineup} iats={iats} steps={steps} checks={pointSteps.filter((c) => c.pointId === p.id)} isHead={isHead} now={now} canEdit={canEdit} onItem={onItem} onStep={onStep} onDone={onDone} />)}</RowList>
        </section>
      ); })}
      {!open.length && <p className="py-3 text-center text-sm text-[#08A048]">All {kind === 'blind' ? 'blinds are in' : 'neutralization is done'}{fo !== 'All' ? ` for ${fo}` : ''}.</p>}
      {closed.length > 0 && <button type="button" onClick={() => setShowDone((x) => !x)} className="text-sm font-semibold text-[#08A048]">{showDone ? '▾' : '▸'} ✓ {kind === 'blind' ? 'Blinded' : 'Neutralized'} ({closed.length})</button>}
      {showDone && <RowList>{closed.map((p) => <PointRow key={p.id} p={p} points={points} acts={activities} lineup={lineup} iats={iats} steps={steps} checks={pointSteps.filter((c) => c.pointId === p.id)} isHead={isHead} now={now} canEdit={canEdit} onItem={onItem} onStep={onStep} onDone={onDone} />)}</RowList>}
      </>}
      <p className="text-[11px] text-slate-500">One tap here updates the rest: operations hands an item over when its neutralization is done, M &amp; I then installs the blinds (an item blinded counts as handed over), the guideline step ticks when all its rows are done, and the soda-ash and blind bar-chart lines take the times.</p>
    </div>
  );
}
