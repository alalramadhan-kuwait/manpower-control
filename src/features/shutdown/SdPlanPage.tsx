import { AlertTriangle, ArrowLeft, Check, Copy, Pencil, Plus, UserMinus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { COVER_GRADE } from '@/core/controllers';
import { evaluateRange, personOn, SD_TEAM, type MpAbsence, type MpAssignment, type MpPerson } from '@/core/manpower';
import { CREWS, addDaysIso, type Crew } from '@/core/roster';
import { FO_LEVEL_LABEL, SD_SLOTS, SD_SLOT_LABEL, dayShort, dayState, isRampDay, memberHours, memberWorks, nextOffset, planDates, teamDay, cycleOf, type SdMember, type SdPlan, type SdSlot, type SdTeam } from '@/core/shutdown';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { fetchDirectory } from '@/data/queries';
import { addSdMember, fetchSdPlan, removeSdMember, updateSdMember, updateSdPlan, updateSdTeam } from '@/data/shutdown';
import type { EmployeeDirectoryRow } from '@/data/types';
import { BottomSheet, Button, Card, ErrorBox, Field, Spinner, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { shortDate } from '@/ui/leave';

const CONTROLLER_ROLES = ['controller', 'vr_controller', 'morning_controller'];
const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
const wd = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
type Data = { plan: SdPlan; teams: SdTeam[]; members: SdMember[]; inputs: ManpowerInputs; dir: Map<string, EmployeeDirectoryRow> };

/** Shutdown team planner: fill each team's slots, see the days each team is short, what the crews keep, and the overtime. */
export default function SdPlanPage() {
  const { id } = useParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState<{ team: SdTeam; slot: SdSlot } | null>(null);
  const [member, setMember] = useState<SdMember | null>(null);
  const [editPattern, setEditPattern] = useState(false);
  const [editTeam, setEditTeam] = useState<SdTeam | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const sd = await fetchSdPlan(id!);
      const [inputs, dir] = await Promise.all([fetchManpowerInputs(addDaysIso(sd.plan.start, -1), addDaysIso(sd.plan.end, 1)), fetchDirectory()]);
      setData({ ...sd, inputs, dir: new Map(dir.map((r) => [r.id, r])) });
    } catch (e) { setError(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const done = (m: string) => { setAdding(null); setMember(null); setEditPattern(false); setEditTeam(null); setNotice(m); load(); };

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
    const hours = new Map(members.map((m) => [m.id, memberHours(plan, m, homeCrew(m.employeeId, plan.start))]));
    const leaveDays = (m: SdMember) => dates.filter((d) => memberWorks(plan, m, d) && leaveOn(m.employeeId, d)).length;
    const teamDays = new Map(teams.map((t) => [t.id, dates.map((d) => ({ date: d, slots: teamDay(plan, t, members, d, leaveOn) }))]));
    return { people, leaveOn, homeCrew, dates, crewImpact, hours, leaveDays, teamDays };
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (!data || !view) return <Spinner />;
  const { plan, teams, members, dir } = data;
  const needTotal = teams.reduce((n, t) => n + SD_SLOTS.reduce((k, s) => k + t.needs[s], 0), 0);
  const gapDays = teams.reduce((n, t) => n + view.teamDays.get(t.id)!.filter((d) => dayState(d.slots) === 'critical').length, 0);
  const overCap = members.filter((m) => view.hours.get(m.id)!.some((h) => h.over)).length;
  const crewShort = view.crewImpact.reduce((n, c) => n + c.short, 0);

  function copyList() {
    const lines = [`${plan.title} · ${range(plan.start, plan.end)} ${plan.end.slice(0, 4)}`, `${plan.daysOn} on / ${plan.daysOff} off · ${plan.shiftHours} h (first and last ${plan.rampDays} days ${plan.rampHours} h)`];
    for (const t of teams) {
      lines.push('', `${t.name} team`);
      for (const s of SD_SLOTS) for (const m of members.filter((x) => x.teamId === t.id && x.slot === s)) {
        const r = dir.get(m.employeeId);
        lines.push(`${SD_SLOT_LABEL[s]}: ${r?.display_name ?? ''} (${r?.employee_number ?? ''}${r?.crew_code ? `, ${r.crew_code} Shift` : ''})${m.start !== plan.start || m.end !== plan.end ? ` ${range(m.start, m.end)}` : ''}`);
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
            {[`${plan.daysOn} on / ${plan.daysOff} off`, `${plan.shiftHours} h`, `First & last ${plan.rampDays} days ${plan.rampHours} h`, `OT ≤ ${plan.maxOvertime} h`].map((c) => <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{c}</span>)}
            <span className="flex items-center gap-0.5 text-[11px] font-medium text-brand-700"><Pencil className="h-3 w-3" />Edit</span>
          </button>
        </div>
        <Button variant="secondary" className="min-h-9 shrink-0 px-3 text-xs" onClick={copyList}><Copy className="h-3.5 w-3.5" />Copy list</Button>
      </div>
      {notice && <p className="mb-2 flex items-center gap-1 text-sm text-status-green"><Check className="h-4 w-4" />{notice}</p>}

      <div className="mb-3 grid grid-cols-4 gap-1 text-center">
        {[{ n: `${members.length}/${needTotal}`, label: 'Placed', dot: members.length >= needTotal ? 'bg-status-green' : 'bg-status-amber' },
          { n: gapDays, label: 'Days a slot empty', dot: gapDays ? 'bg-status-red' : 'bg-status-green' },
          { n: crewShort, label: 'Crews short (days)', dot: crewShort ? 'bg-status-red' : 'bg-status-green' },
          { n: overCap, label: `Over ${plan.maxOvertime} h OT`, dot: overCap ? 'bg-status-red' : 'bg-status-green' }].map((k) => (
          <div key={k.label} className="rounded-lg bg-white px-1 py-1 ring-1 ring-slate-200">
            <div className="flex items-center justify-center gap-1 text-base font-semibold leading-tight tabular-nums text-slate-800"><span className={cx('h-2 w-2 rounded-full', k.dot)} />{k.n}</div>
            <div className="text-[10px] leading-tight text-slate-500">{k.label}</div>
          </div>
        ))}
      </div>

      {teams.map((t) => <TeamCard key={t.id} t={t} data={data} view={view} onAdd={(slot) => setAdding({ team: t, slot })} onMember={setMember} onEdit={() => setEditTeam(t)} />)}

      <Card className="mb-3 py-1.5">
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
      </Card>

      {adding && <AddSheet plan={plan} team={adding.team} slot={adding.slot} data={data} view={view} onClose={() => setAdding(null)} onDone={done} />}
      {member && <MemberSheet plan={plan} m={member} data={data} view={view} onClose={() => setMember(null)} onDone={done} />}
      {editPattern && <PatternSheet plan={plan} onClose={() => setEditPattern(false)} onDone={done} />}
      {editTeam && <NeedsSheet t={editTeam} onClose={() => setEditTeam(null)} onDone={done} />}
    </div>
  );
}

interface View {
  people: Map<string, MpPerson>;
  leaveOn: (employeeId: string, date: string) => boolean;
  /** The person's own crew on a date, the shutdown team aside (VRs: their placement crew). */
  homeCrew: (employeeId: string, date: string) => Crew | null;
  dates: string[];
  hours: Map<string, ReturnType<typeof memberHours>>;
  leaveDays: (m: SdMember) => number;
  teamDays: Map<string, { date: string; slots: ReturnType<typeof teamDay> }[]>;
}

function TeamCard({ t, data, view, onAdd, onMember, onEdit }: { t: SdTeam; data: Data; view: View; onAdd: (s: SdSlot) => void; onMember: (m: SdMember) => void; onEdit: () => void }) {
  const [day, setDay] = useState<string | null>(null);
  const days = view.teamDays.get(t.id)!;
  const sel = day ? days.find((d) => d.date === day) : null;
  return (
    <Card className="mb-3 py-1.5">
      <div className="flex items-center justify-between pt-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.name} team</h2>
        <button type="button" onClick={onEdit} className="flex items-center gap-1 text-[11px] text-slate-500">{SD_SLOTS.map((s) => `${t.needs[s]}`).join('·')} (reduced {SD_SLOTS.map((s) => `${t.rampNeeds[s]}`).join('·')})<Pencil className="h-3 w-3" /></button>
      </div>
      {/* day strip: green = everyone on, amber = fewer (days off), red = a slot with nobody that day; outlined = reduced day */}
      <div className="mt-1.5 grid gap-px" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((d) => { const n = dayShort(d.slots); const st = dayState(d.slots); return (
          <button key={d.date} type="button" onClick={() => setDay(day === d.date ? null : d.date)} title={shortDate(d.date)}
            className={cx('flex h-5 items-center justify-center rounded-[3px] text-[8px] font-bold', st === 'critical' ? 'bg-status-red text-white' : st === 'short' ? 'bg-amber-200 text-amber-900' : 'bg-green-200 text-green-900', isRampDay(data.plan, d.date) && 'ring-1 ring-inset ring-slate-500', day === d.date && 'outline outline-2 outline-brand-700')}>{n || ''}</button>
        ); })}
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-slate-400"><span>{shortDate(days[0].date)}</span><span>green all on · amber fewer · red a slot empty</span><span>{shortDate(days[days.length - 1].date)}</span></div>
      {sel && <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-700">{wd(sel.date)} {shortDate(sel.date)}{isRampDay(data.plan, sel.date) ? ' · reduced' : ''}: {SD_SLOTS.map((s) => <span key={s} className={cx('ml-1', sel.slots[s].have < sel.slots[s].need && 'font-semibold text-status-red')}>{SD_SLOT_LABEL[s]} {sel.slots[s].have}/{sel.slots[s].need}</span>)}</p>}

      <div className="mt-1 divide-y divide-slate-100">
        {SD_SLOTS.map((s) => {
          const list = data.members.filter((m) => m.teamId === t.id && m.slot === s);
          const missing = Math.max(0, t.needs[s] - list.length);
          return (
            <div key={s} className="py-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500"><span>{SD_SLOT_LABEL[s]} · {list.length}/{t.needs[s]}</span>
                <button type="button" onClick={() => onAdd(s)} className="flex items-center gap-0.5 text-brand-700"><Plus className="h-3.5 w-3.5" />Add</button></div>
              {list.map((m) => <MemberRow key={m.id} m={m} data={data} view={view} onOpen={() => onMember(m)} />)}
              {Array.from({ length: missing }, (_, i) => <button key={i} type="button" onClick={() => onAdd(s)} className="mt-1 flex w-full items-center gap-1.5 rounded-lg border border-dashed border-red-300 px-2 py-1.5 text-left text-xs font-medium text-status-red"><Plus className="h-3.5 w-3.5" />{SD_SLOT_LABEL[s]} needed</button>)}
            </div>
          );
        })}
      </div>
    </Card>
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
        <span className="block truncate text-sm font-medium text-slate-900">{r?.display_name ?? '—'}{r?.fo_level && m.slot !== 'controller' ? <span className="ml-1 text-[10px] font-semibold text-slate-400">{FO_LEVEL_LABEL[r.fo_level]}</span> : null}</span>
        <span className="block truncate text-[11px] text-slate-500">#{r?.employee_number} · off {off.join(', ')}…{m.start !== data.plan.start || m.end !== data.plan.end ? ` · ${range(m.start, m.end)}` : ''}</span>
      </span>
      {leave > 0 && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900">Leave {leave}d</span>}
      <span className={cx('shrink-0 rounded-full px-1.5 text-[10px] font-semibold tabular-nums', over ? 'bg-status-red text-white' : 'bg-slate-100 text-slate-600')}>OT {ot} h</span>
    </button>
  );
}

/** Pick someone for a slot: the right level first, with what taking them costs (leave, their crew, same crew already). */
function AddSheet({ plan, team, slot, data, view, onClose, onDone }: { plan: SdPlan; team: SdTeam; slot: SdSlot; data: Data; view: View; onClose: () => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const inPlan = new Set(data.members.map((m) => m.employeeId));
  const cands = useMemo(() => {
    const { inputs } = data;
    const base = evaluateRange(plan.start, plan.end, inputs.people, inputs.absences, inputs.rules, inputs.assignments);
    const pool = inputs.people.filter((p) => !inPlan.has(p.id) && (slot === 'controller'
      ? CONTROLLER_ROLES.includes(p.role ?? '') && (p.grade ?? 0) >= COVER_GRADE
      : p.role === 'field_operator'));
    const fromCrew = (c: Crew | null) => data.members.filter((m) => view.homeCrew(m.employeeId, plan.start) === c).length;
    return pool.map((p) => {
      const crew = view.homeCrew(p.id, plan.start);
      const level = data.dir.get(p.id)?.fo_level ?? null;
      const leave = view.dates.filter((d) => view.leaveOn(p.id, d)).length;
      // the crew without this person: extra days below the minimum (or needing a Controller cover)
      let hit = 0;
      if (crew) {
        const isCtl = CONTROLLER_ROLES.includes(p.role ?? '');
        const people2: MpPerson[] = isCtl ? inputs.people : inputs.people.map((x) => (x.id === p.id ? { ...x, moves: [...(x.moves ?? []), { start: plan.start, end: plan.end, crew: SD_TEAM, kind: 'sd' as const }] } : x));
        const assign2: MpAssignment[] = isCtl ? [...inputs.assignments, { id: 'cand', kind: 'sd_team', employeeId: p.id, crew: null, start: plan.start, end: plan.end }] : inputs.assignments;
        const after = evaluateRange(plan.start, plan.end, people2, inputs.absences as MpAbsence[], inputs.rules, assign2);
        hit = after.filter((d, i) => { const a = d.crews.find((x) => x.crew === crew)!, b = base[i].crews.find((x) => x.crew === crew)!;
          return a.working && ((a.confirmedShortage && !b.confirmedShortage) || (a.controller.finding === 'coverage_required' && b.controller.finding !== 'coverage_required')); }).length;
      }
      const match = slot === 'controller' || level === slot;
      return { p, crew, level, leave, hit, same: fromCrew(crew), match };
    }).sort((a, b) => Number(b.match) - Number(a.match) || Number(!!a.leave) - Number(!!b.leave) || a.hit - b.hit || a.same - b.same || (b.p.grade ?? 0) - (a.p.grade ?? 0) || a.p.name.localeCompare(b.p.name));
  }, [data, view, plan, slot]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(p: MpPerson) {
    setBusy(true); setErr(null);
    try { await addSdMember({ planId: plan.id, teamId: team.id, employeeId: p.id, slot, offset: nextOffset(plan, team.id, slot, data.members), start: plan.start, end: plan.end }); onDone(`${p.name} added to the ${team.name} team as ${SD_SLOT_LABEL[slot]}.`); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const unmarked = slot !== 'controller' && cands.every((c) => !c.level);
  return (
    <BottomSheet open onClose={onClose} title={`${team.name} team · ${SD_SLOT_LABEL[slot]}`}>
      <div className="space-y-2">
        {unmarked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">No Field Operator has a level yet. <Link to="/review/fo-levels" className="font-semibold underline">Mark Senior / Good / New</Link> to see the right people first.</p>}
        {err != null && <ErrorBox error={err} />}
        <div className="divide-y divide-slate-100">
          {cands.map((c) => (
            <button key={c.p.id} type="button" disabled={busy} onClick={() => pick(c.p)} className={cx('flex w-full items-center gap-2 py-2 text-left', !c.match && 'opacity-60')}>
              {c.crew ? <CrewBadge crew={c.crew} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-500">VR</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{c.p.name} <span className="text-[11px] font-normal text-slate-500">G{c.p.grade ?? '—'}{c.level ? ` · ${FO_LEVEL_LABEL[c.level]}` : slot !== 'controller' ? ' · no level' : ''}</span></span>
                <span className="flex flex-wrap gap-x-2 text-[11px] font-semibold">
                  {c.leave > 0 && <span className="text-amber-700">Leave {c.leave}d</span>}
                  {c.hit > 0 && <span className="inline-flex items-center gap-0.5 text-status-red"><AlertTriangle className="h-3 w-3" />{c.crew} short {c.hit}d without him</span>}
                  {c.same > 0 && <span className="text-slate-500">{c.same} already from {c.crew}</span>}
                  {!c.leave && !c.hit && <span className="text-status-green">Free · crew keeps its minimum</span>}
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
  const [offset, setOffset] = useState(m.offset);
  const [start, setStart] = useState(m.start); const [end, setEnd] = useState(m.end);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const trial = { ...m, offset, start, end };
  const hours = memberHours(plan, trial, view.homeCrew(m.employeeId, plan.start));
  const cycle = cycleOf(plan);
  const valid = start >= plan.start && end <= plan.end && end >= start;
  async function save() {
    setBusy(true); setErr(null);
    try { await updateSdMember(m.id, { day_offset: offset, start_date: start, end_date: end }); onDone(`${r?.display_name}: team place updated.`); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setErr(null);
    try { await removeSdMember(m.id); onDone(`${r?.display_name} taken off the team; back with his crew.`); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title={r?.display_name ?? 'Team member'}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">#{r?.employee_number} · {SD_SLOT_LABEL[m.slot]}{r?.crew_code ? ` · from ${r.crew_code} Shift` : ''}</p>
        <Field label={`Days off (${plan.daysOn} on / ${plan.daysOff} off)`}>
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: cycle }, (_, o) => {
              const offs = view.dates.filter((d) => !memberWorks(plan, { ...trial, offset: o, start: plan.start, end: plan.end }, d)).slice(0, 3).map((d) => Number(d.slice(8)));
              return <button key={o} type="button" onClick={() => setOffset(o)} className={cx('rounded-lg px-1 py-1.5 text-[11px] font-medium ring-1', offset === o ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>Off {offs.join(', ')}…</button>;
            })}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" className="input" value={start} min={plan.start} max={plan.end} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Until"><input type="date" className="input" value={end} min={plan.start} max={plan.end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] text-slate-500"><th className="font-medium">Month</th><th className="text-right font-medium">SD h</th><th className="text-right font-medium">Normal h</th><th className="text-right font-medium">OT h</th></tr></thead>
          <tbody>{hours.map((h) => <tr key={h.month}><td>{new Date(`${h.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</td><td className="text-right tabular-nums">{h.sd}</td><td className="text-right tabular-nums">{h.normal}</td>
            <td className={cx('text-right font-semibold tabular-nums', h.over ? 'text-status-red' : 'text-slate-800')}>{h.overtime}{h.over ? ` > ${plan.maxOvertime}` : ''}</td></tr>)}</tbody>
        </table>
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          <Button variant="danger" className="flex-1" disabled={busy} onClick={remove}><UserMinus className="h-4 w-4" />Take off team</Button>
          <Button className="flex-1" disabled={busy || !valid} onClick={save}>Save</Button>
        </div>
      </div>
    </BottomSheet>
  );
}

function PatternSheet({ plan, onClose, onDone }: { plan: SdPlan; onClose: () => void; onDone: (m: string) => void }) {
  const [v, setV] = useState({ start_date: plan.start, end_date: plan.end, days_on: plan.daysOn, days_off: plan.daysOff, shift_hours: plan.shiftHours, ramp_days: plan.rampDays, ramp_hours: plan.rampHours, normal_hours: plan.normalHours, max_overtime: plan.maxOvertime });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const num = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: Number(e.target.value) }));
  async function save() { setBusy(true); setErr(null); try { await updateSdPlan(plan.id, v); onDone('Pattern saved.'); } catch (e) { setErr(e); } finally { setBusy(false); } }
  return (
    <BottomSheet open onClose={onClose} title="Shutdown pattern">
      <div className="space-y-3">
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

