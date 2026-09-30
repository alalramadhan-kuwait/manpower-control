// The desktop side panel: a few small cards next to the page, chosen for the page you are on.
import { AlertTriangle, Bell, CalendarClock, CalendarOff, ChevronRight, ClipboardList, Eye, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { crewMarks, type DayMark } from '@/core/calendar';
import type { Notice } from '@/core/notifications';
import { addDaysIso } from '@/core/roster';
import { Card, Spinner, cx } from '@/ui/components';
import { shortDate } from '@/ui/leave';
import { useSideData, type SideData } from './useSideData';

type Widget = 'attention' | 'strip' | 'leave' | 'waiting' | 'estimates';
/** Which cards each page gets, in order. Pages not listed get the default. */
const PAGE: [RegExp, Widget[]][] = [
  [/^\/$/, ['strip', 'leave', 'attention']],
  [/^\/requests/, ['waiting', 'estimates', 'attention']],
  [/^\/employees/, ['leave', 'estimates', 'attention']],
  [/^\/(leave-plan|oracle)/, ['estimates', 'leave', 'attention']],
  [/^\/(controllers|movements)/, ['strip', 'attention', 'leave']]
];
const DEFAULT: Widget[] = ['attention', 'strip', 'leave'];
const widgetsFor = (path: string) => PAGE.find(([re]) => re.test(path))?.[1] ?? DEFAULT;

const MARK: Record<DayMark, string> = { green: 'bg-status-green', amber: 'bg-status-amber', red: 'bg-status-red', pending: 'bg-slate-400', off: 'bg-slate-200' };
const wd = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
const span = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);

function Panel({ title, icon, to, children }: { title: string; icon: ReactNode; to?: string; children: ReactNode }) {
  return (
    <Card className="mb-3 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{icon}{title}</h2>
        {to && <Link to={to} className="flex items-center text-[11px] font-medium text-brand-700">See all<ChevronRight className="h-3 w-3" /></Link>}
      </div>
      {children}
    </Card>
  );
}
const Empty = ({ children }: { children: ReactNode }) => <p className="text-xs text-slate-500">{children}</p>;

