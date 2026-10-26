// Pieces shared by the month and week views of the calendar.
import { ChevronRight, Star, UserMinus, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { AttentionPeriod, DayMark, MonthSummary, ShortageKind } from '@/core/calendar';
import type { UnitEvent } from '@/data/calendar';
import type { ManpowerInputs } from '@/data/manpower';
import { EVENT_ICON, UNIT_BAR } from '@/ui/calendar';
import { Card, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { shortDate } from '@/ui/leave';

export type Bar = { id: string; start: string; end: string; label: string; cls: string; icon: LucideIcon; event?: UnitEvent };
const dates = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)}–${shortDate(b)}`);

/** Operating-mode periods and unit events as calendar bars; each unit / train keeps its colour. */
export function calendarBars(inputs: ManpowerInputs, info: { events: UnitEvent[]; units: string[] }): Bar[] {
  const unitIndex = (u: string | null) => (u ? info.units.indexOf(u.trim()) : -1);
  return [
    ...inputs.plan.periods.filter((p) => p.status === 'active').map((p) => ({ id: `mode-${p.id}`, start: p.start, end: p.end, label: `${inputs.plan.modes.find((x) => x.code === p.modeCode)?.label ?? p.modeCode} · ${dates(p.start, p.end)}`, cls: 'bg-brand-700', icon: EVENT_ICON.mode })),
    ...info.events.map((e) => ({ id: e.id, start: e.start, end: e.end, event: e, icon: EVENT_ICON[e.category],
      label: `${e.unit ? `${e.unit} ` : ''}${e.title} · ${dates(e.start, e.end)}`, cls: UNIT_BAR[Math.max(0, unitIndex(e.unit)) % UNIT_BAR.length] }))
  ];
}

/** Crew duties needing attention (today on: the past is only for tracking), joined into periods; tap opens the first day. */
export function AttentionList({ items, onOpen, past = false }: { items: AttentionPeriod[]; onOpen: (date: string) => void; past?: boolean }) {
  if (items.length === 0) return <p className="py-2 text-sm text-slate-500">{past ? 'These dates have passed: nothing to act on.' : 'All clear ✓'}</p>;
  return (
    <>
      {items.map((a) => (
        <button key={`${a.crew}${a.start}${a.kind}`} type="button" onClick={() => onOpen(a.start)} className="flex w-full items-center gap-3 py-2 text-left">
          <CrewBadge crew={a.crew} size="sm" />
          <span className="min-w-0 flex-1">
            <span className={cx('block text-sm font-medium', a.kind === 'shortage' ? 'text-status-red' : 'text-slate-700')}>{a.text}</span>
            <span className="block text-xs text-slate-500">{a.start === a.end ? shortDate(a.start) : `${shortDate(a.start)} – ${shortDate(a.end)}`} · {a.duties} dut{a.duties === 1 ? 'y' : 'ies'}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
        </button>
      ))}
    </>
  );
}

/** Shift colours: morning sky, afternoon orange, night indigo. They say which shift a cell is; the cover status is the bar under it (STATUS_BAR). */
export const SHIFT_STYLE: Record<'M' | 'A' | 'N', { cell: string; name: string }> = {
  M: { cell: 'bg-sky-200 text-sky-950', name: 'Morning' }, A: { cell: 'bg-orange-200 text-orange-950', name: 'Afternoon' }, N: { cell: 'bg-indigo-800 text-white', name: 'Night' }
};
/** Cover status as a bar along the bottom of a shift cell: green safe, amber at minimum, red below minimum, grey pending. */
export const STATUS_BAR: Record<Exclude<DayMark, 'off'>, string> = { green: 'bg-green-600', amber: 'bg-amber-500', red: 'bg-status-red', pending: 'bg-slate-400' };
export const isShiftLetter = (s: string): s is 'M' | 'A' | 'N' => s === 'M' || s === 'A' || s === 'N';
/** The bar itself: put it inside a `relative overflow-hidden` shift cell. */
export function StatusBar({ mark, thick = false }: { mark: Exclude<DayMark, 'off'> | 'potential'; thick?: boolean }) {
  // potential shortage (only planned leave not approved makes it short): the red bar dashed
  if (mark === 'potential') return <span aria-hidden className={cx('absolute inset-x-0 bottom-0 border-dashed border-status-red', thick ? 'border-b-4' : 'border-b-[3px]')} />;
  return <span aria-hidden className={cx('absolute inset-x-0 bottom-0', thick ? 'h-1' : 'h-[3px]', STATUS_BAR[mark])} />;
}

/** The mark a duty shows: confirmed shortage red, potential shortage (planned leave not approved) dashed red, else the app's result. */
export type ShownMark = DayMark | 'potential';
export function shownMark(mark: DayMark, kind: ShortageKind | undefined): ShownMark {
  if (kind === 'confirmed') return 'red';
  if (kind === 'potential') return 'potential';
  return mark;
}
const DAY_RANK: Record<ShownMark, number> = { off: -1, green: 0, amber: 1, pending: 2, potential: 3, red: 4 };
/** Days of a period by their worst shown duty: Short / Potential / Cover or data / At min / Safe. */
export function summarizeShown(days: { marks: ShownMark[] }[]) {
  const c = { red: 0, potential: 0, pending: 0, amber: 0, green: 0 };
  for (const d of days) { const w = d.marks.reduce<ShownMark>((m, x) => (DAY_RANK[x] > DAY_RANK[m] ? x : m), 'off'); if (w !== 'off') c[w]++; }
  return c;
}
/** One line: the period's days by their worst duty (replaces the four tiles). */
export function SummaryLine({ c }: { c: ReturnType<typeof summarizeShown> }) {
  const item = (n: number, label: string, dot: ReactNode, strong = false) =>
    <span className={cx('flex items-center gap-1 whitespace-nowrap', n === 0 && 'text-slate-500')}>{dot}<b className={cx('tabular-nums', strong && n > 0 && 'text-status-red')}>{n}</b>{label}</span>;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 px-1 text-[11px] text-slate-600" aria-label="Days by their worst shift" title="Days, by their worst shift">
      {item(c.red, 'short', <span className="h-2 w-2 rounded-full bg-status-red" />, true)}
      {item(c.potential, 'potential', <span className="h-0 w-2.5 border-b-2 border-dashed border-status-red" />)}
      {item(c.pending, 'cover / data', <span className="h-2 w-2 rounded-full bg-slate-400" />)}
      {item(c.amber, 'at min', <span className="h-2 w-2 rounded-full bg-status-amber" />)}
      {item(c.green, 'safe', <span className="h-2 w-2 rounded-full bg-status-green" />)}
    </div>
  );
}

const SUMMARY: { key: Exclude<DayMark, 'off'>; label: string; dot: string }[] = [
  { key: 'red', label: 'Short', dot: 'bg-status-red' }, { key: 'amber', label: 'At min', dot: 'bg-status-amber' },
  { key: 'green', label: 'Safe', dot: 'bg-status-green' }, { key: 'pending', label: 'Cover / data', dot: 'bg-slate-400' }
];

/** Days by their worst crew: Short / At min / Safe / Pending. */
export function SummaryTiles({ summary }: { summary: MonthSummary }) {
  return (
    <div className="mb-2 grid grid-cols-4 gap-1 text-center">
      {SUMMARY.map((k) => (
        <div key={k.key} className="rounded-lg bg-white px-1 py-1 ring-1 ring-slate-200">
          <div className="flex items-center justify-center gap-1 text-base font-semibold leading-tight tabular-nums text-slate-800"><span className={cx('h-2 w-2 rounded-full', k.dot)} />{summary[k.key]}</div>
          <div className="text-[10px] leading-tight text-slate-500">{k.label}</div>
        </div>
      ))}
    </div>
  );
}

export type CalendarView = 'month' | 'week' | 'list';
export function ViewToggle({ view, onChange }: { view: CalendarView; onChange: (v: CalendarView) => void }) {
  return (
    <div role="tablist" className="mb-2 grid grid-cols-3 rounded-xl bg-slate-200/70 p-0.5 text-sm">
      {(['month', 'week', 'list'] as const).map((v) => (
        <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => onChange(v)}
          className={cx('min-h-8 rounded-lg font-medium', view === v ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{v === 'month' ? 'Month' : v === 'week' ? 'Week' : 'List'}</button>
      ))}
    </div>
  );
}

/** Colour key: the colour of a cell is its shift; the bar under it is the cover status. The month grid has a row per shift holding crew letters; the week grid a row per crew holding shift letters. */
export function Legend({ rows = 'M / A / N rows:', sample = 'B' }: { rows?: string; sample?: string }) {
  const [open, setOpen] = useState(false);
  const bar = (mark: Exclude<DayMark, 'off'> | 'potential') => <span className="relative inline-block h-3 w-4 overflow-hidden rounded bg-slate-100"><StatusBar mark={mark} thick /></span>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-1 px-1 text-[11px] font-medium text-slate-500">Key ▸</button>;
  return (
    <div className="mt-1.5 space-y-1 px-1 text-[10px] text-slate-500" onClick={() => setOpen(false)}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="font-medium text-slate-600">{rows}</span>
        {(['M', 'A', 'N'] as const).map((k) => <span key={k} className="flex items-center gap-1"><span className={cx('rounded px-1 font-bold', SHIFT_STYLE[k].cell)}>{sample === 'B' ? k === 'M' ? 'B' : k === 'A' ? 'C' : 'D' : k}</span>{SHIFT_STYLE[k].name}</span>)}
        <span className="flex items-center gap-1"><Star className="h-2.5 w-2.5 fill-pink-500 text-pink-600" />holiday</span>
        <span className="flex items-center gap-1"><UserMinus className="h-2.5 w-2.5" />on leave</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="font-medium text-slate-600">Bar under it:</span>
        <span className="flex items-center gap-1">{bar('green')}safe</span>
        <span className="flex items-center gap-1">{bar('amber')}at minimum</span>
        <span className="flex items-center gap-1">{bar('red')}short (−1)</span>
        <span className="flex items-center gap-1">{bar('potential')}potential short (planned leave not approved)</span>
        <span className="flex items-center gap-1"><b className="text-slate-700">−C</b>no Controller</span>
        <span className="flex items-center gap-1">{bar('pending')}cover needed / data missing</span>
      </div>
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="mt-3 py-1.5">
      <div className="flex items-center justify-between pt-1"><h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>{action}</div>
      <div className="divide-y divide-slate-100">{children}</div>
    </Card>
  );
}
