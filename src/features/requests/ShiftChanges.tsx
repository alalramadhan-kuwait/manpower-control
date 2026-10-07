// Requests › Shift changes: every shift move in date order: VR placements, temporary covers, permanent moves and day duty, and the
// moves agreed for the shutdowns (before joining, and back to the own shift afterwards). A row is done once its date has passed.
import { ChevronRight, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchDirectory } from '@/data/queries';
import { fetchMovements } from '@/data/movements';
import { FOLLOW_MARK, fetchFollowMovements, fetchSdPlans } from '@/data/shutdown';
import { loadSdDoc } from '@/features/shutdown/SdDocuments';
import { personalInstruction } from '@/features/shutdown/sdExcel';
import { Card, EmptyState, ErrorBox, Spinner, cx } from '@/ui/components';
import { CrewBadge, isCrew } from '@/ui/crew';
import { addDaysIso } from '@/core/roster';
import { localToday, shortDate } from '@/ui/leave';
import { nameFilter } from '@/ui/nameSearch';

type Item = { key: string; group: 'begin' | 'end' | 'vr' | 'moves'; link: string; plan: string | null; planId: string | null; kind: string; text: string; on: string; name: string; number: string; crew: string | null; vr?: boolean; sort: string; searchable: (string | null | undefined)[] };
const KIND: Record<string, string> = { follow: 'Follow shift', off: 'Take off', move: 'Move shift', days: 'Follow days' };
const GROUPS = [['all', 'All'], ['begin', 'Shutdown · begin'], ['end', 'Shutdown · end'], ['vr', 'VR placements'], ['moves', 'Covers & moves']] as const;
const MOVE_WINDOW_DAYS = 60;   // moves that started longer ago are history, not a request
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export function ShiftChanges() {
  const today = localToday();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [when, setWhen] = useState<'upcoming' | 'done' | 'all'>('upcoming');
  const [group, setGroup] = useState<'all' | 'begin' | 'end' | 'vr' | 'moves'>('all');
  const [plan, setPlan] = useState<string>('all');
  const [query, setQuery] = useState('');
  useEffect(() => {
    (async () => {
      const plans = (await fetchSdPlans()).filter((p) => p.end >= today);
      const out: Item[] = [];
      for (const pl of plans) {
        const doc = await loadSdDoc(pl.id);
        const found = await fetchFollowMovements(doc.rows.map((x) => x.m.employeeId));
        for (const x of doc.rows) {
          const mv = found.get(x.m.employeeId);
          const p = personalInstruction(doc, x, mv ? { start: mv.start, end: mv.end, to: mv.to } : undefined);
          if (!p) continue;
          const base = { link: `/shutdown/${pl.id}?view=instructions`, planId: pl.id, plan: pl.title, name: x.r?.display_name ?? 'Employee', number: x.r?.employee_number ?? '', crew: x.home, searchable: [x.r?.display_name, x.r?.official_name, x.r?.employee_number, x.r?.arabic_name] };
          if (p.beginAction) out.push({ ...base, key: `${x.m.id}-b`, group: 'begin', kind: p.beginKind ?? 'off', text: p.begin, on: p.beginOn, sort: `${p.beginOn}-${base.name}` });
          if (p.endAction) out.push({ ...base, key: `${x.m.id}-e`, group: 'end', kind: p.endKind ?? 'off', text: p.end, on: p.endOn, sort: `${p.endOn}-${base.name}` });
        }
      }
      // the other shift moves: VR placements, covers, permanent moves, day duty (the shutdown instructions are the rows above)
      const [moves, dir] = await Promise.all([fetchMovements(), fetchDirectory()]);
      const people = new Map(dir.map((r) => [r.id, r]));
      const since = addDaysIso(today, -MOVE_WINDOW_DAYS);
      const rng = (a: string, b: string | null) => (b ? `${shortDate(a)} – ${shortDate(b)}` : `from ${shortDate(a)}`);
      for (const m of moves) {
        if (m.status !== 'active' || m.start_date < since || (m.reason ?? '').startsWith(FOLLOW_MARK)) continue;
        const r = people.get(m.employee_id); if (!r) continue;
        const day = m.to_crew === 'DAY';
        const [kind, text] = m.kind === 'placement' ? ['VR placement', `Placed in ${m.to_crew} Shift ${rng(m.start_date, m.end_date)}${m.end_date ? '' : ', until moved'}`]
          : m.kind === 'permanent' ? ['Permanent move', `Moves to ${m.to_crew} Shift from ${shortDate(m.start_date)}`]
          : day ? ['Day duty', `Day duty ${rng(m.start_date, m.end_date)}`] : ['Temporary cover', `Covers ${m.to_crew} Shift ${rng(m.start_date, m.end_date)}`];
        out.push({ key: `mv-${m.id}`, group: m.kind === 'placement' ? 'vr' : 'moves', link: m.kind === 'placement' ? '/controllers' : '/movements', plan: null, planId: null, kind, text, on: m.start_date, name: r.display_name, number: r.employee_number,
          crew: r.crew_code, vr: r.position_code === 'vr_controller', sort: `${m.start_date}-${r.display_name}`, searchable: [r.display_name, r.official_name, r.employee_number, r.arabic_name] });
      }
      setItems(out);
    })().catch(setError);
  }, [today]);
  const plans = useMemo(() => [...new Map((items ?? []).filter((i) => i.planId).map((i) => [i.planId as string, i.plan as string])).entries()], [items]);
  const shown = useMemo(() => {
    const match = nameFilter(query);
    return (items ?? []).filter((i) => (when === 'all' || (when === 'done') === (i.on < today)) && (group === 'all' || i.group === group) && (plan === 'all' || i.planId === plan || i.planId === null) && match(i.searchable))
      .sort((a, b) => (when === 'done' ? b.sort.localeCompare(a.sort) : a.sort.localeCompare(b.sort)));
  }, [items, when, group, plan, query, today]);
  if (error) return <ErrorBox error={error} />;
  if (!items) return <Spinner />;
  const chip = (on: boolean) => cx('min-h-9 shrink-0 rounded-full px-3 text-sm font-medium ring-1', on ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300');
  const people = new Set(shown.map((i) => i.number)).size;
  return (
    <div className="space-y-2">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input" style={{ paddingLeft: '2.25rem' }} placeholder="Search name or number" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {([['upcoming', 'Upcoming'], ['done', 'Done'], ['all', 'All']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={when === k} onClick={() => setWhen(k)} className={chip(when === k)}>{l}</button>)}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {GROUPS.map(([k, l]) => <button key={k} type="button" aria-pressed={group === k} onClick={() => setGroup(k)} className={chip(group === k)}>{l}</button>)}
      </div>
      {plans.length > 1 && (group === 'all' || group === 'begin' || group === 'end') && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <button type="button" aria-pressed={plan === 'all'} onClick={() => setPlan('all')} className={chip(plan === 'all')}>All shutdowns</button>
          {plans.map(([id, title]) => <button key={id} type="button" aria-pressed={plan === id} onClick={() => setPlan(id)} className={chip(plan === id)}>{title}</button>)}
        </div>
      )}
      <p className="px-1 text-xs text-slate-500">{shown.length} {shown.length === 1 ? 'shift change' : 'shift changes'} · {people} {people === 1 ? 'person' : 'people'}. Shutdown rows list only people who need a change.</p>
      {shown.length === 0 ? <EmptyState title={items.length === 0 ? 'No shift changes' : 'Nothing matches'} body={items.length === 0 ? 'No shift moves, VR placements or shutdown instructions to show.' : undefined} /> : (
        <Card className="divide-y divide-slate-100 p-0">
          {shown.map((i) => {
            const left = days(today, i.on);
            return (
              <Link key={i.key} to={i.link} className="flex items-center gap-3 px-3 py-3 active:bg-slate-50">
                {isCrew(i.crew) ? <CrewBadge crew={i.crew} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{i.vr ? 'VR' : 'DS'}</span>}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5"><span className="truncate text-sm font-medium text-slate-800">{i.name}</span><span className="shrink-0 text-xs tabular-nums text-slate-500">#{i.number}</span></span>
                  <span className="block text-sm text-slate-700">{i.text}</span>
                  <span className="mt-1 flex flex-wrap gap-1 text-[11px]">
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-700">{i.group === 'begin' ? 'Begin · ' : i.group === 'end' ? 'End · ' : ''}{KIND[i.kind] ?? i.kind}</span>
                    {i.plan && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-700">{i.plan}</span>}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs font-semibold text-slate-800">{shortDate(i.on)}</span>
                  <span className={cx('block text-[11px]', left < 0 ? 'text-status-green' : left <= 7 ? 'font-semibold text-status-amber' : 'text-slate-500')}>{left < 0 ? 'Done' : left === 0 ? 'Today' : `in ${left} d`}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
