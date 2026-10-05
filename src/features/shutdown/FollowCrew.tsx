// Instructions: "follow crew X's shift, take off, then join the shutdown team". People of one crew rest on the same days, so a
// level that needs two has nobody left then. The person keeps X's duty and rest days on the team, and works X's shift before
// joining (a temporary shift movement, so the crews' cover counts him there). Suggested per level, or set by hand per person.
import { AlertTriangle, ArrowRight, Check, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { evaluateRange, type MpPerson } from '@/core/manpower';
import { CREWS, addDaysIso, type Crew } from '@/core/roster';
import { slotLabel, type SdMember, type SdPlan, type SdTeam } from '@/core/shutdown';
import type { FollowGroup } from '@/core/shutdown/overlap';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { clearSdDays, fetchFollowMovements, setFollow } from '@/data/shutdown';
import { BottomSheet, Button, ErrorBox, Field, Spinner, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { loadSdDoc, type Doc } from './SdDocuments';
import { personalInstruction, type FollowMove } from './sdExcel';

type Previous = Map<string, { id: string; to: Crew; start: string; end: string | null }>;
/** When the person starts on the new crew's shift: a full rota (8 days) before the team starts, never in the past. */
const defaultFrom = (plan: SdPlan, today: string) => { const f = addDaysIso(plan.start, -8); return f < today ? today : f; };
const dayBefore = (d: string) => addDaysIso(d, -1);

/** Days each crew falls short between `from` and the day before `to` with the people moved to the given crews. */
function crewShortDays(inputs: ManpowerInputs, from: string, to: string, moves: { id: string; crew: Crew }[]) {
  const count = (people: MpPerson[]) => {
    const r = evaluateRange(from, to, people, inputs.absencesAll, inputs.rules, inputs.assignments);
    return Object.fromEntries(CREWS.map((c) => [c, r.filter((d) => d.crews.find((x) => x.crew === c)?.confirmedShortage).length])) as Record<Crew, number>;
  };
  const moved = inputs.people.map((p) => { const mv = moves.find((x) => x.id === p.id); return mv ? { ...p, moves: [...(p.moves ?? []), { start: from, end: to, crew: mv.crew, kind: 'temporary' as const }] } : p; });
  return { before: count(inputs.people), after: count(moved) };
}

/** Suggested instructions for the team's overlaps, to accept all at once. */
export function FollowSheet({ asPage, plan, teams, members, groups, names, isVr, onClose, onDone }: { asPage?: boolean; plan: SdPlan; teams: SdTeam[]; members: SdMember[]; groups: FollowGroup[]; names: Map<string, string>; isVr: (employeeId: string) => boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const today = localToday();
  const [from, setFrom] = useState(defaultFrom(plan, today));
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [previous, setPrevious] = useState<Previous | null>(null);
  const [inputs, setInputs] = useState<ManpowerInputs | null>(null);
  const changes = groups.flatMap((g) => g.changes.map((c) => ({ ...c, g })));
  const chosen = changes.filter((c) => !skip.has(c.memberId));
  const join = (memberId: string) => members.find((m) => m.id === memberId)?.start ?? plan.start;
  const lastDay = dayBefore(plan.start);
  const hasBefore = from <= lastDay;
  useEffect(() => { fetchFollowMovements(changes.map((c) => c.employeeId)).then(setPrevious).catch(setErr); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!hasBefore) { setInputs(null); return; } setInputs(null); fetchManpowerInputs(from, lastDay).then(setInputs).catch(setErr); }, [from, lastDay, hasBefore]);
  const impact = useMemo(() => (inputs && hasBefore ? crewShortDays(inputs, from, lastDay, chosen.filter((c) => !isVr(c.employeeId)).map((c) => ({ id: c.employeeId, crew: c.to }))) : null), [inputs, from, lastDay, hasBefore, chosen, isVr]);
  const worse = impact ? CREWS.filter((c) => impact.after[c] > impact.before[c]) : [];
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? '';

  async function apply() {
    setBusy(true); setErr(null);
    const failed: string[] = []; let ok = 0;
    for (const c of chosen) {
      const m = members.find((x) => x.id === c.memberId); if (!m) continue;
      try {
        await setFollow({ member: m, title: plan.title, to: c.to, from: hasBefore ? from : null, previous: previous?.get(c.employeeId) ?? null, vr: isVr(c.employeeId) });
        await clearSdDays(m.id);   // the days set by hand followed the old crew
        ok++;
      } catch (e) { failed.push(`${names.get(c.employeeId) ?? 'Employee'}: ${e instanceof Error ? e.message : 'failed'}`); }
    }
    if (failed.length) { setErr(new Error(`${ok} done, ${failed.length} not: ${failed.join(' · ')}`)); setBusy(false); if (ok) onDone(`${ok} instruction${ok === 1 ? '' : 's'} saved; ${failed.length} not (${failed.join(' · ')}). Press Set days & hours to set the days.`); return; }
    onDone(`${ok} instruction${ok === 1 ? '' : 's'} saved. Press Set days & hours to set the days again.`);
  }

  const body = (
      <div className="space-y-3">
        <PersonalList planId={plan.id} memberIds={members.map((m) => m.employeeId)} />
        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Fix overlaps</p>
        <p className="text-xs text-slate-600">People of one crew rest on the same days, so a level that needs two has nobody then. An instruction tells a person to <b>follow another crew&apos;s shift, take off, then join the team</b>: on the team he keeps that crew&apos;s duty and rest days, so the rest days of the level fall on different days. Before joining he works that crew&apos;s shift and counts in it.</p>
        {changes.length === 0 ? <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">No overlaps: every level has people of different crews (or nobody can change).</p> : (
          <>
            <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
              {changes.map((c) => (
                <li key={c.memberId}>
                  <label className="flex items-center gap-2 px-3 py-2">
                    <input type="checkbox" className="h-4 w-4" checked={!skip.has(c.memberId)} onChange={() => setSkip((s) => { const n = new Set(s); if (n.has(c.memberId)) n.delete(c.memberId); else n.add(c.memberId); return n; })} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{names.get(c.employeeId) ?? 'Employee'}{isVr(c.employeeId) && <span className="ml-1 text-[10px] font-semibold text-slate-400">VR</span>}</span>
                      <span className="block text-[11px] text-slate-500">{teamName(c.g.teamId)} · {slotLabel(c.g.key)} · days nobody there {c.g.before.gapDays} → {c.g.after.gapDays} · short {c.g.before.short} → {c.g.after.short}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold"><CrewBadge crew={c.from} size="sm" /><ArrowRight className="h-3.5 w-3.5 text-slate-400" /><CrewBadge crew={c.to} size="sm" /></span>
                  </label>
                </li>
              ))}
            </ul>
            <Field label="Works that crew's shift from" hint={`Until the day before he joins (${shortDate(join(changes[0].memberId))}). Leave it on or after ${shortDate(plan.start)} for no time before joining.`}>
              <input type="date" className="input" value={from} max={plan.start} onChange={(e) => setFrom(e.target.value || defaultFrom(plan, today))} />
            </Field>
            {hasBefore && (!inputs ? <Spinner label="Checking the crews' cover…" /> : worse.length === 0
              ? <p className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800 ring-1 ring-green-200"><Check className="h-4 w-4 shrink-0" />Before joining ({shortDate(from)} – {shortDate(lastDay)}) no crew falls short because of the moves.</p>
              : <p className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-status-red ring-1 ring-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Before joining, {worse.map((c) => `${c} Shift short ${impact!.after[c] - impact!.before[c]} more ${impact!.after[c] - impact!.before[c] === 1 ? 'day' : 'days'}`).join(' · ')}. Start later, or untick the person.</p>)}
            {chosen.some((c) => isVr(c.employeeId)) && <p className="text-[11px] text-slate-500">A VR Controller has no crew of his own: his instruction changes his rota on the team only. His placement before joining stays as the Section Head set it (VR placement).</p>}
            <p className="text-[11px] text-slate-500">Saving also clears the days set by hand for these people; then press Set days & hours to set the days and hours again.</p>
          </>
        )}
        {err != null && <ErrorBox error={err} />}
        {changes.length > 0 && <Button className="w-full" disabled={busy || chosen.length === 0} onClick={apply}><Shuffle className="h-4 w-4" />Save {chosen.length} {chosen.length === 1 ? 'instruction' : 'instructions'}</Button>}
      </div>
  );
  return asPage ? body : <BottomSheet open onClose={onClose} title="Shift instructions">{body}</BottomSheet>;
}

/** Everyone's instruction, as it goes into the Excel file, in two parts: how to begin and how to end. Only people who change are listed. */
function PersonalList({ planId, memberIds }: { planId: string; memberIds: string[] }) {
  const [data, setData] = useState<{ doc: Doc; moves: Map<string, FollowMove> } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [part, setPart] = useState<'begin' | 'end'>('begin');
  useEffect(() => {
    Promise.all([loadSdDoc(planId), fetchFollowMovements(memberIds)])
      .then(([doc, found]) => setData({ doc, moves: new Map([...found].map(([id, m]) => [id, { start: m.start, end: m.end, to: m.to }])) })).catch(setErr);
  }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err != null) return <ErrorBox error={err} />;
  if (!data) return <Spinner label="Loading the instructions…" />;
  const list = data.doc.rows.map((x) => ({ x, p: personalInstruction(data.doc, x, data.moves.get(x.m.employeeId)) })).filter((e) => e.p);
  const changes = (k: 'begin' | 'end') => list.filter((e) => (k === 'begin' ? e.p!.beginAction : e.p!.endAction));
  const shown = changes(part);
  const same = list.filter((e) => !(part === 'begin' ? e.p!.beginAction : e.p!.endAction));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {([['begin', 'Begin'], ['end', 'End']] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={part === k} onClick={() => setPart(k)} className={cx('min-h-9 rounded-lg font-medium', part === k ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{l} · {changes(k).length}</button>
        ))}
      </div>
      <p className="text-xs text-slate-600">{part === 'begin' ? 'How each person joins the shutdown team.' : 'How each person goes back to his own shift afterwards.'} Only people who need a change are listed.</p>
      {list.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Nobody is on the team yet.</p> : shown.length === 0 ? <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">No change for anybody.</p> : (
        <ul className="divide-y divide-slate-100 rounded-xl bg-amber-50 ring-1 ring-amber-200">
          {shown.map(({ x, p }) => (
            <li key={x.m.id} className="px-3 py-2">
              <div className="flex items-baseline gap-1.5"><span className="truncate text-sm font-medium text-slate-900">{x.r?.display_name ?? 'Employee'}</span><span className="shrink-0 text-xs tabular-nums text-slate-500">#{x.r?.employee_number}</span><span className="ml-auto shrink-0 text-[11px] text-slate-500">{x.home ? `${x.home} Shift` : 'Day staff'}</span></div>
              <p className="mt-0.5 text-sm text-slate-800">{part === 'begin' ? p!.begin : p!.end}</p>
            </li>
          ))}
        </ul>
      )}
      {same.length > 0 && shown.length > 0 && <p className="px-1 text-xs text-slate-500"><b>No change:</b> {same.map((e) => e.x.r?.display_name).join(', ')}</p>}
    </div>
  );
}

