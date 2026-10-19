// Shutdown progress (U-12 TR-2 tracker v1): Today · Guideline · Equipment · Map · Report (· Admin for the Section
// Head). The controllers update steps and equipment in a few taps; the status, the "needs me" list, plan vs actual and
// the shift report are worked out from the rows (src/core/tracker). Reloads every 30 s and when the page comes back.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Printer, Share2, Copy, MessageCircle } from 'lucide-react';
import { FO_NAMES, REACTORS, STAGE_SHORT, phases, attention, bannerText, equipViews, flagText, kwDay, kwTime, reportText, shiftOf, shiftReport, stepViews, totals, type Attention, type EquipView, type StepView } from '@/core/tracker';
import { currentTracker, fetchTrackerData, fetchTrackers, saveShiftLog, type Tracker, type TrackerData } from '@/data/tracker';
import type { UserProfile } from '@/data/types';
import { Button, ErrorBox, Spinner, cx } from '@/ui/components';
import { EquipSheet, StepSheet } from './TrackerSheets';
import { TrackerAdmin, clockKey } from './TrackerAdmin';
import { TimingTab } from './Timing';
import { FlagChip, PlanChip, StageBar, StateChip, Tile } from './ui';

type Tab = 'today' | 'guideline' | 'equipment' | 'timing' | 'map' | 'report' | 'admin';
const TABS: [Tab, string][] = [['today', 'Today'], ['guideline', 'Guideline'], ['equipment', 'Equipment'], ['timing', 'Timing'], ['map', 'Map'], ['report', 'Report']];
const BANNER_BG = { AHEAD: 'bg-[#08A048]', BEHIND: 'bg-[#E02028]', ON_PLAN: 'bg-amber-500' } as const;
const today = () => new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);

/** The clock the tracker runs on: now, or (TEST, this device) the time set in Admin to try a scenario. */
function useClock(t: Tracker | null) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((x) => x + 1);
    const i = window.setInterval(bump, 60_000); window.addEventListener('trk-clock', bump);
    return () => { window.clearInterval(i); window.removeEventListener('trk-clock', bump); };
  }, []);
  return useMemo(() => {
    void tick;
    if (t?.mode === 'test') { try { const v = localStorage.getItem(clockKey(t.id)); if (v) return Date.parse(v); } catch { /* storage blocked */ } }
    return Date.now();
  }, [t, tick]);
}

