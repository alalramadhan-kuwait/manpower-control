// One shutdown, one page (owner, 28 Oct 2026). On top the three stages, Shutdown → M&I → Start-up, each plan vs
// actual; tapping a stage shows its steps (the page opens on the stage running now). Below: Progress (the steps),
// Team (the team plan), Record (date changes) and File (scope and the shutdown, handover and start-up procedures).
// The shutdown steps and M&I are the tracker's own (edited the same way as on Live); the start-up steps and the file
// belong to the Calendar shutdown. Standard hours are compared with actual; nothing here changes a calculation.
import { ArrowLeft, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DELAY_MIN_H, DELAY_REASONS, reasonLabel, sopRefs, stageSummary, startupVsPlan, stdTimeline, type DelayReason, type StdStep } from '@/core/shutdown/stages';
import { kwDay, kwTime, phases, stepViews, type TrkStep } from '@/core/tracker';
import { saveEvent } from '@/data/calendar';
import { fetchUnitStatusHistory, type UnitStatusChange } from '@/data/modes';
import { DOC_STATUS, FILE_PARTS, addStartupStep, entryName, fetchFileDocs, fetchShutdownIndex, fetchStartupSteps, removeFileDoc, saveFileDoc, setStartupStep,
  type DocStatus, type FileDoc, type FilePart, type ShutdownEntry, type StartupStep } from '@/data/sdPage';
import { fetchTrackerData, type TrackerData } from '@/data/tracker';
import type { UserProfile } from '@/data/types';
import { StepSheet } from '@/features/tracker/TrackerSheets';
import { BottomSheet, Button, Card, ErrorBox, Field, Spinner, Toast, cx } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';
import { NewPlanSheet } from './ShutdownListPage';
import { drawCard, sharePicture, type CardData } from './shareCard';

type Stage = 'shutdown' | 'mi' | 'startup';
const H = 3_600_000;
const local = (iso: string | null | undefined) => (iso ? new Date(Date.parse(iso) + 3 * H).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? new Date(`${v}:00+03:00`).toISOString() : null);
const at = (t: number | string | null | undefined) => (t == null ? '—' : `${kwDay(t).replace(/^\w+,?\s*/, '')} ${kwTime(t)}`);
const hrs = (h: number) => (Math.abs(h) >= 48 ? `${Math.round(h / 24 * 10) / 10} d` : `${Math.round(h * 10) / 10} h`);
const dayNo = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 864e5);
const EDIT_ROLES = ['section_head', 'manpower_coordinator', 'engineer', 'controller'];
const FILE_ROLES = ['section_head', 'manpower_coordinator', 'engineer'];

/** A tracker step as a standard step: its estimate is the standard, Not applicable is not required. */
const asStd = (s: TrkStep): StdStep => ({ id: s.id, stdHours: s.estHours, status: s.status === 'done' ? 'done' : s.status === 'na' ? 'not_required' : s.status === 'in_progress' ? 'running' : 'not_started', startedAt: s.startedAt ?? null, doneAt: s.doneAt ?? null });

export default function ShutdownPage({ profile }: { profile: UserProfile }) {
  const { key = '' } = useParams();
  const [q, setQ] = useSearchParams();
  const [entry, setEntry] = useState<ShutdownEntry | null | undefined>(undefined);
  const [trk, setTrk] = useState<TrackerData | null>(null);
  const [startup, setStartup] = useState<StartupStep[]>([]);
  const [docs, setDocs] = useState<FileDoc[]>([]);
  const [err, setErr] = useState<unknown>(null); const [toast, setToast] = useState<string | null>(null); const [dates, setDates] = useState(false);
  const today = localToday(); const now = Date.now();
  const load = useCallback(async () => {
    try {
      const e = (await fetchShutdownIndex()).find((x) => x.key === key) ?? null; setEntry(e);
      if (!e) return;
      const [t, s, d] = await Promise.all([e.tracker ? fetchTrackerData(e.tracker.id) : Promise.resolve(null), e.eventId ? fetchStartupSteps(e.eventId) : Promise.resolve([]), e.eventId ? fetchFileDocs(e.eventId) : Promise.resolve([])]);
      setTrk(t); setStartup(s); setDocs(d); setErr(null);
    } catch (x) { setErr(x); }
  }, [key]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 3000); return () => window.clearTimeout(t); }, [toast]);
  const done = (m: string) => { setToast(m); void load(); };

  const ph = useMemo(() => (trk ? phases(trk, now) : null), [trk, now]);
  const opsSteps = useMemo(() => (trk ? [...trk.steps].sort((a, b) => a.gate - b.gate || a.stepId.localeCompare(b.stepId, undefined, { numeric: true })) : []), [trk]);
  const opsSum = stageSummary(opsSteps.map(asStd));
  const suSum = stageSummary(startup);
  const miEnd = ph && !Number.isNaN(ph.mi.plannedEnd) ? ph.mi.plannedEnd : null;
  // with no tracker the page is about its start-up steps; else the stage running now
  const running: Stage = suSum.startedAt !== null || (miEnd !== null && now > miEnd) || (!trk && startup.length > 0) ? 'startup' : ph?.mi.actualStart != null ? 'mi' : 'shutdown';
  const stage = (['shutdown', 'mi', 'startup'] as const).find((s) => s === q.get('stage')) ?? running;
  const part = (['progress', 'team', 'record', 'file'] as const).find((p) => p === q.get('part')) ?? 'progress';
  const set = (k: string, v: string) => { const n = new URLSearchParams(q); n.set(k, v); setQ(n, { replace: true }); };

  if (err != null) return <ErrorBox error={err} />;
  if (entry === undefined) return <Spinner />;
  if (!entry) return <Card><p className="text-sm text-slate-600">This shutdown is not on the list any more.</p><Link to="/shutdowns?section=plans" className="text-sm font-medium text-brand-700">Shutdowns ›</Link></Card>;

  const len = dayNo(entry.end) - dayNo(entry.start) + 1;
  // past its last day with start-up steps still open: it is not finished, its dates need putting right
  const inStartup = entry.end < today && startup.length > 0 && suSum.done < suSum.total;
  const startupRunning = suSum.startedAt !== null && suSum.done < suSum.total;
  const state = inStartup ? 'Still in start-up' : startupRunning ? 'In start-up' : entry.end < today ? 'Finished' : entry.start <= today ? `Day ${dayNo(today) - dayNo(entry.start) + 1} of ${len}` : `Starts in ${dayNo(entry.start) - dayNo(today)} days`;
  const canDates = !!entry.eventId && ['section_head', 'manpower_coordinator'].includes(profile.role_code);
  const missing = docs.filter((d) => d.status !== 'available').length;
  const ops = ph?.ops ?? null;
  const w = ph?.mi.weighted ?? null;

  return (
    <div>
      <Link to="/shutdowns?section=plans" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700"><ArrowLeft className="h-4 w-4" />Shutdowns</Link>
      <h1 className="text-xl font-bold text-slate-900">{entryName(entry)}</h1>
      <p className="mb-2 text-sm text-slate-600">{shortDate(entry.start)} – {shortDate(entry.end)} {entry.end.slice(0, 4)} · {len} days · <b className={inStartup ? 'text-amber-700' : 'text-slate-800'}>{state}</b>
        {canDates && <button type="button" onClick={() => setDates(true)} className="ml-1.5 text-[12px] font-semibold text-brand-700">Dates</button>}
        {entry.tentative && <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-600">tentative</span>}
        {entry.eventId && docs.length > 0 && <span className={cx('ml-1.5 text-[12px] font-semibold', missing ? 'text-status-red' : 'text-status-green')}>· File: {missing ? `${missing} not ready` : 'ready'}</span>}</p>

      <div className="mb-3 grid grid-cols-3 gap-1.5">
        <StageCard on={stage === 'shutdown'} onClick={() => { set('stage', 'shutdown'); set('part', 'progress'); }} title="Shutdown" tone={ops?.finishedAt != null ? 'done' : ops && ops.state !== 'NOT_STARTED' ? 'run' : 'idle'}
          lines={!trk ? ['No tracker'] : ops?.finishedAt != null ? ['Done', `${opsSum.done}/${opsSum.total} steps`] : ops ? [`${ops.actualPct}% · plan ${ops.planPct}%`, `${opsSum.done}/${opsSum.total} steps`] : [`${opsSum.done}/${opsSum.total} steps`]} pct={ops?.actualPct} />
        <StageCard on={stage === 'mi'} onClick={() => { set('stage', 'mi'); set('part', 'progress'); }} title="M&I" tone={ph?.mi.actualStart != null ? (w && w.actualPct >= 100 ? 'done' : 'run') : 'idle'}
          lines={!trk ? ['No tracker'] : ph?.mi.actualStart != null ? [w ? `${w.actualPct}% · plan ${w.planPct}%` : 'Started', `from ${at(ph.mi.actualStart)}`] : [`plan ${Number.isNaN(ph?.mi.planned ?? NaN) ? '—' : at(ph!.mi.planned)}`]} pct={ph?.mi.actualStart != null ? w?.actualPct : undefined} />
        <StageCard on={stage === 'startup'} onClick={() => { set('stage', 'startup'); set('part', 'progress'); }} title="Start-up" tone={suSum.finishedAt != null ? 'done' : suSum.startedAt != null ? 'run' : 'idle'}
          lines={startup.length ? [`${suSum.done}/${suSum.total} steps`, suSum.stdH ? `plan ${suSum.stdH} h` : ''] : [miEnd !== null ? `plan ${at(miEnd)}` : 'No steps yet']} pct={suSum.total ? Math.round((suSum.done / suSum.total) * 100) : undefined} />
      </div>

      <div className="mb-3 grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {([['progress', 'Progress'], ['team', 'Team'], ['record', 'Record'], ['file', 'File']] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={part === k} onClick={() => set('part', k)} className={cx('min-h-9 rounded-lg font-medium', part === k ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{l}</button>))}
      </div>

      {part === 'progress' && stage === 'shutdown' && <ShutdownSteps trk={trk} steps={opsSteps} stageStart={ops ? ops.start : null} profile={profile} now={now} onDone={done} />}
      {part === 'progress' && stage === 'mi' && <MiStage trk={trk} entry={entry} now={now} />}
      {part === 'progress' && stage === 'startup' && <StartupSteps entry={entry} steps={startup} stageStart={miEnd ?? suSum.startedAt} canEdit={EDIT_ROLES.includes(profile.role_code)} isHead={profile.role_code === 'section_head'} now={now} onDone={done} />}
      {part === 'team' && <TeamPart entry={entry} isHead={profile.role_code === 'section_head'} />}
      {part === 'record' && <RecordPart entry={entry} ops={ops} mi={ph?.mi ?? null} su={suSum} />}
      {part === 'file' && <FilePart_ entry={entry} docs={docs} trk={trk} canEdit={FILE_ROLES.includes(profile.role_code)} onDone={done} />}
      {inStartup && canDates && <button type="button" onClick={() => setDates(true)} className="mb-3 block w-full rounded-xl bg-amber-50 px-3 py-2 text-left text-[12px] text-amber-900 ring-1 ring-amber-200">The plan ended {shortDate(entry.end)} but start-up is not finished, so the unit shows as running. <b>Set the expected last day ›</b></button>}
      {dates && entry.eventId && <DatesSheet entry={entry} today={today} onClose={() => setDates(false)} onDone={(m) => { setDates(false); done(m); }} />}
      {toast && <Toast msg={toast} />}
    </div>
  );
}

