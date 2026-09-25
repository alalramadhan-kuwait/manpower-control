import { ChevronRight, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LEAVE_GROUPS, leaveGroup, shortfall, type LeaveGroup } from '@/core/calendar/board';
import type { CrewDay, DayResult } from '@/core/manpower';
import { minimumsText } from '@/core/modes';
import type { Holiday } from '@/data/calendar';
import type { ManpowerInputs } from '@/data/manpower';
import { BottomSheet, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { shortDate } from '@/ui/leave';
import type { Bar } from './CalendarPage';

const STATUS: Record<string, { text: string; cls: string }> = {
  green: { text: 'Safe', cls: 'bg-green-100 text-green-900' }, amber: { text: 'At minimum', cls: 'bg-amber-100 text-amber-900' },
  red: { text: 'Short', cls: 'bg-status-red text-white' }, pending: { text: 'Pending', cls: 'bg-slate-200 text-slate-700' }
};
const markOf = (c: CrewDay) => (c.finalStatus ?? (c.pending.length ? 'pending' : c.status) ?? 'pending') as keyof typeof STATUS;

/** Everything about one date, over the calendar: shifts, manpower against the minimum, leave by reason, holiday, events. */
export function DaySheet({ date, day, inputs, holiday, bars, onClose, onAddEvent, onAddHoliday }: {
  date: string; day: DayResult; inputs: ManpowerInputs; holiday: Holiday | null; bars: Bar[]; onClose: () => void; onAddEvent: () => void; onAddHoliday: () => void;
}) {
  const title = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  const people = new Map(inputs.people.map((p) => [p.id, p]));
  const onLeave = inputs.absences.filter((a) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && a.start <= date && date <= a.end && people.has(a.employeeId));
  const groups = new Map<LeaveGroup, typeof onLeave>();
  for (const a of onLeave) groups.set(leaveGroup(a.typeCode), [...(groups.get(leaveGroup(a.typeCode)) ?? []), a]);
  const count = new Set(onLeave.map((a) => a.employeeId)).size;
  const order = { M: 0, A: 1, N: 2, Off: 3 } as Record<string, number>;
  const crews = [...day.crews].sort((a, b) => order[a.state] - order[b.state]);

  return (
    <BottomSheet open onClose={onClose} title={title}>
      <div className="space-y-3">
        {(holiday || bars.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {holiday && <span className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-2 py-0.5 text-xs font-medium text-pink-800 ring-1 ring-pink-300"><Star className="h-3 w-3 fill-pink-500 text-pink-600" />{holiday.name}{holiday.expected ? ' (expected)' : ''}</span>}
            {bars.map((b) => { const Icon = b.icon; return <span key={b.id} className={cx('inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white', b.cls)}><Icon className="h-3 w-3 shrink-0" /><span className="truncate">{b.label}</span></span>; })}
          </div>
        )}
        <p className="text-xs text-slate-500">{day.rules.modeLabel} · required per crew: {minimumsText(day.rules)}</p>

        <div className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
          {crews.map((c) => {
            if (!c.working) return (
              <div key={c.crew} className="flex items-center gap-2 px-2.5 py-2 text-sm text-slate-500"><span className="w-7 text-xs font-semibold">Off</span><CrewBadge crew={c.crew} size="sm" muted /><span>{c.crew} Shift · rest day</span></div>
            );
            const mark = markOf(c);
            const n = shortfall(c);
            // one Controller is the normal complement, so the buffer is the tighter of Panel and Field (incl. a Grade 13+ lent across)
            const buffer = Math.min(c.panel.buffer, c.field.buffer);
            return (
              <div key={c.crew} className="px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-7 text-xs font-semibold text-slate-700">{c.state}</span>
                  <CrewBadge crew={c.crew} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{c.crew} Shift <span className="font-normal text-slate-500">· {c.dutyLabel}</span></span>
                  <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS[mark].cls)}>{mark === 'red' && n > 0 ? `Short −${n}` : STATUS[mark].text}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 pl-9 text-xs tabular-nums text-slate-600">
                  {[c.controller, c.panel, c.field].map((p) => <span key={p.key} className={cx(p.finding === 'shortage' && 'font-semibold text-status-red')}>{p.label} {p.count}/{p.min}</span>)}
                  {mark !== 'red' && mark !== 'pending' && <span className="text-slate-500">{buffer > 0 ? `buffer +${buffer}` : 'no buffer'}</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <h3 className="mb-1 text-xs font-semibold text-slate-700">On leave / unavailable · {count}</h3>
          {count === 0 ? <p className="text-xs text-slate-500">Nobody on leave.</p> : (
            <div className="space-y-1.5">
              {LEAVE_GROUPS.filter((g) => groups.has(g)).map((g) => (
                <div key={g} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                  <div className="text-[11px] font-semibold text-slate-600">{g} · {groups.get(g)!.length}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-800">
                    {groups.get(g)!.map((a) => { const p = people.get(a.employeeId)!; return <span key={a.employeeId + a.start}>{p.name}{p.crew ? <span className="text-slate-400"> · {p.crew}</span> : ''}<span className="text-slate-400"> · until {shortDate(a.end)}</span></span>; })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <Link to={`/?date=${date}`} className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-2 text-white">Full day<ChevronRight className="h-3.5 w-3.5" /></Link>
          <button type="button" onClick={onAddEvent} className="rounded-lg px-3 py-2 text-brand-700 ring-1 ring-slate-200">+ Event</button>
          {!holiday && <button type="button" onClick={onAddHoliday} className="rounded-lg px-3 py-2 text-brand-700 ring-1 ring-slate-200">+ Holiday</button>}
        </div>
      </div>
    </BottomSheet>
  );
}
