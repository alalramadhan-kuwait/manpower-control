// Week view of the calendar: one row per crew across Sunday–Saturday (their shift, coloured by status),
// leave per day, events, what needs attention and who is on leave that week.
import { ChevronLeft, ChevronRight, Star, UserMinus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { personOn } from '@/core/manpower';
import { isPlanPv } from '@/core/oracle';
import { fetchLeaveContext, type LeaveContext } from '@/data/leave';
import { isCrew } from '@/ui/crew';
import { FilterBar, matchLeave, useCalFilters, useScrollMemory } from './filters';
import { REQUEST_BAR, ROW_STYLE, SHORT_LABEL, absenceState } from './rowStyle';
import { WEEKDAY_SHORT, attentionPeriods, crewMarks, leaveScenarios, shortageKinds } from '@/core/calendar';
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
import { AttentionList, Legend, SHIFT_STYLE, Section, StatusBar, SummaryLine, ViewToggle, calendarBars, isShiftLetter, shownMark, summarizeShown } from './parts';
import { leaveToneShort } from '@/ui/leaveTypes';

const range = (a: string, b: string) => {
  if (a === b) return shortDate(a);
  const [da, db] = [shortDate(a), shortDate(b)];
  return a.slice(0, 7) === b.slice(0, 7) ? `${da.split(' ')[0]}–${db}` : `${da} – ${db}`;
};

export function WeekView({ start, today, onWeek, onMonth, onList }: { start: string; today: string; onWeek: (start: string) => void; onMonth: () => void; onList: () => void }) {
  const days = useMemo(() => weekDates(start), [start]);
  const end = days[6];
  const [inputs, setInputs] = useState<(ManpowerInputs & { key: string }) | null>(null);
  const [info, setInfo] = useState<(Awaited<ReturnType<typeof fetchCalendarInfo>> & { key: string }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [params, setParams] = useSearchParams();
  const [f, setF] = useCalFilters();
  const open = params.get('day');
  const setOpen = (d: string | null) => setParams((prev) => { const n = new URLSearchParams(prev); if (d) n.set('day', d); else n.delete('day'); return n; }, { replace: true });
  const [ctx, setCtx] = useState<(LeaveContext & { key: string }) | null>(null);
  const [sheet, setSheet] = useState<null | { kind: 'event'; event: UnitEvent | null; date?: string } | { kind: 'holiday'; holiday: Holiday | null; date?: string }>(null);
  const loadInfo = useCallback(() => fetchCalendarInfo(start, end).then((r) => setInfo({ ...r, key: start })).catch(setError), [start, end]);
  useEffect(() => {
    let live = true;
    setError(null);
    fetchManpowerInputs(addDaysIso(start, -1), addDaysIso(end, 1)).then((r) => live && setInputs({ ...r, key: start })).catch((e) => live && setError(e));
    loadInfo();
    fetchLeaveContext(start, end).then((c) => live && setCtx({ ...c, key: start })).catch(() => live && setCtx({ oracleLog: [], pending: [], moves: [], shutdowns: [], key: start }));
    return () => { live = false; };
  }, [start, end, loadInfo]);

  const view = useMemo(() => {
    if (!inputs || inputs.key !== start || !info || info.key !== start) return null;
    const results = evaluateRange(start, end, inputs.people, inputs.absencesAll, inputs.rules, inputs.assignments);
    const sc = leaveScenarios(inputs.absencesAll);
    const kinds = shortageKinds(results, evaluateRange(start, end, inputs.people, sc.approvedOnly, inputs.rules, inputs.assignments), evaluateRange(start, end, inputs.people, sc.allPlanned, inputs.rules, inputs.assignments));
    const byDate = new Map(results.map((d) => [d.date, d]));
    const people = new Map(inputs.people.map((p) => [p.id, p]));
    // leave of the week by the filters (crew: own crew or where the person actually works that week)
    const fits = (id: string, typeCode: string | null, approval: Parameters<typeof matchLeave>[1]['approval']) => {
      const p = people.get(id)!; const q = personOn(p, start < today && today <= end ? today : start);
      return matchLeave(f, { pos: p.role, typeCode, approval, home: p.role === 'vr_controller' ? null : p.crew, actual: q.crew, names: [p.name, p.employeeNumber, p.arabicName] });
    };
    const leave = leaveInRange(inputs.absences, start, end).filter((b) => people.has(b.employeeId) && fits(b.employeeId, b.typeCode, isPlanPv(b.typeCode) ? (b.oracle === 'approved' ? 'approved' : 'awaiting') : 'not_required'));
    const requests = (ctx?.key === start ? ctx.pending : []).filter((r) => (r.action === 'new' || r.action === 'extend') && r.start <= end && (r.end ?? '9999-12-31') >= start && people.has(r.employeeId) && fits(r.employeeId, r.typeCode, 'requested'));
    const away = (d: string) => new Set(leave.filter((b) => b.start <= d && d <= b.end).map((b) => b.employeeId)).size;
    const holidayOn = (d: string) => info.holidays.find((h) => h.start <= d && d <= h.end) ?? null;
    // who is on leave, by crew (people without a crew last), most senior first
    const groups = new Map<Crew | null, { block: (typeof leave)[number]; person: ManpowerInputs['people'][number] }[]>();
    for (const block of leave) { const person = people.get(block.employeeId)!; groups.set(person.crew, [...(groups.get(person.crew) ?? []), { block, person }]); }
    for (const g of groups.values()) g.sort((a, b) => bySeniority(a.person, b.person) || a.block.start.localeCompare(b.block.start));
    return { byDate, kinds, away, holidayOn, bars: calendarBars(inputs, info),
      summary: summarizeShown(results.map((d) => ({ marks: crewMarks(d).filter((x) => !isCrew(f.crew) || x.crew === f.crew).map((x) => (x.shift === 'Off' ? 'off' as const : shownMark(x.mark, kinds.get(`${d.date}|${x.crew}`)))) }))), attention: attentionPeriods(results.filter((d) => d.date >= today)).map((a) => {
        if (a.kind !== 'shortage') return a;
        let all = true; for (let d = a.start; d <= a.end; d = addDaysIso(d, 1)) if (kinds.get(`${d}|${a.crew}`) === 'confirmed') all = false;
        return all ? { ...a, text: 'Potential shortage · planned leave not approved' } : a;
      }),
      groups: [...CREWS, null].filter((c) => groups.has(c)).map((c) => ({ crew: c, rows: groups.get(c)! })), requests,
      onLeave: new Set(leave.map((b) => b.employeeId)).size, holidays: info.holidays.filter((h) => h.start <= end && h.end >= start) };
  }, [inputs, info, ctx, f, start, end, today]);
  useScrollMemory(!!view);

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
      <ViewToggle view="week" onChange={(v) => (v === 'list' ? onList() : v === 'month' && onMonth())} />
      <FilterBar f={f} set={setF} risk />

      {error ? <ErrorBox error={error} /> : !view ? <Spinner /> : (
        <>
          <SummaryLine c={view.summary} />

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
              {CREWS.filter((crew) => !isCrew(f.crew) || f.crew === crew).map((crew) => (
                <div key={crew} className={grid}>
                  <div className="flex items-center"><CrewBadge crew={crew} size="sm" /></div>
                  {days.map((d) => {
                    const day = view.byDate.get(d)!;
                    const m0 = crewMarks(day).find((x) => x.crew === crew)!;
                    const m = { ...m0, mark: m0.shift === 'Off' ? m0.mark : shownMark(m0.mark, view.kinds.get(`${d}|${crew}`)) };
                    const cd = day.crews.find((c) => c.crew === crew)!;
                    const n = m.mark === 'red' ? shortfall(cd) : 0;
                    const noCtl = cd.working && cd.controller.count < cd.controller.min;
                    return (
                      <button key={d} type="button" onClick={() => setOpen(d)} aria-label={`${crew} Shift ${shortDate(d)}: ${m.shift}`}
                        className={cx('relative flex h-9 flex-col items-center justify-center overflow-hidden rounded-md text-sm font-bold leading-none tabular-nums', f.risk && m.mark !== 'red' && m.mark !== 'potential' && m.mark !== 'pending' && 'opacity-30',
                          m.mark === 'off' || !isShiftLetter(m.shift) ? 'text-slate-300 ring-1 ring-slate-100' : SHIFT_STYLE[m.shift].cell, d === today && 'ring-2 ring-brand-700')}>
                        {m.shift === 'Off' ? '·' : m.shift}
                        {(n > 0 || noCtl) && <span className="mt-0.5 text-[9px]">{noCtl ? '−C' : ''}{n > 0 && !noCtl ? `−${n}` : ''}</span>}
                        {m.mark !== 'off' && <StatusBar mark={m.mark} thick />}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className={cx(grid, 'pt-0.5')}>
                <div className="flex items-center justify-center text-slate-500"><UserMinus className="h-3.5 w-3.5" /></div>
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

          <Section title="Needs attention"><AttentionList items={view.attention} onOpen={setOpen} past={addDaysIso(start, 6) < today} /></Section>

          <Section title={`On leave (${view.onLeave})`}>
            {view.requests.length > 0 && (
              <div className="py-1.5">
                <div className="mb-0.5 text-xs font-semibold text-amber-800">Requested · waiting for the Section Head</div>
                {view.requests.map((r) => { const p = inputs!.people.find((x) => x.id === r.employeeId)!;
                  return <Link key={r.id} to={`/calendar?view=list&month=${r.start.slice(0, 7)}&leave=rq-${r.id}`} className={cx('mb-0.5 ml-6 flex items-center gap-1.5 rounded border-l-[3px] px-2 py-1 text-sm', ROW_STYLE.pending.row, REQUEST_BAR)}>
                    <span className="min-w-0 flex-1 truncate text-slate-900">{p.name}</span>
                    <span className={cx('shrink-0 text-[11px] font-bold', ROW_STYLE.pending.text)}>requested</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">{range(r.start, r.end ?? r.start)}</span></Link>; })}
              </div>
            )}
            {view.groups.length === 0 ? (view.requests.length ? null : <p className="py-2 text-sm text-slate-500">Nobody this week</p>) : view.groups.map((g) => (
              <div key={g.crew ?? 'none'} className="py-1.5">
                <div className="mb-0.5 flex items-center gap-1.5">
                  {g.crew ? <CrewBadge crew={g.crew} size="sm" /> : <span className="text-xs font-semibold text-slate-500">No crew</span>}
                  <span className="text-xs text-slate-500">{new Set(g.rows.map((r) => r.person.id)).size}</span>
                </div>
                {g.rows.map(({ block, person }) => { const rs = absenceState(block, today); return (
                  <Link key={block.employeeId + block.start} to={`/calendar?view=list&month=${(block.start < start ? start : block.start).slice(0, 7)}&leave=${block.id ?? ''}`} className={cx('mb-0.5 ml-6 flex items-center gap-1.5 rounded border-l-[3px] px-2 py-1 text-sm', ROW_STYLE[rs].row)}>
                    <span className="min-w-0 flex-1 truncate text-slate-900">{person.name}</span><span className={cx('shrink-0 text-[11px] font-bold', ROW_STYLE[rs].text)}>{SHORT_LABEL[rs]}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">{block.typeShort ? <span className={`mr-1 rounded px-1 font-semibold ring-1 ${leaveToneShort(block.typeShort).chip}`}>{block.typeShort}</span> : null}{range(block.start, block.end)}</span>
                  </Link>
                ); })}
              </div>
            ))}
          </Section>
        </>
      )}

      {open && view && inputs && (
        <DaySheet kinds={view.kinds} date={open} day={view.byDate.get(open)!} inputs={inputs}
          holiday={view.holidayOn(open)} bars={view.bars.filter((b) => b.start <= open && open <= b.end)} onClose={() => setOpen(null)}
          onAddEvent={() => { setSheet({ kind: 'event', event: null, date: open }); setOpen(null); }} onAddHoliday={() => { setSheet({ kind: 'holiday', holiday: null, date: open }); setOpen(null); }} />
      )}
      {sheet?.kind === 'event' && info && <EventSheet event={sheet.event} date={sheet.date} units={info.units} sections={info.sections} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadInfo(); }} />}
      {sheet?.kind === 'holiday' && <HolidaySheet holiday={sheet.holiday} date={sheet.date} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadInfo(); }} />}
    </div>
  );
}
