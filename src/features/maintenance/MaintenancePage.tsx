// Shutdowns › Maintenance (owner, 13 Nov 2026: "a section to follow up maintenance activities"). The equipment still
// with Maintenance outside a shutdown: items made Non-SD on their profile (their open steps carried over) and day-to-day
// jobs added here. Overdue first, then in progress, then back in service (kept 7 days). An item opens on the same
// steps page as in the shutdown, with its profile (scope, due date, back in service, notes).
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UserProfile } from '@/data/types';
import { addDailyItem, fetchTrackerData, fetchTrackers, type TrackerData } from '@/data/tracker';
import { sortActs, type TrkActivity, type TrkEquipment } from '@/core/tracker';
import { ItemSheetFor } from '@/features/engineer/EngineerApp';
import { BottomSheet, ErrorBox, Spinner, Toast, cx } from '@/ui/components';

const H = 36e5;
const kwToday = () => new Date(Date.now() + 3 * H).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dShort = (iso: string) => { const k = new Date(Date.parse(iso.length === 10 ? `${iso}T00:00:00+03:00` : iso) + 3 * H); return `${k.getUTCDate()} ${MON[k.getUTCMonth()]}`; };
const short = (t: string) => t.replace(/^([A-Z]{1,3})-12-/, '$1-').replace(/^12-/, '');
const keyOf = (e: TrkEquipment) => e.barchartKey ?? e.tag;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

type State = 'overdue' | 'open' | 'back';
interface Row { d: TrackerData; e: TrkEquipment; acts: TrkActivity[]; left: TrkActivity[]; next: TrkActivity | null; state: State; over: number }

function rowsOf(parts: TrackerData[], today: string): Row[] {
  return parts.flatMap((d) => d.equipment.filter((e) => e.scope === 'non_sd' && (!e.combine || d.equipment.find((x) => x.combine === e.combine) === e)).map((e): Row => {
    const keys = e.combine ? d.equipment.filter((x) => x.combine === e.combine).map(keyOf) : [keyOf(e)];
    const acts = sortActs(d.activities.filter((a) => keys.includes(a.key) && a.tracked && !a.detail && a.group !== 'Operations'));
    const left = acts.filter((a) => !a.actualFinish);
    const next = left.find((a) => a.actualStart && !a.actualFinish) ?? left[0] ?? null;
    const over = e.dueDate && !e.backAt ? daysBetween(e.dueDate, today) : 0;
    return { d, e, acts, left, next, state: e.backAt ? 'back' : over > 0 ? 'overdue' : 'open', over };
  }));
}

