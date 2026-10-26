import { ChevronLeft, ChevronRight, Star, UserMinus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MONTH_NAMES, WEEKDAY_SHORT, attentionPeriods, crewMarks, leaveScenarios, monthEnd, monthStart, monthWeeks, shiftMonth, shortageKinds, type ShortageKind } from '@/core/calendar';
import { personOn } from '@/core/manpower';
import { isPlanPv } from '@/core/oracle';
import { fetchLeaveContext, type LeaveContext } from '@/data/leave';
import { FILTER_KEYS, FilterBar, matchLeave, useCalFilters, useScrollMemory } from './filters';
import { fillWeek, shortfall, weekBars, weekStartOf } from '@/core/calendar/board';
import { evaluateRange, type DayResult } from '@/core/manpower';
import { addDaysIso, type Crew } from '@/core/roster';
import { EVENT_CATEGORY_LABEL, fetchCalendarInfo, type Holiday, type UnitEvent } from '@/data/calendar';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { Card, ErrorBox, Spinner, cx } from '@/ui/components';
import { isCrew } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { DaySheet } from './DaySheet';
import { EventSheet, HolidaySheet } from './InfoSheets';
import { AttentionList, Legend, SHIFT_STYLE, Section, StatusBar, SummaryLine, ViewToggle, calendarBars, shownMark, summarizeShown, type ShownMark } from './parts';
import { WeekView } from './WeekView';
import { LeaveListView } from './LeaveList';

// view, month / week, the open day or leave and the filters all live in the address: every move keeps the filters
const withFilters = (params: URLSearchParams, set: Record<string, string | null>) => {
  const n = new URLSearchParams();
  for (const k of FILTER_KEYS) { const v = params.get(k); if (v) n.set(k, v); }
  for (const [k, v] of Object.entries(set)) if (v) n.set(k, v);
  return n;
};

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const today = localToday();
  const go = (set: Record<string, string | null>) => setParams(withFilters(params, set), { replace: true });
  const monthKey = (k: string) => (k === today.slice(0, 7) ? null : k);
  if (params.get('view') === 'list') {
    // the leave list of a month (same month and filters as the calendar)
    const m = /^(\d{4})-(\d{2})$/.exec(params.get('month') ?? '');
    const [y, mo] = m ? [Number(m[1]), Number(m[2])] : [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    const k = `${y}-${String(mo).padStart(2, '0')}`;
    return <LeaveListView year={y} month={mo} onMonth={(yy, mm) => go({ view: 'list', month: monthKey(`${yy}-${String(mm).padStart(2, '0')}`) })}
      onView={(v) => (v === 'week' ? go({ view: 'week', week: weekStartOf(k === today.slice(0, 7) ? today : `${k}-01`) }) : go({ month: monthKey(k) }))} />;
  }
  if (params.get('view') !== 'week') return <MonthView go={go} />;
  const w = params.get('week') ?? '';
  const start = /^\d{4}-\d{2}-\d{2}$/.test(w) && !Number.isNaN(Date.parse(w)) ? weekStartOf(w) : weekStartOf(today);
  const mid = addDaysIso(start, 3).slice(0, 7);
  return <WeekView start={start} today={today}
    onWeek={(st) => go({ view: 'week', week: st === weekStartOf(today) ? null : st })}
    onMonth={() => go({ month: monthKey(mid) })}
    onList={() => go({ view: 'list', month: monthKey(mid) })} />;
}