/** The shutdown's actual first day and last day down (actual or expected): the Calendar event moves, the reason is
 *  kept on it and the change in the record. A shutdown of several sections moves for all of them. */
function DatesSheet({ entry, today, onClose, onDone }: { entry: ShutdownEntry; today: string; onClose: () => void; onDone: (m: string) => void }) {
  const [first, setFirst] = useState(entry.start); const [last, setLast] = useState(entry.end < today ? today : entry.end); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const bad = !first || !last || last < first;
  async function save() {
    setBusy(true); setErr(null);
    try {
      await saveEvent({ id: entry.eventId!, category: entry.category ?? 'shutdown', title: entry.title, unit: entry.unit, unitCodes: entry.unitCodes, start: first, end: last,
        note: [entry.note?.trim(), `${shortDate(today)}: ${reason.trim()}`].filter(Boolean).join(' · ') });
      onDone(`${entryName(entry)}: ${shortDate(first)} – ${shortDate(last)} saved.`);
    } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="Shutdown dates">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Plan {shortDate(entry.start)} – {shortDate(entry.end)}. The unit is down from the first day to the last day; a day still to come is the expected one.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="First day down"><input type="date" className="input" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
          <Field label="Last day down"><input type="date" className="input" value={last} min={first} onChange={(e) => setLast(e.target.value)} /></Field>
        </div>
        <Field label="Reason (kept with the change)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. start-up still running" /></Field>
        {last < first && <p className="text-xs text-status-red">The last day is before the first.</p>}
        {err != null && <ErrorBox error={err} />}
        <Button className="w-full" disabled={busy || bad || !reason.trim()} onClick={save}>Save</Button>
      </div>
    </BottomSheet>
  );
}

function StageCard({ on, onClick, title, lines, tone, pct }: { on: boolean; onClick: () => void; title: string; lines: string[]; tone: 'done' | 'run' | 'idle'; pct?: number }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cx('min-h-[76px] rounded-xl px-2 py-1.5 text-left ring-1', tone === 'done' ? 'bg-green-50 ring-green-200' : tone === 'run' ? 'bg-amber-50 ring-amber-200' : 'bg-white ring-slate-200', on && 'ring-2 ring-brand-600')}>
      <span className="block text-[13px] font-bold text-slate-900">{title}</span>
      {lines.filter(Boolean).map((l, i) => <span key={i} className="block text-[11px] leading-tight text-slate-600">{l}</span>)}
      {pct !== undefined && <span className="mt-1 block h-1.5 rounded bg-slate-200"><span className={cx('block h-1.5 rounded', tone === 'done' ? 'bg-status-green' : 'bg-amber-500')} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></span>}
    </button>
  );
}

const DOT = { done: 'bg-status-green text-white', running: 'bg-amber-400 text-amber-950', not_started: 'bg-slate-100 text-slate-600', not_required: 'bg-slate-100 text-slate-400' } as const;

/** The shutdown steps of the tracker, by stage (gate), each against its standard hours. Tap: the tracker's own sheet. */
function ShutdownSteps({ trk, steps, stageStart, profile, now, onDone }: { trk: TrackerData | null; steps: TrkStep[]; stageStart: number | null; profile: UserProfile; now: number; onDone: (m: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const views = useMemo(() => (trk ? stepViews(trk, now) : null), [trk, now]);
  if (!trk) return <Card><p className="text-sm text-slate-600">No tracker for this shutdown. The shutdown steps come with its tracker (Live).</p></Card>;
  const tl = new Map(stdTimeline(steps.map(asStd), stageStart, now).map((v) => [v.id, v]));
  const gates = [...new Set(steps.map((s) => s.gate))];
  const v = open ? views?.get(open) ?? null : null;
  return (
    <div className="space-y-2">
      {gates.map((g) => { const list = steps.filter((s) => s.gate === g); const d = list.filter((s) => s.status === 'done' || s.status === 'na').length; return (
        <Card key={g} className="p-0">
          <h3 className="flex justify-between px-3 pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-500"><span>{list[0].gateName ?? `Stage ${g}`}</span><span>{d}/{list.length}</span></h3>
          <ul className="divide-y divide-slate-100 px-3 pb-1">{list.map((s) => { const x = asStd(s); const t = tl.get(s.id); return (
            <li key={s.id}><button type="button" onClick={() => setOpen(s.id)} className="flex w-full items-center gap-2 py-2 text-left">
              <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', DOT[x.status])}>{x.status === 'done' ? '✓' : x.status === 'running' ? '▶' : x.status === 'not_required' ? '–' : s.stepId.replace(/^S/, '')}</span>
              <span className="min-w-0 flex-1"><span className={cx('block text-[13px] font-medium', x.status === 'not_required' ? 'text-slate-400 line-through' : 'text-slate-900')}>{s.shortName}</span>
                <StdLine std={s.estHours} t={t} status={x.status} startedAt={x.startedAt} doneAt={x.doneAt} proc={s.procedure} /></span>
              <span className="text-slate-400">›</span></button></li>); })}</ul>
        </Card>); })}
      {v && <StepSheet v={v} isHead={profile.role_code === 'section_head'} canEdit={EDIT_ROLES.includes(profile.role_code)} points={trk.points ?? []} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); onDone(m); }} />}
    </div>
  );
}

