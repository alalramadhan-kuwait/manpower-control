import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pencil, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MONTH_NAMES, coverOfBlock, daysInYearRange, monthEnd, monthStart, monthWeeks, shiftMonth } from '@/core/calendar';
import { firstDayBack } from '@/core/leave';
import { isWorkingDay, type Crew } from '@/core/roster';
import { fetchLeavePlan, type LeavePlanData } from '@/data/leave';
import type { EmployeeDirectoryRow, LeaveRecord } from '@/data/types';
import { Button, Card, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';
import { CREW_IDENTITY, CrewBadge, CrewTag, crewEdge, isCrew } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { byPositionAndService, positionGroup } from '@/ui/positions';
import { LeaveSheet, SOURCE_LABEL, changeLabel, type LeaveTarget, type SheetPerson } from './LeaveSheet';
import { leaveToneShort } from '@/ui/leaveTypes';
import { EstimatedTag } from '@/ui/LeaveCodes';

const GROUPS = ['A', 'B', 'C', 'D', 'day'] as const;
type Group = (typeof GROUPS)[number];
const ROLE_SHORT: Record<string, string> = { controller: 'Controller', panel_operator: 'Panel', field_operator: 'Field', vr_controller: 'VR', morning_controller: 'Morning Controller' };
const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

const counts = (l: LeaveRecord) => l.in_current_plan && (l.status === 'approved' || l.status === 'planned');
const range = (s: string, e: string) => (s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}`);
const dayCount = (s: string, e: string) => Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1;
const groupOf = (p: EmployeeDirectoryRow): Group => (isCrew(p.crew_code) ? p.crew_code : 'day');
const CONTROLLER_CODES = ['controller', 'vr_controller', 'morning_controller'];

export default function LeavePlanPage() {
  const [params, setParams] = useSearchParams();
  const today = localToday();
  const year = Number(params.get('year')) || Number(today.slice(0, 4));
  const filter = (params.get('crew') ?? 'all') as Group | 'all';
  // Year: leave days in each month. Month: one month by weeks, each day of the week shown
  const mode = params.get('view') === 'month' ? 'month' : 'year';
  const thisMonthNo = today.slice(0, 4) === String(year) ? Number(today.slice(5, 7)) : 0;
  const month = Math.min(12, Math.max(1, Number(params.get('month')) || thisMonthNo || 1));
  const goMonth = (by: number) => { const [y, m] = shiftMonth(year, month, by); const n = new URLSearchParams(params); n.set('year', String(y)); n.set('month', String(m)); setParams(n, { replace: true }); };
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
    // Controllers of every crew (and the VR / Morning Controllers, who serve all crews) in their own table
    const isCtl = (p: EmployeeDirectoryRow) => CONTROLLER_CODES.includes(p.position_code ?? '');
    const people = data.people
      .filter((p) => (filter === 'all' || groupOf(p) === filter || (isCtl(p) && !isCrew(p.crew_code))) && (!q || p.display_name.toLowerCase().includes(q) || p.employee_number.includes(q)))
      .sort(byPositionAndService);
    const ctlOrder = (p: EmployeeDirectoryRow) => (isCrew(p.crew_code) ? 'ABCD'.indexOf(p.crew_code) : 4 + CONTROLLER_CODES.indexOf(p.position_code ?? ''));
    const groups = (['ctl', ...GROUPS] as const).map((g) => {
      const members = g === 'ctl' ? people.filter(isCtl).sort((a, b) => ctlOrder(a) - ctlOrder(b)) : people.filter((p) => !isCtl(p) && groupOf(p) === g);
      const rows = members.map((p) => {
        const all = leavesOf.get(p.id) ?? [];
        const current = all.filter(counts).sort((a, b) => a.start_date.localeCompare(b.start_date));
        const days = mode === 'month'
          ? current.reduce((n, l) => (l.start_date <= monthEnd(year, month) && l.end_date >= monthStart(year, month) ? n + dayCount(l.start_date < monthStart(year, month) ? monthStart(year, month) : l.start_date, l.end_date > monthEnd(year, month) ? monthEnd(year, month) : l.end_date) : n), 0)
          : current.reduce((n, l) => n + daysInYearRange(l.start_date, l.end_date, year), 0);
        const onLeave = current.some((l) => l.start_date <= today && today <= l.end_date);
        return { p, all, current, days, onLeave };
      });
      return { g, rows, onLeave: rows.filter((r) => r.onLeave).length };
    }).filter((x) => x.rows.length);
    const sheetPeople: SheetPerson[] = data.people.map((p) => ({ id: p.id, name: p.display_name, crew: isCrew(p.crew_code) ? p.crew_code : null })).sort((a, b) => a.name.localeCompare(b.name));
    return { groups, sheetPeople };
  }, [data, filter, mode, month, query, today, year]);

  const weeks = useMemo(() => monthWeeks(year, month), [year, month]);
  // types on leave somewhere in the month shown (for the colour key)
  const legend = useMemo(() => {
    if (!data || mode !== 'month') return [];
    const from = monthStart(year, month), to = monthEnd(year, month);
    const used = new Set(data.leaves.filter((l) => counts(l) && l.start_date <= to && l.end_date >= from).map((l) => l.absence_type_code));
    return data.types.filter((t) => used.has(t.code));
  }, [data, mode, month, year]);
  const thisMonth = today.slice(0, 4) === String(year) ? Number(today.slice(5, 7)) - 1 : -1;
  const done = (m: string) => { setSheet(null); setFlash(m); load(); };

  return (
    <div>
      <PageHeader title="Leave plan" info="The current plan: monthly sheets, PV plan and leave entered by hand. Tap a person for dates and history."
        action={<Button className="min-h-10 shrink-0 px-3" onClick={() => setSheet({ kind: 'add' })}><Plus className="h-4 w-4" /> Add</Button>} />

      <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {(['year', 'month'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setParam('view', m === 'year' ? null : m)}
            className={cx('min-h-9 rounded-lg font-medium', mode === m ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{m === 'year' ? 'Year' : 'Month by weeks'}</button>
        ))}
      </div>
      <div className="mb-3 flex items-center gap-2">
        <button aria-label={mode === 'month' ? 'Previous month' : 'Previous year'} onClick={() => (mode === 'month' ? goMonth(-1) : setParam('year', String(year - 1)))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300"><ChevronLeft className="h-5 w-5" /></button>
        <div className="flex-1 text-center text-lg font-semibold text-brand-800">{mode === 'month' ? `${MONTH_NAMES[month - 1]} ${year}` : year}</div>
        <button aria-label={mode === 'month' ? 'Next month' : 'Next year'} onClick={() => (mode === 'month' ? goMonth(1) : setParam('year', String(year + 1)))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300"><ChevronRight className="h-5 w-5" /></button>
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
            <Card key={g} className={cx('p-0', isCrew(g) && crewEdge(g), g === 'ctl' && 'border-l-[6px] border-l-brand-700')}>
              <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
                <h2 className="text-sm font-semibold text-slate-800">{isCrew(g) ? <CrewTag crew={g} size="md" /> : g === 'ctl' ? 'Controllers' : 'Day staff'}</h2>
                <span className="text-xs text-slate-500">{onLeave} on leave today</span>
              </div>
              <div className="flex items-end gap-1.5 px-2 pb-1 text-[10px] text-slate-400">
                <span className="w-[4.5rem] shrink-0 sm:w-40" />
                {mode === 'month'
                  ? <span className="flex flex-1 gap-1.5">{weeks.map((w, i) => <span key={i} className="flex-1 text-center leading-tight">{weekLabel(w)}</span>)}</span>
                  : <span className="grid flex-1 grid-cols-12 gap-0.5">{MONTH_LETTERS.map((m, i) => <span key={i} className={cx('text-center', i === thisMonth && 'font-bold text-brand-700')}>{m}</span>)}</span>}
                <span className="w-6 shrink-0 text-right">days</span>
              </div>
              {/* rows by position, a thin line between the groups; longest-serving first */}
              {positionRuns(rows).map((run) => (
                <div key={run.group} className="border-t border-slate-200 first:border-t-0">
                  {g !== 'ctl' && <div className="px-2 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{run.group}</div>}
                  <ul className="divide-y divide-slate-100">
                    {run.rows.map((r) => (
                      <li key={r.p.id}>
                        <button type="button" aria-expanded={open === r.p.id} onClick={() => setOpen(open === r.p.id ? null : r.p.id)} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left active:bg-slate-50">
                          <span className="w-[4.5rem] shrink-0 sm:w-40">
                            {g === 'ctl' && <span className="mb-0.5 block text-[9px] font-semibold text-slate-500">{isCrew(r.p.crew_code) ? <span className="inline-flex items-center gap-1"><span className={cx('h-2 w-2 rounded-full', CREW_IDENTITY[r.p.crew_code].bg)} />{r.p.crew_code} Shift</span> : ROLE_SHORT[r.p.position_code ?? '']}</span>}
                            <span className="block text-[11px] font-medium leading-tight text-slate-800 [overflow-wrap:anywhere] sm:text-sm">{r.p.display_name}</span>
                            <span className="block text-[9px] tabular-nums leading-tight text-slate-400">#{r.p.employee_number}</span>
                          </span>
                          {mode === 'month'
                            ? <WeekCells weeks={weeks} blocks={r.current} today={today} shortOf={(c) => data?.types.find((t) => t.code === c)?.short_code} />
                            : <MonthCells year={year} blocks={r.current} thisMonth={thisMonth} />}
                          <span className="w-6 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-700">{r.days || '—'}</span>
                        </button>
                        {open === r.p.id && data && <PersonDetail row={r} year={year} data={data} today={today} onEdit={(rec) => setSheet({ kind: 'edit', record: rec })} onAdd={() => setSheet({ kind: 'add', employeeId: r.p.id })} />}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Card>
          ))}
          {mode === 'month'
            ? <div className="px-1 text-xs text-slate-500">
                <p>Each week Sun → Sat, one box a day · coloured = on leave · Friday shaded · today outlined · tap a name for the dates</p>
                {legend.length > 0 && <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">{legend.map((t) => <span key={t.code} className="inline-flex items-center gap-1"><span className={cx('h-2.5 w-2.5 rounded-[3px]', leaveToneShort(t.short_code).dot)} />{t.short_code} {t.label}</span>)}</p>}
              </div>
            : <p className="px-1 text-xs text-slate-500">Leave days in each month · darker = more days · this month outlined · tap a name for the dates</p>}
        </div>
      )}
      {sheet && view && data && <LeaveSheet target={sheet} people={view.sheetPeople} types={data.types} onClose={() => setSheet(null)} onDone={done} />}
    </div>
  );
}

/** Consecutive rows of the same position group (the rows are already in position order). */
function positionRuns<T extends { p: EmployeeDirectoryRow }>(rows: T[]) {
  const out: { group: string; rows: T[] }[] = [];
  for (const r of rows) { const g = positionGroup(r.p.position_code); if (out[out.length - 1]?.group === g) out[out.length - 1].rows.push(r); else out.push({ group: g, rows: [r] }); }
  return out;
}

/** Leave days in each month of the year, shaded by how many; past months faded, this month outlined. */
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

/** "1–3", "4–10" … the dates of a week that fall in the month. */
function weekLabel(w: (string | null)[]) {
  const d = w.filter((x): x is string => !!x).map((x) => Number(x.slice(8)));
  return d.length === 1 ? String(d[0]) : `${d[0]}–${d[d.length - 1]}`;
}

/** The weeks of one month: seven small boxes per week (Sun → Sat), coloured by the leave type on that day. */
function WeekCells({ weeks, blocks, today, shortOf }: { weeks: (string | null)[][]; blocks: LeaveRecord[]; today: string; shortOf: (code: string | null) => string | null | undefined }) {
  return (
    <span className="flex flex-1 gap-1.5" aria-hidden>
      {weeks.map((w, i) => (
        <span key={i} className="flex flex-1 gap-px">
          {w.map((d, j) => {
            const l = d ? blocks.find((x) => x.start_date <= d && d <= x.end_date) : null;
            return <span key={j} title={d && l ? `${shortDate(d)} · ${shortOf(l.absence_type_code) ?? 'Leave'}` : undefined}
              className={cx('h-6 flex-1 rounded-[2px]', !d ? 'bg-transparent' : l ? leaveToneShort(shortOf(l.absence_type_code)).dot : j === 5 ? 'bg-slate-200' : 'bg-slate-100', d === today && 'ring-1 ring-brand-700', d && d < today && 'opacity-60')} />;
          })}
        </span>
      ))}
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
              <span className={`mt-0.5 inline-flex min-w-11 justify-center rounded-md px-1.5 py-0.5 text-xs font-bold ring-1 ${leaveToneShort(type(l.absence_type_code)?.short_code).chip}`}>{type(l.absence_type_code)?.short_code ?? '—'}</span>
              <span className="min-w-0 flex-1">
                <span className={cx('block text-sm font-medium', past ? 'text-slate-500' : 'text-slate-800')}>{range(l.start_date, l.end_date)}{l.dates_estimated && <> <EstimatedTag /></>} <span className="font-normal text-slate-500">· {dayCount(l.start_date, l.end_date)} d{past ? '' : ` · back ${shortDate(back)}`}</span></span>
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