export default function TrackerPage({ profile }: { profile: UserProfile }) {
  const { id } = useParams();
  const [search, setSearch] = useSearchParams();
  const tab = (search.get('tab') as Tab) || 'today';
  const setTab = (t: Tab) => setSearch(t === 'today' ? {} : { tab: t }, { replace: true });
  const [trackers, setTrackers] = useState<Tracker[] | null>(null);
  const [data, setData] = useState<TrackerData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ kind: 'step'; id: string } | { kind: 'eq'; tag: string } | null>(null);
  const isHead = profile.role_code === 'section_head';
  const canEdit = ['section_head', 'manpower_coordinator', 'controller'].includes(profile.role_code);
  const tracker = useMemo(() => (trackers ? (id ? trackers.find((t) => t.id === id) ?? null : currentTracker(trackers, today())) : null), [trackers, id]);

  const load = useCallback(async () => {
    try { const list = await fetchTrackers(); setTrackers(list); const t = id ? list.find((x) => x.id === id) : currentTracker(list, today()); if (t) setData(await fetchTrackerData(t.id)); setError(null); }
    catch (e) { setError(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000);
    const v = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', v);
    return () => { window.clearInterval(i); document.removeEventListener('visibilitychange', v); };
  }, [load]);
  const now = useClock(tracker);
  const steps = useMemo(() => (data ? stepViews(data, now) : null), [data, now]);
  const eqs = useMemo(() => (data && steps ? equipViews(data, now, steps) : null), [data, now, steps]);

  // a step sheet closes after its action, the equipment sheet stays open (several actions in a row) and refreshes
  const done = (msg: string, keep = false) => { if (!keep) setSheet(null); setFlash(msg); load(); window.setTimeout(() => setFlash(null), 3000); };
  if (error) return <ErrorBox error={error} />;
  if (!trackers) return <Spinner />;
  if (!tracker) return <div className="p-4 text-sm text-slate-600">No shutdown is being tracked yet.</div>;
  if (!data || !steps || !eqs || data.tracker.id !== tracker.id) return <Spinner />;
  const test = tracker.mode === 'test';
  const other = trackers.filter((t) => t.eventId === tracker.eventId && t.id !== tracker.id);
  const openStep = sheet?.kind === 'step' ? steps.get(sheet.id) ?? null : null;
  const openEq = sheet?.kind === 'eq' ? eqs.find((e) => e.eq.tag === sheet.tag) ?? null : null;
  const open = (a: { kind: 'step' | 'equipment'; ref: string }) => setSheet(a.kind === 'step' ? { kind: 'step', id: a.ref } : { kind: 'eq', tag: a.ref });

  return (
    <div className="mx-auto max-w-3xl pb-24">
      {test && <div className="mb-2 rounded-lg bg-[#FFE699] px-3 py-1.5 text-center text-xs font-bold tracking-wide text-amber-950">TEST · a copy for trying; nothing here is live{now !== Date.now() && Math.abs(now - Date.now()) > 120_000 ? ` · clock ${kwDay(now)} ${kwTime(now)}` : ''}</div>}
      <div className="mb-2 flex items-center justify-between gap-2 print:hidden">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-[#004080]">{tracker.title}</h1>
          <p className="text-xs text-slate-500">{tracker.eventTitle ?? ''}{tracker.settings.workOrder ? ` · WO ${tracker.settings.workOrder}` : ''}</p>
        </div>
        {other.length > 0 && <div className="flex gap-1">{other.map((o) => <Link key={o.id} to={`/progress/${o.id}`} className="rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-slate-300">{o.mode === 'live' ? 'Live' : 'Test'}</Link>)}</div>}
      </div>
      <nav className="sticky top-0 z-20 -mx-1 mb-3 flex gap-1 overflow-x-auto bg-slate-50/95 px-1 py-1 backdrop-blur print:hidden" aria-label="Progress">
        {[...TABS, ...(isHead ? [['admin', 'Admin'] as [Tab, string]] : [])].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cx('min-h-10 shrink-0 rounded-full px-3.5 text-sm font-semibold', tab === k ? 'bg-[#0850A0] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{label}</button>
        ))}
      </nav>
      {flash && <div role="status" className="mb-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">{flash}</div>}
      {tab === 'today' && <TodayTab steps={steps} eqs={eqs} data={data} now={now} onOpen={open} onTab={setTab} />}
      {tab === 'guideline' && <GuidelineTab steps={steps} onOpen={(id) => setSheet({ kind: 'step', id })} />}
      {tab === 'equipment' && <EquipmentTab eqs={eqs} activities={data.activities} now={now} onOpen={(tag) => setSheet({ kind: 'eq', tag })} />}
      {tab === 'timing' && <TimingTab activities={data.activities} steps={data.steps} now={now} canEdit={canEdit} isHead={isHead} title={tracker.title} onDone={done} />}
      {tab === 'map' && <MapTab steps={steps} onOpen={(id) => setSheet({ kind: 'step', id })} />}
      {tab === 'report' && <ReportTab data={data} now={now} canEdit={canEdit} by={profile.display_name} onSaved={() => load()} />}
      {tab === 'admin' && isHead && <TrackerAdmin data={data} eqs={eqs} onDone={done} />}
      {openStep && <StepSheet v={openStep} isHead={isHead} canEdit={canEdit} onClose={() => setSheet(null)} onDone={done} />}
      {openEq && <EquipSheet v={openEq} trackerId={tracker.id} canEdit={canEdit} isHead={isHead} activities={data.activities.filter((a) => a.key === (openEq.eq.barchartKey ?? openEq.eq.tag))} now={now} onClose={() => setSheet(null)} onDone={(m) => done(m, true)} />}
    </div>
  );
}

const span = (msec: number) => { const d = Math.floor(msec / 864e5), h = Math.round((msec % 864e5) / 36e5); return d ? `${d} d ${h} h` : `${h} h`; };
/** Two parts: operations until R-12-205 (critical) is handed over, then M & I from that moment (its bar chart plan
 *  measured from the actual start). */
