// Manpower › Employees: one crew at a time (owner, 22 Nov 2026, mock-up A "grouped list").
// The crew is the main filter (A B C D, with today's shift under each letter); an overview of who is here today by
// job; one chip row for the rest (On leave, Leaving soon, Contractors, search); then the crew grouped by job.
// Each job has its own colour (owner's choice: Controller navy, Panel teal, Field blue), always with its letter.
// Any day can be shown (owner, 24 Nov 2026: a leave screen said C Shift is short on 11 Dec and this page showed
// nothing): who is on leave that day, who is away from the shift that day (day duty, with another crew), who joins it
// from another crew, and each person's next leave whatever its date (amber within 14 days).
// "Here" only takes out people on leave or away from the shift: it is a roll call, not the Today board's count against
// the minimums (that one also checks grades and qualifications). Tapping a name opens the employee's profile.
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { onLeaveOn, type LeaveSpan, type OnLeave } from '@/core/leave';
import { CREWS, SHIFT_LABEL, addDaysIso, dutyFor, stateOf, type Crew } from '@/core/roster';
import type { CrewMovement } from '@/data/movements';
import type { EmployeeDirectoryRow } from '@/data/types';
import { cx } from '@/ui/components';
import { CREW_IDENTITY, CrewBadge, isCrew } from '@/ui/crew';
import { shortDate } from '@/ui/leave';
import { nameFilter } from '@/ui/nameSearch';

type Job = 'controller' | 'panel' | 'field' | 'other';
const JOBS: { key: Job; label: string; letter: string; badge: string; text: string; bar: string }[] = [
  { key: 'controller', label: 'Controller', letter: 'C', badge: 'bg-brand-700', text: 'text-brand-700', bar: 'border-brand-700' },
  { key: 'panel', label: 'Panel', letter: 'P', badge: 'bg-teal-700', text: 'text-teal-700', bar: 'border-teal-700' },
  { key: 'field', label: 'Field', letter: 'F', badge: 'bg-sky-700', text: 'text-sky-700', bar: 'border-sky-700' },
  { key: 'other', label: 'Other', letter: '·', badge: 'bg-slate-500', text: 'text-slate-600', bar: 'border-slate-400' }
];
const jobOf = (r: EmployeeDirectoryRow): Job => (r.position_category === 'controller' || r.position_category === 'panel' || r.position_category === 'field' ? r.position_category : 'other');
const SOON_DAYS = 14;
type Show = 'all' | 'leave' | 'soon' | 'contractor';

/** The crew on shift now (Kuwait time): Morning 07–15, Afternoon 15–23, Night 23–07 (a night belongs to the day it starts). */
export function crewOnShiftNow(now = new Date()): Crew {
  const kw = new Date(now.getTime() + 3 * 3600_000);
  const h = kw.getUTCHours();
  const date = kw.toISOString().slice(0, 10);
  const day = h < 7 ? addDaysIso(date, -1) : date;
  const want = h >= 7 && h < 15 ? 'M' : h >= 15 && h < 23 ? 'A' : 'N';
  return CREWS.find((c) => stateOf(dutyFor(day, c)) === want) ?? 'A';
}

/** Where a person is on a day when not with their own crew: day duty, another crew (an active move covering it). */
function awayOn(r: EmployeeDirectoryRow, moves: CrewMovement[], date: string): { to: string; label: string } | null {
  const m = moves.find((x) => x.employee_id === r.id && x.status === 'active' && x.kind !== 'permanent' && x.start_date <= date && (x.end_date === null || date <= x.end_date) && x.to_crew !== r.crew_code);
  if (!m) return null;
  return { to: m.to_crew, label: m.to_crew === 'DAY' ? 'Day duty' : (m.to_crew as string) === 'SD' ? 'Shutdown team' : `With ${m.to_crew} Shift` };
}

