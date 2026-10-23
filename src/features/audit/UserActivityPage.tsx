// User activity (Section Head): everyone who uses the app or an engineer link, when they were last on it, what they
// opened and what they changed; one person's day in a timeline.
import { useEffect, useMemo, useState } from 'react';
import { describe, type AuditLookups } from '@/core/audit';
import { kwDay, kwTime, logText, type TrkActivity } from '@/core/tracker';
import { fetchActivitySummary, fetchPersonActivity, type ActivityPerson } from '@/data/activity';
import { fetchAuditLookups } from '@/data/audit';
import { Card, ErrorBox, Spinner, cx } from '@/ui/components';

const PERIODS: [number, string][] = [[1, 'Today'], [7, '7 days'], [30, '30 days']];
const ROLE: Record<string, string> = { section_head: 'Section Head', manpower_coordinator: 'Manpower Coordinator', controller: 'Controller', 'engineer link': 'Engineer link' };
const kwDate = (iso: string) => new Date(Date.parse(iso) + 3 * 36e5).toISOString().slice(0, 10);
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 2 ? 'now' : m < 60 ? `${m} min ago` : m < 24 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
/** A page address in words. */
const PAGES: [RegExp, string][] = [[/^\/$/, 'Today'], [/^\/calendar/, 'Calendar'], [/^\/requests/, 'Requests'], [/^\/employees/, 'Employees'], [/^\/controllers/, 'Controllers'],
  [/^\/leave-planning/, 'Leave planning'], [/^\/shutdown/, 'Shutdown plan'], [/^\/progress/, 'Shutdown progress'], [/^\/data-quality/, 'Data quality'], [/^\/import/, 'Excel import'],
  [/^\/admin/, 'Administration'], [/^\/notifications/, 'Notifications'], [/^\/more/, 'More'], [/^\/engineer\/(\w+)/, 'Engineer · $1']];
const ENG: Record<string, string> = { dash: 'Dashboard', equip: 'Equipment', ho: 'Handover', scope: 'SD scope', hot: 'Hot work' };
export const pageName = (p: string) => { for (const [re, l] of PAGES) { const m = p.match(re); if (m) return l.replace('$1', ENG[m[1]] ?? m[1] ?? ''); } return p; };

export default function UserActivityPage() {
  const [days, setDays] = useState(7);
  const [people, setPeople] = useState<ActivityPerson[] | null>(null);
  const [open, setOpen] = useState<ActivityPerson | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { let live = true; setPeople(null); fetchActivitySummary(days).then((r) => live && setPeople(r)).catch((e) => live && setErr(e)); return () => { live = false; }; }, [days]);
  if (open) return <PersonTimeline p={open} days={days} onBack={() => setOpen(null)} />;
  const active = (people ?? []).filter((p) => p.visits + p.appChanges + p.trackerChanges > 0), idle = (people ?? []).filter((p) => p.visits + p.appChanges + p.trackerChanges === 0);
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">{PERIODS.map(([d, l]) => <button key={d} type="button" onClick={() => setDays(d)} className={cx('min-h-9 rounded-full px-3.5 text-sm font-semibold', days === d ? 'bg-brand-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300')}>{l}</button>)}</div>
      {err != null && <ErrorBox error={err} />}
      {!people && !err && <div className="py-6"><Spinner /></div>}
      {people && <Card className="p-0">
        <div className="hidden grid-cols-[1fr_110px_70px_80px_80px] gap-2 border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid">
          <span>Person</span><span>Last seen</span><span className="text-right">Visits</span><span className="text-right">Tracker</span><span className="text-right">App</span></div>
        {active.map((p) => <PersonRow key={`${p.kind}${p.name}`} p={p} onOpen={() => setOpen(p)} />)}
        {!active.length && <p className="px-3 py-4 text-sm text-slate-500">Nobody used the app in this period.</p>}
      </Card>}
      {idle.length > 0 && <p className="text-xs text-slate-500">Not seen in this period: {idle.map((p) => p.name).join(', ')}</p>}
      <p className="text-[11px] text-slate-500">Visits: pages opened (the same page within 10 minutes counts once; recorded from 23 Oct). Tracker: changes in the shutdown tracker. App: changes to staff, leave, plans and the rest of the app.</p>
    </div>
  );
}

