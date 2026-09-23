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
import { LeaveSheet, SOURCE_LABEL, changeLabel, type LeaveTarget, type SheetPerson } from './LeaveSheet';

const GROUPS = ['A', 'B', 'C', 'D', 'day'] as const;
type Group = (typeof GROUPS)[number];
const ROLE_ORDER: Record<string, number> = { controller: 0, panel_operator: 1, field_operator: 2 };
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
  const load = useCallback(() => { setError(null); fetchLeavePlan(year).then(setData).catch(setError); }, [year]);
  useEffect(() => { setData(null); load(); }, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const leavesOf = new Map<string, LeaveRecord[]>();
    for (const l of data.leaves) leavesOf.set(l.employee_id, [...(leavesOf.get(l.employee_id) ?? []), l]);
    const q = query.trim().toLowerCase();
    const people = data.people
      .filter((p) => (filter === 'all' || groupOf(p) === filter) && (!q || p.display_name.toLowerCase().includes(q) || p.employee_number.includes(q)))
      .sort((a, b) => (ROLE_ORDER[a.position_code ?? ''] ?? 9) - (ROLE_ORDER[b.position_code ?? ''] ?? 9) || a.display_name.localeCompare(b.display_name));
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

  const todayPos = today.slice(0, 4) === String(year) ? yearSegment(today, today, year)?.left ?? null : null;
  const done = (m: string) => { setSheet(null); setFlash(m); load(); };

  return (
    <div>
      <PageHeader title="Annual Leave Plan" subtitle="The current plan: monthly sheets, PV plan and leave entered by hand. Tap a person for dates and history."
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
              <div className="flex items-end gap-2 px-3 pb-1 text-[10px] text-slate-400">
                <span className="w-24 shrink-0 sm:w-40" />
                <span className="flex flex-1 justify-between">{MONTH_LETTERS.map((m, i) => <span key={i} className="w-0 flex-1 text-center">{m}</span>)}</span>
                <span className="w-8 shrink-0 text-right">days</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <li key={r.p.id}>
                    <button type="button" aria-expanded={open === r.p.id} onClick={() => setOpen(open === r.p.id ? null : r.p.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left active:bg-slate-50">
                      <span className="w-24 shrink-0 truncate text-xs font-medium text-slate-800 sm:w-40 sm:text-sm">{r.p.display_name}</span>
                      <YearStrip year={year} blocks={r.current} todayPos={todayPos} />
                      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-600">{r.days || '—'}</span>
                    </button>
                    {open === r.p.id && data && <PersonDetail row={r} year={year} data={data} today={today} onEdit={(rec) => setSheet({ kind: 'edit', record: rec })} onAdd={() => setSheet({ kind: 'add', employeeId: r.p.id })} />}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          <p className="px-1 text-xs text-slate-500">Yellow = leave in the current plan (outlined = entered or corrected by hand). The line marks today. Leave days count calendar days in {year}.</p>
        </div>
      )}
      {sheet && view && data && <LeaveSheet target={sheet} people={view.sheetPeople} types={data.types} onClose={() => setSheet(null)} onDone={done} />}
    </div>
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
      {current.length === 0 && <p className="py-1 text-sm text-slate-500">No leave in the current plan for {year}.</p>}
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
