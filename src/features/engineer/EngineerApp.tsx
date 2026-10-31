// The engineer's view of the shutdown tracker: a personal link (hidden key) and an ID, no app login. Four tabs, the
// same live records as the Section Head's tracker: Dashboard (on time or not), Equipment (what needs an update, the
// reactors' issues and temperatures), Isolation (neutralization and blinds), Small jobs & IATs. Every change is
// stamped with the ID; Undo for a few seconds after each one.
import { LatestUpdate } from '@/features/tracker/intel/LatestUpdate';
import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ItemMore, PendingForm } from '@/features/tracker/TrackerSheets';
import { ShutdownOverview } from '@/features/tracker/TrackerToday';
import { ActivityRow } from '@/features/tracker/Timing';
import { RowList } from '@/features/tracker/ui';
import { StepButton } from '@/features/tracker/StepButton';
import { IatDetail, LABEL_CLS, OpsLabel } from '@/features/tracker/Iats';
import { InspWork } from '@/features/tracker/ui';
import { LoopDetail, LoopScope } from '@/features/tracker/Isolation';
import { BlindList } from '@/features/tracker/BlindList';
import { stepNow } from '@/features/tracker/actions';
import { ClipboardList, Flame, Handshake, LayoutDashboard, Wrench, type LucideIcon } from 'lucide-react';
import { LoopDiagramButton } from '@/features/tracker/LoopDiagram';
import { bufferCatchUp, isBufferStep, runTogether, putBackRows, RETURN_KIND, type PutBackRow, type TrkReturnItem, equipmentList, lateOrHold, WITH_EQUIP, blindLink, neutLink, isOutOfScope, scopeReasonText, timing, equipBlind, equipViews, scopeImpact, relatedWork, isolationOf, inEquipmentTab, isNR, nrLabel, loopBasis, shownGroup, ROTATING, daysAsHours, EVENT_LABEL, IAT_LABELS, type IatLabel, hoursText, isoState, soakLeft, IAT_STATUSES, iatClosedBy, reportText, leaderReportText, shiftReport, iatStatus, isSmallJob, lineOnEquipment, lineStreams, kwDay, kwTime, linkedStep, missingBlinds, neutLabel, phases, waitingSteps, pointComplete, shiftOf, sortActs, STAGE_SHORT, staleItems, withReactor, stepGroups, bedName, isLinkedTest, bedMatrix, bedRowDone, bedRowOff, bedItemDone, bedLate, bedWindow, stepPhases, phaseName, PHASE_IDS, type Phase, type BedSet, type BedRow, type BedDept,
  type MiItem, spanText, type PointStatus, type TrkEvent, type TrkActivity, type TrkEquipment, type TrkIat, type TrkPoint, type TrkPointStep } from '@/core/tracker';
import { setFollow, addReturnItem, setReturnItem, BACKDATE_LIMIT_H, CONFLICT_EVENT, addEngStep, addEvent, endEvent, setEventText, fetchTrackerData, restoreIat, saveShiftLog, setActivity, setEquipment, setIatStatus, setOrder, setPoint, setPointStepTime, type TrackerData } from '@/data/tracker';
import { engineerLink, setEngineerLink, supabase } from '@/data/supabase';
import { ensureAppRules } from '@/data/rulesClient';
import { BottomSheet, ErrorBox, Spinner, Toast, cx } from '@/ui/components';
import { fetchSdTeamOn } from '@/data/shutdown';
import { recordVisit } from '@/data/activity';
import { OPEN_END, onLeaveOn } from '@/core/leave';
import { lapsedLeave, type OracleStatus } from '@/core/oracle';
import { PlanCard } from '@/features/day/ShutdownToday';

export type Tab = 'dash' | 'equip' | 'ho' | 'scope' | 'hot';
type Done = (msg: string, undo?: () => Promise<unknown>) => void;
const TABS: [Tab, LucideIcon, string][] = [['dash', LayoutDashboard, 'Dashboard'], ['equip', Wrench, 'Equipment'], ['ho', Handshake, 'Handover'], ['scope', ClipboardList, 'SD scope'], ['hot', Flame, 'Hot work']];
/** The SD scope lists by discipline; PMRs are hot work. */
const SCOPE: [string, string[]][] = [['Rotating', [ROTATING]], ['Operations', ['OPR list']], ['Instrument', ['CV shells']], ['Inspection', ['Check valves', 'Process piping']]];
const H = 36e5;
const short = (t: string) => t.replace(/^([A-Z]{1,3})-12-/, '$1-').replace(/^12-/, '');
const when = (iso: string | number | null | undefined) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '');
const lines = (d: TrackerData, keys: string[]) => sortActs(d.activities.filter((a) => keys.includes(a.key) && a.tracked && !a.detail && a.group !== 'Operations'));
const keyOf = (e: TrkEquipment) => e.barchartKey ?? e.tag;

/** On an engineer page, "Add to Home Screen" saves this page's own address (with the link) and its own name: the app's
 *  manifest would send the icon to the main sign-in page instead. */
function useEngineerHomeScreen() {
  useEffect(() => {
    document.querySelector('link[rel="manifest"]')?.remove();
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Operations');
    document.title = 'Operations Portal';
    const key = engineerLink()?.key;
    if (key && !new URLSearchParams(window.location.search).get('sd')) window.history.replaceState(null, '', `${window.location.pathname}?sd=${encodeURIComponent(key)}`);
  }, []);
}

/** The link page: the key from the link, the ID typed once; then the tracker. */
export default function EngineerApp() {
  useEngineerHomeScreen();
  const urlKey = new URLSearchParams(window.location.search).get('sd');
  const link = engineerLink();
  const [id, setId] = useState('');
  if (urlKey && (!link || link.key !== urlKey)) {
    // the address keeps the link: a Home Screen app saved from here opens with it (it has its own storage on iPhone)
    const open = () => { if (!id.trim()) return; setEngineerLink({ key: urlKey, id: id.trim() }); window.location.replace(`${window.location.pathname}?sd=${encodeURIComponent(urlKey)}`); };
    return (
      <Frame title="Operations Portal" sub="">
        <div className="mx-auto max-w-sm px-4 pt-16 text-center">
          <img src="/icon.svg" alt="" className="mx-auto h-14 w-14" />
          <p className="mt-2 text-xl font-bold text-brand-700">Welcome</p>
          <p className="text-sm text-slate-600">Enter your ID</p>
          <input className="input mt-5 text-center text-xl font-bold tracking-wider" autoCapitalize="none" autoCorrect="off" value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && open()} placeholder="Your ID" />
          <button type="button" onClick={open} disabled={!id.trim()} className="mt-3 min-h-12 w-full rounded-2xl bg-brand-700 text-base font-bold text-white disabled:opacity-50">Open</button>
          <p className="mt-4 text-xs text-slate-500">This link is for you only. Ask the administrator if it stops working.</p>
        </div>
      </Frame>
    );
  }
  return <Tracker />;
}

function Frame({ title, sub, right, children }: { title: string; sub: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas pb-24">
      <header className="sticky top-0 z-30 flex items-center gap-2 bg-brand-700 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] text-white">
        <div className="min-w-0 flex-1"><p className="truncate text-[17px] font-bold">{title}</p><p className="truncate text-xs opacity-80">{sub}</p></div>{right}
      </header>
      {children}
    </div>
  );
}

/** Who is using the page: the same screens, with the actions of the role. A Controller does not rename, add or remove
 *  steps, mark loops not required, label IATs or confirm a reactor empty. The database stays the final check. */
export type EngRole = 'head' | 'engineer' | 'controller';
const RoleCtx = createContext<EngRole>('engineer');
const useCanManage = () => useContext(RoleCtx) !== 'controller';
/** Opens an item in the page around (the Section Head mode opens its own item sheet); none = the Engineer item sheet. */
const OpenItemCtx = createContext<((tag: string) => void) | null>(null);
/** The signed-in person (a second person verifies drum entries) and where an item's isolation opens (Handover). */
const MeCtx = createContext<string | null>(null);
const IsoCtx = createContext<((tag: string) => void) | null>(null);
/** The SD scope, the same lists in the Section Head mode (its item sheet opens on a tap). */
export function ScopeLists({ d, now, done, role, onItem }: { d: TrackerData; now: number; done: Done; role: EngRole; onItem: (tag: string) => void }) {
  return <RoleCtx.Provider value={role}><OpenItemCtx.Provider value={onItem}><Scope d={d} now={now} done={done} go={() => {}} by="" /></OpenItemCtx.Provider></RoleCtx.Provider>;
}

function Tracker({ preset, onExit }: { preset?: { login_id: string; tracker_id: string; title: string }; onExit?: () => void } = {}) {
  const [me, setMe] = useState<{ login_id: string; tracker_id: string; title: string } | null | 'off'>(preset ?? null);
  const [data, setData] = useState<TrackerData | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('dash');
  // with the other hooks, before any early return (a hook after one breaks the page once the data loads)
  useEffect(() => { if (!preset) recordVisit(`/engineer/${tab}`); }, [tab, preset]);
  const [eqf, setEqf] = useState('all'); const [hoFocus, setHoFocus] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState<{ msg: string; undo?: () => Promise<unknown> } | null>(null);
  const load = useCallback(async (trackerId: string) => { try { await ensureAppRules(); setData(await fetchTrackerData(trackerId)); setNow(Date.now()); setErr(null); } catch (e) { setErr(e); } }, []);
  useEffect(() => {
    void (async () => {
      if (preset) { await load(preset.tracker_id); return; }
      const { data: r, error } = await supabase.rpc('trk_access_me');
      if (error) { setErr(error); return; }
      const row = (r as { login_id: string; tracker_id: string; title: string }[] | null)?.[0];
      if (!row) { setMe('off'); return; }
      setMe(row); await load(row.tracker_id);
    })();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const i = window.setInterval(() => { if (me && me !== 'off' && document.visibilityState === 'visible') void load(me.tracker_id); }, 120000); return () => window.clearInterval(i); }, [me, load]);
  // a save refused because someone else changed the record: show what is there now
  useEffect(() => { const f = () => { if (me && me !== 'off') void load(me.tracker_id); }; window.addEventListener(CONFLICT_EVENT, f); return () => window.removeEventListener(CONFLICT_EVENT, f); }, [me, load]);
  useEffect(() => { if (!flash) return; const t = window.setTimeout(() => setFlash(null), flash.undo ? 7000 : 3000); return () => window.clearTimeout(t); }, [flash]);
  if (me === 'off') return (
    <Frame title="Operations Portal" sub="">
      <div className="mx-auto max-w-sm p-6 text-center"><p className="font-semibold text-brand-700">This link is no longer used.</p>
        <p className="mt-2 text-sm text-slate-600">Sign in to the portal with your own account.</p>
        <button type="button" className="mt-5 min-h-11 w-full rounded-xl bg-brand-700 font-semibold text-white" onClick={() => { setEngineerLink(null); window.location.replace('/shutdowns?section=progress'); }}>Go to sign in</button></div>
    </Frame>
  );
  if (err && !data) return <Frame title="Operations Portal" sub=""><div className="p-4"><ErrorBox error={err} /></div></Frame>;
  if (!me || !data) return <Frame title="Operations Portal" sub="Loading…"><div className="p-10"><Spinner /></div></Frame>;
  const sh = shiftOf(now);
  const done: Done = (msg, undo) => { setFlash({ msg, undo }); void load(me.tracker_id); };
  const go = (t: Tab, g?: string) => { setTab(t); if (g) setEqf(g); window.scrollTo(0, 0); };
  const props = { d: data, now, done, go, by: me.login_id };
  return (
    <Frame title={`Hi ${me.login_id}`} sub={`${kwDay(now)} · ${sh.shift === 'D' ? 'Day' : 'Night'} shift · ${data.tracker.title}`}
      right={<>{onExit && <button type="button" onClick={onExit} className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-brand-700">Section Head mode</button>}
        <button type="button" aria-label="Refresh" onClick={() => void load(me.tracker_id)} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold">↻</button></>}>
      <IsoCtx.Provider value={(tag) => { setHoFocus(tag); setTab('ho'); window.scrollTo(0, 0); }}><main className="mx-auto max-w-xl px-3 pt-3">
        {err != null && <div className="mb-2"><ErrorBox error={err} /></div>}
        {tab === 'dash' && <Dashboard {...props} />}
        {tab === 'equip' && <Equipment {...props} f={eqf} setF={setEqf} />}
        {tab === 'ho' && <Handover key={hoFocus ?? ''} {...props} focus={hoFocus} onClearFocus={() => setHoFocus(null)} />}
        {tab === 'scope' && <Scope {...props} />}
        {tab === 'hot' && <HotWork {...props} />}
      </main></IsoCtx.Provider>
      {flash && <Toast msg={flash.msg} onUndo={flash.undo ? async () => { const u = flash.undo!; setFlash(null); try { await u(); done('Undone.'); } catch (e) { setErr(e); } } : undefined} />}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[max(6px,env(safe-area-inset-bottom))] backdrop-blur" aria-label="Tracker">
        <div className="mx-auto flex max-w-xl">{TABS.map(([k, Icon, l]) => <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)} className={cx('flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]', tab === k ? 'font-semibold text-brand-700' : 'text-slate-500')}><Icon className="h-5 w-5" aria-hidden />{l}</button>)}</div>
      </nav>
    </Frame>
  );
}

type P = { d: TrackerData; now: number; done: Done; go: (t: Tab, group?: string) => void; by: string };
const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => <section className={cx('mb-2.5 rounded-2xl bg-white p-3 ring-1 ring-slate-200', className)}>{children}</section>;
/** Every list in one shape: one card per group, a compact row per item (tag, two short lines, a chip on the right). */
const List = ({ children }: { children: React.ReactNode }) => <div className="mb-2.5 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">{children}</div>;
const ROW = 'flex w-full items-center gap-2 border-b border-slate-100 px-2.5 py-1.5 text-left last:border-b-0 active:bg-slate-50';
const TAG = 'min-w-[80px] shrink-0 whitespace-nowrap text-[13px] leading-tight';
/** The tag in its column; a long name (a line, a loop) goes above the details instead, so the columns stay in line. */
const Tagged = ({ tag, children }: { tag: string; children: React.ReactNode }) => tag.length <= 9
  ? <><b className={cx(TAG, 'pt-px')}>{tag}</b><span className="min-w-0 flex-1">{children}</span></>
  : <span className="min-w-0 flex-1"><b className="block truncate text-[13px] leading-tight">{tag}</b>{children}</span>;