function StdLine({ std, t, status, startedAt, doneAt, proc }: { std: number | null; t?: { planStart: number | null; actualH: number | null; overH: number | null; late: boolean }; status: StdStep['status']; startedAt: string | null; doneAt: string | null; proc?: string | null }) {
  const parts: React.ReactNode[] = [];
  parts.push(std !== null ? `plan ${hrs(std)}` : 'no plan time');
  if (status === 'done') parts.push(`done ${at(doneAt)}${t?.actualH != null ? ` · took ${hrs(t.actualH)}` : ''}`);
  else if (status === 'running') parts.push(`started ${at(startedAt)}${t?.actualH != null ? ` · ${hrs(t.actualH)} so far` : ''}`);
  else if (status === 'not_required') parts.push('not required');
  else if (t?.planStart != null) parts.push(`from ${at(t.planStart)}`);
  return (
    <span className="block text-[11px] text-slate-500">{parts.join(' · ')}
      {t?.overH != null && t.overH > 0 && status !== 'not_required' && <span className={t.overH >= DELAY_MIN_H ? 'font-semibold text-status-red' : ''}> · {hrs(t.overH)} over</span>}
      {t?.late && status === 'not_started' && <span className="font-semibold text-status-red"> · start late</span>}
      {proc && <span className="text-slate-400"> · {proc}</span>}</span>
  );
}

/** M&I is the P6 bar chart of the tracker: the figures here, the lines on Live. */
function MiStage({ trk, entry, now }: { trk: TrackerData | null; entry: ShutdownEntry; now: number }) {
  if (!trk || !entry.tracker) return <Card><p className="text-sm text-slate-600">No tracker for this shutdown. M&I comes from its P6 bar chart in the tracker.</p></Card>;
  const mi = phases(trk, now).mi; const w = mi.weighted;
  const row = (l: string, a: string, b?: React.ReactNode) => <div className="flex justify-between gap-2 py-1.5 text-[13px]"><span className="text-slate-500">{l}</span><span className="text-right font-medium text-slate-800">{a}{b}</span></div>;
  return (
    <Card className="divide-y divide-slate-100">
      {row('Plan start', Number.isNaN(mi.planned) ? '—' : at(mi.planned))}
      {row('Actual start', mi.actualStart != null ? at(mi.actualStart) : 'not yet', mi.delayH != null && mi.delayH !== 0 ? <span className={cx('ml-1', mi.delayH > 0 ? 'text-status-red' : 'text-status-green')}>({mi.delayH > 0 ? '+' : ''}{hrs(mi.delayH)})</span> : null)}
      {row('Plan finish', Number.isNaN(mi.plannedEnd) ? '—' : at(mi.plannedEnd))}
      {mi.estEnd != null && row('Expected finish now', at(mi.estEnd))}
      {w && row('Progress', `${w.actualPct}% · plan ${w.planPct}%`)}
      <div className="flex gap-2 pt-2">
        <Link to={`/progress/${entry.tracker.id}?tab=timing`} className="flex-1 rounded-xl bg-brand-50 px-3 py-2 text-center text-[13px] font-semibold text-brand-700">Bar chart ›</Link>
        <Link to={`/progress/${entry.tracker.id}?tab=equipment`} className="flex-1 rounded-xl bg-brand-50 px-3 py-2 text-center text-[13px] font-semibold text-brand-700">Equipment ›</Link>
      </div>
    </Card>
  );
}

/** The start-up steps of this shutdown, planned one after another by their standard hours from the M&I finish (no
 *  tracker: from the first step's actual start). */
function StartupSteps({ entry, steps, stageStart, canEdit, isHead, now, onDone }: { entry: ShutdownEntry; steps: StartupStep[]; stageStart: number | null; canEdit: boolean; isHead: boolean; now: number; onDone: (m: string) => void }) {
  const [open, setOpen] = useState<StartupStep | 'new' | 'hold' | null>(null); const [sharing, setSharing] = useState(false);
  if (!entry.eventId) return <Card><p className="text-sm text-slate-600">This shutdown is not on the Calendar, so it has no start-up steps.</p></Card>;
  const tl = new Map(stdTimeline(steps, stageStart, now).map((v) => [v.id, v]));
  // where a step should start: when the step before it was done (actual), else its plan from the stage start
  const prevOf = (x: StartupStep) => { const i = steps.findIndex((y) => y.id === x.id); return steps.slice(0, i).reverse().find((y) => y.status !== 'not_required') ?? null; };
  const planStartOf = (x: StartupStep) => { const prev = prevOf(x); return prev?.doneAt ? Date.parse(prev.doneAt) : tl.get(x.id)?.planStart ?? null; };
  const vp = startupVsPlan(steps, now);
  return (
    <Card className="p-0">
      <h3 className="flex items-center justify-between px-3 pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-500"><span>Start-up · plan vs actual</span>
        {canEdit && <span className="flex gap-3 normal-case tracking-normal">
          <button type="button" onClick={() => setOpen('hold')} className="inline-flex min-h-8 items-center gap-0.5 text-[12px] font-semibold text-brand-700"><Plus className="h-3.5 w-3.5" />Hold</button>
          <button type="button" onClick={() => setOpen('new')} className="inline-flex min-h-8 items-center gap-0.5 text-[12px] font-semibold text-brand-700"><Plus className="h-3.5 w-3.5" />Step</button></span>}</h3>
      {vp.start !== null && <VsPlanBox vp={vp} onShare={() => setSharing(true)} />}
      {!steps.length ? <p className="px-3 pb-3 pt-1 text-sm text-slate-500">No start-up steps yet: add them here.</p>
        : <ul className="mt-1 divide-y divide-slate-100 border-t border-slate-100">{steps.map((s) => (
          <li key={s.id}>{s.kind === 'hold' ? <HoldRow s={s} hours={vp.hold.get(s.id)} onOpen={() => setOpen(s)} />
            : <StartupRow s={s} n={steps.filter((x) => x.kind !== 'hold' && x.seq <= s.seq).length} t={tl.get(s.id)} over={vp.over.get(s.id)} wait={vp.wait.get(s.id)} onOpen={() => setOpen(s)} />}</li>))}</ul>}
      {sharing && <ShareSheet entry={entry} steps={steps} vp={vp} tl={tl} now={now} onClose={() => setSharing(false)} />}
      {(open === 'hold' || (open && open !== 'new' && open.kind === 'hold')) && <HoldSheet eventId={entry.eventId} hold={open === 'hold' ? null : open as StartupStep} steps={steps} canEdit={canEdit} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); onDone(m); }} />}
      {open && open !== 'hold' && (open === 'new' || open.kind !== 'hold') && <StartupSheet eventId={entry.eventId} step={open === 'new' ? null : open} planStart={open === 'new' ? null : planStartOf(open)} prevDone={open === 'new' ? null : (() => { const p = prevOf(open); return p?.doneAt ? Date.parse(p.doneAt) : null; })()} nextSeq={(steps[steps.length - 1]?.seq ?? 0) + 10} canEdit={canEdit} isHead={isHead} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); onDone(m); }} />}
    </Card>
  );
}

const ROW_EDGE = { done: 'border-l-status-green', running: 'border-l-amber-400', not_started: 'border-l-transparent', not_required: 'border-l-transparent' } as const;
const signed = (h: number) => `${h > 0 ? '+' : h < 0 ? '−' : ''}${hrs(Math.abs(h))}`;

/** One start-up step in two lines: the step and its state; Plan · Actual · Variance with its time on the right. A wait
 *  before it and a delay reason each take one small highlighted line (amber: waiting, red: over plan). */