function MonthView({ go: goView }: { go: (set: Record<string, string | null>) => void }) {
  const [params, setParams] = useSearchParams();
  const today = localToday();
  const m = /^(\d{4})-(\d{2})$/.exec(params.get('month') ?? '');
  const [year, month] = m ? [Number(m[1]), Number(m[2])] : [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const [f, setF] = useCalFilters();
  const crew = isCrew(f.crew) ? f.crew : null;
  const go = (y: number, mo: number) => { const key = `${y}-${String(mo).padStart(2, '0')}`; goView({ month: key === today.slice(0, 7) ? null : key }); };

  const from = monthStart(year, month), to = monthEnd(year, month);
  const gridFrom = addDaysIso(from, -7), gridTo = addDaysIso(to, 7);
  const [inputs, setInputs] = useState<(ManpowerInputs & { key: string }) | null>(null);
  const [info, setInfo] = useState<(Awaited<ReturnType<typeof fetchCalendarInfo>> & { key: string }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  // the open day is in the address (…&day=), so Back from the page it opens shows it again
  const open = params.get('day');
  const setOpen = (d: string | null) => setParams((prev) => { const n = new URLSearchParams(prev); if (d) n.set('day', d); else n.delete('day'); return n; }, { replace: true });
  const [ctx, setCtx] = useState<(LeaveContext & { key: string }) | null>(null);
  const [evOpen, setEvOpen] = useState(false);
  const [sheet, setSheet] = useState<null | { kind: 'event'; event: UnitEvent | null; date?: string } | { kind: 'holiday'; holiday: Holiday | null; date?: string }>(null);
  const loadInfo = useCallback(() => fetchCalendarInfo(gridFrom, gridTo).then((r) => setInfo({ ...r, key: from })).catch(setError), [gridFrom, gridTo, from]);
  useEffect(() => {
    let live = true;
    setError(null);
    fetchManpowerInputs(addDaysIso(gridFrom, -1), addDaysIso(gridTo, 1)).then((r) => live && setInputs({ ...r, key: from })).catch((e) => live && setError(e));
    loadInfo();
    fetchLeaveContext(gridFrom, gridTo).then((c) => live && setCtx({ ...c, key: from })).catch(() => live && setCtx({ oracleLog: [], pending: [], moves: [], shutdowns: [], key: from }));
    return () => { live = false; };
  }, [from, gridFrom, gridTo, loadInfo]);

  const view = useMemo(() => {
    if (!inputs || inputs.key !== from || !info || info.key !== from) return null;
    const days = evaluateRange(gridFrom, gridTo, inputs.people, inputs.absencesAll, inputs.rules, inputs.assignments);
    const byDate = new Map(days.map((d) => [d.date, d]));
    const monthDays = days.filter((d) => d.date >= from && d.date <= to);
    const byPerson = new Map(inputs.people.map((p) => [p.id, p]));
    // leave per day, by the filters (crew: own or actual crew on that day)
    const counted = inputs.absences.filter((a) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && byPerson.has(a.employeeId));
    const fits = (id: string, d: string, typeCode: string | null, approval: Parameters<typeof matchLeave>[1]['approval']) => {
      const p = byPerson.get(id)!; const q = personOn(p, d);
      return matchLeave(f, { pos: p.role, typeCode, approval, home: p.role === 'vr_controller' ? null : p.crew, actual: q.crew, names: [p.name, p.employeeNumber, p.arabicName] });
    };
    const away = (d: string) => new Set(counted.filter((a) => a.start <= d && d <= a.end && fits(a.employeeId, d, a.typeCode, isPlanPv(a.typeCode) ? (a.oracle === 'approved' ? 'approved' : 'awaiting') : 'not_required')).map((a) => a.employeeId)).size;
    const pend = (ctx?.key === from ? ctx.pending : []).filter((r) => r.action === 'new' || r.action === 'extend');
    const requested = (d: string) => new Set(pend.filter((r) => r.start <= d && d <= (r.end ?? '9999-12-31') && byPerson.has(r.employeeId) && fits(r.employeeId, d, r.typeCode, 'requested')).map((r) => r.employeeId)).size;
    const holidayOn = (d: string) => info.holidays.find((h) => h.start <= d && d <= h.end) ?? null;
    const bars = calendarBars(inputs, info);
    const filtered: DayResult[] = crew ? monthDays.map((d) => ({ ...d, crews: d.crews.filter((c) => c.crew === crew) })) : monthDays;
    // confirmed vs potential shortage (display only): against only-approved and all-planned leave
    const sc = leaveScenarios(inputs.absencesAll);
    const kinds = shortageKinds(days, evaluateRange(gridFrom, gridTo, inputs.people, sc.approvedOnly, inputs.rules, inputs.assignments), evaluateRange(gridFrom, gridTo, inputs.people, sc.allPlanned, inputs.rules, inputs.assignments));
    const shown = (d: DayResult) => crewMarks(d).filter((x) => !crew || x.crew === crew).map((x) => (x.shift === 'Off' ? 'off' as const : shownMark(x.mark, kinds.get(`${d.date}|${x.crew}`))));
    // a shortage period that is short only because of planned leave not approved reads as potential
    const attention = attentionPeriods(filtered.filter((d) => d.date >= today)).map((a) => {
      if (a.kind !== 'shortage') return a;
      let all = true; for (let d = a.start; d <= a.end; d = addDaysIso(d, 1)) if (kinds.get(`${d}|${a.crew}`) === 'confirmed') all = false;
      return all ? { ...a, text: 'Potential shortage · planned leave not approved' } : a;
    });
    return { byDate, kinds, away, requested, holidayOn, bars, summary: summarizeShown(monthDays.map((d) => ({ marks: shown(d) }))), attention,
      monthHolidays: info.holidays.filter((h) => h.start <= to && h.end >= from), monthBars: bars.filter((b) => b.start <= to && b.end >= from) };
  }, [inputs, info, ctx, f, from, to, gridFrom, gridTo, crew, today]);
  useScrollMemory(!!view);

  const [py, pm] = shiftMonth(year, month, -1); const [ny, nm] = shiftMonth(year, month, 1);
  const isThisMonth = today.slice(0, 7) === from.slice(0, 7);
  const showPills = true;
  const showBars = true;

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

      <ViewToggle view="month" onChange={(v) => { if (v === 'week') goView({ view: 'week', week: weekStartOf(isThisMonth ? today : from) });
        else if (v === 'list') goView({ view: 'list', month: isThisMonth ? null : from.slice(0, 7) }); }} />
      <FilterBar f={f} set={setF} risk />
      {error ? <ErrorBox error={error} /> : !view ? <Spinner /> : (
        <>
          <SummaryLine c={view.summary} />


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
                        <div className="flex flex-col pt-[15px] text-[9px] font-semibold leading-[14px] text-slate-500"><span className="mb-px">M</span><span className="mb-px">A</span><span>N</span></div>
                      ) : <div />}
                      {week.map((d, di) => d ? <DayCell key={d} date={d} day={view.byDate.get(d)!} kinds={view.kinds} today={today} crew={crew} risk={f.risk} showPills={showPills}
                        away={view.away(d)} requested={view.requested(d)} holiday={view.holidayOn(d)} inEvent={view.bars.some((b) => b.start <= d && d <= b.end)} onOpen={() => setOpen(d)} /> : <div key={`x${di}`} />)}
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
          <Section title="Needs attention">
            <AttentionList items={view.attention} onOpen={setOpen} past={to < today} />
          </Section>
          <button type="button" aria-expanded={evOpen} onClick={() => setEvOpen(!evOpen)} className="mt-2 flex w-full items-center justify-between rounded-xl bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
            <span>{evOpen ? '▾' : '▸'} Events &amp; shutdowns {view.monthBars.length}{view.monthHolidays.length ? ` · Holidays ${view.monthHolidays.length}` : ''}</span>
            <Link to={`/leave-planning?tab=annual&year=${year}${crew ? `&crew=${crew}` : ''}`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand-700">Annual plan {year} ›</Link>
          </button>
          {evOpen && <>
          {view.monthHolidays.length > 0 ? (
            <Section title={`Holidays (${view.monthHolidays.length})`} action={<button type="button" className="text-xs font-medium text-brand-700" onClick={() => setSheet({ kind: 'holiday', holiday: null, date: from })}>+ Holiday</button>}>
              {view.monthHolidays.length === 0 ? <p className="py-2 text-sm text-slate-500">None this month</p> : view.monthHolidays.map((h) => (
                <button key={h.id} type="button" onClick={() => setSheet({ kind: 'holiday', holiday: h })} className="flex w-full items-center gap-2 py-2 text-left">
                  <Star className="h-4 w-4 shrink-0 fill-pink-500 text-pink-600" />
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-900">{h.name}</span><span className="block text-xs text-slate-500">{h.start === h.end ? shortDate(h.start) : `${shortDate(h.start)} – ${shortDate(h.end)}`}{h.expected ? ' · expected, to be confirmed' : ''}</span></span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                </button>
              ))}
            </Section>
          ) : null}

          <Section title={`Events & shutdowns (${view.monthBars.length})`} action={<button type="button" className="text-xs font-medium text-brand-700" onClick={() => setSheet({ kind: 'event', event: null, date: isThisMonth ? today : from })}>+ Event</button>}>
            {view.monthBars.length === 0 ? <p className="py-2 text-sm text-slate-500">None this month</p> : view.monthBars.map((b) => {
              const Icon = b.icon;
              const inner = <><span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white', b.cls)}><Icon className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{b.label}</span><span className="block text-xs text-slate-500">{b.event ? EVENT_CATEGORY_LABEL[b.event.category] : 'Operating mode: own minimums per crew'}{b.event?.note ? ` · ${b.event.note}` : ''}</span></span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" /></>;
              return b.event ? <button key={b.id} type="button" onClick={() => setSheet({ kind: 'event', event: b.event! })} className="flex w-full items-center gap-2 py-2 text-left">{inner}</button>
                : <Link key={b.id} to="/shutdown?tab=modes" className="flex items-center gap-2 py-2">{inner}</Link>;
            })}
          </Section>

          </>}
        </>
      )}
      {open && view && inputs && (
        <DaySheet kinds={view.kinds} date={open} day={view.byDate.get(open) ?? evaluateRange(open, open, inputs.people, inputs.absencesAll, inputs.rules, inputs.assignments)[0]} inputs={inputs}
          holiday={view.holidayOn(open)} bars={view.bars.filter((b) => b.start <= open && open <= b.end)} onClose={() => setOpen(null)}
          onAddEvent={() => { setSheet({ kind: 'event', event: null, date: open }); setOpen(null); }} onAddHoliday={() => { setSheet({ kind: 'holiday', holiday: null, date: open }); setOpen(null); }} />
      )}
      {sheet?.kind === 'event' && info && <EventSheet event={sheet.event} date={sheet.date} units={info.units} sections={info.sections} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadInfo(); }} />}
      {sheet?.kind === 'holiday' && <HolidaySheet holiday={sheet.holiday} date={sheet.date} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadInfo(); }} />}
    </div>
  );
}