const LEVEL: Record<Notice['level'], { dot: string; icon: ReactNode }> = {
  action: { dot: 'bg-status-red', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  watch: { dot: 'bg-status-amber', icon: <Eye className="h-3.5 w-3.5" /> },
  info: { dot: 'bg-slate-400', icon: <Info className="h-3.5 w-3.5" /> }
};

function Attention({ d }: { d: SideData }) {
  const list = d.notices.filter((n) => n.level !== 'info').slice(0, 7);
  const actions = d.notices.filter((n) => n.level === 'action').length;
  return (
    <Panel title={`Needs attention${actions ? ` · ${actions}` : ''}`} icon={<Bell className="h-3.5 w-3.5" />} to="/notifications">
      {list.length === 0 ? <Empty>Nothing needs action in the coming weeks.</Empty> : (
        <ul className="divide-y divide-slate-100">
          {list.map((n) => (
            <li key={n.id}>
              <Link to={n.to} className="flex items-start gap-2 py-1.5">
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', LEVEL[n.level].dot)} />
                <span className="min-w-0"><span className="block truncate text-xs font-medium text-slate-800">{n.title}</span><span className="block truncate text-[11px] text-slate-500">{n.detail}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Strip({ d }: { d: SideData }) {
  return (
    <Panel title="Next 14 days" icon={<CalendarClock className="h-3.5 w-3.5" />} to="/calendar">
      <ul>
        {d.days.map((day) => {
          const marks = crewMarks(day).filter((m) => m.mark !== 'off');
          return (
            <li key={day.date}>
              <Link to={day.date === d.today ? '/' : `/?date=${day.date}`} className="flex items-center gap-2 rounded-md py-0.5 hover:bg-slate-50">
                <span className={cx('w-[5.5rem] shrink-0 whitespace-nowrap text-[11px] tabular-nums', day.date === d.today ? 'font-semibold text-slate-900' : 'text-slate-600')}>{wd(day.date)} {shortDate(day.date)}</span>
                <span className="flex flex-1 items-center gap-1">
                  {marks.length === 0 ? <span className="text-[10px] text-slate-400">no crew on duty</span> : marks.map((m) => (
                    <span key={m.crew} title={`${m.crew} shift`} className={cx('flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white', MARK[m.mark])}>{m.crew}</span>
                  ))}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[10px] text-slate-400">Crews on duty: green fine · amber no buffer · red short · grey not confirmed</p>
    </Panel>
  );
}

function LeaveNow({ d }: { d: SideData }) {
  const on = d.absences.filter((a) => a.start <= d.today && d.today <= a.end);
  const byPerson = new Map<string, { id: string; start: string; end: string }>();
  for (const a of on) { const cur = byPerson.get(a.employeeId); if (!cur || a.end > cur.end) byPerson.set(a.employeeId, { id: a.employeeId, start: cur && cur.start < a.start ? cur.start : a.start, end: a.end }); }
  const back = addDaysIso(d.today, 7);
  const soon = [...byPerson.values()].filter((l) => l.end <= back).sort((a, b) => a.end.localeCompare(b.end));
  const rest = [...byPerson.values()].filter((l) => l.end > back).length;
  const starting = d.absences.filter((a) => a.start > d.today && a.start <= addDaysIso(d.today, 3));
  return (
    <Panel title={`On leave now · ${byPerson.size}`} icon={<CalendarOff className="h-3.5 w-3.5" />} to="/requests">
      {byPerson.size === 0 ? <Empty>Nobody is on leave today.</Empty> : (
        <>
          {soon.length > 0 && <p className="mb-0.5 text-[11px] font-medium text-slate-600">Back within 7 days</p>}
          <ul className="divide-y divide-slate-100">
            {soon.slice(0, 6).map((l) => (
              <li key={l.id}><Link to={`/employees/${l.id}`} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate text-xs text-slate-800">{d.names.get(l.id) ?? 'Employee'}</span><span className="shrink-0 text-[11px] text-slate-500">till {shortDate(l.end)}</span></Link></li>
            ))}
          </ul>
          {rest > 0 && <p className="mt-1 text-[11px] text-slate-500">and {rest} more, back after that</p>}
        </>
      )}
      {starting.length > 0 && <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-[11px] text-slate-600">Starting in the next 3 days: {[...new Set(starting.map((a) => d.names.get(a.employeeId) ?? 'Employee'))].slice(0, 4).join(', ')}{new Set(starting.map((a) => a.employeeId)).size > 4 ? '…' : ''}</p>}
    </Panel>
  );
}

function Waiting({ d, isHead }: { d: SideData; isHead: boolean }) {
  const forms = d.requests; const changes = d.changes;
  const total = forms.length + changes.length;
  return (
    <Panel title={`${isHead ? 'Waiting for your decision' : 'Waiting for the Section Head'}${total ? ` · ${total}` : ''}`} icon={<ClipboardList className="h-3.5 w-3.5" />} to="/requests?view=forms">
      {total === 0 ? <Empty>No open requests.</Empty> : (
        <ul className="divide-y divide-slate-100">
          {changes.slice(0, 5).map((c) => (
            <li key={c.id}><Link to="/requests?view=forms" className="block py-1.5">
              <span className="block truncate text-xs font-medium text-slate-800">{d.names.get(c.employee_id) ?? 'Employee'} · Reschedule</span>
              <span className="block truncate text-[11px] text-slate-500">{span(c.old_start, c.old_end)} → {span(c.new_start, c.new_end)}</span>
              {c.impact && (c.impact.short > 0 || c.impact.clash.length > 0) && <span className="block text-[11px] font-semibold text-status-red">{c.impact.short > 0 ? `Crew short ${c.impact.short}d` : '2 Controllers off'}</span>}
            </Link></li>
          ))}
          {forms.slice(0, 5).map((r) => (
            <li key={r.id}><Link to={`/requests/${r.id}`} className="block py-1.5">
              <span className="block truncate text-xs font-medium text-slate-800">{d.names.get(r.employee_id) ?? 'Employee'} · {r.status === 'submitted' ? 'to review' : 'to decide'}</span>
              <span className="block truncate text-[11px] text-slate-500">{span(r.start_date, r.end_date)}</span>
            </Link></li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Estimates({ d }: { d: SideData }) {
  return (
    <Panel title={`Dates still an estimate · ${d.estimated.length}`} icon={<CalendarClock className="h-3.5 w-3.5" />}>
      {d.estimated.length === 0 ? <Empty>Every leave date is confirmed.</Empty> : (
        <ul className="divide-y divide-slate-100">
          {d.estimated.slice(0, 6).map((e) => (
            <li key={e.id}><Link to={`/employees/${e.employee_id}`} className="block py-1.5">
              <span className="block truncate text-xs font-medium text-slate-800">{d.names.get(e.employee_id) ?? 'Employee'}</span>
              <span className="block text-[11px] text-slate-500">{span(e.start_date, e.end_date)} · confirm at the final notice</span>
            </Link></li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The panel for the current page (desktop only; the Shell decides where it goes). */
export function SidePanel({ isHead }: { isHead: boolean }) {
  const { pathname } = useLocation();
  const data = useSideData(isHead);
  if (data === null) return <Spinner />;
  if (data === 'error') return <p className="text-xs text-slate-400">The side panel could not load.</p>;
  return (
    <div>
      {widgetsFor(pathname).map((w) => w === 'attention' ? <Attention key={w} d={data} /> : w === 'strip' ? <Strip key={w} d={data} />
        : w === 'leave' ? <LeaveNow key={w} d={data} /> : w === 'waiting' ? <Waiting key={w} d={data} isHead={isHead} /> : <Estimates key={w} d={data} />)}
    </div>
  );
}
