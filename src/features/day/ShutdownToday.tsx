// Today page: who is on duty on each shutdown team on the date. Shown only on the dates of an active shutdown.
import { hour12 } from '@/core/clock';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MpPerson } from '@/core/manpower';
import type { OnLeave } from '@/core/leave';
import { planDates, type SdMember, type SdPlan, type SdTeam } from '@/core/shutdown';
import { memberDuty } from '@/core/shutdown/v2';
import { addDaysIso } from '@/core/roster';
import { fetchSdPlan, fetchSdPlans } from '@/data/shutdown';
import { cx } from '@/ui/components';
import { shortDate } from '@/ui/leave';

type Loaded = { plan: SdPlan; teams: SdTeam[]; members: SdMember[] };
const SLOT_ORDER: Record<string, number> = { controller: 0, senior: 1, good: 2, new: 3, member: 4 };
const hhmm = (ms: number) => hour12(ms);

/** The active shutdowns that cover the date, with their teams and members (loaded once, then reused while stepping days). */
function useShutdownsOn(date: string, tick: number) {
  const [all, setAll] = useState<Loaded[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchSdPlans()
      .then((plans) => Promise.all(plans.filter((p) => p.end >= addDaysIso(date, -60) && p.start <= addDaysIso(date, 60)).map((p) => fetchSdPlan(p.id))))
      .then((r) => live && setAll(r.map(({ plan, teams, members }) => ({ plan, teams, members }))))
      .catch(() => live && setAll([]));
    return () => { live = false; };
    // the plans are read once per page visit; a date far outside the window loads again
  }, [date.slice(0, 7), tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => (all ?? []).filter((x) => x.plan.start <= date && date <= x.plan.end), [all, date]);
}

export function ShutdownToday({ date, people, leave, tick = 0 }: { date: string; people: MpPerson[]; leave: Map<string, OnLeave>; tick?: number }) {
  const plans = useShutdownsOn(date, tick);
  if (!plans.length) return null;
  return <>{plans.map((x) => <PlanCard key={x.plan.id} x={x} date={date} people={people} leave={leave} />)}</>;
}

/** One shutdown's teams on the date. Without `link` (the engineer view, outside the app's pages) there is no Plan link. */
export function PlanCard({ x, date, people, leave, link = true }: { x: Loaded; date: string; people: { id: string; name: string }[]; leave: Map<string, OnLeave>; link?: boolean }) {
  const { plan, teams, members } = x;
  const name = useMemo(() => { const m = new Map(people.map((p) => [p.id, p.name])); return (id: string) => m.get(id) ?? 'Employee'; }, [people]);
  const dates = planDates(plan);
  const dayNo = dates.indexOf(date) + 1;
  const ts = [...teams].sort((a, b) => a.sort - b.sort);
  return (
    <section className="mb-2">
      <div className="mx-1 mb-1 flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wide text-slate-500">{plan.title} team <span className="font-normal normal-case">· day {dayNo} of {dates.length}</span></h2>
        {link && <Link to={`/shutdown/${plan.id}`} className="shrink-0 text-xs font-semibold text-brand-700">Plan ›</Link>}
      </div>
      <div className="grid overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200" style={{ gridTemplateColumns: `repeat(${Math.max(1, ts.length)}, minmax(0, 1fr))` }}>
        {ts.map((t, i) => <TeamBlock key={t.id} edge={i > 0} plan={plan} team={t} members={members.filter((m) => m.teamId === t.id && m.start <= date && date <= m.end)} date={date} name={name} leave={leave} />)}
      </div>
    </section>
  );
}

function TeamBlock({ edge, plan, team, members, date, name, leave }: { edge: boolean; plan: SdPlan; team: SdTeam; members: SdMember[]; date: string; name: (id: string) => string; leave: Map<string, OnLeave> }) {
  const [open, setOpen] = useState(false);
  const night = team.shiftCode === 'N';
  const rows = members.map((m) => ({ m, duty: memberDuty(plan, team, m, date), away: leave.get(m.employeeId) ?? null }))
    .sort((a, b) => (SLOT_ORDER[a.m.slot] ?? 9) - (SLOT_ORDER[b.m.slot] ?? 9) || (a.m.controllerRole === 'primary' ? -1 : 0) - (b.m.controllerRole === 'primary' ? -1 : 0) || name(a.m.employeeId).localeCompare(name(b.m.employeeId)));
  const on = rows.filter((r) => r.duty && !r.away);
  const off = rows.filter((r) => !r.duty || r.away);
  const first = on.find((r) => r.duty)?.duty;
  const ctl = on.filter((r) => r.m.slot === 'controller').length;
  const ctls = on.filter((r) => r.m.slot === 'controller'), rest = on.filter((r) => r.m.slot !== 'controller');
  // the Day team in the Morning colour, the Night team in the Night colour (as the shifts on the Today page)
  return (
    <div className={cx('min-w-0 overflow-hidden text-[12px] leading-[1.45]', night ? 'bg-indigo-50/70' : 'bg-amber-50/70', edge && 'border-l border-white')}>
      <div className={cx('flex items-center gap-1 whitespace-nowrap px-2 py-1 text-[10px] font-extrabold uppercase', night ? 'bg-indigo-300 text-indigo-950' : 'bg-amber-200 text-amber-950')}>
        <span className="truncate">{night ? '☾' : '☀'} {team.name} {first ? `${hhmm(first.start)}–${hhmm(first.end)}` : team.hoursLabel ?? ''}</span><span className="ml-auto normal-case">{on.length} on</span>
      </div>
      <div className="px-2 pb-2 pt-1">
        {ctl ? <><b className="block truncate font-extrabold text-brand-800">{ctls[0] && name(ctls[0].m.employeeId)}</b>{ctls.slice(1).map((r) => <span key={r.m.id} className="block truncate text-[12px] text-slate-500">+ {name(r.m.employeeId)}</span>)}</>
          : <b className="block text-status-red">No Controller</b>}
        <div className="mt-1">
          {rest.map(({ m, duty }) => <span key={m.id} className="block truncate text-slate-800">{name(m.employeeId)}{duty && duty.hours < plan.shiftHours ? <span className="ml-1 text-[11px] font-semibold text-amber-700">{duty.hours} h</span> : null}</span>)}
          {!on.length && <span className="text-status-red">Nobody on duty</span>}
        </div>
        {off.length > 0 && (
          <>
            <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 flex items-center gap-1 text-[11px] font-medium text-slate-500">
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}Off today · {off.length}
            </button>
            {open && <ul className="mt-0.5 space-y-0.5 text-[11px] text-slate-600">{off.map(({ m, away }) => <li key={m.id} className="truncate">{name(m.employeeId)} · {away ? `${away.typeShort ?? 'Leave'} · back ${shortDate(away.returnOn)}` : 'off'}</li>)}</ul>}
          </>
        )}
      </div>
    </div>
  );
}