export default function MaintenancePage({ profile }: { profile: UserProfile }) {
  const head = profile.role_code === 'section_head';
  const role = head ? 'head' : profile.role_code === 'controller' ? 'controller' : 'engineer';
  const [parts, setParts] = useState<TrackerData[] | null>(null); const [err, setErr] = useState<unknown>(null);
  const [f, setF] = useState<'all' | 'sd' | 'daily'>('all');
  const [open, setOpen] = useState<{ tracker: string; tag: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState<{ msg: string; undo?: () => Promise<unknown> } | null>(null);
  const load = useCallback(async () => {
    try {
      const live = (await fetchTrackers()).filter((t) => t.mode === 'live');
      setParts(await Promise.all(live.map((t) => fetchTrackerData(t.id, 'nonsd')))); setErr(null);
    } catch (x) { setErr(x); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const done = (msg: string, undo?: () => Promise<unknown>) => { setFlash({ msg, undo }); void load(); window.setTimeout(() => setFlash((x) => (x?.msg === msg ? null : x)), undo ? 7000 : 3000); };
  const today = kwToday();
  const rows = useMemo(() => (parts ? rowsOf(parts, today) : []), [parts, today]);
  if (err) return <ErrorBox error={err} />;
  if (!parts) return <Spinner />;
  const shown = rows.filter((r) => (f === 'all' || (f === 'daily' ? r.e.origin === 'daily' : r.e.origin !== 'daily')) && (r.state !== 'back' || Date.now() - Date.parse(r.e.backAt!) < 7 * 24 * H));
  const overdue = shown.filter((r) => r.state === 'overdue').sort((a, b) => b.over - a.over);
  const inProg = shown.filter((r) => r.state === 'open').sort((a, b) => (a.e.dueDate ?? '9999').localeCompare(b.e.dueDate ?? '9999') || a.e.tag.localeCompare(b.e.tag));
  const back = shown.filter((r) => r.state === 'back');
  const openD = parts.find((d) => d.tracker.id === open?.tracker);
  const card = (r: Row) => {
    const n = r.acts.length, dn = n - r.left.length, pct = n ? (dn / n) * 100 : 0;
    return <button key={r.e.id} type="button" onClick={() => setOpen({ tracker: r.d.tracker.id, tag: r.e.tag })}
      className={cx('mb-1.5 block w-full rounded-xl bg-white px-3 py-2 text-left ring-1 ring-slate-200 active:bg-slate-50', r.state === 'overdue' && 'border-l-4 border-l-status-red', r.state === 'back' && 'opacity-70')}>
      <span className="flex items-baseline gap-1.5"><b className="min-w-0 flex-1 truncate text-[14px] text-slate-900">{r.state === 'back' ? '✓ ' : ''}{short(r.e.combine ?? r.e.tag)}</b>
        {r.state === 'back' ? <span className="rounded bg-green-100 px-1.5 text-[10.5px] font-extrabold text-green-800">back {dShort(r.e.backAt!)}</span>
          : r.e.dueDate ? <span className={cx('rounded px-1.5 text-[10.5px] font-extrabold', r.state === 'overdue' ? 'bg-red-100 text-red-800' : 'bg-indigo-100 text-indigo-800')}>due {dShort(r.e.dueDate)}{r.over > 0 ? ` · ${r.over} d over` : ''}</span>
          : <span className="rounded bg-amber-100 px-1.5 text-[10.5px] font-extrabold text-amber-900">no date</span>}</span>
      {r.e.description && <span className="block truncate text-[12px] text-slate-600">{r.e.description}</span>}
      {r.state !== 'back' && <span className="mt-0.5 block text-[12px] text-slate-800">{r.next ? <>{r.next.actualStart ? '▶ ' : 'Next: '}<b>{r.next.activity}</b> · {r.left.length} of {n} left</> : n ? '✓ All steps done · confirm back in service' : 'No steps yet'}</span>}
      {n > 0 && r.state !== 'back' && <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-200"><span className="block h-full bg-blue-600" style={{ width: `${pct}%` }} /></span>}
      <span className="mt-0.5 block truncate text-[10.5px] text-slate-500">{r.e.origin === 'daily' ? 'Day-to-day' : `From ${r.d.tracker.title}`}{r.e.nonsdReason ? ` · ${r.e.nonsdReason}` : ''}</span>
    </button>;
  };
  const sec = (title: string, xs: Row[]) => xs.length > 0 && <div><p className="mx-1 mb-1 mt-2 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-500">{title}</p>{xs.map(card)}</div>;
  return (
    <div className="mx-auto max-w-xl px-3 pb-28 pt-2">
      <p className="mx-1 mb-2 text-[12px] text-slate-500">Equipment still with Maintenance outside a shutdown, followed until it is back in service.</p>
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        {[[String(overdue.length + inProg.length), 'open', 'text-slate-900'], [String(overdue.length), 'overdue', 'text-status-red'], [String(back.length), 'back this week', 'text-status-green']].map(([n, l, c]) =>
          <div key={l} className="rounded-xl bg-white py-1.5 text-center ring-1 ring-slate-200"><b className={cx('block text-[20px] leading-tight', c)}>{n}</b><span className="text-[10.5px] font-bold text-slate-500">{l}</span></div>)}
      </div>
      <div className="mb-1 flex items-center gap-1.5">
        {([['all', 'All'], ['sd', 'From SD'], ['daily', 'Day-to-day']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setF(k)} className={cx('min-h-8 rounded-full px-3 text-[12px] font-bold', f === k ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{l}</button>)}
        <span className="flex-1" />
        {head && <button type="button" onClick={() => setAdding(true)} className="min-h-8 rounded-full bg-brand-700 px-3 text-[12px] font-bold text-white">+ Add</button>}
      </div>
      {sec('Overdue', overdue)}{sec('In progress', inProg)}{sec('Back in service', back)}
      {!shown.length && <p className="mt-6 text-center text-[13px] text-slate-500">Nothing with Maintenance. An item comes here when its profile is set to Non-SD{head ? ', or with + Add' : ''}.</p>}
      {open && openD && <ItemSheetFor key={open.tag} d={openD} tag={open.tag} now={Date.now()} role={role} me={profile.auth_user_id} onIsolation={() => {}} onClose={() => setOpen(null)} done={(m, u) => done(m, u)} />}
      {adding && parts[0] && <AddDaily trackerId={parts[0].tracker.id} onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); done(m); }} />}
      {flash && <Toast msg={flash.msg} onUndo={flash.undo ? async () => { const u = flash.undo!; setFlash(null); try { await u(); done('Undone.'); } catch (x) { setErr(x); } } : undefined} />}
    </div>
  );
}

/** A day-to-day job (Section Head): tag, the job, why, a due date and its steps, one per line. */
function AddDaily({ trackerId, onClose, onDone }: { trackerId: string; onClose: () => void; onDone: (m: string) => void }) {
  const [tag, setTag] = useState(''); const [job, setJob] = useState(''); const [why, setWhy] = useState(''); const [due, setDue] = useState('');
  const [steps, setSteps] = useState('Isolate & drain\nRepair\nBox up\nBack in service'); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const list = steps.split('\n').map((x) => x.trim()).filter(Boolean);
  async function save() {
    setBusy(true); setErr(null);
    try { await addDailyItem(trackerId, { tag, job, reason: why.trim() || null, dueDate: due || null, steps: list }); onDone(`${tag.trim()}: added to Maintenance.`); } catch (x) { setErr(x); setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="Day-to-day maintenance job">
      <div className="space-y-2">
        <input className="input text-[14px]" placeholder="Tag, e.g. P-12-207B" value={tag} onChange={(x) => setTag(x.target.value)} />
        <input className="input text-[14px]" placeholder="The job, e.g. Wash water pump · seal leak" value={job} onChange={(x) => setJob(x.target.value)} />
        <input className="input text-[14px]" placeholder="Why / reference (optional), e.g. notification no." maxLength={200} value={why} onChange={(x) => setWhy(x.target.value)} />
        <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Due date (optional)<input type="date" className="input mt-0.5 text-[14px]" value={due} onChange={(x) => setDue(x.target.value)} /></label>
        <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Steps · one per line<textarea className="input mt-0.5 min-h-28 text-[14px] normal-case" value={steps} onChange={(x) => setSteps(x.target.value)} /></label>
        {err != null && <ErrorBox error={err} />}
        <button type="button" disabled={busy || !tag.trim() || !list.length} onClick={() => void save()} className="min-h-11 w-full rounded-xl bg-brand-700 text-[15px] font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : `Add with ${list.length} step${list.length === 1 ? '' : 's'}`}</button>
      </div>
    </BottomSheet>
  );
}
