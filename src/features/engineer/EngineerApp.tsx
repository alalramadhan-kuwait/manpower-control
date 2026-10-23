// The engineer's view of the shutdown tracker: a personal link (hidden key) and an ID, no app login. Four tabs, the
// same live records as the Section Head's tracker: Dashboard (on time or not), Equipment (what needs an update, the
// reactors' issues and temperatures), Isolation (neutralization and blinds), Small jobs & IATs. Every change is
// stamped with the ID; Undo for a few seconds after each one.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { IAT_STATUSES, iatClosedBy, iatStatus, isSmallJob, lineOnEquipment, lineStreams, kwDay, kwTime, linkedStep, missingBlinds, neutLabel, phases, pointComplete, REACTORS, shiftOf, sortActs, staleItems, withReactor,
  type MiItem, type PointStatus, type TrkActivity, type TrkEquipment, type TrkIat, type TrkPoint, type TrkPointStep } from '@/core/tracker';
import { addQtyEntry, confirmEmpty, fetchTrackerData, restoreIat, saveShiftLog, setActivity, setEquipment, setIatStatus, setPoint, setPointStepTime, type TrackerData } from '@/data/tracker';
import { engineerLink, setEngineerLink, supabase } from '@/data/supabase';
import { BottomSheet, ErrorBox, Spinner, cx } from '@/ui/components';
import { EventsCard } from '@/features/tracker/Events';

type Tab = 'dash' | 'equip' | 'iso' | 'small';
type Done = (msg: string, undo?: () => Promise<unknown>) => void;
const TABS: [Tab, string, string][] = [['dash', '📊', 'Dashboard'], ['equip', '🔧', 'Equipment'], ['iso', '🔒', 'Isolation'], ['small', '🧩', 'Small & IATs']];
const H = 36e5;
const short = (t: string) => t.replace(/^([A-Z]{1,3})-12-/, '$1-').replace(/^12-/, '');
const when = (iso: string | number | null | undefined) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '');
const lines = (d: TrackerData, keys: string[]) => sortActs(d.activities.filter((a) => keys.includes(a.key) && a.tracked && !a.detail && a.group !== 'Operations'));
const keyOf = (e: TrkEquipment) => e.barchartKey ?? e.tag;

/** The link page: the key from the link, the ID typed once; then the tracker. */
export default function EngineerApp() {
  const urlKey = new URLSearchParams(window.location.search).get('sd');
  const link = engineerLink();
  const [id, setId] = useState('');
  if (urlKey && (!link || link.key !== urlKey)) {
    const open = () => { if (!id.trim()) return; setEngineerLink({ key: urlKey, id: id.trim() }); window.location.replace(window.location.pathname); };
    return (
      <Frame title="U-12 Shutdown" sub="Progress update">
        <div className="mx-auto max-w-sm px-4 pt-16 text-center">
          <div className="text-5xl">🛠️</div>
          <p className="mt-2 text-xl font-bold text-[#0d2a5e]">Welcome</p>
          <p className="text-sm text-slate-600">Enter your ID to update the shutdown progress</p>
          <input className="input mt-5 text-center text-xl font-bold tracking-wider" autoCapitalize="none" autoCorrect="off" value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && open()} placeholder="Your ID" />
          <button type="button" onClick={open} disabled={!id.trim()} className="mt-3 min-h-12 w-full rounded-2xl bg-[#0d2a5e] text-base font-bold text-white disabled:opacity-50">Open</button>
          <p className="mt-4 text-xs text-slate-500">This link is for you only. Ask the Section Head if it stops working.</p>
        </div>
      </Frame>
    );
  }
  return <Tracker />;
}

function Frame({ title, sub, right, children }: { title: string; sub: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f4f6fa] pb-24">
      <header className="sticky top-0 z-30 flex items-center gap-2 bg-[#0d2a5e] px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] text-white">
        <div className="min-w-0 flex-1"><p className="truncate text-[17px] font-bold">{title}</p><p className="truncate text-xs opacity-80">{sub}</p></div>{right}
      </header>
      {children}
    </div>
  );
}

/** The engineer view for someone signed in to the app (the Section Head trying it, or working from it): their own
 *  login instead of a link, a button back to the full tracker. */
export function EngineerView({ trackerId, name, title, onExit }: { trackerId: string; name: string; title: string; onExit: () => void }) {
  return <Tracker preset={{ login_id: name, tracker_id: trackerId, title }} onExit={onExit} />;
}

