// Shutdown progress (U-12 TR-2 tracker v1): five tabs, all on screen (Today · Isolation · Equipment, with its Timing
// view · Sequence, with its Map view · IATs), the WhatsApp report and the Admin (Section Head) as sheets from the header. The controllers update steps and equipment in a few taps; the status, the "needs me" list, plan vs actual and
// the shift report are worked out from the rows (src/core/tracker). Reloads every 30 s and when the page comes back.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Printer, Share2, Copy, MessageCircle } from 'lucide-react';
import { daysAsHours, blindLink, neutLink, phases, totals, FO_NAMES, sortActs, isMisc, REACTORS, STAGE_SHORT, hoursText, isolationOf, isoState, ISO_LABEL, pointComplete, soakLeft, bannerText, equipViews, flagText, kwDay, kwTime, reportText, leaderReportText, relatedWork, shiftOf, shiftReport, staleItems, stepViews, type EquipView, type StepView, type TrkPoint } from '@/core/tracker';
import { StageReview, StaleAlert } from './StageReview';
import { CONFLICT_EVENT, setActivity, setEquipment, currentTracker, fetchTrackerData, fetchTrackers, saveShiftLog, type Tracker, type TrackerData } from '@/data/tracker';
import type { UserProfile } from '@/data/types';
import { BottomSheet, Button, ErrorBox, Spinner, cx } from '@/ui/components';
import { AskUpdates } from './Ask';
import { DrumQuick } from './Drums';
import { EngineerView } from '@/features/engineer/EngineerApp';
import { EventsCard } from './Events';
import { EquipSheet, StepSheet } from './TrackerSheets';
import { TrackerAdmin, clockKey } from './TrackerAdmin';
import { TimingTab } from './Timing';
import { IsolationTab } from './Isolation';
import { IatsTab } from './Iats';
import { TodayTab, type Nav } from './TrackerToday';
import { FLAG_STYLE, ISO_DOT, IsoChip, PlanChip, StageBar, StateChip } from './ui';

