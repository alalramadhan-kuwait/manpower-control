// Manpower › Employees: one crew at a time (owner, 22 Nov 2026, mock-up A "grouped list").
// The crew is the main filter (A B C D, with today's shift under each letter); an overview of who is here today by
// job; one chip row for the rest (On leave, Leaving soon, Contractors, search); then the crew grouped by job.
// Each job has its own colour (owner's choice: Controller navy, Panel teal, Field blue), always with its letter.
// "Here today" only takes out people on leave today: it is a roll call, not the Today board's count against the
// minimums (that one also checks grades and qualifications). Tapping a name opens the employee's profile.
import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LeaveSpan, OnLeave } from '@/core/leave';
import { CREWS, SHIFT_LABEL, addDaysIso, dutyFor, stateOf, type Crew } from '@/core/roster';
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

export function CrewOverview({ rows, spans, onLeave, today, crew, onCrew }: {
  rows: EmployeeDirectoryRow[]; spans: LeaveSpan[]; onLeave: Map<string, OnLeave>; today: string; crew: Crew | 'all'; onCrew: (c: Crew | 'all') => void;
}) {
  const [show, setShow] = useState<Show>('all');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);

  // the next leave starting within 14 days, for people not on leave today
  const soon = useMemo(() => {
    const until = addDaysIso(today, SOON_DAYS);
    const out = new Map<string, LeaveSpan>();
    for (const s of spans) if (s.start > today && s.start <= until && (!out.has(s.employeeId) || s.start < out.get(s.employeeId)!.start)) out.set(s.employeeId, s);
    return out;
  }, [spans, today]);

  const needle = q.trim();
  const match = nameFilter(needle.toLowerCase());
  // a search looks in every crew, so a name is never hidden by the crew chosen
  const inCrew = rows.filter((r) => (needle ? true : crew === 'all' || r.crew_code === crew));
  const shown = inCrew
    .filter((r) => !needle || match([r.employee_number, r.official_name, r.display_name, r.short_name, r.arabic_name]))
    .filter((r) => show === 'all' || (show === 'leave' ? onLeave.has(r.id) : show === 'soon' ? !onLeave.has(r.id) && soon.has(r.id) : r.employment_type === 'contractor'))
    .sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0) || a.display_name.localeCompare(b.display_name));

  const count = (list: EmployeeDirectoryRow[], job: Job) => ({ total: list.filter((r) => jobOf(r) === job).length, here: list.filter((r) => jobOf(r) === job && !onLeave.has(r.id)).length });
  const away = inCrew.filter((r) => onLeave.has(r.id)).length;
  const leaving = inCrew.filter((r) => !onLeave.has(r.id) && soon.has(r.id)).length;
  const contractors = inCrew.filter((r) => r.employment_type === 'contractor').length;
  const crewLabel = needle ? 'Search · all crews' : crew === 'all' ? 'All crews' : `${crew} Shift`;

  return (
    <div className="space-y-2">
      {/* main filter: the crew, with today's shift */}
      <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] gap-1 rounded-xl bg-slate-100 p-1">
        {CREWS.map((c) => {
          const st = stateOf(dutyFor(today, c));
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

      {/* overview */}
      <div className="rounded-2xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{crewLabel} · here today</span>
          <span className="text-xs text-slate-600 tabular-nums"><b className="text-slate-800">{inCrew.length - away}</b> of {inCrew.length}{away > 0 && <> · <b className="text-status-red">{away} on leave</b></>}</span>
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
        {([['all', `All ${inCrew.length}`], ['leave', `On leave ${away}`], ['soon', `Leaving soon ${leaving}`], ['contractor', `Contractors ${contractors}`]] as [Show, string][]).map(([k, l]) => (
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
                {list.map((r) => <PersonRow key={r.id} r={r} job={j} leave={onLeave.get(r.id) ?? null} next={soon.get(r.id) ?? null} showCrew={!!needle || crew === 'all'} />)}
              </ul>
            </div>
          );
        })}
        {shown.length === 0 && <p className="px-3 py-4 text-center text-sm text-slate-500">No one matches.</p>}
      </div>
    </div>
  );
}

function PersonRow({ r, job, leave, next, showCrew }: { r: EmployeeDirectoryRow; job: (typeof JOBS)[number]; leave: OnLeave | null; next: LeaveSpan | null; showCrew: boolean }) {
  const open = leave ? leave.until >= '9999-01-01' : false;
  const code = (s: { typeShort?: string | null; typeLabel: string | null }) => s.typeShort ?? s.typeLabel ?? 'Leave';
  return (
    <li>
      <Link to={`/employees/${r.id}`} className="flex min-h-10 items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
        <span aria-label={job.label} className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-extrabold text-white', job.badge)}>{job.letter}</span>
        <span className={cx('min-w-0 flex-1 text-[13px] font-semibold', leave ? 'text-slate-500 line-through decoration-slate-400' : 'text-slate-800')}>
          {r.display_name}
          <span className="ml-1 text-[11px] font-medium text-slate-500 no-underline">{r.employment_type === 'contractor' ? 'Contr.' : r.grade != null ? `G${r.grade}` : ''}</span>
        </span>
        {showCrew && isCrew(r.crew_code) && <CrewBadge crew={r.crew_code} size="sm" />}
        {leave
          ? <span className="shrink-0 whitespace-nowrap rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">{code(leave)} · {open ? 'return not confirmed' : `back ${shortDate(leave.returnOn)}`}</span>
          : next
            ? <span className="shrink-0 whitespace-nowrap rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">{code(next)} from {shortDate(next.start)}</span>
            : job.key === 'field' && r.panel_operator_status === 'yes'
              ? <span className="shrink-0 whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">Panel-qualified</span>
              : null}
      </Link>
    </li>
  );
}
