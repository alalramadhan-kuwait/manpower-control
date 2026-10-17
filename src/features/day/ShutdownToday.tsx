// Today page: who is on duty on each shutdown team on the date. Shown only on the dates of an active shutdown.
import { ChevronDown, ChevronUp, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MpPerson } from '@/core/manpower';
import type { OnLeave } from '@/core/leave';
import { planDates, SD_SLOT_LABEL, type SdMember, type SdPlan, type SdTeam } from '@/core/shutdown';
import { memberDuty } from '@/core/shutdown/v2';
import { addDaysIso } from '@/core/roster';
import { fetchSdPlan, fetchSdPlans } from '@/data/shutdown';
import { Card, cx } from '@/ui/components';
import { shortDate } from '@/ui/leave';

type Loaded = { plan: SdPlan; teams: SdTeam[]; members: SdMember[] };
const SLOT_ORDER: Record<string, number> = { controller: 0, senior: 1, good: 2, new: 3, member: 4 };
const hhmm = (ms: number) => { const d = new Date(ms + 3 * 3600_000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

/** The active shutdowns that cover the date, with their teams and members (loaded once, then reused while stepping days). */
function useShutdownsOn(date: string) {
  const [all, setAll] = useState<Loaded[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchSdPlans()
      .then((plans) => Promise.all(plans.filter((p) => p.end >= addDaysIso(date, -60) && p.start <= addDaysIso(date, 60)).map((p) => fetchSdPlan(p.id))))
      .then((r) => live && setAll(r.map(({ plan, teams, members }) => ({ plan, teams, members }))))
      .catch(() => live && setAll([]));
    return () => { live = false; };
    // the plans are read once per page visit; a date far outside the window loads again
  }, [date.slice(0, 7)]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => (all ?? []).filter((x) => x.plan.start <= date && date <= x.plan.end), [all, date]);
}

export function ShutdownToday({ date, people, leave }: { date: string; people: MpPerson[]; leave: Map<string, OnLeave> }) {
  const plans = useShutdownsOn(date);
  if (!plans.length) return null;
  return <>{plans.map((x) => <PlanCard key={x.plan.id} x={x} date={date} people={people} leave={leave} />)}</>;
}

function PlanCard({ x, date, people, leave }: { x: Loaded; date: string; people: MpPerson[]; leave: Map<string, OnLeave> }) {
  const { plan, teams, members } = x;
  const name = useMemo(() => { const m = new Map(people.map((p) => [p.id, p.name])); return (id: string) => m.get(id) ?? 'Employee'; }, [people]);
  const dates = planDates(plan);
  const dayNo = dates.indexOf(date) + 1;
  return (
    <Card className="mb-3 ring-2 ring-teal-600">
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 shrink-0 text-teal-700" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-teal-900">{plan.title}</div>
          <div className="text-[11px] text-slate-500">Day {dayNo} of {dates.length} · {shortDate(plan.start)} – {shortDate(plan.end)}</div>
        </div>
        <Link to={`/shutdown/${plan.id}`} className="shrink-0 text-xs font-semibold text-brand-700">Plan ›</Link>
      </div>
      <div className="mt-2 space-y-2">
        {[...teams].sort((a, b) => a.sort - b.sort).map((t) => <TeamBlock key={t.id} plan={plan} team={t} members={members.filter((m) => m.teamId === t.id && m.start <= date && date <= m.end)} date={date} name={name} leave={leave} />)}
      </div>
    </Card>
  );
}

function TeamBlock({ plan, team, members, date, name, leave }: { plan: SdPlan; team: SdTeam; members: SdMember[]; date: string; name: (id: string) => string; leave: Map<string, OnLeave> }) {
  const [open, setOpen] = useState(false);
  const night = team.shiftCode === 'N';
  const rows = members.map((m) => ({ m, duty: memberDuty(plan, team, m, date), away: leave.get(m.employeeId) ?? null }))
    .sort((a, b) => (SLOT_ORDER[a.m.slot] ?? 9) - (SLOT_ORDER[b.m.slot] ?? 9) || (a.m.controllerRole === 'primary' ? -1 : 0) - (b.m.controllerRole === 'primary' ? -1 : 0) || name(a.m.employeeId).localeCompare(name(b.m.employeeId)));
  const on = rows.filter((r) => r.duty && !r.away);
  const off = rows.filter((r) => !r.duty || r.away);
  const first = on.find((r) => r.duty)?.duty;
  const hours = first ? `${hhmm(first.start)} – ${hhmm(first.end)}${night ? ' (next day)' : ''}` : team.hoursLabel ?? '';
  const ctl = on.filter((r) => r.m.slot === 'controller').length;
  return (
    <div className={cx('rounded-xl p-2 ring-1', night ? 'bg-slate-100 ring-slate-300' : 'bg-sky-50 ring-sky-200')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">{team.name} team · {hours}</span>
        <span className={cx('shrink-0 text-[11px] font-semibold', ctl ? 'text-slate-600' : 'text-status-red')}>{on.length} on duty{ctl ? '' : ' · no Controller'}</span>
      </div>
      {on.length ? (
        <ul className="mt-1 space-y-0.5">
          {on.map(({ m, duty }) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-800">{name(m.employeeId)}</span>
              <span className="shrink-0 text-[11px] text-slate-600">
                {m.slot === 'controller' && m.controllerRole ? `${m.controllerRole === 'primary' ? 'Primary' : 'Assistant'} ` : ''}{SD_SLOT_LABEL[m.slot] ?? m.slot}
                {duty && duty.hours < plan.shiftHours ? <span className="ml-1 font-semibold text-amber-700">{duty.hours} h</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-sm text-status-red">Nobody on duty</p>}
      {off.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 flex items-center gap-1 text-[11px] font-medium text-slate-500">
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}Off today · {off.length}
          </button>
          {open && (
            <ul className="mt-0.5 space-y-0.5 text-xs text-slate-600">
              {off.map(({ m, away }) => <li key={m.id} className="flex justify-between gap-2"><span className="truncate">{name(m.employeeId)}</span><span className="shrink-0">{away ? `${away.typeShort ?? 'Leave'} · back ${shortDate(away.returnOn)}` : 'Off'}</span></li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
