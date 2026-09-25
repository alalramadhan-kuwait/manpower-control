// Week view of the calendar: one row per crew across Sunday–Saturday (their shift, coloured by status),
// leave per day, events, what needs attention and who is on leave that week.
import { ChevronLeft, ChevronRight, Star, UserMinus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { WEEKDAY_SHORT, attentionPeriods, crewMarks, summarizeMonth } from '@/core/calendar';
import { leaveInRange, shortfall, weekBars, weekDates, weekStartOf } from '@/core/calendar/board';
import { evaluateRange } from '@/core/manpower';
import { CREWS, addDaysIso, type Crew } from '@/core/roster';
import { fetchCalendarInfo, type Holiday, type UnitEvent } from '@/data/calendar';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { Card, ErrorBox, Spinner, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { shortDate } from '@/ui/leave';
import { bySeniority } from '@/ui/positions';
import { DaySheet } from './DaySheet';
import { EventSheet, HolidaySheet } from './InfoSheets';
import { AttentionList, Legend, PILL, Section, SummaryTiles, ViewToggle, calendarBars } from './parts';

const range = (a: string, b: string) => {
  if (a === b) return shortDate(a);
  const [da, db] = [shortDate(a), shortDate(b)];
  return a.slice(0, 7) === b.slice(0, 7) ? `${da.split(' ')[0]}–${db}` : `${da} – ${db}`;
};

export function WeekView({ start, today, onWeek, onMonth }: { start: string; today: string; onWeek: (start: string) => void; onMonth: () => void }) {
  const days = useMemo(() => weekDates(start), [start]);
  const end = days[6];
  const [inputs, setInputs] = useState<(ManpowerInputs & { key: string }) | null>(null);
  const [info, setInfo] = useState<(Awaited<ReturnType<typeof fetchCalendarInfo>> & { key: string }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | { kind: 'event'; event: UnitEvent | null; date?: string } | { kind: 'holiday'; holiday: Holiday | null; date?: string }>(null);
  const loadInfo = useCallback(() => fetchCalendarInfo(start, end).then((r) => setInfo({ ...r, key: start })).catch(setError), [start, end]);
  useEffect(() => {
    let live = true;
    setError(null);
    fetchManpowerInputs(addDaysIso(start, -1), addDaysIso(end, 1)).then((r) => live && setInputs({ ...r, key: start })).catch((e) => live && setError(e));
    loadInfo();
    return () => { live = false; };
  }, [start, end, loadInfo]);

  const view = useMemo(() => {
    if (!inputs || inputs.key !== start || !info || info.key !== start) return null;
    const results = evaluateRange(start, end, inputs.people, inputs.absences, inputs.rules, inputs.assignments);
    const byDate = new Map(results.map((d) => [d.date, d]));
    const people = new Map(inputs.people.map((p) => [p.id, p]));
    const leave = leaveInRange(inputs.absences, start, end).filter((b) => people.has(b.employeeId));
    const away = (d: string) => new Set(leave.filter((b) => b.start <= d && d <= b.end).map((b) => b.employeeId)).size;
    const holidayOn = (d: string) => info.holidays.find((h) => h.start <= d && d <= h.end) ?? null;
    // who is on leave, by crew (people without a crew last), most senior first
    const groups = new Map<Crew | null, { block: (typeof leave)[number]; person: ManpowerInputs['people'][number] }[]>();
    for (const block of leave) { const person = people.get(block.employeeId)!; groups.set(person.crew, [...(groups.get(person.crew) ?? []), { block, person }]); }
    for (const g of groups.values()) g.sort((a, b) => bySeniority(a.person, b.person) || a.block.start.localeCompare(b.block.start));
    return { byDate, away, holidayOn, bars: calendarBars(inputs, info), summary: summarizeMonth(results), attention: attentionPeriods(results),
      groups: [...CREWS, null].filter((c) => groups.has(c)).map((c) => ({ crew: c, rows: groups.get(c)! })),
      onLeave: new Set(leave.map((b) => b.employeeId)).size, holidays: info.holidays.filter((h) => h.start <= end && h.end >= start) };
  }, [inputs, info, start, end]);

  const thisWeek = weekStartOf(today);
  const bars = view ? weekBars(days, view.bars, days) : [];
  const lanes = bars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
  const grid = 'grid grid-cols-[26px_repeat(7,minmax(0,1fr))] gap-x-0.5';

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button aria-label="Previous week" onClick={() => onWeek(addDaysIso(start, -7))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 active:bg-slate-50"><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="text-lg font-semibold leading-tight text-brand-800">{range(start, end)} {end.slice(0, 4)}</h1>
          {start !== thisWeek && <button onClick={() => onWeek(thisWeek)} className="text-[11px] font-medium text-brand-700">Back to this week</button>}
        </div>
        <button aria-label="Next week" onClick={() => onWeek(addDaysIso(start, 7))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 active:bg-slate-50"><ChevronRight className="h-5 w-5" /></button>
      </div>
      <ViewToggle view="week" onChange={onMonth} />

      {error ? <ErrorBox error={error} /> : !view ? <Spinner /> : (
        <>
          <SummaryTiles summary={view.summary} />

          <Card className="p-1.5">
            <div className={cx(grid, 'mb-1')}>
              <div />
              {days.map((d, i) => {
                const h = view.holidayOn(d);
                return (
                  <button key={d} type="button" onClick={() => setOpen(d)} aria-label={`${shortDate(d)}${h ? `, ${h.name}` : ''}`} aria-current={d === today ? 'date' : undefined}
                    className={cx('flex flex-col items-center rounded-md py-0.5 leading-none', h ? 'bg-pink-50 ring-1 ring-pink-300' : '', d < today && !h && 'opacity-60')}>
                    <span className="text-[10px] font-medium text-slate-500">{WEEKDAY_SHORT[i].slice(0, 2)}</span>
                    <span className={cx('mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-0.5 text-xs font-semibold',
                      d === today ? 'bg-brand-700 text-white' : 'text-slate-800')}>{Number(d.slice(8))}</span>
                    {h ? <Star className="mt-px h-2.5 w-2.5 fill-pink-500 text-pink-600" /> : <span className="mt-px h-2.5" />}
                  </button>
                );
              })}
            </div>

            <div className="space-y-0.5">
              {CREWS.map((crew) => (
                <div key={crew} className={grid}>
                  <div className="flex items-center"><CrewBadge crew={crew} size="sm" /></div>
                  {days.map((d) => {
                    const day = view.byDate.get(d)!;
                    const m = crewMarks(day).find((x) => x.crew === crew)!;
                    const n = m.mark === 'red' ? shortfall(day.crews.find((c) => c.crew === crew)!) : 0;
                    return (
                      <button key={d} type="button" onClick={() => setOpen(d)} aria-label={`${crew} Shift ${shortDate(d)}: ${m.shift}`}
                        className={cx('flex h-9 flex-col items-center justify-center rounded-md text-sm font-bold leading-none tabular-nums',
                          m.mark === 'off' ? 'text-slate-300 ring-1 ring-slate-100' : PILL[m.mark], d === today && 'ring-2 ring-brand-700')}>
                        {m.shift === 'Off' ? '·' : m.shift}
                        {n > 0 && <span className="mt-0.5 text-[9px]">−{n}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className={cx(grid, 'pt-0.5')}>
                <div className="flex items-center justify-center text-slate-400"><UserMinus className="h-3.5 w-3.5" /></div>
                {days.map((d) => { const n = view.away(d); return <div key={d} className="text-center text-[11px] font-medium tabular-nums text-slate-500">{n || ''}</div>; })}
              </div>
            </div>

            {lanes > 0 && (
              <div className={cx(grid, 'mt-1 gap-y-px')} style={{ gridTemplateRows: `repeat(${lanes}, 16px)` }}>
                {bars.map((b) => {
                  const Icon = b.item.icon;
                  return (
                    <button key={b.item.id} type="button" onClick={() => setOpen(days[b.col])}
                      style={{ gridColumn: `${b.col + 2} / span ${b.span}`, gridRow: b.lane + 1 }}
                      className={cx('flex min-w-0 items-center gap-0.5 px-1 text-left text-[10px] font-semibold leading-none text-white', b.item.cls, b.startsHere ? 'rounded-l-md' : '', b.endsHere ? 'rounded-r-md' : '')}>
                      <Icon className="h-2.5 w-2.5 shrink-0" /><span className="truncate">{b.item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
          <Legend rows="Crew rows:" sample="M" />

          {view.holidays.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {view.holidays.map((h) => (
                <button key={h.id} type="button" onClick={() => setSheet({ kind: 'holiday', holiday: h })} className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-2 py-0.5 text-xs font-medium text-pink-800 ring-1 ring-pink-300">
                  <Star className="h-3 w-3 fill-pink-500 text-pink-600" />{h.name} · {range(h.start, h.end)}{h.expected ? ' (expected)' : ''}
                </button>
              ))}
            </div>
          )}

          <Section title="Needs attention"><AttentionList items={view.attention} onOpen={setOpen} /></Section>

          <Section title={`On leave (${view.onLeave})`}>
            {view.groups.length === 0 ? <p className="py-2 text-sm text-slate-500">Nobody this week</p> : view.groups.map((g) => (
              <div key={g.crew ?? 'none'} className="py-1.5">
                <div className="mb-0.5 flex items-center gap-1.5">
                  {g.crew ? <CrewBadge crew={g.crew} size="sm" /> : <span className="text-xs font-semibold text-slate-500">No crew</span>}
                  <span className="text-xs text-slate-500">{new Set(g.rows.map((r) => r.person.id)).size}</span>
                </div>
                {g.rows.map(({ block, person }) => (
                  <Link key={block.employeeId + block.start} to={`/employees/${person.id}`} className="flex items-center gap-2 py-1 pl-8 text-sm">
                    <span className="min-w-0 flex-1 truncate text-slate-900">{person.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">{block.typeShort ? <span className="mr-1 rounded bg-yellow-100 px-1 font-semibold text-yellow-900">{block.typeShort}</span> : null}{range(block.start, block.end)}</span>
                  </Link>
                ))}
              </div>
            ))}
          </Section>
        </>
      )}

      {open && view && inputs && (
        <DaySheet date={open} day={view.byDate.get(open)!} inputs={inputs}
          holiday={view.holidayOn(open)} bars={view.bars.filter((b) => b.start <= open && open <= b.end)} onClose={() => setOpen(null)}
          onAddEvent={() => { setSheet({ kind: 'event', event: null, date: open }); setOpen(null); }} onAddHoliday={() => { setSheet({ kind: 'holiday', holiday: null, date: open }); setOpen(null); }} />
      )}
      {sheet?.kind === 'event' && info && <EventSheet event={sheet.event} date={sheet.date} units={info.units} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadInfo(); }} />}
      {sheet?.kind === 'holiday' && <HolidaySheet holiday={sheet.holiday} date={sheet.date} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadInfo(); }} />}
    </div>
  );
}
