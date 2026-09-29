import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pencil, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { coverOfBlock, daysInYearRange, yearSegment } from '@/core/calendar';
import { firstDayBack } from '@/core/leave';
import { isWorkingDay, type Crew } from '@/core/roster';
import { fetchLeavePlan, type LeavePlanData } from '@/data/leave';
import type { EmployeeDirectoryRow, LeaveRecord } from '@/data/types';
import { Button, Card, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';
import { CrewBadge, CrewTag, crewEdge, isCrew } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { byPositionAndService, positionGroup } from '@/ui/positions';
import { LeaveSheet, SOURCE_LABEL, changeLabel, type LeaveTarget, type SheetPerson } from './LeaveSheet';

const GROUPS = ['A', 'B', 'C', 'D', 'day'] as const;
type Group = (typeof GROUPS)[number];
const ROLE_SHORT: Record<string, string> = { controller: 'Controller', panel_operator: 'Panel', field_operator: 'Field', vr_controller: 'VR', morning_controller: 'Morning Controller' };
const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

const counts = (l: LeaveRecord) => l.in_current_plan && (l.status === 'approved' || l.status === 'planned');
const range = (s: string, e: string) => (s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}`);
const dayCount = (s: string, e: string) => Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1;
const groupOf = (p: EmployeeDirectoryRow): Group => (isCrew(p.crew_code) ? p.crew_code : 'day');

export default function LeavePlanPage() {
  const [params, setParams] = useSearchParams();
  const today = localToday();
  const year = Number(params.get('year')) || Number(today.slice(0, 4));
  const filter = (params.get('crew') ?? 'all') as Group | 'all';
  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v === null) n.delete(k); else n.set(k, v); setParams(n, { replace: true }); };

  const [data, setData] = useState<LeavePlanData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<LeaveTarget | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // three layouts to choose from (kept on this device)
  const [layout, setLayoutState] = useState<Layout>(() => { try { const v = localStorage.getItem('leave-plan-layout'); return v === 'months' || v === 'next' ? v : 'strip'; } catch { return 'strip'; } });
  const setLayout = (v: Layout) => { setLayoutState(v); try { localStorage.setItem('leave-plan-layout', v); } catch { /* private mode */ } };
  const load = useCallback(() => { setError(null); fetchLeavePlan(year).then(setData).catch(setError); }, [year]);
  useEffect(() => { setData(null); load(); }, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const leavesOf = new Map<string, LeaveRecord[]>();
    for (const l of data.leaves) leavesOf.set(l.employee_id, [...(leavesOf.get(l.employee_id) ?? []), l]);
    const q = query.trim().toLowerCase();
    const people = data.people
      .filter((p) => (filter === 'all' || groupOf(p) === filter) && (!q || p.display_name.toLowerCase().includes(q) || p.employee_number.includes(q)))
      .sort(byPositionAndService);
    const groups = GROUPS.map((g) => {
      const rows = people.filter((p) => groupOf(p) === g).map((p) => {
        const all = leavesOf.get(p.id) ?? [];
        const current = all.filter(counts).sort((a, b) => a.start_date.localeCompare(b.start_date));
        const days = current.reduce((n, l) => n + daysInYearRange(l.start_date, l.end_date, year), 0);
        const onLeave = current.some((l) => l.start_date <= today && today <= l.end_date);
        return { p, all, current, days, onLeave };
      });
      return { g, rows, onLeave: rows.filter((r) => r.onLeave).length };
    }).filter((x) => x.rows.length);
    const sheetPeople: SheetPerson[] = data.people.map((p) => ({ id: p.id, name: p.display_name, crew: isCrew(p.crew_code) ? p.crew_code : null })).sort((a, b) => a.name.localeCompare(b.name));
    return { groups, sheetPeople };
  }, [data, filter, query, today, year]);

  const thisMonth = today.slice(0, 4) === String(year) ? Number(today.slice(5, 7)) - 1 : -1;
  const todayPos = today.slice(0, 4) === String(year) ? yearSegment(today, today, year)?.left ?? null : null;
  const done = (m: string) => { setSheet(null); setFlash(m); load(); };

  return (
    <div>
      <PageHeader title="Leave plan" info="The current plan: monthly sheets, PV plan and leave entered by hand. Tap a person for dates and history."
        action={<Button className="min-h-10 shrink-0 px-3" onClick={() => setSheet({ kind: 'add' })}><Plus className="h-4 w-4" /> Add</Button>} />

      <div className="mb-3 flex items-center gap-2">
        <button aria-label="Previous year" onClick={() => setParam('year', String(year - 1))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300"><ChevronLeft className="h-5 w-5" /></button>
        <div className="flex-1 text-center text-lg font-semibold text-brand-800">{year}</div>
        <button aria-label="Next year" onClick={() => setParam('year', String(year + 1))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300"><ChevronRight className="h-5 w-5" /></button>
        <Link to="/calendar" className="flex h-10 shrink-0 items-center gap-1 rounded-xl bg-white px-3 text-sm font-medium text-brand-700 ring-1 ring-slate-300"><CalendarDays className="h-4 w-4" /> Calendar</Link>
      </div>

      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
        {(['all', ...GROUPS] as const).map((g) => (
          <button key={g} type="button" aria-pressed={filter === g} onClick={() => setParam('crew', g === 'all' ? null : g)}
            className={cx('flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1', filter === g ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>
            {isCrew(g) ? <><CrewBadge crew={g} size="sm" /> {g}</> : g === 'all' ? 'All' : 'Day staff'}
          </button>
        ))}
      </div>
      <div className="mb-2 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Layout">
        {LAYOUTS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={layout === k} onClick={() => setLayout(k)}
            className={cx('min-h-8 rounded-lg text-xs font-semibold', layout === k ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500')}>{l}</button>
        ))}
      </div>
      <label className="relative mb-3 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input" style={{ paddingLeft: '2.25rem' }} placeholder="Search name or number" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      {flash && <div role="status" className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">{flash}</div>}
      {error ? <ErrorBox error={error} /> : !view ? <Spinner /> : view.groups.length === 0 ? <p className="text-sm text-slate-500">Nobody matches.</p> : (
        <div className="space-y-3">
          {view.groups.map(({ g, rows, onLeave }) => (
            <Card key={g} className={cx('p-0', isCrew(g) && crewEdge(g))}>
              <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
                <h2 className="text-sm font-semibold text-slate-800">{isCrew(g) ? <CrewTag crew={g} size="md" /> : 'Day staff'}</h2>
                <span className="text-xs text-slate-500">{onLeave} on leave today</span>
              </div>
              {layout !== 'next' && (
                <div className="flex items-end gap-2 px-3 pb-1 text-[10px] text-slate-400">
                  <span className="w-24 shrink-0 sm:w-40" />
                  <span className="flex flex-1 justify-between">{MONTH_LETTERS.map((m, i) => <span key={i} className={cx('w-0 flex-1 text-center', layout === 'months' && i === thisMonth && 'font-bold text-brand-700')}>{m}</span>)}</span>
                  <span className="w-8 shrink-0 text-right">days</span>
                </div>
              )}
              {/* rows by position, a thin line between the groups; longest-serving first */}
              {positionRuns(rows).map((run) => (
                <div key={run.group} className="border-t border-slate-200 first:border-t-0">
                  <div className="px-3 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{run.group}</div>
                  <ul className="divide-y divide-slate-100">
                    {run.rows.map((r) => (
                      <li key={r.p.id}>
                        <button type="button" aria-expanded={open === r.p.id} onClick={() => setOpen(open === r.p.id ? null : r.p.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left active:bg-slate-50">
                          <span className="w-24 shrink-0 sm:w-40">
                            <span className="block truncate text-xs font-medium text-slate-800 sm:text-sm">{r.p.display_name}</span>
                            <span className="block text-[10px] tabular-nums text-slate-400">#{r.p.employee_number}</span>
                          </span>
                          {layout === 'strip' && <><YearStrip year={year} blocks={r.current} todayPos={todayPos} /><span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-600">{r.days || '—'}</span></>}
                          {layout === 'months' && <><MonthCells year={year} blocks={r.current} thisMonth={thisMonth} /><span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">{r.days || '—'}</span></>}
                          {layout === 'next' && <NextLeave blocks={r.current} today={today} days={r.days} year={year} />}
                        </button>
                        {open === r.p.id && data && <PersonDetail row={r} year={year} data={data} today={today} onEdit={(rec) => setSheet({ kind: 'edit', record: rec })} onAdd={() => setSheet({ kind: 'add', employeeId: r.p.id })} />}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Card>
          ))}
          <p className="px-1 text-xs text-slate-500">{layout === 'strip' ? 'Yellow = leave · outlined = by hand · line = today' : layout === 'months' ? 'Leave days in each month · darker = more days · this month in bold' : 'On leave now or the next leave · days = total this year'}</p>
        </div>
      )}
      {sheet && view && data && <LeaveSheet target={sheet} people={view.sheetPeople} types={data.types} onClose={() => setSheet(null)} onDone={done} />}
    </div>
  );
}

type Layout = 'strip' | 'months' | 'next';
const LAYOUTS: [Layout, string][] = [['strip', '1 · Year strip'], ['months', '2 · Month grid'], ['next', '3 · Next leave']];

/** Consecutive rows of the same position group (the rows are already in position order). */
function positionRuns<T extends { p: EmployeeDirectoryRow }>(rows: T[]) {
  const out: { group: string; rows: T[] }[] = [];
  for (const r of rows) { const g = positionGroup(r.p.position_code); if (out[out.length - 1]?.group === g) out[out.length - 1].rows.push(r); else out.push({ group: g, rows: [r] }); }
  return out;
}

/** Layout 2: leave days in each month of the year, shaded by how many. */
function MonthCells({ year, blocks, thisMonth }: { year: number; blocks: LeaveRecord[]; thisMonth: number }) {
  const days = Array.from({ length: 12 }, (_, m) => {
    const from = `${year}-${String(m + 1).padStart(2, '0')}-01`;
    const to = new Date(Date.UTC(year, m + 1, 0)).toISOString().slice(0, 10);
    return blocks.reduce((n, l) => (l.start_date <= to && l.end_date >= from ? n + dayCount(l.start_date < from ? from : l.start_date, l.end_date > to ? to : l.end_date) : n), 0);
  });
  return (
    <span className="grid flex-1 grid-cols-12 gap-0.5" aria-hidden>
      {days.map((n, m) => (
        <span key={m} className={cx('flex h-6 items-center justify-center overflow-hidden rounded-[3px] text-[9px] font-bold tabular-nums tracking-tighter',
          n === 0 ? 'bg-slate-100 text-transparent' : n < 10 ? 'bg-yellow-100 text-yellow-900' : n < 20 ? 'bg-yellow-300 text-yellow-950' : 'bg-amber-500 text-amber-950',
          m < thisMonth && 'opacity-60', m === thisMonth && 'ring-1 ring-brand-700')}>{n || '·'}</span>
      ))}
    </span>
  );
}

/** Layout 3: on leave now (until when) or the next leave (when, how long, how soon); the year's total. */
function NextLeave({ blocks, today, days, year }: { blocks: LeaveRecord[]; today: string; days: number; year: number }) {
  const now = blocks.find((l) => l.start_date <= today && today <= l.end_date);
  const next = blocks.find((l) => l.start_date > today);
  const inDays = next ? Math.round((Date.parse(next.start_date) - Date.parse(today)) / 864e5) : 0;
  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
      <span className="min-w-0">
        {now ? <span className="inline-flex items-center rounded-full bg-yellow-400 px-2 py-0.5 text-[11px] font-semibold text-yellow-950">On leave until {shortDate(now.end_date)}</span>
          : next ? <span className="block truncate text-xs text-slate-700"><span className="font-semibold">{range(next.start_date, next.end_date)}</span> · {dayCount(next.start_date, next.end_date)} d</span>
          : <span className="text-xs text-slate-400">No leave ahead in {year}</span>}
        {!now && next && <span className={cx('block text-[10px]', inDays <= 14 ? 'font-semibold text-amber-700' : 'text-slate-400')}>{inDays === 1 ? 'tomorrow' : `in ${inDays} days`}</span>}
        {now && next && <span className="block text-[10px] text-slate-400">then {range(next.start_date, next.end_date)}</span>}
      </span>
      <span className="shrink-0 text-right"><span className="block text-xs font-semibold tabular-nums text-slate-700">{days || '—'}</span><span className="block text-[9px] text-slate-400">days</span></span>
    </span>
  );
}

function YearStrip({ year, blocks, todayPos }: { year: number; blocks: LeaveRecord[]; todayPos: number | null }) {
  return (
    <span className="relative h-4 flex-1 overflow-hidden rounded bg-slate-100" aria-hidden>
      {Array.from({ length: 11 }, (_, i) => <span key={i} className="absolute inset-y-0 w-px bg-white" style={{ left: `${((i + 1) / 12) * 100}%` }} />)}
      {blocks.map((l) => {
        const seg = yearSegment(l.start_date, l.end_date, year);
        return seg && <span key={l.id} className={cx('absolute inset-y-0.5 rounded-sm bg-yellow-400', l.hand_corrected && 'ring-1 ring-inset ring-yellow-800')} style={{ left: `${seg.left * 100}%`, width: `max(3px, ${seg.width * 100}%)` }} />;
      })}
      {todayPos !== null && <span className="absolute inset-y-0 w-0.5 bg-brand-700" style={{ left: `${todayPos * 100}%` }} />}
    </span>
  );
}

interface Row { p: EmployeeDirectoryRow; all: LeaveRecord[]; current: LeaveRecord[]; days: number; onLeave: boolean }

function PersonDetail({ row, year, data, today, onEdit, onAdd }: { row: Row; year: number; data: LeavePlanData; today: string; onEdit: (l: LeaveRecord) => void; onAdd: () => void }) {
  const [history, setHistory] = useState(false);
  const { p, current } = row;
  const crew: Crew | null = isCrew(p.crew_code) ? p.crew_code : null;
  const type = (code: string | null) => data.types.find((t) => t.code === code);
  const name = (id: string) => data.people.find((x) => x.id === id)?.display_name ?? 'Controller';
  const absentOn = (d: string) => current.some((l) => l.start_date <= d && d <= l.end_date);
  const isController = p.position_code === 'controller' && crew !== null;
  const crewCovers = isController ? data.covers.filter((c) => c.crew_code === crew).map((c) => ({ employeeId: c.employee_id, start: c.start_date, end: c.end_date })) : [];
  const changes = data.changes.filter((c) => c.employee_id === p.id && [c.from_start, c.from_end, c.to_start, c.to_end].some((d) => d && d.slice(0, 4) === String(year)));

  return (
    <div className="bg-slate-50 px-3 pb-3 pt-1">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>{ROLE_SHORT[p.position_code ?? ''] ?? p.position_label ?? '—'}{p.grade ? ` · Grade ${p.grade}` : ''}</span>
        <Link to={`/employees/${p.id}`} className="font-medium text-brand-700">Open profile</Link>
      </div>
      {current.length === 0 && <p className="py-1 text-sm text-slate-500">No leave in {year}</p>}
      <ul className="divide-y divide-slate-200">
        {current.map((l) => {
          const back = firstDayBack(l.end_date, crew, absentOn);
          const cover = isController ? coverOfBlock(l.start_date, l.end_date, crewCovers, (d) => isWorkingDay(d, crew!)) : null;
          const past = l.end_date < today;
          return (
            <li key={l.id} className="flex items-start gap-2 py-2">
              <span className="mt-0.5 inline-flex min-w-11 justify-center rounded-md bg-yellow-100 px-1.5 py-0.5 text-xs font-bold text-yellow-900 ring-1 ring-yellow-300">{type(l.absence_type_code)?.short_code ?? '—'}</span>
              <span className="min-w-0 flex-1">
                <span className={cx('block text-sm font-medium', past ? 'text-slate-500' : 'text-slate-800')}>{range(l.start_date, l.end_date)} <span className="font-normal text-slate-500">· {dayCount(l.start_date, l.end_date)} d{past ? '' : ` · back ${shortDate(back)}`}</span></span>
                <span className="block text-xs text-slate-500">{type(l.absence_type_code)?.label ?? 'Leave'} · {l.hand_corrected ? (l.source_kind === 'manual' ? SOURCE_LABEL.manual : 'Corrected by hand') : SOURCE_LABEL[l.source_kind]}</span>
                {cover && (cover.covers.length > 0
                  ? <span className="block text-xs text-slate-600">Covered by {[...new Set(cover.covers.map((c) => name(c.employeeId)))].join(', ')}{cover.uncoveredDutyDays ? ` · ${cover.uncoveredDutyDays} duty day${cover.uncoveredDutyDays === 1 ? '' : 's'} without cover` : ''}</span>
                  : !past && cover.uncoveredDutyDays > 0 && <span className="block text-xs text-slate-700">No cover recorded · {cover.uncoveredDutyDays} duty day{cover.uncoveredDutyDays === 1 ? '' : 's'}{<> · <Link to={`/controllers?assign=cover&crew=${crew}&from=${l.start_date}`} className="font-semibold text-brand-700 underline">Assign cover</Link></>}</span>)}
              </span>
              <button type="button" aria-label="Correct or cancel" onClick={() => onEdit(l)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-brand-700 hover:bg-white"><Pencil className="h-4 w-4" /></button>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex items-center justify-between gap-2">
        <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={onAdd}><Plus className="h-4 w-4" /> Add leave</Button>
        {changes.length > 0 && (
          <button type="button" onClick={() => setHistory(!history)} aria-expanded={history} className="flex items-center gap-1 text-xs font-medium text-slate-600">
            History ({changes.length}) {history ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {history && (
        <ul className="mt-1 divide-y divide-slate-200 text-xs">
          {changes.map((c) => (
            <li key={c.id} className="py-1.5">
              <div className="flex justify-between gap-2"><span className="font-medium text-slate-700">{changeLabel(c)}</span><span className="shrink-0 text-slate-400">{new Date(c.created_at).toLocaleDateString('en-GB')}</span></div>
              <div className="text-slate-600">{c.from_start ? range(c.from_start, c.from_end ?? c.from_start) : ''}{c.from_start && c.to_start ? ' → ' : ''}{c.to_start ? range(c.to_start, c.to_end ?? c.to_start) : ''}</div>
              {c.note && <div className="text-slate-500">{c.note}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