function Tracker({ preset, onExit }: { preset?: { login_id: string; tracker_id: string; title: string }; onExit?: () => void } = {}) {
  const [me, setMe] = useState<{ login_id: string; tracker_id: string; title: string } | null | 'off'>(preset ?? null);
  const [data, setData] = useState<TrackerData | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('dash');
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState<{ msg: string; undo?: () => Promise<unknown> } | null>(null);
  const load = useCallback(async (trackerId: string) => { try { setData(await fetchTrackerData(trackerId)); setNow(Date.now()); setErr(null); } catch (e) { setErr(e); } }, []);
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
  useEffect(() => { if (!flash) return; const t = window.setTimeout(() => setFlash(null), 7000); return () => window.clearTimeout(t); }, [flash]);
  if (me === 'off') return (
    <Frame title="U-12 Shutdown" sub="Progress update">
      <div className="mx-auto max-w-sm p-6 text-center"><p className="font-semibold text-[#0d2a5e]">This link is off, or the ID does not match it.</p>
        <p className="mt-2 text-sm text-slate-600">Check your ID, or ask the Section Head for a new link.</p>
        <button type="button" className="mt-5 min-h-11 w-full rounded-xl bg-white font-semibold text-[#0d2a5e] ring-1 ring-slate-300" onClick={() => { const l = engineerLink(); setEngineerLink(null); window.location.replace(`${window.location.pathname}${l ? `?sd=${encodeURIComponent(l.key)}` : ''}`); }}>Type the ID again</button></div>
    </Frame>
  );
  if (err && !data) return <Frame title="U-12 Shutdown" sub="Progress update"><div className="p-4"><ErrorBox error={err} /></div></Frame>;
  if (!me || !data) return <Frame title="U-12 Shutdown" sub="Loading…"><div className="p-10"><Spinner /></div></Frame>;
  const sh = shiftOf(now);
  const done: Done = (msg, undo) => { setFlash({ msg, undo }); void load(me.tracker_id); };
  const props = { d: data, now, done };
  return (
    <Frame title={`Hi ${me.login_id}`} sub={`${kwDay(now)} · ${sh.shift === 'D' ? 'Day' : 'Night'} shift · ${data.tracker.title}`}
      right={<>{onExit && <button type="button" onClick={onExit} className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-[#0d2a5e]">Section Head view</button>}
        <button type="button" aria-label="Refresh" onClick={() => void load(me.tracker_id)} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold">↻</button></>}>
      <main className="mx-auto max-w-xl px-3 pt-3">
        {err != null && <div className="mb-2"><ErrorBox error={err} /></div>}
        {tab === 'dash' && <Dashboard {...props} />}
        {tab === 'equip' && <Equipment {...props} />}
        {tab === 'iso' && <Isolation {...props} />}
        {tab === 'small' && <Small {...props} />}
      </main>
      {flash && <div className="fixed inset-x-3 bottom-24 z-[70] mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-[#0d2a5e] px-4 py-3 text-sm text-white shadow-lg">
        <span className="min-w-0 flex-1">{flash.msg}</span>
        {flash.undo && <button type="button" className="shrink-0 font-bold" onClick={async () => { const u = flash.undo!; setFlash(null); try { await u(); done('Undone.'); } catch (e) { setErr(e); } }}>↶ Undo</button>}
      </div>}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
        {TABS.map(([k, ic, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={cx('flex-1 text-center text-[11px] font-bold', tab === k ? 'text-[#0d2a5e]' : 'text-slate-400')}><span className="block text-xl">{ic}</span>{l}</button>)}
      </nav>
    </Frame>
  );
}

type P = { d: TrackerData; now: number; done: Done };
const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => <section className={cx('mb-2.5 rounded-2xl bg-white p-3 ring-1 ring-slate-200', className)}>{children}</section>;
const Sec = ({ children }: { children: React.ReactNode }) => <p className="mx-1 mb-1.5 mt-3 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">{children}</p>;
const Seg = <T extends string>({ v, set, opts }: { v: T; set: (x: T) => void; opts: [T, string][] }) => (
  <div className="mb-2.5 flex gap-1.5">{opts.map(([k, l]) => <button key={k} type="button" onClick={() => set(k)} className={cx('min-h-9 flex-1 rounded-full px-2 text-[12px] font-bold', v === k ? 'bg-[#0d2a5e] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{l}</button>)}</div>);
const Bar = ({ act, plan, tone }: { act: number; plan: number; tone: string }) => (
  <span className="relative block h-3 flex-1 rounded-full bg-slate-200"><span className={cx('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: `${Math.min(100, act)}%` }} /><span className="absolute -top-1 h-5 w-[3px] rounded bg-slate-900" style={{ left: `${Math.min(100, plan)}%` }} /></span>);
const tone = (act: number, plan: number) => (act >= plan ? 'bg-[#08a048]' : act >= plan - 10 ? 'bg-[#ffc000]' : 'bg-[#e02028]');
const age = (h: number, lim = 12) => <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', h >= lim * 1.5 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900')}>{h} h</span>;

// ── Dashboard ───────────────────────────────────────────────────────────────────────────────────────────────────────
function Dashboard({ d, now }: P) {
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
  const late = w.impactD > 0, cp = w.controlling;
  return (<>
    <Card className={cx('border-l-[6px]', late ? 'border-l-[#e02028]' : (cp?.spareD ?? 9) <= 1 ? 'border-l-[#ffc000]' : 'border-l-[#08a048]')}>
      <p className="text-[11px] font-bold text-slate-500">END DATE</p>
      <p className={cx('text-[28px] font-extrabold leading-tight', late ? 'text-[#e02028]' : 'text-[#0d2a5e]')}>{late ? `Behind ${w.impactD} d` : 'On time'}</p>
      <p className="text-xs text-slate-600">{late ? 'forecast past the plan' : `${cp?.spareD ?? 0} days spare`} · forecast {when(w.estEnd)} · plan {kwDay(w.end)}</p>
      {cp && <p className="mt-1.5 text-xs text-slate-600">Sets the end: <b>{short(cp.tag)}</b>{cp.driving ? ` · ${cp.driving}` : ''}</p>}
    </Card>
    <Card>
      <p className="text-[11px] font-bold text-slate-500">MAIN EQUIPMENT DONE</p>
      <p className="flex items-baseline gap-2"><span className="text-[28px] font-extrabold text-[#0d2a5e]">{w.main.physPct}%</span>
        <span className="text-xs text-slate-600">plan {w.main.planPct}% · <b className={w.main.physPct >= w.main.planPct ? 'text-[#08a048]' : 'text-[#e02028]'}>{w.main.physPct >= w.main.planPct ? 'ahead' : `behind ${w.main.planPct - w.main.physPct} pts`}</b></span></p>
      <div className="flex"><Bar act={w.main.physPct} plan={w.main.planPct} tone={tone(w.main.physPct, w.main.planPct)} /></div>
      <p className="mt-1.5 text-xs text-slate-600">Small jobs {w.small.physPct}% · plan {w.small.planPct}%</p>
    </Card>
    <Card>
      <p className="mb-1 text-[11px] font-bold text-slate-500">BY GROUP · done / plan</p>
      {groups.map((x) => <div key={x.g} className="my-2 flex items-center gap-2 text-[12.5px]"><span className="w-24 font-bold">{x.g}</span><Bar act={x.act} plan={x.plan} tone={tone(x.act, x.plan)} /><span className="w-16 text-right font-semibold text-slate-600">{x.act}% / {x.plan}%</span></div>)}
      <p className="mt-1 text-[11px] text-slate-500">Black line = where the plan is today</p>
    </Card>
    {(d.events ?? []).filter((e) => !e.endedAt).length > 0 && <Card><p className="mb-1 text-[11px] font-bold text-slate-500">OPEN ISSUES</p>{(d.events ?? []).filter((e) => !e.endedAt).map((e) => <p key={e.id} className="text-[13px]">• {e.text} <span className="text-xs text-slate-500">since {when(e.startedAt)}</span></p>)}</Card>}
  </>);
}

// ── Equipment (main) ────────────────────────────────────────────────────────────────────────────────────────────────
function itemLine(d: TrackerData, e: TrkEquipment): string {
  if (e.pendingReason) return `On hold · ${e.pendingReason}`;
  if (e.remark?.trim()) return e.remark.trim();
  const ls = lines(d, [keyOf(e)]); const r = ls.find((a) => a.actualStart && !a.actualFinish), n = ls.find((a) => !a.actualStart);
  return r ? `${r.activity} I/P` : n ? `Next: ${n.activity}` : ls.length ? 'All steps done' : '—';
}
/** When the item was last updated: its steps, its remark / hold, its drums. */
function lastUpdate(d: TrackerData, keys: string[]): number | null {
  const scopes = (d.engine?.scopes ?? []).filter((s) => keys.includes(s.key)).map((s) => s.id);
  const ts = [...d.activities.filter((a) => keys.includes(a.key) && a.tracked && !a.detail).flatMap((a) => [a.actualStart, a.actualFinish, a.updatedAt]),
    ...d.equipment.filter((x) => keys.includes(keyOf(x))).map((x) => x.updatedAt), ...(d.engine?.entries ?? []).filter((x) => scopes.includes(x.scopeId)).map((x) => x.enteredAt)]
    .filter((x): x is string => !!x).map((x) => Date.parse(x)).filter((x) => !Number.isNaN(x));
  return ts.length ? Math.max(...ts) : null;
}
const ago = (t: number, now: number) => { const h = Math.round((now - t) / H); return h < 1 ? 'just now' : h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };
/** Against the bar chart: the item's forecast finish vs its P6 finish (+ ahead, − behind), done vs plan. */
function VsPlan({ mi }: { mi?: MiItem }) {
  if (!mi) return null;
  const v = mi.svD, done = mi.done >= mi.lines;
  return (
    <span className="shrink-0 text-right">
      <span className={cx('block rounded-md px-1.5 py-0.5 text-[11px] font-bold', done ? 'bg-green-100 text-green-800' : v >= 0.5 ? 'bg-green-100 text-green-800' : v > -0.5 ? 'bg-slate-100 text-slate-700' : 'bg-red-100 text-red-800')}>
        {done ? '✓ done' : v >= 0.5 ? `${v} d ahead` : v > -0.5 ? 'on plan' : `${-v} d behind`}</span>
      <span className="mt-0.5 block text-[10.5px] text-slate-500">{mi.physPct}% / plan {mi.planPct}%</span>
    </span>
  );
}
function ItemRow({ d, e, now, ageH, mi, onOpen }: { d: TrackerData; e: TrkEquipment; now: number; ageH?: number; mi?: MiItem; onOpen: () => void }) {
  const keys = e.combine ? d.equipment.filter((x) => x.combine === e.combine).map(keyOf) : [keyOf(e)];
  const t = lastUpdate(d, keys);
  return (
    <button type="button" onClick={onOpen} className="mb-2 flex w-full items-center gap-2.5 rounded-2xl bg-white px-3 py-2.5 text-left ring-1 ring-slate-200 active:bg-slate-50">
      <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', e.pendingReason ? 'bg-[#e02028]' : mi && mi.done >= mi.lines ? 'bg-[#08a048]' : 'bg-[#ffc000]')} />
      <span className="min-w-0 flex-1"><b className="block text-[14px]">{short(e.combine ?? e.tag)}</b><span className="block truncate text-[12px] text-slate-600">{itemLine(d, e)}</span>
        <span className={cx('block text-[11px]', ageH !== undefined ? 'font-bold text-amber-700' : 'text-slate-500')}>{t ? `Updated ${when(t)} · ${ago(t, now)}` : 'No update yet'}</span></span>
      <VsPlan mi={mi} />
    </button>
  );
}
function Equipment({ d, now, done }: P) {
  const [v, setV] = useState<'todo' | 'all'>('todo');
  const [open, setOpen] = useState<TrkEquipment | null>(null);
  const stale = useMemo(() => new Map(staleItems(d, now).filter((i) => !i.small).map((i) => [i.key, i.ageH])), [d, now]);
  const mi = useMemo(() => new Map((phases(d, now).mi.weighted?.items ?? []).map((i) => [i.key, i])), [d, now]);
  const main = d.equipment.filter((e) => e.tracked && !isSmallJob(e.group) && lines(d, [keyOf(e)]).length && (!e.combine || d.equipment.find((x) => x.combine === e.combine) === e));
  const shown = v === 'todo' ? main.filter((e) => stale.has(keyOf(e))) : main;
  const groups = [...new Set(shown.map((e) => e.group))];
  return (<>
    <Seg v={v} set={setV} opts={[['todo', `To update (${stale.size})`], ['all', `All (${main.length})`]]} />
    {(v === 'all' || groups.includes('Reactors')) && <Reactors d={d} now={now} done={done} />}
    {groups.map((g) => <div key={g}><Sec>{g}</Sec>{shown.filter((e) => e.group === g).map((e) => <ItemRow key={e.id} d={d} e={e} now={now} ageH={stale.get(keyOf(e))} mi={mi.get(keyOf(e))} onOpen={() => setOpen(e)} />)}</div>)}
    {!shown.length && <Card><p className="text-sm font-semibold text-green-800">✓ Everything has a recent update.</p></Card>}
    {open && <ItemSheet d={d} e={open} done={done} onClose={() => setOpen(null)} />}
  </>);
}

/** Reactor issues (nitrogen, temperature …) and this shift's max bed temperatures. */
function Reactors({ d, now, done }: P) {
  const sh = shiftOf(now);
  const saved = d.shiftLogs.find((l) => l.shiftDate === sh.date && l.shift === sh.shift);
  const [temps, setTemps] = useState<Record<string, string>>(saved?.temps ?? {});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  return (<>
    <EventsCard events={d.events ?? []} trackerId={d.tracker.id} canEdit now={now} onDone={(m, u) => done(m, u)} />
    <Card className="mt-2.5">
      <p className="text-[13px] font-bold">Max bed temperature °F <span className="font-normal text-slate-500">· this shift</span></p>
      <div className="mt-2 grid grid-cols-5 gap-1.5">{REACTORS.map((k) => <label key={k} className="text-center text-[11px] font-bold text-slate-500">{k.replace('R', 'R-')}
        <input inputMode="decimal" className="input mt-0.5 px-1 text-center text-sm" value={temps[k] ?? ''} onChange={(e) => setTemps((t) => ({ ...t, [k]: e.target.value.replace(/[^\d.]/g, '') }))} /></label>)}</div>
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await saveShiftLog(d.tracker.id, sh.date, sh.shift, { notes: saved?.notes ?? '', temps }); done('Temperatures saved.'); } catch (e) { setErr(e); } finally { setBusy(false); } }}
        className="mt-2 min-h-10 w-full rounded-xl bg-[#08a048] text-[14px] font-bold text-white disabled:opacity-60">Save temperatures</button>
      {err != null && <ErrorBox error={err} />}
    </Card>
  </>);
}

const HOLDS: [string, string | null][] = [['In progress', null], ['Waiting gas test', 'Waiting permit / gas test'], ['Waiting crane', 'Waiting crane / equipment'], ['Waiting material', 'Waiting material'], ['Waiting manpower', 'Waiting manpower'], ['Stopped', 'Other']];
/** One item: finish the running step / start the next, its status and a short note; drums for a reactor dumping. */
function ItemSheet({ d, e, done, onClose }: { d: TrackerData; e: TrkEquipment; done: Done; onClose: () => void }) {
  const keys = e.combine ? d.equipment.filter((x) => x.combine === e.combine).map(keyOf) : [keyOf(e)];
  const ls = lines(d, keys); const run = ls.filter((a) => a.actualStart && !a.actualFinish); const next = ls.find((a) => !a.actualStart);
  const [hold, setHold] = useState<string | null | undefined>(undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const scope = (d.engine?.scopes ?? []).find((s) => keys.includes(s.key) && s.scope === 'removal' && !s.completeAt);
  const entries = scope ? (d.engine?.entries ?? []).filter((x) => x.scopeId === scope.id && x.kind !== 'transfer') : [];
  const total = entries.reduce((t, x) => t + x.qty, 0);
  const [drums, setDrums] = useState('');
  const twins = keys.map((k) => d.equipment.find((x) => keyOf(x) === k)!).filter(Boolean);
  async function run1(f: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>) { setBusy(true); setErr(null); try { await f(); done(msg, undo); onClose(); } catch (x) { setErr(x); } finally { setBusy(false); } }
  const step = (a: TrkActivity, finish: boolean) => {
    const at = new Date().toISOString(), back = { actual_start: a.actualStart ?? null, actual_finish: a.actualFinish ?? null };
    return run1(() => setActivity(a.id, finish ? { actual_finish: at, ...(a.actualStart ? {} : { actual_start: at }) } : { actual_start: at }), `${short(e.tag)}: ${a.activity} ${finish ? 'finished' : 'started'}.`, () => setActivity(a.id, back));
  };
  const save = () => run1(async () => {
    for (const t of twins) await setEquipment(t.id, { ...(hold !== undefined ? { pending_reason: hold } : {}), ...(note.trim() ? { remark: note.trim() } : {}) });
    if (scope && drums.trim() && Number(drums) !== total) {
      const sh = shiftOf(Date.now()), method = [...entries].reverse().find((x) => x.kind === 'removal')?.method ?? 'free_fall';
      const mine = entries.find((x) => x.kind === 'removal' && x.shiftDate === sh.date && x.shift === sh.shift && x.method === method);
      await addQtyEntry(scope.id, { shiftDate: sh.date, shift: sh.shift, kind: mine ? 'correction' : 'removal', method, qty: Number(drums) - total, corrects: mine?.id ?? null, remark: 'Engineer update (total)' });
    }
  }, `${short(e.tag)} saved.`, async () => { for (const t of twins) await setEquipment(t.id, { pending_reason: t.pendingReason, remark: t.remark }); });
  return (
    <BottomSheet open onClose={onClose} title={short(e.tag)}>
      <div className="space-y-2.5">
        <p className="text-xs text-slate-600">Last: {e.pendingReason ? `On hold · ${e.pendingReason}` : e.remark?.trim() || (() => { const f = [...ls].filter((a) => a.actualFinish).sort((a, b) => Date.parse(b.actualFinish!) - Date.parse(a.actualFinish!))[0]; return f ? `${f.activity} done` : 'nothing recorded yet'; })()}{e.updatedAt ? ` · ${when(e.updatedAt)}` : ''}</p>
        {run.map((a) => <button key={a.id} type="button" disabled={busy} onClick={() => step(a, true)} className="w-full rounded-xl bg-[#ffc000] px-3 py-2 text-left text-[#3b2a00]"><span className="block text-[11px] font-bold uppercase tracking-wide opacity-80">✓ Finish</span><span className="line-clamp-2 text-[13.5px] font-semibold leading-snug">{a.activity}</span></button>)}
        {next && <button type="button" disabled={busy} onClick={() => step(next, false)} className="w-full rounded-xl bg-[#0d2a5e] px-3 py-2 text-left text-white"><span className="block text-[11px] font-bold uppercase tracking-wide opacity-80">▶ Start</span><span className="line-clamp-2 text-[13.5px] font-semibold leading-snug">{next.activity}</span></button>}
        {!run.length && !next && <p className="rounded-xl bg-green-50 p-2 text-sm font-semibold text-green-800">✓ All steps done</p>}
        {scope && <div className="rounded-2xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
          <p className="text-xs font-bold text-slate-500">TOTAL DRUMS NOW <span className="font-normal">· so far {total.toLocaleString('en-US')}</span></p>
          <div className="mt-1 flex gap-2"><input inputMode="numeric" className="input text-center text-lg font-extrabold" placeholder={String(total)} value={drums} onChange={(x) => setDrums(x.target.value.replace(/\D/g, ''))} /></div>
          {drums && Number(drums) > total && <p className="mt-1 text-xs text-slate-600">= {Number(drums) - total} drums since the last entry</p>}
          <button type="button" disabled={busy} onClick={() => run1(() => confirmEmpty(scope.id), `${short(e.tag)}: reactor empty.`)} className="mt-2 min-h-10 w-full rounded-xl bg-white text-sm font-bold text-[#08a048] ring-1 ring-green-300">Reactor empty ✓</button>
        </div>}
        <p className="pt-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Status</p>
        <div className="flex flex-wrap gap-1.5">{HOLDS.map(([l, r]) => { const on = hold === undefined ? (r === null ? !e.pendingReason : e.pendingReason === r) : hold === r;
          return <button key={l} type="button" onClick={() => setHold(r)} className={cx('min-h-8 rounded-full px-2.5 text-[12px] font-semibold', on ? 'bg-[#0d2a5e] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300')}>{l}</button>; })}</div>
        <input className="input text-[14px]" placeholder="Short note (optional)" value={note} onChange={(x) => setNote(x.target.value)} />
        <button type="button" disabled={busy || (hold === undefined && !note.trim() && !drums.trim())} onClick={save} className="min-h-11 w-full rounded-xl bg-[#08a048] text-[15px] font-bold text-white disabled:opacity-50">Save</button>
        {err != null && <ErrorBox error={err} />}
      </div>
    </BottomSheet>
  );
}

// ── Isolation ───────────────────────────────────────────────────────────────────────────────────────────────────────
const NEXT: Partial<Record<PointStatus, [PointStatus, string, 'fill_at' | 'soak_at' | 'drain_at' | 'done_at']>> = { open: ['filling', '▶ Fill', 'fill_at'], filling: ['soaking', '▶ Soak', 'soak_at'], soaking: ['draining', '▶ Drain', 'drain_at'], draining: ['done', '✓ Neutralized', 'done_at'] };
const SPRAY: Partial<Record<PointStatus, [PointStatus, string, 'fill_at' | 'done_at']>> = { open: ['filling', '▶ Spray', 'fill_at'], filling: ['done', '✓ Done', 'done_at'] };
function Isolation({ d, now, done }: P) {
  const [v, setV] = useState<'neut' | 'blind'>('neut');
  const pts = d.points ?? [];
  const loops = pts.filter((p) => p.kind === 'neut' && !withReactor(p) && (p.stepId || (!p.items.includes(p.ref) && (p.method !== 'spray' || p.status !== 'open'))));
  const blinds = pts.filter((p) => p.kind === 'blind');
  const openL = loops.filter((p) => !pointComplete(p)), openB = blinds.filter((p) => !pointComplete(p));
  return (<>
    <Seg v={v} set={setV} opts={[['neut', `Neutralization (${openL.length})`], ['blind', `Blinds (${openB.length})`]]} />
    {v === 'neut' ? <>
      {openL.map((p) => <Loop key={p.id} d={d} p={p} now={now} done={done} />)}
      {!openL.length && <Card><p className="text-sm font-semibold text-green-800">✓ All loops neutralized.</p></Card>}
      <Sec>Done</Sec>{loops.filter(pointComplete).map((p) => <div key={p.id} className="mb-2 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200"><span className="min-w-0 flex-1 text-[13px]"><b>{p.ref} · {p.name}</b><span className="block text-xs text-slate-500">Neutralized {when(p.doneAt)}</span></span><span className="rounded-md bg-green-100 px-1.5 text-[11px] font-bold text-green-800">✓</span></div>)}
    </> : <>
      {(['segregation', 'hp_critical'] as const).map((g) => { const xs = blinds.filter((b) => (g === 'hp_critical') === (b.grp === 'hp_critical')); if (!xs.length) return null;
        return <div key={g}><Sec>{g === 'hp_critical' ? 'HP critical loop' : 'Segregation'} · {xs.filter(pointComplete).length}/{xs.length} in</Sec>
          {[...xs].sort((a, b) => Number(pointComplete(a)) - Number(pointComplete(b))).map((b) => <BlindRow key={b.id} b={b} done={done} />)}</div>; })}
    </>}
  </>);
}
function BlindRow({ b, done }: { b: TrkPoint; done: Done }) {
  const [busy, setBusy] = useState(false);
  const back = { status: b.status, in_at: b.inAt ?? null, out_at: b.outAt ?? null };
  const go = async (patch: Parameters<typeof setPoint>[1], msg: string) => { setBusy(true); try { await setPoint(b.id, patch); done(msg, () => setPoint(b.id, back)); } finally { setBusy(false); } };
  const at = new Date().toISOString();
  return (
    <div className="mb-2 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
      <span className="min-w-0 flex-1"><b className="text-[14px]">{b.ref}</b><span className="block text-[12.5px] text-slate-600">{b.name}{b.inAt ? ` · in ${when(b.inAt)}` : ''}</span></span>
      {b.status === 'open' ? <button type="button" disabled={busy} onClick={() => go({ status: 'in', in_at: at }, `${b.ref} in.`)} className="min-h-8 rounded-lg bg-[#0d2a5e] px-3 text-[12.5px] font-bold text-white">✓ In</button>
        : b.status === 'in' ? <><span className="rounded-md bg-green-100 px-1.5 py-0.5 text-[11px] font-bold text-green-800">✓ In</span><button type="button" disabled={busy} onClick={() => go({ status: 'out', out_at: at }, `${b.ref} out (de-blinded).`)} className="min-h-9 rounded-xl px-2 text-xs font-semibold text-slate-600 ring-1 ring-slate-300">Out</button></>
        : <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">Out</span>}
    </div>
  );
}
function Loop({ d, p, now, done }: { d: TrackerData; p: TrkPoint; now: number; done: Done }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const jobs = (d.pointSteps ?? []).filter((c) => c.pointId === p.id && c.kind === 'step').map((c) => linkedStep(c, d.activities, d.points ?? []));
  const missing = missingBlinds(p, d.points ?? []);
  const nx = (p.method === 'spray' ? SPRAY : NEXT)[p.status];
  const job = jobs.find((c) => c.startAt && !c.doneAt) ?? jobs.find((c) => !c.startAt && !c.doneAt);
  // the soda ash only after the jobs before it (valve drops, blinds) are done
  const before = p.status === 'open' ? jobs.filter((c) => c.phase === 'before' && !c.doneAt).length : 0;
  const run = async (f: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await f(); done(msg, undo); } catch (x) { setErr(x); } finally { setBusy(false); } };
  const jobTap = (c: TrkPointStep) => {
    const at = new Date().toISOString(), fin = !!c.startAt;
    const la = d.activities.filter((a) => (c.linkActs ?? []).includes(a.id)), lp = (d.points ?? []).filter((x) => (c.linkPoints ?? []).includes(x.id));
    if (la.length) { const before = la.map((a) => ({ id: a.id, s: a.actualStart ?? null, f: a.actualFinish ?? null }));
      return run(async () => { for (const a of la) await setActivity(a.id, fin ? (a.actualFinish ? {} : { actual_finish: at, ...(a.actualStart ? {} : { actual_start: at }) }) : (a.actualStart ? {} : { actual_start: at })); }, `${p.ref}: ${c.text.split(/,|:/)[0]} ${fin ? 'done' : 'started'}.`, async () => { for (const b of before) await setActivity(b.id, { actual_start: b.s, actual_finish: b.f }); }); }
    if (lp.length && fin) return run(async () => { for (const x of lp) if (x.status === 'open') await setPoint(x.id, { status: 'in', in_at: at }); }, `${p.ref}: blinds in.`);
    const back = { start_at: c.startAt ?? null, done_at: c.doneAt ?? null };
    return run(() => setPointStepTime(c.id, fin ? { done_at: at } : { start_at: at }), `${p.ref}: ${c.text.split(/,|:/)[0]} ${fin ? 'done' : 'started'}.`, () => setPointStepTime(c.id, back));
  };
  return (
    <Card>
      <div className="flex items-start justify-between gap-2"><b className="text-[14px] leading-snug">{p.ref} · {p.name}</b><span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', p.status === 'open' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900')}>{p.holdReason ? 'On hold' : neutLabel(p)}</span></div>
      {p.holdReason && <p className="text-xs font-semibold text-red-700">⏸ {p.holdReason}</p>}
      {missing.length > 0 && <p className="mt-1 text-xs text-slate-600">Waiting blinds: {missing.join(', ')}</p>}
      {jobs.length > 0 && <p className="mt-1 text-xs text-slate-600">Jobs {jobs.filter((c) => c.doneAt).length}/{jobs.length}{job ? ` · next: ${job.crane ? '🏗 ' : ''}${job.text.split(/,|:/)[0]}` : ''}</p>}
      {p.status === 'soaking' && p.soakAt && <p className="mt-1 text-xs text-slate-600">Soaking since {when(p.soakAt)} ({Math.round((now - Date.parse(p.soakAt)) / H)} h)</p>}
      <div className="mt-2 flex gap-1.5">
        {job && <button type="button" disabled={busy} onClick={() => jobTap(job)} className={cx('min-h-9 flex-1 rounded-xl px-2 text-[12.5px] font-bold', job.startAt ? 'bg-[#ffc000] text-[#3b2a00]' : 'bg-white text-[#0d2a5e] ring-1 ring-slate-300')}>{job.startAt ? '✓ Job done' : '▶ Start job'}</button>}
        {nx && !missing.length && !before && <button type="button" disabled={busy} onClick={() => run(() => setPoint(p.id, { status: nx[0], [nx[2]]: new Date().toISOString() }), `${p.ref}: ${nx[1].replace(/^[▶✓] /, '')}.`, () => setPoint(p.id, { status: p.status, [nx[2]]: null }))} className="min-h-9 flex-1 rounded-xl bg-[#0d2a5e] px-2 text-[12.5px] font-bold text-white">{nx[1]}</button>}
        <button type="button" disabled={busy} onClick={() => run(() => setPoint(p.id, { hold_reason: p.holdReason ? null : 'Waiting (engineer)' }), `${p.ref}: ${p.holdReason ? 'resumed' : 'on hold'}.`, () => setPoint(p.id, { hold_reason: p.holdReason ?? null }))} className="min-h-9 rounded-xl px-3 text-[12.5px] font-semibold text-slate-700 ring-1 ring-slate-300">{p.holdReason ? 'Resume' : 'Hold'}</button>
      </div>
      {err != null && <ErrorBox error={err} />}
    </Card>
  );
}

// ── Small jobs & IATs ───────────────────────────────────────────────────────────────────────────────────────────────
function Small({ d, now, done }: P) {
  const [v, setV] = useState<'small' | 'iat'>('small');
  const [group, setGroup] = useState<string | null>(null);
  const items = d.equipment.filter((e) => e.tracked && isSmallJob(e.group) && lines(d, [keyOf(e)]).length);
  const groups = [...new Set(items.map((e) => e.group))];
  const stale = useMemo(() => new Map(staleItems(d, now).filter((i) => i.small).map((i) => [i.key, i.ageH])), [d, now]);
  const finished = (e: TrkEquipment) => lines(d, [keyOf(e)]).every((a) => a.actualFinish);
  return (<>
    <Seg v={v} set={setV} opts={[['small', 'Small jobs'], ['iat', `IATs (${d.iats.length})`]]} />
    {v === 'iat' ? (d.iats.length ? d.iats.map((i) => <IatCard key={i.id} d={d} i={i} done={done} />) : <Card><p className="text-sm text-slate-600">No IATs on this shutdown yet.</p></Card>) : group ? <SmallGroup d={d} now={now} items={items.filter((e) => e.group === group)} stale={stale} done={done} onBack={() => setGroup(null)} />
      : groups.map((g) => { const xs = items.filter((e) => e.group === g); const n = xs.filter(finished).length; const late = xs.filter((e) => stale.has(keyOf(e))).length;
        const sub = xs.length === 1 ? `${lines(d, [keyOf(xs[0])]).filter((a) => a.actualFinish).length}/${lines(d, [keyOf(xs[0])]).length} jobs done` : `${xs.length} items${late ? ` · ${late} need an update` : ''}`;
        return <button key={g} type="button" onClick={() => setGroup(g)} className="mb-2 flex w-full items-center gap-2 rounded-2xl bg-white px-3 py-3 text-left ring-1 ring-slate-200 active:bg-slate-50">
          <span className="min-w-0 flex-1"><b className="block text-[14px]">{g === 'CV shells' ? 'Control valves' : g}</b><span className="text-[12.5px] text-slate-600">{sub}</span></span>
          <span className={cx('rounded-md px-1.5 py-0.5 text-[12px] font-bold', n === xs.length ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900')}>{xs.length === 1 ? `${lines(d, [keyOf(xs[0])]).filter((a) => a.actualFinish).length}/${lines(d, [keyOf(xs[0])]).length}` : `${n}/${xs.length}`}</span></button>; })}
  </>);
}
/** A small-jobs group: its items with their next step; tick several and finish the next step for all in one tap. One
 *  item with many jobs (the OPR list) is a checklist of its jobs. */
function SmallGroup({ d, now, items, stale, done, onBack }: { d: TrackerData; now: number; items: TrkEquipment[]; stale: Map<string, number>; done: Done; onBack: () => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<TrkEquipment | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const nextOf = (e: TrkEquipment) => { const ls = lines(d, [keyOf(e)]); return ls.find((a) => a.actualStart && !a.actualFinish) ?? ls.find((a) => !a.actualStart) ?? null; };
  const tick = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function finishAll(acts: TrkActivity[], label: string) {
    setBusy(true); setErr(null); const at = new Date().toISOString(), before = acts.map((a) => ({ id: a.id, s: a.actualStart ?? null, f: a.actualFinish ?? null }));
    try { for (const a of acts) await setActivity(a.id, { actual_finish: at, ...(a.actualStart ? {} : { actual_start: at }) }); setSel(new Set()); done(label, async () => { for (const b of before) await setActivity(b.id, { actual_start: b.s, actual_finish: b.f }); }); } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  const one = items.length === 1 ? items[0] : null;
  if (one) {
    const ls = lines(d, [keyOf(one)]), tap = (a: TrkActivity) => { const at = new Date().toISOString(), back = { actual_start: a.actualStart ?? null, actual_finish: a.actualFinish ?? null };
      void (async () => { try { await setActivity(a.id, a.actualStart ? { actual_finish: a.actualFinish ? null : at } : { actual_start: at }); done(`${a.activity.slice(0, 40)}: ${a.actualStart ? (a.actualFinish ? 'reopened' : 'done') : 'started'}.`, () => setActivity(a.id, back)); } catch (x) { setErr(x); } })(); };
    return (<>
      <button type="button" onClick={onBack} className="mb-2 text-sm font-semibold text-[#0850A0]">‹ Small jobs</button>
      <p className="mx-1 mb-2 text-[13px] text-slate-600"><b className="text-slate-900">{one.tag}</b> · {ls.filter((a) => a.actualFinish).length}/{ls.length} done · tap the box: ▶ started, again ✓ done</p>
      {ls.map((a) => <button key={a.id} type="button" onClick={() => tap(a)} className="mb-2 flex w-full items-start gap-2.5 rounded-2xl bg-white px-3 py-2.5 text-left ring-1 ring-slate-200">
        <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm font-extrabold', a.actualFinish ? 'bg-[#08a048] text-white' : a.actualStart ? 'bg-[#ffc000]' : 'ring-2 ring-slate-300')}>{a.actualFinish ? '✓' : a.actualStart ? '▶' : ''}</span>
        <span className="min-w-0 flex-1 text-[13px]">{a.activity.replace(/^OPlist-(\d+)\s*/, '$1 · ')}{a.actualStart && !a.actualFinish && <span className="block text-xs text-slate-500">started {when(a.actualStart)}</span>}</span></button>)}
      {err != null && <ErrorBox error={err} />}
    </>);
  }
  const picked = items.filter((e) => sel.has(e.id)).map(nextOf).filter((a): a is TrkActivity => !!a);
  const same = picked.length > 0 && picked.every((a) => a.activity === picked[0].activity);
  return (<>
    <button type="button" onClick={onBack} className="mb-2 text-sm font-semibold text-[#0850A0]">‹ Small jobs</button>
    {items.map((e) => { const n = nextOf(e), ls = lines(d, [keyOf(e)]);
      return <div key={e.id} className="mb-2 flex items-center gap-2.5 rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
        <input type="checkbox" className="h-5 w-5 shrink-0" disabled={!n} checked={sel.has(e.id)} onChange={() => tick(e.id)} />
        <button type="button" onClick={() => setOpen(e)} className="min-w-0 flex-1 text-left"><b className="block text-[14px]">{short(e.tag)}</b>
          <span className="block truncate text-[12.5px] text-slate-600">{e.remark?.trim() ? `${e.remark.trim()} · ` : ''}{n ? `${n.actualStart ? '▶ ' : 'Next: '}${n.activity}` : '✓ all done'}</span>
          {(() => { const t = lastUpdate(d, [keyOf(e)]); return <span className={cx('block text-[11px]', stale.has(keyOf(e)) ? 'font-bold text-amber-700' : 'text-slate-500')}>{t ? `Updated ${when(t)} · ${ago(t, now)}` : 'No update yet'}</span>; })()}</button>
        {stale.has(keyOf(e)) ? age(stale.get(keyOf(e))!, 24) : <span className="rounded-md bg-slate-100 px-1.5 text-[11px] font-bold text-slate-600">{ls.filter((a) => a.actualFinish).length}/{ls.length}</span>}
      </div>; })}
    {picked.length > 0 && <div className="sticky bottom-20 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-slate-200">
      <p className="text-sm"><b className="text-[#0d2a5e]">{picked.length} selected</b> <span className="text-slate-500">{items.filter((e) => sel.has(e.id)).map((e) => short(e.tag)).join(', ')}</span></p>
      <button type="button" disabled={busy} onClick={() => finishAll(picked, `${picked.length} items: ${same ? picked[0].activity : 'next step'} done.`)} className="mt-2 min-h-11 w-full rounded-xl bg-[#ffc000] px-2 text-[13.5px] font-bold text-[#3b2a00]">✓ {same ? picked[0].activity : 'Next step'} done for all {picked.length}</button>
    </div>}
    {err != null && <ErrorBox error={err} />}
    {open && <ItemSheet d={d} e={open} done={done} onClose={() => setOpen(null)} />}
  </>);
}
const IAT_CLS: Record<string, string> = { 'In progress': 'bg-blue-100 text-blue-800', 'To start': 'bg-amber-100 text-amber-800', 'New IAT': 'bg-slate-100 text-slate-700', Hold: 'bg-red-100 text-red-800', Completed: 'bg-green-100 text-green-800', Cancelled: 'bg-slate-100 text-slate-500' };
function IatCard({ d, i, done }: { d: TrackerData; i: TrkIat; done: Done }) {
  const st = iatStatus(i); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [more, setMore] = useState(false);
  const was = { sheetStatus: i.sheetStatus ?? null, status: i.status, closedAt: i.closedAt, remark: i.remark ?? null };
  // where it is, from the P&ID lineup: the connection the line is on (from → to, service), or the equipment
  const streams = lineStreams(i.line, d.lineup ?? []), onEq = streams.length ? [] : lineOnEquipment(i.line, d.lineupEq ?? []);
  const item = d.equipment.find((e) => e.tag === i.tag);
  const where = streams.length ? streams.map((x) => `${x.from} → ${x.to}`).join(' · ') : onEq.length ? onEq.map((x) => `On ${x.eq.tag}${x.eq.name ? ` (${x.eq.name.toLowerCase()})` : ''}`).join(' · ') : item ? `${short(item.tag)}${item.description ? ` · ${item.description}` : ''}` : short(i.tag);
  const service = streams[0]?.fluid ?? null;
  return (
    <Card>
      <button type="button" onClick={() => setMore((x) => !x)} className="block w-full text-left">
        <p className="flex items-baseline justify-between gap-2"><b className="text-[14px]">{i.iatNo}</b><span className="text-[11px] font-semibold text-[#0850A0]">{more ? 'Less ▴' : 'Details ▾'}</span></p>
        <p className="mt-0.5 text-[13px] font-semibold text-slate-900">📍 {where}</p>
        {service && <p className="text-[12px] text-slate-600">{service}</p>}
        <p className="mt-0.5 text-[12px] text-slate-600">{i.jobText}{i.remark ? <> · <b className="text-slate-800">{i.remark}</b></> : ''}</p>
        {i.line && <p className="text-[11px] text-slate-400">Line {i.line}{i.lineClass ? ` · ${i.lineClass}` : ''}</p>}
      </button>
      {more && <div className="mt-2 space-y-1.5 rounded-xl bg-slate-50 p-2.5 text-[12px] text-slate-700 ring-1 ring-slate-200">
        {i.finding && <p><b className="text-slate-500">Finding: </b>{i.finding}</p>}
        {i.recommendation && <p className="whitespace-pre-line"><b className="text-slate-500">Recommendation: </b>{i.recommendation}</p>}
        {i.material && <p><b className="text-slate-500">Material: </b>{i.material}</p>}
        <p><b className="text-slate-500">WO: </b>{i.wo ?? '—'}{streams[0]?.sheets[0] ? <> · <b className="text-slate-500">P&amp;ID </b>{streams[0].sheets[0]}</> : null}</p>
      </div>}
      <div className="mt-2 flex flex-wrap gap-1.5">{IAT_STATUSES.filter((x) => x !== 'Cancelled').map((x) => <button key={x} type="button" disabled={busy || x === st} onClick={async () => { setBusy(true); setErr(null); try { await setIatStatus(i.id, x, iatClosedBy(x)); done(`IAT ${i.iatNo}: ${x}.`, () => restoreIat(i.id, was)); } catch (e) { setErr(e); } finally { setBusy(false); } }}
        className={cx('min-h-8 rounded-full px-2.5 text-[12px] font-semibold', x === st ? IAT_CLS[x] : 'bg-white text-slate-700 ring-1 ring-slate-300')}>{x === 'New IAT' ? 'New' : x === 'Completed' ? 'Done' : x}</button>)}</div>
      {err != null && <ErrorBox error={err} />}
    </Card>
  );
}
