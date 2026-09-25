// Pieces shared by the month and week views of the calendar.
import { ChevronRight, Star, UserMinus, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AttentionPeriod, DayMark, MonthSummary } from '@/core/calendar';
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

/** Crew duties needing attention, joined into periods; tap opens the first day. */
export function AttentionList({ items, onOpen }: { items: AttentionPeriod[]; onOpen: (date: string) => void }) {
  if (items.length === 0) return <p className="py-2 text-sm text-slate-500">All clear ✓</p>;
  return (
    <>
      {items.map((a) => (
        <button key={`${a.crew}${a.start}${a.kind}`} type="button" onClick={() => onOpen(a.start)} className="flex w-full items-center gap-3 py-2 text-left">
          <CrewBadge crew={a.crew} size="sm" />
          <span className="min-w-0 flex-1">
            <span className={cx('block text-sm font-medium', a.kind === 'shortage' ? 'text-status-red' : 'text-slate-700')}>{a.text}</span>
            <span className="block text-xs text-slate-500">{a.start === a.end ? shortDate(a.start) : `${shortDate(a.start)} – ${shortDate(a.end)}`} · {a.duties} dut{a.duties === 1 ? 'y' : 'ies'}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      ))}
    </>
  );
}

/** Status colours only: green safe, amber at minimum, red below minimum, grey pending. */
export const PILL: Record<Exclude<DayMark, 'off'>, string> = {
  green: 'bg-green-100 text-green-900', amber: 'bg-amber-100 text-amber-900', red: 'bg-status-red text-white', pending: 'bg-slate-200 text-slate-700'
};
const SUMMARY: { key: Exclude<DayMark, 'off'>; label: string; dot: string }[] = [
  { key: 'red', label: 'Short', dot: 'bg-status-red' }, { key: 'amber', label: 'At min', dot: 'bg-status-amber' },
  { key: 'green', label: 'Safe', dot: 'bg-status-green' }, { key: 'pending', label: 'Pending', dot: 'bg-slate-400' }
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

export type CalendarView = 'month' | 'week';
export function ViewToggle({ view, onChange }: { view: CalendarView; onChange: (v: CalendarView) => void }) {
  return (
    <div role="tablist" className="mb-2 grid grid-cols-2 rounded-xl bg-slate-200/70 p-0.5 text-sm">
      {(['month', 'week'] as const).map((v) => (
        <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => onChange(v)}
          className={cx('min-h-8 rounded-lg font-medium', view === v ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{v === 'month' ? 'Month' : 'Week'}</button>
      ))}
    </div>
  );
}

/** Colour key. The month grid has a row per shift holding crew letters; the week grid a row per crew holding shift letters. */
export function Legend({ rows = 'M / A / N rows:', sample = 'B' }: { rows?: string; sample?: string }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1 text-[10px] text-slate-500">
      <span className="font-medium text-slate-600">{rows}</span>
      <span className="flex items-center gap-1"><span className="rounded bg-green-100 px-1 font-bold text-green-900">{sample}</span>safe</span>
      <span className="flex items-center gap-1"><span className="rounded bg-amber-100 px-1 font-bold text-amber-900">{sample}</span>at minimum</span>
      <span className="flex items-center gap-1"><span className="rounded bg-status-red px-1 font-bold text-white">{sample}−1</span>short</span>
      <span className="flex items-center gap-1"><span className="rounded bg-slate-200 px-1 font-bold text-slate-700">{sample}</span>pending</span>
      <span className="flex items-center gap-1"><Star className="h-2.5 w-2.5 fill-pink-500 text-pink-600" />holiday</span>
      <span className="flex items-center gap-1"><UserMinus className="h-2.5 w-2.5" />on leave</span>
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
