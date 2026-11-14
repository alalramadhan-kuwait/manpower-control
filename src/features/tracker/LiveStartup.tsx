// The Live page by phase (owner, 14 Nov 2026, the simpler mock-up): a strip of the four phases, and in the start-up
// one card — the black oil cut-in, plan against the estimate (not confirmed), how far off, what runs now or what is
// next with one button — then one line each for what is left: M & I steps to record, small items open, Maintenance
// (Non-SD), issues. The M & I page as it was stays one tap away, folded.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { setStartupStep, type StartupStep } from '@/data/sdPage';
import type { TrackerData } from '@/data/tracker';
import { startupReport } from '@/core/shutdown/startupReport';
import { startupVsPlan, DELAY_MIN_H } from '@/core/shutdown/stages';
import { startupNow, type LivePhase } from '@/core/shutdown/livePhase';
import type { MiItem, TrkEquipment } from '@/core/tracker';
import { ErrorBox, cx } from '@/ui/components';

const H = 36e5;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const kw = (t: number) => new Date(t + 3 * H);
const at = (t: number) => `${kw(t).getUTCDate()} ${MON[kw(t).getUTCMonth()]} ${kw(t).toISOString().slice(11, 16)}`;
const hm = (t: number) => kw(t).toISOString().slice(11, 16);
const r30 = (t: number) => Math.round(t / (30 * 60e3)) * 30 * 60e3;
const hrs = (h: number) => (Math.abs(h) >= 48 ? `${Math.round((h / 24) * 10) / 10} d` : `${Math.round(h * 10) / 10} h`);