type Tab = 'today' | 'isolation' | 'guideline' | 'equipment' | 'iats' | 'timing' | 'map' | 'report' | 'admin';
// the bar: Timing is a view of Equipment, Map a view of Sequence; Report and Admin open as sheets
type Main = 'today' | 'isolation' | 'equipment' | 'guideline' | 'iats';
const TABS: [Main, string, string][] = [['today', 'Today', '🏠'], ['isolation', 'Isolation', '🔒'], ['equipment', 'Equipment', '🔧'], ['guideline', 'Sequence', '🧭'], ['iats', 'IATs', '📋']];
const MAIN: Record<Tab, Main> = { today: 'today', isolation: 'isolation', equipment: 'equipment', timing: 'equipment', guideline: 'guideline', map: 'guideline', iats: 'iats', report: 'today', admin: 'today' };
const VIEWS: Partial<Record<Main, [Tab, string][]>> = { equipment: [['equipment', 'Items'], ['timing', 'Timing']], guideline: [['guideline', 'Gates'], ['map', 'Map']] };
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
  const raw = (search.get('tab') as Tab) || 'today';
  // report / admin (old links, the Today report card) open their sheet over the page
  const sheetTab = raw === 'report' || raw === 'admin' ? raw : null;
  const [lastTab, setLastTab] = useState<Tab>('today');
  // the engineer view of the same tracker (remembered on this device until switched back)
  const [eng, setEng] = useState(() => { try { return localStorage.getItem('trk-view') === 'engineer'; } catch { return false; } });
  const toEng = (on: boolean) => { setEng(on); try { if (on) localStorage.setItem('trk-view', 'engineer'); else localStorage.removeItem('trk-view'); } catch { /* storage blocked */ } window.scrollTo(0, 0); };
  const tab: Tab = sheetTab ? lastTab : raw in MAIN ? raw : 'today';
  const setTab = (t: Tab) => { if (t !== 'report' && t !== 'admin') setLastTab(t); setSearch(t === 'today' ? {} : { tab: t }, { replace: true }); };
  const closeSheetTab = () => setTab(lastTab);
  const [trackers, setTrackers] = useState<Tracker[] | null>(null);
  const [data, setData] = useState<TrackerData | null>(null);
  const [error, setError] = useState<unknown>(null);
  // the message of the last update, over everything (sheets too), with Undo for a routine start / finish
  const [flash, setFlash] = useState<{ msg: string; undo?: () => Promise<unknown> } | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const [focus, setFocus] = useState<string | null>(null);
  const [isoKind, setIsoKind] = useState<'blind' | 'neut' | undefined>(undefined); const [lateFirst, setLateFirst] = useState(false);
  const [sheet, setSheet] = useState<{ kind: 'step'; id: string } | { kind: 'eq'; tag: string } | null>(null);
  const isHead = profile.role_code === 'section_head';
  const canEdit = ['section_head', 'manpower_coordinator', 'engineer', 'controller'].includes(profile.role_code);
  // a link to a tracker no longer active (e.g. the test copy after going live) opens the current one
  const tracker = useMemo(() => (trackers ? (id ? trackers.find((t) => t.id === id) : undefined) ?? currentTracker(trackers, today()) : null), [trackers, id]);

  // after an update only the tracker's data is fetched again (the list of trackers stays), with a bar on top meanwhile
  const shown = useRef<string | null>(null); const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      if (refresh && shown.current) { setData(await fetchTrackerData(shown.current)); setError(null); return; }
      const list = await fetchTrackers(); setTrackers(list); const t = (id ? list.find((x) => x.id === id) : undefined) ?? currentTracker(list, today());
      if (t) { shown.current = t.id; setData(await fetchTrackerData(t.id)); } setError(null);
    }
    catch (e) { setError(e); } finally { if (refresh) setRefreshing(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 30_000);
    const v = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', v);
    // a save refused because someone else changed the record: show what is there now
    const c = () => load(true); window.addEventListener(CONFLICT_EVENT, c);
    return () => { window.clearInterval(i); document.removeEventListener('visibilitychange', v); window.removeEventListener(CONFLICT_EVENT, c); };
  }, [load]);
  const now = useClock(tracker);
  const steps = useMemo(() => (data ? stepViews(data, now) : null), [data, now]);
  const eqs = useMemo(() => (data && steps ? equipViews(data, now, steps) : null), [data, now, steps]);
  // hours without an update, for the items with work running or due (Ask for updates)
  const stale = useMemo(() => new Map(data ? staleItems(data, now).map((i) => [i.key, i.ageH]) : []), [data, now]);

  // a step sheet closes after its action, the equipment sheet stays open (several actions in a row) and refreshes
  const done = (msg: string, keep = false, undo?: () => Promise<unknown>) => { if (!keep) setSheet(null); setFlash({ msg, undo }); load(true);
    window.clearTimeout(flashTimer.current); flashTimer.current = window.setTimeout(() => setFlash(null), undo ? 7000 : 3000); };
  const undoLast = async () => { const u = flash?.undo; if (!u) return; setFlash(null); try { await u(); done('Undone.', true); } catch (e) { setFlash({ msg: e instanceof Error ? e.message : 'Not undone' }); } };
  if (error) return <ErrorBox error={error} />;
  if (!trackers) return <Spinner />;
  if (!tracker) return <div className="p-4 text-sm text-slate-600">No shutdown is being tracked yet.</div>;
  if (!data || !steps || !eqs || data.tracker.id !== tracker.id) return <Spinner />;
  const test = tracker.mode === 'test';
  const other = trackers.filter((t) => t.eventId === tracker.eventId && t.id !== tracker.id);
  const openStep = sheet?.kind === 'step' ? steps.get(sheet.id) ?? null : null;
  const openEq = sheet?.kind === 'eq' ? eqs.find((e) => e.eq.tag === sheet.tag) ?? null : null;
  const points = data.points ?? [];
  // a step ticked from elsewhere: its blinds / neutralization (Isolation) or its items handed over (Equipment)
  const auto = new Map<string, 'isolation' | 'equipment'>([...data.equipment.filter((e) => e.hoStep).map((e) => [e.hoStep!, 'equipment'] as const), ...points.filter((p) => p.stepId).map((p) => [p.stepId!, 'isolation'] as const)]);
  const nav = (n: Nav) => { setFocus(null); setIsoKind(n.iso); setLateFirst(!!n.lateFirst); setTab(n.tab); };
  const toIsolation = (tag: string | null, kind?: 'blind' | 'neut') => { setSheet(null); setFocus(tag); setIsoKind(kind); setTab('isolation'); };
  const tot = totals(steps, eqs, data.iats);
  // the Isolation badge: blinds not in and neutralizations before handover not done (finished work drops off)
  const isoOpen = points.filter((p) => (p.kind === 'blind' || p.beforeHo) && !pointComplete(p)).length;
  // spare time before the shutdown end, for the items with bar-chart work left
  const miItems = new Map((phases(data, now, steps).mi.weighted?.items ?? []).map((i) => [i.tag, i]));
  const spare = new Map([...miItems.values()].filter((i) => i.done < i.lines).map((i) => [i.tag, i.spareD]));
  const open = (a: { kind: 'step' | 'equipment'; ref: string }) => setSheet(a.kind === 'step' ? { kind: 'step', id: a.ref } : { kind: 'eq', tag: a.ref });

  if (eng) return <div className="fixed inset-0 z-[60] overflow-y-auto bg-canvas"><EngineerView trackerId={tracker.id} name={profile.display_name} title={tracker.title} onExit={() => toEng(false)} /></div>;
  return (
    <div className="mx-auto max-w-3xl pb-24">
      {test && <div className="mb-2 rounded-lg bg-amber-200 px-3 py-1.5 text-center text-xs font-bold tracking-wide text-amber-950">TEST · a copy for trying; nothing here is live{now !== Date.now() && Math.abs(now - Date.now()) > 120_000 ? ` · clock ${kwDay(now)} ${kwTime(now)}` : ''}{other.filter((o) => o.mode === 'live').map((o) => <Link key={o.id} to={`/progress/${o.id}`} className="ml-2 underline">Live ›</Link>)}</div>}
      <div className="mb-2 flex items-center justify-between gap-2 print:hidden">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-brand-600">{tracker.title}</h1>
          <p className="text-xs text-slate-500">{tracker.eventTitle ?? ''}{tracker.settings.workOrder ? ` · WO ${tracker.settings.workOrder}` : ''}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => toEng(true)} title="Engineer view" className="flex min-h-11 flex-col items-center justify-center rounded-xl bg-white px-2 text-[10px] font-bold leading-tight text-brand-700 ring-1 ring-slate-200 active:bg-slate-50"><span className="text-base">👷</span>Engineer</button>
          <button type="button" onClick={() => setTab('report')} className="flex min-h-11 items-center gap-1 rounded-xl bg-status-green px-3 text-sm font-bold text-white shadow-sm active:bg-green-700">💬 Report</button>
          {isHead && <button type="button" aria-label="Admin" onClick={() => setTab('admin')} className="min-h-11 min-w-11 rounded-xl bg-white text-lg ring-1 ring-slate-200 active:bg-slate-50">⚙️</button>}
        </div>
      </div>
      <nav className="sticky top-0 z-20 mb-2 grid grid-cols-5 gap-0.5 rounded-2xl bg-slate-200/70 p-1 backdrop-blur print:hidden" aria-label="Progress">
        {TABS.map(([k, label, icon]) => { const on = MAIN[tab] === k; const badge = k === 'equipment' ? tot.late : k === 'iats' ? tot.iatOpen : k === 'isolation' ? isoOpen : 0;
          return <button key={k} type="button" aria-current={on ? 'page' : undefined} onClick={() => setTab(k)}
            className={cx('relative flex min-h-14 flex-col items-center justify-center rounded-xl px-0.5 text-[12px] font-semibold', on ? 'bg-white text-brand-500 shadow-sm' : 'text-slate-600 active:bg-white/60')}>
            <span className="text-lg leading-none" aria-hidden>{icon}</span><span className="mt-0.5 truncate">{label}</span>
            {badge > 0 && <span className={cx('absolute right-1 top-0.5 min-w-[18px] rounded-full px-1 text-[10px] font-bold leading-[18px] text-white', k === 'equipment' ? 'bg-status-red' : k === 'isolation' ? 'bg-brand-500' : 'bg-status-amber')}>{badge}</span>}
          </button>; })}
      </nav>
      {VIEWS[MAIN[tab]] && <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-200/60 p-1 print:hidden">
        {VIEWS[MAIN[tab]]!.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={cx('min-h-10 rounded-lg text-sm font-semibold', tab === k ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-600')}>{l}</button>)}
      </div>}
      {refreshing && <div aria-hidden className="fixed inset-x-0 top-0 z-[80] h-1 overflow-hidden bg-brand-100"><div className="h-full w-1/3 animate-[trkbar_1s_ease-in-out_infinite] bg-brand-500" /></div>}
      {flash && <div role="status" className="fixed inset-x-3 bottom-24 z-[70] mx-auto flex max-w-md items-center gap-2 rounded-xl bg-brand-700 px-3 py-2.5 text-sm text-white shadow-xl">
        <span className="min-w-0 flex-1">{flash.msg}</span>
        {flash.undo && <button type="button" onClick={undoLast} className="shrink-0 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold">↶ Undo</button>}
      </div>}
      {tab === 'today' && <StaleAlert data={data} now={now} onAsk={() => setTab('report')} />}
      {tab === 'today' && eqs && <StageReview data={data} eqs={eqs} canEdit={canEdit} onOpen={(tag) => open({ kind: 'equipment', ref: tag })} onDone={() => load(true)} />}
      {tab === 'today' && <TodayTab steps={steps} eqs={eqs} data={data} now={now} onOpen={open} onNav={nav} />}
      {tab === 'isolation' && <IsolationTab key={`iso-${isoKind}`} trackerId={tracker.id} initialKind={isoKind} activities={data.activities} points={points} pointSteps={data.pointSteps} lineup={data.lineup} iats={data.iats} steps={data.steps} now={now} canEdit={canEdit} isHead={isHead} focus={focus} onFocus={setFocus} onItem={(tag) => setSheet({ kind: 'eq', tag })} onStep={(id) => setSheet({ kind: 'step', id })} onDone={(m, u) => done(m, false, u)} />}
      {tab === 'guideline' && <SequenceTab steps={steps} auto={auto} onOpen={(id) => setSheet({ kind: 'step', id })} />}
      {tab === 'equipment' && <EquipmentTab key={`eq-${lateFirst}`} initialLateFirst={lateFirst} eqs={eqs} activities={data.activities} points={points} now={now} spare={spare} stale={stale} canEdit={canEdit} engine={data.engine} events={data.events} trackerId={tracker.id} onDone={(m, u) => done(m, true, u)} onOpen={(tag) => setSheet({ kind: 'eq', tag })} />}
      {tab === 'timing' && <TimingTab activities={data.activities} steps={data.steps} now={now} canEdit={canEdit} isHead={isHead} title={tracker.title} neutKeys={new Set(data.equipment.filter((e) => points.some((p) => p.kind === 'neut' && p.items.includes(e.tag))).map((e) => e.barchartKey ?? e.tag))} onDone={(m, u) => done(m, false, u)} />}
      {tab === 'iats' && <IatsTab iats={data.iats} tags={data.equipment.map((e) => e.tag)} lineup={data.lineup} lineupEq={data.lineupEq} points={points} canEdit={canEdit} onDone={(m, u) => done(m, true, u)} onItem={(tag) => setSheet({ kind: 'eq', tag })} />}
      {tab === 'map' && <MapTab steps={steps} onOpen={(id) => setSheet({ kind: 'step', id })} />}
      {sheetTab === 'report' && <BottomSheet open onClose={closeSheetTab} title="💬 Shift report"><ReportTab data={data} now={now} canEdit={canEdit} by={profile.display_name} onSaved={() => load(true)} /></BottomSheet>}
      {sheetTab === 'admin' && isHead && <BottomSheet open onClose={closeSheetTab} title="⚙️ Admin · Section Head">
        {other.length > 0 && <div className="mb-3 flex items-center justify-between rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200"><span><b className={test ? 'text-amber-800' : 'text-brand-500'}>{test ? 'TEST' : 'LIVE'}</b> · {test ? 'a copy for trying' : 'this is the real tracker'}</span>
          {other.map((o) => <Link key={o.id} to={`/progress/${o.id}`} className="font-bold text-brand-500">{o.mode === 'live' ? 'Live' : 'Test copy'} ›</Link>)}</div>}
        <TrackerAdmin data={data} eqs={eqs} by={profile.display_name} onDone={done} /></BottomSheet>}
      {openStep && <StepSheet v={openStep} isHead={isHead} canEdit={canEdit} points={points.filter((p) => p.stepId === openStep.step.stepId)} items={eqs.filter((e) => e.eq.hoStep === openStep.step.stepId && e.eq.tracked)}
        onIsolation={() => toIsolation(null)} onClose={() => setSheet(null)} onDone={(m, u) => done(m, false, u)} />}
      {openEq && <EquipSheet mi={miItems.get(openEq.eq.tag)} related={relatedWork(openEq.eq.tag, openEq.eq.barchartKey ?? openEq.eq.tag, data.activities)} allIats={data.iats} lineup={data.lineup} lineupEq={data.lineupEq} tags={data.equipment.map((e) => e.tag)} twins={openEq.eq.combine ? eqs.filter((x) => x.eq.combine === openEq.eq.combine).map((x) => x.eq.tag) : []} onTwin={(tag) => setSheet({ kind: 'eq', tag })} v={openEq} trackerId={tracker.id} canEdit={canEdit} isHead={isHead} activities={data.activities.filter((a) => a.key === (openEq.eq.barchartKey ?? openEq.eq.tag))} now={now}
        iso={isolationOf(openEq.eq.tag, points)} points={points} engine={data.engine} settings={data.settings} me={profile.auth_user_id} onIsolation={() => toIsolation(openEq.eq.tag)} onNeut={() => toIsolation(openEq.eq.tag, 'neut')} onClose={() => setSheet(null)} onDone={(m, u) => done(m, true, u)} />}
    </div>
  );
}

function StepRow({ v, auto, onOpen }: { v: StepView; auto?: 'isolation' | 'equipment'; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 rounded-xl bg-white px-2.5 py-2.5 text-left ring-1 ring-slate-200 active:scale-[0.99]">
      <StateChip state={v.state} late={v.late} />
      <b className="w-11 shrink-0 text-sm">{v.step.stepId}</b>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{v.step.shortName}</span>
      {v.state === 'WAITING' && v.waitingFor.length > 0 && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">after {v.waitingFor.join(', ')}</span>}
      {auto && v.state !== 'WAITING' && <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-600">{auto === 'isolation' ? 'from Isolation' : 'from Equipment'}</span>}
    </button>
  );
}

/** The guideline as a sequence: per field operator, the gates in order, the current one open with what to do now and
 *  what comes after; done gates folded. Steps ticked from Isolation or Equipment are marked. */
function SequenceTab({ steps, auto, onOpen }: { steps: Map<string, StepView>; auto: Map<string, 'isolation' | 'equipment'>; onOpen: (id: string) => void }) {
  const [fo, setFo] = useState('FO1'); const [opened, setOpened] = useState<Record<number, boolean>>({});
  const list = [...steps.values()].filter((v) => v.step.fo === fo).sort((a, b) => a.step.gate - b.step.gate || a.step.stepId.localeCompare(b.step.stepId));
  const closedOf = (v: StepView) => v.state === 'DONE' || v.state === 'NA';
  const gates = [...new Set(list.map((v) => v.step.gate))];
  const current = gates.find((g) => list.some((v) => v.step.gate === g && !closedOf(v)));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-200/60 p-1">
        {Object.entries(FO_NAMES).map(([k, n]) => <button key={k} type="button" onClick={() => { setFo(k); setOpened({}); }} className={cx('min-h-10 rounded-lg text-xs font-semibold', fo === k ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-600')}>{k} {n}</button>)}
      </div>
      {gates.map((g) => {
        const xs = list.filter((v) => v.step.gate === g), done = xs.filter(closedOf).length;
        const isNow = g === current, isNext = current !== undefined && g === gates[gates.indexOf(current) + 1];
        const show = opened[g] ?? (isNow || isNext);
        const now = xs.filter((v) => !closedOf(v) && v.state !== 'WAITING'), later = xs.filter((v) => v.state === 'WAITING'), fin = xs.filter(closedOf);
        return (
          <section key={g} className={cx('rounded-2xl p-2', isNow ? 'bg-brand-100/50 ring-2 ring-brand-500' : 'bg-white ring-1 ring-slate-200')}>
            <button type="button" onClick={() => setOpened((o) => ({ ...o, [g]: !show }))} className="flex w-full items-center gap-2 text-left">
              <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', done === xs.length ? 'bg-status-green text-white' : isNow ? 'bg-brand-500 text-white' : 'bg-slate-200 text-slate-600')}>{done === xs.length ? '✓' : g}</span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-slate-800">{xs[0]?.step.gateName ?? `Gate ${g}`}{isNow && <span className="ml-1.5 rounded bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">NOW</span>}</span>
              <span className="text-xs tabular-nums text-slate-500">{done}/{xs.length} {show ? '▾' : '▸'}</span>
            </button>
            {show && (
              <div className="mt-2 space-y-1.5">
                {now.length > 0 && <p className="text-[11px] font-bold uppercase tracking-wide text-brand-600">Do now</p>}
                {now.map((v) => <StepRow key={v.step.stepId} v={v} auto={auto.get(v.step.stepId)} onOpen={() => onOpen(v.step.stepId)} />)}
                {later.length > 0 && <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Then</p>}
                {later.map((v) => <StepRow key={v.step.stepId} v={v} auto={auto.get(v.step.stepId)} onOpen={() => onOpen(v.step.stepId)} />)}
                {fin.length > 0 && <div className="space-y-1.5 opacity-70">{fin.map((v) => <StepRow key={v.step.stepId} v={v} auto={auto.get(v.step.stepId)} onOpen={() => onOpen(v.step.stepId)} />)}</div>}
              </div>
            )}
          </section>
        );
      })}
      {current === undefined && <p className="py-3 text-center text-sm text-status-green">All steps of {fo} are done.</p>}
      <p className="text-[11px] text-slate-500">The guideline shows the order of the work. Blinds and neutralization are entered on Isolation and handovers on Equipment: their steps tick themselves.</p>
    </div>
  );
}

/** One thin row per item: tag, stage bar and the one thing to know (pending, the step running, the isolation, the next
 *  step), the status and the plan difference. "All" groups the items under their group; "Late first" puts the late,
 *  pending and IAT items on top. */
const ISO_BG = { red: 'bg-status-red', grey: 'bg-slate-300', amber: 'bg-amber-500', teal: 'bg-teal-500', blue: 'bg-brand-500' } as const;
function EquipmentTab({ initialLateFirst = false, eqs, activities, points, now, spare = new Map(), stale = new Map(), canEdit = false, engine, events = [], trackerId, onDone, onOpen }: { initialLateFirst?: boolean; engine?: TrackerData['engine']; events?: TrackerData['events']; trackerId?: string; eqs: EquipView[]; activities: TrackerData['activities']; points: TrkPoint[]; now: number; spare?: Map<string, number>; stale?: Map<string, number>; canEdit?: boolean; onDone?: (msg: string, undo?: () => Promise<unknown>) => void; onOpen: (tag: string) => void }) {
  const lineOf = (e: EquipView): { text: string; tone: 'run' | 'muted' | 'red' } | null => {
    const key = e.eq.barchartKey ?? e.eq.tag;
    const xs = sortActs(activities.filter((a) => a.tracked && !a.detail && a.key === key));
    const run = xs.filter((a) => a.actualStart && !a.actualFinish);
    const hrs = (a: TrackerData['activities'][number]) => { const el = Math.max(0, (now - Date.parse(a.actualStart!)) / 36e5); return ` · ${el.toFixed(1)}${a.durationH ? ` of ${a.durationH}` : ''} h`; };
    if (run.length) return { text: run.length === 1 ? `▶ ${run[0].activity}${hrs(run[0])}` : `▶ ${run.map((a) => a.activity).join(' · ')}`, tone: 'run' };
    if (e.eq.pendingReason) return { text: `⏸ ${e.eq.pendingReason}`, tone: 'red' };
    const iso = e.stage === 0 ? isoState(e.eq.tag, e.stage, points) : null;
    if (iso) {
      const n = iso.loops.find((p) => p.status !== 'open' && !pointComplete(p)); const left = n ? soakLeft(n, now) : null;
      return { text: `${iso.why}${left !== null && left > 0 ? ` · ${hoursText(left)} left` : ''}`, tone: iso.state === 'blind' ? 'red' : 'muted' };
    }
    if (e.stage === 6) return { text: e.eq.blindsOut ? `Deblinded ${kwDay(e.eq.blindsOut)} ${kwTime(e.eq.blindsOut)}` : 'Returned', tone: 'muted' };
    const nx = xs.find((a) => !a.actualStart);
    return nx ? { text: `Next: ${nx.activity}${nx.start && Date.parse(nx.start) < now ? ' (due)' : ''}`, tone: 'muted' } : null;
  };
  const isoMemo = new Map(eqs.map((e) => [e.eq.tag, e.stage === 0 ? isoState(e.eq.tag, 0, points) : null]));
  const iso = (e: EquipView) => isoMemo.get(e.eq.tag) ?? null;
  const groups = [...new Set(eqs.map((e) => e.eq.group))];
  // PSVs have their own chip (operations isolate and remove them), the other small items stay under Misc
  const misc_ = (g: string) => isMisc(g) && g !== 'PSVs';
  const main = groups.filter((x) => !misc_(x)), misc = groups.filter(misc_);
  const [g, setG] = useState('All'); const [showMisc, setShowMisc] = useState(false);
  const [onlyOps, setOnlyOps] = useState(true); const [lateFirst, setLateFirst] = useState(initialLateFirst);
  // items switched off (Admin) are kept but not listed, unless asked for
  const [showOff, setShowOff] = useState(false);
  const off = eqs.filter((e) => !e.eq.tracked);
  const shown = eqs.filter((e) => (showOff || e.eq.tracked) && (!onlyOps || e.eq.opsItem || e.stage > 0 || e.eq.group === 'PSVs'));
  const inChip = (e: EquipView) => (g === 'All' ? true : g === 'Misc' ? misc_(e.eq.group) : e.eq.group === g);
  // items worked as one (E-12-216A/B) show as one row: the first of them stands for the set
  const twins = new Map<string, EquipView[]>(); for (const e of eqs) if (e.eq.combine) twins.set(e.eq.combine, [...(twins.get(e.eq.combine) ?? []), e]);
  const firstOf = new Set<string>(); const lead = (e: EquipView) => { if (!e.eq.combine) return true; if (firstOf.has(e.eq.combine)) return false; firstOf.add(e.eq.combine); return true; };
  const list = shown.filter(inChip).filter(lead);
  const RANK: Record<string, number> = { HO_LATE: 0, LATE: 1, PENDING: 2, IAT_OPEN: 3 };
  const sorted = lateFirst ? [...list].sort((a, b) => (RANK[a.flag] ?? 9) - (RANK[b.flag] ?? 9) || b.lateBy - a.lateBy) : list;
  const by = (xs: string[]) => xs.map((x) => [x, sorted.filter((e) => e.eq.group === x)] as [string, EquipView[]]).filter(([, ys]) => ys.length);
  // All: the main groups, then miscellaneous folded · Misc: its groups · Late first: one list, main items first
  const sections: [string, EquipView[]][] = lateFirst ? [['', [...sorted.filter((e) => !misc_(e.eq.group)), ...sorted.filter((e) => misc_(e.eq.group))]]]
    : g === 'All' ? by(main) : g === 'Misc' ? by(misc) : [['', sorted]];
  const miscRows = g === 'All' && !lateFirst ? by(misc) : [];
  // the one-tap step of a row: finish the running step, else start the next one (blind and neutralization lines are
  // done on the Isolation page, field-detail steps in the item)
  const neutKeys = new Set(points.filter((p) => p.kind === 'neut').flatMap((p) => p.items));
  const stepOf = (e: EquipView): { a: TrackerData['activities'][number]; finish: boolean; more: number } | null => {
    if (!e.eq.tracked) return null;
    const key = e.eq.barchartKey ?? e.eq.tag;
    const ok = (a: TrackerData['activities'][number]) => !blindLink(a) && !(neutKeys.has(e.eq.tag) && neutLink(a));
    const xs = sortActs(activities.filter((a) => a.tracked && !a.detail && a.key === key && ok(a)));
    const run = xs.filter((a) => a.actualStart && !a.actualFinish);
    if (run.length) return { a: run[0], finish: true, more: run.length - 1 };
    const nx = xs.find((a) => !a.actualStart);
    return nx ? { a: nx, finish: false, more: 0 } : null;
  };
  // a reactor dumping: the shift's update is its drums, one tap from the list
  const [drumKey, setDrumKey] = useState<string | null>(null);
  const scopeOf = (key: string) => engine?.scopes.find((x) => x.key === key && x.scope === 'removal' && x.unit);
  const dumping = (e: EquipView) => { const sc = scopeOf(e.eq.barchartKey ?? e.eq.tag);
    return sc && !sc.completeAt && activities.some((a) => a.key === sc.key && sc.activityIds.includes(a.activityId) && a.actualStart) ? sc : null; };
  const drumText = (key: string) => { const sc = scopeOf(key); if (!sc || !engine) return '';
    const v = engine.entries.filter((x) => x.scopeId === sc.id && x.verify === 'verified' && x.kind !== 'transfer').reduce((t, x) => t + x.qty, 0);
    return ` · ${v.toLocaleString('en-US')}/${sc.working ? sc.working.toLocaleString('en-US') : '—'} drums`; };
  // a combined set: its stage is the lowest, the step is the same-named one of each member (started / finished together)
  const setOf = (e: EquipView) => (e.eq.combine ? twins.get(e.eq.combine) ?? [e] : [e]);
  const lineOfSet = (e: EquipView) => { const ms = setOf(e); if (ms.length < 2) return lineOf(e);
    const ls = ms.map((m) => ({ m, l: lineOf(m) })); const texts = [...new Set(ls.map((x) => x.l?.text ?? ''))];
    if (texts.length === 1) return ls[0].l;
    const run = ls.find((x) => x.l?.tone === 'run') ?? ls[0];
    return { text: ls.map((x) => `${x.m.eq.tag.slice(-1)}: ${x.l?.text ?? '—'}`).join(' · '), tone: run.l?.tone ?? 'muted' } as ReturnType<typeof lineOf>; };
  const stepOfSet = (e: EquipView) => { const ms = setOf(e); const first = stepOf(e); if (ms.length < 2 || !canEdit) return first ? { ...first, also: [] as TrackerData['activities'] } : null;
    const each = ms.map(stepOf);
    const lead = each.find((x) => x?.finish) ?? each.find((x) => x) ?? null; if (!lead) return null;
    // the same step on the others: running or next (a finish brings a member not started yet along, from the same start)
    const also = each.filter((x) => x && x !== lead && x.a.activity === lead.a.activity && (x.finish === lead.finish || lead.finish)).map((x) => x!.a);
    return { ...lead, also }; };
  const row = (e: EquipView) => { const l = lineOfSet(e); const st = canEdit ? stepOfSet(e) : null; const sp = spare.get(e.eq.tag); const ageH = stale.get(e.eq.barchartKey ?? e.eq.tag); const dm = dumping(e);
    const set = setOf(e); const name = set.length > 1 ? e.eq.combine! : e.eq.tag; const stage = Math.min(...set.map((m) => m.stage));
    return (
    <div key={e.eq.tag} role="button" tabIndex={0} onClick={() => onOpen(e.eq.tag)} onKeyDown={(x) => x.key === 'Enter' && onOpen(e.eq.tag)}
      className={cx('grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-slate-100 px-2.5 py-1.5 text-left first:border-t-0 active:bg-slate-50', !e.eq.tracked && 'opacity-50')}>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1">
          {iso(e) && <span className={cx('h-2 w-2 shrink-0 rounded-full', ISO_BG[ISO_DOT[iso(e)!.state]])} />}
          <b className="mr-1 text-[13px] text-slate-900">{e.eq.critical && <span className="text-status-red">★ </span>}{name}</b>
          {iso(e) && iso(e)!.state !== 'ho' && <IsoChip state={iso(e)!.state}>{ISO_LABEL[iso(e)!.state]}</IsoChip>}
          <span className={cx('whitespace-nowrap rounded px-1 py-px text-[10px] font-bold', FLAG_STYLE[e.flag].cls)}>{FLAG_STYLE[e.flag].label}{e.late ? ` ${hoursText(e.lateBy)}` : ''}{e.iatsOpen.length && e.flag !== 'IAT_OPEN' ? ` · IAT ${e.iatsOpen.length}` : ''}</span>
          {e.plan && e.stage < 6 && e.plan.variance !== 0 && <PlanChip variance={e.plan.variance} days={e.plan.days} short />}
          {ageH !== undefined && <span className="rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-700">⏰ {ageH} h no update</span>}
          {sp !== undefined && sp <= 7 && <span className={cx('rounded px-1 text-[10px] font-bold', sp < 0 ? 'bg-red-600 text-white' : sp <= 3 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900')}>{sp < 0 ? `delays ${daysAsHours(sp)}` : `${daysAsHours(sp)} float`}</span>}
        </span>
        {e.eq.group === 'PSVs' && e.eq.description && <span className="block truncate text-[12px] text-slate-600">📍 {e.eq.description.split(' · ')[0].replace(/^PSV on /, 'On ')}</span>}
        <span className="mt-0.5 flex items-center gap-2">
          <StageBar stage={stage} className="w-14 shrink-0" />
          {l && <span className={cx('min-w-0 truncate text-[12px]', l.tone === 'run' ? 'text-brand-600' : l.tone === 'red' ? 'text-red-800' : 'text-slate-600')}>{st && !st.finish && l.text.startsWith('Next:') ? `Next: ${st.a.activity}` : st && !st.finish && l.tone === 'red' ? `${l.text} · next ${st.a.activity}` : l.text}{dm ? drumText(dm.key) : ''}</span>}
        </span>
      </span>
      {dm && (!st || (st.finish && dm.activityIds.includes(st.a.activityId)))
        ? <button type="button" aria-label={`Drums ${e.eq.tag}`} onClick={(x) => { x.stopPropagation(); setDrumKey(dm.key); }} className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-base shadow-sm active:bg-amber-500">🛢</button>
        : st ? <StepButton key={st.a.id} a={st.a} also={st.also} finish={st.finish} more={st.more} eq={e.eq} onDone={(m, u) => onDone?.(m, u)} /> : <span className="w-8" />}
    </div>); };
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 overflow-x-auto pb-1">{['All', ...main, ...(misc.length ? ['Misc'] : [])].map((x) => { const n = x === 'All' ? shown.length : x === 'Misc' ? shown.filter((e) => misc_(e.eq.group)).length : shown.filter((e) => e.eq.group === x).length;
        return <button key={x} type="button" onClick={() => setG(x)} className={cx('min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold', g === x ? 'bg-brand-500 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{x}{n ? <span className="ml-1 opacity-60">{n}</span> : null}</button>; })}</div>
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <label className="flex items-center gap-2"><input type="checkbox" checked={onlyOps} onChange={(e) => setOnlyOps(e.target.checked)} />Operations items only</label>
        <span className="ml-auto flex rounded-lg bg-slate-200/70 p-0.5">{([[false, 'Group'], [true, 'Late first']] as const).map(([v, l]) => <button key={l} type="button" onClick={() => setLateFirst(v)} className={cx('rounded-md px-2 py-1 font-semibold', lateFirst === v ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-600')}>{l}</button>)}</span>
      </div>
      {trackerId && (g === 'All' || g === 'Reactors') && <EventsCard events={events ?? []} trackerId={trackerId} canEdit={canEdit} now={now} onDone={(m, u) => onDone?.(m, u)} />}
      {sections.map(([name, xs]) => (
        <section key={name || 'list'}>
          {name && <h3 className="mb-1 mt-2 flex justify-between px-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500"><span>{name}</span><span>{xs.length} · {xs.filter((e) => e.stage >= 1).length} HO</span></h3>}
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">{xs.map(row)}</div>
        </section>
      ))}
      {miscRows.length > 0 && <section className="pt-1">
        <button type="button" onClick={() => setShowMisc((x) => !x)} className="flex w-full justify-between rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600"><span>{showMisc ? '▾' : '▸'} Miscellaneous</span><span>{miscRows.reduce((t, [, xs]) => t + xs.length, 0)} items</span></button>
        {showMisc && miscRows.map(([name, xs]) => <div key={name}><h3 className="mb-1 mt-2 px-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{name} · {xs.length}</h3><div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">{xs.map(row)}</div></div>)}
      </section>}
      {!list.length && <p className="py-4 text-center text-sm text-slate-500">No items here{onlyOps ? ' for operations' : ''}.</p>}
      {drumKey && engine && (() => { const sc = scopeOf(drumKey)!; const tag = eqs.find((e) => (e.eq.barchartKey ?? e.eq.tag) === drumKey)?.eq.tag ?? drumKey;
        return <BottomSheet open onClose={() => setDrumKey(null)} title={`${tag} · drums`}>
          <DrumQuick scope={sc} entries={engine.entries.filter((x) => x.scopeId === sc.id)} now={now} canEdit={canEdit} onOpen={() => { setDrumKey(null); onOpen(tag); }} onDone={(m) => { setDrumKey(null); onDone?.(m); }} />
        </BottomSheet>; })()}
      {off.length > 0 && <button type="button" onClick={() => setShowOff((x) => !x)} className="w-full py-2 text-xs font-semibold text-slate-500">{showOff ? 'Hide' : 'Show'} switched-off items ({off.length})</button>}
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
              <th className="align-top text-xs font-bold text-brand-600">{fo}<span className="block font-normal text-slate-500">{n}</span></th>
              {gates.map((g) => <td key={g} className="align-top"><div className="space-y-1">{all.filter((v) => v.step.fo === fo && v.step.gate === g).map((v) => (
                <button key={v.step.stepId} type="button" onClick={() => onOpen(v.step.stepId)} title={v.step.shortName}
                  className={cx('block w-full rounded-md px-1.5 py-1 text-left text-[10px] font-semibold leading-tight', v.late ? 'bg-red-400 text-white' : v.state === 'DONE' ? 'bg-green-100 text-green-900' : v.state === 'READY' ? 'bg-amber-200 text-amber-950' : v.state === 'IN_PROGRESS' ? 'bg-brand-100 text-brand-600' : v.state === 'PENDING' ? 'bg-red-100 text-red-900' : 'bg-slate-100 text-slate-600')}>
                  {v.step.stepId}<span className="block truncate font-normal">{v.step.shortName}</span></button>))}</div></td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-slate-500">Grey waiting · amber ready · blue in progress · pink pending · green done · red late. Tap a step to open it.</p>
    </div>
  );
}

function ReportTab(p: { data: TrackerData; now: number; canEdit: boolean; by: string; onSaved: () => void }) {
  const [ask, setAsk] = useState(false);
  const n = useMemo(() => staleItems(p.data, p.now).length, [p.data, p.now]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/70 p-1 print:hidden">
        {([[false, 'Shift report'], [true, `Ask for updates${n ? ` (${n})` : ''}`]] as const).map(([v, l]) => (
          <button key={l} type="button" onClick={() => setAsk(v)} className={cx('min-h-10 rounded-xl text-sm font-semibold', ask === v ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600')}>{l}</button>))}
      </div>
      {ask ? <AskUpdates data={p.data} now={p.now} by={p.by} /> : <ShiftReportView {...p} />}
    </div>
  );
}

function ShiftReportView({ data, now, canEdit, by, onSaved }: { data: TrackerData; now: number; canEdit: boolean; by: string; onSaved: () => void }) {
  const sh = shiftOf(now);
  const saved = data.shiftLogs.find((l) => l.shiftDate === sh.date && l.shift === sh.shift) ?? null;
  const [notes, setNotes] = useState(saved?.notes ?? '');
  const [temps, setTemps] = useState<Record<string, string>>(saved?.temps ?? {});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [copied, setCopied] = useState(false);
  const r = shiftReport(data, now, { notes, temps }, data.tracker.title);
  const test = data.tracker.mode === 'test';
  const [leader, setLeader] = useState(false);
  const text = leader ? leaderReportText(data, now, { title: data.tracker.title, test, by }) : reportText(r, { test, by });
  const wa = (data.settings.whatsapp ?? '').replace(/\D/g, '');
  async function save() { setBusy(true); setErr(null); try { await saveShiftLog(data.tracker.id, sh.date, sh.shift, { notes, temps }); onSaved(); } catch (e) { setErr(e); } finally { setBusy(false); } }
  async function share() {
    if (canEdit) await save();
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch { /* cancelled */ }
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`, '_blank');
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 print:hidden">{([[false, 'Shift report'], [true, 'Team leader']] as const).map(([v, label]) => (
        <button key={label} type="button" onClick={() => setLeader(v)} className={cx('min-h-9 rounded-lg text-sm font-semibold', leader === v ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500')}>{label}</button>))}</div>
      {leader && <pre className="whitespace-pre-wrap rounded-2xl bg-whatsapp-soft p-3 font-sans text-[13px] leading-snug text-slate-800 ring-1 ring-green-200">{text}</pre>}
      <div className="grid grid-cols-2 gap-2 print:hidden sm:grid-cols-4">
        <Button onClick={share}><Share2 className="h-4 w-4" />Share</Button>
        <a href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => { if (canEdit) save(); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-whatsapp px-4 text-sm font-medium text-white"><MessageCircle className="h-4 w-4" />WhatsApp{wa ? '' : ' (choose chat)'}</a>
        <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />PDF</Button>
        <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ } }}><Copy className="h-4 w-4" />{copied ? 'Copied' : 'Copy text'}</Button>
      </div>
      {canEdit && !leader && (
        <section className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 print:hidden">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">This shift · {sh.shift === 'D' ? 'Day' : 'Night'} {kwDay(sh.from)}</h2>
          <textarea className="input min-h-16" placeholder="Notes for the next shift" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="grid grid-cols-5 gap-1.5">{REACTORS.map((k) => <label key={k} className="text-center text-[11px] text-slate-500">{k.replace('R', 'R-')}<input inputMode="numeric" className="input mt-0.5 px-1 text-center" value={temps[k] ?? ''} onChange={(e) => setTemps((t) => ({ ...t, [k]: e.target.value.replace(/[^\d.]/g, '') }))} /></label>)}</div>
          <p className="text-[11px] text-slate-500">Max bed temperature °F. Saved with the shift{saved?.updatedBy ? ` · last by ${saved.updatedBy}` : ''}.</p>
          <Button variant="secondary" className="w-full" disabled={busy} onClick={save}>Save notes</Button>
          {err != null && <ErrorBox error={err} />}
        </section>
      )}
      <article className={cx('rounded-2xl bg-white p-4 text-sm ring-1 ring-slate-200 print:ring-0', leader && 'hidden')}>
        <header className="mb-2 border-b border-slate-200 pb-2">
          <img src={`${import.meta.env.BASE_URL}brand/knpc-logo.png`} alt="KNPC" className="mb-1 hidden h-10 print:block" />
          <h2 className="font-bold text-brand-600">{test ? '[TEST] ' : ''}{r.title}</h2>
          {r.ops && r.ops.state === 'DONE' && r.ops.finishedAt !== null ? <p className="font-semibold text-status-green">Operations done {kwDay(r.ops.finishedAt)} {kwTime(r.ops.finishedAt)} (R-12-205 handed over)</p>
            : r.ops && r.ops.state !== 'NOT_STARTED' && <p className="font-semibold text-slate-800">Operations day {r.ops.day}/{r.ops.days} · Plan {r.ops.planPct}% · Actual {r.ops.actualPct}%</p>}
          {r.mi.actualStart === null ? <p className="font-semibold text-brand-600">M &amp; I starts at R-12-205 handover (plan {kwDay(r.mi.planned)} {kwTime(r.mi.planned)})</p>
            : r.mi.weighted ? <p className={cx('font-semibold', r.mi.weighted.state === 'BEHIND' ? 'text-status-red' : r.mi.weighted.state === 'AHEAD' ? 'text-status-green' : 'text-amber-700')}>M &amp; I {r.mi.weighted.state === 'BEHIND' ? 'behind' : r.mi.weighted.state === 'AHEAD' ? 'ahead' : 'on plan'} · Plan {r.mi.weighted.planPct}% · Actual {r.mi.weighted.actualPct}% · started {kwDay(r.mi.actualStart)} {kwTime(r.mi.actualStart)}</p>
            : r.mi.banner && <p className={cx('font-semibold', r.mi.banner.state === 'BEHIND' ? 'text-status-red' : r.mi.banner.state === 'AHEAD' ? 'text-status-green' : 'text-amber-700')}>M &amp; I {bannerText(r.mi.banner)} · Plan {r.mi.banner.planPct}% · Actual {r.mi.banner.actualPct}% · started {kwDay(r.mi.actualStart)} {kwTime(r.mi.actualStart)}</p>}
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
      <details className={cx('print:hidden', leader && 'hidden')}><summary className="cursor-pointer text-xs font-semibold text-slate-600">Message text</summary><pre className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs">{text}</pre></details>
    </div>
  );
}


/** The step button of an equipment row: ▶ starts the next step, ✓ finishes the running one, one tap, now. The message
 *  that follows offers Undo (the step goes back as it was, the waiting note too); other times are set in the item. */
function StepButton({ a, also = [], finish, more, eq, onDone }: { a: TrackerData['activities'][number]; also?: TrackerData['activities']; finish: boolean; more: number; eq: EquipView['eq']; onDone: (msg: string, undo?: () => Promise<unknown>) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  // saved: the spinner stays until the refreshed step arrives (no flash back to the old state)
  useEffect(() => { setBusy(false); }, [a.id, a.actualStart, a.actualFinish]);
  const go = async (x: React.MouseEvent) => {
    x.stopPropagation(); if (busy) return; setBusy(true); setErr(null);
    try {
      const at = new Date().toISOString(); const all = [a, ...also];
      const before = all.map((y) => ({ id: y.id, actual_start: y.actualStart ?? null, actual_finish: y.actualFinish ?? null }));
      // the same step of the items worked with it (E-12-216A/B) moves with it, each keeps its own line
      for (const y of all) await setActivity(y.id, finish ? { actual_finish: at, ...(y.actualStart ? {} : { actual_start: a.actualStart ?? at }) } : { actual_start: at });
      // starting a step ends the item's waiting note (it was waiting for this work to begin)
      const was = eq.pendingReason; const cleared = !finish && !!was;
      if (cleared) await setEquipment(eq.id, { pending_reason: null });
      onDone(`${all.map((y) => y.key).join(' + ')}: ${a.activity} ${finish ? 'finished' : 'started'}.${cleared ? ` Hold "${was}" ended.` : ''}`,
        async () => { for (const b of before) await setActivity(b.id, { actual_start: b.actual_start, actual_finish: b.actual_finish }); if (cleared) await setEquipment(eq.id, { pending_reason: was ?? null }); });
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Not saved'); setBusy(false); }
  };
  return (
    <span className="flex flex-col items-end">
      <button type="button" disabled={busy} onClick={go} title={`${finish ? 'Finish' : 'Start'}: ${a.activity}`} aria-label={`${finish ? 'Finish' : 'Start'} ${a.activity}`}
        className={cx('flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm disabled:opacity-50',
          finish ? 'bg-amber-400 !text-slate-900 ring-1 ring-amber-500 active:bg-amber-500' : 'bg-brand-700 active:bg-brand-500')}>
        {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : finish ? '✓' : '▶'}
      </button>
      {more > 0 && <span className="text-[10px] font-semibold text-slate-500">+{more} running</span>}
      {err && <span className="max-w-[7rem] text-right text-[10px] text-red-700">{err}</span>}
    </span>
  );
}
