// The Live page by phase (owner, 14 Nov 2026, the simpler mock-up): a strip of the four phases, and in the start-up
// one card — the black oil cut-in, plan against the estimate (not confirmed), how far off, what runs now or what is
// next with one button — then one line each for what is left: M & I steps to record, small items open, Maintenance
// (Non-SD), issues. The M & I page as it was stays one tap away, folded.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { setStartupStep, type StartupStep } from '@/data/sdPage';
import { BACKDATE_LIMIT_H, type TrackerData } from '@/data/tracker';
import { startupReport } from '@/core/shutdown/startupReport';
import { startupVsPlan, DELAY_MIN_H } from '@/core/shutdown/stages';
import { startupNow, type LivePhase } from '@/core/shutdown/livePhase';
import { closeAllMi, type MiOpen } from '@/features/engineer/EngineerApp';
import { BottomSheet, ErrorBox, cx } from '@/ui/components';

const H = 36e5;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const kw = (t: number) => new Date(t + 3 * H);
/** Kuwait time, 12-hour (owner, 14 Nov 2026): "8:13 pm". */
const short = (tag: string) => tag.replace(/^([A-Z]{1,3})-12-/, '$1-');
const hm = (t: number) => { const d = kw(t), h = d.getUTCHours(), m = d.getUTCMinutes(); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const at = (t: number) => `${kw(t).getUTCDate()} ${MON[kw(t).getUTCMonth()]} ${hm(t)}`;
const r30 = (t: number) => Math.round(t / (30 * 60e3)) * 30 * 60e3;
const hrs = (h: number) => (Math.abs(h) >= 48 ? `${Math.round((h / 24) * 10) / 10} d` : `${Math.round(h * 10) / 10} h`);

const LABEL: Record<LivePhase, string> = { ops: 'Ops', mi: 'M&I', startup: 'Start-up', service: 'In service' };
/** Operations → M & I → Start-up → In service: done ✓, the current one dark, M & I amber while it still has open main steps. */
export function PhaseStrip({ phase, miOpen }: { phase: LivePhase; miOpen: number }) {
  const order: LivePhase[] = ['ops', 'mi', 'startup', 'service']; const cur = order.indexOf(phase);
  return (
    <div className="mb-2 flex gap-1 text-[11.5px] font-extrabold">
      {order.map((p, i) => <span key={p} className={cx('flex-1 rounded-lg py-1.5 text-center', i === cur ? 'bg-brand-700 text-white' : i < cur ? (p === 'mi' && miOpen ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-800') : 'bg-slate-200 text-slate-500')}>
        {i < cur && !(p === 'mi' && miOpen) ? '✓ ' : ''}{LABEL[p]}{p === 'mi' && miOpen > 0 && i < cur ? ` · ${miOpen} open` : ''}</span>)}
    </div>
  );
}

export function LiveStartup({ d, startup, eventId, now, canEdit, canClose, open, nonSd, issues, onItem, onEquip, onTab, onDone, children }: {
  d: TrackerData; startup: StartupStep[]; eventId: string; now: number; canEdit: boolean; canClose: boolean; open: MiOpen; nonSd: number; issues: number;
  onItem: (tag: string) => void; onEquip: () => void; onTab: (t: 'iats' | 'pmr') => void; onDone: (msg: string, undo?: () => Promise<unknown>) => void; children?: React.ReactNode }) {
  const [showIssues, setShowIssues] = useState(false); const [closing, setClosing] = useState(false);
  const rep = startupReport(startup, now), vp = startupVsPlan(startup, now);
  const oil = rep.stages.find((g) => g.oil);
  const plan = oil ? oil.planStart : rep.planEnd;
  const done = oil ? oil.state !== 'next' : rep.done === rep.total;
  const est = oil ? oil.start : rep.expectedEnd;
  const v = plan !== null && est !== null ? Math.round(((est - plan) / H) * 10) / 10 : null;
  const what = oil ? 'Black oil cut-in' : 'Start-up end';
  const Row = ({ label, right, tone, onClick, to }: { label: string; right: string; tone?: 'red' | 'grey'; onClick?: () => void; to?: string }) => {
    const cls = 'mb-1.5 flex min-h-11 w-full items-center justify-between rounded-xl bg-white px-3 text-left text-[13.5px] font-bold ring-1 ring-slate-200 active:bg-slate-50';
    const r = <span className={cx(tone === 'red' ? 'text-status-red' : tone === 'grey' ? 'font-medium text-slate-500' : 'text-slate-900')}>{right}</span>;
    return to ? <Link to={to} className={cls}><span>{label}</span>{r}</Link> : <button type="button" disabled={!onClick} onClick={onClick} className={cls}><span>{label}</span>{r}</button>;
  };
  return (
    <div className="mb-2">
      <section className="mb-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
        <div className="flex justify-between text-[10.5px] font-extrabold uppercase tracking-wider text-slate-500"><span>{what}</span><span>{rep.done} / {rep.total} steps</span></div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-slate-100 px-2.5 py-1.5"><span className="block text-[11px] text-slate-500">Plan</span><b className="whitespace-nowrap text-[16px] tabular-nums">{plan !== null ? at(plan) : '—'}</b></div>
          {done ? <div className="rounded-xl bg-green-50 px-2.5 py-1.5"><span className="block text-[11px] text-green-800">Actual</span><b className="whitespace-nowrap text-[16px] tabular-nums text-green-800">{est !== null ? at(est) : '—'}</b></div>
            : <div className="rounded-xl border-[1.5px] border-dashed border-slate-400 px-2.5 py-1.5"><span className="block text-[11px] text-slate-500">Estimated · not confirmed</span><b className="whitespace-nowrap text-[16px] tabular-nums text-slate-600">{est !== null ? `~${at(r30(est))}` : '—'}</b></div>}
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-blue-600" style={{ width: `${vp.actualPct}%` }} /></div>
        {v !== null && <p className="mt-1 text-[12.5px]"><b className={v >= DELAY_MIN_H ? 'text-status-red' : 'text-status-green'}>{Math.abs(v) < DELAY_MIN_H ? 'On plan' : `${v > 0 ? '+' : '−'}${hrs(Math.abs(v))}`}</b> <span className="text-slate-500">vs plan · {vp.actualPct}% by plan hours</span></p>}
        <CurrentStep startup={startup} eventId={eventId} now={now} canEdit={canEdit} reasons={rep.stages.flatMap((g) => g.reasons)} onDone={onDone} />
      </section>
      {open.total > 0 ? <section className="mb-2 rounded-2xl bg-white p-2 ring-2 ring-status-red/60">
        <p className="mb-1.5 px-1 text-[12px] font-extrabold uppercase tracking-wider text-status-red">Still open from M&I · {open.total}</p>
        {([['Main equipment', open.main], ['Rotating', open.rotating], ['Small items', open.small], ['PMRs', open.pmr]] as const).map(([l, xs]) => xs.length > 0 &&
          <Row key={l} label={l} right={`${xs.length}${xs.length <= 2 ? ` · ${xs.map((e) => short(e.tag)).join(', ')}` : ''} ›`} tone="red"
            onClick={() => (xs.length === 1 && l !== 'PMRs' ? onItem(xs[0].tag) : l === 'PMRs' ? onTab('pmr') : onEquip())} />)}
        {open.iats > 0 && <Row label="Hot work IATs" right={`${open.iats} ›`} tone="red" onClick={() => onTab('iats')} />}
        <p className="px-1 pb-1 text-[12px] text-slate-600">Start-up has begun: everything from M&I should be closed.</p>
        {canClose && <button type="button" onClick={() => setClosing(true)} className="min-h-11 w-full rounded-xl bg-status-red text-[14px] font-bold text-white">Close all {open.total}…</button>}
      </section> : <Row label="M&I" right="✓ everything closed" tone="grey" />}
      <Row label="Maintenance (Non-SD)" right={nonSd ? `${nonSd} ›` : 'none'} tone={nonSd ? undefined : 'grey'} to="/shutdowns?section=maintenance" />
      <Row label="Issues" right={issues ? `${issues} open ${showIssues ? '▴' : '›'}` : 'none'} tone={issues ? 'red' : 'grey'} onClick={issues ? () => setShowIssues((x) => !x) : undefined} />
      {showIssues && children}
      {closing && <CloseAllSheet d={d} open={open} onClose={() => setClosing(false)} onDone={(m, u) => { setClosing(false); onDone(m, u); }} />}
    </div>
  );
}

// ── The current step (owner, 14 Nov 2026): a bar from its start to its expected finish, the start and expected times
// large and coloured, Done with a choice of when it finished (now · its planned end once passed · another time), the
// next step in brief, and three buttons: All steps · Reasons · Share.
function CurrentStep({ startup, eventId, now, canEdit, reasons, onDone }: { startup: StartupStep[]; eventId: string; now: number; canEdit: boolean; reasons: string[];
  onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [finish, setFinish] = useState(false); const [showWhy, setShowWhy] = useState(false);
  const st = startupNow(startup, now);
  const steps = startup.filter((x) => x.status !== 'not_required' && x.kind !== 'hold');
  const run = st.running && st.running.kind !== 'hold' ? st.running : null;
  const a = run?.startedAt ? Date.parse(run.startedAt) : null, std = run?.stdHours ?? null;
  const exp = a !== null && std !== null ? a + std * H : null;
  const elapsed = a !== null ? (now - a) / H : 0, over = std !== null ? elapsed - std : 0;
  // the step after the current one: after the running step, else after the next one
  const cur = run ?? st.next; const after = cur ? steps.filter((x) => x.seq > cur.seq && x.status === 'not_started')[0] ?? null : null;
  const nextFrom = run ? Math.max(exp ?? now, now) : st.next?.stdHours != null ? now + st.next.stdHours * H : now;
  const idx = cur ? steps.findIndex((x) => x.id === cur.id) + 1 : steps.length;
  async function save(f: () => Promise<unknown>, msg: string, undo: () => Promise<unknown>) {
    setBusy(true); setErr(null); try { await f(); onDone(msg, undo); setFinish(false); } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  const start = (x: StartupStep) => { const t = new Date().toISOString(); const was = { status: x.status, started_at: x.startedAt, done_at: x.doneAt };
    return save(() => setStartupStep(x.id, { status: 'running', started_at: t }), `${x.title}: started ${hm(Date.parse(t))}.`, () => setStartupStep(x.id, was)); };
  const brief = (x: StartupStep | null, from: number) => x && <div className="mt-2.5 rounded-xl bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200">
    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Next</span>
    <p className="text-[12.5px]"><b>{x.title}</b>{x.stdHours != null ? ` · ${x.stdHours} h planned` : ''}</p>
    {x.stdHours != null && <p className="text-[11.5px] text-slate-500">from ~{at(r30(from))} to ~{at(r30(from + x.stdHours * H))}</p>}</div>;
  return (
    <div className="mt-2.5 border-t border-slate-100 pt-2.5">
      {run ? <>
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Now · step {idx} of {steps.length}</p>
        <p className="text-[15px] font-extrabold leading-snug">▶ {run.title}</p>
        {a !== null && exp !== null ? <>
          <div className="relative mt-2.5 h-3 overflow-hidden rounded-full bg-slate-200">
            <div className="absolute inset-y-0 left-0 bg-blue-600" style={{ width: `${Math.min(100, (elapsed / std!) * 100)}%` }} />
            {over > 0 && <div className="absolute inset-y-0 right-0 bg-status-red" style={{ width: `${Math.min(60, (over / elapsed) * 100)}%` }} />}
          </div>
          <div className="mt-1.5 flex items-end justify-between gap-2">
            <span><span className="block text-[10.5px] text-slate-500">Started</span><b className="text-[17px] tabular-nums text-blue-700">{hm(a)}</b></span>
            <span className={cx('pb-0.5 text-[12.5px] font-bold tabular-nums', over > 0 ? 'text-status-red' : 'text-slate-700')}>{hrs(elapsed)} of {std} h{over > 0 ? ` · +${hrs(over)} over` : ''}</span>
            <span className="text-right"><span className="block text-[10.5px] text-slate-500">Expected</span><b className={cx('text-[17px] tabular-nums', over > 0 ? 'text-status-red' : 'text-amber-700')}>{hm(exp)}</b></span>
          </div>
          {over > 0 && <Link to={`/sd/${eventId}`} className="mt-1 block text-[12px] font-semibold text-status-red">Past its expected finish · <u>give reason</u></Link>}
        </> : <p className="text-[12px] text-slate-500">since {a !== null ? at(a) : '—'} · no planned hours</p>}
        {canEdit && <button type="button" disabled={busy} onClick={() => setFinish(true)} className="mt-2.5 min-h-12 w-full rounded-xl bg-amber-400 text-[15px] font-bold text-amber-950 disabled:opacity-50">✓ Done</button>}
        {brief(after, nextFrom)}
      </> : st.running ? <>
        <p className="text-[13px] font-bold text-sky-800">⏸ On hold: {st.running.title}</p>
        <p className="text-[12px] text-slate-500">since {st.running.startedAt ? at(Date.parse(st.running.startedAt)) : '—'}</p>
        {brief(st.next, now)}
      </> : st.next ? <>
        {st.idleH !== null && <p className="text-[13px] font-bold text-amber-700">Nothing running · {hrs(st.idleH)}</p>}
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Step {idx} of {steps.length}</p>
        <p className="text-[15px] font-extrabold leading-snug">{st.next.title}{st.next.stdHours != null ? <span className="text-[12.5px] font-semibold text-slate-500"> · {st.next.stdHours} h</span> : ''}</p>
        {canEdit && <button type="button" disabled={busy} onClick={() => void start(st.next!)} className="mt-2.5 min-h-12 w-full rounded-xl bg-brand-700 text-[15px] font-bold text-white disabled:opacity-50">▶ Start</button>}
        {brief(after, nextFrom)}
      </> : <p className="text-[13px] font-bold text-status-green">✓ All start-up steps done</p>}
      {err != null && <ErrorBox error={err} />}
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <Link to={`/sd/${eventId}`} className="flex min-h-10 items-center justify-center rounded-xl bg-white text-[12.5px] font-bold text-brand-700 ring-1 ring-slate-300">All steps</Link>
        <button type="button" onClick={() => setShowWhy(true)} className="min-h-10 rounded-xl bg-white text-[12.5px] font-bold text-brand-700 ring-1 ring-slate-300">Reasons{reasons.length ? ` · ${reasons.length}` : ''}</button>
        <Link to={`/sd/${eventId}?share=1`} className="flex min-h-10 items-center justify-center rounded-xl bg-[#25d366] text-[12.5px] font-bold text-white">Share</Link>
      </div>
      {finish && run && <FinishSheet step={run} now={now} busy={busy} onClose={() => setFinish(false)} onSave={(t) => {
        const was = { status: run.status, started_at: run.startedAt, done_at: run.doneAt };
        void save(() => setStartupStep(run.id, { status: 'done', done_at: t }), `${run.title}: done ${at(Date.parse(t))}.`, () => setStartupStep(run.id, was));
      }} />}
      {showWhy && <BottomSheet open onClose={() => setShowWhy(false)} title="Reasons · lost time">
        <div className="space-y-1.5">{reasons.length ? reasons.map((r, i) => <p key={i} className="rounded-lg bg-orange-50 px-2.5 py-1.5 text-[13px] text-orange-900">{r}</p>)
          : <p className="text-[13px] text-slate-500">No lost time recorded.</p>}
          <Link to={`/sd/${eventId}`} className="block pt-1 text-center text-[13px] font-bold text-brand-700">Add or change a reason on the steps ›</Link></div>
      </BottomSheet>}
    </div>
  );
}

/** When the step finished: now, its planned end (once that has passed), or another time (not before its start, not
 *  in the future, a reason past the back-dating limit is asked on the steps page). */
function FinishSheet({ step, now, busy, onClose, onSave }: { step: StartupStep; now: number; busy: boolean; onClose: () => void; onSave: (iso: string) => void }) {
  const a = step.startedAt ? Date.parse(step.startedAt) : null; const planEnd = a !== null && step.stdHours != null ? a + step.stdHours * H : null;
  const [pick, setPick] = useState<'now' | 'plan' | 'other'>('now');
  const kwInput = (t: number) => new Date(t + 3 * H).toISOString().slice(0, 16);
  const [other, setOther] = useState(kwInput(now));
  const otherT = Date.parse(`${other}:00+03:00`);
  const t = pick === 'now' ? Date.now() : pick === 'plan' ? planEnd! : otherT;
  const bad = Number.isNaN(t) || (a !== null && t < a) || t > Date.now() + 15 * 60e3 || Date.now() - t > BACKDATE_LIMIT_H * H;
  const opt = (k: 'now' | 'plan' | 'other', label: string, right: React.ReactNode) => <button key={k} type="button" onClick={() => setPick(k)} className={cx('flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-[13.5px] ring-1', pick === k ? 'bg-indigo-50 font-bold ring-brand-700' : 'ring-slate-300')}><span>{pick === k ? '● ' : '○ '}{label}</span>{right}</button>;
  return (
    <BottomSheet open onClose={onClose} title="Finished at">
      <div className="space-y-2">
        <p className="text-[12px] text-slate-500">{step.title}{a !== null ? ` · started ${at(a)}` : ''}</p>
        {opt('now', 'Now', <b className="tabular-nums">{hm(now)}</b>)}
        {planEnd !== null && planEnd <= now && opt('plan', 'At its planned end', <b className="tabular-nums">{at(planEnd)}</b>)}
        {opt('other', 'Other time', <span className="text-slate-500">{pick === 'other' ? '' : 'pick ▾'}</span>)}
        {pick === 'other' && <input type="datetime-local" className="input min-h-11 w-full text-[14px]" value={other} max={kwInput(Date.now())} onChange={(x) => setOther(x.target.value)} />}
        {bad && pick === 'other' && <p className="text-[12px] font-semibold text-status-red">Not before its start, not in the future, and within {BACKDATE_LIMIT_H} h (older: on the steps page with a reason).</p>}
        <button type="button" disabled={busy || bad} onClick={() => onSave(new Date(t).toISOString())} className="min-h-12 w-full rounded-xl bg-brand-700 text-[15px] font-bold text-white disabled:opacity-50">✓ Done at {Number.isNaN(t) ? '—' : at(t)}</button>
        <p className="text-center text-[11.5px] text-slate-500">Undo right after · the next step starts when you tap Start</p>
      </div>
    </BottomSheet>
  );
}

/** Confirm closing everything still open from M & I (Section Head). */
function CloseAllSheet({ d, open, onClose, onDone }: { d: TrackerData; open: MiOpen; onClose: () => void; onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const rows = ([['Main equipment', open.main.length], ['Rotating', open.rotating.length], ['Small items', open.small.length], ['PMRs', open.pmr.length], ['Hot work IATs', open.iats]] as const).filter(([, n]) => n > 0);
  async function go() {
    setBusy(true); setErr(null);
    try { const undo = await closeAllMi(d, open); onDone(`M&I: ${open.total} closed.`, undo); } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title={`Close all ${open.total} from M&I`}>
      <div className="space-y-2">
        <div className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">{rows.map(([l, n]) => <div key={l} className="flex justify-between px-3 py-2 text-[13.5px]"><span>{l}</span><b>{n}</b></div>)}</div>
        <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-slate-600">
          <li>Items are set to <b>Completed</b>; hot work IATs to <b>Completed</b>.</li>
          <li>Steps not yet done are marked <b>not required</b> with the note “Closed at M&I end · no time recorded” — no finish time is made up.</li>
          <li>Undo right after puts everything back.</li>
        </ul>
        {err != null && <ErrorBox error={err} />}
        <button type="button" disabled={busy} onClick={() => void go()} className="min-h-12 w-full rounded-xl bg-status-red text-[15px] font-bold text-white disabled:opacity-50">{busy ? 'Closing…' : `Close all ${open.total}`}</button>
        <button type="button" onClick={onClose} className="min-h-11 w-full rounded-xl text-[14px] font-semibold text-slate-600 ring-1 ring-slate-300">Cancel</button>
      </div>
    </BottomSheet>
  );
}
