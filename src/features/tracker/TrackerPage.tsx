// Shutdown progress (U-12 TR-2 tracker v1): Today · Guideline · Equipment · Map · Report (· Admin for the Section
// Head). The controllers update steps and equipment in a few taps; the status, the "needs me" list, plan vs actual and
// the shift report are worked out from the rows (src/core/tracker). Reloads every 30 s and when the page comes back.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Printer, Share2, Copy, MessageCircle } from 'lucide-react';
import { FO_NAMES, sortActs, isMisc, REACTORS, STAGE_SHORT, hoursText, isolationOf, isoState, ISO_LABEL, pointComplete, soakLeft, bannerText, equipViews, flagText, kwDay, kwTime, reportText, shiftOf, shiftReport, stepViews, type EquipView, type StepView, type TrkPoint } from '@/core/tracker';
import { currentTracker, fetchTrackerData, fetchTrackers, saveShiftLog, type Tracker, type TrackerData } from '@/data/tracker';
import type { UserProfile } from '@/data/types';
import { Button, ErrorBox, Spinner, cx } from '@/ui/components';
import { EquipSheet, StepSheet } from './TrackerSheets';
import { TrackerAdmin, clockKey } from './TrackerAdmin';
import { TimingTab } from './Timing';
import { IsolationTab } from './Isolation';
import { TodayTab, type Nav } from './TrackerToday';
import { FLAG_STYLE, ISO_DOT, IsoChip, PlanChip, StageBar, StateChip } from './ui';

