import { ChevronRight, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { yearSegment } from '@/core/calendar';
import { FO_LEVEL_LABEL, sdOperatorEligible, type SdKind, type SdMember, type SdPlan } from '@/core/shutdown';
import { fetchCalendarInfo } from '@/data/calendar';
import { fetchDirectory } from '@/data/queries';
import { createSdPlan, fetchAllSdMembers, fetchSdPlans, updateSdPlan } from '@/data/shutdown';
import type { EmployeeDirectoryRow } from '@/data/types';
import { BottomSheet, Button, Card, ErrorBox, Field, PageHeader, Spinner, cx, fmtDate } from '@/ui/components';
import { CrewBadge, isCrew } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { nameFilter } from '@/ui/nameSearch';

/** Shutdown teams: one plan per shutdown; open it to fill the Morning and Night teams. */
export default function ShutdownListPage() {
  const [plans, setPlans] = useState<SdPlan[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SdPlan | null>(null);
  const [people, setPeople] = useState<Map<string, number>>(new Map());
  const [members, setMembers] = useState<SdMember[]>([]);
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'people' ? 'people' : params.get('view') === 'timeline' ? 'timeline' : 'plans';
  const [notice, setNotice] = useState<string | null>(null);
  const today = localToday();
  const load = () => {
    Promise.all([fetchSdPlans(), fetchAllSdMembers()]).then(([ps, ms]) => {
      setPlans(ps); setMembers(ms);
      const n = new Map<string, number>();
      for (const m of ms) n.set(m.planId, (n.get(m.planId) ?? 0) + 1);
      setPeople(n);
    }).catch(setError);
  };
  useEffect(load, []);
  // still to come or running first (soonest first); the finished ones after, the latest first, greyed
  const ahead = (plans ?? []).filter((p) => p.end >= today).sort((a, b) => a.start.localeCompare(b.start));
  const done = (plans ?? []).filter((p) => p.end < today).sort((a, b) => b.end.localeCompare(a.end));
  const dayNo = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
  const when = (p: SdPlan) => {
    const length = dayNo(p.end) - dayNo(p.start) + 1;
    const range = `${fmtDate(p.start)} – ${fmtDate(p.end)}`;
    return { range, length, state: p.end < today ? 'Finished' : p.start <= today ? `Running · day ${dayNo(today) - dayNo(p.start) + 1} of ${length}` : `Starts in ${dayNo(p.start) - dayNo(today)} ${dayNo(p.start) - dayNo(today) === 1 ? 'day' : 'days'}` };
  };
  const row = (p: SdPlan, finished: boolean) => {
    const w = when(p); const n = people.get(p.id) ?? 0;
    return (
      <div key={p.id} className={cx('flex items-center', finished && 'bg-slate-50/60')}>
        <Link to={`/shutdown/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3">
          <span className={cx('min-w-0 flex-1 space-y-0.5', finished && 'opacity-60')}>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={cx('font-medium', finished ? 'text-slate-600' : 'text-slate-900')}>{p.title}</span>
              <span className={cx('rounded-full px-1.5 text-[10px] font-semibold', finished ? 'bg-slate-200 text-slate-600' : p.start <= today ? 'bg-green-100 text-green-800' : 'bg-brand-50 text-brand-700')}>{w.state}</span>
            </span>
            <span className="block text-xs text-slate-700">{w.range} · {w.length} days</span>
            <span className="block text-xs text-slate-500">{p.kind === 'total' ? 'Total · ' : ''}{p.daysOff ? `${p.daysOn} on, ${p.daysOff} off` : 'every day'} · {p.shiftHours} h · <span className={cx(n === 0 && !finished && 'font-medium text-amber-700')}>{n === 0 ? 'no one added yet' : `${n} ${n === 1 ? 'person' : 'people'}`}</span></span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
        </Link>
        <button type="button" aria-label={`Edit or delete ${p.title}`} onClick={() => setEditing(p)} className="flex h-12 w-12 shrink-0 items-center justify-center text-brand-700"><Pencil className="h-4 w-4" /></button>
      </div>
    );
  };
  return (
    <div>
      <PageHeader title="Shutdown teams" info={<div className="space-y-2 text-sm text-slate-700">
        <p>One plan per shutdown, with a Morning and a Night team. Train shutdown: each team needs its own Controller, Senior, Good and New Field Operators; the crews keep running. Total turnaround: the whole unit is down, each shift has its Controllers and operators per area (e.g. TR-II, L.P &amp; TR-I), the numbers can step down by phase, and the crew minimums don't apply.</p>
        <p>Panel Operators of Grade 13 and below, and contractor Panel Operators, can also be picked for a team.</p>
        <p>Team members leave their crew for the team's dates; the crews must still meet the shutdown's operating-mode minimums. The team's Controller can still cover a normal shift on a day (Controllers › Assign cover).</p>
        <p>Overtime = shutdown hours − the normal duty hours the person would have worked, per month, against the cap.</p>
        <p>Picking members: the right level first; nobody works two shutdowns in a row (flagged); then those free of leave whose crew keeps its minimum; then fewer sick days this year.</p>
      </div>} action={<Button className="min-h-10 shrink-0 px-3" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> New</Button>} />
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {(['plans', 'timeline', 'people'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={view === t} onClick={() => setParams(t === 'plans' ? {} : { view: t }, { replace: true })}
            className={cx('min-h-9 rounded-lg font-medium', view === t ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{t === 'plans' ? 'Shutdowns' : t === 'timeline' ? 'Timeline' : 'Who took part'}</button>
        ))}
      </div>
      {view === 'timeline' && (error ? <ErrorBox error={error} /> : !plans ? <Spinner /> : <TimelineTab plans={plans} people={people} today={today} />)}
      {view === 'people' && (error ? <ErrorBox error={error} /> : !plans ? <Spinner /> : <PeopleTab plans={plans} members={members} />)}
      {view === 'plans' && <p className="mb-2 text-xs text-slate-500">Field Operator levels: <Link to="/review/fo-levels" className="font-medium text-brand-700">Senior / Good / New ›</Link></p>}
      {notice && <p role="status" className="mb-2 text-sm text-status-green">{notice}</p>}
      {view === 'plans' && (error ? <ErrorBox error={error} /> : !plans ? <Spinner /> : plans.length === 0 ? <Card><p className="text-sm text-slate-500">No shutdown plan yet.</p></Card> : (
        <div className="space-y-4">
          {ahead.length > 0 && <Card className="divide-y divide-slate-100 p-0">{ahead.map((p) => row(p, false))}</Card>}
          {done.length > 0 && (
            <section>
              <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Done · for the record ({done.length})</h2>
              <Card className="divide-y divide-slate-100 overflow-hidden p-0">{done.map((p) => row(p, true))}</Card>
            </section>
          )}
        </div>
      ))}
      {adding && <NewPlanSheet onClose={() => setAdding(false)} />}
      {editing && <EditPlanSheet plan={editing} people={people.get(editing.id) ?? 0} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); setNotice(m); load(); }} />}
    </div>
  );
}

/** Every shutdown on a time scale: one strip per year (months across), bars placed by date, today marked; the list under each strip has the details. */
function TimelineTab({ plans, people, today }: { plans: SdPlan[]; people: Map<string, number>; today: string }) {
  if (plans.length === 0) return <Card><p className="text-sm text-slate-500">No shutdown plan yet.</p></Card>;
  const sorted = [...plans].sort((a, b) => a.start.localeCompare(b.start));
  const first = Number(sorted[0].start.slice(0, 4));
  const last = Math.max(Number(sorted[sorted.length - 1].end.slice(0, 4)), Number(today.slice(0, 4)));
  const years = Array.from({ length: last - first + 1 }, (_, i) => last - i);   // newest year on top
  const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  const prevOf = new Map(sorted.map((p, i) => [p.id, i > 0 ? sorted[i - 1] : null]));
  const finished = sorted.filter((p) => p.end < today);
  const ahead = sorted.filter((p) => p.end >= today);
  const lastDone = finished[finished.length - 1] ?? null;
  const next = ahead[0] ?? null;
  const colour = (p: SdPlan) => (p.kind === 'total' ? 'bg-amber-500' : 'bg-brand-600');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200"><div className="text-slate-500">Last finished</div>
          {lastDone ? <><div className="truncate font-medium text-slate-900">{lastDone.title}</div><div className="text-slate-600">{days(lastDone.end, today)} days ago</div></> : <div className="text-slate-500">none</div>}</div>
        <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200"><div className="text-slate-500">{next && next.start <= today ? 'Running now' : 'Next'}</div>
          {next ? <><div className="truncate font-medium text-slate-900">{next.title}</div><div className="text-slate-600">{next.start <= today ? `ends in ${days(today, next.end)} days` : `in ${days(today, next.start)} days`}</div></> : <div className="text-slate-500">none planned</div>}</div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-brand-600" />Train shutdown</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-amber-500" />Total turnaround</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-white ring-1 ring-slate-400" />Planned</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-0.5 bg-status-red" />Today</span>
      </div>
      {years.map((y) => {
        const inYear = sorted.filter((p) => yearSegment(p.start, p.end, y));
        // lanes: bars that overlap in time go on separate lines
        const lanes: string[] = []; const laneOf = new Map<string, number>();
        for (const p of inYear) { let i = lanes.findIndex((end) => end < p.start); if (i < 0) { i = lanes.length; lanes.push(p.end); } else lanes[i] = p.end; laneOf.set(p.id, i); }
        const todaySeg = String(y) === today.slice(0, 4) ? yearSegment(today, today, y) : null;
        const starting = sorted.filter((p) => p.start.startsWith(String(y))).reverse();
        const height = Math.max(1, lanes.length) * 26 + 8;
        return (
          <Card key={y} className="p-3">
            <div className="mb-1 flex items-baseline justify-between"><h2 className="text-lg font-semibold text-brand-800">{y}</h2><span className="text-xs text-slate-500">{inYear.length === 0 ? 'no shutdown' : `${inYear.length} ${inYear.length === 1 ? 'shutdown' : 'shutdowns'}`}</span></div>
            <div className="grid grid-cols-12 text-center text-[10px] text-slate-400">{['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map((m, i) => <span key={i}>{m}</span>)}</div>
            <div className="relative rounded-md bg-slate-50 ring-1 ring-slate-200" style={{ height }}>
              {Array.from({ length: 11 }, (_, i) => <span key={i} className="absolute top-0 h-full w-px bg-slate-200" style={{ left: `${((i + 1) / 12) * 100}%` }} />)}
              {inYear.map((p) => { const seg = yearSegment(p.start, p.end, y)!; const planned = p.start > today;
                return (
                  <Link key={p.id} to={`/shutdown/${p.id}`} title={`${p.title} · ${fmtDate(p.start)} – ${fmtDate(p.end)}`} aria-label={`${p.title}, ${fmtDate(p.start)} to ${fmtDate(p.end)}`}
                    className={cx('absolute flex items-center overflow-hidden rounded px-1 text-[10px] font-semibold leading-none', planned ? 'bg-white text-slate-700 ring-2 ring-inset ' + (p.kind === 'total' ? 'ring-amber-500' : 'ring-brand-600') : cx(colour(p), 'text-white'))}
                    style={{ left: `${seg.left * 100}%`, width: `max(${seg.width * 100}%, 6px)`, top: 4 + (laneOf.get(p.id) ?? 0) * 26, height: 22 }}>
                    <span className="truncate">{seg.width > 0.12 ? p.title : ''}</span>
                  </Link>
                ); })}
              {todaySeg && <span className="pointer-events-none absolute top-0 h-full w-0.5 bg-status-red" style={{ left: `${todaySeg.left * 100}%` }} />}
            </div>
            {starting.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-100">
                {starting.map((p) => { const prev = prevOf.get(p.id); const gap = prev ? days(prev.end, p.start) - 1 : null; const n = people.get(p.id) ?? 0;
                  return (
                    <li key={p.id}>
                      <Link to={`/shutdown/${p.id}`} className="flex items-start gap-2 py-1.5">
                        <span className={cx('mt-1 h-2.5 w-2.5 shrink-0 rounded-sm', colour(p))} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">{p.title}{p.start > today ? <span className="ml-1.5 text-[10px] font-semibold text-brand-700">planned</span> : p.end >= today ? <span className="ml-1.5 text-[10px] font-semibold text-green-700">running</span> : null}</span>
                          <span className="block text-xs text-slate-600">{fmtDate(p.start)} – {fmtDate(p.end)} · {days(p.start, p.end) + 1} days · {n} {n === 1 ? 'person' : 'people'}{p.end.slice(0, 4) !== p.start.slice(0, 4) ? ` · continues into ${p.end.slice(0, 4)}` : ''}</span>
                          {gap != null && gap >= 0 && <span className="block text-[11px] text-slate-400">{gap} days after {prev!.title}</span>}
                        </span>
                      </Link>
                    </li>
                  ); })}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthSpan = (a: string, b: string) => {
  const [ya, ma, yb, mb] = [a.slice(0, 4), Number(a.slice(5, 7)) - 1, b.slice(0, 4), Number(b.slice(5, 7)) - 1];
  return ya === yb ? (ma === mb ? `${MONTHS[ma]} ${ya}` : `${MONTHS[ma]}–${MONTHS[mb]} ${ya}`) : `${MONTHS[ma]} ${ya} – ${MONTHS[mb]} ${yb}`;
};

/** Everyone who has been on a shutdown team: name and number, how many shutdowns, and which (newest first). */
function PeopleTab({ plans, members }: { plans: SdPlan[]; members: SdMember[] }) {
  const [dir, setDir] = useState<Map<string, EmployeeDirectoryRow> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [crew, setCrew] = useState<'all' | 'A' | 'B' | 'C' | 'D' | 'day'>('all');
  const [pos, setPos] = useState<'all' | 'controller' | 'vr' | 'panel' | 'field'>('all');
  const [sort, setSort] = useState<'most' | 'name' | 'number' | 'latest'>('most');
  const [mode, setMode] = useState<'in' | 'out'>('in');
  // excluded: positions and grades left out of the list (tap again to bring them back)
  const [exPos, setExPos] = useState<Set<string>>(new Set());
  const [exGrade, setExGrade] = useState<Set<number>>(new Set());
  const toggle = <T,>(set: Set<T>, v: T, put: (s: Set<T>) => void) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); put(n); };
  const today = localToday();
  useEffect(() => { fetchDirectory().then((d) => setDir(new Map(d.map((r) => [r.id, r])))).catch(setErr); }, []);
  const { rows, never, neverAll, tookAll } = useMemo(() => {
    if (!dir) return { rows: [], never: [], neverAll: 0, tookAll: 0 };
    const planOf = new Map(plans.map((p) => [p.id, p]));
    const by = new Map<string, Map<string, SdPlan>>();
    for (const m of members) { const p = planOf.get(m.planId); if (p) { const x = by.get(m.employeeId) ?? new Map<string, SdPlan>(); x.set(p.id, p); by.set(m.employeeId, x); } }
    const match = nameFilter(query);
    const posOf = (code: string | null) => (code === 'controller' || code === 'morning_controller' ? 'controller' : code === 'vr_controller' ? 'vr' : code === 'panel_operator' ? 'panel' : code === 'field_operator' ? 'field' : 'other');
    const byName = (a: { r?: EmployeeDirectoryRow }, b: { r?: EmployeeDirectoryRow }) => a.r!.display_name.localeCompare(b.r!.display_name);
    const keep = (r: EmployeeDirectoryRow) => match([r.display_name, r.official_name, r.employee_number, r.arabic_name])
      && (crew === 'all' || (crew === 'day' ? !isCrew(r.crew_code) : r.crew_code === crew)) && (pos === 'all' || posOf(r.position_code) === pos)
      && !exPos.has(posOf(r.position_code)) && !(r.grade != null && exGrade.has(r.grade));
    const rows = [...by].map(([id, ps]) => ({ id, r: dir.get(id), list: [...ps.values()].sort((a, b) => b.start.localeCompare(a.start)) }))
      .filter((x) => x.r && keep(x.r))
      .sort((a, b) => sort === 'name' ? byName(a, b)
        : sort === 'number' ? Number(a.r!.employee_number) - Number(b.r!.employee_number)
        : sort === 'latest' ? b.list[0].start.localeCompare(a.list[0].start) || byName(a, b)
        : b.list.length - a.list.length || byName(a, b));
    // the people who could be on a team (active, in Unit 12, a Controller, VR, Panel or Field Operator) and never were
    const pool = [...dir.values()].filter((r) => r.is_active && r.in_unit12_scope && posOf(r.position_code) !== 'other' && !by.has(r.id));
    const never = pool.filter(keep).map((r) => ({ id: r.id, r }))
      .sort((a, b) => sort === 'number' ? Number(a.r.employee_number) - Number(b.r.employee_number) : byName(a, b));
    return { rows, never, neverAll: pool.length, tookAll: by.size };
  }, [dir, plans, members, query, crew, pos, sort, exPos, exGrade]);
  const grades = useMemo(() => [...new Set([...(dir?.values() ?? [])].filter((r) => r.in_unit12_scope && r.grade != null).map((r) => r.grade as number))].sort((a, b) => a - b), [dir]);
  if (err) return <ErrorBox error={err} />;
  if (!dir) return <Spinner />;
  const total = rows.reduce((n, x) => n + x.list.length, 0);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {([['in', `Took part · ${tookAll}`], ['out', `Never took part · ${neverAll}`]] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={mode === k} onClick={() => { setMode(k); if (k === 'out' && (sort === 'most' || sort === 'latest')) setSort('name'); if (k === 'in' && sort === 'name') setSort('most'); }}
            className={cx('min-h-9 rounded-lg font-medium', mode === k ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{l}</button>
        ))}
      </div>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input" style={{ paddingLeft: '2.25rem' }} placeholder="Search name or number" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {(['all', 'A', 'B', 'C', 'D', 'day'] as const).map((c) => (
          <button key={c} type="button" aria-pressed={crew === c} onClick={() => setCrew(c)}
            className={cx('flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1', crew === c ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>
            {c === 'all' ? 'All shifts' : c === 'day' ? 'Day staff' : <><CrewBadge crew={c} size="sm" /> {c}</>}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {([['all', 'All positions'], ['controller', 'Controller'], ['vr', 'VR'], ['panel', 'Panel'], ['field', 'Field']] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={pos === k} onClick={() => setPos(k)}
            className={cx('min-h-9 shrink-0 rounded-full px-3 text-sm font-medium ring-1', pos === k ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{l}</button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        <span className="shrink-0 text-xs font-medium text-slate-600">Exclude</span>
        {([['controller', 'Controller'], ['vr', 'VR'], ['panel', 'Panel'], ['field', 'Field']] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={exPos.has(k)} onClick={() => toggle(exPos, k, setExPos)}
            className={cx('min-h-8 shrink-0 rounded-full px-2.5 text-xs font-medium ring-1', exPos.has(k) ? 'bg-red-50 text-status-red line-through ring-red-300' : 'bg-white text-slate-700 ring-slate-300')}>{l}</button>
        ))}
        <span className="mx-0.5 h-4 w-px shrink-0 bg-slate-300" />
        {grades.map((g) => (
          <button key={g} type="button" aria-pressed={exGrade.has(g)} onClick={() => toggle(exGrade, g, setExGrade)}
            className={cx('min-h-8 shrink-0 rounded-full px-2.5 text-xs font-medium ring-1', exGrade.has(g) ? 'bg-red-50 text-status-red line-through ring-red-300' : 'bg-white text-slate-700 ring-slate-300')}>G{g}</button>
        ))}
        {(exPos.size > 0 || exGrade.size > 0) && <button type="button" onClick={() => { setExPos(new Set()); setExGrade(new Set()); }} className="shrink-0 px-1 text-xs font-medium text-brand-700">Clear</button>}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <span className="shrink-0 font-medium">Sort</span>
        <div className={cx('grid flex-1 gap-1 rounded-lg bg-slate-100 p-0.5', mode === 'in' ? 'grid-cols-4' : 'grid-cols-2')}>
          {([['most', 'Most times'], ['name', 'Name'], ['number', 'Number'], ['latest', 'Latest']] as const).filter(([k]) => mode === 'in' || k === 'name' || k === 'number').map(([k, l]) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className={cx('min-h-8 rounded-md font-medium', sort === k ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{l}</button>
          ))}
        </div>
      </div>
      {mode === 'out' ? <>
        <p className="px-1 text-xs text-slate-500">{never.length} {never.length === 1 ? 'person' : 'people'} never on a shutdown team (active in Unit 12) · {plans.length} {plans.length === 1 ? 'shutdown' : 'shutdowns'} recorded</p>
        {never.length === 0 ? <Card><p className="text-sm text-slate-500">Nobody matches.</p></Card> : (
          <Card className="divide-y divide-slate-100 p-0">
            {never.map(({ id, r }) => {
              const level = (r.position_code === 'field_operator' || r.position_code === 'panel_operator') && r.fo_level ? FO_LEVEL_LABEL[r.fo_level] : null;
              const eligible = r.position_code === 'panel_operator' || r.position_code === 'field_operator' ? sdOperatorEligible({ role: r.position_code, grade: r.grade, employmentType: r.employment_type }) : true;
              return (
                <Link key={id} to={`/employees/${id}`} className="flex items-center gap-2.5 px-3 py-2.5 active:bg-slate-50">
                  {isCrew(r.crew_code) ? <CrewBadge crew={r.crew_code} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-600">{r.position_code === 'vr_controller' ? 'VR' : 'DS'}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5"><span className="truncate text-sm font-medium text-slate-900">{r.display_name}</span><span className="shrink-0 text-xs tabular-nums text-slate-500">#{r.employee_number}</span></span>
                    <span className="block text-xs text-slate-500">{r.position_label ?? '—'}{r.grade ? ` · Grade ${r.grade}` : ''}{r.employment_type === 'contractor' ? ' · Contractor' : ''}{level ? ` · ${level}` : ''}{!eligible ? ' · not eligible for a team place' : ''}</span>
                  </span>
                  <span className="shrink-0 text-lg font-semibold tabular-nums text-slate-300">0×</span>
                </Link>
              );
            })}
          </Card>
        )}
      </> : <>
      <p className="px-1 text-xs text-slate-500">{rows.length} {rows.length === 1 ? 'person' : 'people'} · {total} {total === 1 ? 'time' : 'times'} on a shutdown team · {plans.length} {plans.length === 1 ? 'shutdown' : 'shutdowns'} recorded</p>
      {rows.length === 0 ? <Card><p className="text-sm text-slate-500">Nobody matches.</p></Card> : (
        <Card className="divide-y divide-slate-100 p-0">
          {rows.map(({ id, r, list }) => (
            <Link key={id} to={`/employees/${id}`} className="flex items-start gap-2.5 px-3 py-2.5 active:bg-slate-50">
              {r && isCrew(r.crew_code) ? <span className="mt-0.5"><CrewBadge crew={r.crew_code} size="sm" /></span> : <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-600">{r?.position_code === 'vr_controller' ? 'VR' : 'DS'}</span>}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5"><span className="truncate text-sm font-medium text-slate-900">{r?.display_name}</span><span className="shrink-0 text-xs tabular-nums text-slate-500">#{r?.employee_number}</span>{r && !r.is_active && <span className="shrink-0 text-[10px] font-semibold text-slate-400">inactive</span>}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {list.map((p) => <span key={p.id} className={cx('rounded-md px-1.5 py-0.5 text-[11px]', p.start > today ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'bg-slate-100 text-slate-700')}>{p.title} · {monthSpan(p.start, p.end)}{p.start > today ? ' · planned' : ''}</span>)}
                </span>
              </span>
              <span className="shrink-0 text-right"><span className="block text-lg font-semibold leading-tight tabular-nums text-brand-800">{list.length}×</span></span>
            </Link>
          ))}
        </Card>
      )}
      </>}
    </div>
  );
}

function NewPlanSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const today = localToday();
  const [events, setEvents] = useState<{ id: string; label: string; start: string; end: string }[]>([]);
  const [eventId, setEventId] = useState('');
  const [kind, setKind] = useState<SdKind>('train');
  const [title, setTitle] = useState(''); const [start, setStart] = useState(today); const [end, setEnd] = useState(today);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    fetchCalendarInfo(today, `${Number(today.slice(0, 4)) + 2}-12-31`).then((i) => setEvents(i.events.filter((e) => e.category === 'shutdown')
      .map((e) => ({ id: e.id, label: `${e.unit ? `${e.unit} ` : ''}${e.title}`, start: e.start, end: e.end })))).catch(setErr);
  }, [today]);
  function pickEvent(id: string) { setEventId(id); const e = events.find((x) => x.id === id); if (e) { setTitle(e.label); setStart(e.start); setEnd(e.end); } }
  async function save() {
    setBusy(true); setErr(null);
    try { const id = await createSdPlan({ title: title.trim(), start, end, eventId: eventId || null, kind }); navigate(`/shutdown/${id}`); } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="New shutdown plan">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1.5">
          {([['train', 'Train shutdown'], ['total', 'Total turnaround']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={cx('rounded-lg px-2 py-2 text-sm font-medium ring-1', kind === k ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{l}</button>
          ))}
        </div>
        <Field label="Shutdown (from the Calendar)">
          <select className="input" value={eventId} onChange={(e) => pickEvent(e.target.value)}>
            <option value="">Not linked</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.label} · {shortDate(e.start)} – {shortDate(e.end)}</option>)}
          </select>
        </Field>
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Train-1 SD" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Last day"><input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-slate-500">{kind === 'total'
          ? 'Starts with a Morning and a Night shift, each 2 Controllers and 5 operators in TR-II and 5 in L.P & TR-I, everyone every day, 12 h, overtime ≤ 80 h. Areas, phases and numbers are all editable.'
          : 'Starts with a Morning and a Night team (Controller 1 · Senior 2 · Good 2 · New 1), 3 on / 1 off, 12 h, first and last 2 days 8 h, overtime ≤ 80 h. All editable.'}</p>
        {err != null && <ErrorBox error={err} />}
        <Button className="w-full" disabled={busy || !title.trim() || end < start} onClick={save}>Create</Button>
      </div>
    </BottomSheet>
  );
}

/** Rename or move a shutdown, or delete it (kept in the audit history; its people are back with their crews). */
function EditPlanSheet({ plan, people, onClose, onDone }: { plan: SdPlan; people: number; onClose: () => void; onDone: (m: string) => void }) {
  const [title, setTitle] = useState(plan.title); const [start, setStart] = useState(plan.start); const [end, setEnd] = useState(plan.end);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function run(f: () => Promise<void>, msg: string) { setBusy(true); setErr(null); try { await f(); onDone(msg); } catch (e) { setErr(e); setBusy(false); } }
  const save = () => run(() => updateSdPlan(plan.id, { title: title.trim(), start_date: start, end_date: end }), `${title.trim()} saved.`);
  const remove = () => run(() => updateSdPlan(plan.id, { status: 'cancelled' }), `${plan.title} deleted.`);
  return (
    <BottomSheet open onClose={onClose} title={plan.title}>
      <div className="space-y-3">
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Last day"><input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <p className="text-[11px] text-slate-500">The pattern, hours, teams and people are edited inside the shutdown. {people} {people === 1 ? 'person is' : 'people are'} on this one.</p>
        {err != null && <ErrorBox error={err} />}
        {confirm && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
            Delete <b>{plan.title}</b> ({shortDate(plan.start)} – {shortDate(plan.end)})? {people > 0 ? `Its ${people} ${people === 1 ? 'person goes' : 'people go'} back to their crews on those dates. ` : ''}It is kept in the audit history. The Calendar event and any operating mode set for these dates stay as they are.
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>Keep it</Button>
              <Button variant="danger" disabled={busy} onClick={remove}><Trash2 className="h-4 w-4" />Yes, delete</Button>
            </div>
          </div>
        )}
        {!confirm && (
          <div className="flex gap-2">
            <Button variant="danger" className="flex-1" disabled={busy} onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete</Button>
            <Button className="flex-1" disabled={busy || !title.trim() || end < start} onClick={save}>Save</Button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