function PersonRow({ p, onOpen }: { p: ActivityPerson; onOpen: () => void }) {
  const fresh = p.lastSeen && Date.now() - Date.parse(p.lastSeen) < 15 * 60000;
  return (
    <button type="button" onClick={onOpen} className="grid w-full grid-cols-[1fr_auto] items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50 sm:grid-cols-[1fr_110px_70px_80px_80px]">
      <span className="min-w-0"><span className="flex items-center gap-1.5 font-semibold text-slate-900">{fresh && <span className="h-2 w-2 rounded-full bg-status-green" />}{p.name}</span>
        <span className="block text-[11.5px] text-slate-500">{ROLE[p.role ?? ''] ?? p.role}{p.lastPage ? ` · last on ${pageName(p.lastPage)}` : ''}</span>
        <span className="block text-[11.5px] text-slate-500 sm:hidden">{p.visits} visits · {p.trackerChanges} tracker · {p.appChanges} app changes</span></span>
      <span className="text-right text-[12.5px] text-slate-700 sm:text-left">{ago(p.lastSeen)}</span>
      <span className="hidden text-right tabular-nums sm:block">{p.visits}</span>
      <span className="hidden text-right tabular-nums sm:block">{p.trackerChanges}</span>
      <span className="hidden text-right tabular-nums sm:block">{p.appChanges}</span>
    </button>
  );
}

type Row = { at: string; kind: 'visit' | 'tracker' | 'app'; item: string; what: string };
function PersonTimeline({ p, days, onBack }: { p: ActivityPerson; days: number; onBack: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchPersonActivity>> | null>(null);
  const [lk, setLk] = useState<AuditLookups | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [only, setOnly] = useState<'all' | 'changes' | 'visit'>('all');
  useEffect(() => { fetchPersonActivity(p.name, p.kind, days).then(setData).catch(setErr); if (p.kind === 'app') fetchAuditLookups().then(setLk).catch(() => undefined); }, [p, days]);
  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const acts: TrkActivity[] = [];
    const out: Row[] = [
      ...data.visits.map((v) => ({ at: v.at, kind: 'visit' as const, item: pageName(v.page), what: `opened${v.device ? ` · ${v.device}` : ''}` })),
      ...data.tracker.map((l) => ({ at: l.at, kind: 'tracker' as const, ...logText(l, acts) })),
      ...data.app.map((r) => { const e = lk ? describe(r, lk) : null; return { at: r.occurred_at, kind: 'app' as const, item: 'App', what: e?.title ?? `${r.action} ${r.entity_table}` }; })];
    return out.filter((r) => only === 'all' || (only === 'visit' ? r.kind === 'visit' : r.kind !== 'visit')).sort((a, b) => b.at.localeCompare(a.at));
  }, [data, lk, only]);
  const dayList = [...new Set(rows.map((r) => kwDate(r.at)))];
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-sm font-semibold text-brand-700">‹ All users</button>
      <Card>
        <p className="text-lg font-bold text-brand-900">{p.name}</p>
        <p className="text-sm text-slate-600">{ROLE[p.role ?? ''] ?? p.role} · last seen {ago(p.lastSeen)} · {p.visits} visits · {p.trackerChanges + p.appChanges} changes</p>
      </Card>
      <div className="flex gap-1.5">{([['all', 'Everything'], ['changes', 'Changes'], ['visit', 'Pages opened']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setOnly(k)} className={cx('min-h-8 rounded-full px-3 text-xs font-semibold', only === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300')}>{l}</button>)}</div>
      {err != null && <ErrorBox error={err} />}
      {!data && !err && <div className="py-6"><Spinner /></div>}
      {data && !rows.length && <p className="py-4 text-center text-sm text-slate-500">Nothing in this period.</p>}
      {dayList.map((day) => <div key={day}>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{kwDay(`${day}T12:00:00+03:00`)}</p>
        <div className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
          {rows.filter((r) => kwDate(r.at) === day).slice(0, 500).map((r, i) => (
            <div key={i} className="flex gap-2 px-3 py-1.5 text-[13px]">
              <span className="w-11 shrink-0 tabular-nums text-slate-500">{kwTime(r.at)}</span>
              <span className={cx('mt-0.5 h-fit shrink-0 rounded px-1.5 text-[10.5px] font-bold', r.kind === 'visit' ? 'bg-slate-100 text-slate-500' : r.kind === 'tracker' ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900')}>{r.kind === 'visit' ? 'Opened' : r.kind === 'tracker' ? 'Tracker' : 'App'}</span>
              <span className="min-w-0 flex-1"><b>{r.item}</b> <span className="text-slate-700">{r.what}</span></span>
            </div>))}
        </div>
      </div>)}
    </div>
  );
}