function StartupRow({ s, n, t, over, wait, onOpen }: { s: StartupStep; n: number; t?: ReturnType<typeof stdTimeline>[number]; over?: number; wait?: number; onOpen: () => void }) {
  const off = s.status === 'not_required'; const pending = s.status === 'not_started';
  const variance = t?.actualH != null && s.stdHours != null ? t.actualH - s.stdHours : null;
  // running under its plan is not a variance yet
  const v = variance === null || (s.status === 'running' && variance < 0) ? null : variance;
  const late = !!over || (pending && !!t?.late);
  const when = s.status === 'done' ? at(s.doneAt) : s.status === 'running' ? `since ${at(s.startedAt)}` : off ? 'not required' : t?.planStart != null ? `from ${at(t.planStart)}` : '';
  const reason = (r: string | null, note: string | null) => [reasonLabel(r), note].filter(Boolean).join(' · ');
  return (
    <button type="button" onClick={onOpen} className={cx('block w-full border-l-[3px] px-3 py-1.5 text-left active:bg-slate-50', ROW_EDGE[s.status], pending && 'bg-slate-50/60')}>
      <span className="flex items-start gap-2">
        <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', DOT[s.status])}>{s.status === 'done' ? '✓' : s.status === 'running' ? '▶' : off ? '–' : n}</span>
        <span className="min-w-0 flex-1">
          <span className={cx('block text-[13px] font-semibold leading-snug', off ? 'text-slate-400 line-through' : pending ? 'text-slate-600' : 'text-slate-900')}>{s.title}</span>
          <span className="flex items-baseline justify-between gap-2 text-[11.5px] tabular-nums">
            <span className="text-slate-600"><span className="whitespace-nowrap">Plan {s.stdHours != null ? hrs(s.stdHours) : '—'}</span>{t?.actualH != null && <span className="whitespace-nowrap"> · Actual {hrs(t.actualH)}{s.status === 'running' ? ' so far' : ''}</span>}
              {v !== null && <b className={cx('whitespace-nowrap font-semibold', v >= DELAY_MIN_H ? 'text-status-red' : 'text-status-green')}> · {Math.abs(v) < 0.05 ? 'on plan' : signed(v)}</b>}
              {pending && t?.late && <b className="whitespace-nowrap font-semibold text-status-red"> · late start</b>}</span>
            <span className="shrink-0 text-slate-500">{when}</span>
          </span>
          {(() => {
            // the wait and the overrun share one reason (one box on the step): then one line says both
            const waitTxt = wait !== undefined ? `⏸ Waited ${hrs(wait)}${pending ? ' so far' : ''}` : null; const lateTxt = late ? (over ? `Over plan ${signed(over)}` : 'Started late') : null;
            const wr = s.waitReason ? reason(s.waitReason, s.waitNote) : null; const dr = s.delayReason ? reason(s.delayReason, s.delayNote) : null;
            const ask = <b className="text-status-red">reason?</b>;
            if (waitTxt && lateTxt && (wr === dr || !wr || !dr)) return <span className="mt-0.5 block rounded bg-red-50 px-1.5 py-0.5 text-[11px] leading-snug text-red-900">{waitTxt} · {lateTxt} · {dr ?? wr ?? ask}</span>;
            return <>
              {waitTxt && <span className="mt-0.5 block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] leading-snug text-amber-900">{waitTxt} · {wr ?? ask}</span>}
              {lateTxt && <span className="mt-0.5 block rounded bg-red-50 px-1.5 py-0.5 text-[11px] leading-snug text-red-900">{lateTxt} · {dr ?? ask}</span>}
            </>;
          })()}
          {!late && s.delayReason && <span className="mt-0.5 block text-[11px] text-slate-500">{reason(s.delayReason, s.delayNote)}</span>}
        </span>
      </span>
    </button>
  );
}

/** A hold: the start-up waited on something outside it (e.g. a clearance through Operations Planning). Neutral: its
 *  from / to, its length and its reason; never late or on time. */
function HoldRow({ s, hours, onOpen }: { s: StartupStep; hours?: number; onOpen: () => void }) {
  const running = s.status === 'running';
  return (
    <button type="button" onClick={onOpen} className="block w-full border-l-[3px] border-l-sky-500 bg-sky-50/60 px-3 py-1.5 text-left active:bg-sky-50">
      <span className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[9px] font-bold text-white">❚❚</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold leading-snug text-sky-900">Hold · {s.title}</span>
          <span className="flex items-baseline justify-between gap-2 text-[11.5px] tabular-nums text-sky-900/80">
            <span>{at(s.startedAt)} → {running ? 'still on hold' : at(s.doneAt)}</span>
            {hours !== undefined && <span className="shrink-0 font-semibold">{hrs(hours)}{running ? ' so far' : ''}</span>}
          </span>
          {s.remark && <span className="block text-[11px] text-sky-900/80">{s.remark}</span>}
        </span>
      </span>
    </button>
  );
}