function PhaseBanners({ data, steps, now }: { data: TrackerData; steps: Map<string, StepView>; now: number }) {
  const { ops, mi } = phases(data, now, steps);
  const hh = (x: number | null) => (x === null ? '' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)} h`);
  const opsBg = !ops ? '' : ops.state === 'NOT_STARTED' ? 'bg-slate-500' : ops.state === 'DONE' || ops.state === 'AHEAD' ? 'bg-[#08A048]' : ops.state === 'BEHIND' ? 'bg-[#E02028]' : 'bg-amber-500';
  const opsText = !ops ? '' : ops.state === 'NOT_STARTED' ? 'NOT STARTED' : ops.state === 'DONE' ? 'DONE' : ops.state === 'ON_PLAN' ? 'ON PLAN' : `${ops.state} ${ops.offDays > 0 ? '+' : '−'}${Math.abs(ops.offDays)} d`;
  const crit = mi.critical.map((c) => `${c.tag} (${c.hoStep ?? 'HO'})`).join(', ') || 'the critical item';
  const late = mi.actualStart === null && !Number.isNaN(mi.planned) && now > mi.planned;
  return (
    <div className="space-y-2">
      {ops && (
        <div className={cx('rounded-2xl px-4 py-3 text-white', opsBg)}>
          <div className="text-[11px] font-bold uppercase tracking-wide opacity-90">Operations shutdown · {ops.state === 'DONE' ? `${ops.day} day${ops.day > 1 ? 's' : ''}` : `day ${ops.day} of ${ops.days}`}</div>
          <div className="text-2xl font-extrabold tracking-wide">● {opsText}</div>
          {ops.state === 'DONE' && ops.finishedAt !== null
            ? <div className="text-sm font-medium opacity-90">Finished {kwDay(ops.finishedAt)} {kwTime(ops.finishedAt)} · {hh(ops.finishDelayH)} vs plan · R-12-205 handed over</div>
            : <div className="text-sm font-medium opacity-90">Plan {ops.planPct}% · Actual {ops.actualPct}% (guideline steps) · ends at {crit} handover</div>}
          {ops.state !== 'DONE' && <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/30"><div className="h-full bg-white" style={{ width: `${ops.actualPct}%` }} /></div>}
        </div>
      )}
      {mi.actualStart === null ? (
        <div className={cx('rounded-2xl px-4 py-3 text-white', late ? 'bg-[#E02028]' : 'bg-[#004080]')}>
          <div className="text-[11px] font-bold uppercase tracking-wide opacity-90">M &amp; I (bar chart) · starts at {crit} handover</div>
          <div className="text-xl font-extrabold">{late ? `Start late ${span(now - mi.planned)}` : `Plan ${kwDay(mi.planned)} ${kwTime(mi.planned)}`}</div>
          <div className="text-sm opacity-90">{late ? `planned ${kwDay(mi.planned)} ${kwTime(mi.planned)}` : `in ${span(mi.planned - now)}`}{data.activities.length ? '' : ' · import the bar chart (Admin)'}</div>
        </div>
      ) : mi.banner && (
        <div className={cx('rounded-2xl px-4 py-3 text-white', BANNER_BG[mi.banner.state])}>
          <div className="text-[11px] font-bold uppercase tracking-wide opacity-90">M &amp; I (bar chart) · started {kwDay(mi.actualStart)} {kwTime(mi.actualStart)} ({hh(mi.delayH)})</div>
          <div className="text-2xl font-extrabold tracking-wide">● {bannerText(mi.banner)}</div>
          <div className="text-sm font-medium opacity-90">Plan {mi.banner.planPct}% · Actual {mi.banner.actualPct}%{mi.banner.items ? ` · ${mi.banner.items} items · from the actual start` : ' · import the bar chart (Admin)'}</div>
        </div>
      )}
    </div>
  );
}

function AttentionRow({ a, onOpen }: { a: Attention; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 py-2 text-left">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{a.label}</span>
      <FlagChip flag={a.flag} />
      {a.detail && <span className="max-w-[40%] truncate text-xs text-slate-600">{a.detail}</span>}
    </button>
  );
}

function TodayTab({ steps, eqs, data, now, onOpen, onTab }: { steps: Map<string, StepView>; eqs: EquipView[]; data: TrackerData; now: number; onOpen: (a: { kind: 'step' | 'equipment'; ref: string }) => void; onTab: (t: Tab) => void }) {
  const tot = totals(steps, eqs, data.iats); const att = attention(steps, eqs);
  const [allReady, setAllReady] = useState(false);
  const ready = [...steps.values()].filter((v) => v.state === 'READY');
  const critical = eqs.filter((e) => e.eq.critical && e.eq.tracked);
  return (
    <div className="space-y-3">
      <PhaseBanners data={data} steps={steps} now={now} />
      <div className="grid grid-cols-3 gap-2">
        <Tile value={`${tot.stepsDone}/${tot.steps}`} label="steps" onClick={() => onTab('guideline')} />
        <Tile value={`${tot.hoDone}/${tot.ho}`} label="handed over" onClick={() => onTab('equipment')} />
        <Tile value={tot.late} label="late" tone={tot.late ? 'red' : undefined} />
        <Tile value={tot.pending} label="pending" tone={tot.pending ? 'amber' : undefined} />
        <Tile value={tot.iatOpen} label="IAT open" tone={tot.iatOpen ? 'amber' : undefined} onClick={() => onTab('equipment')} />
        <Tile value={tot.ready} label="ready" tone="green" onClick={() => onTab('guideline')} />
      </div>
      <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
        <h2 className="text-xs font-bold uppercase tracking-wide text-[#E02028]">⚠ Needs attention · {att.length}</h2>
        {att.length ? <div className="divide-y divide-slate-100">{att.slice(0, 12).map((a) => <AttentionRow key={`${a.kind}-${a.ref}`} a={a} onOpen={() => onOpen(a)} />)}</div> : <p className="py-2 text-sm text-slate-500">Nothing.</p>}
        {att.length > 12 && <p className="pt-1 text-xs text-slate-500">+{att.length - 12} more</p>}
      </section>
      {critical.map((c) => (
        <button key={c.eq.tag} type="button" onClick={() => onOpen({ kind: 'equipment', ref: c.eq.tag })} className="block w-full rounded-2xl bg-white p-3 text-left ring-2 ring-[#E02028]/40">
          <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold uppercase tracking-wide text-[#E02028]">★ Critical path · {c.eq.tag}</span><FlagChip flag={c.flag} /></div>
          <StageBar stage={c.stage} className="my-2" />
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <span>Actual: <b>{STAGE_SHORT[c.stage]}</b></span>{c.plan && <><span>· Plan: <b>{STAGE_SHORT[c.plan.planned]}</b></span><PlanChip variance={c.plan.variance} days={c.plan.days} /></>}
            {c.eq.plannedFinish && <span className="text-xs text-slate-500">· target {kwDay(c.eq.plannedFinish)}</span>}
          </div>
        </button>
      ))}
      <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
        <button type="button" onClick={() => setAllReady((x) => !x)} className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-wide text-[#08A048]"><span>▶ Ready now · {ready.length}</span><span>{allReady ? '▾' : '▸'}</span></button>
        {allReady && <div className="mt-1 divide-y divide-slate-100">{ready.map((v) => <button key={v.step.stepId} type="button" onClick={() => onOpen({ kind: 'step', ref: v.step.stepId })} className="flex w-full items-center gap-2 py-2 text-left text-sm"><b className="w-12 shrink-0">{v.step.stepId}</b><span className="min-w-0 flex-1 truncate">{v.step.shortName}</span>{v.late && <StateChip state={v.state} late />}</button>)}</div>}
      </section>
    </div>
  );
}

function StepRow({ v, onOpen }: { v: StepView; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 rounded-xl bg-white px-2.5 py-2.5 text-left ring-1 ring-slate-200 active:scale-[0.99]">
      <StateChip state={v.state} late={v.late} />
      <b className="w-11 shrink-0 text-sm">{v.step.stepId}</b>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{v.step.shortName}</span>
      {v.waitingFor.length > 0 && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">waiting {v.waitingFor.join(', ')}</span>}
    </button>
  );
}

function GuidelineTab({ steps, onOpen }: { steps: Map<string, StepView>; onOpen: (id: string) => void }) {
  const [fo, setFo] = useState('FO1'); const [showDone, setShowDone] = useState(false);
  const list = [...steps.values()].filter((v) => v.step.fo === fo).sort((a, b) => a.step.gate - b.step.gate || a.step.stepId.localeCompare(b.step.stepId));
  const open = list.filter((v) => v.state !== 'DONE' && v.state !== 'NA'), closed = list.filter((v) => v.state === 'DONE' || v.state === 'NA');
  let gate = -1;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-200/60 p-1">
        {Object.entries(FO_NAMES).map(([k, n]) => <button key={k} type="button" onClick={() => setFo(k)} className={cx('min-h-10 rounded-lg text-xs font-semibold', fo === k ? 'bg-white text-[#004080] shadow-sm' : 'text-slate-600')}>{k} {n}</button>)}
      </div>
      {open.map((v) => { const head = v.step.gate !== gate; gate = v.step.gate;
        return <div key={v.step.stepId}>{head && <h3 className="mb-1 mt-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Gate {v.step.gate} · {v.step.gateName}</h3>}<StepRow v={v} onOpen={() => onOpen(v.step.stepId)} /></div>; })}
      {!open.length && <p className="py-4 text-center text-sm text-slate-500">All steps of {fo} are done.</p>}
      <button type="button" onClick={() => setShowDone((x) => !x)} className="mt-2 text-sm font-semibold text-[#08A048]">{showDone ? '▾' : '▸'} ✓ Done ({closed.length})</button>
      {showDone && <div className="space-y-1.5 opacity-80">{closed.map((v) => <StepRow key={v.step.stepId} v={v} onOpen={() => onOpen(v.step.stepId)} />)}</div>}
    </div>
  );
}

function EquipmentTab({ eqs, activities, now, onOpen }: { eqs: EquipView[]; activities: TrackerData['activities']; now: number; onOpen: (tag: string) => void }) {
  // the work step running on each item (else the next one), shown on its card
  const nowOf = (key: string) => { const xs = activities.filter((a) => a.tracked && a.key === key).sort((x, y) => (x.start ?? '9').localeCompare(y.start ?? '9'));
    const run = xs.find((a) => a.actualStart && !a.actualFinish); if (run) return `Now: ${run.activity}`; const nx = xs.find((a) => !a.actualStart); return nx ? `Next: ${nx.activity}${nx.start && Date.parse(nx.start) < now ? ' (due)' : ''}` : null; };
  const groups = [...new Set(eqs.map((e) => e.eq.group))];
  const [g, setG] = useState(groups[0] ?? '');
  const [onlyOps, setOnlyOps] = useState(true);
  const list = eqs.filter((e) => e.eq.group === g && (!onlyOps || e.eq.opsItem || e.stage > 0));
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 overflow-x-auto pb-1">{groups.map((x) => <button key={x} type="button" onClick={() => setG(x)} className={cx('min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold', g === x ? 'bg-[#0850A0] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{x}</button>)}</div>
      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={onlyOps} onChange={(e) => setOnlyOps(e.target.checked)} />Operations handover items only</label>
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((e) => (
          <button key={e.eq.tag} type="button" onClick={() => onOpen(e.eq.tag)} className={cx('rounded-xl bg-white p-3 text-left ring-1 ring-slate-200 active:scale-[0.99]', !e.eq.tracked && 'opacity-50')}>
            <div className="flex items-center justify-between gap-2"><b className="truncate text-sm text-slate-900">{e.eq.critical ? '★ ' : ''}{e.eq.tag}</b><FlagChip flag={e.flag} /></div>
            <StageBar stage={e.stage} className="my-2" />
            {nowOf(e.eq.barchartKey ?? e.eq.tag) && <div className="mb-1 truncate text-xs font-medium text-[#004080]">{nowOf(e.eq.barchartKey ?? e.eq.tag)}</div>}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600"><span>{STAGE_SHORT[e.stage]}</span>{e.plan && <><span>· Plan: {STAGE_SHORT[e.plan.planned]}</span><PlanChip variance={e.plan.variance} days={e.plan.days} /></>}{e.iatsOpen.length > 0 && <span className="font-semibold text-amber-800">· IAT {e.iatsOpen.length}</span>}{!e.eq.tracked && <span>· off</span>}</div>
          </button>
        ))}
      </div>
      {!list.length && <p className="py-4 text-center text-sm text-slate-500">No items here{onlyOps ? ' for operations' : ''}.</p>}
    </div>
  );
}

function MapTab({ steps, onOpen }: { steps: Map<string, StepView>; onOpen: (id: string) => void }) {
  const gates = [1, 2, 3, 4, 5, 6, 7, 8];
  const all = [...steps.values()];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-separate border-spacing-1 text-left">
        <thead><tr><th className="w-20" />{gates.map((g) => <th key={g} className="text-center text-[11px] font-bold text-slate-500">{g}<span className="block truncate font-normal">{all.find((v) => v.step.gate === g)?.step.gateName ?? ''}</span></th>)}</tr></thead>
        <tbody>
          {Object.entries(FO_NAMES).map(([fo, n]) => (
            <tr key={fo}>
              <th className="align-top text-xs font-bold text-[#004080]">{fo}<span className="block font-normal text-slate-500">{n}</span></th>
              {gates.map((g) => <td key={g} className="align-top"><div className="space-y-1">{all.filter((v) => v.step.fo === fo && v.step.gate === g).map((v) => (
                <button key={v.step.stepId} type="button" onClick={() => onOpen(v.step.stepId)} title={v.step.shortName}
                  className={cx('block w-full rounded-md px-1.5 py-1 text-left text-[10px] font-semibold leading-tight', v.late ? 'bg-[#E06666] text-white' : v.state === 'DONE' ? 'bg-[#C6EFCE] text-green-900' : v.state === 'READY' ? 'bg-[#FFE699] text-amber-950' : v.state === 'IN_PROGRESS' ? 'bg-[#D6E6F5] text-[#004080]' : v.state === 'PENDING' ? 'bg-[#FFC7CE] text-red-900' : 'bg-[#EDEFF2] text-slate-600')}>
                  {v.step.stepId}<span className="block truncate font-normal">{v.step.shortName}</span></button>))}</div></td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-slate-500">Grey waiting · amber ready · blue in progress · pink pending · green done · red late. Tap a step to open it.</p>
    </div>
  );
}

function ReportTab({ data, now, canEdit, by, onSaved }: { data: TrackerData; now: number; canEdit: boolean; by: string; onSaved: () => void }) {
  const sh = shiftOf(now);
  const saved = data.shiftLogs.find((l) => l.shiftDate === sh.date && l.shift === sh.shift) ?? null;
  const [notes, setNotes] = useState(saved?.notes ?? '');
  const [temps, setTemps] = useState<Record<string, string>>(saved?.temps ?? {});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [copied, setCopied] = useState(false);
  const r = shiftReport(data, now, { notes, temps }, data.tracker.title);
  const test = data.tracker.mode === 'test';
  const text = reportText(r, { test, by });
  const wa = (data.settings.whatsapp ?? '').replace(/\D/g, '');
  async function save() { setBusy(true); setErr(null); try { await saveShiftLog(data.tracker.id, sh.date, sh.shift, { notes, temps }); onSaved(); } catch (e) { setErr(e); } finally { setBusy(false); } }
  async function share() {
    if (canEdit) await save();
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch { /* cancelled */ }
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`, '_blank');
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 print:hidden sm:grid-cols-4">
        <Button onClick={share}><Share2 className="h-4 w-4" />Share</Button>
        <a href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => { if (canEdit) save(); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 text-sm font-medium text-white"><MessageCircle className="h-4 w-4" />WhatsApp{wa ? '' : ' (choose chat)'}</a>
        <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />PDF</Button>
        <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ } }}><Copy className="h-4 w-4" />{copied ? 'Copied' : 'Copy text'}</Button>
      </div>
      {canEdit && (
        <section className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 print:hidden">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">This shift · {sh.shift === 'D' ? 'Day' : 'Night'} {kwDay(sh.from)}</h2>
          <textarea className="input min-h-16" placeholder="Notes for the next shift" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="grid grid-cols-5 gap-1.5">{REACTORS.map((k) => <label key={k} className="text-center text-[11px] text-slate-500">{k.replace('R', 'R-')}<input inputMode="numeric" className="input mt-0.5 px-1 text-center" value={temps[k] ?? ''} onChange={(e) => setTemps((t) => ({ ...t, [k]: e.target.value.replace(/[^\d.]/g, '') }))} /></label>)}</div>
          <p className="text-[11px] text-slate-500">Max bed temperature °F. Saved with the shift{saved?.updatedBy ? ` · last by ${saved.updatedBy}` : ''}.</p>
          <Button variant="secondary" className="w-full" disabled={busy} onClick={save}>Save notes</Button>
          {err != null && <ErrorBox error={err} />}
        </section>
      )}
      <article className="rounded-2xl bg-white p-4 text-sm ring-1 ring-slate-200 print:ring-0">
        <header className="mb-2 border-b border-slate-200 pb-2">
          <img src={`${import.meta.env.BASE_URL}brand/knpc-logo.png`} alt="KNPC" className="mb-1 hidden h-10 print:block" />
          <h2 className="font-bold text-[#004080]">{test ? '[TEST] ' : ''}{r.title}</h2>
          {r.ops && r.ops.state === 'DONE' && r.ops.finishedAt !== null ? <p className="font-semibold text-[#08A048]">Operations done {kwDay(r.ops.finishedAt)} {kwTime(r.ops.finishedAt)} (R-12-205 handed over)</p>
            : r.ops && r.ops.state !== 'NOT_STARTED' && <p className="font-semibold text-slate-800">Operations day {r.ops.day}/{r.ops.days} · Plan {r.ops.planPct}% · Actual {r.ops.actualPct}%</p>}
          {r.mi.actualStart === null ? <p className="font-semibold text-[#004080]">M &amp; I starts at R-12-205 handover (plan {kwDay(r.mi.planned)} {kwTime(r.mi.planned)})</p>
            : r.mi.banner && <p className={cx('font-semibold', r.mi.banner.state === 'BEHIND' ? 'text-[#E02028]' : r.mi.banner.state === 'AHEAD' ? 'text-[#08A048]' : 'text-amber-700')}>M &amp; I {bannerText(r.mi.banner)} · Plan {r.mi.banner.planPct}% · Actual {r.mi.banner.actualPct}% · started {kwDay(r.mi.actualStart)} {kwTime(r.mi.actualStart)}</p>}
          <p className="text-xs text-slate-600">Steps {r.totals.stepsDone}/{r.totals.steps} · HO {r.totals.hoDone}/{r.totals.ho} · late {r.totals.late} · pending {r.totals.pending} · IAT open {r.totals.iatOpen}</p>
        </header>
        <h3 className="mt-2 font-semibold">Done this shift ({r.stepsDone.length})</h3>
        {r.stepsDone.length ? <ul className="ml-4 list-disc">{r.stepsDone.map((s) => <li key={s.stepId}>{s.stepId} {s.name} <span className="text-xs text-slate-500">{kwTime(s.at)} · {s.by}</span></li>)}</ul> : <p className="text-slate-500">None yet.</p>}
        <h3 className="mt-2 font-semibold">Equipment moved ({r.stageChanges.length})</h3>
        {r.stageChanges.length ? <ul className="ml-4 list-disc">{r.stageChanges.map((c) => <li key={c.tag}>{c.tag}: {STAGE_SHORT[c.from]} → <b>{STAGE_SHORT[c.to]}</b> <span className="text-xs text-slate-500">{kwTime(c.at)} · {c.by}</span></li>)}</ul> : <p className="text-slate-500">None yet.</p>}
        <h3 className="mt-2 font-semibold">Mechanical activities this shift ({r.activities.length})</h3>
        {r.activities.length ? <ul className="ml-4 list-disc">{r.activities.map((x, i) => <li key={i}>{x.ref} {x.field === 'actual_start' ? 'started' : 'finished'} <span className="text-xs text-slate-500">{kwTime(x.at)} · {x.by}</span></li>)}</ul> : <p className="text-slate-500">None recorded.</p>}
        <h3 className="mt-2 font-semibold">Needs attention ({r.attention.length})</h3>
        {r.attention.length ? <ul className="ml-4 list-disc">{r.attention.map((a) => <li key={`${a.kind}-${a.ref}`}>{a.label} · {flagText(a.flag)}{a.detail ? ` – ${a.detail}` : ''}</li>)}</ul> : <p className="text-slate-500">Nothing.</p>}
        <h3 className="mt-2 font-semibold">Ready for the next shift ({r.ready.length})</h3>
        <p>{r.ready.map((v) => `${v.step.stepId} ${v.step.shortName}`).join(' · ') || '—'}</p>
        {Object.values(r.temps).some(Boolean) && <><h3 className="mt-2 font-semibold">Max bed temperature °F</h3><p>{REACTORS.filter((k) => r.temps[k]).map((k) => `${k.replace('R', 'R-')} ${r.temps[k]}`).join(' · ')}</p></>}
        {r.notes && <><h3 className="mt-2 font-semibold">Notes for the next shift</h3><p className="whitespace-pre-wrap">{r.notes}</p></>}
        <p className="mt-3 text-xs text-slate-500">— {by}</p>
      </article>
      <details className="print:hidden"><summary className="cursor-pointer text-xs font-semibold text-slate-600">Message text</summary><pre className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs">{text}</pre></details>
    </div>
  );
}

