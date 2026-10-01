import { AlertTriangle, ArrowLeft, Check, Copy, FileText, Pencil, Plus, RotateCcw, Shuffle, Trash2, UserMinus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { COVER_GRADE } from '@/core/controllers';
import { evaluateRange, personOn, SD_TEAM, type MpAbsence, type MpAssignment, type MpPerson } from '@/core/manpower';
import { CREWS, addDaysIso, type Crew } from '@/core/roster';
import { FO_LEVEL_LABEL, SD_PO_MAX_GRADE, SD_SLOTS, SD_SLOT_LABEL, areasOf, groupOf, dayOvertime, dayShort, dayState, isDutyDay, isRampDay, neighbours, memberHours, memberWorks, nextOffset, planDates, sdOperatorEligible, slotLabel, teamDay, cycleOf, type SdDay, type SdKind, type SdMember, type PhaseNeed, type SdPhase, type SdPlan, type SdSlot, type SdTeam } from '@/core/shutdown';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { fetchOperationPlan, schedulePeriod, type PeriodRow } from '@/data/modes';
import { fetchDirectory } from '@/data/queries';
import { addSdMember, clearSdDays, fetchAllSdMembers, fetchSdPlan, fetchSdPlans, fetchSickTotals, removeSdMember, renameSdArea, saveSdPhases, setSdDays, updateSdMember, updateSdPlan, updateSdTeam, type Signature } from '@/data/shutdown';
import type { EmployeeDirectoryRow } from '@/data/types';
import { BottomSheet, Button, Card, ErrorBox, Field, Spinner, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { shortDate } from '@/ui/leave';
import { PersonHistory } from './PersonHistory';
import { SpreadDaysSheet } from './SpreadDays';
import { MoveLeaveSheet } from './MoveLeave';
import { FollowInstruction, FollowSheet } from './FollowCrew';
import { suggestFollow } from '@/core/shutdown/overlap';

const CONTROLLER_ROLES = ['controller', 'vr_controller', 'morning_controller'];
const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
const wd = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
type Data = {
  plan: SdPlan; teams: SdTeam[]; members: SdMember[]; phases: SdPhase[]; signatures: Signature[]; inputs: ManpowerInputs; dir: Map<string, EmployeeDirectoryRow>;
  /** Who worked the shutdown right before / is on the one right after (nobody works two in a row). */
  prev: { plan: SdPlan; ids: Set<string> } | null; next: { plan: SdPlan; ids: Set<string> } | null;
  /** Sick-leave days per person per year (workbook totals). */
  sick: Map<string, Record<number, number>>;
  /** Total turnaround: operating-mode periods over its dates (the crews should be in 'Total shutdown'). */
  periods: PeriodRow[];
};
const TOTAL_MODE = 'total_shutdown';
/** Most people a team needs on any day: train, its full-day needs; total turnaround, its biggest phase. */
function teamNeed(p: SdPlan, t: SdTeam, phases: SdPhase[]): Record<string, number> {
  if (p.kind !== 'total') return Object.fromEntries(SD_SLOTS.map((s) => [s, t.needs[s]]));
  const out: Record<string, number> = {};
  if (p.sections.length) for (const s of p.sections) out[`ctl:${s}`] = Math.max(0, ...phases.map((x) => x.needs[t.id]?.sections?.[s] ?? 0));
  else out.controller = Math.max(0, ...phases.map((x) => x.needs[t.id]?.controller ?? 0));
  for (const a of areasOf(p)) out[`area:${a}`] = Math.max(0, ...phases.map((x) => x.needs[t.id]?.areas[a] ?? 0));
  return out;
}
const isPo = (r: EmployeeDirectoryRow | undefined) => r?.position_code === 'panel_operator';

/** Shutdown team planner: fill each team's slots, see the days each team is short, what the crews keep, and the overtime. */
export default function SdPlanPage() {
  const { id } = useParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState<{ team: SdTeam; slot: SdSlot; area?: string } | null>(null);
  const [member, setMember] = useState<SdMember | null>(null);
  const [editPattern, setEditPattern] = useState(false);
  const [editTeam, setEditTeam] = useState<SdTeam | null>(null);
  const [editPhases, setEditPhases] = useState(false);
  const [spreading, setSpreading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [following, setFollowing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const sd = await fetchSdPlan(id!);
      const y = Number(sd.plan.start.slice(0, 4));
      const [inputs, dir, plans, all, sick, ops] = await Promise.all([fetchManpowerInputs(addDaysIso(sd.plan.start, -1), addDaysIso(sd.plan.end, 1)), fetchDirectory(), fetchSdPlans(), fetchAllSdMembers(), fetchSickTotals([y, y - 1]),
        sd.plan.kind === 'total' ? fetchOperationPlan(sd.plan.start, sd.plan.end) : null]);
      const n = neighbours(plans, sd.plan);
      const ids = (p: SdPlan | null) => (p ? { plan: p, ids: new Set(all.filter((m) => m.planId === p.id).map((m) => m.employeeId)) } : null);
      setData({ ...sd, inputs, dir: new Map(dir.map((r) => [r.id, r])), prev: ids(n.prev), next: ids(n.next), sick, periods: ops?.periods ?? [] });
    } catch (e) { setError(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const done = (m: string) => { setAdding(null); setMember(null); setEditPattern(false); setEditTeam(null); setEditPhases(false); setSpreading(false); setMoving(false); setFollowing(false); setNotice(m); load(); };

  const view = useMemo(() => {
    if (!data) return null;
    const { plan, teams, members, inputs } = data;
    const people = new Map(inputs.people.map((p) => [p.id, p]));
    const leaveOn = (emp: string, d: string) => inputs.absences.some((a) => a.employeeId === emp && (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && a.start <= d && d <= a.end);
    const homeCrew = (emp: string, d: string) => { const p = people.get(emp); return p ? personOn({ ...p, moves: p.moves?.filter((m) => m.kind !== 'sd') }, d).crew : null; };
    const dates = planDates(plan);
    const results = evaluateRange(plan.start, plan.end, inputs.people, inputs.absences, inputs.rules, inputs.assignments);
    const crewImpact = CREWS.map((c) => ({ crew: c, short: results.filter((d) => d.crews.find((x) => x.crew === c)?.confirmedShortage).length,
      cover: results.filter((d) => { const x = d.crews.find((k) => k.crew === c); return x?.working && x.controller.finding === 'coverage_required'; }).length }));
    // the crew whose duty and rest days the member keeps on the team: the one he is told to follow, else his own
    const dutyCrew = (m: SdMember) => m.followCrew ?? homeCrew(m.employeeId, plan.start);
    const hours = new Map(members.map((m) => [m.id, memberHours(plan, m, dutyCrew(m))]));
    // days of leave inside the member's shutdown days: the person's own duty days on a train shutdown (a rest day costs nothing),
    // every day of a total turnaround; counted whether or not the day is still marked working (balancing marks leave days off)
    const leaveDays = (m: SdMember) => dates.filter((d) => d >= m.start && d <= m.end && leaveOn(m.employeeId, d) && (plan.kind === 'total' || isDutyDay(dutyCrew(m), d))).length;
    const teamDays = new Map(teams.map((t) => [t.id, dates.map((d) => ({ date: d, slots: teamDay(plan, t, members, d, leaveOn, data.phases) }))]));
    const overlaps = plan.kind === 'total' ? [] : suggestFollow(plan, teams, members, data.phases, dutyCrew, (m) => data.dir.get(m.employeeId)?.position_code === 'vr_controller');
    return { people, leaveOn, homeCrew, dutyCrew, dates, crewImpact, hours, leaveDays, teamDays, overlaps };
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (!data || !view) return <Spinner />;
  const { plan, teams, members, dir } = data;
  const total = plan.kind === 'total';
  const needTotal = teams.reduce((n, t) => n + Object.values(teamNeed(plan, t, data.phases)).reduce((k, x) => k + x, 0), 0);
  const gapDays = teams.reduce((n, t) => n + view.teamDays.get(t.id)!.filter((d) => dayState(d.slots) === 'critical').length, 0);
  // a shutdown team member takes no leave: who still has some inside the shutdown
  const leaveConflicts = members.map((m) => ({ employeeId: m.employeeId, number: data.dir.get(m.employeeId)?.employee_number ?? '', days: view.leaveDays(m) })).filter((c) => c.days > 0);
  const overCap = members.filter((m) => view.hours.get(m.id)!.some((h) => h.over)).length;
  const crewShort = total ? 0 : view.crewImpact.reduce((n, c) => n + c.short, 0);

  function copyList() {
    const lines = [`${plan.title} · ${range(plan.start, plan.end)} ${plan.end.slice(0, 4)}`, `${plan.daysOff ? `${plan.daysOn} on / ${plan.daysOff} off` : 'Every day'} · ${plan.shiftHours} h${plan.rampDays ? ` (first and last ${plan.rampDays} days ${plan.rampHours} h)` : ''}`];
    for (const t of teams) {
      lines.push('', `${t.name} team`);
      for (const s of [...SD_SLOTS, 'member' as const]) for (const m of members.filter((x) => x.teamId === t.id && x.slot === s)) {
        const r = dir.get(m.employeeId);
        lines.push(`${m.slot !== 'controller' && total ? `${m.area || areasOf(plan)[0] || 'Operator'}` : SD_SLOT_LABEL[s]}: ${r?.display_name ?? ''} (${r?.employee_number ?? ''}${r?.crew_code ? `, ${r.crew_code} Shift` : ''})${m.start !== plan.start || m.end !== plan.end ? ` ${range(m.start, m.end)}` : ''}`);
      }
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => setNotice('Team list copied.'), () => setNotice('Could not copy.'));
  }

  return (
    <div>
      <Link to="/shutdown" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700"><ArrowLeft className="h-4 w-4" />Shutdown teams</Link>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-brand-800">{plan.title}</h1>
          <div className="text-sm font-medium text-slate-700">{range(plan.start, plan.end)} {plan.end.slice(0, 4)}</div>
          <button type="button" onClick={() => setEditPattern(true)} className="mt-1 flex flex-wrap items-center gap-1 text-left">
            {[total ? 'Total turnaround' : 'Train shutdown', plan.daysOff ? `${plan.daysOn} on / ${plan.daysOff} off` : 'Every day', `${plan.shiftHours} h`, plan.rampDays ? `First & last ${plan.rampDays} days ${plan.rampHours} h` : '', `OT ≤ ${plan.maxOvertime} h`].filter(Boolean).map((c) => <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{c}</span>)}
            <span className="flex items-center gap-0.5 text-[11px] font-medium text-brand-700"><Pencil className="h-3 w-3" />Edit</span>
          </button>
        </div>
        <Button variant="secondary" className="min-h-9 shrink-0 px-3 text-xs" onClick={copyList}><Copy className="h-3.5 w-3.5" />Copy list</Button>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setSpreading(true)} className="col-span-2 flex min-h-9 items-center justify-center gap-1 rounded-lg bg-brand-700 text-xs font-semibold text-white"><Shuffle className="h-3.5 w-3.5" />{plan.kind === 'total' ? 'Spread the days off' : 'Own-crew days and hours'}</button>
        {!total && <button type="button" onClick={() => setFollowing(true)} className={cx('col-span-2 flex min-h-9 items-center justify-center gap-1 rounded-lg text-xs font-semibold ring-1', view.overlaps.length ? 'bg-amber-50 text-amber-900 ring-amber-300' : 'bg-white text-brand-700 ring-slate-300')}><Shuffle className="h-3.5 w-3.5" />{view.overlaps.length ? `Fix overlaps · ${view.overlaps.reduce((n, g) => n + g.changes.length, 0)} to follow another shift` : 'Overlaps · none'}</button>}
        <Link to={`/shutdown/${plan.id}/schedule`} className="flex min-h-9 items-center justify-center gap-1 rounded-lg bg-white text-xs font-semibold text-brand-700 ring-1 ring-slate-300"><FileText className="h-3.5 w-3.5" />Shift schedule</Link>
        <Link to={`/shutdown/${plan.id}/overtime`} className="flex min-h-9 items-center justify-center gap-1 rounded-lg bg-white text-xs font-semibold text-brand-700 ring-1 ring-slate-300"><FileText className="h-3.5 w-3.5" />Overtime sheet</Link>
      </div>
      {notice && <p className="mb-2 flex items-center gap-1 text-sm text-status-green"><Check className="h-4 w-4" />{notice}</p>}
      {leaveConflicts.length > 0 && (
        <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-300">
          <p className="font-semibold">Leave inside the shutdown · {leaveConflicts.length} {leaveConflicts.length === 1 ? 'person' : 'people'}</p>
          <p>A team member takes no leave during the shutdown. Move the leave, or take the person off the team.</p>
          <Button className="my-1.5 min-h-9 w-full px-3 text-xs" onClick={() => setMoving(true)}>Propose new dates for all</Button>
          <ul className="mt-1 space-y-0.5">
            {leaveConflicts.map((c) => <li key={c.employeeId} className="flex items-center justify-between gap-2"><span className="truncate">{data.dir.get(c.employeeId)?.display_name ?? 'Employee'} · {c.days} {c.days === 1 ? 'day' : 'days'}</span><Link to={`/requests?q=${encodeURIComponent(c.number)}`} className="shrink-0 font-semibold text-brand-700 underline">Move leave</Link></li>)}
          </ul>
        </div>
      )}

      <div className="mb-3 grid grid-cols-4 gap-1 text-center">
        {[{ n: `${members.length}/${needTotal}`, label: 'Placed', dot: members.length >= needTotal ? 'bg-status-green' : 'bg-status-amber' },
          { n: gapDays, label: 'Days a slot empty', dot: gapDays ? 'bg-status-red' : 'bg-status-green' },
          total ? { n: data.phases.length, label: 'Phases', dot: data.phases.length ? 'bg-status-green' : 'bg-status-amber' } : { n: crewShort, label: 'Crews short (days)', dot: crewShort ? 'bg-status-red' : 'bg-status-green' },
          { n: overCap, label: `Over ${plan.maxOvertime} h OT`, dot: overCap ? 'bg-status-red' : 'bg-status-green' }].map((k) => (
          <div key={k.label} className="rounded-lg bg-white px-1 py-1 ring-1 ring-slate-200">
            <div className="flex items-center justify-center gap-1 text-base font-semibold leading-tight tabular-nums text-slate-800"><span className={cx('h-2 w-2 rounded-full', k.dot)} />{k.n}</div>
            <div className="text-[10px] leading-tight text-slate-500">{k.label}</div>
          </div>
        ))}
      </div>

      {teams.map((t) => <TeamCard key={t.id} t={t} data={data} view={view} onAdd={(slot, area) => setAdding({ team: t, slot, area })} onMember={setMember} onEdit={() => (total ? setEditPhases(true) : setEditTeam(t))} />)}

      {total ? <UnitDownCard plan={plan} periods={data.periods} onDone={done} /> : <Card className="mb-3 py-1.5">
        <h2 className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Crews without the team · {plan.title} minimums</h2>
        <div className="mt-1 grid grid-cols-4 gap-1.5">
          {view.crewImpact.map((c) => (
            <div key={c.crew} className={cx('flex flex-col items-center rounded-lg px-1 py-1.5 ring-1', c.short ? 'bg-red-50 ring-red-200' : c.cover ? 'bg-amber-50 ring-amber-200' : 'bg-green-50 ring-green-200')}>
              <CrewBadge crew={c.crew} size="sm" />
              <span className={cx('mt-0.5 text-[11px] font-semibold', c.short ? 'text-status-red' : c.cover ? 'text-amber-800' : 'text-green-800')}>{c.short ? `Short ${c.short}d` : c.cover ? `Cover ${c.cover}d` : 'OK'}</span>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Days a crew falls below the minimum (or needs a Controller cover) with the team taken off it. Tap a crew day on the Calendar for detail.</p>
      </Card>}

      {adding && <AddSheet plan={plan} team={adding.team} slot={adding.slot} area={adding.area} data={data} view={view} onClose={() => setAdding(null)} onDone={done} />}
      {member && <MemberSheet plan={plan} m={member} data={data} view={view} onClose={() => setMember(null)} onDone={done} />}
      {moving && <MoveLeaveSheet plan={plan} members={members} names={new Map([...data.dir].map(([id, r]) => [id, r.display_name]))} inputs={data.inputs} onClose={() => setMoving(false)} onDone={done} />}
      {following && <FollowSheet plan={plan} teams={teams} members={members} groups={view.overlaps} names={new Map([...data.dir].map(([id, r]) => [id, r.display_name]))} isVr={(e) => data.dir.get(e)?.position_code === 'vr_controller'} onClose={() => setFollowing(false)} onDone={done} />}
      {spreading && <SpreadDaysSheet plan={plan} teams={teams} members={members} phases={data.phases} names={new Map([...data.dir].map(([id, r]) => [id, r.display_name]))} crewOf={(e) => { const mm = members.find((x) => x.employeeId === e); return mm ? view.dutyCrew(mm) : view.homeCrew(e, plan.start); }} conflicts={leaveConflicts} onClose={() => setSpreading(false)} onDone={done} />}
      {editPattern && <PatternSheet plan={plan} onClose={() => setEditPattern(false)} onDone={done} />}
      {editPhases && <PhasesSheet plan={plan} teams={teams} phases={data.phases} onClose={() => setEditPhases(false)} onDone={done} />}
      {editTeam && <NeedsSheet t={editTeam} onClose={() => setEditTeam(null)} onDone={done} />}
    </div>
  );
}

interface View {
  people: Map<string, MpPerson>;
  leaveOn: (employeeId: string, date: string) => boolean;
  /** The person's own crew on a date, the shutdown team aside (VRs: their placement crew). */
  homeCrew: (employeeId: string, date: string) => Crew | null;
  /** The crew whose duty and rest days the member keeps on the team (the one they follow, else their own). */
  dutyCrew: (m: SdMember) => Crew | null;
  dates: string[];
  hours: Map<string, ReturnType<typeof memberHours>>;
  leaveDays: (m: SdMember) => number;
  overlaps: ReturnType<typeof suggestFollow>;
  teamDays: Map<string, { date: string; slots: ReturnType<typeof teamDay> }[]>;
}

function TeamCard({ t, data, view, onAdd, onMember, onEdit }: { t: SdTeam; data: Data; view: View; onAdd: (s: SdSlot, area?: string) => void; onMember: (m: SdMember) => void; onEdit: () => void }) {
  const [day, setDay] = useState<string | null>(null);
  const days = view.teamDays.get(t.id)!;
  const sel = day ? days.find((d) => d.date === day) : null;
  let spare = data.members.filter((m) => m.teamId === t.id && m.slot === 'member').length;
  const total = data.plan.kind === 'total';
  const need = teamNeed(data.plan, t, data.phases);
  return (
    <Card className="mb-3 py-1.5">
      <div className="flex items-center justify-between pt-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.name} {total ? 'shift' : 'team'}{t.hoursLabel ? ` · ${t.hoursLabel}` : ''}</h2>
        <button type="button" onClick={onEdit} className="flex items-center gap-1 text-[11px] text-slate-500">{total
          ? `${data.phases.length} phase${data.phases.length === 1 ? '' : 's'} · up to ${Object.values(need).reduce((a, b) => a + b, 0)}`
          : `${SD_SLOTS.map((s) => `${t.needs[s]}`).join('·')} (reduced ${SD_SLOTS.map((s) => `${t.rampNeeds[s]}`).join('·')})`}<Pencil className="h-3 w-3" /></button>
      </div>
      {/* day strip: green = everyone on, amber = fewer (days off), red = a slot with nobody that day; outlined = reduced day */}
      <div className="mt-1.5 grid gap-px" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((d) => { const n = dayShort(d.slots); const st = dayState(d.slots); return (
          <button key={d.date} type="button" onClick={() => setDay(day === d.date ? null : d.date)} title={shortDate(d.date)}
            className={cx('flex h-5 items-center justify-center rounded-[3px] text-[8px] font-bold', st === 'critical' ? 'bg-status-red text-white' : st === 'short' ? 'bg-amber-200 text-amber-900' : st === 'idle' ? 'bg-slate-200 text-slate-500' : 'bg-green-200 text-green-900', isRampDay(data.plan, d.date) && 'ring-1 ring-inset ring-slate-500', day === d.date && 'outline outline-2 outline-brand-700')}>{n || ''}</button>
        ); })}
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-slate-400"><span>{shortDate(days[0].date)}</span><span>green all on · amber fewer · red a slot empty{total ? ' · grey not needed' : ''}</span><span>{shortDate(days[days.length - 1].date)}</span></div>
      {sel && <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-700">{wd(sel.date)} {shortDate(sel.date)}{isRampDay(data.plan, sel.date) ? ' · reduced' : ''}: {Object.entries(sel.slots).map(([k, x]) => <span key={k} className={cx('ml-1', x.have < x.need && 'font-semibold text-status-red')}>{slotLabel(k)} {x.have}/{x.need}</span>)}</p>}

      {total ? <AreaGroups t={t} data={data} view={view} need={need} onAdd={onAdd} onMember={onMember} /> : <div className="mt-1 divide-y divide-slate-100">
        {SD_SLOTS.map((s) => {
          const list = data.members.filter((m) => m.teamId === t.id && m.slot === s);
          // operators without a level take the open FO places (Senior first)
          const open = Math.max(0, t.needs[s] - list.length);
          const filled = s === 'controller' ? 0 : Math.min(open, spare); spare -= filled;
          const missing = open - filled;
          return (
            <div key={s} className="py-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500"><span>{SD_SLOT_LABEL[s]} · {list.length}{filled ? `+${filled} operator${filled > 1 ? 's' : ''}` : ''}/{t.needs[s]}</span>
                <button type="button" onClick={() => onAdd(s)} className="flex items-center gap-0.5 text-brand-700"><Plus className="h-3.5 w-3.5" />Add</button></div>
              {list.map((m) => <MemberRow key={m.id} m={m} data={data} view={view} onOpen={() => onMember(m)} />)}
              {Array.from({ length: missing }, (_, i) => <button key={i} type="button" onClick={() => onAdd(s)} className="mt-1 flex w-full items-center gap-1.5 rounded-lg border border-dashed border-red-300 px-2 py-1.5 text-left text-xs font-medium text-status-red"><Plus className="h-3.5 w-3.5" />{SD_SLOT_LABEL[s]} needed</button>)}
            </div>
          );
        })}
        {data.members.some((m) => m.teamId === t.id && m.slot === 'member') && (
          <div className="py-1.5">
            <div className="text-[11px] font-semibold text-slate-500">{SD_SLOT_LABEL.member}s (no level) · fill the open FO places</div>
            {data.members.filter((m) => m.teamId === t.id && m.slot === 'member').map((m) => <MemberRow key={m.id} m={m} data={data} view={view} onOpen={() => onMember(m)} />)}
          </div>
        )}
      </div>}
    </Card>
  );
}

/** Total turnaround: the shift's Controllers, then its operators per area; placeholders up to the biggest phase. */
function AreaGroups({ t, data, view, need, onAdd, onMember }: { t: SdTeam; data: Data; view: View; need: Record<string, number>; onAdd: (s: SdSlot, area?: string) => void; onMember: (m: SdMember) => void }) {
  const areas = areasOf(data.plan);
  const sections = data.plan.sections;
  const ctl = data.members.filter((m) => m.teamId === t.id && m.slot === 'controller');
  const groups = [
    ...(sections.length
      ? sections.map((x) => ({ key: `ctl:${x}`, label: `Controller · ${x}`, list: ctl.filter((m) => groupOf(sections, m.area) === x), add: () => onAdd('controller', x) }))
      : [{ key: 'controller', label: 'Controllers', list: ctl, add: () => onAdd('controller') }]),
    ...areas.map((a) => ({ key: `area:${a}`, label: a || 'Operators', add: () => onAdd('member', a),
      list: data.members.filter((m) => m.teamId === t.id && m.slot !== 'controller' && groupOf(areas, m.area) === a) }))];
  return (
    <div className="mt-1 divide-y divide-slate-100">
      {groups.map((g) => {
        const missing = Math.max(0, (need[g.key] ?? 0) - g.list.length);
        return (
          <div key={g.key} className="py-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500"><span>{g.label} · {g.list.length}/{need[g.key] ?? 0}</span>
              <button type="button" onClick={g.add} className="flex items-center gap-0.5 text-brand-700"><Plus className="h-3.5 w-3.5" />Add</button></div>
            {g.list.map((m) => <MemberRow key={m.id} m={m} data={data} view={view} onOpen={() => onMember(m)} />)}
            {Array.from({ length: missing }, (_, i) => <button key={i} type="button" onClick={g.add} className="mt-1 flex w-full items-center gap-1.5 rounded-lg border border-dashed border-red-300 px-2 py-1.5 text-left text-xs font-medium text-status-red"><Plus className="h-3.5 w-3.5" />{g.key.startsWith('area:') ? `${g.label} operator` : g.label} needed</button>)}
          </div>
        );
      })}
    </div>
  );
}

function MemberRow({ m, data, view, onOpen }: { m: SdMember; data: Data; view: View; onOpen: () => void }) {
  const r = data.dir.get(m.employeeId);
  const crew = view.homeCrew(m.employeeId, data.plan.start);
  const ot = Math.max(0, ...view.hours.get(m.id)!.map((h) => h.overtime));
  const over = view.hours.get(m.id)!.some((h) => h.over);
  const leave = view.leaveDays(m);
  // the member's first days off, e.g. "off 4, 8, 12…"
  const off = view.dates.filter((d) => d >= m.start && d <= m.end && !memberWorks(data.plan, m, d)).slice(0, 3).map((d) => Number(d.slice(8)));
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 py-1 text-left">
      {crew ? <CrewBadge crew={crew} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-500">VR</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{r?.display_name ?? '—'}{isPo(r) ? <span className="ml-1 text-[10px] font-semibold text-slate-400">PO</span> : r?.fo_level && m.slot !== 'controller' ? <span className="ml-1 text-[10px] font-semibold text-slate-400">{FO_LEVEL_LABEL[r.fo_level]}</span> : null}</span>
        <span className="block truncate text-[11px] text-slate-500">#{r?.employee_number}{data.plan.kind === 'total' && m.slot === 'controller' && m.area ? ` · ${m.area}` : ''}{m.followCrew ? ` · follows ${m.followCrew}` : ''} · {off.length ? `off ${off.join(', ')}…` : 'every day'}{m.start !== data.plan.start || m.end !== data.plan.end ? ` · ${range(m.start, m.end)}` : ''}</span>
      </span>
      {(data.prev?.ids.has(m.employeeId) || data.next?.ids.has(m.employeeId)) && <span className="shrink-0 rounded-full bg-status-red px-1.5 text-[10px] font-semibold text-white">2 SD in a row</span>}
      {leave > 0 && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900">Leave {leave}d</span>}
      <span className={cx('shrink-0 rounded-full px-1.5 text-[10px] font-semibold tabular-nums', over ? 'bg-status-red text-white' : 'bg-slate-100 text-slate-600')}>OT {ot} h</span>
    </button>
  );
}

/** Pick someone for a slot: the right level first, with what taking them costs (leave, their crew, same crew already). */
function AddSheet({ plan, team, slot, area, data, view, onClose, onDone }: { plan: SdPlan; team: SdTeam; slot: SdSlot; area?: string; data: Data; view: View; onClose: () => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const inPlan = new Set(data.members.map((m) => m.employeeId));
  const year = Number(plan.start.slice(0, 4));
  const total = plan.kind === 'total';
  const cands = useMemo(() => {
    const { inputs } = data;
    const base = evaluateRange(plan.start, plan.end, inputs.people, inputs.absences, inputs.rules, inputs.assignments);
    const pool = inputs.people.filter((p) => !inPlan.has(p.id) && (slot === 'controller'
      ? CONTROLLER_ROLES.includes(p.role ?? '') && (p.grade ?? 0) >= COVER_GRADE
      : sdOperatorEligible(p)));
    const fromCrew = (c: Crew | null) => data.members.filter((m) => view.homeCrew(m.employeeId, plan.start) === c).length;
    // who of this team's slot already comes from a crew: two from one crew rest on the same days (nobody covers them)
    const inSlot = data.members.filter((m) => m.teamId === team.id && m.slot === slot);
    const slotCrews = (c: Crew | null) => (c ? inSlot.filter((m) => view.dutyCrew(m) === c).map((m) => data.dir.get(m.employeeId)?.display_name ?? '') : []);
    return pool.map((p) => {
      const crew = view.homeCrew(p.id, plan.start);
      const level = data.dir.get(p.id)?.fo_level ?? null;
      const leave = view.dates.filter((d) => view.leaveOn(p.id, d)).length;
      // the crew without this person: extra days below the minimum (or needing a Controller cover)
      let hit = 0;
      // (a total turnaround: the unit is down, the crews have no minimum to keep)
      if (crew && !total) {
        const isCtl = CONTROLLER_ROLES.includes(p.role ?? '');
        const people2: MpPerson[] = isCtl ? inputs.people : inputs.people.map((x) => (x.id === p.id ? { ...x, moves: [...(x.moves ?? []), { start: plan.start, end: plan.end, crew: SD_TEAM, kind: 'sd' as const }] } : x));
        const assign2: MpAssignment[] = isCtl ? [...inputs.assignments, { id: 'cand', kind: 'sd_team', employeeId: p.id, crew: null, start: plan.start, end: plan.end }] : inputs.assignments;
        const after = evaluateRange(plan.start, plan.end, people2, inputs.absences as MpAbsence[], inputs.rules, assign2);
        hit = after.filter((d, i) => { const a = d.crews.find((x) => x.crew === crew)!, b = base[i].crews.find((x) => x.crew === crew)!;
          return a.working && ((a.confirmedShortage && !b.confirmedShortage) || (a.controller.finding === 'coverage_required' && b.controller.finding !== 'coverage_required')); }).length;
      }
      const match = slot === 'controller' || level === slot || (total && slot === 'member');
      const back = data.prev?.ids.has(p.id) ? data.prev.plan.title : data.next?.ids.has(p.id) ? data.next.plan.title : null;
      const sick = data.sick.get(p.id)?.[year] ?? null;
      return { p, crew, level, leave, hit, same: fromCrew(crew), twin: slotCrews(crew), match, back, sick, sickPrev: data.sick.get(p.id)?.[year - 1] ?? null };
    // right level first; below average last; not two shutdowns in a row; free of leave and crew impact; then fewer sick days
    }).sort((a, b) => Number(b.match) - Number(a.match) || Number(a.level === 'below') - Number(b.level === 'below') || Number(!!a.back) - Number(!!b.back) || Number(a.twin.length > 0) - Number(b.twin.length > 0) || Number(!!a.leave) - Number(!!b.leave) || a.hit - b.hit
      || (a.sick ?? 0) - (b.sick ?? 0) || a.same - b.same || (b.p.grade ?? 0) - (a.p.grade ?? 0) || a.p.name.localeCompare(b.p.name));
  }, [data, view, plan, slot, year, total]); // eslint-disable-line react-hooks/exhaustive-deps
  const sickValues = cands.map((c) => c.sick).filter((x): x is number => x != null).sort((a, b) => a - b);
  const sickMedian = sickValues.length ? sickValues[Math.floor(sickValues.length / 2)] : null;

  async function pick(p: MpPerson) {
    setBusy(true); setErr(null);
    // total turnaround operators keep their Field Operator level as the slot (Panel Operators and the unmarked: 'member')
    const level = data.dir.get(p.id)?.fo_level ?? null;
    const use: SdSlot = total && slot === 'member' && p.role === 'field_operator' && level && level !== 'below' ? level : slot;
    try {
      await addSdMember({ planId: plan.id, teamId: team.id, employeeId: p.id, slot: use, offset: nextOffset(plan, team.id, use, data.members), start: plan.start, end: plan.end, area: area ?? null });
      onDone(`${p.name} added to the ${team.name} ${total ? `shift${slot === 'controller' ? ` as Controller${area ? `, ${area}` : ''}` : area ? `, ${area}` : ''}` : `team as ${SD_SLOT_LABEL[slot]}`}.`);
    }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const unmarked = !total && slot !== 'controller' && cands.every((c) => !c.level);
  return (
    <BottomSheet open onClose={onClose} title={total ? `${team.name} shift · ${slot === 'controller' ? `Controller${area ? ` ${area}` : ''}` : area || 'Operator'}` : `${team.name} team · ${SD_SLOT_LABEL[slot]}`}>
      <div className="space-y-2">
        <p className="text-[11px] text-slate-500">{slot !== 'controller' && <>Field Operators, and Panel Operators up to Grade {SD_PO_MAX_GRADE} or contractors. </>}Order: {total ? '' : 'right level · '}not on the shutdown {data.prev ? `before (${data.prev.plan.title})` : 'before'}{data.next ? ` or after (${data.next.plan.title})` : ''} · no leave · {total ? '' : 'crew keeps its minimum · '}fewer sick days.</p>
        {unmarked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">No Field Operator has a level yet. <Link to="/review/fo-levels" className="font-semibold underline">Mark Senior / Good / New</Link> to see the right people first.</p>}
        {err != null && <ErrorBox error={err} />}
        <div className="divide-y divide-slate-100">
          {cands.map((c) => (
            <button key={c.p.id} type="button" disabled={busy} onClick={() => pick(c.p)} className={cx('flex w-full items-center gap-2 py-2 text-left', !c.match && 'opacity-60')}>
              {c.crew ? <CrewBadge crew={c.crew} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-500">VR</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{c.p.name} <span className="text-[11px] font-normal text-slate-500">{c.p.employmentType === 'contractor' ? 'Contractor' : `G${c.p.grade ?? '—'}`}{c.p.role === 'panel_operator' ? ' · Panel Operator' : c.level ? ` · ${FO_LEVEL_LABEL[c.level]}` : slot !== 'controller' ? ' · no level' : ''}</span></span>
                <span className="flex flex-wrap gap-x-2 text-[11px] font-semibold">
                  {c.back && <span className="inline-flex items-center gap-0.5 text-status-red"><AlertTriangle className="h-3 w-3" />Also on {c.back}</span>}
                  {c.leave > 0 && <span className="inline-flex items-center gap-0.5 font-semibold text-status-red"><AlertTriangle className="h-3 w-3" />Leave {c.leave}d in the shutdown: move it first</span>}
                  {c.hit > 0 && <span className="inline-flex items-center gap-0.5 text-status-red"><AlertTriangle className="h-3 w-3" />{c.crew} short {c.hit}d without him</span>}
                  {c.twin.length > 0 ? <span className="inline-flex items-center gap-0.5 text-status-red"><AlertTriangle className="h-3 w-3" />Same crew as {c.twin.join(', ')}: they rest on the same days</span> : total && c.same > 0 && <span className="text-slate-500">{c.same} already from {c.crew}</span>}
                  {!total && c.twin.length === 0 && c.crew && data.members.some((m) => m.teamId === team.id && m.slot === slot) && <span className="text-status-green">Different crew from the slot ✓</span>}
                  {!c.leave && !c.hit && !c.back && <span className="text-status-green">{total ? 'Free' : 'Free · crew keeps its minimum'}</span>}
                  {c.sick != null && <span className={cx('font-medium', sickMedian != null && c.sick > sickMedian ? 'text-amber-700' : 'text-slate-500')}>Sick {c.sick}d {year}{c.sickPrev != null ? ` · ${c.sickPrev}d ${year - 1}` : ''}</span>}
                </span>
              </span>
              <Plus className="h-4 w-4 shrink-0 text-brand-700" />
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}

function MemberSheet({ plan, m, data, view, onClose, onDone }: { plan: SdPlan; m: SdMember; data: Data; view: View; onClose: () => void; onDone: (msg: string) => void }) {
  const r = data.dir.get(m.employeeId);
  const team = data.teams.find((t) => t.id === m.teamId);
  const [offset, setOffset] = useState(m.offset);
  const [start, setStart] = useState(m.start); const [end, setEnd] = useState(m.end);
  const [own, setOwn] = useState<Record<string, SdDay>>(m.days ?? {});
  const total = plan.kind === 'total';
  const areas = m.slot === 'controller' ? plan.sections : areasOf(plan).filter(Boolean);
  const [area, setArea] = useState<string | null>(m.area ?? areas[0] ?? null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const trial: SdMember = { ...m, offset, start, end, days: own };
  const home = view.homeCrew(m.employeeId, plan.start);
  const crew = m.followCrew ?? home;
  const hours = memberHours(plan, trial, crew);
  const cycle = cycleOf(plan);
  const valid = start >= plan.start && end <= plan.end && end >= start;
  const changedDays = Object.entries(own).filter(([d, v]) => m.days?.[d]?.works !== v.works || m.days?.[d]?.hours !== v.hours);
  const hasOwn = Object.keys(m.days ?? {}).length > 0;
  const toggle = (d: string) => setOwn((x) => ({ ...x, [d]: { works: !memberWorks(plan, trial, d), hours: x[d]?.hours ?? null } }));
  async function save() {
    setBusy(true); setErr(null);
    try {
      await updateSdMember(m.id, { day_offset: offset, start_date: start, end_date: end, ...(total && areas.length ? { area } : {}) });
      await setSdDays(m.id, changedDays.map(([date, v]) => ({ date, works: v.works, hours: v.hours })));
      onDone(`${r?.display_name}: team place updated.`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function reset() {
    setBusy(true); setErr(null);
    try { await clearSdDays(m.id); onDone(`${r?.display_name}: back to the ${plan.daysOn} on / ${plan.daysOff} off pattern.`); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setErr(null);
    try { await removeSdMember(m.id); onDone(`${r?.display_name} taken off the team; back with his crew.`); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const code = team?.shiftCode ?? 'M';
  return (
    <BottomSheet open onClose={onClose} title={r?.display_name ?? 'Team member'}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">#{r?.employee_number} · {SD_SLOT_LABEL[m.slot]}{r?.crew_code ? ` · from ${r.crew_code} Shift` : ''}{team ? ` · ${team.name} team` : ''}</p>
        <PersonHistory employeeId={m.employeeId} crew={crew} skipPlanId={plan.id} />
        {!total && home && <FollowInstruction plan={plan} m={m} home={home} name={r?.display_name ?? 'Employee'} vr={r?.position_code === 'vr_controller'} onDone={onDone} />}
        <Field label="Days (tap to switch working / off)">
          <div className="grid grid-cols-7 gap-1">
            {view.dates.map((d) => {
              const inRange = d >= start && d <= end;
              const works = memberWorks(plan, trial, d);
              const ot = dayOvertime(plan, trial, crew, d);
              return (
                <button key={d} type="button" disabled={!inRange} onClick={() => toggle(d)} title={`${wd(d)} ${shortDate(d)}`}
                  className={cx('flex flex-col items-center rounded-md py-0.5 text-[10px] leading-tight ring-1', !inRange ? 'bg-slate-50 text-slate-300 ring-slate-100' : works ? (code === 'N' ? 'bg-slate-300 text-slate-900 ring-slate-400' : 'bg-sky-50 text-slate-900 ring-sky-200') : 'bg-yellow-200 text-yellow-900 ring-yellow-300', own[d] && m.days?.[d]?.works !== own[d].works && 'outline outline-2 outline-brand-700')}>
                  <span className="text-[9px] text-slate-500">{wd(d).slice(0, 2)} {Number(d.slice(8))}</span>
                  <span className="font-bold">{inRange ? (works ? code : 'O') : '·'}</span>
                  <span className="text-[9px] tabular-nums text-slate-500">{works ? `OT ${ot}` : ''}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">{code} working · O off (yellow). OT per day = hours less the normal {plan.normalHours} h on a {crew ? `${crew} Shift` : 'Sunday–Thursday'} duty day; a rest day counts in full.</p>
        </Field>
        {total && areas.length > 0 && (
          <Field label={m.slot === 'controller' ? 'Section' : 'Area'}>
            <div className="flex flex-wrap gap-1.5">{areas.map((a) => <button key={a} type="button" onClick={() => setArea(a)} className={cx('rounded-full px-3 py-1 text-xs font-medium ring-1', area === a ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{a}</button>)}</div>
          </Field>
        )}
        {cycle > 1 && <Field label={`Pattern (${plan.daysOn} on / ${plan.daysOff} off)${hasOwn ? ' · only for days not set by hand' : ''}`}>
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: cycle }, (_, o) => {
              const offs = view.dates.filter((d) => !memberWorks(plan, { ...m, days: undefined, offset: o, start: plan.start, end: plan.end }, d)).slice(0, 3).map((d) => Number(d.slice(8)));
              return <button key={o} type="button" onClick={() => setOffset(o)} className={cx('rounded-lg px-1 py-1.5 text-[11px] font-medium ring-1', offset === o ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>Off {offs.join(', ')}…</button>;
            })}
          </div>
        </Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" className="input" value={start} min={plan.start} max={plan.end} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label={total ? 'Until (released after)' : 'Until'}><input type="date" className="input" value={end} min={plan.start} max={plan.end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] text-slate-500"><th className="font-medium">Month</th><th className="text-right font-medium">Days</th><th className="text-right font-medium">SD h</th><th className="text-right font-medium">OT h</th></tr></thead>
          <tbody>{hours.map((h) => <tr key={h.month}><td>{new Date(`${h.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</td><td className="text-right tabular-nums">{h.days}</td><td className="text-right tabular-nums">{h.sd}</td>
            <td className={cx('text-right font-semibold tabular-nums', h.over ? 'text-status-red' : 'text-slate-800')}>{h.overtime}{h.over ? ` > ${plan.maxOvertime}` : ''}</td></tr>)}</tbody>
        </table>
        {err != null && <ErrorBox error={err} />}
        {hasOwn && <Button variant="secondary" className="w-full" disabled={busy} onClick={reset}><RotateCcw className="h-4 w-4" />Back to the pattern (forget days set by hand)</Button>}
        <div className="flex gap-2">
          <Button variant="danger" className="flex-1" disabled={busy} onClick={remove}><UserMinus className="h-4 w-4" />Take off team</Button>
          <Button className="flex-1" disabled={busy || !valid} onClick={save}>Save{changedDays.length ? ` (${changedDays.length} day${changedDays.length > 1 ? 's' : ''})` : ''}</Button>
        </div>
      </div>
    </BottomSheet>
  );
}

function PatternSheet({ plan, onClose, onDone }: { plan: SdPlan; onClose: () => void; onDone: (m: string) => void }) {
  const [v, setV] = useState({ title: plan.title, kind: plan.kind as SdKind, start_date: plan.start, end_date: plan.end, days_on: plan.daysOn, days_off: plan.daysOff, shift_hours: plan.shiftHours, ramp_days: plan.rampDays, ramp_hours: plan.rampHours, normal_hours: plan.normalHours, max_overtime: plan.maxOvertime });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const num = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: Number(e.target.value) }));
  async function save() { setBusy(true); setErr(null); try { await updateSdPlan(plan.id, { ...v, title: v.title.trim() || plan.title }); onDone('Pattern saved.'); } catch (e) { setErr(e); } finally { setBusy(false); } }
  return (
    <BottomSheet open onClose={onClose} title="Shutdown pattern">
      <div className="space-y-3">
        <Field label="Title"><input className="input" value={v.title} onChange={(e) => setV((x) => ({ ...x, title: e.target.value }))} /></Field>
        <div className="grid grid-cols-2 gap-1.5">
          {([['train', 'Train shutdown'], ['total', 'Total turnaround']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setV((x) => ({ ...x, kind: k }))} className={cx('rounded-lg px-2 py-2 text-sm font-medium ring-1', v.kind === k ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{l}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[{ l: 'Every day', on: 1, off: 0 }, { l: '3 on / 1 off', on: 3, off: 1 }].map((q) => (
            <button key={q.l} type="button" onClick={() => setV((x) => ({ ...x, days_on: q.on, days_off: q.off }))} className={cx('rounded-full px-3 py-1 text-xs font-medium ring-1', v.days_on === q.on && v.days_off === q.off ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{q.l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" className="input" value={v.start_date} onChange={(e) => setV((x) => ({ ...x, start_date: e.target.value }))} /></Field>
          <Field label="Last day"><input type="date" className="input" value={v.end_date} onChange={(e) => setV((x) => ({ ...x, end_date: e.target.value }))} /></Field>
          <Field label="Days on"><input className="input" inputMode="numeric" value={v.days_on} onChange={num('days_on')} /></Field>
          <Field label="Days off"><input className="input" inputMode="numeric" value={v.days_off} onChange={num('days_off')} /></Field>
          <Field label="Shift hours"><input className="input" inputMode="numeric" value={v.shift_hours} onChange={num('shift_hours')} /></Field>
          <Field label="Normal duty hours"><input className="input" inputMode="numeric" value={v.normal_hours} onChange={num('normal_hours')} /></Field>
          <Field label="Reduced days (each end)"><input className="input" inputMode="numeric" value={v.ramp_days} onChange={num('ramp_days')} /></Field>
          <Field label="Reduced-day hours"><input className="input" inputMode="numeric" value={v.ramp_hours} onChange={num('ramp_hours')} /></Field>
          <Field label="Max overtime / month (h)"><input className="input" inputMode="numeric" value={v.max_overtime} onChange={num('max_overtime')} /></Field>
        </div>
        {err != null && <ErrorBox error={err} />}
        <Button className="w-full" disabled={busy} onClick={save}>Save</Button>
      </div>
    </BottomSheet>
  );
}

function NeedsSheet({ t, onClose, onDone }: { t: SdTeam; onClose: () => void; onDone: (m: string) => void }) {
  const [n, setN] = useState({ ...t.needs }); const [r, setR] = useState({ ...t.rampNeeds });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function save() {
    setBusy(true); setErr(null);
    try { await updateSdTeam(t.id, { controller_n: n.controller, senior_n: n.senior, good_n: n.good, new_n: n.new, ramp_controller_n: r.controller, ramp_senior_n: r.senior, ramp_good_n: r.good, ramp_new_n: r.new }); onDone(`${t.name} team needs saved.`); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title={`${t.name} team · people needed`}>
      <div className="space-y-3">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] text-slate-500"><th className="font-medium">Slot</th><th className="font-medium">Full days</th><th className="font-medium">Reduced days</th></tr></thead>
          <tbody>{SD_SLOTS.map((s) => (
            <tr key={s}><td className="py-1">{SD_SLOT_LABEL[s]}</td>
              <td><input className="input h-9 w-16" inputMode="numeric" value={n[s]} onChange={(e) => setN((x) => ({ ...x, [s]: Number(e.target.value) || 0 }))} /></td>
              <td><input className="input h-9 w-16" inputMode="numeric" value={r[s]} onChange={(e) => setR((x) => ({ ...x, [s]: Number(e.target.value) || 0 }))} /></td></tr>
          ))}</tbody>
        </table>
        {err != null && <ErrorBox error={err} />}
        <Button className="w-full" disabled={busy} onClick={save}>Save</Button>
      </div>
    </BottomSheet>
  );
}


/** A list of names that keeps, for each, the name its numbers are saved under (key), so renaming keeps them. */
type Named = { key: string; name: string };
function NamesEditor({ label, list, set, placeholder }: { label: string; list: Named[]; set: (f: (l: Named[]) => Named[]) => void; placeholder: string }) {
  return (
    <Field label={label}>
      <div className="space-y-1.5">
        {list.map((a, i) => (
          <div key={a.key || i} className="flex items-center gap-2">
            <input className="input" value={a.name} placeholder={placeholder} onChange={(e) => set((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <button type="button" aria-label="Remove" onClick={() => set((l) => l.filter((_, j) => j !== i))} className="text-slate-400"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => set((l) => [...l, { key: `new-${Date.now()}`, name: '' }])} className="flex items-center gap-1 text-sm font-medium text-brand-700"><Plus className="h-4 w-4" />Add</button>
      </div>
    </Field>
  );
}

/** Total turnaround: the Controller sections and the operator areas, and the people each shift needs per phase
 *  (e.g. full teams first, fewer after). */
function PhasesSheet({ plan, teams, phases, onClose, onDone }: { plan: SdPlan; teams: SdTeam[]; phases: SdPhase[]; onClose: () => void; onDone: (m: string) => void }) {
  const [sections, setSections] = useState<Named[]>(plan.sections.map((a) => ({ key: a, name: a })));
  const [areas, setAreas] = useState<Named[]>(plan.areas.map((a) => ({ key: a, name: a })));
  const [list, setList] = useState<SdPhase[]>(phases.length ? phases : [{ id: 'new0', start: plan.start, end: plan.end, needs: {} }]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const need = (x: SdPhase, t: string): PhaseNeed => x.needs[t] ?? { controller: 0, sections: {}, areas: {} };
  const setPhase = (i: number, f: (x: SdPhase) => SdPhase) => setList((l) => l.map((x, j) => (j === i ? f(x) : x)));
  const setNeed = (i: number, t: string, kind: 'controller' | 'sections' | 'areas', k: string, n: number) => setPhase(i, (x) => {
    const cur = need(x, t);
    return { ...x, needs: { ...x.needs, [t]: kind === 'controller' ? { ...cur, controller: n } : { ...cur, [kind]: { ...(cur[kind] ?? {}), [k]: n } } } };
  });
  function addPhase() {
    const last = list[list.length - 1];
    const start = last ? addDaysIso(last.end, 1) : plan.start;
    setList((l) => [...l, { id: `new${Date.now()}`, start: start > plan.end ? plan.end : start, end: plan.end, needs: last ? structuredClone(last.needs) : {} }]);
  }
  const clean = (l: Named[]) => l.map((a) => ({ ...a, name: a.name.trim() })).filter((a) => a.name);
  const bad = list.some((x) => x.end < x.start || x.start < plan.start || x.end > plan.end)
    || [...list].sort((a, b) => a.start.localeCompare(b.start)).some((x, i, l) => i > 0 && x.start <= l[i - 1].end);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const secs = clean(sections), ars = clean(areas);
      const useAreas = ars.length ? ars : [{ key: plan.areas[0] ?? '', name: '' }];
      const keep = list.map((x) => ({ ...x, needs: Object.fromEntries(Object.entries(x.needs).map(([t, n]) => {
        const bySection = Object.fromEntries(secs.map((a) => [a.name, n.sections?.[a.key] ?? 0]));
        return [t, { controller: secs.length ? Object.values(bySection).reduce((a, b) => a + b, 0) : n.controller, sections: bySection,
          areas: Object.fromEntries(useAreas.map((a) => [a.name, n.areas[a.key] ?? 0])) }];
      })) }));
      await updateSdPlan(plan.id, { areas: ars.map((a) => a.name), sections: secs.map((a) => a.name) });
      for (const a of [...ars, ...secs]) if ([...plan.areas, ...plan.sections].includes(a.key) && a.key !== a.name) await renameSdArea(plan.id, a.key, a.name);
      await saveSdPhases(plan.id, keep, removed);
      onDone('Sections, areas and phases saved.');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const ctlCols = sections.length ? sections.map((a) => ({ kind: 'sections' as const, key: a.key, label: `Ctl ${a.name.trim() || '?'}` })) : [{ kind: 'controller' as const, key: '', label: 'Controllers' }];
  const areaCols = (areas.length ? areas : [{ key: '', name: '' }]).map((a) => ({ kind: 'areas' as const, key: a.key, label: a.name.trim() || 'Operators' }));
  const value = (x: SdPhase, t: string, c: { kind: 'controller' | 'sections' | 'areas'; key: string }) => (c.kind === 'controller' ? need(x, t).controller : need(x, t)[c.kind]?.[c.key] ?? 0);
  return (
    <BottomSheet open onClose={onClose} title="Sections, areas and phases">
      <div className="space-y-3">
        <NamesEditor label="Controller sections (one Controller each, e.g. TR-I, TR-II, L.P)" list={sections} set={setSections} placeholder="e.g. TR-I" />
        <NamesEditor label="Operator areas (operators are grouped by area in each shift)" list={areas} set={setAreas} placeholder="e.g. TR-II" />
        {list.map((x, i) => (
          <div key={x.id} className="rounded-xl p-2 ring-1 ring-slate-200">
            <div className="flex items-end gap-2">
              <Field label={`Phase ${i + 1} from`}><input type="date" className="input" value={x.start} min={plan.start} max={plan.end} onChange={(e) => setPhase(i, (p) => ({ ...p, start: e.target.value }))} /></Field>
              <Field label="Until"><input type="date" className="input" value={x.end} min={plan.start} max={plan.end} onChange={(e) => setPhase(i, (p) => ({ ...p, end: e.target.value }))} /></Field>
              {list.length > 1 && <button type="button" aria-label="Remove phase" onClick={() => { if (!x.id.startsWith('new')) setRemoved((r) => [...r, x.id]); setList((l) => l.filter((_, j) => j !== i)); }} className="mb-3 text-slate-400"><Trash2 className="h-4 w-4" /></button>}
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] text-slate-500"><th className="font-medium">Shift</th>{[...ctlCols, ...areaCols].map((c) => <th key={`${c.kind}${c.key}`} className="whitespace-nowrap px-0.5 font-medium">{c.label}</th>)}</tr></thead>
                <tbody>{teams.map((t) => (
                  <tr key={t.id}><td className="py-1 pr-1">{t.name}</td>
                    {[...ctlCols, ...areaCols].map((c) => <td key={`${c.kind}${c.key}`} className="px-0.5"><input className="input h-9 w-12 px-2" inputMode="numeric" value={value(x, t.id, c)} onChange={(e) => setNeed(i, t.id, c.kind, c.key, Number(e.target.value) || 0)} /></td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        ))}
        <button type="button" onClick={addPhase} className="flex items-center gap-1 text-sm font-medium text-brand-700"><Plus className="h-4 w-4" />Add phase (e.g. fewer people from a date)</button>
        <p className="text-[11px] text-slate-500">People not needed in a later phase: open them and set "Until (released after)".</p>
        {bad && <p className="text-xs font-medium text-status-red">Phases must be inside the shutdown dates and must not overlap.</p>}
        {err != null && <ErrorBox error={err} />}
        <Button className="w-full" disabled={busy || bad} onClick={save}>Save</Button>
      </div>
    </BottomSheet>
  );
}

/** Total turnaround: the whole unit is down, so the crews' minimums don't apply — shown as the 'Total shutdown' mode. */
function UnitDownCard({ plan, periods, onDone }: { plan: SdPlan; periods: PeriodRow[]; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const covering = periods.filter((x) => x.status === 'active' && x.mode_code === TOTAL_MODE);
  const full = covering.some((x) => x.start_date <= plan.start && x.end_date >= plan.end);
  const others = periods.filter((x) => x.status === 'active' && x.mode_code !== TOTAL_MODE);
  async function set() {
    setBusy(true); setErr(null);
    try { await schedulePeriod({ modeCode: TOTAL_MODE, start: plan.start, end: plan.end, note: plan.title }); onDone(`Total shutdown mode set for ${range(plan.start, plan.end)}.`); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Card className={cx('mb-3 py-2', full ? 'bg-green-50 ring-green-200' : 'bg-amber-50 ring-amber-200')}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Crews · unit down</h2>
      {full
        ? <p className="mt-1 text-sm text-green-800">Total shutdown mode is set for {range(plan.start, plan.end)}: the crews have no minimum while everyone is on the shifts here.</p>
        : <>
            <p className="mt-1 text-sm text-amber-900">The whole unit is down, but the Calendar still counts the crews' normal minimums on these dates{others.length ? ` (${others.map((x) => `${x.mode_code.replace(/_/g, ' ')} ${range(x.start_date, x.end_date)}`).join(', ')})` : ''}. Set the Total shutdown mode so they aren't flagged short.</p>
            {others.length > 0 && <p className="mt-1 text-[11px] text-amber-900">Another mode covers some of these dates: change or cancel it on <Link to="/operation" className="font-semibold underline">Operation</Link> first.</p>}
            {err != null && <ErrorBox error={err} />}
            <Button className="mt-2 w-full" disabled={busy || others.length > 0} onClick={set}>Set Total shutdown mode · {range(plan.start, plan.end)}</Button>
          </>}
    </Card>
  );
}