/** Add or change a hold: what it waited on, where it sits (before which step), from / to (empty: still on hold). */
function HoldSheet({ eventId, hold, steps, canEdit, onClose, onDone }: { eventId: string; hold: StartupStep | null; steps: StartupStep[]; canEdit: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const list = steps.filter((x) => x.kind !== 'hold');
  const [title, setTitle] = useState(hold?.title ?? 'Waiting for sulfur block clearance');
  const [before, setBefore] = useState(list.find((x) => x.status !== 'done')?.id ?? list[list.length - 1]?.id ?? '');
  const [a, setA] = useState(local(hold?.startedAt)); const [b, setB] = useState(local(hold?.doneAt)); const [note, setNote] = useState(hold?.remark ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>, m: string) => { setBusy(true); setErr(null); try { await fn(); onDone(m); } catch (e) { setErr(e); setBusy(false); } };
  const future = (v: string) => !!v && Date.parse(`${v}:00+03:00`) > Date.now() + 15 * 60_000;
  const bad = !title.trim() || !a || (!!b && b < a) || future(a) || future(b);
  // a new hold sits just before the step chosen
  const seqFor = () => { const at_ = steps.findIndex((x) => x.id === before); if (at_ < 0) return (steps[steps.length - 1]?.seq ?? 0) + 10; const prev = at_ > 0 ? steps[at_ - 1].seq : steps[at_].seq - 10; return Math.floor((prev + steps[at_].seq) / 2) === prev ? steps[at_].seq - 1 : Math.floor((prev + steps[at_].seq) / 2); };
  return (
    <BottomSheet open onClose={onClose} title={hold ? 'Hold' : 'Add a hold'}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Time the start-up waited on something outside it. Shown on its own, not as a late step; the steps after it count from its end.</p>
        <Field label="Waiting for"><input className="input w-full min-w-0" disabled={!canEdit} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        {!hold && <Field label="Before step"><select className="input w-full min-w-0" value={before} onChange={(e) => setBefore(e.target.value)}>{list.map((x, i) => <option key={x.id} value={x.id}>{i + 1}. {x.title}</option>)}</select></Field>}
        <Field label="From"><input type="datetime-local" className="input w-full min-w-0 appearance-none" disabled={!canEdit} value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label="To (empty: still on hold)"><input type="datetime-local" className="input w-full min-w-0 appearance-none" disabled={!canEdit} value={b} onChange={(e) => setB(e.target.value)} /></Field>
        {a && b && b >= a && <p className="-mt-1 text-[11px] text-slate-600">Hold {hrs((Date.parse(`${b}:00+03:00`) - Date.parse(`${a}:00+03:00`)) / H)}</p>}
        <Field label="Note"><input className="input w-full min-w-0" disabled={!canEdit} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. clearance through Operations Planning" /></Field>
        {!!a && !!b && b < a && <p className="text-xs text-status-red">The end is before the start.</p>}
        {(future(a) || future(b)) && <p className="text-xs text-status-red">A time still to come cannot be recorded.</p>}
        {err != null && <ErrorBox error={err} />}
        {canEdit && <div className="flex gap-2">
          {hold && <Button variant="danger" className="flex-1" disabled={busy} onClick={() => run(() => setStartupStep(hold.id, { active: false }), 'Hold removed from the list (kept in the history).')}>Remove</Button>}
          <Button className="flex-1" disabled={busy || bad} onClick={() => run(() => hold
            ? setStartupStep(hold.id, { title: title.trim(), started_at: fromLocal(a), done_at: fromLocal(b), status: b ? 'done' : 'running', remark: note.trim() || null })
            : addStartupStep(eventId, { seq: seqFor(), title, stdHours: null, procedureRef: null, kind: 'hold', startedAt: fromLocal(a), doneAt: fromLocal(b), remark: note }), hold ? 'Hold saved.' : 'Hold added.')}>Save</Button>
        </div>}
      </div>
    </BottomSheet>
  );
}

function StartupSheet({ eventId, step, planStart = null, prevDone = null, nextSeq, canEdit, isHead, onClose, onDone }: { eventId: string; step: StartupStep | null; planStart?: number | null; prevDone?: number | null; nextSeq: number; canEdit: boolean; isHead: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [title, setTitle] = useState(step?.title ?? ''); const [std, setStd] = useState(step?.stdHours?.toString() ?? ''); const [proc, setProc] = useState(step?.procedureRef ?? '');
  // times not recorded yet are filled from the plan (start: the step before done, done: start + standard), to be
  // corrected to the actual ones; a planned time still to come is shown, not filled
  const nowMs = Date.now(); const stdMs = (step?.stdHours ?? 0) * H;
  const planS = !step?.startedAt && planStart !== null ? planStart : null;
  const startMs = step?.startedAt ? Date.parse(step.startedAt) : planS !== null && planS <= nowMs ? planS : null;
  const planF = !step?.doneAt && startMs !== null && step?.stdHours != null ? startMs + stdMs : null;
  const [s, setS] = useState(step?.startedAt ? local(step.startedAt) : startMs !== null ? local(new Date(startMs).toISOString()) : '');
  const [f, setF] = useState(step?.doneAt ? local(step.doneAt) : planF !== null && planF <= nowMs ? local(new Date(planF).toISOString()) : '');
  const [fTouched, setFTouched] = useState(!!step?.doneAt);
  const filled = !!step && ((!step.startedAt && !!s) || (!step.doneAt && !!f));
  const setStart = (v: string) => { setS(v); if (!fTouched && v && step?.stdHours != null) { const e = Date.parse(`${v}:00+03:00`) + stdMs; setF(e <= Date.now() ? local(new Date(e).toISOString()) : ''); } };
  const future = (v: string) => !!v && Date.parse(`${v}:00+03:00`) > Date.now() + 15 * 60_000; const [note, setNote] = useState(step?.remark ?? ''); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  // why it was late: one reason for the waiting before it and the time over its standard (asked when either passes
  // DELAY_MIN_H); saved to whichever of the two applies, so the reports keep both apart
  const [lr, setLr] = useState<DelayReason | null>(step?.delayReason ?? step?.waitReason ?? null); const [ln, setLn] = useState(step?.delayNote ?? step?.waitNote ?? '');
  const ms = (v: string) => (v ? Date.parse(`${v}:00+03:00`) : null);
  const overFor = (a: number | null, b: number | null) => (a !== null && b !== null && step?.stdHours != null ? (b - a) / H - step.stdHours : 0);
  const waitFor = (a: number | null) => (a !== null && prevDone !== null ? (a - prevDone) / H : 0);
  const sOver = overFor(ms(s), ms(f) ?? (ms(s) !== null && step?.status === 'running' ? nowMs : null)); const sWait = waitFor(ms(s));
  const nowOver = overFor(step?.startedAt ? Date.parse(step.startedAt) : null, nowMs); const nowWait = waitFor(nowMs);
  const reasonsFor = (over: number, wait: number) => {
    const o = over >= DELAY_MIN_H || !!step?.delayReason; const w = wait >= DELAY_MIN_H || !!step?.waitReason; const n = ln.trim() || null;
    return { delay_reason: o ? lr : null, delay_note: o ? n : null, wait_reason: w ? lr : null, wait_note: w ? n : null };
  };
  const needs = (over: number, wait: number) => (over >= DELAY_MIN_H || wait >= DELAY_MIN_H) && !lr;
  const run = async (fn: () => Promise<unknown>, m: string) => { setBusy(true); setErr(null); try { await fn(); onDone(m); } catch (e) { setErr(e); setBusy(false); } };
  const stdN = std.trim() === '' ? null : Number(std);
  const badStd = stdN !== null && (Number.isNaN(stdN) || stdN < 0);
  if (!step) return (
    <BottomSheet open onClose={onClose} title="New start-up step">
      <div className="space-y-3">
        <Field label="Step"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. N₂ purge and leak test" /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Plan hours"><input className="input" inputMode="decimal" value={std} onChange={(e) => setStd(e.target.value)} /></Field>
          <Field label="Procedure"><input className="input" value={proc} onChange={(e) => setProc(e.target.value)} placeholder="e.g. SOP-12-…" /></Field></div>
        {err != null && <ErrorBox error={err} />}
        <Button className="w-full" disabled={busy || !title.trim() || badStd} onClick={() => run(() => addStartupStep(eventId, { seq: nextSeq, title, stdHours: stdN, procedureRef: proc }), `${title.trim()} added.`)}>Add</Button>
      </div>
    </BottomSheet>
  );
  const patch = (p: Parameters<typeof setStartupStep>[1], m: string) => run(() => setStartupStep(step.id, p), m);
  const nowIso = () => new Date().toISOString();
  return (
    <BottomSheet open onClose={onClose} title={step.title}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Plan {step.stdHours != null ? hrs(step.stdHours) : '—'}{step.procedureRef ? ` · ${step.procedureRef}` : ''}{step.updatedBy ? ` · last change ${step.updatedBy}` : ''}</p>
        {canEdit && step.status !== 'not_required' && <div className="flex gap-2 [&>*]:flex-1">
          {step.status === 'not_started' && <Button disabled={busy || needs(0, nowWait)} onClick={() => patch({ status: 'running', started_at: nowIso(), ...reasonsFor(0, nowWait) }, `${step.title} started.`)}>▶ Start now</Button>}
          {step.status === 'running' && <Button disabled={busy || needs(nowOver, 0)} onClick={() => patch({ status: 'done', done_at: nowIso(), ...reasonsFor(nowOver, 0) }, `${step.title} done.`)}>✓ Done now</Button>}
          {step.status === 'done' && <Button variant="secondary" disabled={busy} onClick={() => patch({ status: 'running', done_at: null }, `${step.title} back to running.`)}>↶ Undo done</Button>}
          {step.status === 'running' && <Button variant="secondary" disabled={busy} onClick={() => patch({ status: 'not_started', started_at: null }, `${step.title} back to not started.`)}>↶ Undo start</Button>}
        </div>}
        {canEdit && <>
          {filled && <p className="rounded-lg bg-brand-50 px-2.5 py-1.5 text-[11px] text-brand-900">Filled from the plan{step.stdHours != null ? ` (start + ${hrs(step.stdHours)})` : ''}. Change them to the actual times, then Save.</p>}
          <Field label="Started"><input type="datetime-local" className="input w-full min-w-0 appearance-none" value={s} onChange={(e) => setStart(e.target.value)} /></Field>
          {!s && planS !== null && <p className="-mt-2 text-[11px] text-slate-500">Plan start {at(planS)}</p>}
          <Field label="Done"><input type="datetime-local" className="input w-full min-w-0 appearance-none" value={f} onChange={(e) => { setF(e.target.value); setFTouched(true); }} /></Field>
          {!f && planF !== null && <p className="-mt-2 text-[11px] text-slate-500">Plan done {at(planF)}</p>}
          {s && f && step.stdHours != null && f >= s && <p className="-mt-1 text-[11px] text-slate-600">Actual {hrs((Date.parse(`${f}:00+03:00`) - Date.parse(`${s}:00+03:00`)) / H)} · plan {hrs(step.stdHours)}</p>}
          {(() => {
            const w = Math.max(sWait, step.status === 'not_started' && !s ? nowWait : 0); const o = Math.max(sOver, step.status === 'running' && !f ? nowOver : 0);
            const parts = [w >= DELAY_MIN_H && `waited ${hrs(w)} before`, o >= DELAY_MIN_H && `${hrs(o)} over plan`].filter(Boolean) as string[];
            return (parts.length > 0 || lr) && <ReasonPick title={parts.length ? `Late (${parts.join(' + ')}): why?` : 'Delay reason'} value={lr} note={ln} onValue={setLr} onNote={setLn} />;
          })()}
          <Field label="Remark"><input className="input w-full min-w-0" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {!!s && !!f && f < s && <p className="text-xs text-status-red">Done is before the start.</p>}
          {(future(s) || future(f)) && <p className="text-xs text-status-red">A time still to come cannot be recorded.</p>}
          {needs(sOver, sWait) && <p className="text-xs font-medium text-status-red">Pick a reason for the delay to save.</p>}
          <Button className="w-full" disabled={busy || (!!s && !!f && f < s) || (!s && !!f) || future(s) || future(f) || needs(sOver, sWait)} onClick={() => patch({ started_at: fromLocal(s), done_at: fromLocal(f), status: step.status === 'not_required' ? 'not_required' : f ? 'done' : s ? 'running' : 'not_started', remark: note.trim() || null, ...reasonsFor(sOver, sWait) }, `${step.title} saved.`)}>Save times</Button>
        </>}
        {isHead && <details className="rounded-xl bg-slate-50 p-2 text-sm"><summary className="cursor-pointer text-[12px] font-semibold text-slate-600">Step details · not required</summary>
          <div className="mt-2 space-y-2">
            <Field label="Step"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Plan hours"><input className="input" inputMode="decimal" value={std} onChange={(e) => setStd(e.target.value)} /></Field>
              <Field label="Procedure"><input className="input" value={proc} onChange={(e) => setProc(e.target.value)} /></Field></div>
            <Button variant="secondary" className="w-full" disabled={busy || !title.trim() || badStd} onClick={() => patch({ title: title.trim(), std_hours: stdN, procedure_ref: proc.trim() || null }, `${title.trim()} saved.`)}>Save details</Button>
            {step.status === 'not_required'
              ? <Button variant="secondary" className="w-full" disabled={busy} onClick={() => patch({ status: 'not_started', reason: null }, `${step.title} required again.`)}>↺ Required again</Button>
              : <div className="flex gap-2"><input className="input flex-1" placeholder="Why not required" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button variant="secondary" disabled={busy || !reason.trim()} onClick={() => patch({ status: 'not_required', reason: reason.trim() }, `${step.title} not required.`)}>Not required</Button></div>}
            <Button variant="danger" className="w-full" disabled={busy} onClick={() => patch({ active: false }, `${step.title} removed from the list (kept in the history).`)}>Remove from the list</Button>
          </div></details>}
        {step.reason && <p className="text-xs text-slate-500">Not required: {step.reason}</p>}
        {err != null && <ErrorBox error={err} />}
      </div>
    </BottomSheet>
  );
}

/** One quick reason (Equipment, Maintenance, Process, Safety, Other) and an optional note. */
function ReasonPick({ title, value, note, onValue, onNote }: { title: string; value: DelayReason | null; note: string; onValue: (v: DelayReason | null) => void; onNote: (v: string) => void }) {
  return (
    <div className="rounded-xl bg-amber-50 p-2.5 ring-1 ring-amber-200">
      <p className="mb-1.5 text-[12px] font-semibold text-amber-900">{title}</p>
      <div className="flex flex-wrap gap-1.5">{DELAY_REASONS.map((r) => (
        <button key={r.key} type="button" aria-pressed={value === r.key} onClick={() => onValue(value === r.key ? null : r.key)}
          className={cx('min-h-8 rounded-full px-2.5 text-[12px] font-semibold ring-1', value === r.key ? 'bg-amber-600 text-white ring-amber-600' : 'bg-white text-slate-700 ring-slate-300')}>{r.label}</button>))}</div>
      <input className="input mt-2 w-full min-w-0" placeholder="Short note (optional)" value={note} onChange={(e) => onNote(e.target.value)} />
    </div>
  );
}

/** The start-up against its plan: the plan end (first start + all plan hours, fixed), the end expected now, the
 *  time behind split into longer steps and waiting, progress against the plan; Share sends it as a picture. */
function VsPlanBox({ vp, onShare }: { vp: ReturnType<typeof startupVsPlan>; onShare: () => void }) {
  const behind = vp.lateH ?? 0; const red = behind >= DELAY_MIN_H;
  return (
    <div className="mx-3 mt-1.5 rounded-xl bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-[12px] leading-snug tabular-nums text-slate-700">
          <span className="block">Plan end <b>{at(vp.planEnd)}</b></span>
          <span className="block">{vp.finished ? 'Finished' : 'Expected'} <b>{at(vp.expectedEnd)}</b></span>
          <span className={cx('block font-bold', red ? 'text-status-red' : 'text-status-green')}>{red ? `${hrs(behind)} behind plan` : behind <= -DELAY_MIN_H ? `${hrs(-behind)} ahead of plan` : 'On plan'}
            {(vp.overH > 0 || vp.waitH > 0) && <span className="font-normal text-slate-500"> · {[vp.overH > 0 && `${hrs(vp.overH)} longer steps`, vp.waitH > 0 && `${hrs(vp.waitH)} waiting`].filter(Boolean).join(' · ')}</span>}</span>
          {vp.holdH > 0 && <span className="block text-sky-800">+ {hrs(vp.holdH)} on hold (not counted as late)</span>}
        </div>
        <button type="button" onClick={onShare} className="min-h-9 shrink-0 rounded-lg bg-[#25d366] px-3 text-[12px] font-bold text-white">Share</button>
      </div>
      <div className="mt-1.5 flex items-center gap-2"><div className="relative h-1.5 flex-1 rounded bg-slate-200"><div className="h-1.5 rounded bg-amber-500" style={{ width: `${vp.actualPct}%` }} /><span className="absolute -top-1 h-3.5 w-0.5 bg-slate-800" style={{ left: `${vp.planPct}%` }} /></div>
        <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{vp.actualPct}% · plan {vp.planPct}%</span></div>
    </div>
  );
}

/** The picture for WhatsApp (option A): previewed, then the phone's share sheet (or saved where it cannot share). */
function ShareSheet({ entry, steps, vp, tl, now, onClose }: { entry: ShutdownEntry; steps: StartupStep[]; vp: ReturnType<typeof startupVsPlan>; tl: Map<string, ReturnType<typeof stdTimeline>[number]>; now: number; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null); const [blob, setBlob] = useState<Blob | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const counted = steps.filter((x) => x.status !== 'not_required' && x.kind !== 'hold'); const done = counted.filter((x) => x.status === 'done').length;
  const running = counted.find((x) => x.status === 'running') ?? null;
  const today = localToday(); const day = dayNo(today) - dayNo(entry.start) + 1;
  // late is only what the holds do not explain
  const behind = vp.lateH ?? 0;
  const caption = `${entryName(entry)} start-up ${vp.actualPct}% · ${done}/${counted.length} steps · ${vp.finished ? 'finished' : 'expected end'} ${at(vp.expectedEnd)}${behind >= DELAY_MIN_H ? ` · ${hrs(behind)} behind plan` : ''}`;
  useEffect(() => {
    const steps_ = steps.map((x) => {
      if (x.kind === 'hold') { const h = vp.hold.get(x.id); return { title: `Hold · ${x.title}`, status: 'hold' as const, right: h !== undefined ? `${hrs(h)} hold` : 'hold', red: false,
        time: `${at(x.startedAt)} → ${x.status === 'running' ? 'still on hold' : at(x.doneAt)}`, sub: x.remark, hold: true }; }
      const t = tl.get(x.id); const over = vp.over.get(x.id); const wait = vp.wait.get(x.id);
      const right = x.status === 'done' ? `${t?.actualH != null ? hrs(t.actualH) : '—'} / ${x.stdHours != null ? hrs(x.stdHours) : '—'}` : x.status === 'running' ? `${t?.actualH != null ? hrs(t.actualH) : '0 h'} / ${x.stdHours != null ? hrs(x.stdHours) : '—'}` : x.status === 'not_required' ? 'not required' : x.stdHours != null ? hrs(x.stdHours) : '—';
      // the time from the latest update: done at; running: its expected finish; still to come: expected start → finish
      const end = x.startedAt && x.stdHours != null ? Math.max(Date.parse(x.startedAt) + x.stdHours * H, now) : null;
      const from = t?.planStart != null ? Math.max(t.planStart, now) : null;
      const time = x.status === 'done' ? `done ${at(x.doneAt)}` : x.status === 'running' ? `started ${at(x.startedAt)} · expected done ${at(end)}`
        : x.status === 'not_required' ? null : from !== null ? `expected ${at(from)} → ${at(t?.planEnd ?? null)}` : null;
      // why it was late, said once (the wait and the overrun may share one reason)
      const why = (r: string | null, n: string | null) => (r ? `${reasonLabel(r)}${n ? `: ${n}` : ''}` : null);
      const wr = why(x.waitReason, x.waitNote); const dr = why(x.delayReason, x.delayNote);
      const parts = [wait ? `waited ${hrs(wait)}` : null, over ? `+${hrs(over)} over plan` : null].filter(Boolean) as string[];
      const reasons = [...new Set([wait ? wr : null, over ? dr : null].filter(Boolean) as string[])];
      const sub = parts.length ? [...parts, ...reasons].join(' · ') : null;
      return { title: x.title, status: x.status, right, red: !!over, time, sub };
    });
    const d: CardData = {
      title: `${entryName(entry)} · Start-up`, when: `Unit-12 · ${new Date(now).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuwait' })}`,
      pct: vp.actualPct, planPct: vp.planPct, stepsLine: `${done} of ${counted.length} steps done`,
      runningLine: running ? `Running: ${running.title}` : null,
      expectedLine: `${vp.finished ? 'Finished' : 'Expected end'} ${at(vp.expectedEnd)}`,
      behindLine: behind >= DELAY_MIN_H ? `${hrs(behind)} behind plan` : behind <= -DELAY_MIN_H ? `${hrs(-behind)} ahead of plan` : 'On plan', behindRed: behind >= DELAY_MIN_H,
      planLine: `Plan end ${at(vp.planEnd)}${vp.overH > 0 ? ` · ${hrs(vp.overH)} longer steps` : ''}${vp.waitH > 0 ? ` · ${hrs(vp.waitH)} waiting` : ''}${vp.holdH > 0 ? ` · ${hrs(vp.holdH)} on hold (not late)` : ''}`,
      steps: steps_, footLeft: `Plan ${Math.round(counted.reduce((n, x) => n + (x.stdHours ?? 0), 0) * 10) / 10} h`, footRight: `Down since ${shortDate(entry.start)} · day ${day}`,
    };
    const c = document.createElement('canvas'); drawCard(c, d);
    c.toBlob((b) => { if (b) { setBlob(b); setUrl(URL.createObjectURL(b)); } }, 'image/png');
  }, [entry, steps, vp, tl, now, done, counted.length, running, day, behind]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const name = `${entryName(entry).replace(/[^\w-]+/g, '-').toLowerCase()}-startup.png`;
  return (
    <BottomSheet open onClose={onClose} title="Share the start-up">
      <div className="space-y-3">
        {url ? <img src={url} alt="Start-up picture" className="mx-auto w-full max-w-sm rounded-lg ring-1 ring-slate-200" /> : <Spinner />}
        <p className="text-[12px] text-slate-600">{caption}</p>
        <Button className="w-full bg-[#25d366] hover:bg-[#1fb457]" disabled={!blob} onClick={async () => { const r = await sharePicture(blob!, name, caption); setMsg(r === 'saved' ? 'Picture saved: attach it in WhatsApp.' : r === 'shared' ? 'Shared.' : null); }}>Share to WhatsApp…</Button>
        {msg && <p className="text-center text-[12px] text-slate-600">{msg}</p>}
      </div>
    </BottomSheet>
  );
}

/** The team plan of the shutdown (people, days, approval, schedule, overtime, memo), opened as it is today. */
function TeamPart({ entry, isHead }: { entry: ShutdownEntry; isHead: boolean }) {
  const [adding, setAdding] = useState(false);
  const p = entry.plan;
  if (!p) return (
    <Card><p className="text-sm text-slate-600">No team plan for this shutdown yet.</p>
      {isHead && entry.eventId && <Button className="mt-2 w-full" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add team</Button>}
      {adding && <NewPlanSheet eventId={entry.eventId} onClose={() => setAdding(false)} />}</Card>
  );
  return (
    <Card className="space-y-1">
      <p className="text-[15px] font-semibold text-slate-900">{p.title}</p>
      <p className="text-sm text-slate-600">{shortDate(p.start)} – {shortDate(p.end)} · {p.kind === 'total' ? 'Total turnaround' : 'Train shutdown'} · {p.daysOff ? `${p.daysOn} on, ${p.daysOff} off` : 'every day'} · {p.shiftHours} h</p>
      <Link to={`/shutdown/${p.id}`} className="mt-2 block rounded-xl bg-brand-700 px-3 py-2.5 text-center text-sm font-semibold text-white">Open the team plan ›</Link>
      <p className="text-[11px] text-slate-500">Team, days & hours, approval, duty schedule, overtime sheet and memo.</p>
    </Card>
  );
}

/** The shutdown's dates as they changed (who, when) and each stage plan vs actual. */
function RecordPart({ entry, ops, mi, su }: { entry: ShutdownEntry; ops: ReturnType<typeof phases>['ops']; mi: ReturnType<typeof phases>['mi'] | null; su: ReturnType<typeof stageSummary> }) {
  const [rows, setRows] = useState<UnitStatusChange[] | null>(null); const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (!entry.eventId) { setRows([]); return; } fetchUnitStatusHistory(500).then((r) => setRows(r.filter((c) => c.entityId === entry.eventId || (entry.plan && c.planId === entry.plan.id)))).catch(setErr); }, [entry]);
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuwait' });
  const span = (a: string | null, b: string | null) => (a && b ? `${shortDate(a)} – ${shortDate(b)}` : '—');
  return (
    <div className="space-y-2">
      <Card className="divide-y divide-slate-100 py-1">
        <h3 className="py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Plan vs actual</h3>
        <RecLine label="Shutdown" plan={ops ? `${at(ops.start)} → ${at(ops.end)}` : '—'} actual={ops?.finishedAt != null ? `finished ${at(ops.finishedAt)}${ops.finishDelayH ? ` (${ops.finishDelayH > 0 ? '+' : ''}${hrs(ops.finishDelayH)})` : ''}` : ops && ops.state !== 'NOT_STARTED' ? 'running' : 'not started'} late={(ops?.finishDelayH ?? 0) > 0} />
        <RecLine label="M&I" plan={mi && !Number.isNaN(mi.planned) ? `${at(mi.planned)} → ${Number.isNaN(mi.plannedEnd) ? '—' : at(mi.plannedEnd)}` : '—'} actual={mi?.actualStart != null ? `started ${at(mi.actualStart)}${mi.delayH ? ` (${mi.delayH > 0 ? '+' : ''}${hrs(mi.delayH)})` : ''}` : 'not started'} late={(mi?.delayH ?? 0) > 0} />
        <RecLine label="Start-up" plan={su.stdH ? `${su.stdH} h` : '—'} actual={su.finishedAt != null ? `finished ${at(su.finishedAt)}` : su.startedAt != null ? `started ${at(su.startedAt)}` : 'not started'} late={false} />
      </Card>
      <Card className="py-1">
        <h3 className="py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Date changes</h3>
        {err != null ? <ErrorBox error={err} /> : !rows ? <Spinner /> : !rows.length ? <p className="pb-2 text-sm text-slate-500">No change recorded.</p>
          : <ul className="divide-y divide-slate-100">{rows.map((c, i) => <li key={`${c.at}-${i}`} className="py-1.5 text-[12px]"><span className="block font-medium text-slate-800">
            {c.action === 'insert' ? `Added · ${span(c.newStart, c.newEnd)}` : c.newStatus === 'cancelled' && c.oldStatus !== 'cancelled' ? `Cancelled · ${span(c.oldStart, c.oldEnd)}` : c.oldStart !== c.newStart || c.oldEnd !== c.newEnd ? `Dates ${span(c.oldStart, c.oldEnd)} → ${span(c.newStart, c.newEnd)}` : 'Sections set'}</span>
            <span className="text-slate-500">{when(c.at)}</span></li>)}</ul>}
      </Card>
    </div>
  );
}
const RecLine = ({ label, plan, actual, late }: { label: string; plan: string; actual: string; late: boolean }) => (
  <div className="py-1.5 text-[12px]"><span className="block text-[13px] font-semibold text-slate-800">{label}</span><span className="block text-slate-500">Plan {plan}</span><span className={cx('block', late ? 'font-semibold text-status-red' : 'text-slate-700')}>Actual {actual}</span></div>
);

const DOC_CLS: Record<DocStatus, string> = { available: 'bg-green-100 text-green-800', missing: 'bg-status-red text-white', update: 'bg-amber-100 text-amber-800' };

/** The shutdown & start-up file: scope, shutdown / handover / start-up procedures, each one Available / Missing /
 *  Needs update and the steps it belongs to. The procedures the tracker's steps name and the file lacks are offered. */
function FilePart_({ entry, docs, trk, canEdit, onDone }: { entry: ShutdownEntry; docs: FileDoc[]; trk: TrackerData | null; canEdit: boolean; onDone: (m: string) => void }) {
  const [open, setOpen] = useState<FileDoc | { part: FilePart; ref?: string; steps?: string } | null>(null);
  const [allOffer, setAllOffer] = useState(false);
  if (!entry.eventId) return <Card><p className="text-sm text-slate-600">This shutdown is not on the Calendar, so it has no file.</p></Card>;
  // the procedures named by the tracker steps, with the steps that use each
  const used = new Map<string, string[]>(); const noSop: string[] = [];
  for (const s of trk?.steps ?? []) { const refs = sopRefs(s.procedure); if (!refs.length) noSop.push(s.stepId); for (const ref of refs) used.set(ref, [...(used.get(ref) ?? []), s.stepId]); }
  const inFile = new Set(docs.flatMap((d) => sopRefs(d.ref)));
  const offer = [...used.entries()].filter(([ref]) => !inFile.has(ref)).sort(([a], [b]) => a.localeCompare(b));
  const scopeN = trk ? trk.equipment.filter((e) => e.tracked).length : null;
  return (
    <div className="space-y-2">
      {FILE_PARTS.map(({ key, label }) => { const list = docs.filter((d) => d.part === key); return (
        <Card key={key} className="p-0">
          <h3 className="flex items-center justify-between px-3 pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-500"><span>{label} ({list.length})</span>
            {canEdit && <button type="button" onClick={() => setOpen({ part: key })} className="inline-flex items-center gap-0.5 text-[12px] font-semibold normal-case tracking-normal text-brand-700"><Plus className="h-3.5 w-3.5" />Add</button>}</h3>
          {key === 'scope' && entry.tracker && <Link to={`/progress/${entry.tracker.id}?tab=scope`} className="mx-3 mt-1 flex justify-between rounded-lg bg-brand-50 px-2.5 py-1.5 text-[12px] font-semibold text-brand-700"><span>Tracker scope{scopeN != null ? ` · ${scopeN} items` : ''}</span><span>›</span></Link>}
          {key === 'handover' && entry.tracker && <Link to={`/progress/${entry.tracker.id}?tab=isolation`} className="mx-3 mt-1 flex justify-between rounded-lg bg-brand-50 px-2.5 py-1.5 text-[12px] font-semibold text-brand-700"><span>Handover in the tracker</span><span>›</span></Link>}
          {list.length ? <ul className="divide-y divide-slate-100 px-3 pb-1">{list.map((d) => (
            <li key={d.id}><button type="button" onClick={() => setOpen(d)} className="flex w-full items-center gap-2 py-2 text-left">
              <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-slate-900">{d.ref ? `${d.ref} · ` : ''}{d.title}</span>
                <span className="block text-[11px] text-slate-500">{[d.location, d.steps ? `steps ${d.steps}` : (d.ref && used.get(sopRefs(d.ref)[0] ?? '') ? `steps ${used.get(sopRefs(d.ref)[0])!.join(', ')}` : null), d.note].filter(Boolean).join(' · ') || '—'}</span></span>
              <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold', DOC_CLS[d.status])}>{DOC_STATUS[d.status]}</span></button></li>))}</ul>
            : <p className="px-3 pb-2 pt-1 text-[12px] text-slate-500">Nothing listed yet.</p>}
        </Card>); })}
      {canEdit && offer.length > 0 && (
        <Card className="py-1">
          <h3 className="py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Procedures the steps use, not in the file ({offer.length})</h3>
          <ul className="divide-y divide-slate-100">{(allOffer ? offer : offer.slice(0, 5)).map(([ref, steps]) => (
            <li key={ref} className="flex items-center gap-2 py-1.5 text-[12px]"><span className="min-w-0 flex-1"><b className="text-slate-800">{ref}</b><span className="block text-slate-500">steps {steps.join(', ')}</span></span>
              <button type="button" onClick={() => setOpen({ part: 'shutdown', ref, steps: steps.join(', ') })} className="rounded-lg bg-brand-50 px-2 py-1 font-semibold text-brand-700">Add</button></li>))}</ul>
          {offer.length > 5 && <button type="button" onClick={() => setAllOffer(!allOffer)} className="pb-1 text-[11px] font-medium text-brand-700">{allOffer ? 'Less' : `All ${offer.length}`}</button>}
        </Card>)}
      {noSop.length > 0 && <Card className="py-2 text-[12px]"><b className="text-slate-800">Steps with no procedure number ({noSop.length})</b><span className="block text-slate-500">{noSop.join(', ')}</span></Card>}
      {open && <DocSheet eventId={entry.eventId} doc={'id' in open ? open : null} init={'id' in open ? undefined : open} nextSeq={(docs[docs.length - 1]?.seq ?? 0) + 10} canEdit={canEdit} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); onDone(m); }} />}
    </div>
  );
}

function DocSheet({ eventId, doc, init, nextSeq, canEdit, onClose, onDone }: { eventId: string; doc: FileDoc | null; init?: { part: FilePart; ref?: string; steps?: string }; nextSeq: number; canEdit: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [v, setV] = useState({ part: doc?.part ?? init?.part ?? 'shutdown', ref: doc?.ref ?? init?.ref ?? '', title: doc?.title ?? '', location: doc?.location ?? '', status: doc?.status ?? 'missing', steps: doc?.steps ?? init?.steps ?? '', note: doc?.note ?? '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>, m: string) => { setBusy(true); setErr(null); try { await fn(); onDone(m); } catch (e) { setErr(e); setBusy(false); } };
  const name = v.title.trim() || v.ref.trim();
  const inp = (k: keyof typeof v, ph = '') => <input className="input" disabled={!canEdit} value={v[k]} placeholder={ph} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />;
  return (
    <BottomSheet open onClose={onClose} title={doc ? name : 'Add to the file'}>
      <div className="space-y-3">
        <Field label="Part"><select className="input" disabled={!canEdit} value={v.part} onChange={(e) => setV((x) => ({ ...x, part: e.target.value as FilePart }))}>{FILE_PARTS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Reference">{inp('ref', 'e.g. SOP-12-2009')}</Field><Field label="Title">{inp('title', 'e.g. Reactor blinding')}</Field></div>
        <Field label="Status"><div className="grid grid-cols-3 gap-1.5">{(['available', 'missing', 'update'] as const).map((s) => (
          <button key={s} type="button" disabled={!canEdit} onClick={() => setV((x) => ({ ...x, status: s }))} className={cx('min-h-9 rounded-lg text-[12px] font-semibold ring-1', v.status === s ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{DOC_STATUS[s]}</button>))}</div></Field>
        <Field label="Where it is kept">{inp('location', 'e.g. control room file, shared drive, link')}</Field>
        <Field label="Steps it belongs to">{inp('steps', 'e.g. S109, S110')}</Field>
        <Field label="Note">{inp('note')}</Field>
        {doc?.updatedBy && <p className="text-[11px] text-slate-500">Last change {doc.updatedBy}</p>}
        {err != null && <ErrorBox error={err} />}
        {canEdit && <div className="flex gap-2">
          {doc && <Button variant="danger" className="flex-1" disabled={busy} onClick={() => run(() => removeFileDoc(doc.id), `${name} removed from the file (kept in the history).`)}>Remove</Button>}
          <Button className="flex-1" disabled={busy || !name} onClick={() => run(() => saveFileDoc(eventId, { id: doc?.id, part: v.part, seq: doc?.seq ?? nextSeq, ref: v.ref, title: name, location: v.location, status: v.status, steps: v.steps, note: v.note }), `${name} saved.`)}>Save</Button>
        </div>}
      </div>
    </BottomSheet>
  );
}