/** One person's instruction, by hand (in the member sheet): follow another crew, from when, or back to his own. */
export function FollowInstruction({ plan, m, home, name, vr = false, onDone }: { plan: SdPlan; m: SdMember; home: Crew; name: string; vr?: boolean; onDone: (msg: string) => void }) {
  const today = localToday();
  const [to, setTo] = useState<Crew | null>(m.followCrew ?? null);
  const [from, setFrom] = useState(defaultFrom(plan, today));
  const [previous, setPrevious] = useState<{ id: string; to: Crew; start: string; end: string | null } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (vr) return; fetchFollowMovements([m.employeeId]).then((x) => { const p = x.get(m.employeeId) ?? null; setPrevious(p); if (p) setFrom(p.start); }).catch(() => {}); }, [m.employeeId, vr]);
  const hasBefore = !vr && to !== null && from <= dayBefore(m.start);
  const changed = to !== (m.followCrew ?? null);
  async function save() {
    setBusy(true); setErr(null);
    try {
      await setFollow({ member: m, title: plan.title, to, from: hasBefore ? from : null, previous, vr });
      if (changed) await clearSdDays(m.id);
      onDone(to ? `${name} follows ${to} Shift, then joins the team${changed ? '. Press Set days & hours to set the days.' : '.'}` : `${name} is back on his own crew's days.`);
    } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <Field label="Instruction" hint={to ? `Follows ${to} Shift: ${vr ? 'keeps its duty and rest days on the team (his placement before joining is not changed)' : 'works it'}${hasBefore ? ` from ${shortDate(from)}` : ''}, takes its days off, then joins the team on ${shortDate(m.start)} and keeps its duty and rest days.` : `Own crew (${home} Shift): its duty and rest days. Choose another crew to follow its shift, take off, then join the team.`}>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setTo(null)} className={cx('flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1', to === null ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>Own crew ({home})</button>
          {CREWS.filter((c) => c !== home).map((c) => <button key={c} type="button" onClick={() => setTo(c)} className={cx('flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1', to === c ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>Follow {c}</button>)}
        </div>
        {to && !vr && <Field label="Works that crew's shift from"><input type="date" className="input" value={from} max={m.start} onChange={(e) => setFrom(e.target.value || defaultFrom(plan, today))} /></Field>}
        {err != null && <ErrorBox error={err} />}
        {(changed || (to && previous && previous.start !== from)) && <Button variant="secondary" className="w-full" disabled={busy} onClick={save}>{to ? `Save: follow ${to} Shift` : 'Back to his own crew'}</Button>}
      </div>
    </Field>
  );
}
