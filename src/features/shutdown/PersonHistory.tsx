import { useEffect, useState } from 'react';
import { SD_SLOT_LABEL, memberHours, planDates } from '@/core/shutdown';
import { cycleOvertime } from '@/core/shutdown/overtime';
import { memberDuty } from '@/core/shutdown/v2';
import type { Crew } from '@/core/roster';
import { fetchPersonShutdowns, fetchPersonSickLeave, fetchSickTotals, type PersonShutdown } from '@/data/shutdown';
import { fmtDate } from '@/ui/components';
import { localToday } from '@/ui/leave';

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

/** A person's sick leave (yearly totals and any recorded dates) and the shutdowns he has been on. */
export function PersonHistory({ employeeId, crew, skipPlanId, showSick = true }: { employeeId: string; crew: Crew | null; skipPlanId?: string; showSick?: boolean }) {
  const [state, setState] = useState<{ totals: Record<number, number>; sick: { start: string; end: string; long: boolean }[]; sds: PersonShutdown[] } | null | 'error'>(null);
  const today = localToday();
  useEffect(() => {
    const y = Number(today.slice(0, 4));
    Promise.all([fetchSickTotals([y, y - 1, y - 2]), fetchPersonSickLeave(employeeId), fetchPersonShutdowns(employeeId)])
      .then(([t, sick, sds]) => setState({ totals: t.get(employeeId) ?? {}, sick, sds })).catch(() => setState('error'));
  }, [employeeId, today]);
  if (state === null) return <p className="text-xs text-slate-500">Loading his history…</p>;
  if (state === 'error') return <p className="text-xs text-status-red">Could not load his history.</p>;
  const years = Object.keys(state.totals).map(Number).sort((a, b) => b - a);
  const sds = state.sds.filter((x) => x.plan.id !== skipPlanId);
  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      {showSick && <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sick leave</h3>
        {years.length === 0 && state.sick.length === 0 ? <p className="text-sm text-slate-500">None recorded.</p> : (
          <>
            {years.length > 0 && <p className="text-sm text-slate-800">{years.map((y) => `${y}: ${state.totals[y]} ${state.totals[y] === 1 ? 'day' : 'days'}`).join(' · ')}</p>}
            {state.sick.slice(0, 6).map((s) => <p key={s.start} className="text-xs text-slate-600">{fmtDate(s.start)}{s.end !== s.start ? ` – ${fmtDate(s.end)}` : ''} · {days(s.start, s.end)} {days(s.start, s.end) === 1 ? 'day' : 'days'}{s.long ? ' · long sick' : ''}</p>)}
            {state.sick.length > 6 && <p className="text-[11px] text-slate-500">and {state.sick.length - 6} earlier</p>}
          </>
        )}
      </section>}
      <section>
        {showSick && <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Shutdowns{skipPlanId ? ' before and after this one' : ''}</h3>}
        {sds.length === 0 ? <p className="text-sm text-slate-500">None.</p> : sds.map(({ plan, team, member }) => {
          const h = memberHours(plan, member, member.followCrew ?? crew);
          const worked = h.reduce((n, x) => n + x.days, 0);
          // rules v2: the overtime engine (each day against the 8-day crew roster); before v2: day by day, as those plans were made
          const ot = (plan.rulesVersion ?? 1) >= 2 && team
            ? cycleOvertime(planDates(plan).flatMap((d) => { const x = memberDuty(plan, team, member, d); return x ? [{ date: d, start: x.start, hours: x.hours }] : []; }),
              { from: member.start > plan.start ? member.start : plan.start, to: member.end < plan.end ? member.end : plan.end, crewOn: () => member.followCrew ?? crew, normalHours: plan.normalHours }).total
            : h.reduce((n, x) => n + x.overtime, 0);
          const state = plan.end < today ? 'Done' : plan.start <= today ? 'Running' : 'Coming';
          return (
            <div key={member.id} className="py-1">
              <p className="text-sm font-medium text-slate-900">{plan.title} <span className="text-[11px] font-normal text-slate-500">· {state}</span></p>
              <p className="text-xs text-slate-600">{fmtDate(plan.start)} – {fmtDate(plan.end)}</p>
              <p className="text-xs text-slate-500">{team ? `${team.name} team · ` : ''}{SD_SLOT_LABEL[member.slot]}{member.area ? ` · ${member.area}` : ''} · {worked} days worked · overtime {ot} h</p>
            </div>
          );
        })}
      </section>
    </div>
  );
}
