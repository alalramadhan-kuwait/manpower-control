// Shutdown progress (U-12 TR-2 tracker v1): five tabs, all on screen (Today · Isolation · Equipment, with its Timing
// view · Sequence, with its Map view · IATs), the WhatsApp report and the Admin (Section Head) as sheets from the header. The controllers update steps and equipment in a few taps; the status, the "needs me" list, plan vs actual and
// the shift report are worked out from the rows (src/core/tracker). Reloads every 30 s and when the page comes back.
import { ReportImport } from './ReportImport';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Printer, Share2, Copy, MessageCircle, LayoutDashboard, Handshake, Wrench, Flame, ClipboardList, HardHat, Settings, type LucideIcon } from 'lucide-react';
import { isNR, totals, FO_NAMES, REACTORS, STAGE_SHORT, pointComplete, bannerText, equipViews, flagText, kwDay, kwTime, reportText, leaderReportText, shiftOf, shiftReport, staleItems, stepViews, type StepView } from '@/core/tracker';
import { StageReview, StaleAlert } from './StageReview';
import { CONFLICT_EVENT, currentTracker, fetchTrackerData, fetchTrackers, saveShiftLog, type Tracker, type TrackerData } from '@/data/tracker';
import type { UserProfile } from '@/data/types';
import { BottomSheet, Button, ErrorBox, Spinner, Toast, cx } from '@/ui/components';
import { AskUpdates } from './Ask';
import { EngineerView, EquipmentListTab, HandoverTab, HotWorkTab, ItemSheetFor, ScopeLists, ShutdownHero } from '@/features/engineer/EngineerApp';
import { StepSheet } from './TrackerSheets';
import { TrackerAdmin, clockKey } from './TrackerAdmin';
import { TimingTab } from './Timing';
import { TodayTab, type Nav } from './TrackerToday';
import { StateChip } from './ui';