const LABEL: Record<LivePhase, string> = { ops: 'Ops', mi: 'M&I', startup: 'Start-up', service: 'In service' };
/** Operations → M & I → Start-up → In service: done ✓, the current one dark, M & I amber while it still has open main steps. */
export function PhaseStrip({ phase, miOpen }: { phase: LivePhase; miOpen: boolean }) {
  const order: LivePhase[] = ['ops', 'mi', 'startup', 'service']; const cur = order.indexOf(phase);
  return (
    <div className="mb-2 flex gap-1 text-[11.5px] font-extrabold">
      {order.map((p, i) => <span key={p} className={cx('flex-1 rounded-lg py-1.5 text-center', i === cur ? 'bg-brand-700 text-white' : i < cur ? (p === 'mi' && miOpen ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-800') : 'bg-slate-200 text-slate-500')}>
        {i < cur && !(p === 'mi' && miOpen) ? '✓ ' : ''}{LABEL[p]}</span>)}
    </div>
  );
}

export function LiveStartup({ d, startup, eventId, now, canEdit, mainOpen, smallOpen, nonSd, issues, onItem, onEquip, onDone, children }: {
  d: TrackerData; startup: StartupStep[]; eventId: string; now: number; canEdit: boolean; mainOpen: MiItem[]; smallOpen: number; nonSd: number; issues: number;
  onItem: (tag: string) => void; onEquip: () => void; onDone: (msg: string, undo?: () => Promise<unknown>) => void; children?: React.ReactNode }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [showIssues, setShowIssues] = useState(false);
  const rep = startupReport(startup, now), vp = startupVsPlan(startup, now), st = startupNow(startup, now);
  const oil = rep.stages.find((g) => g.oil);
  const plan = oil ? oil.planStart : rep.planEnd;
  const done = oil ? oil.state !== 'next' : rep.done === rep.total;
  const est = oil ? oil.start : rep.expectedEnd;
  const v = plan !== null && est !== null ? Math.round(((est - plan) / H) * 10) / 10 : null;
  const what = oil ? 'Black oil cut-in' : 'Start-up end';
  async function move(s: StartupStep, to: 'running' | 'done') {
    const was = { status: s.status, started_at: s.startedAt, done_at: s.doneAt }; const t = new Date().toISOString();
    setBusy(true); setErr(null);
    try {
      await setStartupStep(s.id, to === 'running' ? { status: 'running', started_at: t } : { status: 'done', done_at: t });
      onDone(`${s.title}: ${to === 'running' ? 'started' : 'done'} ${hm(Date.parse(t))}.`, () => setStartupStep(s.id, was));
    } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  const mainTags = mainOpen.map((i) => d.equipment.find((e) => (e.barchartKey ?? e.tag) === i.key)).filter((e): e is TrkEquipment => !!e);
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
          <div className="rounded-xl bg-slate-100 px-2.5 py-1.5"><span className="block text-[11px] text-slate-500">Plan</span><b className="text-[17px] tabular-nums">{plan !== null ? at(plan) : '—'}</b></div>
          {done ? <div className="rounded-xl bg-green-50 px-2.5 py-1.5"><span className="block text-[11px] text-green-800">Actual</span><b className="text-[17px] tabular-nums text-green-800">{est !== null ? at(est) : '—'}</b></div>
            : <div className="rounded-xl border-[1.5px] border-dashed border-slate-400 px-2.5 py-1.5"><span className="block text-[11px] text-slate-500">Estimated · not confirmed</span><b className="text-[17px] tabular-nums text-slate-600">{est !== null ? `~${at(r30(est))}` : '—'}</b></div>}
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-blue-600" style={{ width: `${vp.actualPct}%` }} /></div>
        {v !== null && <p className="mt-1 text-[12.5px]"><b className={v >= DELAY_MIN_H ? 'text-status-red' : 'text-status-green'}>{Math.abs(v) < DELAY_MIN_H ? 'On plan' : `${v > 0 ? '+' : '−'}${hrs(Math.abs(v))}`}</b> <span className="text-slate-500">vs plan · {vp.actualPct}% by plan hours</span></p>}
        <div className="mt-2.5 border-t border-slate-100 pt-2.5">
          {st.running ? <>
            <p className="text-[13px]"><b className="text-blue-700">▶ {st.running.kind === 'hold' ? 'On hold: ' : ''}{st.running.title}</b></p>
            <p className="text-[12px] text-slate-500">since {st.running.startedAt ? at(Date.parse(st.running.startedAt)) : '—'}{st.running.stdHours != null ? ` · ${st.running.stdHours} h planned` : ''}</p>
            {canEdit && st.running.kind !== 'hold' && <button type="button" disabled={busy} onClick={() => void move(st.running!, 'done')} className="mt-2 min-h-11 w-full rounded-xl bg-amber-400 text-[15px] font-bold text-amber-950 disabled:opacity-50">✓ Done</button>}
          </> : st.next ? <>
            {st.idleH !== null && <p className="text-[13px] font-bold text-amber-700">Nothing running · {hrs(st.idleH)}</p>}
            <p className="text-[13px]">Next: <b>{st.next.title}</b>{st.next.stdHours != null ? <span className="text-slate-500"> · {st.next.stdHours} h</span> : ''}</p>
            {canEdit && <button type="button" disabled={busy} onClick={() => void move(st.next!, 'running')} className="mt-2 min-h-11 w-full rounded-xl bg-brand-700 text-[15px] font-bold text-white disabled:opacity-50">▶ Start</button>}
          </> : <p className="text-[13px] font-bold text-status-green">✓ All start-up steps done</p>}
          {err != null && <ErrorBox error={err} />}
        </div>
        <Link to={`/sd/${eventId}`} className="mt-2 block text-center text-[12.5px] font-bold text-brand-700">All steps · reasons · share ›</Link>
      </section>
      {mainTags.length > 0
        ? <Row label={`M&I · ${mainTags.length} item${mainTags.length === 1 ? '' : 's'} to finish`} right={`${mainTags.slice(0, 2).map((e) => e.tag.replace(/^([A-Z]{1,3})-12-/, '$1-')).join(', ')}${mainTags.length > 2 ? ' …' : ''} ›`} tone="red" onClick={() => (mainTags.length === 1 ? onItem(mainTags[0].tag) : onEquip())} />
        : <Row label="M&I · main equipment" right="✓ done" tone="grey" />}
      <Row label="Small items open" right={smallOpen ? `${smallOpen} ›` : '✓ none'} tone={smallOpen ? undefined : 'grey'} onClick={smallOpen ? onEquip : undefined} />
      <Row label="Maintenance (Non-SD)" right={nonSd ? `${nonSd} ›` : 'none'} tone={nonSd ? undefined : 'grey'} to="/shutdowns?section=maintenance" />
      <Row label="Issues" right={issues ? `${issues} open ${showIssues ? '▴' : '›'}` : 'none'} tone={issues ? 'red' : 'grey'} onClick={issues ? () => setShowIssues((x) => !x) : undefined} />
      {showIssues && children}
    </div>
  );
}
