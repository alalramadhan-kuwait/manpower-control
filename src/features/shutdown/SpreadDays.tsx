import { Minus, Plus, Shuffle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Crew } from '@/core/roster';
import { defaultMaxRun, spreadPlan, MAX_WEEK_HOURS } from '@/core/shutdown/spread';
import { slotLabel, type SdMember, type SdPhase, type SdPlan, type SdTeam } from '@/core/shutdown';
import { setSdDaysMany } from '@/data/shutdown';
import { BottomSheet, Button, ErrorBox, cx } from '@/ui/components';
import { Link } from 'react-router-dom';
import { CrewBadge } from '@/ui/crew';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const arrow = (a: number, b: number, unit = '') => (a === b ? <span className="text-slate-700">{b}{unit}</span> : <span className={b < a ? 'font-semibold text-status-green' : 'font-semibold text-status-red'}>{a}{unit} → {b}{unit}</span>);

/**
 * Balance the days and hours of the teams. Train shutdown: everybody works the duty days of their own crew, each slot has
 * its people every day and one person for the full shift, the others the normal hours, overtime shared evenly.
 * Total turnaround: stagger the days off inside each place so it keeps its people every day with the least overtime.
 */
export function SpreadDaysSheet({ plan, teams, members, phases, names, crewOf, conflicts, onClose, onDone }: {
  plan: SdPlan; teams: SdTeam[]; members: SdMember[]; phases: SdPhase[]; names: Map<string, string>;
  crewOf: (employeeId: string) => Crew | null;
  /** Team members who have leave inside the shutdown (a team member takes none): balanced as if they were all present. */
  conflicts: { employeeId: string; number: string; days: number }[];
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [maxRun, setMaxRun] = useState(defaultMaxRun(plan));
  const [reach, setReach] = useState(false);
  // shutdown team members take no leave: the days are planned with everybody present, the leave to move is listed above
  const results = useMemo(() => spreadPlan(plan, teams, members, phases, { crewOf, away: () => false, maxRun, reachLimit: reach }), [plan, teams, members, phases, crewOf, maxRun, reach]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const id = (r: (typeof results)[number]) => `${r.group.teamId}:${r.group.key}`;
  const train = plan.kind !== 'total';
  // total turnaround: a place that would end up with more days short than now is kept as it is; a train slot follows the crews' days, and the gaps it shows are for you to fill
  const worse = (r: (typeof results)[number]) => !train && r.after.short > r.before.short;
  // a train shutdown needs a Controller, a Senior and a Good FO on the full shift every day: a slot that would leave a
  // day without one is not applied (add a person from another crew first; working a rest day would make 7 duty days in a row)
  const gaps = (r: (typeof results)[number]) => (train && r.group.key !== 'new' ? [...new Set([...r.after.gapDates, ...r.after.noFullDates])].sort() : []);
  const blocked = results.filter((r) => r.group.memberIds.length > 0 && gaps(r).length > 0);
  const chosen = results.filter((r) => r.group.memberIds.length > 0 && !off.has(id(r)) && !worse(r) && gaps(r).length === 0);
  const people = new Set(chosen.flatMap((r) => r.group.memberIds)).size;
  const sum = (f: (r: (typeof results)[number]) => number) => chosen.reduce((n, r) => n + f(r), 0);
  const teamName = (tid: string) => teams.find((t) => t.id === tid)?.name ?? '';
  async function apply() {
    setBusy(true); setErr(null);
    try {
      const rows = chosen.flatMap((r) => [...r.days].flatMap(([memberId, days]) => Object.entries(days).map(([date, works]) => ({ memberId, date, works, hours: r.hours.get(memberId)?.[date] ?? null }))));
      await setSdDaysMany(rows);
      onDone(`${train ? 'Days and hours balanced' : 'Days off spread'} for ${people} ${people === 1 ? 'person' : 'people'}: overtime ${sum((r) => r.before.overtime)} h → ${sum((r) => r.after.overtime)} h.`);
    } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title={train ? 'Own-crew days and hours' : 'Spread the days off'}>
      <div className="space-y-3">
        {train ? (
          <>
          <p className="text-xs text-slate-600">Everyone works only the duty days of their own crew, so nobody works a rest day and nobody gets an extra day off. Every day each team has a Controller, a Senior and a Good FO on the full {plan.shiftHours} h; the others come for {Math.min(plan.normalHours, plan.shiftHours)} h. The full shifts are shared out evenly, then topped up so each person reaches {plan.maxOvertime} h of overtime in each calendar month where the fatigue limits allow, never above. New FO may stay empty.</p>
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={reach} onChange={(e) => setReach(e.target.checked)} /><span>Reach {plan.maxOvertime} h a month for everyone, even if it needs up to 6 full shifts in a row (the crew&apos;s whole block of duty days). Off keeps at most 4 by day and 3 by night.</span></label>
          {blocked.length > 0 && (
            <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-900 ring-1 ring-red-300">
              <p className="font-semibold">Not ready: {blocked.length} {blocked.length === 1 ? 'place has' : 'places have'} days without the full shift covered</p>
              <p>Each place below is not applied until it has a person from another crew (nobody can work a rest day: it would be the 7th duty day in a row).</p>
            </div>
          )}
          </>
        ) : <>
          <p className="text-xs text-slate-600">Staggers the days off inside each place of each team so it has the people it needs every day, with as many days off and as little overtime as the people allow. A day off is given on a rest day of the person&apos;s own crew where it can.</p>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            <span className="text-sm font-medium text-slate-700">Most days in a row</span>
            <span className="flex items-center gap-2">
              <button type="button" aria-label="Fewer days in a row" disabled={maxRun <= 1} onClick={() => setMaxRun((x) => x - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white ring-1 ring-slate-300 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
              <span className="w-6 text-center text-base font-semibold tabular-nums">{maxRun}</span>
              <button type="button" aria-label="More days in a row" disabled={maxRun >= 14} onClick={() => setMaxRun((x) => x + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white ring-1 ring-slate-300 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
            </span>
          </div>
        </>}
        {conflicts.length > 0 && (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-300">
            <p className="font-semibold">Leave inside the shutdown · {conflicts.length}</p>
            <p>A team member takes no leave during the shutdown, so the days below are planned as if everyone is present. Move this leave first:</p>
            <ul className="mt-1 space-y-0.5">
              {conflicts.map((c) => <li key={c.employeeId} className="flex items-center justify-between gap-2"><span className="truncate">{names.get(c.employeeId) ?? 'Employee'} · {c.days} {c.days === 1 ? 'day' : 'days'}</span><Link to={`/requests?q=${encodeURIComponent(c.number)}`} className="shrink-0 font-semibold text-brand-700 underline">Move leave</Link></li>)}
            </ul>
          </div>
        )}
        {results.length === 0 && <p className="text-sm text-slate-500">Nobody is placed yet.</p>}
        <ul className="divide-y divide-slate-100">
          {results.map((r) => {
            const n = r.group.memberIds.length; const skip = off.has(id(r)) || worse(r) || n === 0;
            if (n === 0) return <li key={id(r)} className="py-1.5 text-xs text-slate-500">{teamName(r.group.teamId)} · {slotLabel(r.group.key)}: nobody placed yet — <span className="font-medium text-status-red">add {r.minPeople ?? 1}+</span></li>;
            return (
              <li key={id(r)} className={cx('py-2', skip && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{teamName(r.group.teamId)} · {slotLabel(r.group.key)} <span className="text-xs font-normal text-slate-500">· {n} {n === 1 ? 'person' : 'people'}</span></p>
                    {train && r.train ? (
                      <>
                        <ul className="mt-0.5 space-y-0.5">
                          {r.train.people.map((x) => {
                            const emp = members.find((mm) => mm.id === x.id)?.employeeId ?? '';
                            const months = Object.entries(x.months).sort(([a], [b]) => a.localeCompare(b));
                            const worst = Math.max(0, ...months.map(([, h]) => h));
                            const tone = worst > plan.maxOvertime ? 'text-status-red' : worst >= plan.maxOvertime - 4 ? 'text-status-green' : 'text-amber-700';
                            return (
                              <li key={x.id} className="flex items-center gap-1.5 text-xs">
                                {x.crew ? <CrewBadge crew={x.crew} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-500">Day</span>}
                                <span className="min-w-0 flex-1 truncate text-slate-800">{names.get(emp) ?? 'Employee'}</span>
                                <span className="shrink-0 text-slate-500">{x.days} d · {x.full}×{plan.shiftHours} h + {x.short}×{Math.min(plan.normalHours, plan.shiftHours)} h</span>
                                <span className={cx('shrink-0 text-right font-semibold tabular-nums', tone)}>{months.length > 1 ? months.map(([mo, h]) => `${MONTH_SHORT[Number(mo.slice(5)) - 1]} ${h}`).join(' · ') : `OT ${x.overtime}`}<span className="font-normal text-slate-400">/{plan.maxOvertime}</span></span>
                              </li>
                            );
                          })}
                        </ul>
                        {r.group.key !== 'new' && (r.after.gapDays > 0 || r.after.short > 0 || r.after.noFullDays > 0) && <p className="text-xs font-semibold text-status-red">{[r.after.gapDays > 0 ? `${r.after.gapDays} ${r.after.gapDays === 1 ? 'day' : 'days'} with nobody` : '', r.after.gapDays === 0 && r.after.noFullDays > 0 ? `${r.after.noFullDays} days without a full-shift person` : '', r.after.short > 0 ? `${r.after.short} person-days short` : ''].filter(Boolean).join(' · ')}</p>}
                        {gaps(r).length > 0 && <p className="text-xs font-semibold text-status-red">Not applied · no {slotLabel(r.group.key)} on the full {plan.shiftHours} h on {gaps(r).map((d) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`).join(', ')}</p>}
                        {r.train.sameCrew && <p className="text-xs text-amber-800">Two of them are from the same crew, so they rest on the same days.</p>}
                        {r.train.runBreaks > 0 && <p className="text-xs text-amber-800">Full shifts in a row go over the limit on {r.train.runBreaks} days: the crews are too close together.</p>}
                        {r.train.people.some((x) => x.weekHours > MAX_WEEK_HOURS) && <p className="text-xs text-amber-800">Someone works more than {MAX_WEEK_HOURS} h in a week.</p>}
                        {r.train.addFrom.length > 0 && <p className="text-xs font-medium text-status-red">Add a {slotLabel(r.group.key)} from crew {r.train.addFrom.join(' or ')} ({r.train.wanted} people from {r.train.wanted} crews are wanted).</p>}
                        {r.group.key === 'new' && <p className="text-xs text-slate-500">May be empty.</p>}
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-slate-600">Overtime {arrow(r.before.overtime, r.after.overtime, ' h')} · worst month {arrow(r.before.worst, r.after.worst, ' h')}</p>
                        <p className="text-xs text-slate-600">People missing (person-days) {arrow(r.before.short, r.after.short)}{r.after.gapDays ? <span className="font-semibold text-status-red"> · {r.after.gapDays} {r.after.gapDays === 1 ? 'day' : 'days'} with nobody</span> : null}</p>
                        {r.minPeople != null && (n >= r.minPeople
                          ? <p className="text-xs font-medium text-status-red">Some days are still uncovered (leave, or people released early): add at least 1 more.</p>
                          : <p className="text-xs font-medium text-status-red">Add people: at least {r.minPeople} are needed to cover every day (a day off after {maxRun} in a row).</p>)}
                      </>
                    )}
                    {worse(r) && <p className="text-xs text-amber-800">Kept as it is: more days would be short than now.</p>}
                  </div>
                  {n > 0 && !worse(r) && gaps(r).length === 0 && <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={!off.has(id(r))} onChange={() => setOff((x) => { const y = new Set(x); if (y.has(id(r))) y.delete(id(r)); else y.add(id(r)); return y; })} />Apply</label>}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-slate-500">Applying replaces the days set by hand for these people. You can still tap any person to change a day.</p>
        {err != null && <ErrorBox error={err} />}
        <Button className="w-full" disabled={busy || chosen.length === 0} onClick={apply}><Shuffle className="h-4 w-4" />Apply to {people} {people === 1 ? 'person' : 'people'}</Button>
      </div>
    </BottomSheet>
  );
}
