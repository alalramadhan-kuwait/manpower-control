import { ChevronLeft, ChevronRight, Star, UserMinus, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MONTH_NAMES, WEEKDAY_SHORT, attentionPeriods, crewMarks, monthEnd, monthStart, monthWeeks, shiftMonth, summarizeMonth, type DayMark } from '@/core/calendar';
import { fillWeek, shortfall, weekBars } from '@/core/calendar/board';
import { evaluateRange, type DayResult } from '@/core/manpower';
import { CREWS, addDaysIso, type Crew } from '@/core/roster';
import { EVENT_CATEGORY_LABEL, fetchCalendarInfo, type Holiday, type UnitEvent } from '@/data/calendar';
import { EVENT_ICON, UNIT_BAR } from '@/ui/calendar';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { Card, ErrorBox, Spinner, cx } from '@/ui/components';
import { CrewBadge, isCrew } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { DaySheet } from './DaySheet';
import { EventSheet, HolidaySheet } from './InfoSheets';

type Filter = 'all' | Crew | 'shutdowns' | 'holidays' | 'shortage';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All shifts' }, ...CREWS.map((c) => ({ key: c as Filter, label: `Shift ${c}` })),
  { key: 'shutdowns', label: 'Shutdowns & events' }, { key: 'holidays', label: 'Holidays' }, { key: 'shortage', label: 'Shortage only' }
];
/** Status colours only: green safe, amber at minimum, red below minimum, grey pending. */
const PILL: Record<Exclude<DayMark, 'off'>, string> = {
  green: 'bg-green-100 text-green-900', amber: 'bg-amber-100 text-amber-900', red: 'bg-status-red text-white', pending: 'bg-slate-200 text-slate-700'
};
const SUMMARY: { key: Exclude<DayMark, 'off'>; label: string; dot: string }[] = [
  { key: 'red', label: 'Shortage', dot: 'bg-status-red' }, { key: 'amber', label: 'At minimum', dot: 'bg-status-amber' },
  { key: 'green', label: 'Safe', dot: 'bg-status-green' }, { key: 'pending', label: 'Pending', dot: 'bg-slate-400' }
];
const dates = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)}–${shortDate(b)}`);
export type Bar = { id: string; start: string; end: string; label: string; cls: string; icon: LucideIcon; event?: UnitEvent };

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const today = localToday();
  const m = /^(\d{4})-(\d{2})$/.exec(params.get('month') ?? '');
  const [year, month] = m ? [Number(m[1]), Number(m[2])] : [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const f = params.get('f') ?? params.get('crew') ?? 'all';
  const filter: Filter = FILTERS.some((x) => x.key === f) ? (f as Filter) : 'all';
  const crew = isCrew(filter) ? filter : null;
  const go = (y: number, mo: number, fl: Filter = filter) => {
    const n = new URLSearchParams();
    const key = `${y}-${String(mo).padStart(2, '0')}`;
    if (key !== today.slice(0, 7)) n.set('month', key);
    if (fl !== 'all') n.set('f', fl);
    setParams(n, { replace: true });
  };

  const from = monthStart(year, month), to = monthEnd(year, month);
  const gridFrom = addDaysIso(from, -7), gridTo = addDaysIso(to, 7);
  const [inputs, setInputs] = useState<(ManpowerInputs & { key: string }) | null>(null);
  const [info, setInfo] = useState<(Awaited<ReturnType<typeof fetchCalendarInfo>> & { key: string }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | { kind: 'event'; event: UnitEvent | null; date?: string } | { kind: 'holiday'; holiday: Holiday | null; date?: string }>(null);
  const loadInfo = useCallback(() => fetchCalendarInfo(gridFrom, gridTo).then((r) => setInfo({ ...r, key: from })).catch(setError), [gridFrom, gridTo, from]);
  useEffect(() => {
    let live = true;
    setError(null);
    fetchManpowerInputs(addDaysIso(gridFrom, -1), addDaysIso(gridTo, 1)).then((r) => live && setInputs({ ...r, key: from })).catch((e) => live && setError(e));
    loadInfo();
    return () => { live = false; };
  }, [from, gridFrom, gridTo, loadInfo]);

  const view = useMemo(() => {
    if (!inputs || inputs.key !== from || !info || info.key !== from) return null;
    const days = evaluateRange(gridFrom, gridTo, inputs.people, inputs.absences, inputs.rules, inputs.assignments);
    const byDate = new Map(days.map((d) => [d.date, d]));
    const monthDays = days.filter((d) => d.date >= from && d.date <= to);
    const crewOf = new Map(inputs.people.map((p) => [p.id, p.crew]));
    const counted = inputs.absences.filter((a) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && (!crew || crewOf.get(a.employeeId) === crew));
    const away = (d: string) => new Set(counted.filter((a) => a.start <= d && d <= a.end).map((a) => a.employeeId)).size;
    const holidayOn = (d: string) => info.holidays.find((h) => h.start <= d && d <= h.end) ?? null;
    const unitIndex = (u: string | null) => (u ? info.units.indexOf(u.trim()) : -1);
    const bars: Bar[] = [
      ...inputs.plan.periods.filter((p) => p.status === 'active').map((p) => ({ id: `mode-${p.id}`, start: p.start, end: p.end, label: `${inputs.plan.modes.find((x) => x.code === p.modeCode)?.label ?? p.modeCode} · ${dates(p.start, p.end)}`, cls: 'bg-brand-700', icon: EVENT_ICON.mode })),
      ...info.events.map((e) => ({ id: e.id, start: e.start, end: e.end, event: e, icon: EVENT_ICON[e.category],
        label: `${e.unit ? `${e.unit} ` : ''}${e.title} · ${dates(e.start, e.end)}`, cls: UNIT_BAR[Math.max(0, unitIndex(e.unit)) % UNIT_BAR.length] }))
    ];
    const filtered: DayResult[] = crew ? monthDays.map((d) => ({ ...d, crews: d.crews.filter((c) => c.crew === crew) })) : monthDays;
    return { byDate, away, holidayOn, bars, summary: summarizeMonth(monthDays, crew), attention: attentionPeriods(filtered),
      monthHolidays: info.holidays.filter((h) => h.start <= to && h.end >= from), monthBars: bars.filter((b) => b.start <= to && b.end >= from) };
  }, [inputs, info, from, to, gridFrom, gridTo, crew]);

  const [py, pm] = shiftMonth(year, month, -1); const [ny, nm] = shiftMonth(year, month, 1);
  const isThisMonth = today.slice(0, 7) === from.slice(0, 7);
  const showPills = filter !== 'shutdowns' && filter !== 'holidays';
  const showBars = filter === 'all' || filter === 'shutdowns' || isCrew(filter);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button aria-label="Previous month" onClick={() => go(py, pm)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 active:bg-slate-50"><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="text-lg font-semibold leading-tight text-brand-800">{MONTH_NAMES[month - 1]} {year}</h1>
          {!isThisMonth && <button onClick={() => go(Number(today.slice(0, 4)), Number(today.slice(5, 7)))} className="text-[11px] font-medium text-brand-700">Back to this month</button>}
        </div>
        <button aria-label="Next month" onClick={() => go(ny, nm)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 active:bg-slate-50"><ChevronRight className="h-5 w-5" /></button>
      </div>

      {error ? <ErrorBox error={error} /> : !view ? <Spinner /> : (
        <>
          <div className="mb-2 grid grid-cols-4 gap-1 text-center">
            {SUMMARY.map((k) => (
              <div key={k.key} className="rounded-lg bg-white px-1 py-1 ring-1 ring-slate-200">
                <div className="flex items-center justify-center gap-1 text-base font-semibold leading-tight tabular-nums text-slate-800"><span className={cx('h-2 w-2 rounded-full', k.dot)} />{view.summary[k.key]}</div>
                <div className="text-[10px] leading-tight text-slate-500">{k.label} days</div>
              </div>
            ))}
          </div>

          <div className="-mx-4 mb-2 flex gap-1 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
            {FILTERS.map((x) => (
              <button key={x.key} type="button" aria-pressed={filter === x.key} onClick={() => go(year, month, x.key)}
                className={cx('shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ring-1', filter === x.key ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200')}>{x.label}</button>
            ))}
          </div>

          <Card className="p-1.5">
            <div className="grid grid-cols-[12px_repeat(7,minmax(0,1fr))] gap-x-0.5 text-center text-[10px] font-medium text-slate-500">
              <div />{WEEKDAY_SHORT.map((d) => <div key={d} className="pb-0.5">{d.slice(0, 2)}</div>)}
            </div>
            <div className="space-y-1">
              {monthWeeks(year, month).map((week, wi) => {
                const dates = fillWeek(week);
                const bars = showBars ? weekBars(week, view.bars, dates) : [];
                const lanes = bars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
                return (
                  <div key={wi}>
                    <div className="grid grid-cols-[12px_repeat(7,minmax(0,1fr))] gap-x-0.5">
                      {showPills && !crew ? (
                        <div className="flex flex-col pt-[15px] text-[9px] font-semibold leading-[14px] text-slate-400"><span className="mb-px">M</span><span className="mb-px">A</span><span>N</span></div>
                      ) : <div />}
                      {week.map((d, di) => d ? <DayCell key={d} date={d} day={view.byDate.get(d)!} today={today} crew={crew} filter={filter} showPills={showPills}
                        away={view.away(d)} holiday={view.holidayOn(d)} inEvent={view.bars.some((b) => b.start <= d && d <= b.end)} onOpen={() => setOpen(d)} /> : <div key={`x${di}`} />)}
                    </div>
                    {lanes > 0 && (
                      <div className="mt-0.5 grid grid-cols-[12px_repeat(7,minmax(0,1fr))] gap-x-0.5 gap-y-px" style={{ gridTemplateRows: `repeat(${lanes}, 14px)` }}>
                        {bars.map((b) => {
                          const Icon = b.item.icon;
                          return (
                            <button key={b.item.id} type="button" onClick={() => setOpen(dates[b.col] < from ? from : dates[b.col] > to ? to : dates[b.col])}
                              style={{ gridColumn: `${b.col + 2} / span ${b.span}`, gridRow: b.lane + 1 }}
                              className={cx('flex min-w-0 items-center gap-0.5 px-1 text-left text-[9px] font-semibold leading-none text-white', b.item.cls, b.startsHere ? 'rounded-l-md' : '', b.endsHere ? 'rounded-r-md' : '')}>
                              {b.startsHere || b.col === 0 ? <><Icon className="h-2.5 w-2.5 shrink-0" />{(b.startsHere || b.span > 1) && <span className="truncate">{b.item.label}</span>}</> : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
          <Legend />

          {filter === 'holidays' || view.monthHolidays.length > 0 ? (
            <Section title={`Kuwait public holidays (${view.monthHolidays.length})`} action={<button type="button" className="text-xs font-medium text-brand-700" onClick={() => setSheet({ kind: 'holiday', holiday: null, date: from })}>+ Holiday</button>}>
              {view.monthHolidays.length === 0 ? <p className="py-2 text-sm text-slate-500">No public holiday this month.</p> : view.monthHolidays.map((h) => (
                <button key={h.id} type="button" onClick={() => setSheet({ kind: 'holiday', holiday: h })} className="flex w-full items-center gap-2 py-2 text-left">
                  <Star className="h-4 w-4 shrink-0 fill-pink-500 text-pink-600" />
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-900">{h.name}</span><span className="block text-xs text-slate-500">{h.start === h.end ? shortDate(h.start) : `${shortDate(h.start)} – ${shortDate(h.end)}`}{h.expected ? ' · expected, to be confirmed' : ''}</span></span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              ))}
            </Section>
          ) : null}

          <Section title={`Shutdowns & unit events (${view.monthBars.length})`} action={<button type="button" className="text-xs font-medium text-brand-700" onClick={() => setSheet({ kind: 'event', event: null, date: isThisMonth ? today : from })}>+ Event</button>}>
            {view.monthBars.length === 0 ? <p className="py-2 text-sm text-slate-500">Nothing scheduled this month.</p> : view.monthBars.map((b) => {
              const Icon = b.icon;
              const inner = <><span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white', b.cls)}><Icon className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{b.label}</span><span className="block text-xs text-slate-500">{b.event ? EVENT_CATEGORY_LABEL[b.event.category] : 'Operating mode: own minimums per crew'}{b.event?.note ? ` · ${b.event.note}` : ''}</span></span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" /></>;
              return b.event ? <button key={b.id} type="button" onClick={() => setSheet({ kind: 'event', event: b.event! })} className="flex w-full items-center gap-2 py-2 text-left">{inner}</button>
                : <Link key={b.id} to="/operation" className="flex items-center gap-2 py-2">{inner}</Link>;
            })}
          </Section>

          {filter !== 'holidays' && filter !== 'shutdowns' && (
            <Section title="Needs attention this month">
              {view.attention.length === 0 ? <p className="py-2 text-sm text-slate-500">Nothing short or pending.</p> : view.attention.map((a) => (
                <button key={`${a.crew}${a.start}${a.kind}`} type="button" onClick={() => setOpen(a.start)} className="flex w-full items-center gap-3 py-2 text-left">
                  <CrewBadge crew={a.crew} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-sm font-medium', a.kind === 'shortage' ? 'text-status-red' : 'text-slate-700')}>{a.text}</span>
                    <span className="block text-xs text-slate-500">{a.start === a.end ? shortDate(a.start) : `${shortDate(a.start)} – ${shortDate(a.end)}`} · {a.duties} dut{a.duties === 1 ? 'y' : 'ies'}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              ))}
            </Section>
          )}
          <Link to={`/leave-plan?year=${year}${crew ? `&crew=${crew}` : ''}`} className="mt-3 flex items-center justify-between rounded-2xl bg-white p-4 text-sm font-medium text-brand-700 shadow-sm ring-1 ring-slate-200">Annual Leave Plan {year}<ChevronRight className="h-4 w-4" /></Link>
        </>
      )}
      {open && view && inputs && (
        <DaySheet date={open} day={view.byDate.get(open) ?? evaluateRange(open, open, inputs.people, inputs.absences, inputs.rules, inputs.assignments)[0]} inputs={inputs}
          holiday={view.holidayOn(open)} bars={view.bars.filter((b) => b.start <= open && open <= b.end)} onClose={() => setOpen(null)}
          onAddEvent={() => { setSheet({ kind: 'event', event: null, date: open }); setOpen(null); }} onAddHoliday={() => { setSheet({ kind: 'holiday', holiday: null, date: open }); setOpen(null); }} />
      )}
      {sheet?.kind === 'event' && info && <EventSheet event={sheet.event} date={sheet.date} units={info.units} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadInfo(); }} />}
      {sheet?.kind === 'holiday' && <HolidaySheet holiday={sheet.holiday} date={sheet.date} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadInfo(); }} />}
    </div>
  );
}

function DayCell({ date, day, today, crew, filter, showPills, away, holiday, inEvent, onOpen }: {
  date: string; day: DayResult; today: string; crew: Crew | null; filter: Filter; showPills: boolean; away: number; holiday: Holiday | null; inEvent: boolean; onOpen: () => void;
}) {
  const marks = crewMarks(day);
  const byCrew = new Map(day.crews.map((c) => [c.crew, c]));
  const duty = (s: 'M' | 'A' | 'N') => marks.find((x) => x.shift === s);
  const mine = crew ? marks.find((x) => x.crew === crew) : null;
  const short = marks.some((x) => x.mark === 'red' || x.mark === 'pending');
  const dim = (filter === 'shortage' && !short) || (filter === 'holidays' && !holiday) || (filter === 'shutdowns' && !inEvent);
  const pill = (x: { crew: Crew; shift: string; mark: DayMark } | undefined, text?: string) => {
    if (!x) return <span className="h-[14px]" />;
    const hide = filter === 'shortage' && x.mark !== 'red' && x.mark !== 'pending';
    const n = x.mark === 'red' ? shortfall(byCrew.get(x.crew)!) : 0;
    return (
      <span className={cx('flex h-[14px] items-center justify-center rounded text-[10px] font-bold leading-none tabular-nums', x.mark === 'off' ? 'bg-slate-100 text-slate-500' : PILL[x.mark], hide && 'invisible')}>
        {text ?? x.crew}{n > 0 ? <span className="ml-px text-[9px]">−{n}</span> : null}
      </span>
    );
  };
  return (
    <button type="button" onClick={onOpen} aria-label={`${shortDate(date)}${holiday ? `, ${holiday.name}` : ''}`}
      aria-current={date === today ? 'date' : undefined}
      className={cx('flex min-w-0 flex-col gap-px rounded-md px-0.5 pb-0.5 pt-px text-left active:bg-slate-50',
        date === today ? cx('ring-[2.5px] ring-brand-700 shadow-md', holiday ? 'bg-pink-50' : 'bg-brand-50') : holiday ? 'bg-pink-50 ring-1 ring-pink-300' : 'ring-1 ring-slate-200',
        date < today && !holiday && 'bg-slate-50', dim && 'opacity-30')}>
      <span className="flex h-[13px] items-center justify-between gap-px">
        <span className="flex items-center text-[11px] font-semibold leading-none text-slate-700">
          {date === today
            ? <span className="-ml-px flex h-[13px] min-w-[15px] items-center justify-center rounded-full bg-brand-700 px-0.5 text-[10px] font-bold text-white">{Number(date.slice(8))}</span>
            : Number(date.slice(8))}
          {holiday && <Star className="ml-px h-2.5 w-2.5 fill-pink-500 text-pink-600" />}
        </span>
        {away > 0 && <span className="flex items-center text-[9px] leading-none text-slate-500"><UserMinus className="h-2.5 w-2.5" />{away}</span>}
      </span>
      {showPills && (crew
        ? pill(mine ?? undefined, mine?.shift === 'Off' ? 'Off' : mine?.shift)
        : <>{pill(duty('M'))}{pill(duty('A'))}{pill(duty('N'))}</>)}
      {!showPills && <span className="h-[14px]" />}
    </button>
  );
}

function Legend() {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1 text-[10px] text-slate-500">
      <span className="font-medium text-slate-600">M / A / N rows:</span>
      <span className="flex items-center gap-1"><span className="rounded bg-green-100 px-1 font-bold text-green-900">B</span>safe</span>
      <span className="flex items-center gap-1"><span className="rounded bg-amber-100 px-1 font-bold text-amber-900">B</span>at minimum</span>
      <span className="flex items-center gap-1"><span className="rounded bg-status-red px-1 font-bold text-white">B−1</span>short</span>
      <span className="flex items-center gap-1"><span className="rounded bg-slate-200 px-1 font-bold text-slate-700">B</span>pending</span>
      <span className="flex items-center gap-1"><Star className="h-2.5 w-2.5 fill-pink-500 text-pink-600" />holiday</span>
      <span className="flex items-center gap-1"><UserMinus className="h-2.5 w-2.5" />on leave</span>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="mt-3 py-1.5">
      <div className="flex items-center justify-between pt-1"><h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>{action}</div>
      <div className="divide-y divide-slate-100">{children}</div>
    </Card>
  );
}