export function CrewOverview({ rows, spans, moves, today, crew, onCrew }: {
  rows: EmployeeDirectoryRow[]; spans: LeaveSpan[]; moves: CrewMovement[]; today: string; crew: Crew | 'all'; onCrew: (c: Crew | 'all') => void;
}) {
  const [show, setShow] = useState<Show>('all');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [date, setDate] = useState(today);
  const isToday = date === today;
  const crewOf = useMemo(() => new Map(rows.map((r) => [r.id, isCrew(r.crew_code) ? r.crew_code : null])), [rows]);
  const onLeave = useMemo(() => onLeaveOn(date, spans, (id) => crewOf.get(id) ?? null), [date, spans, crewOf]);

  // each person's next leave after the day shown, whatever its date (amber when within 14 days)
  const next = useMemo(() => {
    const out = new Map<string, LeaveSpan>();
    for (const s of spans) if (s.start > date && (!out.has(s.employeeId) || s.start < out.get(s.employeeId)!.start)) out.set(s.employeeId, s);
    return out;
  }, [spans, date]);
  const soonUntil = addDaysIso(date, SOON_DAYS);
  const soon = (id: string) => { const n = next.get(id); return !!n && n.start <= soonUntil; };

  const needle = q.trim();
  const match = nameFilter(needle.toLowerCase());
  const away = (r: EmployeeDirectoryRow) => awayOn(r, moves, date);
  // the crew that day: its own people, and people from other crews with it that day (a search looks in every crew)
  const inCrew = rows.filter((r) => (needle ? true : crew === 'all' || r.crew_code === crew || away(r)?.to === crew));
  const out = (r: EmployeeDirectoryRow) => onLeave.has(r.id) || (crew !== 'all' && !needle && r.crew_code === crew && !!away(r)) || ((crew === 'all' || needle) && away(r)?.to === 'DAY');
  const shown = inCrew
    .filter((r) => !needle || match([r.employee_number, r.official_name, r.display_name, r.short_name, r.arabic_name]))
    .filter((r) => show === 'all' || (show === 'leave' ? out(r) : show === 'soon' ? !out(r) && soon(r.id) : r.employment_type === 'contractor'))
    .sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0) || a.display_name.localeCompare(b.display_name));

  const count = (list: EmployeeDirectoryRow[], job: Job) => ({ total: list.filter((r) => jobOf(r) === job).length, here: list.filter((r) => jobOf(r) === job && !out(r)).length });
  const offShift = inCrew.filter(out).length;
  const leaving = inCrew.filter((r) => !out(r) && soon(r.id)).length;
  const contractors = inCrew.filter((r) => r.employment_type === 'contractor').length;
  const crewLabel = needle ? 'Search · all crews' : crew === 'all' ? 'All crews' : `${crew} Shift`;
  const dayLabel = isToday ? 'today' : `on ${new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`;

  return (
    <div className="space-y-2">
      {/* main filter: the crew, with today's shift */}
      <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] gap-1 rounded-xl bg-slate-100 p-1">
        {CREWS.map((c) => {
          const st = stateOf(dutyFor(date, c));
          const on = crew === c && !needle;
          return (
            <button key={c} type="button" aria-pressed={on} onClick={() => { onCrew(c); setQ(''); setSearching(false); }}
              className={cx('flex min-h-11 flex-col items-center justify-center rounded-lg leading-tight', on ? 'bg-white shadow-sm' : 'text-slate-600')}>
              <span className="flex items-center gap-1 text-[15px] font-extrabold text-slate-800"><span className={cx('h-2.5 w-2.5 rounded-full', CREW_IDENTITY[c].bg)} />{c}</span>
              <span className="text-[10px] font-semibold text-slate-500">{st === 'Off' ? 'Off' : SHIFT_LABEL[st]}</span>
            </button>
          );
        })}
        <button type="button" aria-pressed={crew === 'all' && !needle} onClick={() => { onCrew('all'); setQ(''); setSearching(false); }}
          className={cx('min-h-11 rounded-lg px-2 text-xs font-semibold', crew === 'all' && !needle ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600')}>All</button>
      </div>

      {/* the day shown */}
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Day before" onClick={() => setDate(addDaysIso(date, -1))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-slate-300"><ChevronLeft className="h-4 w-4" /></button>
        <input type="date" aria-label="Day shown" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="input min-h-9 min-w-0 flex-1 py-1 text-sm" />
        <button type="button" aria-label="Day after" onClick={() => setDate(addDaysIso(date, 1))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-slate-300"><ChevronRight className="h-4 w-4" /></button>
        {!isToday && <button type="button" onClick={() => setDate(today)} className="min-h-9 shrink-0 rounded-lg px-2 text-xs font-semibold text-brand-700">Today</button>}
      </div>

      {/* overview */}
      <div className="rounded-2xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{crewLabel} · here {dayLabel}</span>
          <span className="text-xs text-slate-600 tabular-nums"><b className="text-slate-800">{inCrew.length - offShift}</b> of {inCrew.length}{offShift > 0 && <> · <b className="text-status-red">{offShift} away</b></>}</span>
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {JOBS.filter((j) => j.key !== 'other').map((j) => {
            const c = count(inCrew, j.key);
            return (
              <div key={j.key} className={cx('border-l-4 pl-2', j.bar)}>
                <div className="text-xl font-extrabold tabular-nums text-slate-900">{c.here}<span className="text-sm font-semibold text-slate-500">/{c.total}</span></div>
                <div className={cx('text-[11px] font-bold', j.text)}>{j.label}</div>
              </div>
            );
          })}
        </div>
        {(leaving > 0 || contractors > 0) && <p className="mt-1.5 text-[11px] text-slate-500">{leaving > 0 ? `Next ${SOON_DAYS} days: ${leaving} start leave` : ''}{leaving > 0 && contractors > 0 ? ' · ' : ''}{contractors > 0 ? `${contractors} contractor${contractors === 1 ? '' : 's'}` : ''}</p>}
      </div>

      {/* everything else in one row */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {([['all', `All ${inCrew.length}`], ['leave', `Away ${offShift}`], ['soon', `Leaving soon ${leaving}`], ['contractor', `Contractors ${contractors}`]] as [Show, string][]).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}
            className={cx('min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold ring-1', show === k ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{l}</button>
        ))}
        <button type="button" aria-label="Search name or employee number" aria-pressed={searching} onClick={() => { setSearching((s) => !s); if (searching) setQ(''); }}
          className={cx('flex min-h-9 shrink-0 items-center rounded-full px-3 ring-1', searching ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}><Search className="h-4 w-4" /></button>
      </div>
      {searching && (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input autoFocus className="input" style={{ paddingLeft: '2.25rem' }} placeholder="Search name or employee number (all crews)" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" />
          {q && <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500"><X className="h-4 w-4" /></button>}
        </label>
      )}

      {/* the crew, grouped by job */}
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {JOBS.map((j) => {
          const list = shown.filter((r) => jobOf(r) === j.key);
          if (!list.length) return null;
          const c = count(inCrew, j.key);
          return (
            <div key={j.key}>
              <div className={cx('bg-slate-50 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider', j.text)}>
                {j.label} · {show === 'all' && !needle ? (c.here === c.total ? c.total : `${c.here} of ${c.total} here`) : list.length}
              </div>
              <ul className="divide-y divide-slate-100">
                {list.map((r) => { const a = away(r); return <PersonRow key={r.id} r={r} job={j} leave={onLeave.get(r.id) ?? null} next={next.get(r.id) ?? null} soon={soon(r.id)}
                  move={a ? (crew !== 'all' && !needle && a.to === crew && r.crew_code !== crew ? { label: `From ${r.crew_code} Shift`, out: false } : { label: a.label, out: crew === 'all' || !!needle ? a.to === 'DAY' : r.crew_code === crew }) : null}
                  showCrew={!!needle || crew === 'all'} />; })}
              </ul>
            </div>
          );
        })}
        {shown.length === 0 && <p className="px-3 py-4 text-center text-sm text-slate-500">No one matches.</p>}
      </div>
    </div>
  );
}

function PersonRow({ r, job, leave, next, soon, move, showCrew }: { r: EmployeeDirectoryRow; job: (typeof JOBS)[number]; leave: OnLeave | null; next: LeaveSpan | null; soon: boolean; move: { label: string; out: boolean } | null; showCrew: boolean }) {
  const open = leave ? leave.until >= '9999-01-01' : false;
  const code = (s: { typeShort?: string | null; typeLabel: string | null }) => s.typeShort ?? s.typeLabel ?? 'Leave';
  return (
    <li>
      <Link to={`/employees/${r.id}`} className="flex min-h-10 items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
        <span aria-label={job.label} className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-extrabold text-white', job.badge)}>{job.letter}</span>
        <span className={cx('min-w-0 flex-1 text-[13px] font-semibold', leave || move?.out ? 'text-slate-500 line-through decoration-slate-400' : 'text-slate-800')}>
          {r.display_name}
          <span className="ml-1 text-[11px] font-medium text-slate-500 no-underline">{r.employment_type === 'contractor' ? 'Contr.' : r.grade != null ? `G${r.grade}` : ''}</span>
        </span>
        {showCrew && isCrew(r.crew_code) && <CrewBadge crew={r.crew_code} size="sm" />}
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {move && <span className={cx('whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold', move.out ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-900')}>{move.label}</span>}
          {leave
            ? <span className="whitespace-nowrap rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">{code(leave)} · {open ? 'return not confirmed' : `back ${shortDate(leave.returnOn)}`}</span>
            : next
              ? <span className={cx('whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold', soon ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600')}>{code(next)} from {shortDate(next.start)}</span>
              : !move && job.key === 'field' && r.panel_operator_status === 'yes'
                ? <span className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">Panel-qualified</span>
                : null}
        </span>
      </Link>
    </li>
  );
}