function DayCell({ date, day, kinds, today, crew, risk, showPills, away, requested, holiday, onOpen }: {
  date: string; day: DayResult; kinds: Map<string, ShortageKind>; today: string; crew: Crew | null; risk: boolean; showPills: boolean; away: number; requested: number; holiday: Holiday | null; inEvent: boolean; onOpen: () => void;
}) {
  const marks = crewMarks(day).map((x) => ({ ...x, mark: x.shift === 'Off' ? x.mark : shownMark(x.mark, kinds.get(`${date}|${x.crew}`)) }));
  const byCrew = new Map(day.crews.map((c) => [c.crew, c]));
  const duty = (s: 'M' | 'A' | 'N') => marks.find((x) => x.shift === s);
  const mine = crew ? marks.find((x) => x.crew === crew) : null;
  const short = marks.some((x) => x.mark === 'red' || x.mark === 'potential' || x.mark === 'pending');
  const dim = risk && !short;
  const pill = (x: { crew: Crew; shift: string; mark: ShownMark } | undefined, text?: string, shiftKey?: 'M' | 'A' | 'N') => {
    if (!x) return <span className="h-[14px]" />;
    const hide = risk && x.mark !== 'red' && x.mark !== 'potential' && x.mark !== 'pending';
    const n = x.mark === 'red' ? shortfall(byCrew.get(x.crew)!) : 0;
    return (
      <span className={cx('relative flex h-[14px] items-center justify-center overflow-hidden rounded text-[10px] font-bold leading-none tabular-nums', x.mark === 'off' || !shiftKey ? 'bg-slate-100 text-slate-500' : SHIFT_STYLE[shiftKey].cell, hide && 'invisible')}>
        {text ?? x.crew}{n > 0 ? <span className="ml-px text-[9px]">−{n}</span> : null}
        {x.mark !== 'off' && <StatusBar mark={x.mark} />}
      </span>
    );
  };
  return (
    <button type="button" onClick={onOpen} aria-label={`${shortDate(date)}${holiday ? `, ${holiday.name}` : ''}`}
      aria-current={date === today ? 'date' : undefined}
      className={cx('flex min-w-0 flex-col gap-px rounded-md px-0.5 pb-0.5 pt-px text-left active:bg-slate-50',
        date === today ? cx('ring-[2.5px] ring-brand-700 shadow-md', holiday ? 'bg-pink-50' : 'bg-brand-50') : holiday ? 'bg-pink-50 ring-1 ring-pink-300' : 'ring-1 ring-slate-200',
        date < today && !holiday && 'bg-slate-50', requested > 0 && 'outline-dashed outline-1 outline-brand-600', dim && 'opacity-30')}>
      <span className="flex h-[13px] items-center justify-between gap-px">
        <span className="flex items-center text-[11px] font-semibold leading-none text-slate-700">
          {date === today
            ? <span className="-ml-px flex h-[13px] min-w-[15px] items-center justify-center rounded-full bg-brand-700 px-0.5 text-[10px] font-bold text-white">{Number(date.slice(8))}</span>
            : Number(date.slice(8))}
          {holiday && <Star className="ml-px h-2.5 w-2.5 fill-pink-500 text-pink-600" />}
        </span>
        {(away > 0 || requested > 0) && <span className="flex items-center text-[9px] leading-none text-slate-500"><UserMinus className="h-2.5 w-2.5" />{away}{requested > 0 && <span className="ml-px font-bold text-brand-700">+{requested}</span>}</span>}
      </span>
      {showPills && (crew
        ? pill(mine ?? undefined, mine?.shift === 'Off' ? 'Off' : mine?.shift, mine && (mine.shift === 'M' || mine.shift === 'A' || mine.shift === 'N') ? mine.shift : undefined)
        : <>{pill(duty('M'), undefined, 'M')}{pill(duty('A'), undefined, 'A')}{pill(duty('N'), undefined, 'N')}</>)}
      {!showPills && <span className="h-[14px]" />}
    </button>
  );
}