type Tab = 'today' | 'isolation' | 'guideline' | 'equipment' | 'timing' | 'map' | 'report' | 'admin';
const TABS: [Tab, string][] = [['today', 'Today'], ['isolation', 'Isolation'], ['equipment', 'Equipment'], ['guideline', 'Sequence'], ['timing', 'Timing'], ['map', 'Map'], ['report', 'Report']];
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
  const [focus, setFocus] = useState<string | null>(null);
  const [isoKind, setIsoKind] = useState<'blind' | 'neut' | undefined>(undefined); const [lateFirst, setLateFirst] = useState(false);
  const [sheet, setSheet] = useState<{ kind: 'step'; id: string } | { kind: 'eq'; tag: string } | null>(null);
  const isHead = profile.role_code === 'section_head';
  const canEdit = ['section_head', 'manpower_coordinator', 'controller'].includes(profile.role_code);
  // a link to a tracker no longer active (e.g. the test copy after going live) opens the current one
  const tracker = useMemo(() => (trackers ? (id ? trackers.find((t) => t.id === id) : undefined) ?? currentTracker(trackers, today()) : null), [trackers, id]);

  const load = useCallback(async () => {
    try { const list = await fetchTrackers(); setTrackers(list); const t = (id ? list.find((x) => x.id === id) : undefined) ?? currentTracker(list, today()); if (t) setData(await fetchTrackerData(t.id)); setError(null); }
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
  const points = data.points ?? [];
  // a step ticked from elsewhere: its blinds / neutralization (Isolation) or its items handed over (Equipment)
  const auto = new Map<string, 'isolation' | 'equipment'>([...data.equipment.filter((e) => e.hoStep).map((e) => [e.hoStep!, 'equipment'] as const), ...points.filter((p) => p.stepId).map((p) => [p.stepId!, 'isolation'] as const)]);
  const nav = (n: Nav) => { setFocus(null); setIsoKind(n.iso); setLateFirst(!!n.lateFirst); setTab(n.tab); };
  const toIsolation = (tag: string | null, kind?: 'blind' | 'neut') => { setSheet(null); setFocus(tag); setIsoKind(kind); setTab('isolation'); };
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
      {tab === 'today' && <TodayTab steps={steps} eqs={eqs} data={data} now={now} onOpen={open} onNav={nav} />}
      {tab === 'isolation' && <IsolationTab key={`iso-${isoKind}`} initialKind={isoKind} activities={data.activities} points={points} lineup={data.lineup} iats={data.iats} steps={data.steps} now={now} canEdit={canEdit} isHead={isHead} focus={focus} onFocus={setFocus} onItem={(tag) => setSheet({ kind: 'eq', tag })} onDone={done} />}
      {tab === 'guideline' && <SequenceTab steps={steps} auto={auto} onOpen={(id) => setSheet({ kind: 'step', id })} />}
      {tab === 'equipment' && <EquipmentTab key={`eq-${lateFirst}`} initialLateFirst={lateFirst} eqs={eqs} activities={data.activities} points={points} now={now} onOpen={(tag) => setSheet({ kind: 'eq', tag })} />}
      {tab === 'timing' && <TimingTab activities={data.activities} steps={data.steps} now={now} canEdit={canEdit} isHead={isHead} title={tracker.title} neutKeys={new Set(data.equipment.filter((e) => points.some((p) => p.kind === 'neut' && p.items.includes(e.tag))).map((e) => e.barchartKey ?? e.tag))} onDone={done} />}
      {tab === 'map' && <MapTab steps={steps} onOpen={(id) => setSheet({ kind: 'step', id })} />}
      {tab === 'report' && <ReportTab data={data} now={now} canEdit={canEdit} by={profile.display_name} onSaved={() => load()} />}
      {tab === 'admin' && isHead && <TrackerAdmin data={data} eqs={eqs} onDone={done} />}
      {openStep && <StepSheet v={openStep} isHead={isHead} canEdit={canEdit} points={points.filter((p) => p.stepId === openStep.step.stepId)} items={eqs.filter((e) => e.eq.hoStep === openStep.step.stepId && e.eq.tracked)}
        onIsolation={() => toIsolation(null)} onClose={() => setSheet(null)} onDone={done} />}
      {openEq && <EquipSheet v={openEq} trackerId={tracker.id} canEdit={canEdit} isHead={isHead} activities={data.activities.filter((a) => a.key === (openEq.eq.barchartKey ?? openEq.eq.tag))} now={now}
        iso={isolationOf(openEq.eq.tag, points)} points={points} onIsolation={() => toIsolation(openEq.eq.tag)} onNeut={() => toIsolation(openEq.eq.tag, 'neut')} onClose={() => setSheet(null)} onDone={(m) => done(m, true)} />}
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
      {auto && v.state !== 'WAITING' && <span className="shrink-0 rounded bg-[#D6E6F5] px-1.5 py-0.5 text-[10px] font-semibold text-[#004080]">{auto === 'isolation' ? 'from Isolation' : 'from Equipment'}</span>}
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
        {Object.entries(FO_NAMES).map(([k, n]) => <button key={k} type="button" onClick={() => { setFo(k); setOpened({}); }} className={cx('min-h-10 rounded-lg text-xs font-semibold', fo === k ? 'bg-white text-[#004080] shadow-sm' : 'text-slate-600')}>{k} {n}</button>)}
      </div>
      {gates.map((g) => {
        const xs = list.filter((v) => v.step.gate === g), done = xs.filter(closedOf).length;
        const isNow = g === current, isNext = current !== undefined && g === gates[gates.indexOf(current) + 1];
        const show = opened[g] ?? (isNow || isNext);
        const now = xs.filter((v) => !closedOf(v) && v.state !== 'WAITING'), later = xs.filter((v) => v.state === 'WAITING'), fin = xs.filter(closedOf);
        return (
          <section key={g} className={cx('rounded-2xl p-2', isNow ? 'bg-[#D6E6F5]/50 ring-2 ring-[#0850A0]' : 'bg-white ring-1 ring-slate-200')}>
            <button type="button" onClick={() => setOpened((o) => ({ ...o, [g]: !show }))} className="flex w-full items-center gap-2 text-left">
              <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', done === xs.length ? 'bg-[#08A048] text-white' : isNow ? 'bg-[#0850A0] text-white' : 'bg-slate-200 text-slate-600')}>{done === xs.length ? '✓' : g}</span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-slate-800">{xs[0]?.step.gateName ?? `Gate ${g}`}{isNow && <span className="ml-1.5 rounded bg-[#0850A0] px-1.5 py-0.5 text-[10px] font-bold text-white">NOW</span>}</span>
              <span className="text-xs tabular-nums text-slate-500">{done}/{xs.length} {show ? '▾' : '▸'}</span>
            </button>
            {show && (
              <div className="mt-2 space-y-1.5">
                {now.length > 0 && <p className="text-[11px] font-bold uppercase tracking-wide text-[#004080]">Do now</p>}
                {now.map((v) => <StepRow key={v.step.stepId} v={v} auto={auto.get(v.step.stepId)} onOpen={() => onOpen(v.step.stepId)} />)}
                {later.length > 0 && <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Then</p>}
                {later.map((v) => <StepRow key={v.step.stepId} v={v} auto={auto.get(v.step.stepId)} onOpen={() => onOpen(v.step.stepId)} />)}
                {fin.length > 0 && <div className="space-y-1.5 opacity-70">{fin.map((v) => <StepRow key={v.step.stepId} v={v} auto={auto.get(v.step.stepId)} onOpen={() => onOpen(v.step.stepId)} />)}</div>}
              </div>
            )}
          </section>
        );
      })}
      {current === undefined && <p className="py-3 text-center text-sm text-[#08A048]">All steps of {fo} are done.</p>}
      <p className="text-[11px] text-slate-500">The guideline shows the order of the work. Blinds and neutralization are entered on Isolation and handovers on Equipment: their steps tick themselves.</p>
    </div>
  );
}

/** One thin row per item: tag, stage bar and the one thing to know (pending, the step running, the isolation, the next
 *  step), the status and the plan difference. "All" groups the items under their group; "Late first" puts the late,
 *  pending and IAT items on top. */
const ISO_BG = { red: 'bg-[#E02028]', grey: 'bg-slate-300', amber: 'bg-amber-500', teal: 'bg-teal-500', blue: 'bg-[#0850A0]' } as const;
function EquipmentTab({ initialLateFirst = false, eqs, activities, points, now, onOpen }: { initialLateFirst?: boolean; eqs: EquipView[]; activities: TrackerData['activities']; points: TrkPoint[]; now: number; onOpen: (tag: string) => void }) {
  const lineOf = (e: EquipView): { text: string; tone: 'run' | 'muted' | 'red' } | null => {
    if (e.eq.pendingReason) return { text: `⏸ ${e.eq.pendingReason}`, tone: 'red' };
    const key = e.eq.barchartKey ?? e.eq.tag;
    const xs = sortActs(activities.filter((a) => a.tracked && !a.detail && a.key === key));
    const run = xs.filter((a) => a.actualStart && !a.actualFinish);
    if (run.length) return { text: `▶ ${run.map((a) => a.activity).join(' · ')}`, tone: 'run' };
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
  const main = groups.filter((x) => !isMisc(x)), misc = groups.filter(isMisc);
  const [g, setG] = useState('All'); const [showMisc, setShowMisc] = useState(false);
  const [onlyOps, setOnlyOps] = useState(true); const [lateFirst, setLateFirst] = useState(initialLateFirst);
  const shown = eqs.filter((e) => !onlyOps || e.eq.opsItem || e.stage > 0);
  const inChip = (e: EquipView) => (g === 'All' ? true : g === 'Misc' ? isMisc(e.eq.group) : e.eq.group === g);
  const list = shown.filter(inChip);
  const RANK: Record<string, number> = { HO_LATE: 0, LATE: 1, PENDING: 2, IAT_OPEN: 3 };
  const sorted = lateFirst ? [...list].sort((a, b) => (RANK[a.flag] ?? 9) - (RANK[b.flag] ?? 9) || b.lateBy - a.lateBy) : list;
  const by = (xs: string[]) => xs.map((x) => [x, sorted.filter((e) => e.eq.group === x)] as [string, EquipView[]]).filter(([, ys]) => ys.length);
  // All: the main groups, then miscellaneous folded · Misc: its groups · Late first: one list, main items first
  const sections: [string, EquipView[]][] = lateFirst ? [['', [...sorted.filter((e) => !isMisc(e.eq.group)), ...sorted.filter((e) => isMisc(e.eq.group))]]]
    : g === 'All' ? by(main) : g === 'Misc' ? by(misc) : [['', sorted]];
  const miscRows = g === 'All' && !lateFirst ? by(misc) : [];
  const row = (e: EquipView) => { const l = lineOf(e); return (
    <button key={e.eq.tag} type="button" onClick={() => onOpen(e.eq.tag)} className={cx('grid w-full grid-cols-[6.5rem_1fr_auto] items-center gap-2 border-t border-slate-100 px-2.5 py-2 text-left first:border-t-0 active:bg-slate-50', !e.eq.tracked && 'opacity-50')}>
      <b className="flex min-w-0 items-center gap-1.5 text-[13px] text-slate-900">{iso(e) && <span className={cx('h-2 w-2 shrink-0 rounded-full', ISO_BG[ISO_DOT[iso(e)!.state]])} />}<span className="truncate">{e.eq.critical && <span className="text-[#E02028]">★ </span>}{e.eq.tag}</span></b>
      <span className="min-w-0">
        <StageBar stage={e.stage} className="mb-1" />
        {l && <span className={cx('block truncate text-[11.5px]', l.tone === 'run' ? 'text-[#004080]' : l.tone === 'red' ? 'text-red-800' : 'text-slate-600')}>{l.text}</span>}
      </span>
      <span className="flex flex-col items-end gap-0.5">
        {iso(e) && iso(e)!.state !== 'ho' && <IsoChip state={iso(e)!.state}>{ISO_LABEL[iso(e)!.state]}</IsoChip>}
        <span className={cx('whitespace-nowrap rounded px-1.5 py-0.5 text-[9.5px] font-bold', FLAG_STYLE[e.flag].cls)}>{FLAG_STYLE[e.flag].label}{e.late ? ` ${hoursText(e.lateBy)}` : ''}{e.iatsOpen.length && e.flag !== 'IAT_OPEN' ? ` · IAT ${e.iatsOpen.length}` : ''}</span>
        {e.plan && e.stage < 6 && <PlanChip variance={e.plan.variance} days={e.plan.days} short />}
      </span>
    </button>); };
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 overflow-x-auto pb-1">{['All', ...main, ...(misc.length ? ['Misc'] : [])].map((x) => { const n = x === 'All' ? shown.length : x === 'Misc' ? shown.filter((e) => isMisc(e.eq.group)).length : shown.filter((e) => e.eq.group === x).length;
        return <button key={x} type="button" onClick={() => setG(x)} className={cx('min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold', g === x ? 'bg-[#0850A0] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{x}{n ? <span className="ml-1 opacity-60">{n}</span> : null}</button>; })}</div>
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <label className="flex items-center gap-2"><input type="checkbox" checked={onlyOps} onChange={(e) => setOnlyOps(e.target.checked)} />Operations items only</label>
        <span className="ml-auto flex rounded-lg bg-slate-200/70 p-0.5">{([[false, 'Group'], [true, 'Late first']] as const).map(([v, l]) => <button key={l} type="button" onClick={() => setLateFirst(v)} className={cx('rounded-md px-2 py-1 font-semibold', lateFirst === v ? 'bg-white text-[#004080] shadow-sm' : 'text-slate-600')}>{l}</button>)}</span>
      </div>
      {sections.map(([name, xs]) => (
        <section key={name || 'list'}>
          {name && <h3 className="mb-1 mt-2 flex justify-between px-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500"><span>{name}</span><span>{xs.length} · {xs.filter((e) => e.stage >= 1).length} HO</span></h3>}
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">{xs.map(row)}</div>
        </section>
      ))}
      {miscRows.length > 0 && <section className="pt-1">
        <button type="button" onClick={() => setShowMisc((x) => !x)} className="flex w-full justify-between rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600"><span>{showMisc ? '▾' : '▸'} Miscellaneous</span><span>{miscRows.reduce((t, [, xs]) => t + xs.length, 0)} items</span></button>
        {showMisc && miscRows.map(([name, xs]) => <div key={name}><h3 className="mb-1 mt-2 px-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{name} · {xs.length}</h3><div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">{xs.map(row)}</div></div>)}
      </section>}
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

