import { ChevronLeft, ChevronRight, Plane } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MONTH_NAMES, WEEKDAY_SHORT, attentionPeriods, crewMarks, monthEnd, monthStart, monthWeeks, shiftMonth, summarizeMonth, type DayMark } from '@/core/calendar';
import { evaluateRange, type DayResult } from '@/core/manpower';
import { CREWS, addDaysIso, type Crew } from '@/core/roster';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { Card, ErrorBox, Spinner, cx } from '@/ui/components';
import { CREW_IDENTITY, CrewBadge, isCrew } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';

const DOT: Record<DayMark, string> = { green: 'bg-status-green', amber: 'bg-status-amber', red: 'bg-status-red', pending: 'bg-slate-400', off: 'bg-transparent' };
const MARK_LABEL: Record<Exclude<DayMark, 'off'>, string> = { green: 'Above min', amber: 'No buffer', red: 'Short', pending: 'Pending' };
const DUTY = { M: 'Mor', A: 'Aft', N: 'Ngt', Off: 'Off' } as const;
const KIND: Record<'shortage' | 'coverage_required' | 'data_incomplete', string> = { shortage: 'text-status-red', coverage_required: 'text-slate-700', data_incomplete: 'text-slate-600' };

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const today = localToday();
  const m = /^(\d{4})-(\d{2})$/.exec(params.get('month') ?? '');
  const [year, month] = m ? [Number(m[1]), Number(m[2])] : [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const crew = isCrew(params.get('crew')) ? (params.get('crew') as Crew) : null;
  const go = (y: number, mo: number, c: Crew | null = crew) => {
    const n = new URLSearchParams();
    const key = `${y}-${String(mo).padStart(2, '0')}`;
    if (key !== today.slice(0, 7)) n.set('month', key);
    if (c) n.set('crew', c);
    setParams(n, { replace: true });
  };

  const from = monthStart(year, month), to = monthEnd(year, month);
  const [inputs, setInputs] = useState<(ManpowerInputs & { key: string }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    fetchManpowerInputs(addDaysIso(from, -1), addDaysIso(to, 1)).then((r) => live && setInputs({ ...r, key: from })).catch((e) => live && setError(e));
    return () => { live = false; };
  }, [from, to]);

  const view = useMemo(() => {
    if (!inputs || inputs.key !== from) return null;
    const days = evaluateRange(from, to, inputs.people, inputs.absences, inputs.rules, inputs.assignments);
    const byDate = new Map(days.map((d) => [d.date, d]));
    const crewOf = new Map(inputs.people.map((p) => [p.id, p.crew]));
    const counted = inputs.absences.filter((a) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && (!crew || crewOf.get(a.employeeId) === crew));
    const onLeave = (d: string) => new Set(counted.filter((a) => a.start <= d && d <= a.end).map((a) => a.employeeId)).size;
    const filtered: DayResult[] = crew ? days.map((d) => ({ ...d, crews: d.crews.filter((c) => c.crew === crew) })) : days;
    const periods = inputs.plan.periods.filter((p) => p.status === 'active' && p.start <= to && p.end >= from)
      .map((p) => ({ ...p, label: inputs.plan.modes.find((m) => m.code === p.modeCode)?.label ?? p.modeCode }));
    return { byDate, onLeave, summary: summarizeMonth(days, crew), attention: attentionPeriods(filtered), periods };
  }, [inputs, from, to, crew]);

  const [py, pm] = shiftMonth(year, month, -1); const [ny, nm] = shiftMonth(year, month, 1);
  const isThisMonth = today.slice(0, 7) === from.slice(0, 7);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button aria-label="Previous month" onClick={() => go(py, pm)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 active:bg-slate-50"><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="text-xl font-semibold text-brand-800">{MONTH_NAMES[month - 1]} {year}</h1>
          {!isThisMonth && <button onClick={() => go(Number(today.slice(0, 4)), Number(today.slice(5, 7)))} className="text-xs font-medium text-brand-700">Back to this month</button>}
        </div>
        <button aria-label="Next month" onClick={() => go(ny, nm)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 active:bg-slate-50"><ChevronRight className="h-5 w-5" /></button>
      </div>

      <div className="mb-3 grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {[null, ...CREWS].map((c) => (
          <button key={c ?? 'all'} type="button" aria-pressed={crew === c} onClick={() => go(year, month, c)}
            className={cx('flex min-h-9 items-center justify-center gap-1 rounded-lg font-medium', crew === c ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>
            {c ? <CrewBadge crew={c} size="sm" muted={crew !== c} /> : 'All'}
          </button>
        ))}
      </div>

      {error ? <ErrorBox error={error} /> : !view ? <Spinner /> : (
        <>
          {view.periods.map((p) => (
            <Link key={p.id} to="/operation" className="mb-2 flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-800 ring-1 ring-brand-100">
              <span className="font-semibold">{p.label}</span><span>{shortDate(p.start)} – {shortDate(p.end)}</span><span className="text-brand-700/70">· own minimums on these days</span>
            </Link>
          ))}
          <p className="mb-1 px-1 text-[11px] text-slate-500">Days this month, by the worst crew on duty</p>
          <div className="mb-3 grid grid-cols-4 gap-1.5 text-center text-xs">
            {(['red', 'pending', 'amber', 'green'] as const).map((k) => (
              <div key={k} className="rounded-xl bg-white px-1 py-2 ring-1 ring-slate-200">
                <div className="flex items-center justify-center gap-1.5 text-lg font-semibold tabular-nums text-slate-800"><span className={cx('h-2.5 w-2.5 rounded-full', DOT[k])} />{view.summary[k]}</div>
                <div className="text-[11px] leading-tight text-slate-500">{MARK_LABEL[k]}</div>
              </div>
            ))}
          </div>

          <Card className="p-2">
            <div className="grid grid-cols-7 text-center text-[11px] font-medium text-slate-500">{WEEKDAY_SHORT.map((d) => <div key={d} className="pb-1">{d}</div>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {monthWeeks(year, month).flat().map((d, i) => {
                if (!d) return <div key={`x${i}`} />;
                const day = view.byDate.get(d)!;
                const marks = crewMarks(day).filter((x) => (crew ? x.crew === crew : x.mark !== 'off'));
                const leave = view.onLeave(d);
                return (
                  <button key={d} type="button" onClick={() => navigate(d === today ? '/' : `/?date=${d}`)} aria-label={`${shortDate(d)}: ${marks.map((x) => `${x.crew} ${x.shift === 'Off' ? 'Off' : x.mark}`).join(', ')}`}
                    className={cx('flex min-h-[4.5rem] flex-col rounded-lg px-1 py-1 text-left ring-1 active:bg-slate-50', d === today ? 'ring-2 ring-brand-700' : 'ring-slate-200', d < today && 'bg-slate-50')}>
                    <span className={cx('text-xs font-semibold', d === today ? 'text-brand-700' : 'text-slate-700')}>{Number(d.slice(8))}</span>
                    <span className="mt-0.5 space-y-0.5">
                      {marks.map((x) => (
                        <span key={x.crew} className="flex items-center gap-1 text-[10px] font-bold leading-3">
                          <span className={crew ? 'text-slate-600' : CREW_IDENTITY[x.crew].text}>{crew ? DUTY[x.shift] : x.crew}</span>
                          {x.mark !== 'off' && <span className={cx('h-2 w-2 rounded-full', DOT[x.mark])} />}
                        </span>
                      ))}
                    </span>
                    {leave > 0 && <span className="mt-auto flex items-center gap-0.5 text-[10px] text-yellow-800"><Plane className="h-2.5 w-2.5" />{leave}</span>}
                  </button>
                );
              })}
            </div>
          </Card>
          <p className="mt-2 px-1 text-[11px] leading-4 text-slate-500">
            {crew ? `Each day: ${crew} Shift's duty (Mor, Aft, Ngt or Off) and its result.` : 'Each day: the crews on duty, Morning → Afternoon → Night, with their result.'} Dots: green above minimum, amber no buffer, red confirmed shortage, grey pending (Controller coverage or data). <Plane className="inline h-2.5 w-2.5" /> = people on leave. Tap a day for the full Day Overview.
          </p>

          <h2 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Needs attention this month</h2>
          {view.attention.length === 0 ? <p className="text-sm text-slate-500">Nothing short or pending.</p> : (
            <Card className="divide-y divide-slate-100 p-0">
              {view.attention.map((a) => (
                <Link key={`${a.crew}${a.start}${a.kind}`} to={a.start === today ? '/' : `/?date=${a.start}`} className="flex items-center gap-3 px-3 py-2.5 active:bg-slate-50">
                  <CrewBadge crew={a.crew} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-sm font-medium', KIND[a.kind])}>{a.text}</span>
                    <span className="block text-xs text-slate-500">{a.start === a.end ? shortDate(a.start) : `${shortDate(a.start)} – ${shortDate(a.end)}`} · {a.duties} dut{a.duties === 1 ? 'y' : 'ies'}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </Link>
              ))}
            </Card>
          )}
          <Link to={`/leave-plan?year=${year}${crew ? `&crew=${crew}` : ''}`} className="mt-4 flex items-center justify-between rounded-2xl bg-white p-4 text-sm font-medium text-brand-700 shadow-sm ring-1 ring-slate-200">Annual Leave Plan {year}<ChevronRight className="h-4 w-4" /></Link>
        </>
      )}
    </div>
  );
}
