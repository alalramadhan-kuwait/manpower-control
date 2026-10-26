// Calendar › List: the month's leave, one row per leave (name, employee no., position, crew, type, dates, days), by
// start date; filters by position and crew and a name / number search (owner, 26 Oct 2026). A tap opens the leave as
// in the Leave plan. Reads the same data as the Leave plan.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MONTH_NAMES, monthEnd, monthStart, shiftMonth } from '@/core/calendar';
import { CREWS } from '@/core/roster';
import { fetchLeavePlan, type LeavePlanData } from '@/data/leave';
import type { EmployeeDirectoryRow, LeaveRecord } from '@/data/types';
import { ErrorBox, Spinner, cx } from '@/ui/components';
import { isCrew } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { leaveTone } from '@/ui/leaveTypes';
import { nameFilter } from '@/ui/nameSearch';
import { ViewToggle } from './parts';

const POSITIONS = [['all', 'All positions'], ['controller', 'Controller'], ['panel', 'Panel'], ['field', 'Field'], ['other', 'Others']] as const;
type Pos = (typeof POSITIONS)[number][0];
const POS_SHORT: Record<string, string> = { controller: 'Controller', vr_controller: 'VR', morning_controller: 'Morning', panel_operator: 'Panel', field_operator: 'Field' };
const counts = (l: LeaveRecord) => l.in_current_plan && (l.status === 'approved' || l.status === 'planned');
const days = (s: string, e: string) => Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1;
const range = (s: string, e: string) => (s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}`);

export function LeaveListView({ year, month, crew, onMonth, onCrew, onView }: { year: number; month: number; crew: string; onMonth: (y: number, m: number) => void;
  onCrew: (c: string) => void; onView: (v: 'month' | 'week') => void }) {
  const navigate = useNavigate();
  const today = localToday();
  const [data, setData] = useState<(LeavePlanData & { year: number }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pos, setPos] = useState<Pos>('all'); const [query, setQuery] = useState('');
  useEffect(() => { let live = true; setError(null); fetchLeavePlan(year).then((d) => live && setData({ ...d, year })).catch((e) => live && setError(e)); return () => { live = false; }; }, [year]);
  const from = monthStart(year, month), to = monthEnd(year, month);
  const rows = useMemo(() => {
    if (!data || data.year !== year) return null;
    const people = new Map(data.people.map((p) => [p.id, p]));
    const match = nameFilter(query);
    const posOf = (p: EmployeeDirectoryRow) => p.position_category ?? 'other';
    return data.leaves.filter((l) => counts(l) && l.start_date <= to && l.end_date >= from)
      .map((l) => ({ l, p: people.get(l.employee_id) }))
      .filter((x): x is { l: LeaveRecord; p: EmployeeDirectoryRow } => !!x.p)
      .filter(({ p }) => (pos === 'all' || posOf(p) === pos) && (crew === 'all' || (crew === 'day' ? !isCrew(p.crew_code) : p.crew_code === crew))
        && match([p.display_name, p.official_name, p.employee_number, p.arabic_name]))
      .sort((a, b) => a.l.start_date.localeCompare(b.l.start_date) || a.p.display_name.localeCompare(b.p.display_name));
  }, [data, year, from, to, pos, crew, query]);
  const [py, pm] = shiftMonth(year, month, -1); const [ny, nm] = shiftMonth(year, month, 1);
  const isThisMonth = today.slice(0, 7) === from.slice(0, 7);
  const typeOf = (code: string | null) => data?.types.find((t) => t.code === code);
  const open = (l: LeaveRecord) => navigate(l.absence_type_code?.startsWith('annual_leave_') && l.absence_type_code !== 'annual_leave_unscheduled'
    ? `/requests?view=entry&card=pv&emp=${l.employee_id}&leave=${l.start_date}` : `/requests?view=entry&card=leave&emp=${l.employee_id}`);
  const chip = (on: boolean) => cx('shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ring-1', on ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200');
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button aria-label="Previous month" onClick={() => onMonth(py, pm)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 active:bg-slate-50"><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="text-lg font-semibold leading-tight text-brand-800">{MONTH_NAMES[month - 1]} {year}</h1>
          {!isThisMonth && <button onClick={() => onMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)))} className="text-[11px] font-medium text-brand-700">Back to this month</button>}
        </div>
        <button aria-label="Next month" onClick={() => onMonth(ny, nm)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 active:bg-slate-50"><ChevronRight className="h-5 w-5" /></button>
      </div>
      <ViewToggle view="list" onChange={(v) => v !== 'list' && onView(v)} />
      <div className="-mx-4 mb-1.5 flex gap-1 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
        {POSITIONS.map(([k, l]) => <button key={k} type="button" aria-pressed={pos === k} onClick={() => setPos(k)} className={chip(pos === k)}>{l}</button>)}
      </div>
      <div className="-mx-4 mb-2 flex gap-1 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
        {[['all', 'All crews'], ...CREWS.map((c) => [c, c]), ['day', 'Day']].map(([k, l]) => <button key={k} type="button" aria-pressed={crew === k} onClick={() => onCrew(k)} className={chip(crew === k)}>{l}</button>)}
      </div>
      <input className="input mb-2 min-h-10 text-sm" type="search" placeholder="Name or employee no." value={query} onChange={(e) => setQuery(e.target.value)} />
      {error ? <ErrorBox error={error} /> : !rows ? <Spinner /> : <>
        <p className="mb-1.5 px-1 text-xs text-slate-500">{rows.length} leave{rows.length === 1 ? '' : 's'} in {MONTH_NAMES[month - 1]} · by start date</p>
        {rows.length ? <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          {rows.map(({ l, p }) => { const t = typeOf(l.absence_type_code); const before = l.start_date < from;
            return <li key={l.id}><button type="button" onClick={() => open(l)} className="block w-full px-3 py-1.5 text-left active:bg-slate-50">
              <span className="flex items-center gap-2"><b className="min-w-0 flex-1 truncate text-[13px] text-slate-900">{p.display_name}</b>
                <span className={cx('shrink-0 rounded px-1.5 py-px text-[10px] font-bold', leaveTone(l.absence_type_code).chip)} title={t?.label}>{t?.short_code ?? t?.label ?? 'Leave'}</span></span>
              <span className="flex items-center gap-2 text-[11px] text-slate-500"><span className="min-w-0 flex-1 truncate">#{p.employee_number ?? '—'} · {POS_SHORT[p.position_code ?? ''] ?? p.position_label ?? '—'} · {isCrew(p.crew_code) ? p.crew_code : 'Day'}</span>
                <span className={cx('shrink-0 tabular-nums', before ? 'text-slate-400' : 'font-semibold text-slate-700')}>{range(l.start_date, l.end_date)} · {days(l.start_date, l.end_date)} d</span></span>
            </button></li>; })}
        </ul> : <p className="py-6 text-center text-sm text-slate-500">No leave in {MONTH_NAMES[month - 1]} for this selection.</p>}
      </>}
    </div>
  );
}