type Tab = 'today' | 'isolation' | 'guideline' | 'equipment' | 'iats' | 'timing' | 'map' | 'scope' | 'pmr' | 'report' | 'admin';
// the bar: Timing is a view of Equipment, Map a view of Sequence; Report and Admin open as sheets
type Main = 'today' | 'equipment' | 'isolation' | 'scope' | 'iats';
// the same tabs as the Engineer mode (25 Oct): Sequence and Map are views of Handover, Timing of Equipment, PMRs of Hot work
const TABS: [Main, string, LucideIcon][] = [['today', 'Dashboard', LayoutDashboard], ['equipment', 'Equipment', Wrench], ['isolation', 'Handover', Handshake], ['scope', 'SD scope', ClipboardList], ['iats', 'Hot work', Flame]];
const MAIN: Record<Tab, Main> = { today: 'today', isolation: 'isolation', equipment: 'equipment', timing: 'equipment', guideline: 'isolation', map: 'isolation', scope: 'scope', iats: 'iats', pmr: 'iats', report: 'today', admin: 'today' };
const VIEWS: Partial<Record<Main, [Tab, string][]>> = { equipment: [['equipment', 'Items'], ['timing', 'Timing']], isolation: [['isolation', 'Isolation'], ['guideline', 'Sequence'], ['map', 'Map']] };
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
  const isoOpen = points.filter((p) => (p.kind === 'blind' || p.beforeHo) && !pointComplete(p) && !isNR(p)).length;
  const open = (a: { kind: 'step' | 'equipment'; ref: string }) => setSheet(a.kind === 'step' ? { kind: 'step', id: a.ref } : { kind: 'eq', tag: a.ref });

  if (eng) return <div className="fixed inset-0 z-[60] overflow-y-auto bg-canvas"><EngineerView trackerId={tracker.id} name={profile.display_name} title={tracker.title} role={isHead ? 'head' : profile.role_code === 'controller' ? 'controller' : 'engineer'} me={profile.auth_user_id} onExit={() => toEng(false)} /></div>;
  return (
    <div className="mx-auto max-w-3xl pb-24">
      {test && <div className="mb-2 rounded-lg bg-amber-200 px-3 py-1.5 text-center text-xs font-bold tracking-wide text-amber-950">TEST · a copy for trying; nothing here is live{now !== Date.now() && Math.abs(now - Date.now()) > 120_000 ? ` · clock ${kwDay(now)} ${kwTime(now)}` : ''}{other.filter((o) => o.mode === 'live').map((o) => <Link key={o.id} to={`/progress/${o.id}`} className="ml-2 underline">Live ›</Link>)}</div>}
      <div className="mb-2 flex items-center justify-between gap-2 print:hidden">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-brand-700">{tracker.title}</h1>
          <p className="text-xs text-slate-500">{isHead ? 'Section Head mode · ' : ''}{tracker.eventTitle ?? ''}{tracker.settings.workOrder ? ` · WO ${tracker.settings.workOrder}` : ''}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => toEng(true)} title="Engineer view" aria-label="Engineer view" className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl bg-white px-2.5 text-sm font-semibold text-brand-700 ring-1 ring-slate-300 active:bg-slate-50"><HardHat className="h-5 w-5" /><span className="hidden sm:inline">Engineer mode</span></button>
          <button type="button" onClick={() => setTab('report')} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-whatsapp px-3 text-sm font-bold text-white shadow-sm active:opacity-90"><MessageCircle className="h-4 w-4" />Report</button>
          {isHead && <button type="button" aria-label="Admin" title="Admin" onClick={() => setTab('admin')} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white text-brand-700 ring-1 ring-slate-300 active:bg-slate-50"><Settings className="h-5 w-5" /></button>}
        </div>
      </div>
      <nav className="sticky top-0 z-20 mb-2 grid grid-cols-5 gap-0.5 rounded-2xl bg-slate-200/70 p-1 backdrop-blur print:hidden" aria-label="Progress">
        {TABS.map(([k, label, Icon]) => { const on = MAIN[tab] === k; const badge = k === 'equipment' ? tot.late : k === 'iats' ? tot.iatOpen : k === 'isolation' ? isoOpen : 0;
          return <button key={k} type="button" aria-current={on ? 'page' : undefined} onClick={() => setTab(k)}
            className={cx('relative flex min-h-14 flex-col items-center justify-center rounded-xl px-0.5 text-[11px] font-semibold', on ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 active:bg-white/60')}>
            <Icon className="h-5 w-5" aria-hidden /><span className="mt-0.5 truncate">{label}</span>
            {badge > 0 && <span className={cx('absolute right-1 top-0.5 min-w-[18px] rounded-full px-1 text-[10px] font-bold leading-[18px] text-white', k === 'equipment' ? 'bg-status-red' : k === 'isolation' ? 'bg-brand-500' : 'bg-status-amber')}>{badge}</span>}
          </button>; })}
      </nav>
      {VIEWS[MAIN[tab]] && <div className={cx('mb-3 grid gap-1 rounded-xl bg-slate-200/60 p-1 print:hidden', VIEWS[MAIN[tab]]!.length > 2 ? 'grid-cols-3' : 'grid-cols-2')}>
        {VIEWS[MAIN[tab]]!.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={cx('min-h-10 rounded-lg text-sm font-semibold', tab === k ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600')}>{l}</button>)}
      </div>}
      {refreshing && <div aria-hidden className="fixed inset-x-0 top-0 z-[80] h-1 overflow-hidden bg-brand-100"><div className="h-full w-1/3 animate-[trkbar_1s_ease-in-out_infinite] bg-brand-500" /></div>}
      {flash && <Toast msg={flash.msg} onUndo={flash.undo ? undoLast : undefined} />}
      {tab === 'today' && <StaleAlert data={data} now={now} onAsk={() => setTab('report')} />}
      {tab === 'today' && <ShutdownHero d={data} now={now} onGroup={() => setTab('equipment')} onSmall={() => setTab('scope')} />}
      {tab === 'today' && eqs && <StageReview data={data} eqs={eqs} canEdit={canEdit} onOpen={(tag) => open({ kind: 'equipment', ref: tag })} onDone={() => load(true)} />}
      {tab === 'today' && <TodayTab steps={steps} eqs={eqs} data={data} now={now} onOpen={open} onNav={nav} />}
      {tab === 'isolation' && <HandoverTab key={`iso-${isoKind}-${focus}`} d={data} now={now} role={isHead ? 'head' : profile.role_code === 'controller' ? 'controller' : 'engineer'} focus={focus} onClearFocus={() => setFocus(null)} initial={isoKind} onItem={(tag) => setSheet({ kind: 'eq', tag })} onStep={(id) => setSheet({ kind: 'step', id })} done={(m, u) => done(m, true, u)} />}
      {tab === 'guideline' && <SequenceTab steps={steps} auto={auto} onOpen={(id) => setSheet({ kind: 'step', id })} />}
      {tab === 'equipment' && <EquipmentListTab key={`eq-${lateFirst}`} initial={lateFirst ? 'late' : 'all'} d={data} now={now} role={isHead ? 'head' : profile.role_code === 'controller' ? 'controller' : 'engineer'} onItem={(tag) => setSheet({ kind: 'eq', tag })} done={(m, u) => done(m, true, u)} />}
      {tab === 'timing' && <TimingTab activities={data.activities} steps={data.steps} now={now} canEdit={canEdit} isHead={isHead} title={tracker.title} neutKeys={new Set(data.equipment.filter((e) => points.some((p) => p.kind === 'neut' && p.items.includes(e.tag))).map((e) => e.barchartKey ?? e.tag))} onDone={(m, u) => done(m, false, u)} />}
      {(tab === 'iats' || tab === 'pmr') && <HotWorkTab d={data} now={now} role={isHead ? 'head' : profile.role_code === 'controller' ? 'controller' : 'engineer'} onItem={(tag) => setSheet({ kind: 'eq', tag })} done={(m, u) => done(m, true, u)} />}
      {tab === 'scope' && <ScopeLists d={data} now={now} role={isHead ? 'head' : profile.role_code === 'controller' ? 'controller' : 'engineer'} onItem={(tag) => setSheet({ kind: 'eq', tag })} done={(m, u) => done(m, true, u)} />}
      {tab === 'map' && <MapTab steps={steps} onOpen={(id) => setSheet({ kind: 'step', id })} />}
      {sheetTab === 'report' && <BottomSheet open onClose={closeSheetTab} title="💬 Shift report"><ReportTab data={data} now={now} canEdit={canEdit} isHead={isHead} onDone={(m) => done(m, false)} by={profile.display_name} onSaved={() => load(true)} /></BottomSheet>}
      {sheetTab === 'admin' && isHead && <BottomSheet open onClose={closeSheetTab} title="⚙️ Admin · Section Head">
        {other.length > 0 && <div className="mb-3 flex items-center justify-between rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200"><span><b className={test ? 'text-amber-800' : 'text-brand-500'}>{test ? 'TEST' : 'LIVE'}</b> · {test ? 'a copy for trying' : 'this is the real tracker'}</span>
          {other.map((o) => <Link key={o.id} to={`/progress/${o.id}`} className="font-bold text-brand-500">{o.mode === 'live' ? 'Live' : 'Test copy'} ›</Link>)}</div>}
        <TrackerAdmin data={data} eqs={eqs} by={profile.display_name} onDone={done} /></BottomSheet>}
      {openStep && <StepSheet v={openStep} isHead={isHead} canEdit={canEdit} points={points.filter((p) => p.stepId === openStep.step.stepId)} items={eqs.filter((e) => e.eq.hoStep === openStep.step.stepId && e.eq.tracked)}
        onIsolation={() => toIsolation(null)} onClose={() => setSheet(null)} onDone={(m, u) => done(m, false, u)} />}
      {openEq && <ItemSheetFor key={openEq.eq.tag} d={data} tag={openEq.eq.tag} now={now} role={isHead ? 'head' : profile.role_code === 'controller' ? 'controller' : 'engineer'} me={profile.auth_user_id} onIsolation={(tag) => toIsolation(tag)} onClose={() => setSheet(null)} done={(m, u) => done(m, true, u)} />}
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

function ReportTab(p: { data: TrackerData; now: number; canEdit: boolean; by: string; isHead?: boolean; onSaved: () => void; onDone?: (msg: string) => void }) {
  const [ask, setAsk] = useState(false); const [imp, setImp] = useState(false);
  const n = useMemo(() => staleItems(p.data, p.now).length, [p.data, p.now]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/70 p-1 print:hidden">
        {([[false, 'Shift report'], [true, `Ask for updates${n ? ` (${n})` : ''}`]] as const).map(([v, l]) => (
          <button key={l} type="button" onClick={() => setAsk(v)} className={cx('min-h-10 rounded-xl text-sm font-semibold', ask === v ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600')}>{l}</button>))}
      </div>
      {p.isHead && <button type="button" onClick={() => setImp((x) => !x)} className="w-full rounded-xl px-3 py-2 text-left text-[13px] font-semibold text-brand-700 ring-1 ring-slate-200 print:hidden">{imp ? '▾' : '▸'} 📥 Import the plant's shutdown report</button>}
      {imp && <ReportImport data={p.data} onDone={(m) => { p.onDone?.(m); p.onSaved(); }} />}
      {!imp && (ask ? <AskUpdates data={p.data} now={p.now} by={p.by} /> : <ShiftReportView {...p} />)}
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