const Sec = ({ children }: { children: React.ReactNode }) => <p className="mx-1 mb-1.5 mt-3 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">{children}</p>;
const Seg = <T extends string>({ v, set, opts }: { v: T; set: (x: T) => void; opts: [T, string][] }) => (
  <div className="mb-2.5 flex gap-1 rounded-xl bg-slate-200/60 p-1">{opts.map(([k, l]) => <button key={k} type="button" aria-pressed={v === k} onClick={() => set(k)} className={cx('min-h-9 flex-1 rounded-lg px-2 text-[13px] font-semibold', v === k ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600')}>{l}</button>)}</div>);
const Bar = ({ act, plan, tone }: { act: number; plan: number; tone: string }) => (
  <span className="relative block h-3 flex-1 rounded-full bg-slate-200"><span className={cx('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: `${Math.min(100, act)}%` }} /><span className="absolute -top-1 h-5 w-[3px] rounded bg-slate-900" style={{ left: `${Math.min(100, plan)}%` }} /></span>);
const tone = (act: number, plan: number) => (act >= plan ? 'bg-status-green' : act >= plan - 10 ? 'bg-amber-400' : 'bg-status-red');
const age = (h: number, lim = 12) => <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', h >= lim * 1.5 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900')}>{h} h</span>;

/** One group on the dashboard: name, bar, done / plan on one line, the whole row opens the group. */
const GroupRow = ({ label, act, plan, onClick }: { label: string; act: number; plan: number; onClick: () => void }) => (
  <button type="button" onClick={onClick} className="grid min-h-10 w-full grid-cols-[92px_1fr_68px_10px] items-center gap-2 border-t border-slate-100 text-left text-[12px] first-of-type:border-t-0 active:bg-slate-50">
    <span className="truncate font-bold">{label}</span><Bar act={act} plan={plan} tone={tone(act, plan)} />
    <span className="whitespace-nowrap text-right font-semibold tabular-nums text-slate-600">{act}% / {plan}%</span><span className="text-slate-500">›</span></button>);

// ── Dashboard ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Work running or due with no update for longer than its limit (critical path 6 h, others 12 h, small jobs 24 h). */

/** The Dashboard, the same in both modes; the Section Head mode adds its part below (stage review, the phases) and
 *  keeps the report in its header. */
export function DashboardTab({ d, now, done, role, by, go, more, onItem, intel }: { d: TrackerData; now: number; done: Done; role: EngRole; by: string; go: (t: Tab, group?: string) => void; more?: React.ReactNode; onItem?: (tag: string) => void; intel?: React.ReactNode }) {
  return <RoleCtx.Provider value={role}><OpenItemCtx.Provider value={onItem ?? null}><Dashboard d={d} now={now} done={done} go={go} by={by} report={false} more={more} intel={intel} /></OpenItemCtx.Provider></RoleCtx.Provider>;
}
/** The Dashboard: the shutdown at a glance (end, progress, what sets the end, Operations / M & I, needs attention), the
 *  rest folded below (by group, issues, team; the Section Head's stage review and focus list). */
function Dashboard({ d, now, go, by, done, report: withReport = true, more, intel }: P & { report?: boolean; more?: React.ReactNode; intel?: React.ReactNode }) {
  const [report, setReport] = useState(false); const [item, setItem] = useState<TrkEquipment | null>(null);
  const openItem = useContext(OpenItemCtx), head = useContext(RoleCtx) === 'head';
  const toItem = (tag: string) => (openItem ? openItem(tag) : setItem(d.equipment.find((e) => e.tag === tag) ?? null));
  const issues = (d.events ?? []).filter((x) => !x.endedAt).length;
  return (<>
    {withReport && <button type="button" onClick={() => setReport(true)} className="mb-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-2xl bg-whatsapp text-[14px] font-bold text-white active:opacity-90">💬 WhatsApp report</button>}
    {report && <ReportSheet d={d} now={now} by={by} onClose={() => setReport(false)} />}
    {intel}
    <ShutdownOverview data={d} now={now} head={head} onItem={toItem} onDone={(m) => done(m)} onGo={(to) => (to === 'todo' || to === 'late' || to === 'all' ? go('equip', to) : to === 'ho' ? go('ho') : to === 'hot' ? go('hot') : head ? go('dash', 'focus') : undefined)} />
    <DashFold title="Progress by group"><GroupProgress d={d} now={now} onGroup={(g) => go('equip', g)} onSmall={() => go('scope')} /></DashFold>
    <DashFold title={`Issues · ${issues ? `${issues} open` : 'none open'}`} open={issues > 0}><Issues d={d} done={done} /></DashFold>
    <DashFold title="Team today"><TeamToday now={now} /></DashFold>
    {more}
    {item && <ItemSheet d={d} e={item} done={done} onClose={() => setItem(null)} />}
  </>);
}
/** A folded section of the Dashboard: one header line, closed unless something needs action. */
export function DashFold({ title, open: initial = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return <div className="mb-1.5">
    <button type="button" onClick={() => setOpen((x) => !x)} className="flex min-h-10 w-full items-center gap-2 rounded-xl bg-white px-3 text-left text-[13px] font-semibold text-slate-700 ring-1 ring-slate-200">
      <span className="w-3 text-slate-500">{open ? '▾' : '▸'}</span><span className="min-w-0 flex-1 truncate">{title}</span></button>
    {open && <div className="mt-1.5">{children}</div>}
  </div>;
}

/** The three cards that answer "are we late": end date, main equipment done vs plan, done / plan by group. The same
 *  cards on the Engineer dashboard and the Section Head's Today. */
/** Done / plan by equipment group (each item weighed by its hours, as the main %), folded on the Dashboard. */
export function GroupProgress({ d, now, onGroup, onSmall }: { d: TrackerData; now: number; onGroup: (group: string) => void; onSmall: () => void }) {
  const mi = useMemo(() => phases(d, now).mi, [d, now]);
  const w = mi.weighted;
  // done / plan by equipment group, each item weighed by its hours (as the main %)
  const groups = useMemo(() => {
    if (!w) return [];
    const hrs = (key: string) => d.activities.filter((a) => a.key === key && a.tracked && !a.detail && a.group !== 'Operations' && a.start && a.finish).reduce((t, a) => t + Math.max(0, a.durationH ?? (Date.parse(a.finish!) - Date.parse(a.start!)) / H), 0);
    const by = new Map<string, { h: number; a: number; p: number }>();
    for (const i of w.items.filter((x) => !x.small)) { const h = hrs(i.key); const g = by.get(i.group) ?? { h: 0, a: 0, p: 0 }; g.h += h; g.a += i.physPct * h; g.p += i.planPct * h; by.set(i.group, g); }
    return [...by].filter(([, g]) => g.h > 0).map(([g, x]) => ({ g, act: Math.round(x.a / x.h), plan: Math.round(x.p / x.h) }));
  }, [d, w]);
  if (!w) return <Card><p className="text-sm text-slate-600">M &amp; I has not started yet.</p></Card>;
  const byGroup = <Card>
      {groups.map((x) => <GroupRow key={x.g} label={x.g} act={x.act} plan={x.plan} onClick={() => onGroup(x.g)} />)}
      <GroupRow label="Small jobs" act={w.small.physPct} plan={w.small.planPct} onClick={onSmall} />
      <p className="mt-1.5 text-[11px] text-slate-500">done / plan · black line = where the plan is today · tap to open</p>
    </Card>;
  return byGroup;
}

/** The shutdown team on duty this shift (the same card as the Section Head's Today page). */
function TeamToday({ now }: { now: number }) {
  const date = shiftOf(now).date;
  const [r, setR] = useState<Awaited<ReturnType<typeof fetchSdTeamOn>> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { let live = true; fetchSdTeamOn(date).then((x) => live && setR(x)).catch((e) => live && setErr(e)); return () => { live = false; }; }, [date]);
  const leave = useMemo(() => {
    if (!r) return new Map();
    const crewOf = new Map(r.people.map((p) => [p.id, p.crew]));
    return onLeaveOn(date, r.leave.filter((l) => !lapsedLeave({ typeCode: l.absence_type_code, oracle: l.oracle_status as OracleStatus | null, start: l.start_date }, date))
      .map((l) => ({ employeeId: l.employee_id, start: l.start_date, end: l.end_date ?? OPEN_END, status: l.status, inCurrentPlan: l.in_current_plan, typeLabel: l.label, typeShort: l.short_code, oracle: l.oracle_status as OracleStatus | null })), (id) => crewOf.get(id) ?? null);
  }, [r, date]);
  if (err) return null;
  if (!r) return <Card><p className="text-[12px] text-slate-500">Loading the shutdown team…</p></Card>;
  return <>{r.plans.map((x) => <PlanCard key={x.plan.id} x={x} date={date} people={r.people} leave={leave} link={false} />)}</>;
}

// ── Equipment (main) ────────────────────────────────────────────────────────────────────────────────────────────────
function itemLine(d: TrackerData, e: TrkEquipment): string {
  if (e.pendingReason) return `On hold · ${e.pendingReason}`;
  const ls = lines(d, [keyOf(e)]); const r = ls.find((a) => a.actualStart && !a.actualFinish), n = ls.find((a) => !a.actualStart);
  // the written status, unless a step was started or finished after it (the newer one is shown)
  const t = (x?: string | null) => (x ? Date.parse(x) : 0);
  const lastStep = Math.max(0, ...ls.flatMap((a) => [t(a.actualStart), t(a.actualFinish)]));
  if (e.remark?.trim() && t(e.updatedAt) >= lastStep) return e.remark.trim();
  const fin = [...ls].filter((a) => a.actualFinish).sort((a, b) => t(b.actualFinish) - t(a.actualFinish))[0];
  return r ? `${r.activity} I/P` : fin && n ? `${fin.activity} done · next: ${n.activity}` : n ? `Next: ${n.activity}` : ls.length ? 'All steps done' : '—';
}
/** When the item was last updated: its steps, its remark / hold, its drums. */
function lastUpdate(d: TrackerData, keys: string[]): number | null {
  const scopes = (d.engine?.scopes ?? []).filter((s) => keys.includes(s.key)).map((s) => s.id);
  const ts = [...d.activities.filter((a) => keys.includes(a.key) && a.tracked && !a.detail).flatMap((a) => [a.actualStart, a.actualFinish, a.updatedAt]),
    ...d.equipment.filter((x) => keys.includes(keyOf(x))).map((x) => x.updatedAt), ...(d.engine?.entries ?? []).filter((x) => scopes.includes(x.scopeId)).map((x) => x.enteredAt)]
    .filter((x): x is string => !!x).map((x) => Date.parse(x)).filter((x) => !Number.isNaN(x));
  return ts.length ? Math.max(...ts) : null;
}
const ago = (t: number, now: number) => { const h = Math.round((now - t) / H); return h < 1 ? 'just now' : `${h} h ago`; };
/** One step, plan against actual (owner, 28 Oct 2026: "plan timing, actual start and end, duration, simple"): two lines,
 *  two bars on one time axis, and one verdict. Display only. */
function PlanVsActual({ a, planH }: { a: TrkActivity; planH: number | null }) {
  const now = Date.now();
  const ps = a.start ? Date.parse(a.start) : NaN, pf = a.finish ? Date.parse(a.finish) : NaN;
  const as = a.actualStart ? Date.parse(a.actualStart) : NaN, af = a.actualFinish ? Date.parse(a.actualFinish) : NaN;
  const hasPlan = !Number.isNaN(ps) && !Number.isNaN(pf), started = !Number.isNaN(as), done = !Number.isNaN(af);
  if (!hasPlan && !started) return null;
  const hTxt = (ms: number) => { const h = Math.abs(ms) / H; return h < 1 ? `${Math.round(h * 60)} min` : `${Math.round(h)} h`; };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const at = (t: number) => { const k = new Date(t + 3 * H); return `${k.getUTCDate()} ${MON[k.getUTCMonth()]} ${kwTime(t)}`; };
  const actEnd = done ? af : now;
  const planMs = hasPlan ? (planH != null ? planH * H : pf - ps) : NaN;
  // the verdict: finish against the plan finish when done; a running step against its plan finish; a waiting one against its plan start
  const verdict = (() => {
    if (!hasPlan) return null;
    if (done) {
      const d0 = af - pf, took = af - as, over = took - planMs;
      const fin = Math.abs(d0) < H ? 'Finished on time' : d0 > 0 ? `Finished ${hTxt(d0)} late` : `Finished ${hTxt(d0)} early`;
      const dur = !started || Number.isNaN(planMs) || Math.abs(over) < H ? '' : over > 0 ? ` · took ${hTxt(over)} longer than plan` : ` · took ${hTxt(over)} less than plan`;
      return { t: fin + dur, c: d0 > H ? 'red' : over > H ? 'amber' : 'green' };
    }
    if (started) return now > pf ? { t: `Running ${hTxt(now - pf)} past the plan finish`, c: 'red' } : { t: `On track · plan finish in ${hTxt(pf - now)}`, c: 'slate' };
    return now > ps ? { t: `Not started · ${hTxt(now - ps)} after the plan start`, c: 'red' } : { t: `Starts in ${hTxt(ps - now)}`, c: 'slate' };
  })();
  const lo = Math.min(...[ps, as].filter((x) => !Number.isNaN(x))), hi = Math.max(...[pf, started ? actEnd : NaN].filter((x) => !Number.isNaN(x)));
  const span = Math.max(hi - lo, H);
  const bar = (x0: number, x1: number) => ({ left: `${((x0 - lo) / span) * 100}%`, width: `${Math.max(((x1 - x0) / span) * 100, 1.5)}%` });
  const row = (label: string, s0: number, f0: number | null, dur: string, tone: string) => (
    <div className="grid grid-cols-[3.4rem_1fr] items-baseline gap-x-2">
      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{label}</span>
      <span className="text-[12px] tabular-nums text-slate-800">{at(s0)} → {f0 == null ? <b className={tone}>running</b> : at(f0)} · <b>{dur}</b></span>
    </div>);
  return (
    <div className="space-y-1.5 rounded-xl bg-white p-2.5 ring-1 ring-slate-200">
      {hasPlan && row('Plan', ps, pf, planH != null ? `${planH} h` : hTxt(pf - ps), '')}
      {started ? row('Actual', as, done ? af : null, hTxt(actEnd - as), 'text-amber-700') : <div className="grid grid-cols-[3.4rem_1fr] gap-x-2"><span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Actual</span><span className="text-[12px] text-slate-500">not started</span></div>}
      <div className="relative ml-[3.9rem] mt-1 h-6" aria-hidden>
        {hasPlan && <span className="absolute top-0 h-2.5 rounded-full bg-slate-300" style={bar(ps, pf)} />}
        {started && <span className={cx('absolute top-3.5 h-2.5 rounded-full', done ? (hasPlan && af - pf > H ? 'bg-status-red' : 'bg-status-green') : hasPlan && now > pf ? 'bg-status-red' : 'bg-amber-400')} style={bar(as, actEnd)} />}
      </div>
      {verdict && <p className={cx('text-[12px] font-bold', verdict.c === 'red' ? 'text-status-red' : verdict.c === 'green' ? 'text-status-green' : verdict.c === 'amber' ? 'text-amber-700' : 'text-slate-600')}>{verdict.t}</p>}
    </div>
  );
}
/** Buffer steps of the item (owner, 27 Oct 2026): not always needed; skipping them is the way to catch up when late.
 *  Shows what skipping them all would do to the forecast finish; the Section Head skips one with one tap (Undo). */
/** Follow an item or not, for this login only: an item not followed is off its no-update list, update requests,
 *  progress and forecast; everyone else keeps it (owner, 29 Oct 2026). */
function FollowRow({ d, e, keys, done }: { d: TrackerData; e: TrkEquipment; keys: string[]; done: Done }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const off = !!e.notFollowed;
  const set = async (follow: boolean) => { for (const k of keys) await setFollow(d.tracker.id, k, follow); };
  const go = async () => {
    setBusy(true); setErr(null);
    try { await set(off); done(off ? `${short(e.tag)}: followed again.` : `${short(e.tag)}: not followed by you.`, () => set(!off)); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (<>
    <div className={cx('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs', off ? 'bg-slate-100 text-slate-700' : 'text-slate-600')}>
      <span className="min-w-0 flex-1">{off ? <>🔕 <b>Not followed by you</b> · off your update list, progress and forecast</> : <>🔔 Followed by you</>}</span>
      <button type="button" disabled={busy} onClick={() => void go()} className={cx('shrink-0 font-semibold', off ? 'text-brand-500' : 'text-slate-600')}>{off ? '↺ Follow again' : 'Stop following'}</button>
    </div>
    {err ? <ErrorBox error={err} /> : null}
  </>);
}
function BufferBox({ d, k, now, head, done }: { d: TrackerData; k: string; now: number; head: boolean; done: Done }) {
  const b = useMemo(() => bufferCatchUp(d, now, k), [d, now, k]);
  const [open, setOpen] = useState(false);
  if (!b) return null;
  const at = (t: number) => `${kwDay(t)} ${kwTime(t)}`;
  const saves = b.forecast != null && b.forecastIfSkipped != null ? Math.round((b.forecast - b.forecastIfSkipped) / H) : null;
  return (
    <div className={cx('rounded-xl px-3 py-2 text-[12px] ring-1', b.late ? 'bg-amber-50 text-amber-950 ring-amber-300' : 'bg-slate-50 text-slate-700 ring-slate-200')}>
      <button type="button" onClick={() => setOpen((x) => !x)} className="flex w-full items-start gap-2 text-left">
        <span className="min-w-0 flex-1"><b>Buffer · {b.steps.length} step{b.steps.length === 1 ? '' : 's'} · {Math.round(b.hours)} h</b>{b.late ? ' · late: skip what is not needed to catch up' : ' · can be skipped if not needed'}
          {saves != null && saves > 0 && <span className="block tabular-nums">If skipped: finish {at(b.forecast!)} → <b>{at(b.forecastIfSkipped!)}</b> ({saves} h earlier){b.p6Finish ? ` · P6 ${at(b.p6Finish)}` : ''}</span>}</span>
        <span className="text-slate-500">{open ? '▾' : '▸'}</span></button>
      {open && <ul className="mt-1.5 divide-y divide-amber-200/60">{b.steps.map((a) => (
        <li key={a.id} className="flex items-center gap-2 py-1">
          <span className="min-w-0 flex-1">{a.activity}{a.durationH ? <span className="text-slate-500"> · {a.durationH} h</span> : null}</span>
          {head && <button type="button" onClick={async () => { await setActivity(a.id, { tracked: false, disabled_reason: 'not required: buffer step skipped' }); done(`${a.activity}: skipped (not required).`, () => setActivity(a.id, { tracked: true, disabled_reason: null })); }}
            className="shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-slate-300">Skip</button>}
        </li>))}</ul>}
    </div>
  );
}
/** Against the bar chart: the item's forecast finish vs its P6 finish (+ ahead, − behind). */
function VsPlan({ mi }: { mi?: MiItem }) {
  if (!mi) return null;
  const v = mi.svD, done = mi.done >= mi.lines;
  return (
    <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', done ? 'bg-green-100 text-green-800' : v >= 0.5 ? 'bg-green-100 text-green-800' : v > -0.5 ? 'bg-slate-100 text-slate-700' : 'bg-red-100 text-red-800')}>
      {done ? '✓ done' : v >= 0.5 ? `${daysAsHours(v)} ahead` : v > -0.5 ? 'on plan' : `${daysAsHours(v)} behind`}</span>
  );
}
/** One item in two lines: tag, what is happening; done / plan and when it was last updated (orange when overdue). */
/** The next step of a row: finish the running one, else start the next (the blind and neutralization lines are done
 *  in Handover); for items worked as one, the same-named step of the others goes with it. */
function useRowStep(d: TrackerData, e: TrkEquipment, keys: string[]) {
  const neut = (d.points ?? []).some((p) => p.kind === 'neut' && p.items.includes(e.tag));
  const each = keys.map((k) => { const xs = lines(d, [k]).filter((a) => !blindLink(a) && !(neut && neutLink(a)) && !equipBlind(a));
    const run = xs.filter((a) => a.actualStart && !a.actualFinish); if (run.length) return { a: run[0], finish: true, more: run.length - 1 };
    const nx = xs.find((a) => !a.actualStart); return nx ? { a: nx, finish: false, more: 0 } : null; });
  const lead = each.find((x) => x?.finish) ?? each.find((x) => x) ?? null; if (!lead) return null;
  const linkedTest = e.linked && isLinkedTest(lead.a.activity) ? d.activities.filter((x) => x.tracked && !x.actualFinish && (lead.finish ? !!x.actualStart : !x.actualStart) && bedName(x.activity) === bedName(lead.a.activity) && d.equipment.some((q) => q.linked === e.linked && q.id !== e.id && keyOf(q) === x.key)) : [];
  return { ...lead, also: [...each.filter((x) => x && x !== lead && x.a.activity === lead.a.activity && (x.finish === lead.finish || lead.finish)).map((x) => x!.a), ...linkedTest] };
}
/** Where an item (or a group) is in the six phases of every item's work: green done · amber running · red running
 *  and late · grey to come (a phase the item does not have stays faint). */
function PhaseBar({ acts, now }: { acts: TrkActivity[]; now: number }) {
  if (!acts.length) return null;
  // each item's steps placed in its own order (a group's items side by side)
  const ph = new Map([...new Set(acts.map((a) => a.key))].flatMap((k) => [...stepPhases(acts.filter((a) => a.key === k))]));
  const late = (a: TrkActivity) => !a.actualFinish && ((!!a.finish && now > Date.parse(a.finish)) || (!a.actualStart && !!a.start && now > Date.parse(a.start)));
  return <span className="mt-1 grid grid-cols-7 gap-0.5" title="OP to handover · Under maintenance · Under inspection · Under repair · To be boxed up · OP to take back · Completed">{PHASE_IDS.map((p) => { const xs = acts.filter((a) => ph.get(a.id) === p);
    // a phase the item has no step in: done once the work is past it (owner, 30 Oct 2026)
    const past = acts.some((a) => (ph.get(a.id) ?? 0) > p && a.actualStart) || acts.every((a) => a.actualFinish);
    return <span key={p} className={cx('h-1.5 rounded-sm', !xs.length ? (past ? 'bg-status-green' : 'bg-slate-100') : xs.every((a) => a.actualFinish) ? 'bg-status-green' : xs.some((a) => a.actualStart && !a.actualFinish) ? (xs.some(late) ? 'bg-status-red' : 'bg-amber-400') : 'bg-slate-300')} />; })}</span>;
}
function ItemRow({ d, e, now, ageH, mi, onOpen, done }: { d: TrackerData; e: TrkEquipment; now: number; ageH?: number; mi?: MiItem; onOpen: () => void; done: Done }) {
  const keys = e.combine ? d.equipment.filter((x) => x.combine === e.combine).map(keyOf) : [keyOf(e)];
  const t = lastUpdate(d, keys);
  const probs = (d.events ?? []).filter((x) => !x.endedAt && x.key && keys.includes(x.key)).length;
  const step = useRowStep(d, e, keys);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(x) => x.key === 'Enter' && onOpen()} className={cx(ROW, 'cursor-pointer')}>
      <span className={cx('h-2 w-2 shrink-0 rounded-full', e.pendingReason ? 'bg-status-red' : !mi ? 'bg-slate-300' : mi.done >= mi.lines || mi.svD >= 0.5 ? 'bg-status-green' : mi.svD > -0.5 ? 'bg-slate-400' : 'bg-status-red')} />
      <b className={TAG}>{short(e.combine ?? e.tag)}{probs > 0 && <span className="mt-0.5 block w-fit rounded bg-red-100 px-1 text-[10px] font-bold text-red-800">⚠ {probs}</span>}</b>
      <span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-slate-700">{itemLine(d, e)}</span>
        <span className="block truncate text-[11px] text-slate-500">{mi ? `${mi.physPct}% / plan ${mi.planPct}% · ` : ''}<span className={ageH !== undefined ? 'font-bold text-amber-700' : ''}>{t ? ago(t, now) : 'no update yet'}</span></span>
        <PhaseBar acts={lines(d, [keys[0]])} now={now} /></span>
      {step ? <StepButton key={step.a.id} a={step.a} also={step.also} finish={step.finish} more={step.more} eq={e} onDone={done} /> : <VsPlan mi={mi} />}
    </div>
  );
}
/** The Equipment list, the same in both modes (the Section Head's item sheet opens on a tap there). */
export function EquipmentListTab({ d, now, done, role, onItem, initial = 'all' }: { d: TrackerData; now: number; done: Done; role: EngRole; onItem?: (tag: string) => void; initial?: string }) {
  const [f, setF] = useState(initial);
  return <RoleCtx.Provider value={role}><OpenItemCtx.Provider value={onItem ?? null}><Equipment d={d} now={now} done={done} go={() => {}} by="" f={f} setF={setF} /></OpenItemCtx.Provider></RoleCtx.Provider>;
}
function Equipment({ d, now, done, f, setF }: P & { f: string; setF: (f: string) => void }) {
  const [open, setOpen0] = useState<TrkEquipment | null>(null); const openItem = useContext(OpenItemCtx);
  const setOpen = (e: TrkEquipment | null) => (e && openItem ? openItem(e.tag) : setOpen0(e));
  const head = useContext(RoleCtx) === 'head';
  const views = useMemo(() => new Map(equipViews(d, now).map((v) => [v.eq.tag, v])), [d, now]);
  const [showOut, setShowOut] = useState(false);
  const stale = useMemo(() => new Map(staleItems(d, now).filter((i) => !i.small || WITH_EQUIP.includes(i.section)).map((i) => [i.key, i.ageH])), [d, now]);
  const mi = useMemo(() => new Map((phases(d, now).mi.weighted?.items ?? []).map((i) => [i.key, i])), [d, now]);
  // items of one machine (a compressor and its accessories) sit under the machine's heading, in one expandable block
  const grpOf = useMemo(() => shownGroup(d.equipment), [d.equipment]);
  const [openSys, setOpenSys] = useState<Set<string>>(new Set());
  // the Section Head also sees the items followed by their handover only (no bar-chart steps)
  const main = equipmentList(d, head);
  const all = [...new Set(main.map(grpOf))];
  const todo = main.filter((e) => stale.has(keyOf(e)));
  // late first: handover late, late, on hold, by how late
  const late = lateOrHold(main, [...views.values()]);
  const outs = head ? d.equipment.filter(isOutOfScope) : [], off = d.equipment.filter((e) => !e.tracked && !isOutOfScope(e) && inEquipmentTab(e) && (head || e.notFollowed));
  const mine = off.filter((e) => e.notFollowed).length;
  const shown = f === 'todo' ? todo : f === 'late' ? late : f === 'all' ? main : main.filter((e) => grpOf(e) === f);
  const groups = f === 'late' ? ['Late first'] : [...new Set(shown.map(grpOf))];
  // the four fixed-bed reactors: one row, one page with the steps against all four
  const allGroups = useMemo(() => stepGroups(main, d.activities), [main, d.activities]);
  const beds = f === 'todo' || f === 'late' ? [] : allGroups;
  const bedOf = (e: TrkEquipment) => beds.find((b) => b.items.includes(e));
  const [bedLabel, setBedLabel] = useState<string | null>(null); const bed = allGroups.find((b) => b.label === bedLabel);
  const chips: [string, string][] = [['all', `All ${main.length}`], ['todo', `To update ${todo.length}`], ...(late.length ? [['late', `Late / hold ${late.length}`] as [string, string]] : []), ...all.map((g): [string, string] => [g, `${g} ${main.filter((e) => grpOf(e) === g).length}`])];
  return (<>
    <div className="-mx-3 mb-2.5 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none]">{chips.map(([k, l]) => <button key={k} type="button" onClick={() => setF(k)} ref={(el) => { if (el && f === k && f !== 'all') el.scrollIntoView({ inline: 'center', block: 'nearest' }); }}
      className={cx('min-h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-[12px] font-bold', f === k ? 'bg-brand-700 text-white' : k === 'todo' && todo.length ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-300' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{l}</button>)}</div>
    {f === 'todo' && <p className="mx-1 mb-2 text-[12px] text-slate-500">Work running (or due to start) with no update for {'>'}12 h · critical {'>'}6 h. Any step, note, status or drum entry counts as an update.</p>}
    {groups.map((g) => { const xs = f === 'late' ? shown : shown.filter((e) => grpOf(e) === g); const seen = new Set<string>();
      const item = (e: TrkEquipment) => <ItemRow key={e.id} d={d} e={e} now={now} ageH={stale.get(keyOf(e))} mi={mi.get(keyOf(e))} onOpen={() => setOpen(e)} done={done} />;
      return <div key={g}><Sec>{g}</Sec><List>{xs.flatMap((e) => { const b = bedOf(e); if (b) { if (seen.has(b.label)) return []; seen.add(b.label); return [<BedsRow key={`bed:${b.label}`} d={d} set={b} now={now} onOpen={() => setBedLabel(b.label)} />]; }
        const sys = e.system; if (!sys || f === 'todo' || f === 'late') return [item(e)]; if (seen.has(sys)) return []; seen.add(sys);
        const ms = xs.filter((m) => m.system === sys); if (ms.length < 2) return [item(e)]; const isOpen = openSys.has(sys); const ho = ms.filter((m) => m.stage >= 1).length;
        return [<button key={`sys:${sys}`} type="button" aria-expanded={isOpen} onClick={() => setOpenSys((s) => { const n = new Set(s); if (n.has(sys)) n.delete(sys); else n.add(sys); return n; })}
          className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2 text-left active:bg-slate-100">
          <span className="w-3 text-[12px] text-slate-500">{isOpen ? '▾' : '▸'}</span>
          <span className="min-w-0 flex-1"><b className="block truncate text-[14px] text-slate-900">{sys}</b><span className="text-[12px] text-slate-600">{ms.length} items · {ho} handed over · tap to {isOpen ? 'close' : 'open'}</span></span></button>,
          ...(isOpen ? ms.map((m) => <div key={`in:${m.id}`} className="border-l-4 border-slate-200">{item(m)}</div>) : [])]; })}</List></div>; })}
    {!shown.length && <Card><p className="text-sm font-semibold text-green-800">{f === 'todo' ? '✓ Everything has a recent update.' : f === 'late' ? '✓ Nothing late.' : 'Nothing here.'}</p></Card>}
    {outs.length + off.length > 0 && <button type="button" onClick={() => setShowOut((x) => !x)} className="mx-1 mb-2 block text-[12px] font-semibold text-slate-500">{showOut ? '▾' : '▸'} {head ? `Out of scope ${outs.length}` : ''}{off.length - mine ? ` · switched off ${off.length - mine}` : ''}{mine ? `${head ? ' · ' : ''}not followed by you ${mine}` : ''}</button>}
    {showOut && <List>{[...outs, ...off].map((e) => <button key={e.id} type="button" onClick={() => setOpen(e)} className={cx(ROW, 'opacity-70')}><b className={TAG}>{short(e.tag)}</b><span className="min-w-0 flex-1 truncate text-[12px] text-slate-600">{isOutOfScope(e) ? `⊘ ${scopeReasonText(e.disabledReason)}` : e.notFollowed ? '🔕 not followed by you' : 'switched off (Admin)'}</span></button>)}</List>}
    {bed && <BedsPage d={d} set={bed} now={now} done={done} onItem={(e) => { setBedLabel(null); setOpen(e); }} onClose={() => setBedLabel(null)} />}
    {open && <ItemSheet d={d} e={open} done={done} onClose={() => setOpen(null)} />}
  </>);
}

// ── Items worked to one step list, on one page (owner, 29 Oct 2026) ─────────────────────────────────────────────────
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = (t: number) => { const k = new Date(t + 3 * H); return `${k.getUTCDate()} ${MON3[k.getUTCMonth()]}`; };
const bedTime = (iso: string) => { const k = Date.parse(iso); return dayOf(k) === dayOf(Date.now()) ? kwTime(k) : dayOf(k); };
const lateText = (h: number) => (h < 24 ? `late ${Math.max(1, Math.round(h))} h` : `late ${Math.round(h / 24)} d`);
const windowText = (w: { start: number; finish: number } | null) => { if (!w) return 'no plan time'; const a = dayOf(w.start), b = dayOf(w.finish);
  if (a === b) return `Plan ${a}`; const [da, ma] = a.split(' '), [db, mb] = b.split(' '); return ma === mb ? `Plan ${da}–${db} ${mb}` : `Plan ${a} – ${b}`; };
const bedCount = (rows: BedRow[], i: number) => { const xs = rows.map((r) => r.cells[i]).filter((c) => c.state !== 'nr' && c.state !== 'none'); return [xs.filter((c) => c.state === 'done').length, xs.length]; };
const DEPT_TAG = { inspection: ['Inspection', 'bg-indigo-100 text-indigo-800'], cleaning: ['Cleaning', 'bg-amber-100 text-amber-900'], mixed: ['Insp. + cleaning', 'bg-slate-100 text-slate-700'] } as const;
const DeptTag = ({ dept }: { dept: BedDept }) => <span className={cx('rounded px-1 text-[9.5px] font-extrabold uppercase tracking-wide', DEPT_TAG[dept][1])}>{DEPT_TAG[dept][0]}</span>;
/** A group as one row in the Equipment list: what is running (or next), late when past its plan, and each item's
 *  steps done (up to four items; more: how many are finished). */
function BedsRow({ d, set, now, onOpen }: { d: TrackerData; set: BedSet; now: number; onOpen: () => void }) {
  const rows = useMemo(() => bedMatrix(d.activities, set.keys), [d.activities, set.keys]);
  const run = rows.map((r) => ({ r, on: r.cells.flatMap((c, i) => (c.state === 'run' ? [{ t: short(set.items[i].tag), l: bedLate(c, now) }] : [])) })).filter((x) => x.on.length);
  const next = rows.find((r) => r.cells.some((c) => c.state === 'open'));
  const late = rows.flatMap((r) => r.cells).filter((c) => c.state !== 'done' && bedLate(c, now).late).length;
  const fin = set.items.filter((_, i) => bedItemDone(rows, i)).length;
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(x) => x.key === 'Enter' && onOpen()} className="block w-full cursor-pointer border-b border-slate-100 px-2.5 py-2 text-left last:border-b-0 active:bg-slate-50">
      <span className="flex items-center gap-1.5"><b className="text-[13px]">{set.label}</b><DeptTag dept={set.dept} /><span className="text-[11px] text-slate-500">· {set.items.length}{fin ? ` · ${fin} done` : ''}</span><span className="ml-auto text-[16px] text-slate-400">›</span></span>
      <span className="block truncate text-[12px] text-slate-700">{run.length ? run.map((x) => `▶ ${x.r.name} ${x.on.map((o) => o.t).join(', ')}`).join(' · ') : next ? `Next: ${next.name}` : 'All steps done'}
        {late > 0 && <b className="text-status-red"> · {late} late</b>}</span>
      <PhaseBar acts={lines(d, set.keys)} now={now} />
      {set.items.length <= 4 && <span className="mt-1 grid grid-cols-4 gap-1.5">{set.items.map((e, i) => { const [n, t] = bedCount(rows, i);
        return <span key={e.id} className="text-[10px] tabular-nums text-slate-600">{short(e.tag)} {n}/{t}<span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-slate-200"><span className="block h-full bg-status-green" style={{ width: `${t ? (n / t) * 100 : 0}%` }} /></span></span>; })}</span>}
    </div>
  );
}
/** Steps down the side, the items across (more than four still working: the items as chips under each step). Each
 *  step shows its plan window, each item its own plan finish; red = not started after its plan start or not done
 *  after its plan finish. Items whose steps are all done leave the columns ("Handed back"). Tap to start / finish
 *  (others in the same state can be ticked), or a row's "all". Each item keeps its own records. */
function BedsPage({ d, set, now, done, onItem, onClose }: { d: TrackerData; set: BedSet; now: number; done: Done; onItem: (e: TrkEquipment) => void; onClose: () => void }) {
  const isHead = useContext(RoleCtx) === 'head', manage = useCanManage();
  const rows0 = useMemo(() => bedMatrix(d.activities, set.keys), [d.activities, set.keys]);
  const [adding, setAdding] = useState<{ cols: number[]; row: string | null } | null>(null);
  const [showDone, setShowDone] = useState(false); const [showOff, setShowOff] = useState(false);
  const [pick, setPick] = useState<{ row: string; col: number; all: boolean } | null>(null);
  const handed = set.items.map((_, i) => i).filter((i) => bedItemDone(rows0, i));
  const cols = handed.length === set.items.length ? set.items.map((_, i) => i) : set.items.map((_, i) => i).filter((i) => !handed.includes(i));
  // the rows as the shown columns see them (an item handed back no longer keeps a row open)
  const view = (r: BedRow): BedRow => ({ ...r, cells: cols.map((i) => r.cells[i]) });
  const finished = rows0.filter((r) => bedRowDone(view(r)) || (bedRowOff(view(r)) && !bedRowOff(r))), off = rows0.filter((r) => bedRowOff(r));
  const open = rows0.filter((r) => !finished.includes(r) && !off.includes(r));
  const chips = cols.length > 4;
  const grid = { gridTemplateColumns: `minmax(0,1.4fr) repeat(${cols.length},minmax(0,1fr))` };
  const tap = (r: BedRow, i: number) => setPick({ row: r.id, col: i, all: false });
  const cell = (r: BedRow, i: number) => { const c = r.cells[i], l = bedLate(c, now), go = () => tap(r, i);
    if (c.state === 'none') return manage ? <button key={i} type="button" aria-label={`Add ${r.name} to ${short(set.items[i].tag)}`} onClick={() => setAdding({ cols: [i], row: r.id })} className="min-h-8 rounded-lg border border-dashed border-slate-300 text-center text-[14px] font-bold text-slate-400">+</button> : <span key={i} />;
    if (c.state === 'nr') return <span key={i} className="text-center text-slate-300">–</span>;
    if (c.state === 'done') return <button key={i} type="button" onClick={go} className="text-center text-[12px] font-bold text-status-green">✓<span className={cx('block text-[9.5px] font-normal tabular-nums', l.late ? 'text-amber-700' : 'text-slate-500')}>{bedTime(c.a!.actualFinish!)}</span></button>;
    const sub = l.late ? lateText(l.byH) : c.a!.finish ? `by ${dayOf(Date.parse(c.a!.finish))}` : c.a!.estH ? `est. ${c.a!.estH} h` : 'no plan';
    if (c.state === 'run') return <button key={i} type="button" onClick={go} className={cx('rounded-lg px-0.5 py-1 text-center text-[11px] font-bold ring-1', l.late ? 'bg-red-50 text-red-800 ring-red-400' : 'bg-amber-50 text-amber-900 ring-amber-400')}>▶ Finish<span className="block text-[9.5px] font-medium tabular-nums">{sub}</span></button>;
    return <button key={i} type="button" onClick={go} className={cx('rounded-lg py-1 text-center text-[11px] font-bold ring-1', l.late ? 'text-red-800 ring-red-400' : 'text-brand-700 ring-brand-700')}>Start<span className={cx('block text-[9px] font-semibold tabular-nums', l.late ? 'text-red-700' : 'text-slate-500')}>{sub}</span></button>; };
  const allOf = (r: BedRow) => { const v = view(r), nOpen = v.cells.filter((c) => c.state === 'open').length, nRun = v.cells.filter((c) => c.state === 'run').length;
    return nRun >= 2 ? { t: `Finish ${nRun}`, col: cols[v.cells.findIndex((c) => c.state === 'run')] } : nOpen >= 2 && !nRun ? { t: `Start all ${nOpen}`, col: cols[v.cells.findIndex((c) => c.state === 'open')] } : null; };
  const label = (r: BedRow) => { const w = bedWindow(view(r)), late = view(r).cells.some((c) => c.state !== 'done' && bedLate(c, now).late), all = allOf(r);
    return <><span className="block text-[12px] font-semibold leading-tight text-slate-800">{r.name}</span>
      <span className={cx('block text-[10px] font-semibold', late ? 'text-status-red' : 'text-slate-500')}>{windowText(w)}</span>
      {all && <button type="button" onClick={() => setPick({ row: r.id, col: all.col, all: true })} className="block text-[10.5px] font-bold text-brand-700">{all.t}</button>}</>; };
  const row = (r: BedRow) => chips
    ? <div key={r.id} className="border-t border-slate-100 px-2.5 py-1.5">{label(r)}
        <div className="mt-1 grid grid-cols-5 gap-1">{cols.filter((i) => r.cells[i].state !== 'none').map((i) => { const c = r.cells[i], l = bedLate(c, now);
          return <button key={i} type="button" disabled={c.state === 'nr'} onClick={() => tap(r, i)} className={cx('min-h-8 truncate rounded-md px-0.5 text-[10.5px] font-bold ring-1',
            c.state === 'nr' ? 'text-slate-300 ring-slate-100' : c.state === 'done' ? cx('bg-green-100 ring-green-300', l.late ? 'text-amber-800' : 'text-green-800') : c.state === 'run' ? 'bg-amber-50 text-amber-900 ring-amber-400' : l.late ? 'bg-red-50 text-red-800 ring-red-300' : 'bg-white text-slate-700 ring-slate-300')}>
            {c.state === 'done' ? '✓' : c.state === 'run' ? '▶' : ''}{short(set.items[i].tag).replace(/^[A-Z]+-/, '')}</button>; })}</div></div>
    : <div key={r.id} className="grid items-center gap-1 border-t border-slate-100 px-2 py-1.5" style={grid}><span className="min-w-0">{label(r)}</span>{cols.map((i) => cell(r, i))}</div>;
  const sel = pick && rows0.find((r) => r.id === pick.row);
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-canvas pb-28">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-brand-700 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))] text-white">
        <button type="button" onClick={onClose} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-bold">‹ Back</button>
        <p className="min-w-0 flex-1 truncate text-[16px] font-bold">{set.label}</p><DeptTag dept={set.dept} />
        {manage && <button type="button" onClick={() => setAdding({ cols: cols, row: null })} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[13px] font-bold text-brand-700">+ Step</button>}
      </header>
      <main className="mx-auto max-w-xl px-3 pt-3">
        <List>
          {chips ? <div className="flex flex-wrap gap-1 bg-slate-50 px-2.5 py-1.5">{cols.map((i) => { const [n, t] = bedCount(rows0, i); return <button key={i} type="button" onClick={() => onItem(set.items[i])} className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-bold text-brand-700 ring-1 ring-slate-200">{short(set.items[i].combine ?? set.items[i].tag)} <span className="font-medium tabular-nums text-slate-500">{n}/{t}</span></button>; })}</div>
            : <div className="grid items-center gap-1 bg-slate-50 px-2 py-1.5" style={grid}><span className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-500">Step · plan</span>
              {cols.map((i) => { const [n, t] = bedCount(rows0, i); return <button key={i} type="button" onClick={() => onItem(set.items[i])} className="text-center text-[12px] font-bold text-brand-700 underline decoration-slate-300 underline-offset-2">{short(set.items[i].combine ?? set.items[i].tag)}<span className="block text-[10px] font-medium tabular-nums text-slate-500 no-underline">{n}/{t}{set.dept === 'mixed' ? ` · ${set.items[i].inspRef ? 'insp.' : 'clean.'}` : ''}</span></button>; })}</div>}
          {handed.length > 0 && handed.length < set.items.length && <div className="flex flex-wrap items-center gap-1 border-t border-green-100 bg-green-50 px-2.5 py-1.5 text-[11.5px] font-semibold text-green-900">✓ Handed back:
            {handed.map((i) => { const f = Math.max(...rows0.map((r) => r.cells[i].a?.actualFinish).filter((x): x is string => !!x).map((x) => Date.parse(x)));
              return <button key={i} type="button" onClick={() => onItem(set.items[i])} className="rounded bg-green-100 px-1.5 text-[10.5px]">{short(set.items[i].combine ?? set.items[i].tag)} {dayOf(f)}</button>; })}</div>}
          {finished.length > 0 && <button type="button" aria-expanded={showDone} onClick={() => setShowDone((x) => !x)} className="flex w-full justify-between border-t border-green-100 bg-green-50 px-2.5 py-2 text-[12px] font-semibold text-green-900"><span>✓ {finished.length} step{finished.length === 1 ? '' : 's'} done on all</span><span>{showDone ? 'hide ▴' : 'show ▾'}</span></button>}
          {showDone && finished.map(row)}
          {open.map(row)}
          {!open.length && <p className="border-t border-slate-100 px-2.5 py-2 text-[12px] font-semibold text-status-green">✓ All steps done.</p>}
          {off.length > 0 && <button type="button" aria-expanded={showOff} onClick={() => setShowOff((x) => !x)} className="flex w-full justify-between border-t border-slate-100 bg-slate-50 px-2.5 py-2 text-[12px] font-semibold text-slate-500"><span>– {off.length} not required</span><span>{showOff ? 'hide ▴' : 'show ▾'}</span></button>}
          {showOff && off.map(row)}
        </List>
        <p className="mx-1 text-[11px] text-slate-500">✓ done · ▶ running, tap to finish · – not required · “by” = that item’s plan finish. <b className="text-status-red">Red</b>: not started after its plan start, or not done after its plan finish; a ✓ date in amber finished late. Tap an item for its own page.</p>
      </main>
      {sel && pick && <BedSheet d={d} set={set} r={sel} col={pick.col} cols={cols} all={pick.all} head={isHead} done={done} onClose={() => setPick(null)} />}
      {adding && <AddStepsSheet d={d} set={set} rows={rows0.filter((r) => !bedRowOff(r) || r.cells.some((c) => c.a?.tracked))} initial={adding} done={done} onClose={() => setAdding(null)} />}
    </div>
  );
}
/** One step on one item (or the row's "all"): its plan against what happened; start or finish it now or at a time
 *  typed in, ticking the others in the same state to move them together (items worked as one move with it); undo a
 *  start / finish; not required (Section Head). */
function BedSheet({ d, set, r, col, cols, all, head, done, onClose }: { d: TrackerData; set: BedSet; r: BedRow; col: number; cols: number[]; all: boolean; head: boolean; done: Done; onClose: () => void }) {
  const c0 = r.cells[col], mode = c0.state;
  const same = cols.filter((i) => r.cells[i].state === mode && (mode === 'open' || mode === 'run'));
  const [on, setOn] = useState<Set<number>>(new Set(all ? same : [col]));
  const [at, setAt] = useState(''); const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const atIso = at ? new Date(`${at}:00+03:00`).toISOString() : null;
  const tooOld = !!atIso && Date.now() - Date.parse(atIso) > BACKDATE_LIMIT_H * H, future = !!atIso && Date.parse(atIso) > Date.now() + 15 * 60000;
  const kwInput = (ms: number) => new Date(ms + 3 * H).toISOString().slice(0, 16);
  // the same step of the items worked as one with it (E-12-216A/B)
  const twins = (e: TrkEquipment, a: TrkActivity) => [
    ...(e.combine ? d.activities.filter((x) => x.id !== a.id && x.activity === a.activity && x.tracked && !x.actualFinish && d.equipment.some((q) => q.combine === e.combine && keyOf(q) === x.key)) : []),
    // linked items (no blind between them): one test for all (owner, 30 Oct 2026: E-204 and E-205 have the same hydrotest)
    ...(e.linked && isLinkedTest(a.activity) ? d.activities.filter((x) => x.id !== a.id && x.tracked && !x.actualFinish && bedName(x.activity) === bedName(a.activity) && d.equipment.some((q) => q.linked === e.linked && q.id !== e.id && keyOf(q) === x.key)) : [])];
  const picked = [...new Map([...on].sort((p, q) => p - q).flatMap((i) => { const a = r.cells[i].a!, e = set.items[i]; return [{ a, e }, ...twins(e, a).map((x) => ({ a: x, e }))]; }).map((x) => [x.a.id, x])).values()];
  const withLinked = [...new Set(picked.map((x) => x.a.key))].filter((k) => !set.keys.some((sk, i) => on.has(i) && sk === k)).map((k) => short(k));
  const tags = [...on].sort((p, q) => p - q).map((i) => short(set.items[i].tag)).join(', ');
  async function run(f: () => Promise<unknown>, msg: string, undo: () => Promise<unknown>) { setBusy(true); setErr(null); try { await f(); done(msg, undo); onClose(); } catch (x) { setErr(x); } finally { setBusy(false); } }
  const back = (xs: { a: TrkActivity }[]) => xs.map(({ a }) => ({ id: a.id, s: a.actualStart ?? null, f: a.actualFinish ?? null }));
  const move = (finish: boolean) => { const t = atIso ?? new Date().toISOString(), was = back(picked), reason = why.trim() ? { time_reason: why.trim() } : {};
    const held = finish ? [] : [...new Set(picked.map((x) => x.e))].filter((e) => e.pendingReason);
    return run(async () => {
      for (const { a } of picked) await setActivity(a.id, finish ? { actual_finish: t, ...(a.actualStart ? {} : { actual_start: t }), ...reason } : { actual_start: t, ...reason });
      for (const e of held) await setEquipment(e.id, { pending_reason: null });
    }, `${r.name}: ${finish ? 'finished' : 'started'} on ${tags}${withLinked.length ? ` (with ${withLinked.join(', ')})` : ''}${atIso ? ` · ${when(t)}` : ''}.${held.length ? ' Hold ended.' : ''}`, async () => {
      for (const b of was) await setActivity(b.id, { actual_start: b.s, actual_finish: b.f, time_reason: 'Undo' });
      for (const e of held) await setEquipment(e.id, { pending_reason: e.pendingReason });
    }); };
  const a = c0.a!, e0 = set.items[col];
  const undo = () => { const was = back([{ a }]); return run(() => setActivity(a.id, a.actualFinish ? { actual_finish: null } : { actual_start: null }), `${r.name}: ${a.actualFinish ? 'finish' : 'start'} undone on ${short(e0.tag)}.`,
    () => setActivity(was[0].id, { actual_start: was[0].s, actual_finish: was[0].f, time_reason: 'Undo' })); };
  const notReq = () => run(() => setActivity(a.id, { tracked: false, disabled_reason: 'not required' }), `${r.name}: not required on ${short(e0.tag)}.`, () => setActivity(a.id, { tracked: true, disabled_reason: null }));
  return (
    <BottomSheet open onClose={onClose} title={all ? `${r.name} · ${same.length} items` : `${r.name} · ${short(e0.tag)}`}>
      <div className="space-y-2.5">
        {!all && <PlanVsActual a={a} planH={a.durationH ?? null} />}
        {!all && !a.start && <p className="text-[12px] text-slate-500">Added step · no plan dates{a.estH ? ` · est. ${a.estH} h` : ''} · not in the %.</p>}
        {(mode === 'open' || mode === 'run') && same.length > 1 && <div><p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">{mode === 'run' ? 'Finish on' : 'Start or done on'}</p>
          <div className="grid grid-cols-4 gap-1.5">{same.map((i) => { const x = on.has(i);
            return <button key={i} type="button" aria-pressed={x} onClick={() => setOn((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
              className={cx('min-h-9 truncate rounded-lg px-1 text-[12px] font-bold ring-1', x ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{short(set.items[i].combine ?? set.items[i].tag)}</button>; })}</div></div>}
        {err != null && <ErrorBox error={err} />}
        {/* the main action(s) side by side; the time is "now" unless an earlier one is set (owner, 31 Oct 2026: nicer, no stacked odd buttons) */}
        {mode !== 'done' && <div className="grid grid-cols-2 gap-2">
          {mode === 'open' && <button type="button" disabled={busy || !on.size || future || (tooOld && !why.trim())} onClick={() => void move(false)} className="min-h-12 rounded-xl bg-brand-700 text-[14px] font-bold text-white disabled:opacity-50">▶ Start{on.size > 1 ? ` ${on.size}` : ''}</button>}
          {mode === 'run' && !all && <button type="button" disabled={busy} onClick={() => void undo()} className="min-h-12 rounded-xl bg-white text-[14px] font-bold text-slate-700 ring-1 ring-slate-300">↶ Undo start</button>}
          <button type="button" disabled={busy || !on.size || future || (tooOld && !why.trim())} onClick={() => void move(true)} className={cx('min-h-12 rounded-xl bg-amber-400 text-[14px] font-bold text-amber-950 disabled:opacity-50', mode === 'run' && all && 'col-span-2')}>✓ {mode === 'run' ? 'Finish' : 'Done'}{on.size > 1 ? ` ${on.size}` : ''}</button>
        </div>}
        {mode === 'done' && !all && <button type="button" disabled={busy} onClick={() => void undo()} className="min-h-12 w-full rounded-xl bg-white text-[14px] font-bold text-slate-700 ring-1 ring-slate-300">↶ Undo finish</button>}
        {(mode === 'open' || mode === 'run') && (at ? <div className="space-y-1.5 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
            <div className="flex items-center gap-2"><span className="text-[11px] font-bold uppercase text-slate-500">Time</span>
              <input type="datetime-local" className="input min-h-9 flex-1 py-1 text-[13px]" value={at} max={kwInput(Date.now())} onChange={(x) => setAt(x.target.value)} />
              <button type="button" onClick={() => { setAt(''); setWhy(''); }} className="min-h-9 rounded-lg bg-white px-2.5 text-[12px] font-bold text-slate-700 ring-1 ring-slate-300">Now</button></div>
            {future && <p className="text-[12px] font-semibold text-status-red">The time cannot be in the future.</p>}
            {tooOld && !future && <input className="input min-h-9 text-[13px]" placeholder={`Reason (over ${BACKDATE_LIMIT_H} h back)`} value={why} onChange={(x) => setWhy(x.target.value)} />}
          </div>
          : <div className="flex items-center justify-between text-[12.5px]">
            <button type="button" onClick={() => setAt(kwInput(Date.now()))} className="font-semibold text-brand-700">🕒 Time: now · change</button>
            {mode === 'open' && !all && head && <button type="button" disabled={busy} onClick={() => void notReq()} className="font-semibold text-slate-500">⊘ Not required</button>}
          </div>)}
      </div>
    </BottomSheet>
  );
}

/** Add steps on a group page (owner, 31 Oct 2026): to one or more items, tick the steps another item has and these
 *  lack (with that item's planned hours as the estimate), or write a new step with its estimated hours and its place.
 *  An added step has no plan dates: its estimate is shown with it, never counted in the % or the forecast. */
function AddStepsSheet({ d, set, rows, initial, done, onClose }: { d: TrackerData; set: BedSet; rows: BedRow[]; initial: { cols: number[]; row: string | null }; done: Done; onClose: () => void }) {
  const [to, setTo] = useState<Set<number>>(new Set(initial.cols));
  const [ticks, setTicks] = useState<Set<string>>(new Set(initial.row ? [initial.row] : []));
  const [name, setName] = useState(''); const [est, setEst] = useState(''); const [after, setAfter] = useState<string>(rows.at(-1)?.id ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const hrs = (a: TrkActivity | null) => (a ? (a.durationH ?? a.estH ?? null) : null);
  // steps another item has and a ticked one lacks
  const missing = rows.filter((r) => r.cells.some((c) => c.a) && [...to].some((i) => r.cells[i].state === 'none'));
  const toggle = <T,>(s: Set<T>, x: T) => { const n = new Set(s); if (n.has(x)) n.delete(x); else n.add(x); return n; };
  const estH = est.trim() ? Number(est) : null; const estBad = estH !== null && (!Number.isFinite(estH) || estH <= 0 || estH > 2000);
  const count = missing.filter((r) => ticks.has(r.id)).reduce((t, r) => t + [...to].filter((i) => r.cells[i].state === 'none').length, 0) + (name.trim() ? to.size : 0);
  // the step of item i a new step goes after: its step in the nearest row at or before the chosen one ('' = first)
  const placeOf = (i: number, rowIdx: number) => { for (let j = rowIdx; j >= 0; j--) { const a = rows[j].cells[i].a; if (a && (a.tracked || /^not required/.test(a.disabledReason ?? ''))) return a.id; } return ''; };
  async function add() {
    setBusy(true); setErr(null); const made: string[] = [];
    try {
      for (const i of [...to].sort((p, q) => p - q)) {
        const k = set.keys[i]; let order = sortActs(d.activities.filter((a) => a.key === k && a.tracked)).map((a) => a.id);
        const put = async (title: string, rowIdx: number, h: number | null) => {
          const aft = placeOf(i, rowIdx); const id = await addEngStep(d.tracker.id, k, title, order, aft, h); made.push(id);
          const at = aft ? order.indexOf(aft) + 1 : 0; order = [...order.slice(0, at), id, ...order.slice(at)];
        };
        for (const r of missing) if (ticks.has(r.id) && r.cells[i].state === 'none') { const src = r.cells.find((c) => c.a)!.a!; await put(src.activity, rows.indexOf(r) - 1, hrs(src)); }
        if (name.trim()) await put(name.trim(), after ? rows.findIndex((r) => r.id === after) : rows.length - 1, estH);
      }
      done(`${made.length} step${made.length === 1 ? '' : 's'} added.`, async () => { for (const id of made) await setActivity(id, { tracked: false, disabled_reason: 'removed' }); });
      onClose();
    } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="Add steps">
      <div className="space-y-2.5">
        <div><p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">To · tick one or more</p>
          <div className="flex flex-wrap gap-1.5">{set.items.map((e, i) => <button key={e.id} type="button" aria-pressed={to.has(i)} onClick={() => setTo((s) => toggle(s, i))}
            className={cx('min-h-9 rounded-lg px-3 text-[12px] font-bold ring-1', to.has(i) ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{to.has(i) ? '✓ ' : ''}{short(e.combine ?? e.tag)}</button>)}</div></div>
        {missing.length > 0 && <div><p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Steps missing on a ticked item · tick</p>
          <div className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">{missing.map((r) => { const src = r.cells.find((c) => c.a)!, h = hrs(src.a), lack = [...to].filter((i) => r.cells[i].state === 'none').map((i) => short(set.items[i].combine ?? set.items[i].tag));
            return <label key={r.id} className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5">
              <input type="checkbox" className="h-5 w-5 shrink-0" checked={ticks.has(r.id)} onChange={() => setTicks((s) => toggle(s, r.id))} />
              <span className="min-w-0 flex-1 text-[12.5px]">{r.name}<span className="block text-[10.5px] text-slate-500">missing on {lack.join(', ')}{h ? ` · ${h} h` : ''}</span></span></label>; })}</div></div>}
        <div><p className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Or a new step</p>
          <input className="input text-[13px]" placeholder="Step name, e.g. Burner tile replacement" value={name} onChange={(x) => setName(x.target.value)} />
          {name.trim() && <div className="mt-1.5 grid grid-cols-[1fr_1.6fr] gap-1.5">
            <input className="input text-[13px]" inputMode="decimal" placeholder="Est. hours" value={est} onChange={(x) => setEst(x.target.value)} />
            <select className="input text-[13px]" value={after} onChange={(x) => setAfter(x.target.value)}>{rows.map((r) => <option key={r.id} value={r.id}>After: {r.name}</option>)}</select></div>}
          {estBad && <p className="mt-1 text-[12px] font-semibold text-status-red">Hours: a number above 0.</p>}</div>
        <p className="text-[11px] text-slate-500">An added step has no plan dates: its hours are an estimate, shown with it, not counted in the % or the end date.</p>
        {err != null && <ErrorBox error={err} />}
        <button type="button" disabled={busy || !to.size || !count || estBad} onClick={() => void add()} className="min-h-11 w-full rounded-xl bg-brand-700 text-[14px] font-bold text-white disabled:opacity-50">Add {count || ''} step{count === 1 ? '' : 's'}</button>
      </div>
    </BottomSheet>
  );
}

/** One item's steps by phase (owner, 30 Oct 2026: "the way that will have clicks and I can see all the steps"): the six
 *  phases of every item, the one it is in open, the others folded with their count and plan dates; one tap per step
 *  (Start / Finish; the sheet has the time, Done, Undo and not required). The list page stays for edit, add and order. */
function StepBoard({ d, e, keys, done, onList, onDetails, onClose }: { d: TrackerData; e: TrkEquipment; keys: string[]; done: Done; onList: () => void; onDetails: () => void; onClose: () => void }) {
  const isHead = useContext(RoleCtx) === 'head'; const now = Date.now();
  const k0 = keys[0], acts = lines(d, [k0]);
  const ph = stepPhases(acts);
  const set: BedSet = { label: short(e.combine ?? e.tag), dept: e.inspRef ? 'inspection' : 'cleaning', items: [e], keys: [k0] };
  const rowOf = (a: TrkActivity): BedRow => ({ id: a.id, name: a.activity, cells: [{ key: k0, a, state: a.actualFinish ? 'done' : a.actualStart ? 'run' : 'open' }] });
  const byPhase = PHASE_IDS.map((p) => ({ p, xs: acts.filter((a) => ph.get(a.id) === p) }));
  const current = byPhase.find((x) => x.xs.some((a) => !a.actualFinish))?.p ?? 6;
  const [open, setOpen] = useState<Set<Phase>>(() => new Set([current, ...byPhase.filter((x) => x.xs.some((a) => a.actualStart && !a.actualFinish)).map((x) => x.p)]));
  const [pick, setPick] = useState<string | null>(null);
  const lateOf = (a: TrkActivity) => bedLate(rowOf(a).cells[0], now);
  const behindH = Math.max(0, ...acts.filter((a) => !a.actualFinish).map((a) => lateOf(a)).filter((l) => l.late).map((l) => l.byH));
  const ends = acts.map((a) => (a.finish ? Date.parse(a.finish) : 0)).filter(Boolean);
  const win = (xs: TrkActivity[]) => bedWindow({ id: '', name: '', cells: xs.map((a) => rowOf(a).cells[0]) });
  const tone = (xs: TrkActivity[], p: Phase = 0) => (!xs.length ? (passed(p) ? 'bg-status-green' : 'bg-slate-100') : xs.every((a) => a.actualFinish) ? 'bg-status-green' : xs.some((a) => !a.actualFinish && lateOf(a).late) && xs.some((a) => a.actualStart) ? 'bg-status-red' : xs.some((a) => a.actualStart) ? 'bg-amber-400' : 'bg-slate-200');
  const passed = (p: Phase) => acts.some((a) => (ph.get(a.id) ?? 0) > p && a.actualStart) || acts.every((a) => a.actualFinish);
  const sel = pick ? acts.find((a) => a.id === pick) : undefined;
  const step = (a: TrkActivity) => { const l = lateOf(a), st = a.actualFinish ? 'done' : a.actualStart ? 'run' : 'open';
    const sub = st === 'done' ? `✓ ${when(a.actualFinish)}` : st === 'run' ? `since ${dayOf(Date.parse(a.actualStart!))}${a.finish ? ` · plan end ${dayOf(Date.parse(a.finish))}` : ''}${l.late ? ` · ${lateText(l.byH)}` : ''}`
      : a.start && a.finish ? `plan ${windowText({ start: Date.parse(a.start), finish: Date.parse(a.finish) }).replace(/^Plan /, '')}${l.late ? ` · ${lateText(l.byH)}` : ''}` : a.estH ? `added · est. ${a.estH} h` : 'no plan time';
    return <button key={a.id} type="button" onClick={() => setPick(a.id)} className="flex w-full items-center gap-2 border-t border-slate-100 px-2.5 py-1.5 text-left active:bg-slate-50">
      <span className="min-w-0 flex-1"><span className={cx('block text-[12.5px] font-semibold leading-snug', st === 'done' && 'text-slate-500')}>{a.activity}</span>
        <span className={cx('block text-[10.5px]', st === 'done' ? (l.late ? 'text-amber-700' : 'text-slate-500') : l.late ? 'font-bold text-status-red' : 'text-slate-500')}>{sub}</span></span>
      {st === 'done' ? <span className="shrink-0 text-[13px] font-bold text-status-green">✓</span>
        : <span className={cx('min-w-[4.4rem] shrink-0 rounded-lg py-1.5 text-center text-[11.5px] font-bold', st === 'run' ? (l.late ? 'bg-red-100 text-red-800 ring-1 ring-red-400' : 'bg-amber-400 text-amber-950') : l.late ? 'text-red-800 ring-1 ring-red-400' : 'text-brand-700 ring-1 ring-brand-700')}>{st === 'run' ? '✓ Finish' : '▶ Start'}</span>}
    </button>; };
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-canvas pb-28">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-brand-700 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))] text-white">
        <button type="button" onClick={onClose} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-bold">‹ Back</button>
        <p className="min-w-0 flex-1 truncate text-[16px] font-bold">{short(e.combine ?? e.tag)}{e.description ? ` · ${e.description}` : ''}</p>
        <button type="button" onClick={onDetails} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-bold">Details ›</button>
      </header>
      <main className="mx-auto max-w-xl px-3 pt-3">
        <Card>
          <p className="text-[12px] text-slate-600"><b className="text-[15px] text-slate-900">{short(e.combine ?? e.tag)}</b> · {acts.filter((a) => a.actualFinish).length}/{acts.length} steps</p>
          <p className="text-[12px] text-slate-600">{acts.every((a) => a.actualFinish) ? <b className="text-status-green">✓ All steps done</b> : <>Now: <b className="text-slate-900">{phaseName(current, acts)}</b></>}{behindH > 0 ? <b className="text-status-red"> · {lateText(behindH).replace('late', 'behind')}</b> : ''}{ends.length ? ` · plan end ${dayOf(Math.max(...ends))}` : ''}</p>
          <div className="mt-1.5 grid grid-cols-7 gap-0.5">{byPhase.map((x) => <span key={x.p} className={cx('h-2 rounded-sm', tone(x.xs, x.p))} />)}</div>
          <div className="mt-0.5 grid grid-cols-7 gap-0.5 text-center text-[8.5px] leading-tight text-slate-500">{byPhase.map((x) => <span key={x.p}>{phaseName(x.p, acts)}</span>)}</div>
        </Card>
        <List>{byPhase.filter((x) => x.xs.length).map((x) => { const n = x.xs.filter((a) => a.actualFinish).length, run = x.xs.filter((a) => a.actualStart && !a.actualFinish).length, all = n === x.xs.length, isOpen = open.has(x.p), w = win(x.xs);
          return <div key={x.p}>
            <button type="button" aria-expanded={isOpen} onClick={() => setOpen((s) => { const t = new Set(s); if (t.has(x.p)) t.delete(x.p); else t.add(x.p); return t; })}
              className={cx('flex w-full items-center justify-between gap-2 border-t border-slate-100 px-2.5 py-2 text-left text-[12.5px] font-bold first:border-t-0', all ? 'bg-green-50 text-green-900' : x.p === current || run ? 'bg-amber-50 text-amber-950' : 'text-slate-700')}>
              <span>{all ? '✓' : x.p === current || run ? '▶' : ''} {x.p + 1} · {phaseName(x.p, acts)} · {n}/{x.xs.length}{run && x.p !== current ? ` · ${run} running` : ''}</span>
              <span className="shrink-0 text-[10.5px] font-semibold text-slate-500">{all ? (isOpen ? 'hide ▴' : 'show ▾') : `${windowText(w).replace(/^Plan /, 'plan ')} ${isOpen ? '▴' : '▾'}`}</span></button>
            {isOpen && x.xs.map(step)}
          </div>; })}</List>
        <button type="button" onClick={onList} className="mx-1 text-[12px] font-semibold text-brand-700">≡ List · edit, add, order ›</button>
        <p className="mx-1 mt-1 text-[11px] text-slate-500">Stages: OP to handover · Under maintenance · Under inspection · Under repair · To be boxed up · OP to take back · Completed. Red: not started after its plan start, or not done after its plan finish.</p>
      </main>
      {sel && <BedSheet d={d} set={set} r={rowOf(sel)} col={0} cols={[0]} all={false} head={isHead} done={done} onClose={() => setPick(null)} />}
    </div>
  );
}

// holds: the Section Head's reason list (PendingForm) in every view (owner, 25 Oct 2026)
/** One item: finish the running step / start the next, its status and a short note; drums for a reactor dumping. */
/** The item sheet, the same in both modes: the steps and the main action, issues, inspection worklist, hold and status
 *  (Engineer base), with the Section Head part (flags, M & I %, drums, No change / Delay, isolation, stage, IATs,
 *  related equipment, history, technical details, scope) shown by role. */
export function ItemSheetFor({ d, tag, now, role, me = null, done, onClose, onIsolation }: { d: TrackerData; tag: string; now: number; role: EngRole; me?: string | null; done: Done; onClose: () => void; onIsolation: (tag: string) => void }) {
  const e = d.equipment.find((x) => x.tag === tag) ?? (d.loopItems ?? []).find((x) => x.tag === tag);
  if (!e) return null;
  return <RoleCtx.Provider value={role}><MeCtx.Provider value={me}><IsoCtx.Provider value={onIsolation}><ItemSheet d={d} e={e} now={now} done={done} onClose={onClose} /></IsoCtx.Provider></MeCtx.Provider></RoleCtx.Provider>;
}
function ItemSheet({ d, e: e0, now = Date.now(), done, onClose }: { d: TrackerData; e: TrkEquipment; now?: number; done: Done; onClose: () => void }) {
  // a related item opens in the same sheet
  const [tag, setTag] = useState(e0.tag);
  const e = d.equipment.find((x) => x.tag === tag) ?? (d.loopItems ?? []).find((x) => x.tag === tag) ?? e0;
  const role = useContext(RoleCtx), me = useContext(MeCtx), toIso = useContext(IsoCtx);
  const views = useMemo(() => equipViews(d, now), [d, now]);
  const miAll = useMemo(() => new Map((phases(d, now).mi.weighted?.items ?? []).map((i) => [i.tag, i])), [d, now]);
  const v = views.find((x) => x.eq.tag === e.tag);
  const keys = e.combine ? d.equipment.filter((x) => x.combine === e.combine).map(keyOf) : [keyOf(e)];
  const ls = lines(d, keys); const run = ls.filter((a) => a.actualStart && !a.actualFinish); const next = ls.find((a) => !a.actualStart);
  // steps that run together with the next one or with a running one can start too (owner, 28 Oct 2026)
  const together = new Map(keys.flatMap((k) => [...runTogether(lines(d, [k]))].map(([id, g]) => [id, `${k}:${g.id}`] as const)));
  const alsoNow = next ? ls.filter((a) => !a.actualStart && a.id !== next.id && [next, ...run].some((x) => together.get(x.id) && together.get(x.id) === together.get(a.id))).slice(0, 3) : [];
  const [holdOpen, setHoldOpen] = useState(false); const [insp, setInsp] = useState(false);
  const [note, setNote] = useState('');
  const [stage, setStage] = useState<number | null>(null);
  // the steps page first (owner, 30 Oct 2026); the item's details (status, hold, issues, updates) one tap away
  const [steps, setSteps] = useState<'board' | 'list' | null>(() => (lines(d, e0.combine ? d.equipment.filter((x) => x.combine === e0.combine).map(keyOf) : [keyOf(e0)]).length ? 'board' : null));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const manage = useCanManage();
  const twins = keys.map((k) => d.equipment.find((x) => keyOf(x) === k)!).filter(Boolean);
  async function run1(f: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>) { setBusy(true); setErr(null); try { await f(); done(msg, undo); onClose(); } catch (x) { setErr(x); } finally { setBusy(false); } }
  // the tracker's step action: twins move together, starting ends the hold, Undo restores both
  const step = async (a: TrkActivity, finish: boolean) => {
    const also = [...ls.filter((x) => x.id !== a.id && x.key !== a.key && x.activity === a.activity && (finish ? x.actualStart && !x.actualFinish : !x.actualStart)),
      // linked items' test (no blind between them): one hydrotest for all
      ...(e.linked && isLinkedTest(a.activity) ? d.activities.filter((x) => x.tracked && !x.actualFinish && (finish ? !!x.actualStart : !x.actualStart) && bedName(x.activity) === bedName(a.activity) && d.equipment.some((q) => q.linked === e.linked && q.id !== e.id && keyOf(q) === x.key)) : [])];
    setBusy(true); setErr(null);
    try { const r = await stepNow(a, also, finish, twins); done(r.msg, r.undo); onClose(); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const save = () => run1(async () => {
    for (const t of twins) await setEquipment(t.id, { ...(note.trim() ? { remark: note.trim() } : {}), ...(stage !== null ? { stage } : {}) });
  }, `${short(e.tag)} saved.`, async () => { for (const t of twins) await setEquipment(t.id, { pending_reason: t.pendingReason, remark: t.remark, stage: t.stage }); });
  if (steps === 'list') return <StepsPage d={d} e={e} keys={keys} done={done} onClose={() => setSteps('board')} />;
  if (steps === 'board') return <StepBoard d={d} e={e} keys={keys} done={done} onList={() => setSteps('list')} onDetails={() => setSteps(null)} onClose={onClose} />;
  return (
    <BottomSheet open onClose={onClose} title={short(e.tag)}>
      <div className="space-y-2.5">
        <button type="button" onClick={() => setSteps('board')} className="flex min-h-10 w-full items-center justify-between rounded-xl bg-slate-50 px-3 text-[13px] font-bold text-brand-700 ring-1 ring-slate-200">
          <span>📋 All steps{manage ? ' · view, edit, add, order' : ''}</span><span className="text-slate-500">{ls.filter((a) => a.actualFinish).length}/{ls.length} ›</span></button>
        <p className="text-xs text-slate-600">Last: {itemLine(d, e)}{e.updatedAt ? ` · ${when(e.updatedAt)}` : ''}</p>
        <LatestUpdate d={d} tag={e.tag} canEdit onDone={(m: string) => done(m)} />
        <BufferBox d={d} k={keyOf(e)} now={now} head={role === 'head'} done={done} />
        <FollowRow d={d} e={e} keys={keys} done={done} />
        {v && <ItemMore part="top" v={v} system={e.system ? views.filter((x) => x.eq.system === e.system && x.eq.tag !== e.tag) : []} groups={[...new Set(d.equipment.map((x) => x.group))]} systems={[...new Set(d.equipment.map((x) => x.system).filter((x): x is string => !!x))]}
          canManage={manage} canScope={role === 'head'} totalH={scopeImpact(d).totalH} onItem={setTag} mi={miAll.get(e.tag)} related={relatedWork(e.tag, keyOf(e), d.activities)} allIats={d.iats} lineup={d.lineup} lineupEq={d.lineupEq} tags={d.equipment.map((x) => x.tag)}
          trackerId={d.tracker.id} canEdit isHead={role === 'head'} activities={d.activities.filter((a) => a.key === keyOf(e))} now={now} iso={isolationOf(e.tag, d.points ?? [])} points={d.points ?? []} engine={d.engine} settings={d.settings} me={me}
          onIsolation={() => { onClose(); toIso?.(e.tag); }} onDone={done} />}
        {run.map((a) => <button key={a.id} type="button" disabled={busy} onClick={() => step(a, true)} className="w-full rounded-xl bg-amber-400 px-3 py-2 text-left text-amber-950"><span className="block text-[11px] font-bold uppercase tracking-wide opacity-80">✓ Finish</span><span className="line-clamp-2 text-[13px] font-semibold leading-snug">{a.activity}</span></button>)}
        {next && [next, ...alsoNow].map((x, j) => <button key={x.id} type="button" disabled={busy} onClick={() => step(x, false)} className="w-full rounded-xl bg-brand-700 px-3 py-2 text-left text-white"><span className="block text-[11px] font-bold uppercase tracking-wide opacity-80">▶ Start{j > 0 || (alsoNow.length && j === 0) || run.some((r) => together.get(r.id) && together.get(r.id) === together.get(x.id)) ? ' · runs together' : ''}</span><span className="line-clamp-2 text-[13px] font-semibold leading-snug">{x.activity}</span></button>)}
        {!ls.length ? <>{e.description && <p className="text-[13px] font-semibold">{e.description}</p>}
          <p className="pt-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Stage</p>
          <div className="flex flex-wrap gap-1.5">{STAGE_SHORT.map((l, i) => (i === 2 && (stage ?? e.stage) !== 2 ? null : <button key={i} type="button" onClick={() => setStage(i)} className={cx('min-h-8 rounded-full px-2.5 text-[12px] font-semibold', (stage ?? e.stage) === i ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300')}>{l}</button>))}</div></>
          : !run.length && !next && <p className="rounded-xl bg-green-50 p-2 text-sm font-semibold text-green-800">✓ All steps done</p>}
        <Issues d={d} done={done} item={e} keys={keys} />
        {(e.inspWork || e.inspRef) && <div className="rounded-2xl bg-white p-2.5 ring-1 ring-slate-200">
          <button type="button" onClick={() => setInsp((x) => !x)} className="flex w-full items-center gap-1.5 text-left text-[11px] font-extrabold uppercase tracking-wider text-slate-500"><span className="w-3">{insp ? '▾' : '▸'}</span>Inspection worklist</button>
          {insp && <div className="mt-1.5"><InspWork ref_={e.inspRef} work={e.inspWork} /></div>}</div>}
        <p className="pt-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Status</p>
        {e.pendingReason
          ? <div className="flex items-center gap-2 rounded-xl bg-red-50 px-2.5 py-1.5 text-[13px] text-red-900 ring-1 ring-red-200"><span className="min-w-0 flex-1">⏸ On hold: {e.pendingReason}</span>
              <button type="button" disabled={busy} onClick={() => run1(async () => { for (const t of twins) await setEquipment(t.id, { pending_reason: null }); }, `${short(e.tag)}: resumed.`, async () => { for (const t of twins) await setEquipment(t.id, { pending_reason: t.pendingReason }); })} className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-[12px] font-bold text-brand-700 ring-1 ring-red-200">▶ Resume</button></div>
          : holdOpen ? <PendingForm initial={null} busy={busy} onSave={(r) => run1(async () => { for (const t of twins) await setEquipment(t.id, { pending_reason: r }); }, `${short(e.tag)}: on hold.`, async () => { for (const t of twins) await setEquipment(t.id, { pending_reason: t.pendingReason }); })} />
          : <button type="button" onClick={() => setHoldOpen(true)} className="min-h-9 w-full rounded-xl bg-white text-[13px] font-semibold text-slate-700 ring-1 ring-slate-300">⏸ Hold (with reason)</button>}
        <input className="input text-[14px]" placeholder="Status now, e.g. Bolt removal I/P" value={note} onChange={(x) => setNote(x.target.value)} />
        {(() => { const n = note.trim().split(/\s+/).filter(Boolean).length;
          return <p className={cx('-mt-1.5 text-[11px]', n > 10 ? 'font-semibold text-amber-700' : 'text-slate-500')}>{n > 10 ? `${n} words: keep it to the status (about 8 words); a problem goes under ⚠ Issues.` : 'Status only: what · I/P / done / stopped. Waiting? use Hold above.'}</p>; })()}
        <button type="button" disabled={busy || (!note.trim() && (stage === null || stage === e.stage))} onClick={save} className="min-h-11 w-full rounded-xl bg-brand-700 text-[15px] font-bold text-white disabled:opacity-50">Save</button>
        {v && <ItemMore part="rest" v={v} system={e.system ? views.filter((x) => x.eq.system === e.system && x.eq.tag !== e.tag) : []} groups={[...new Set(d.equipment.map((x) => x.group))]} systems={[...new Set(d.equipment.map((x) => x.system).filter((x): x is string => !!x))]}
          canManage={manage} canScope={role === 'head'} totalH={scopeImpact(d).totalH} onItem={setTag} mi={miAll.get(e.tag)} related={relatedWork(e.tag, keyOf(e), d.activities)} allIats={d.iats} lineup={d.lineup} lineupEq={d.lineupEq} tags={d.equipment.map((x) => x.tag)}
          trackerId={d.tracker.id} canEdit isHead={role === 'head'} activities={d.activities.filter((a) => a.key === keyOf(e))} now={now} iso={isolationOf(e.tag, d.points ?? [])} points={d.points ?? []} engine={d.engine} settings={d.settings} me={me}
          onIsolation={() => { onClose(); toIso?.(e.tag); }} onDone={done} />}
        {err != null && <ErrorBox error={err} />}
      </div>
    </BottomSheet>
  );
}

/** All the work steps of an item, full screen: start / finish / undo, rename, put in order, add a step, take off a
 *  step added here. The P6 lines keep their dates and their P6 text (shown when renamed); added steps have no planned
 *  time, so they change neither the % nor the forecast. */
function StepsPage({ d, e, keys, done, onClose }: { d: TrackerData; e: TrkEquipment; keys: string[]; done: Done; onClose: () => void }) {
  const manage = useCanManage();
  // a bar-chart step not required: off the timing and the %, kept with its reason (Section Head, as on the tracker)
  const isHead = useContext(RoleCtx) === 'head';
  const [order, setOrd] = useState<{ key: string; ids: string[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const [add, setAdd] = useState<{ key: string; text: string; after: string | null } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  // the time a start / finish happened: now, or an earlier time typed in (Kuwait); a correction or a time over 48 h
  // back needs a reason, kept in the change log with who and when
  const [at, setAt] = useState(''); const [why, setWhy] = useState('');
  async function act(f: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>) { setBusy(true); setErr(null); try { await f(); done(msg, undo); setEdit(null); setAdd(null); setOrd(null); setAt(''); setWhy(''); } catch (x) { setErr(x); } finally { setBusy(false); } }
  const atIso = at ? new Date(`${at}:00+03:00`).toISOString() : null;
  const tooOld = !!atIso && Date.now() - Date.parse(atIso) > BACKDATE_LIMIT_H * H;
  const future = !!atIso && Date.parse(atIso) > Date.now() + 15 * 60000;
  const kwInput = (ms0: number) => new Date(ms0 + 3 * H).toISOString().slice(0, 16);
  // a start / finish entered well after it happened: when and by whom it was entered
  const entered = (a: TrkActivity, field: 'actual_start' | 'actual_finish', value: string | null | undefined) => {
    if (!value) return '';
    const l = [...d.log].reverse().find((x) => x.ref === `${a.key} · ${a.activityId}` && x.field === field);
    return l && Date.parse(l.at) - Date.parse(value) > H ? ` · entered ${when(l.at)}${l.byName ? ` by ${l.byName}` : ''}` : '';
  };
  // every step of the item in its order (the hidden field steps too, so a saved order keeps their place)
  const allOf = (k: string) => sortActs(d.activities.filter((a) => a.key === k && a.tracked));
  const ld = (iso: string | null | undefined) => (iso ? when(iso) : '');
  const hrs = (a: TrkActivity) => a.durationH ?? (a.start && a.finish ? Math.round((Date.parse(a.finish) - Date.parse(a.start)) / H) : null);
  // a done step: how long it took from start to finish, against its plan hours when it has them
  const tookOf = (a: TrkActivity) => { const t = spanText(a.actualStart, a.actualFinish), h = hrs(a); return t ? ` · took ${t}${h ? ` (plan ${h} h)` : ''}` : ''; };
  const step = (a: TrkActivity, to: 'start' | 'finish' | 'undo') => {
    const t = atIso ?? new Date().toISOString(), back = { actual_start: a.actualStart ?? null, actual_finish: a.actualFinish ?? null };
    const patch = to === 'start' ? { actual_start: t } : to === 'finish' ? { actual_finish: t, ...(a.actualStart ? {} : { actual_start: t }) } : a.actualFinish ? { actual_finish: null } : { actual_start: null };
    const said = to === 'undo' ? 'undone' : `${to === 'start' ? 'started' : 'finished'}${atIso ? ` ${when(t)}` : ''}`;
    return act(() => setActivity(a.id, { ...patch, ...(why.trim() ? { time_reason: why.trim() } : {}) }), `${a.activity}: ${said}.`, () => setActivity(a.id, back));
  };
  // correct a recorded time to the one typed in
  const retime = (a: TrkActivity, field: 'actual_start' | 'actual_finish') => act(() => setActivity(a.id, { [field]: atIso, time_reason: why.trim() }), `${a.activity}: ${field === 'actual_start' ? 'start' : 'finish'} set to ${when(atIso!)}.`,
    () => setActivity(a.id, { [field]: field === 'actual_start' ? a.actualStart ?? null : a.actualFinish ?? null, time_reason: 'Undo of a correction' }));
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-canvas pb-28">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-brand-700 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))] text-white">
        <button type="button" onClick={onClose} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-bold">‹ Back</button>
        <p className="min-w-0 flex-1 truncate text-[16px] font-bold">{short(e.combine ?? e.tag)} · steps</p>
      </header>
      <main className="mx-auto max-w-xl px-3 pt-3">
        {err != null && <div className="mb-2"><ErrorBox error={err} /></div>}
        {keys.map((k) => { const all = allOf(k), ls = lines(d, [k]);
          const ids = order?.key === k ? order.ids : null;
          const shown = ids ? ids.map((id) => all.find((a) => a.id === id)!).filter((a) => a && !a.detail && a.group !== 'Operations') : ls;
          const move = (id: string, by: number) => { if (!ids) return; const vis = shown.map((a) => a.id); const i = vis.indexOf(id), j = i + by; if (j < 0 || j >= vis.length) return;
            [vis[i], vis[j]] = [vis[j], vis[i]]; let n = 0; setOrd({ key: k, ids: ids.map((x) => (vis.includes(x) ? vis[n++] : x)) }); };
          const running = ls.find((a) => a.actualStart && !a.actualFinish), lastDone = [...ls].reverse().find((a) => a.actualFinish);
          return <section key={k} className="mb-4">
            <div className="mx-1 mb-1.5 flex items-center gap-2">
              <p className="min-w-0 flex-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">{keys.length > 1 ? `${short(k)} · ` : ''}{ls.filter((a) => a.actualFinish).length}/{ls.length} done</p>
              {!ids && ls.length > 1 && <button type="button" disabled={busy} onClick={() => setOrd({ key: k, ids: all.map((a) => a.id) })} className="rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-brand-700 ring-1 ring-slate-200">↕ Order</button>}
              {!ids && manage && <button type="button" disabled={busy} onClick={() => setAdd({ key: k, text: '', after: (running ?? lastDone)?.id ?? null })} className="rounded-full bg-brand-700 px-2.5 py-1 text-[12px] font-bold text-white">+ Add step</button>}
            </div>
            {ids && <p className="mx-1 mb-1.5 text-[12px] text-slate-500">Move with ↑ ↓, then save. The plan dates do not change.</p>}
            {add?.key === k && <div className="mb-2 space-y-2 rounded-2xl bg-white p-3 ring-2 ring-brand-700">
              <input autoFocus className="input text-[14px]" placeholder="New step (e.g. Gas test for entry)" value={add.text} onChange={(x) => setAdd({ ...add, text: x.target.value })} />
              <label className="block text-[11px] font-bold text-slate-500">PLACE AFTER
                <select className="input mt-0.5 text-[13px]" value={add.after ?? ''} onChange={(x) => setAdd({ ...add, after: x.target.value || null })}>
                  <option value="">At the end</option>{ls.map((a, i) => <option key={a.id} value={a.id}>{i + 1}. {a.activity}</option>)}</select></label>
              <div className="flex gap-2"><button type="button" onClick={() => setAdd(null)} className="min-h-10 flex-1 rounded-xl bg-white font-bold text-slate-700 ring-1 ring-slate-300">Cancel</button>
                <button type="button" disabled={busy || !add.text.trim()} onClick={() => act(() => addEngStep(d.tracker.id, k, add.text.trim(), all.map((a) => a.id), add.after), `${short(k)}: step added.`)} className="min-h-10 flex-1 rounded-xl bg-brand-700 font-bold text-white disabled:opacity-50">Add</button></div>
              <p className="text-[11px] text-slate-500">An added step has no plan time: it does not change the % or the end date.</p>
            </div>}
            {shown.length > 0 && <List>{(() => { const grp = runTogether(shown); const range = new Map<number, [number, number]>();
              shown.forEach((a, i) => { const g = grp.get(a.id); if (g) { const r = range.get(g.id); range.set(g.id, r ? [r[0], i] : [i, i]); } });
              const inBand = (i: number) => [...range.values()].some(([x, y]) => i >= x && i <= y);
              return shown.map((a, i) => { const eng = a.activityId.startsWith('ENG-'), h = hrs(a), on = open === a.id && !ids;
              const g = grp.get(a.id), first = g ? range.get(g.id)![0] : -1;
              // red when late (owner, 27 Oct 2026): its P6 start passed and it has not started, or its P6 finish passed and it has not finished
              const tnow = Date.now(), lateStart = !a.actualStart && !!a.start && tnow > Date.parse(a.start), lateFinish = !a.actualFinish && !!a.finish && tnow > Date.parse(a.finish), late = a.tracked && (lateStart || lateFinish);
              const head = g && g.letter === 'a' && !ids ? <div key={`g${g.id}`} className="flex items-center justify-between gap-2 border-b border-l-4 border-indigo-300 border-b-indigo-100 bg-indigo-50 px-2.5 py-1 text-[11px]">
                <b className="text-indigo-800">⇉ {g.members.length} run together</b><span className="tabular-nums text-slate-600">{kwDay(g.start)} {kwTime(g.start)} → {kwDay(g.end)} {kwTime(g.end)} · {Math.round((g.end - g.start) / H)} h</span></div> : null;
              return <Fragment key={a.id}>{head}<div className={cx('border-b border-slate-100 last:border-b-0', on && 'bg-slate-50', !ids && inBand(i) && 'border-l-4 border-l-indigo-300 bg-indigo-50/30')}>
                <div className="flex items-center gap-2 px-2.5 py-1.5">
                  <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold', a.actualFinish ? 'bg-status-green text-white' : a.actualStart ? 'bg-amber-400 text-amber-950' : 'bg-slate-100 text-slate-600')}>{a.actualFinish ? '✓' : a.actualStart ? '▶' : g && !ids ? `${first + 1}${g.letter}` : i + 1}</span>
                  <button type="button" disabled={!!ids} onClick={() => { setOpen(on ? null : a.id); setEdit(null); setAt(''); setWhy(''); }} className="min-w-0 flex-1 text-left">
                    <span className="block text-[13px] font-semibold leading-snug">{a.activity}{!a.actualFinish && isBufferStep(a.activity) && <span title="Buffer: not always needed, can be skipped to catch up" className="ml-1.5 inline-block rounded border border-dashed border-amber-500 px-1 align-middle text-[10px] font-bold text-amber-800">Buffer</span>}</span>
                    <span className={cx('block text-[11px]', late ? 'font-semibold text-status-red' : 'text-slate-500')}>{a.actualFinish ? `Done ${ld(a.actualFinish)}${entered(a, 'actual_finish', a.actualFinish)}${tookOf(a)}` : a.actualStart ? `Started ${ld(a.actualStart)}${entered(a, 'actual_start', a.actualStart)}${spanText(a.actualStart, new Date().toISOString()) ? ` · running ${spanText(a.actualStart, new Date().toISOString())}` : ''}` : eng ? 'Added step · no plan time' : a.start ? `Plan ${ld(a.start)}${h ? ` · ${h} h` : ''}` : 'No plan time'}{late ? (lateStart ? ' · start late' : ` · finish late (plan ${ld(a.finish!)})`) : ''}{a.updatedBy && (a.actualStart || eng) ? ` · ${a.updatedBy}` : ''}</span>
                    {a.p6Activity && <span className="block text-[11px] italic text-slate-500">P6: {a.p6Activity}</span>}
                  </button>
                  {ids && <span className="flex shrink-0 gap-1"><button type="button" aria-label="Up" disabled={i === 0} onClick={() => move(a.id, -1)} className="h-9 w-9 rounded-lg bg-slate-100 text-lg font-bold disabled:opacity-30">↑</button>
                    <button type="button" aria-label="Down" disabled={i === shown.length - 1} onClick={() => move(a.id, 1)} className="h-9 w-9 rounded-lg bg-slate-100 text-lg font-bold disabled:opacity-30">↓</button></span>}
                </div>
                {on && <div className="space-y-2 border-t border-slate-100 px-2.5 py-2">
                  <PlanVsActual a={a} planH={h} />
                  {edit?.id === a.id ? <>
                    <textarea autoFocus className="input min-h-16 text-[14px]" value={edit.text} onChange={(x) => setEdit({ ...edit, text: x.target.value })} />
                    <div className="flex gap-2"><button type="button" onClick={() => setEdit(null)} className="min-h-10 flex-1 rounded-xl bg-white font-bold text-slate-700 ring-1 ring-slate-300">Cancel</button>
                      <button type="button" disabled={busy || !edit.text.trim() || edit.text.trim() === a.activity} onClick={() => act(() => setActivity(a.id, { activity: edit.text.trim() }), 'Step renamed.', () => setActivity(a.id, { activity: a.activity }))} className="min-h-10 flex-1 rounded-xl bg-brand-700 font-bold text-white disabled:opacity-50">Save</button></div>
                  </> : <>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase text-slate-500">Time</span>
                    <input type="datetime-local" className="input min-h-9 flex-1 py-1 text-[13px]" value={at} max={kwInput(Date.now())} onChange={(x) => setAt(x.target.value)} />
                    {at ? <button type="button" onClick={() => { setAt(''); setWhy(''); }} className="min-h-9 rounded-lg bg-slate-100 px-2.5 text-[12px] font-bold text-slate-700">Now</button> : <span className="text-[12px] text-slate-500">now</span>}
                  </div>
                  {future && <p className="text-[12px] font-semibold text-status-red">The time cannot be in the future.</p>}
                  {atIso && !future && (tooOld || a.actualStart) && <input className="input min-h-9 text-[13px]" placeholder={tooOld ? `Reason (over ${BACKDATE_LIMIT_H} h back)` : 'Reason for the correction'} value={why} onChange={(x) => setWhy(x.target.value)} />}
                  {!future && <div className="grid grid-cols-2 gap-1.5">
                    {!a.actualStart && <button type="button" disabled={busy || (tooOld && !why.trim())} onClick={() => step(a, 'start')} className="min-h-10 rounded-xl bg-brand-700 text-[13px] font-bold text-white">▶ Start</button>}
                    {!a.actualFinish && <button type="button" disabled={busy || (tooOld && !why.trim())} onClick={() => step(a, 'finish')} className="min-h-10 rounded-xl bg-amber-400 text-[13px] font-bold text-amber-950">✓ Finish</button>}
                    {a.actualStart && <button type="button" disabled={busy} onClick={() => step(a, 'undo')} className="min-h-10 rounded-xl bg-white text-[13px] font-bold text-slate-700 ring-1 ring-slate-300">↶ Undo {a.actualFinish ? 'finish' : 'start'}</button>}
                    {atIso && a.actualStart && <button type="button" disabled={busy || !why.trim()} onClick={() => retime(a, 'actual_start')} className="min-h-10 rounded-xl bg-white text-[13px] font-bold text-brand-700 ring-1 ring-slate-300">Set start to this time</button>}
                    {atIso && a.actualFinish && <button type="button" disabled={busy || !why.trim()} onClick={() => retime(a, 'actual_finish')} className="min-h-10 rounded-xl bg-white text-[13px] font-bold text-brand-700 ring-1 ring-slate-300">Set finish to this time</button>}
                    {isHead && !eng && !a.actualStart && <button type="button" disabled={busy} onClick={() => void act(() => setActivity(a.id, { tracked: false, disabled_reason: 'not required' }), `${a.activity}: not required.`, () => setActivity(a.id, { tracked: true, disabled_reason: null }))} className="min-h-10 rounded-xl bg-white text-[13px] font-bold text-slate-700 ring-1 ring-slate-300">⊘ Not required</button>}
                    {manage && <button type="button" disabled={busy} onClick={() => setEdit({ id: a.id, text: a.activity })} className="min-h-10 rounded-xl bg-white text-[13px] font-bold text-brand-700 ring-1 ring-slate-300">✎ Edit name</button>}
                    {eng && manage && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Remove "${a.activity}"?`)) void act(() => setActivity(a.id, { tracked: false, disabled_reason: 'removed' }), 'Step removed.', () => setActivity(a.id, { tracked: true, disabled_reason: null })); }} className="min-h-10 rounded-xl bg-white text-[13px] font-bold text-red-700 ring-1 ring-red-200">🗑 Remove</button>}
                  </div>}</>}
                  {!eng && !edit && <p className="text-[11px] text-slate-500">Bar-chart step: its plan dates stay as in P6.</p>}
                </div>}
              </div></Fragment>; }); })()}</List>}
            {!shown.length && <Card><p className="text-sm text-slate-600">No steps yet. Add the first one.</p></Card>}
            {(() => { const off = d.activities.filter((a) => a.key === k && !a.tracked && !a.outOfScope && !a.detail && /^not required/.test(a.disabledReason ?? ''));
              return off.length > 0 && <details className="mb-2 rounded-2xl bg-white px-2.5 py-1.5 text-[12px] ring-1 ring-slate-200"><summary className="cursor-pointer font-semibold text-slate-600">Not required · {off.length}</summary>
                {off.map((a) => <div key={a.id} className="flex items-center gap-2 border-t border-slate-100 py-1.5 first:border-t-0">
                  <span className="min-w-0 flex-1"><span className="block text-slate-700 line-through decoration-slate-300">{a.activity}</span><span className="block text-[11px] text-slate-500">{(a.disabledReason ?? '').replace(/^not required:?\s*/, '') || 'not required'}</span></span>
                  {isHead && <button type="button" disabled={busy} onClick={() => void act(() => setActivity(a.id, { tracked: true, disabled_reason: null }), `${a.activity}: required again.`, () => setActivity(a.id, { tracked: false, disabled_reason: a.disabledReason ?? 'not required' }))} className="shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-bold text-brand-700 ring-1 ring-slate-300">Required again</button>}
                </div>)}</details>; })()}
            {ids && <div className="sticky bottom-3 mt-2 flex gap-2 rounded-2xl bg-white p-2 shadow-lg ring-1 ring-slate-200">
              <button type="button" onClick={() => setOrd(null)} className="min-h-11 flex-1 rounded-xl bg-white font-bold text-slate-700 ring-1 ring-slate-300">Cancel</button>
              <button type="button" disabled={busy} onClick={() => { const was = all.some((a) => a.seq != null) ? all.map((a) => a.id) : []; void act(() => setOrder(d.tracker.id, k, ids), `${short(k)}: order saved.`, () => setOrder(d.tracker.id, k, was)); }} className="min-h-11 flex-1 rounded-xl bg-brand-700 font-bold text-white">✓ Save order</button></div>}
          </section>; })}
        {isHead && <OpsFieldSteps d={d} keys={keys} done={done} />}
      </main>
    </div>
  );
}
/** The operations steps and the field-operator detail steps of an item: for the Section Head, folded (hidden in the
 *  Engineer mode, owner 25 Oct). */
function OpsFieldSteps({ d, keys, done }: { d: TrackerData; keys: string[]; done: Done }) {
  const [open, setOpen] = useState(false);
  const xs = sortActs(d.activities.filter((a) => keys.includes(a.key) && a.tracked && (a.detail || a.group === 'Operations')));
  if (!xs.length) return null;
  const now = Date.now();
  return <section className="mt-3">
    <button type="button" onClick={() => setOpen((x) => !x)} className="mx-1 text-[12px] font-semibold text-slate-500">{open ? '▾' : '▸'} Operations and field steps ({xs.filter((a) => a.actualFinish).length}/{xs.length}) · Section Head</button>
    {open && <RowList className="mt-1">{xs.map((a) => <ActivityRow key={a.id} t={timing(a, now)} canEdit isHead onDone={done} />)}</RowList>}
  </section>;
}

/** The shutdown progress report for WhatsApp, in the plant's format, from what is in the tracker now; a note for the
 *  shift can be added (saved with the shift). */
function ReportSheet({ d, now, by, onClose }: { d: TrackerData; now: number; by: string; onClose: () => void }) {
  const sh = shiftOf(now);
  const saved = d.shiftLogs.find((l) => l.shiftDate === sh.date && l.shift === sh.shift) ?? null;
  const [notes, setNotes] = useState(saved?.notes ?? '');
  const [copied, setCopied] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [leader, setLeader] = useState(false);
  const text = leader ? leaderReportText(d, now, { title: d.tracker.title, test: d.tracker.mode === 'test', by })
    : reportText(shiftReport(d, now, { notes, temps: saved?.temps ?? {} }, d.tracker.title), { test: d.tracker.mode === 'test', by });
  const wa = (d.settings.whatsapp ?? '').replace(/\D/g, '');
  const keep = async () => { if ((saved?.notes ?? '') !== notes) { try { await saveShiftLog(d.tracker.id, sh.date, sh.shift, { notes, temps: saved?.temps ?? {} }); } catch (x) { setErr(x); } } };
  async function share() { await keep(); try { if (navigator.share) { await navigator.share({ text }); return; } } catch { return; } window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`, '_blank'); }
  return (
    <BottomSheet open onClose={onClose} title="WhatsApp report">
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">{([[false, 'Shift report'], [true, 'Team leader']] as const).map(([v, label]) => (
          <button key={label} type="button" onClick={() => setLeader(v)} className={cx('min-h-9 rounded-lg text-[13px] font-bold', leader === v ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500')}>{label}</button>))}</div>
        {!leader && <textarea className="input min-h-14 text-[14px]" placeholder="Note for this shift (optional)" value={notes} onChange={(x) => setNotes(x.target.value)} />}
        <pre className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-whatsapp-soft p-3 font-sans text-[12px] leading-snug text-slate-800 ring-1 ring-green-200">{text}</pre>
        <div className="grid grid-cols-3 gap-1.5">
          <a href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => void keep()} className="flex min-h-11 items-center justify-center rounded-xl bg-whatsapp text-[13px] font-bold text-white">WhatsApp</a>
          <button type="button" onClick={() => void share()} className="min-h-11 rounded-xl bg-brand-700 text-[13px] font-bold text-white">Share</button>
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ } }} className="min-h-11 rounded-xl bg-white text-[13px] font-bold text-slate-700 ring-1 ring-slate-300">{copied ? 'Copied' : 'Copy'}</button>
        </div>
        {err != null && <ErrorBox error={err} />}
      </div>
    </BottomSheet>
  );
}

/** The problems: open ones with Edit and ✓ Resolved, a new one, the resolved ones with Reopen. On the dashboard all
 *  of them (the shutdown's N2 / reactors events and every item's problems); on an item, its own. */
function Issues({ d, done, item, keys }: { d: TrackerData; done: Done; item?: TrkEquipment; keys?: string[] }) {
  const all = (d.events ?? []).filter((x) => !item || (x.key && keys!.includes(x.key)));
  const open = all.filter((x) => !x.endedAt), past = all.filter((x) => x.endedAt);
  const [add, setAdd] = useState<{ text: string; cat: TrkEvent['category'] } | null>(null);
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function run(f: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>) { setBusy(true); setErr(null); try { await f(); setAdd(null); setEdit(null); done(msg, undo); } catch (x) { setErr(x); } finally { setBusy(false); } }
  const who = (x: TrkEvent) => (x.key ? short(d.equipment.find((e) => keyOf(e) === x.key)?.tag ?? x.key) : EVENT_LABEL[x.category]);
  const row = (x: TrkEvent) => (
    <div key={x.id} className={cx('border-t border-red-100 py-2 first:border-t-0', x.endedAt && 'opacity-75')}>
      {edit?.id === x.id ? <div className="space-y-1.5">
        <textarea autoFocus className="input min-h-14 text-[14px]" value={edit.text} onChange={(v) => setEdit({ ...edit, text: v.target.value })} />
        <div className="flex gap-2"><button type="button" onClick={() => setEdit(null)} className="min-h-9 flex-1 rounded-xl bg-white text-[13px] font-bold text-slate-700 ring-1 ring-slate-300">Cancel</button>
          <button type="button" disabled={busy || !edit.text.trim() || edit.text.trim() === x.text} onClick={() => run(() => setEventText(x.id, edit.text.trim()), 'Issue updated.', () => setEventText(x.id, x.text))} className="min-h-9 flex-1 rounded-xl bg-brand-700 text-[13px] font-bold text-white disabled:opacity-50">Save</button></div>
      </div> : <>
        <p className="text-[13px] leading-snug">{!item && <b>{who(x)}: </b>}{x.text}</p>
        <p className="text-[11px] text-slate-500">{x.endedAt ? `${when(x.startedAt)} → resolved ${when(x.endedAt)}` : `since ${when(x.startedAt)}`}{x.by ? ` · ${x.by}` : ''}</p>
        <div className="mt-1.5 flex gap-1.5">
          {x.endedAt ? <button type="button" disabled={busy} onClick={() => run(() => endEvent(x.id, false), 'Issue reopened.', () => endEvent(x.id, true))} className="min-h-8 rounded-lg bg-white px-2.5 text-[12px] font-bold text-slate-700 ring-1 ring-slate-300">↺ Reopen</button>
            : <><button type="button" disabled={busy} onClick={() => setEdit({ id: x.id, text: x.text })} className="min-h-8 rounded-lg bg-white px-2.5 text-[12px] font-bold text-brand-700 ring-1 ring-slate-300">✎ Edit</button>
              <button type="button" disabled={busy} onClick={() => run(() => endEvent(x.id, true), 'Issue resolved.', () => endEvent(x.id, false))} className="min-h-8 rounded-lg bg-white px-2.5 text-[12px] font-bold text-green-800 ring-1 ring-green-300">✓ Resolved</button></>}
        </div></>}
    </div>);
  return (
    <section className="mb-2.5 rounded-2xl bg-red-50/60 p-3 ring-1 ring-red-100">
      <div className="flex items-center justify-between"><p className="text-[11px] font-extrabold uppercase tracking-wider text-red-800">⚠ Issues{open.length ? ` · ${open.length} open` : ''}</p>
        {!add && <button type="button" onClick={() => setAdd({ text: '', cat: item ? (item.group === 'Reactors' ? 'reactors' : 'other') : 'nitrogen' })} className="rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-red-800 ring-1 ring-red-200">+ Issue</button>}</div>
      {add && <div className="mt-2 space-y-1.5">
        {!item && <div className="flex gap-1">{(Object.keys(EVENT_LABEL) as TrkEvent['category'][]).map((k) => <button key={k} type="button" onClick={() => setAdd({ ...add, cat: k })} className={cx('min-h-8 rounded-full px-2.5 text-[12px] font-semibold', add.cat === k ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300')}>{EVENT_LABEL[k]}</button>)}</div>}
        <textarea autoFocus className="input min-h-14 text-[14px]" placeholder={item ? 'e.g. High temp in one bed: N2 flow increased (vendor)' : 'e.g. N2 trailer empty, waiting next trailer'} value={add.text} onChange={(v) => setAdd({ ...add, text: v.target.value })} />
        <div className="flex gap-2"><button type="button" onClick={() => setAdd(null)} className="min-h-10 flex-1 rounded-xl bg-white font-bold text-slate-700 ring-1 ring-slate-300">Cancel</button>
          <button type="button" disabled={busy || !add.text.trim()} onClick={() => run(() => addEvent(d.tracker.id, add.cat, add.text.trim(), item ? keyOf(item) : null), 'Issue recorded.')} className="min-h-10 flex-1 rounded-xl bg-status-red font-bold text-white disabled:opacity-50">Record</button></div>
        {!item && <p className="text-[11px] text-slate-500">A problem on one item: record it from the item (Equipment).</p>}
      </div>}
      {open.length > 0 ? <div className="mt-1">{open.map(row)}</div> : !add && <p className="mt-1 text-[12px] text-slate-500">None open.</p>}
      {past.length > 0 && <button type="button" onClick={() => setShowPast((v) => !v)} className="mt-1 text-[12px] font-semibold text-slate-500">{showPast ? '▾' : '▸'} Resolved ({past.length})</button>}
      {showPast && <div className="mt-1">{past.slice(0, 15).map(row)}</div>}
      {err != null && <ErrorBox error={err} />}
    </section>
  );
}

// ── Isolation ───────────────────────────────────────────────────────────────────────────────────────────────────────
const NEXT: Partial<Record<PointStatus, [PointStatus, string, 'fill_at' | 'soak_at' | 'drain_at' | 'done_at']>> = { open: ['filling', '▶ Fill', 'fill_at'], filling: ['soaking', '▶ Soak', 'soak_at'], soaking: ['draining', '▶ Drain', 'drain_at'], draining: ['done', '✓ Neutralized', 'done_at'] };
const SPRAY: Partial<Record<PointStatus, [PointStatus, string, 'fill_at' | 'done_at']>> = { open: ['filling', '▶ Spray', 'fill_at'], filling: ['done', '✓ Done', 'done_at'] };
/** Handover, the same page in both modes: what holds each item from being handed over (blinds, neutralization) with
 *  the chain behind it, the loops, the blinds (segregation, HP critical, the items' own blind lines), the blind list,
 *  and at the end the return (de-blinding). Opened for one item (from its sheet) it shows only that item's. */
export function HandoverTab({ d, now, done, role, onItem, onStep, focus = null, onClearFocus, initial }: { d: TrackerData; now: number; done: Done; role: EngRole; onItem?: (tag: string) => void;
  onStep?: (id: string) => void; focus?: string | null; onClearFocus?: () => void; initial?: 'blind' | 'neut' }) {
  return <RoleCtx.Provider value={role}><OpenItemCtx.Provider value={onItem ?? null}><StepCtx.Provider value={onStep ?? null}>
    <Handover d={d} now={now} done={done} go={() => {}} by="" focus={focus} onClearFocus={onClearFocus} initial={initial} />
  </StepCtx.Provider></OpenItemCtx.Provider></RoleCtx.Provider>;
}
const StepCtx = createContext<((id: string) => void) | null>(null);
const FOS = ['All', 'FO1', 'FO2', 'FO3'];
function Handover({ d, now, done, focus = null, onClearFocus, initial }: P & { focus?: string | null; onClearFocus?: () => void; initial?: 'blind' | 'neut' }) {
  const all = d.points ?? [];
  const [fo, setFo] = useState('All');
  const mine = (p: TrkPoint) => (fo === 'All' || p.fo === fo) && (!focus || p.items.includes(focus) || (p.partOf ?? []).includes(focus));
  const pts = all.filter(mine);
  const loops = pts.filter((p) => p.kind === 'neut' && !withReactor(p) && (p.stepId || (!p.items.includes(p.ref) && (p.method !== 'spray' || p.status !== 'open')) || p.items.includes(focus ?? '\u0000')));
  const blinds = pts.filter((p) => p.kind === 'blind');
  const eqLines = d.activities.filter(equipBlind).filter((a) => !focus || a.key === focus).sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  const openL = loops.filter((p) => !pointComplete(p) && !isNR(p)), nrL = loops.filter(isNR), openB = blinds.filter((p) => !pointComplete(p)), openE = eqLines.filter((a) => !a.actualFinish);
  const waiting = d.equipment.filter((e) => e.tracked && e.stage === 0 && (!focus || e.tag === focus) && (!e.combine || d.equipment.find((x) => x.combine === e.combine) === e))
    .map((e) => ({ e, iso: isoState(e.tag, 0, all) })).filter((x): x is { e: TrkEquipment; iso: NonNullable<ReturnType<typeof isoState>> } => !!x.iso && x.iso.state !== 'ho');
  const blocked = waiting.filter((x) => x.iso.state !== 'ready'), ready = waiting.filter((x) => x.iso.state === 'ready');
  const back = blinds.filter((b) => b.status === 'in');
  const [v, setV] = useState<'block' | 'neut' | 'blind' | 'list' | 'back'>(() => initial ?? (blocked.length || openB.length || openL.length ? 'block' : 'back'));
  const [showDone, setShowDone] = useState(false); const [item, setItem] = useState<TrkEquipment | null>(null);
  const openItem = useContext(OpenItemCtx);
  const toItem = (tag: string) => { if (openItem) return openItem(tag); setItem(d.equipment.find((e) => e.tag === tag) ?? (d.loopItems ?? []).find((e) => e.tag === tag) ?? null); };
  const rank = (p: TrkPoint) => (p.status !== 'open' ? 0 : missingBlinds(p, all).length ? 2 : 1);
  const gate = all.filter((p) => p.kind === 'neut' && p.beforeHo), soaking = all.filter((p) => p.kind === 'neut' && p.status === 'soaking').length;
  const bAll = all.filter((p) => p.kind === 'blind'), eAll = d.activities.filter(equipBlind);
  return (<>
    <p className="mx-1 mb-2 text-[12px] text-slate-600">Blinds in <b>{bAll.filter(pointComplete).length + eAll.filter((a) => a.actualFinish).length}/{bAll.length + eAll.length}</b> · neutralized <b>{gate.filter(pointComplete).length}/{gate.length}</b>{soaking ? <> · soaking <b>{soaking}</b></> : null}</p>
    <div className="-mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]">{([['block', `Blocking ${blocked.length}`], ['neut', `Loops ${loops.length}`], ['blind', `Blinds ${openB.length + openE.length}`], ['list', 'Blind list'], ['back', `Return ${back.length + putBackRows(d).filter((x) => x.status !== 'installed').length}`]] as const).map(([k, l]) =>
      <button key={k} type="button" onClick={() => setV(k)} className={cx('min-h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-[12px] font-bold', v === k ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{l}</button>)}</div>
    {(v === 'neut' || v === 'blind' || focus) && <div className="mb-2 flex flex-wrap gap-1.5">
      {v !== 'block' && FOS.map((x) => <button key={x} type="button" onClick={() => setFo(x)} className={cx('min-h-8 rounded-full px-3 text-[12px] font-semibold', fo === x ? 'bg-brand-500 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{x}</button>)}
      {focus && <button type="button" onClick={onClearFocus} className="min-h-8 rounded-full bg-amber-100 px-3 text-[12px] font-semibold text-amber-900">{focus} ✕</button>}
    </div>}
    {v === 'block' && <>
      <p className="mx-1 mb-2 text-[12px] text-slate-500">Items not handed over yet, and what each one waits for. Tap a line to update it.</p>
      {blocked.length > 0 && <List>{blocked.map(({ e, iso }) => { const loopsOpen = iso.loops.filter((p) => !pointComplete(p));
        return <div key={e.id} className={cx(ROW, 'items-start')}>
          <Tagged tag={short(e.combine ?? e.tag)}>
            {iso.missing.map((r) => { const b = bAll.find((x) => x.ref === r); const job = b && (d.pointSteps ?? []).find((c) => (c.linkPoints ?? []).includes(b.id) && c.startAt && !c.doneAt);
              return <button key={r} type="button" onClick={() => setV('blind')} className="block w-full truncate text-left text-[12px] text-slate-700">🔒 <b>{r}</b> not in{job ? ` · ${job.crane ? '🏗 ' : ''}${job.text.split(/,|:/)[0]} I/P` : ''}</button>; })}
            {loopsOpen.map((p) => { const left = soakLeft(p, now);
              return <button key={p.id} type="button" onClick={() => setV('neut')} className="block w-full truncate text-left text-[12px] text-slate-700">💧 <b>{p.ref}</b> {p.holdReason ? `on hold · ${p.holdReason}` : neutLabel(p).toLowerCase()}{p.status === 'soaking' && left !== null ? ` · ${left > 0 ? `${hoursText(left)} left` : 'soak time reached'}` : ''}</button>; })}
          </Tagged>
          <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', iso.state === 'neut' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800')}>{iso.state === 'neut' ? 'Neutralizing' : iso.state === 'blind' ? 'Waits blinds' : 'Not started'}</span>
        </div>; })}</List>}
      {ready.length > 0 && <><Sec>Ready to hand over · {ready.length}</Sec><List>{ready.map(({ e, iso }) => <div key={e.id} className={ROW}><Tagged tag={short(e.combine ?? e.tag)}><span className="block truncate text-[12px] text-green-800">{iso.why}</span></Tagged><span className="shrink-0 rounded-md bg-green-100 px-1.5 py-0.5 text-[11px] font-bold text-green-800">Ready</span></div>)}</List></>}
      {!blocked.length && !ready.length && <Card><p className="text-sm font-semibold text-green-800">✓ Everything is handed over.</p></Card>}
    </>}
    {v === 'neut' && <>
      {/* every loop on one list (owner, 30 Oct 2026): its equipment, why it is needed (RTJ, inspection, IAT), and one tap:
          Req (neutralize) · N2 (kept under N2 and handed over) · N/R; the loop's card opens on a tap of its name */}
      <List>{[...openL.sort((a, b) => rank(a) - rank(b) || a.sort - b.sort), ...nrL].map((p) => <LoopRow key={p.id} d={d} p={p} now={now} done={done} toItem={toItem} />)}</List>
      {!openL.length && !nrL.length && <Card><p className="text-sm font-semibold text-green-800">✓ All required loops neutralized.</p></Card>}
      <p className="mx-1 mb-1 text-[11px] text-slate-500">Req = neutralize · N2 = keep under N2 and hand over · N/R = not required. Only before the loop starts.</p>
      {(() => { const fin = loops.filter(pointComplete), noWhy = fin.filter((p) => loopBasis(p, d).none && !p.remark?.trim()).length;
        return <><button type="button" onClick={() => setShowDone((x) => !x)} className="mx-1 mt-1 text-[12px] font-semibold text-slate-500">{showDone ? '▾' : '▸'} Neutralized {fin.length}{noWhy ? <span className="text-amber-700"> · {noWhy} with no reason</span> : null}</button>
          {showDone && <div className="mt-2"><List>{fin.map((p) => <LoopRow key={p.id} d={d} p={p} now={now} done={done} toItem={toItem} />)}</List></div>}</>; })()}
    </>}
    {v === 'blind' && <>
      {(['segregation', 'hp_critical'] as const).map((g) => { const xs = blinds.filter((b) => (g === 'hp_critical') === (b.grp === 'hp_critical')); if (!xs.length) return null;
        return <BlindGroup key={g} title={g === 'hp_critical' ? 'HP critical loop' : 'Segregation'} n={xs.filter(pointComplete).length} total={xs.length}
          open={xs.filter((b) => !pointComplete(b)).map((b) => <BlindRow key={b.id} b={b} done={done} toItem={toItem} />)} closed={xs.filter(pointComplete).map((b) => <BlindRow key={b.id} b={b} done={done} toItem={toItem} />)} />; })}
      {eqLines.length > 0 && fo === 'All' && <BlindGroup title="Equipment" n={eqLines.length - openE.length} total={eqLines.length}
        open={openE.map((a) => <EqBlindRow key={a.id} a={a} done={done} toItem={toItem} />)} closed={eqLines.filter((a) => a.actualFinish).map((a) => <EqBlindRow key={a.id} a={a} done={done} toItem={toItem} />)} />}
    </>}
    {v === 'list' && <BlindList d={d} onItem={toItem} />}
    {v === 'back' && <>
      <PutBack d={d} done={done} toItem={toItem} />
      <Sec>Blinds out · {blinds.filter((b) => b.status === 'out').length}/{blinds.length}</Sec>
      <p className="mx-1 mb-2 text-[12px] text-slate-500">Take the blinds out as each item is boxed up.</p>
      {back.length > 0 && <List>{back.map((b) => <BlindRow key={b.id} b={b} done={done} toItem={toItem} out />)}</List>}
      {!back.length && <Card><p className="text-sm text-slate-600">No blind in.</p></Card>}
    </>}
    {item && <ItemSheet d={d} e={item} done={done} onClose={() => setItem(null)} />}
  </>);
}
/** Put back before the startup (owner, 26 Oct): the small parts taken out (orifices, NRVs, control valves, PSVs) —
 *  removed → serviced → installed. The tracked valves and PSVs follow their own steps (tap to open). */
const PB_DOT = { removed: 'bg-status-red', serviced: 'bg-amber-500', installed: 'bg-status-green' } as const;
const PB_CHIP = { removed: ['Removed', 'bg-red-100 text-red-800'], serviced: ['Serviced', 'bg-amber-100 text-amber-900'], installed: ['✓ Installed', 'bg-green-100 text-green-800'] } as const;
function PutBack({ d, done, toItem }: { d: TrackerData; done: Done; toItem: (tag: string) => void }) {
  const rows = putBackRows(d); const manage = useCanManage(), head = useContext(RoleCtx) === 'head';
  const [showDone, setShowDone] = useState(false); const [add, setAdd] = useState(false); const [open, setOpen] = useState<string | null>(null);
  const [tag, setTag] = useState(''); const [kind, setKind] = useState<TrkReturnItem['kind']>('orifice'); const [what, setWhat] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const run = async (f: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await f(); done(msg, undo); } catch (x) { setErr(x); } finally { setBusy(false); } };
  const left = rows.filter((x) => x.status !== 'installed'), fin = rows.filter((x) => x.status === 'installed');
  const row = (x: PutBackRow) => { const it = x.item;
    return <div key={x.key} className="border-b border-slate-100 last:border-b-0"><div className={cx(ROW, 'border-b-0')}>
      <button type="button" onClick={() => (x.fromItem ? toItem(x.tag) : setOpen((o) => (o === x.key ? null : x.key)))} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className={cx('h-2 w-2 shrink-0 rounded-full', PB_DOT[x.status])} /><b className="w-[84px] shrink-0 truncate text-[12px]">{short(x.tag)}</b>
        <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600">{x.fromItem ? `${RETURN_KIND[x.kind]} · ${x.what}` : x.what}</span></button>
      {it && x.status !== 'installed' ? <>
        {x.status === 'removed' && <button type="button" disabled={busy} onClick={() => run(() => setReturnItem(it.id, { status: 'serviced' }), `${x.tag}: serviced.`, () => setReturnItem(it.id, { status: 'removed' }))} className="min-h-8 shrink-0 rounded-lg px-2 text-[11px] font-bold text-brand-700 ring-1 ring-slate-300">Serviced</button>}
        <button type="button" disabled={busy} onClick={() => run(() => setReturnItem(it.id, { status: 'installed' }), `${x.tag}: installed.`, () => setReturnItem(it.id, { status: it.status }))} className="min-h-8 shrink-0 rounded-lg bg-brand-700 px-2.5 text-[12px] font-bold text-white">Installed</button></>
        : <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', PB_CHIP[x.status][1])}>{PB_CHIP[x.status][0]}</span>}
    </div>
    {open === x.key && it && <div className="mx-2.5 mb-1.5 space-y-1 rounded-lg bg-slate-50 p-2 text-[12px] text-slate-600">
      <p>{it.removedAt ? `Removed ${when(it.removedAt)}` : ''}{it.servicedAt ? ` · serviced ${when(it.servicedAt)}` : ''}{it.installedAt ? ` · installed ${when(it.installedAt)}` : ''}{it.source ? ` · ${it.source}` : ''}{it.updatedBy ? ` · ${it.updatedBy}` : ''}</p>
      <div className="flex flex-wrap gap-2">
        {it.status !== 'removed' && <button type="button" disabled={busy} onClick={() => run(() => setReturnItem(it.id, { status: it.status === 'installed' ? 'serviced' : 'removed' }), `${x.tag}: back one step.`, () => setReturnItem(it.id, { status: it.status }))} className="font-semibold text-red-700">↶ Back one step</button>}
        {head && <button type="button" disabled={busy} onClick={() => run(() => setReturnItem(it.id, { archived: true }), `${x.tag}: taken off the list.`, () => setReturnItem(it.id, { archived: false }))} className="font-semibold text-slate-500">Take off the list</button>}
      </div></div>}
    </div>; };
  return <>
    <Sec>Put back · {fin.length}/{rows.length} installed</Sec>
    {left.length > 0 ? <List>{left.map(row)}</List> : <Card><p className="text-sm font-semibold text-green-800">✓ Everything taken out is back in.</p></Card>}
    {fin.length > 0 && <button type="button" onClick={() => setShowDone((x) => !x)} className="mx-1 mb-2 block text-[12px] font-semibold text-status-green">{showDone ? '▾' : '▸'} ✓ Installed ({fin.length})</button>}
    {showDone && <List>{fin.map(row)}</List>}
    {manage && (add ? <Card>
      <div className="flex gap-1.5"><input className="input min-h-9 w-28 text-[13px]" placeholder="Tag" value={tag} onChange={(x) => setTag(x.target.value)} />
        <select aria-label="Kind" value={kind} onChange={(x) => setKind(x.target.value as TrkReturnItem['kind'])} className="min-h-9 flex-1 rounded-lg border-0 bg-white px-2 text-[12px] ring-1 ring-slate-200">{(Object.keys(RETURN_KIND) as TrkReturnItem['kind'][]).map((k) => <option key={k} value={k}>{RETURN_KIND[k]}</option>)}</select></div>
      <input className="input mt-1.5 min-h-9 text-[13px]" placeholder="What (e.g. orifice removed)" value={what} onChange={(x) => setWhat(x.target.value)} />
      <div className="mt-1.5 flex gap-1.5"><button type="button" onClick={() => setAdd(false)} className="min-h-9 flex-1 rounded-lg bg-white text-[13px] font-bold text-slate-700 ring-1 ring-slate-300">Cancel</button>
        <button type="button" disabled={busy || !tag.trim()} onClick={() => run(() => addReturnItem(d.tracker.id, { tag: tag.trim().toUpperCase(), kind, what: what.trim() || null }), `${tag.trim().toUpperCase()}: on the Put back list.`).then(() => { setAdd(false); setTag(''); setWhat(''); })} className="min-h-9 flex-1 rounded-lg bg-brand-700 text-[13px] font-bold text-white disabled:opacity-50">Add</button></div>
    </Card> : <button type="button" onClick={() => setAdd(true)} className="mx-1 mb-2 text-[12px] font-semibold text-brand-700">+ Add a part taken out</button>)}
    {err != null && <ErrorBox error={err} />}
  </>;
}
/** A group of blinds: those not in listed, those in folded (there are many). */
function BlindGroup({ title, n, total, open, closed }: { title: string; n: number; total: number; open: React.ReactNode[]; closed: React.ReactNode[] }) {
  const [show, setShow] = useState(false);
  return <div><Sec>{title} · {n}/{total} in</Sec>
    {open.length > 0 && <List>{open}</List>}
    {closed.length > 0 && <button type="button" onClick={() => setShow((x) => !x)} className="mx-1 mb-2 block text-[12px] font-semibold text-status-green">{show ? '▾' : '▸'} ✓ In ({closed.length})</button>}
    {show && <List>{closed}</List>}
  </div>;
}
/** One blind, one line: in / out (out only from the Return list); a tap on the name shows its items, note and undo. */
function BlindRow({ b, done, toItem, out = false }: { b: TrkPoint; done: Done; toItem: (tag: string) => void; out?: boolean }) {
  const [busy, setBusy] = useState(false); const [more, setMore] = useState(false); const [err, setErr] = useState<unknown>(null);
  const back = { status: b.status, in_at: b.inAt ?? null, out_at: b.outAt ?? null };
  const go = async (patch: Parameters<typeof setPoint>[1], msg: string) => { setBusy(true); setErr(null); try { await setPoint(b.id, patch); done(msg, () => setPoint(b.id, back)); } catch (x) { setErr(x); } finally { setBusy(false); } };
  const at = new Date().toISOString();
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className={cx(ROW, 'border-b-0')}>
        <button type="button" onClick={() => setMore((x) => !x)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <b className="w-[60px] shrink-0 text-[12px]">{b.ref}</b>
          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700">{b.name}{b.remark ? ' · 📝' : ''}</span>
          {b.inAt && b.status !== 'open' && <span className="shrink-0 text-[10px] text-slate-500">{when(b.inAt)}</span>}
        </button>
        {b.status === 'open' ? <button type="button" disabled={busy} onClick={() => go({ status: 'in', in_at: at }, `${b.ref} in.`)} className="min-h-8 shrink-0 rounded-lg bg-brand-700 px-3 text-[12px] font-bold text-white">In</button>
          : b.status === 'in' ? (out ? <button type="button" disabled={busy} onClick={() => go({ status: 'out', out_at: at }, `${b.ref} out (de-blinded).`)} className="min-h-8 shrink-0 rounded-lg px-3 text-[12px] font-bold text-brand-700 ring-1 ring-slate-300">Out</button>
            : <span className="shrink-0 rounded-md bg-green-100 px-1.5 py-0.5 text-[11px] font-bold text-green-800">✓ In</span>)
          : <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">Out</span>}
      </div>
      {more && <div className="mx-2.5 mb-1.5 space-y-1.5 rounded-lg bg-slate-50 p-2 text-[12px]">
        {b.detail && b.detail !== b.name && <p className="text-slate-600">{b.detail}</p>}
        <div className="flex flex-wrap gap-1">{b.items.length ? b.items.map((t) => <button key={t} type="button" onClick={() => toItem(t)} className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-slate-200">{t} ›</button>) : <span className="text-amber-800">No item linked</span>}{b.fo && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{b.fo}</span>}</div>
        <PointNote p={b} done={done} />
        {b.status !== 'open' && <button type="button" disabled={busy} onClick={() => go(b.status === 'out' ? { status: 'in', out_at: null } : { status: 'open', in_at: null }, `${b.ref} back to ${b.status === 'out' ? 'in' : 'not in'}.`)} className="text-[11px] font-semibold text-red-700">↶ Undo {b.status === 'out' ? 'out' : 'in'}</button>}
      </div>}
      {err != null && <ErrorBox error={err} />}
    </div>
  );
}
/** An item's own blind line (bar chart, M & I): In stamps it finished. */
function EqBlindRow({ a, done, toItem }: { a: TrkActivity; done: Done; toItem: (tag: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const back = { actual_start: a.actualStart ?? null, actual_finish: a.actualFinish ?? null, time_reason: 'Undo' };
  const go = async (patch: Parameters<typeof setActivity>[1], msg: string) => { setBusy(true); setErr(null); try { await setActivity(a.id, patch); done(msg, () => setActivity(a.id, back)); } catch (x) { setErr(x); } finally { setBusy(false); } };
  return <div className="border-b border-slate-100 last:border-b-0"><div className={cx(ROW, 'border-b-0')}>
    <button type="button" onClick={() => toItem(a.key)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><b className="w-[84px] shrink-0 truncate text-[12px]">{short(a.key)}</b><span className="min-w-0 flex-1 truncate text-[12px] text-slate-700">{a.activity}</span>
      {a.actualFinish && <span className="shrink-0 text-[10px] text-slate-500">{when(a.actualFinish)}</span>}</button>
    {a.actualFinish ? <button type="button" disabled={busy} onClick={() => go({ actual_start: null, actual_finish: null }, `${a.key}: blind back to not in.`)} title="Undo" className="shrink-0 rounded-md bg-green-100 px-1.5 py-0.5 text-[11px] font-bold text-green-800">✓ In</button>
      : <button type="button" disabled={busy} onClick={() => { const t = new Date().toISOString(); void go({ actual_start: a.actualStart ?? t, actual_finish: t }, `${a.key} blinded.`); }} className="min-h-8 shrink-0 rounded-lg bg-brand-700 px-3 text-[12px] font-bold text-white">In</button>}
  </div>{err != null && <ErrorBox error={err} />}</div>;
}
function PointNote({ p, done }: { p: TrkPoint; done: Done }) {
  const [note, setNote] = useState(p.remark ?? ''); const [busy, setBusy] = useState(false); const was = p.remark ?? null;
  return <div className="flex gap-1.5"><input className="input min-h-8 flex-1 text-[12px]" placeholder="Note" value={note} onChange={(x) => setNote(x.target.value)} />
    <button type="button" disabled={busy || (note.trim() || null) === was} onClick={async () => { setBusy(true); try { await setPoint(p.id, { remark: note.trim() || null }); done(`${p.ref}: note saved.`, () => setPoint(p.id, { remark: was })); } finally { setBusy(false); } }} className="min-h-8 rounded-lg bg-white px-2.5 text-[12px] font-bold text-brand-700 ring-1 ring-slate-300 disabled:opacity-50">Save</button></div>;
}
/** The loop's full sheet (shared with the Section Head mode). */
function LoopOpen({ d, p, now, done, toItem, onClose }: { d: TrackerData; p: TrkPoint; now: number; done: Done; toItem: (tag: string) => void; onClose: () => void }) {
  const role = useContext(RoleCtx), onStep = useContext(StepCtx);
  return <LoopDetail p={p} d={{ ...d, trackerId: d.tracker.id }} isHead={role === 'head'} canEdit canAttach={role !== 'controller'} now={now} onClose={onClose} onItem={(t) => { onClose(); toItem(t); }} onStep={onStep ?? undefined} onDone={done} />;
}
/** One loop on the Loops list: name, its equipment, why it is needed, and Req · N2 · N/R (one tap, Undo; only before
 *  it starts). A tap on the name opens the loop's card (jobs, fill, hold, schematic); a neutralized one, its note. */
function LoopRow({ d, p, now, done, toItem }: { d: TrackerData; p: TrkPoint; now: number; done: Done; toItem: (tag: string) => void }) {
  const manage = useCanManage(); const [open, setOpen] = useState(false); const [sheet, setSheet] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const b = loopBasis(p, d), fin = pointComplete(p), req = p.requirement ?? 'required';
  const why = [b.rtj ? `RTJ ${b.rtj}` : '', b.insp ? 'inspection' : '', b.iats ? `IAT ${b.iats}` : ''].filter(Boolean).join(' · ');
  const set = async (to: 'required' | 'n2' | 'not_required') => { if (to === req || busy) return; setBusy(true); setErr(null);
    const was = { requirement: req, requirement_reason: p.requirementReason ?? null };
    try { await setPoint(p.id, { requirement: to, requirement_reason: to === 'not_required' ? 'Not required' : to === 'n2' ? 'Kept under N2 and handed over' : null });
      done(`${p.ref}: ${to === 'n2' ? 'N2 + hand over' : to === 'not_required' ? 'not required' : 'neutralize'}.`, () => setPoint(p.id, was)); } catch (x) { setErr(x); } finally { setBusy(false); } };
  return <div className="border-b border-slate-100 last:border-b-0">
    <div className="flex items-center gap-2 px-2.5 py-2">
      <button type="button" onClick={() => setOpen((x) => !x)} className="min-w-0 flex-1 text-left">
        <b className="block text-[13px] leading-tight">{p.ref} · {p.name}</b>
        <span className={cx('block text-[11.5px]', b.items.length ? 'text-slate-800' : 'text-slate-400')}>{b.items.length ? b.items.map(short).join(' · ') : 'no equipment linked'}</span>
        <span className={cx('block text-[11px]', why ? 'text-slate-500' : 'font-semibold text-amber-700')}>{why || (p.remark?.trim() ? p.remark : 'no reason recorded')}{fin && !why && !p.remark?.trim() ? ' · add one' : ''}</span>
      </button>
      {fin ? <span className="shrink-0 rounded-md bg-green-100 px-1.5 text-[11px] font-bold text-green-800">✓</span>
        : p.status === 'open' && manage ? <span className="flex shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-300">{([['required', 'Req'], ['n2', 'N2'], ['not_required', 'N/R']] as const).map(([k, l]) =>
            <button key={k} type="button" disabled={busy} aria-pressed={req === k} onClick={() => void set(k)} className={cx('min-h-8 px-2 text-[11.5px] font-bold', k !== 'required' && 'border-l border-slate-300', req === k ? 'bg-brand-700 text-white' : 'bg-white text-slate-600')}>{l}</button>)}</span>
        : <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">{isNR(p) ? nrLabel(p) : p.holdReason ? 'On hold' : neutLabel(p)}</span>}
    </div>
    {err != null && <div className="px-2.5 pb-2"><ErrorBox error={err} /></div>}
    {open && !fin && !isNR(p) && <div className="px-1.5 pb-1.5"><Loop d={d} p={p} now={now} done={done} toItem={toItem} /></div>}
    {open && (fin || isNR(p)) && <div className="space-y-1.5 px-2.5 pb-2">
      {isNR(p) && <p className="text-[12px] text-slate-600">{nrLabel(p)} · {p.requirementReason}{p.requirementBy ? ` · ${p.requirementBy}` : ''}</p>}
      <PointNote p={p} done={done} />
      <button type="button" onClick={() => setSheet(true)} className="text-[12px] font-semibold text-brand-700">Open loop ›</button></div>}
    {sheet && <LoopOpen d={d} p={p} now={now} done={done} toItem={toItem} onClose={() => setSheet(false)} />}
  </div>;
}
function Loop({ d, p, now, done, toItem }: { d: TrackerData; p: TrkPoint; now: number; done: Done; toItem: (tag: string) => void }) {
  const manage = useCanManage(), head = useContext(RoleCtx) === 'head';
  const [sheet, setSheet] = useState(false); const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const jobs = (d.pointSteps ?? []).filter((c) => c.pointId === p.id && c.kind === 'step').map((c) => linkedStep(c, d.activities, d.points ?? []));
  const missing = missingBlinds(p, d.points ?? []);
  const nx = (p.method === 'spray' ? SPRAY : NEXT)[p.status];
  const job = jobs.find((c) => c.startAt && !c.doneAt) ?? jobs.find((c) => !c.startAt && !c.doneAt);
  // the soda ash only after the jobs before it (valve drops, blinds) are done
  const before = p.status === 'open' ? jobs.filter((c) => c.phase === 'before' && !c.doneAt).length : 0;
  // the reactor body spray waits for the catalyst dumping (the same lock as the Section Head's Isolation)
  const waiting = p.status === 'open' ? waitingSteps(p, d.activities) : [];
  const run = async (f: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await f(); done(msg, undo); } catch (x) { setErr(x); } finally { setBusy(false); } };
  // the loop's requirement: Required · Pending decision · N/R (one tap, Undo); N/R only before it starts
  const [holdOpen, setHoldOpen] = useState(false);
  const diagram = <LoopDiagramButton trackerId={d.tracker.id} loop={p} data={{ points: d.points ?? [], steps: d.pointSteps ?? [], lineup: d.lineup ?? [] }} />; const [reqOpen, setReqOpen] = useState(false);
  const req = p.requirement ?? 'required', was = { requirement: req, requirement_reason: p.requirementReason ?? null };
  const setReq = (to: 'required' | 'pending' | 'not_required', why?: string) => run(() => setPoint(p.id, { requirement: to, requirement_reason: to === 'not_required' ? why!.trim() : null }),
    `${p.ref}: ${to === 'not_required' ? 'not required (N/R)' : to === 'pending' ? 'decision pending' : 'required'}.`, () => setPoint(p.id, was));
  const jobTap = (c: TrkPointStep) => {
    const at = new Date().toISOString(), fin = !!c.startAt;
    const la = d.activities.filter((a) => (c.linkActs ?? []).includes(a.id)), lp = (d.points ?? []).filter((x) => (c.linkPoints ?? []).includes(x.id));
    if (la.length) { const before = la.map((a) => ({ id: a.id, s: a.actualStart ?? null, f: a.actualFinish ?? null }));
      return run(async () => { for (const a of la) await setActivity(a.id, fin ? (a.actualFinish ? {} : { actual_finish: at, ...(a.actualStart ? {} : { actual_start: at }) }) : (a.actualStart ? {} : { actual_start: at })); }, `${p.ref}: ${c.text.split(/,|:/)[0]} ${fin ? 'done' : 'started'}.`, async () => { for (const b of before) await setActivity(b.id, { actual_start: b.s, actual_finish: b.f, time_reason: 'Undo' }); }); }
    if (lp.length && fin) return run(async () => { for (const x of lp) if (x.status === 'open') await setPoint(x.id, { status: 'in', in_at: at }); }, `${p.ref}: blinds in.`);
    const back = { start_at: c.startAt ?? null, done_at: c.doneAt ?? null };
    return run(() => setPointStepTime(c.id, fin ? { done_at: at } : { start_at: at }), `${p.ref}: ${c.text.split(/,|:/)[0]} ${fin ? 'done' : 'started'}.`, () => setPointStepTime(c.id, back));
  };
  return (
    <Card>
      <div className="flex items-start justify-between gap-2"><button type="button" onClick={() => setSheet(true)} className="min-w-0 text-left text-[14px] font-bold leading-snug">{p.ref} · {p.name} <span className="font-normal text-brand-600">›</span></button><span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', isNR(p) ? 'bg-slate-100 text-slate-700' : p.status === 'open' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900')}>{isNR(p) ? nrLabel(p) : p.holdReason ? 'On hold' : neutLabel(p)}</span></div>
      {p.holdReason && <p className="text-xs font-semibold text-red-700">⏸ {p.holdReason}</p>}
      {isNR(p) && <p className="text-xs font-semibold text-slate-700">{nrLabel(p)} · {p.requirementReason}{p.requirementBy ? ` · ${p.requirementBy}` : ''}{p.requirementAt ? ` ${when(p.requirementAt)}` : ''}</p>}
      {req === 'pending' && <p className="text-xs font-semibold text-amber-800">Neutralization decision pending</p>}
      {missing.length > 0 && <p className="mt-1 text-xs text-slate-600">Waiting blinds: {missing.join(', ')}</p>}
      {waiting.length > 0 && <p className="mt-1 text-xs text-slate-600">Waiting for: {waiting.join(', ')}</p>}
      <LoopScope p={p} items={[...d.equipment, ...(d.loopItems ?? [])]} rtj={d.rtj ?? []} canEdit={false} onDone={done} compact />
      {jobs.length > 0 && <p className="mt-1 text-xs text-slate-600">Jobs {jobs.filter((c) => c.doneAt).length}/{jobs.length}{job ? ` · next: ${job.crane ? '🏗 ' : ''}${job.text.split(/,|:/)[0]}` : ''}</p>}
      {p.status === 'soaking' && p.soakAt && <p className="mt-1 text-xs text-slate-600">Soaking since {when(p.soakAt)} ({Math.round((now - Date.parse(p.soakAt)) / H)} h)</p>}
      {!isNR(p) && <div className="mt-2 flex gap-1.5">
        {job && <button type="button" disabled={busy} onClick={() => jobTap(job)} className={cx('min-h-9 flex-1 rounded-xl px-2 text-[13px] font-bold', job.startAt ? 'bg-amber-400 text-amber-950' : 'bg-white text-brand-700 ring-1 ring-slate-300')}>{job.startAt ? '✓ Job done' : '▶ Start job'}</button>}
        {nx && !missing.length && !before && !waiting.length && <button type="button" disabled={busy} onClick={() => run(() => setPoint(p.id, { status: nx[0], [nx[2]]: new Date().toISOString() }), `${p.ref}: ${nx[1].replace(/^[▶✓] /, '')}.`, () => setPoint(p.id, { status: p.status, [nx[2]]: null }))} className="min-h-9 flex-1 rounded-xl bg-brand-700 px-2 text-[13px] font-bold text-white">{nx[1]}</button>}
        {nx && head && p.status === 'open' && (missing.length > 0 || before > 0 || waiting.length > 0) && <button type="button" disabled={busy} onClick={() => setForce(true)} className="min-h-9 flex-1 rounded-xl bg-slate-200 px-2 text-[13px] font-bold text-slate-700">🔒 Start anyway</button>}
        <button type="button" disabled={busy} onClick={() => (p.holdReason ? run(() => setPoint(p.id, { hold_reason: null }), `${p.ref}: resumed.`, () => setPoint(p.id, { hold_reason: p.holdReason ?? null })) : setHoldOpen((x) => !x))} className="min-h-9 rounded-xl px-3 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-300">{p.holdReason ? 'Resume' : 'Hold'}</button>
        {diagram}
      </div>}
      {isNR(p) && <div className="mt-1 flex justify-end">{diagram}</div>}
      {force && nx && <div className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-900">Start {p.ref} {missing.length ? `without ${missing.join(', ')}` : waiting.length ? `before ${waiting.join(', ')}` : `before ${before} job${before > 1 ? 's are' : ' is'} finished`}? It is logged as a Section Head override.
        <div className="mt-1.5 flex gap-1.5"><button type="button" disabled={busy} onClick={() => { setForce(false); void run(() => setPoint(p.id, { status: nx[0], [nx[2]]: new Date().toISOString() }), `${p.ref}: ${p.method === 'spray' ? 'spraying' : 'filling'} (override).`, () => setPoint(p.id, { status: p.status, [nx[2]]: null })); }} className="min-h-8 rounded-lg bg-brand-700 px-3 font-bold text-white">Start anyway</button>
          <button type="button" onClick={() => setForce(false)} className="min-h-8 rounded-lg bg-white px-3 font-bold text-slate-700 ring-1 ring-slate-300">Cancel</button></div></div>}
      {sheet && <LoopOpen d={d} p={p} now={now} done={done} toItem={toItem} onClose={() => setSheet(false)} />}
      {holdOpen && !p.holdReason && <div className="mt-2"><PendingForm initial={null} busy={busy} onSave={(r) => { setHoldOpen(false); void run(() => setPoint(p.id, { hold_reason: r }), `${p.ref}: on hold.`, () => setPoint(p.id, { hold_reason: null })); }} /></div>}
      {p.status === 'open' && manage && (!reqOpen ? <button type="button" onClick={() => setReqOpen(true)} className="mt-1 text-[12px] font-semibold text-slate-500">⋯ Requirement{req !== 'required' ? `: ${req === 'pending' ? 'decision pending' : 'not required'}` : ''}</button>
        : <div className="mt-1.5 flex flex-wrap gap-1.5 text-[12px]">
            {req !== 'required' && <button type="button" disabled={busy} onClick={() => setReq('required')} className="min-h-8 rounded-lg bg-white px-2.5 font-bold text-brand-700 ring-1 ring-slate-300">Required</button>}
            {req !== 'pending' && <button type="button" disabled={busy} onClick={() => setReq('pending')} className="min-h-8 rounded-lg bg-white px-2.5 font-bold text-amber-800 ring-1 ring-slate-300">Decision pending</button>}
            {req !== 'not_required' && <button type="button" disabled={busy} onClick={() => setReq('not_required', 'Not required')} className="min-h-8 rounded-lg bg-white px-2.5 font-bold text-slate-700 ring-1 ring-slate-300">Not required</button>}
          </div>)}
      {err != null && <ErrorBox error={err} />}
    </Card>
  );
}

// ── SD scope & Hot work ───────────────────────────────────────────────────────────────────────────────────────────
/** A list of small items (followed by steps, or by stage only); finished = all steps done (or returned). */
const smallItems = (d: TrackerData) => d.equipment.filter((e) => e.tracked && (!!e.list || (isSmallJob(e.group) && !WITH_EQUIP.includes(e.group))) && (lines(d, [keyOf(e)]).length || !e.hoStep));
/** the SD scope heading of a small item: its group, or Rotating scope */
const scopeOf = (e: TrkEquipment) => (e.list === 'rotating' ? ROTATING : e.group);
const finishedOf = (d: TrackerData) => (e: TrkEquipment) => { const ls = lines(d, [keyOf(e)]); return ls.length ? ls.every((a) => a.actualFinish) : e.stage >= STAGE_SHORT.length - 1; };
function Scope({ d, now, done }: P) {
  const [group, setGroup] = useState<string | null>(null);
  const items = smallItems(d).filter((e) => scopeOf(e) !== 'PMRs');
  const stale = useMemo(() => new Map(staleItems(d, now).filter((i) => i.small).map((i) => [i.key, i.ageH])), [d, now]);
  const finished = finishedOf(d);
  const listed = SCOPE.flatMap(([, gs]) => gs), other = [...new Set(items.map(scopeOf))].filter((g) => !listed.includes(g));
  if (group) return <SmallGroup d={d} now={now} items={items.filter((e) => scopeOf(e) === group)} stale={stale} done={done} onBack={() => setGroup(null)} back="SD scope" />;
  return (<>{[...SCOPE, ...(other.length ? [['Other', other] as [string, string[]]] : [])].map(([disc, gs]) => { const groups = gs.filter((g) => items.some((e) => scopeOf(e) === g)); if (!groups.length) return null;
    return <div key={disc}><Sec>{disc}</Sec><List>{groups.map((g) => { const xs = items.filter((e) => scopeOf(e) === g); const n = xs.filter(finished).length; const late = xs.filter((e) => stale.has(keyOf(e))).length;
      const one = xs.length === 1 ? lines(d, [keyOf(xs[0])]) : [];
      return <button key={g} type="button" onClick={() => setGroup(g)} className={cx(ROW, 'py-2')}>
        <span className="min-w-0 flex-1"><b className="block text-[13px]">{g === 'CV shells' ? 'Control valves' : g}</b><span className="block text-[11px] text-slate-500">{one.length ? `${one.filter((a) => a.actualFinish).length}/${one.length} jobs done` : `${xs.length} items${late ? ` · ${late} need an update` : ''}`}</span></span>
        <span className={cx('rounded-md px-1.5 py-0.5 text-[12px] font-bold', n === xs.length ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900')}>{one.length ? `${one.filter((a) => a.actualFinish).length}/${one.length}` : `${n}/${xs.length}`}</span></button>; })}</List></div>; })}</>);
}
/** Hot work, the same page in both modes: the IATs (status and Operations label on the card, a tap opens the full
 *  IAT) and the PMRs. */
export function HotWorkTab({ d, now, done, role, onItem }: { d: TrackerData; now: number; done: Done; role: EngRole; onItem?: (tag: string) => void }) {
  return <RoleCtx.Provider value={role}><OpenItemCtx.Provider value={onItem ?? null}><HotWork d={d} now={now} done={done} go={() => {}} by="" /></OpenItemCtx.Provider></RoleCtx.Provider>;
}
type IatFilter = 'open' | 'items' | 'lines' | 'material' | 'all';
function HotWork({ d, now, done }: P) {
  const [v, setV] = useState<'iat' | 'pmr'>('iat');
  const [lf, setLf] = useState<IatLabel | 'none' | 'all'>('all');
  const [q, setQ] = useState(''); const [f, setF] = useState<IatFilter>('open'); const [showClosed, setShowClosed] = useState(false);
  const [iat, setIat] = useState<TrkIat | null>(null); const [item, setItem] = useState<TrkEquipment | null>(null);
  const manage = useCanManage(), openItem = useContext(OpenItemCtx);
  const toItem = (tag: string) => { setIat(null); if (openItem) return openItem(tag); setItem(d.equipment.find((e) => e.tag === tag) ?? null); };
  const pmrs = smallItems(d).filter((e) => e.group === 'PMRs');
  const stale = useMemo(() => new Map(staleItems(d, now).filter((i) => i.small).map((i) => [i.key, i.ageH])), [d, now]);
  const st = d.iats.map(iatStatus), count = (x: string) => st.filter((y) => y === x).length;
  const pDone = pmrs.filter(finishedOf(d)).length;
  const tags = new Set(d.equipment.map((e) => e.tag));
  const isOpen = (i: TrkIat) => i.status === 'open';
  const pick: Record<IatFilter, (i: TrkIat) => boolean> = { open: isOpen, items: (i) => isOpen(i) && tags.has(i.tag), lines: (i) => isOpen(i) && !tags.has(i.tag), material: (i) => isOpen(i) && !!i.material, all: () => true };
  const match = (i: TrkIat) => (!q || `${i.iatNo} ${i.line ?? ''} ${i.tag} ${i.jobText ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) && (lf === 'all' || (lf === 'none' ? !i.opsLabel : i.opsLabel === lf));
  const shown = d.iats.filter(pick[f]).filter(match), closed = f === 'all' ? [] : d.iats.filter((i) => !isOpen(i)).filter(match);
  return (<>
    <Seg v={v} set={setV} opts={[['iat', `IATs ${d.iats.length}`], ['pmr', `PMRs ${pmrs.length}`]]} />
    {v === 'iat' ? <>
      {d.iats.length > 0 && <p className="mx-1 mb-2 text-[12px] text-slate-600">In progress <b>{count('In progress')}</b> · to start <b>{count('To start') + count('New IAT')}</b> · hold <b>{count('Hold')}</b> · completed <b>{count('Completed')}</b></p>}
      {d.iats.length > 0 && <div className="mb-2 flex gap-1.5"><input className="input min-h-9 min-w-0 flex-1 text-[13px]" placeholder="🔎 IAT no., line, tag…" value={q} onChange={(x) => setQ(x.target.value)} />
        <select aria-label="Show" value={f} onChange={(x) => setF(x.target.value as IatFilter)} className="min-h-9 rounded-lg border-0 bg-white px-2 text-[12px] font-semibold ring-1 ring-slate-200">
          {([['open', 'Open'], ['items', 'On items'], ['lines', 'On lines'], ['material', 'Material'], ['all', 'All']] as const).map(([k, l]) => <option key={k} value={k}>{l} ({d.iats.filter(pick[k]).length})</option>)}</select></div>}
      {d.iats.length > 0 && <div className="-mx-3 mb-2.5 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]">{([['all', `All ${d.iats.length}`], ...IAT_LABELS.map(([k, l]) => [k, `${l} ${d.iats.filter((i) => i.opsLabel === k).length}`]), ['none', `Not set ${d.iats.filter((i) => !i.opsLabel).length}`]] as [IatLabel | 'none' | 'all', string][]).map(([k, l]) =>
        <button key={k} type="button" onClick={() => setLf(k)} className={cx('min-h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-[12px] font-bold', lf === k ? 'bg-brand-700 text-white' : k !== 'all' && k !== 'none' ? LABEL_CLS[k].chip : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{l}</button>)}</div>}
      {!d.iats.length ? <Card><p className="text-sm text-slate-600">No IATs on this shutdown yet.</p></Card>
        : shown.length ? shown.map((i) => <IatCard key={i.id} d={d} i={i} done={done} onOpen={() => setIat(i)} />) : <Card><p className="text-sm text-slate-600">No IAT here.</p></Card>}
      {closed.length > 0 && <button type="button" onClick={() => setShowClosed((x) => !x)} className="mx-1 mb-2 block text-[12px] font-semibold text-status-green">{showClosed ? '▾' : '▸'} ✓ Completed / cancelled ({closed.length})</button>}
      {showClosed && closed.map((i) => <IatCard key={i.id} d={d} i={i} done={done} onOpen={() => setIat(i)} />)}
      {iat && <IatDetail i={d.iats.find((x) => x.id === iat.id) ?? iat} items={tags} lineup={d.lineup ?? []} lineupEq={d.lineupEq ?? []} points={d.points ?? []} canEdit canLabel={manage} onDone={done} onItem={toItem} onClose={() => setIat(null)} />}
      {item && <ItemSheet d={d} e={item} done={done} onClose={() => setItem(null)} />}
    </> : <>
      <p className="mx-1 mb-2 text-[12px] text-slate-600">{pDone}/{pmrs.length} returned · tap one to set its stage, status or an issue</p>
      {pmrs.length ? <SmallGroup d={d} now={now} items={pmrs} stale={stale} done={done} /> : <Card><p className="text-sm text-slate-600">No PMRs on this shutdown.</p></Card>}
    </>}
  </>);
}
/** A small-jobs group: its items with their next step; tick several and finish the next step for all in one tap. One
 *  item with many jobs (the OPR list) is a checklist of its jobs. */
function SmallGroup({ d, now, items, stale, done, onBack, back = 'Back' }: { d: TrackerData; now: number; items: TrkEquipment[]; stale: Map<string, number>; done: Done; onBack?: () => void; back?: string }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<TrkEquipment | null>(null); const openItem = useContext(OpenItemCtx);
  const [grpOpen, setGrpOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const nextOf = (e: TrkEquipment) => { const ls = lines(d, [keyOf(e)]); return ls.find((a) => a.actualStart && !a.actualFinish) ?? ls.find((a) => !a.actualStart) ?? null; };
  const tick = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function finishAll(acts: TrkActivity[], label: string) {
    setBusy(true); setErr(null); const at = new Date().toISOString(), before = acts.map((a) => ({ id: a.id, s: a.actualStart ?? null, f: a.actualFinish ?? null }));
    try { for (const a of acts) await setActivity(a.id, { actual_finish: at, ...(a.actualStart ? {} : { actual_start: at }) }); setSel(new Set()); done(label, async () => { for (const b of before) await setActivity(b.id, { actual_start: b.s, actual_finish: b.f, time_reason: 'Undo' }); }); } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  const one = items.length === 1 && lines(d, [keyOf(items[0])]).length ? items[0] : null;
  if (one) {
    const ls = lines(d, [keyOf(one)]), tap = (a: TrkActivity) => { const at = new Date().toISOString(), back = { actual_start: a.actualStart ?? null, actual_finish: a.actualFinish ?? null };
      void (async () => { try { await setActivity(a.id, a.actualStart ? { actual_finish: a.actualFinish ? null : at } : { actual_start: at }); done(`${a.activity.slice(0, 40)}: ${a.actualStart ? (a.actualFinish ? 'reopened' : 'done') : 'started'}.`, () => setActivity(a.id, back)); } catch (x) { setErr(x); } })(); };
    return (<>
      {onBack && <button type="button" onClick={onBack} className="mb-2 text-sm font-semibold text-brand-500">‹ {back}</button>}
      <p className="mx-1 mb-2 text-[13px] text-slate-600"><b className="text-slate-900">{one.tag}</b> · {ls.filter((a) => a.actualFinish).length}/{ls.length} done · tap the box: ▶ started, again ✓ done</p>
      <List>{ls.map((a) => <button key={a.id} type="button" onClick={() => tap(a)} className={cx(ROW, 'items-start')}>
        <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm font-extrabold', a.actualFinish ? 'bg-status-green text-white' : a.actualStart ? 'bg-amber-400' : 'ring-2 ring-slate-300')}>{a.actualFinish ? '✓' : a.actualStart ? '▶' : ''}</span>
        <span className="min-w-0 flex-1 text-[13px]">{a.activity.replace(/^OPlist-(\d+)\s*/, '$1 · ')}{a.actualStart && !a.actualFinish && <span className="block text-xs text-slate-500">started {when(a.actualStart)}</span>}</span></button>)}</List>
      {err != null && <ErrorBox error={err} />}
    </>);
  }
  const picked = items.filter((e) => sel.has(e.id)).map(nextOf).filter((a): a is TrkActivity => !!a);
  const same = picked.length > 0 && picked.every((a) => a.activity === picked[0].activity);
  // items worked to one step list (CV shells, check valves): the same one-page view as the Equipment list
  const groups = stepGroups(items, d.activities), grp = groups.find((g) => g.label === grpOpen);
  return (<>
    {onBack && <button type="button" onClick={onBack} className="mb-2 text-sm font-semibold text-brand-500">‹ {back}</button>}
    {groups.length > 0 && <List>{groups.map((g) => <BedsRow key={g.label} d={d} set={g} now={now} onOpen={() => setGrpOpen(g.label)} />)}</List>}
    {grp && <BedsPage d={d} set={grp} now={now} done={done} onItem={(e) => { setGrpOpen(null); if (openItem) openItem(e.tag); else setOpen(e); }} onClose={() => setGrpOpen(null)} />}
    <List>{items.map((e) => { const n = nextOf(e), ls = lines(d, [keyOf(e)]);
      return <div key={e.id} className={ROW}>
        {ls.length ? <input type="checkbox" className="h-5 w-5 shrink-0" disabled={!n} checked={sel.has(e.id)} onChange={() => tick(e.id)} /> : null}
        <button type="button" onClick={() => (openItem ? openItem(e.tag) : setOpen(e))} className="flex min-w-0 flex-1 items-center gap-2 text-left"><b className={TAG}>{short(e.tag)}</b><span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-slate-700">{e.description && !ls.length ? `${e.description} · ` : ''}{e.remark?.trim() ? `${e.remark.trim()} · ` : ''}{!ls.length ? STAGE_SHORT[e.stage] : n ? `${n.actualStart ? '▶ ' : 'Next: '}${n.activity}` : '✓ all done'}</span>
          {(() => { const t = lastUpdate(d, [keyOf(e)]); return <span className={cx('block text-[11px]', stale.has(keyOf(e)) ? 'font-bold text-amber-700' : 'text-slate-500')}>{t ? ago(t, now) : 'no update yet'}</span>; })()}</span></button>
        {stale.has(keyOf(e)) ? age(stale.get(keyOf(e))!, 24) : <span className="rounded-md bg-slate-100 px-1.5 text-[11px] font-bold text-slate-600">{ls.length ? `${ls.filter((a) => a.actualFinish).length}/${ls.length}` : STAGE_SHORT[e.stage]}</span>}
      </div>; })}</List>
    {picked.length > 0 && <div className="sticky bottom-20 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-slate-200">
      <p className="text-sm"><b className="text-brand-700">{picked.length} selected</b> <span className="text-slate-500">{items.filter((e) => sel.has(e.id)).map((e) => short(e.tag)).join(', ')}</span></p>
      <button type="button" disabled={busy} onClick={() => finishAll(picked, `${picked.length} items: ${same ? picked[0].activity : 'next step'} done.`)} className="mt-2 min-h-11 w-full rounded-xl bg-amber-400 px-2 text-[13px] font-bold text-amber-950">✓ {same ? picked[0].activity : 'Next step'} done for all {picked.length}</button>
    </div>}
    {err != null && <ErrorBox error={err} />}
    {open && <ItemSheet d={d} e={open} done={done} onClose={() => setOpen(null)} />}
  </>);
}
const IAT_CLS: Record<string, string> = { 'In progress': 'bg-blue-100 text-blue-800', 'To start': 'bg-amber-100 text-amber-800', 'New IAT': 'bg-slate-100 text-slate-700', Hold: 'bg-red-100 text-red-800', Completed: 'bg-green-100 text-green-800', Cancelled: 'bg-slate-100 text-slate-500' };
function IatCard({ d, i, done, onOpen }: { d: TrackerData; i: TrkIat; done: Done; onOpen: () => void }) {
  const st = iatStatus(i); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const was = { sheetStatus: i.sheetStatus ?? null, status: i.status, closedAt: i.closedAt, remark: i.remark ?? null };
  // where it is, from the P&ID lineup: the connection the line is on (from → to, service), or the equipment
  const streams = lineStreams(i.line, d.lineup ?? []), onEq = streams.length ? [] : lineOnEquipment(i.line, d.lineupEq ?? []);
  const item = d.equipment.find((e) => e.tag === i.tag);
  const where = streams.length ? streams.map((x) => `${x.from} → ${x.to}`).join(' · ') : onEq.length ? onEq.map((x) => `On ${x.eq.tag}${x.eq.name ? ` (${x.eq.name.toLowerCase()})` : ''}`).join(' · ') : item ? `${short(item.tag)}${item.description ? ` · ${item.description}` : ''}` : short(i.tag);
  const service = streams[0]?.fluid ?? null;
  const lab = i.opsLabel ?? null; const manage = useCanManage();
  return (
    <Card className={cx(lab && `border-l-[6px] ${LABEL_CLS[lab].edge}`)}>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <p className="flex items-baseline justify-between gap-2"><span className="flex items-center gap-1.5"><b className="text-[14px]">{i.iatNo}</b>{lab && <span className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-bold', LABEL_CLS[lab].chip)}>{IAT_LABELS.find(([k]) => k === lab)![1]}</span>}</span><span className="text-[11px] font-semibold text-brand-500">Details ›</span></p>
        <p className="mt-0.5 text-[13px] font-semibold text-slate-900">📍 {where}</p>
        {service && <p className="text-[12px] text-slate-600">{service}</p>}
        <p className="mt-0.5 text-[12px] text-slate-600">{i.jobText}{i.remark ? <> · <b className="text-slate-800">{i.remark}</b></> : ''}</p>
        {i.line && <p className="text-[11px] text-slate-500">Line {i.line}{i.lineClass ? ` · ${i.lineClass}` : ''}</p>}
      </button>
      {/* status and the operations label: one control each (the same choices as before, Cancelled included) */}
      <div className="mt-2 flex items-center gap-1.5">
        <select aria-label={`Status of IAT ${i.iatNo}`} disabled={busy} value={st} onChange={async (x) => { const to = x.target.value as typeof st; if (to === st) return; setBusy(true); setErr(null); try { await setIatStatus(i.id, to, iatClosedBy(to)); done(`IAT ${i.iatNo}: ${to}.`, () => restoreIat(i.id, was)); } catch (e) { setErr(e); } finally { setBusy(false); } }}
          className={cx('min-h-9 min-w-0 flex-1 rounded-lg border-0 px-2 text-[12px] font-bold ring-1 ring-slate-200', IAT_CLS[st] ?? 'bg-white text-slate-700')}>{IAT_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        {manage && <OpsLabel i={i} canEdit onDone={done} />}
      </div>
      {err != null && <ErrorBox error={err} />}
    </Card>
  );
}
