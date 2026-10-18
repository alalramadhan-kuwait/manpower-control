// The working plan: every member of a train shutdown (rules v2) in rows, the shutdown dates in columns, one cell per
// day. Cells are edited like a sheet (one day, or a run of days in a row), and each change is the plan check the server
// runs before approving, on the plan with the change: a change that makes a new problem stopping the plan is not
// applied, with the reason and changes that pass. Changed days are locked; "Plan the unlocked days" runs the planner
// around them. Nothing is stored until Save, which writes the days the exports and the approval read (an approved plan
// goes back to Draft, as for any change of its days).
import { ArrowLeftRight, Lock, Redo2, Save, Undo2, Unlock, Wand2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { planDates, type SdMember } from '@/core/shutdown';
import { spreadPlan } from '@/core/shutdown/spread';
import { checkPlan, fmtDay, plannerContext, type Issue, type PlanCheck, type PlanCheckInput } from '@/core/shutdown/v2';
import { cellOf, daysOf, markKey, suggestions, swapEdits, tryEdits, withDays, type CellCode, type CellEdit, type CellView, type Days, type Marks, type Suggestion } from '@/core/shutdown/workingPlan';
import { loadPlanCheckInput } from '@/data/sdCheck';
import { fetchDayMarks, saveWorkingPlan, type SavedDay } from '@/data/workingPlan';
import { Button, ErrorBox, Spinner, cx } from '@/ui/components';
import { localToday } from '@/ui/leave';

type Sel = { memberId: string; a: string; b: string } | null;
type Mode = 'move' | 'swap' | null;
type Msg = { tone: 'info' | 'ok' | 'warn' | 'block'; title: string; text?: string; problems?: Issue[]; options?: Suggestion[] };
type Snap = { days: Days; marks: Marks; check: PlanCheck };

const SLOT_ORDER: Record<string, number> = { controller: 0, senior: 1, good: 2, new: 3, member: 4 };
const SLOT_LABEL: Record<string, string> = { controller: 'Controller', senior: 'Experienced FO', good: 'Good FO', new: 'New FO', member: 'Operator' };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CODE_LABEL: Record<CellCode, string> = { W12: 'Work 12 h', W8: 'Work 8 h', O: 'Off', U: 'Unavailable' };
/** Cell colours: day duties light, night duties dark, so the two differ in lightness as well as hue. */
function cellClass(v: CellView, night: boolean): string {
  switch (v) {
    case 'W12': return night ? 'bg-blue-900 text-white' : 'bg-amber-300 text-amber-950';
    case 'W8': return night ? 'bg-blue-300 text-blue-950' : 'bg-amber-100 text-amber-900';
    case 'O': return 'bg-white text-slate-500 ring-1 ring-inset ring-slate-300';
    case 'U': return 'bg-[repeating-linear-gradient(135deg,#e2e8f0_0_4px,#cbd5e1_4px_8px)] text-slate-800';
    case 'L': return 'bg-violet-300 text-violet-950 cursor-not-allowed';
    case 'X': return 'bg-slate-100 text-slate-300 cursor-not-allowed';
  }
}
const cellText = (v: CellView) => (v === 'W12' ? '12' : v === 'W8' ? '8' : v === 'O' ? '–' : v === 'U' ? 'U' : v === 'L' ? 'L' : '');

export function WorkingPlan({ planId, approved, onClose, onDone }: { planId: string; approved: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [inp, setInp] = useState<PlanCheckInput | null>(null);
  const [base, setBase] = useState<{ days: Days; marks: Marks } | null>(null);
  const [cur, setCur] = useState<Snap | null>(null);
  const [past, setPast] = useState<Snap[]>([]); const [future, setFuture] = useState<Snap[]>([]);
  const [sel, setSel] = useState<Sel>(null); const [mode, setMode] = useState<Mode>(null);
  const [msg, setMsg] = useState<Msg>({ tone: 'info', title: 'Choose the days to change', text: 'Tap a day, then another day in the same row for the days between. Every change is checked like the approval: the team minimum, days in a row and rest, the move to and from the crew rota, overtime (72 h target, 80 h limit), the home crew on rest days, and leave.' });
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    loadPlanCheckInput(planId, localToday()).then(async (i) => {
      const marks = await fetchDayMarks(i.members.map((m) => m.id));
      if (!live) return;
      const days = daysOf(i);
      setInp(i); setBase({ days, marks }); setCur({ days, marks, check: checkPlan(withDays(i, days)) });
    }).catch((e) => live && setErr(e));
    return () => { live = false; };
  }, [planId]);

  const dates = useMemo(() => (inp ? planDates(inp.plan) : []), [inp]);
  const name = useCallback((employeeId: string) => inp?.info.get(employeeId)?.name ?? 'Member', [inp]);
  const rows = useMemo(() => (inp ? [...inp.teams].sort((a, b) => a.sort - b.sort).map((t) => ({ team: t,
    members: inp.members.filter((m) => m.teamId === t.id).sort((a, b) => (SLOT_ORDER[a.slot] ?? 9) - (SLOT_ORDER[b.slot] ?? 9) || name(a.employeeId).localeCompare(name(b.employeeId))) })) : []), [inp, name]);
  const memberOf = (id: string) => inp!.members.find((m) => m.id === id)!;
  const changed = useMemo(() => {
    if (!base || !cur || !inp) return 0;
    let n = 0;
    for (const m of inp.members) for (const d of Object.keys(cur.days[m.id] ?? {})) {
      const a = base.days[m.id]?.[d], b = cur.days[m.id][d], ka = base.marks[markKey(m.id, d)], kb = cur.marks[markKey(m.id, d)];
      if (a?.works !== b.works || a?.hours !== b.hours || !!ka?.locked !== !!kb?.locked || !!ka?.unavailable !== !!kb?.unavailable) n++;
    }
    return n;
  }, [base, cur, inp]);

  /** Apply a change if it passes; otherwise say why and what would pass. */
  function attempt(edits: CellEdit[], label: string) {
    if (!inp || !cur || !edits.length) return;
    setBusy('check');
    setTimeout(() => {
      const t = tryEdits(inp, cur.days, cur.check, edits);
      if (!t.ok) {
        const options = suggestions(inp, cur.days, cur.check, edits, name);
        setMsg({ tone: 'block', title: `Not applied: ${label}`, text: 'This change would stop the plan:', problems: t.problems, options });
        setBusy(null); return;
      }
      const marks = { ...cur.marks };
      for (const e of edits) marks[markKey(e.memberId, e.date)] = { locked: true, unavailable: e.code === 'U' };
      setPast((p) => [...p.slice(-49), cur]); setFuture([]);
      setCur({ days: t.days, marks, check: t.check }); setSel(null); setMode(null);
      const warns = t.check.issues.filter((i) => i.level === 'warn' && edits.some((e) => i.employeeId === memberOf(e.memberId).employeeId)).length;
      setMsg({ tone: warns ? 'warn' : 'ok', title: `Applied: ${label}`, text: warns ? `${warns} warning${warns === 1 ? '' : 's'} for this person (see below); nothing that stops the plan.` : 'Checked: nothing new that stops the plan. Hours, overtime and the team minimum are updated.' });
      setBusy(null);
    }, 10);
  }

  function paint(code: CellCode) {
    if (!sel || !inp) { setMsg({ tone: 'info', title: 'Choose the days first', text: 'Tap a day in a person’s row, then another day in the same row for the days between.' }); return; }
    const m = memberOf(sel.memberId);
    const run = dates.filter((d) => d >= sel.a && d <= sel.b);
    const leave = run.filter((d) => cellOf(inp, m, d, cur!.days, cur!.marks) === 'L');
    const edits = run.filter((d) => !leave.includes(d) && d >= m.start && d <= m.end).map((d) => ({ memberId: m.id, date: d, code }));
    if (!edits.length) { setMsg({ tone: 'block', title: 'Leave stays Leave', text: `${name(m.employeeId)} is on approved leave on these days. Change the leave in Requests if its dates moved.` }); return; }
    attempt(edits, `${name(m.employeeId)}: ${CODE_LABEL[code]}, ${run.length === 1 ? fmtDay(run[0]) : `${fmtDay(run[0])} – ${fmtDay(run[run.length - 1])}`}${leave.length ? ` (leave days kept: ${leave.length})` : ''}`);
  }

  function tap(memberId: string, date: string) {
    if (!inp || !cur) return;
    const v = cellOf(inp, memberOf(memberId), date, cur.days, cur.marks);
    if (mode && sel) {
      const from = { memberId: sel.memberId, date: sel.a };
      if (mode === 'move' && memberId !== sel.memberId) { setMsg({ tone: 'info', title: 'Pick a day in the same row', text: 'Move the day off: tap the day in the same person’s row that should be off instead.' }); return; }
      if (mode === 'swap' && (memberId === sel.memberId || date !== sel.a || memberOf(memberId).teamId !== memberOf(sel.memberId).teamId)) { setMsg({ tone: 'info', title: 'Pick the same day of a teammate', text: 'Swap: tap the same date in another row of the same team.' }); return; }
      const e = swapEdits(inp, cur.days, cur.marks, from, { memberId, date });
      if (!e) { setMsg({ tone: 'info', title: 'Nothing to exchange', text: 'Both days are the same, or one is leave.' }); return; }
      attempt(e, mode === 'move' ? `${name(memberOf(memberId).employeeId)}: day off moved ${fmtDay(sel.a)} → ${fmtDay(date)}` : `${name(memberOf(sel.memberId).employeeId)} ⇄ ${name(memberOf(memberId).employeeId)} on ${fmtDay(date)}`);
      return;
    }
    if (v === 'X') return;
    if (sel && sel.memberId === memberId && sel.a === sel.b && sel.a !== date) setSel({ memberId, a: sel.a < date ? sel.a : date, b: sel.a < date ? date : sel.a });
    else setSel({ memberId, a: date, b: date });
  }

  function startMode(m: Mode) {
    if (!sel || sel.a !== sel.b) { setMsg({ tone: 'info', title: 'Choose one day first', text: m === 'move' ? 'Tap the day off to move, then Move day off, then the day that should be off instead.' : 'Tap one day, then Swap with…, then the same day of a teammate.' }); return; }
    setMode(m);
    setMsg({ tone: 'info', title: m === 'move' ? 'Tap the new day off in the same row' : 'Tap the same day of a teammate', text: 'Both days change together and are checked as one change.' });
  }

  function unlock() {
    if (!sel || !cur) return;
    const marks = { ...cur.marks };
    for (const d of dates.filter((x) => x >= sel.a && x <= sel.b)) { const k = markKey(sel.memberId, d); if (marks[k]) marks[k] = { ...marks[k], locked: false }; }
    setPast((p) => [...p.slice(-49), cur]); setFuture([]); setCur({ ...cur, marks }); setSel(null);
    setMsg({ tone: 'ok', title: 'Unlocked', text: 'These days will be planned again by “Plan the unlocked days”.' });
  }

  function regenerate() {
    if (!inp || !cur) return;
    setBusy('plan');
    setTimeout(() => {
      const ctx = plannerContext(withDays(inp, cur.days));
      const locked = (memberId: string, d: string) => !!cur.marks[markKey(memberId, d)]?.locked;
      const byEmp = new Map(inp.members.map((m) => [m.employeeId, m]));
      // a locked day off is a day the planner may not use; the locked duty days are kept as set
      const away = (e: string, d: string) => ctx.away(e, d) || (() => { const m = byEmp.get(e); return !!m && locked(m.id, d) && !cur.days[m.id]?.[d]?.works; })();
      const results = spreadPlan(inp.plan, inp.teams, inp.members, inp.phases ?? [], { crewOf: ctx.crewOf, away, maxRun: 6, v2: true, transitionCost: ctx.transitionCost, monthTaken: ctx.monthTaken, crewOn: ctx.crewOn, levelOf: ctx.levelOf });
      const next: Days = { ...cur.days };
      let n = 0;
      for (const r of results) for (const [memberId, ds] of r.days) {
        next[memberId] = { ...next[memberId] };
        for (const [d, works] of Object.entries(ds)) {
          if (locked(memberId, d) || !next[memberId][d]) continue;
          const day = { works, hours: works ? r.hours.get(memberId)?.[d] ?? inp.plan.shiftHours : null };
          if (day.works !== next[memberId][d].works || day.hours !== next[memberId][d].hours) n++;
          next[memberId][d] = day;
        }
      }
      const check = checkPlan(withDays(inp, next));
      const blocks = check.issues.filter((i) => i.level === 'block').length, before = cur.check.issues.filter((i) => i.level === 'block').length;
      if (blocks > before) { setMsg({ tone: 'block', title: 'Not applied: plan the unlocked days', text: `Around your locked days the planner would leave ${blocks - before} more problem${blocks - before === 1 ? '' : 's'} that stop the plan. Unlock some days, or change them by hand.`, problems: check.issues.filter((i) => i.level === 'block').slice(0, 5) }); setBusy(null); return; }
      setPast((p) => [...p.slice(-49), cur]); setFuture([]); setCur({ days: next, marks: cur.marks, check });
      const lockedN = Object.values(cur.marks).filter((x) => x.locked).length;
      setMsg({ tone: 'ok', title: 'Unlocked days planned again', text: `${n} day${n === 1 ? '' : 's'} changed by the planner (3 on / 1 off and the same rules); ${lockedN} locked day${lockedN === 1 ? '' : 's'} kept as you set them.` });
      setBusy(null);
    }, 10);
  }

  async function save() {
    if (!inp || !base || !cur) return;
    setBusy('save'); setErr(null);
    try {
      const rows: SavedDay[] = [];
      const touched = new Set<string>();
      for (const m of inp.members) for (const [d, day] of Object.entries(cur.days[m.id] ?? {})) {
        const a = base.days[m.id]?.[d], ka = base.marks[markKey(m.id, d)], kb = cur.marks[markKey(m.id, d)];
        if (a?.works === day.works && a?.hours === day.hours && !!ka?.locked === !!kb?.locked && !!ka?.unavailable === !!kb?.unavailable) continue;
        rows.push({ memberId: m.id, date: d, works: day.works, hours: day.hours, locked: !!kb?.locked, unavailable: !!kb?.unavailable });
        touched.add(m.id);
      }
      // the rest days off the crew that the new days need, worked out as the planner does
      const ctx = plannerContext(withDays(inp, cur.days));
      const rest = inp.members.filter((m) => touched.has(m.id)).map((m) => ({ memberId: m.id, days: ctx.restDaysFor(m, cur.days[m.id]) }))
        .filter((r) => r.days.join(',') !== [...(memberOf(r.memberId).restDays ?? [])].sort().join(','));
      await saveWorkingPlan(rows, rest);
      onDone(`Working plan saved: ${rows.length} day${rows.length === 1 ? '' : 's'} changed.${approved ? ' The plan is back to Draft: approve it again after the check.' : ''}`);
    } catch (e) { setErr(e); setBusy(null); }
  }

  const undo = () => { if (!past.length || !cur) return; setFuture((f) => [...f, cur]); setCur(past[past.length - 1]); setPast((p) => p.slice(0, -1)); setSel(null); setMode(null); setMsg({ tone: 'info', title: 'Undone' }); };
  const redo = () => { if (!future.length || !cur) return; setPast((p) => [...p, cur]); setCur(future[future.length - 1]); setFuture((f) => f.slice(0, -1)); setSel(null); setMode(null); setMsg({ tone: 'info', title: 'Redone' }); };
  const close = () => { if (changed && !window.confirm('Close without saving the changes?')) return; onClose(); };

  const check = cur?.check;
  const blocks = check?.issues.filter((i) => i.level === 'block') ?? [];
  const warns = check?.issues.filter((i) => i.level === 'warn') ?? [];
  const tone = { info: 'bg-white ring-slate-200', ok: 'bg-green-50 ring-green-200', warn: 'bg-amber-50 ring-amber-200', block: 'bg-red-50 ring-red-300' }[msg.tone];
  const tool = 'flex min-h-10 items-center gap-1 rounded-lg px-3 text-[13px] font-semibold ring-1 disabled:opacity-40';

  return (
    <div role="dialog" aria-modal="true" aria-label="Working plan" className="fixed inset-0 z-50 flex flex-col bg-slate-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-brand-800">Working plan{inp ? ` · ${inp.plan.title}` : ''}</h1>
          <p className="text-[11px] text-slate-500">{changed ? `${changed} day${changed === 1 ? '' : 's'} changed, not saved` : 'No unsaved changes'}{approved ? ' · approved: saving sends it back to Draft' : ''}</p>
        </div>
        <Button className="min-h-10 px-3 text-sm" disabled={!changed || busy !== null} onClick={save}><Save className="h-4 w-4" />{busy === 'save' ? 'Saving…' : 'Save'}</Button>
        <button type="button" aria-label="Close the working plan" onClick={close} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </header>
      {err != null && <div className="px-3 pt-2"><ErrorBox error={err} /></div>}
      {!inp || !cur ? <div className="p-6"><Spinner label="Loading the plan and its check…" /></div> : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 lg:flex-row">
          <section aria-label="Days" className="min-w-0 flex-[3] rounded-xl bg-white p-2 ring-1 ring-slate-200">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <button type="button" className={cx(tool, 'bg-white text-slate-700 ring-slate-300')} disabled={!past.length} onClick={undo}><Undo2 className="h-4 w-4" />Undo</button>
              <button type="button" className={cx(tool, 'bg-white text-slate-700 ring-slate-300')} disabled={!future.length} onClick={redo}><Redo2 className="h-4 w-4" />Redo</button>
              <span className="mx-1 h-6 w-px bg-slate-200" />
              <button type="button" className={cx(tool, 'bg-amber-300 text-amber-950 ring-amber-400')} onClick={() => paint('W12')}>Work 12 h</button>
              <button type="button" className={cx(tool, 'bg-amber-100 text-amber-900 ring-amber-300')} onClick={() => paint('W8')}>Work 8 h</button>
              <button type="button" className={cx(tool, 'bg-white text-slate-700 ring-slate-300')} onClick={() => paint('O')}>Off</button>
              <button type="button" className={cx(tool, 'bg-slate-200 text-slate-800 ring-slate-300')} onClick={() => paint('U')}>Unavailable</button>
              <span className="mx-1 h-6 w-px bg-slate-200" />
              <button type="button" className={cx(tool, mode === 'move' ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-brand-700 ring-brand-300')} onClick={() => (mode === 'move' ? setMode(null) : startMode('move'))}><ArrowLeftRight className="h-4 w-4" />Move day off</button>
              <button type="button" className={cx(tool, mode === 'swap' ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-brand-700 ring-brand-300')} onClick={() => (mode === 'swap' ? setMode(null) : startMode('swap'))}><ArrowLeftRight className="h-4 w-4" />Swap with…</button>
              <button type="button" className={cx(tool, 'bg-white text-slate-700 ring-slate-300')} disabled={!sel} onClick={unlock}><Unlock className="h-4 w-4" />Unlock</button>
              <button type="button" className={cx(tool, 'bg-brand-50 text-brand-800 ring-brand-300')} disabled={busy !== null} onClick={regenerate}><Wand2 className="h-4 w-4" />{busy === 'plan' ? 'Planning…' : 'Plan the unlocked days'}</button>
              {busy === 'check' && <span className="text-[11px] text-slate-500">Checking…</span>}
            </div>
            <div className="overflow-auto rounded-lg ring-1 ring-slate-200">
              <table className="border-separate border-spacing-0 text-[12px]">
                <thead className="sticky top-0 z-20 bg-slate-50">
                  <tr>
                    <th scope="col" className="sticky left-0 z-30 min-w-44 bg-slate-50 px-2 py-1 text-left font-semibold text-slate-600">Person</th>
                    {dates.map((d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return <th key={d} scope="col" className={cx('min-w-10 px-0.5 py-1 text-center font-semibold', w === 5 || w === 6 ? 'text-amber-800' : 'text-slate-700')}><span className="block text-[10px] font-normal text-slate-500">{WD[w]}</span>{Number(d.slice(8))}{d.slice(8) === '01' || d === dates[0] ? <span className="block text-[9px] font-normal text-slate-500">{fmtDay(d).split(' ')[1]}</span> : null}</th>; })}
                    <th scope="col" className="sticky right-0 z-30 min-w-36 bg-slate-50 px-2 py-1 text-left font-semibold text-slate-600">Overtime · month</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ team, members }) => {
                    const night = team.shiftCode === 'N';
                    return [
                      <tr key={`h-${team.id}`}><th colSpan={dates.length + 2} scope="colgroup" className={cx('sticky left-0 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide', night ? 'bg-blue-900 text-white' : 'bg-amber-100 text-amber-900')}>{team.name} team · {team.hoursLabel ?? (night ? '19:00 – 07:00' : '07:00 – 19:00')}</th></tr>,
                      ...members.map((m: SdMember) => {
                        const ot = check!.overtime.find((o) => o.employeeId === m.employeeId);
                        return (
                          <tr key={m.id} className={sel?.memberId === m.id ? 'bg-orange-50' : ''}>
                            <th scope="row" className="sticky left-0 z-10 border-b border-slate-100 bg-white px-2 py-0.5 text-left font-medium">
                              <span className="block truncate text-[12px] text-slate-900">{name(m.employeeId)}</span>
                              <span className="block text-[10px] font-normal text-slate-500">{SLOT_LABEL[m.slot] ?? m.slot}</span>
                            </th>
                            {dates.map((d) => {
                              const v = cellOf(inp, m, d, cur.days, cur.marks);
                              const lk = !!cur.marks[markKey(m.id, d)]?.locked;
                              const picked = sel?.memberId === m.id && d >= sel.a && d <= sel.b;
                              return (
                                <td key={d} className="border-b border-slate-100 p-0.5">
                                  <button type="button" disabled={v === 'X'} onClick={() => tap(m.id, d)} aria-pressed={picked}
                                    aria-label={`${name(m.employeeId)}, ${fmtDay(d)}: ${v === 'W12' || v === 'W8' ? `${night ? 'night' : 'day'} ${cellText(v)} h` : v === 'O' ? 'off' : v === 'U' ? 'unavailable' : v === 'L' ? 'leave' : 'not on the team'}${lk ? ', locked' : ''}`}
                                    className={cx('relative h-9 w-9 rounded-md font-mono text-[12px] font-semibold', cellClass(v, night), picked && 'outline outline-3 -outline-offset-1 outline-orange-600')}>
                                    {cellText(v)}{lk && <Lock aria-hidden="true" className="absolute right-0.5 top-0.5 h-2.5 w-2.5 opacity-70" />}
                                  </button>
                                </td>
                              );
                            })}
                            <td className="sticky right-0 z-10 border-b border-slate-100 bg-white px-2 py-0.5">
                              <span className="flex flex-wrap gap-1">
                                {(ot?.months ?? []).map((mo) => <span key={mo.key} className={cx('rounded px-1 font-mono text-[11px] font-semibold', mo.state === 'over' ? 'bg-red-100 text-red-800' : mo.total > (inp.plan.maxOvertime ?? 72) ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700')}>{fmtDay(`${mo.key}-01`).split(' ')[1]} {mo.total}</span>)}
                              </span>
                            </td>
                          </tr>
                        );
                      }),
                      <tr key={`c-${team.id}`} className="bg-slate-50">
                        <th scope="row" className="sticky left-0 z-10 bg-slate-50 px-2 py-0.5 text-left text-[10px] font-semibold text-slate-600">Team minimum</th>
                        {dates.map((d) => {
                          const gaps = check!.gaps.filter((g) => g.teamId === team.id && g.date === d);
                          const on = members.filter((m) => { const v = cellOf(inp, m, d, cur.days, cur.marks); return v === 'W12' || v === 'W8'; }).length;
                          return <td key={d} className="p-0.5"><span title={gaps.length ? gaps.map((g) => `${g.label}: ${g.have} of ${g.need} ${g.from}–${g.to}`).join('\n') : 'Minimum held'} className={cx('flex h-6 w-9 items-center justify-center rounded font-mono text-[10px] font-semibold', gaps.length ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800')}>{gaps.length ? `!${on}` : on}</span></td>;
                        })}
                        <td className="sticky right-0 bg-slate-50" />
                      </tr>
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
              <span><b className="rounded bg-amber-300 px-1 text-amber-950">12</b> day 12 h</span><span><b className="rounded bg-amber-100 px-1 text-amber-900">8</b> day 8 h</span>
              <span><b className="rounded bg-blue-900 px-1 text-white">12</b> night 12 h</span><span><b className="rounded bg-blue-300 px-1 text-blue-950">8</b> night 8 h</span>
              <span><b className="rounded px-1 ring-1 ring-slate-300">–</b> off</span><span><b className="rounded bg-slate-200 px-1">U</b> unavailable (a day off)</span>
              <span><b className="rounded bg-violet-300 px-1 text-violet-950">L</b> approved leave (from the leave records)</span><span><Lock className="inline h-3 w-3" /> set by hand</span>
              <span>Team minimum: people on duty; <b className="text-red-800">!</b> = short (details on hover)</span>
            </p>
          </section>
          <aside aria-label="Check" className="flex min-w-0 flex-1 flex-col gap-2 lg:max-w-sm">
            <div className={cx('rounded-xl p-3 ring-1', tone)}>
              <p className="text-sm font-semibold text-slate-900">{msg.title}</p>
              {msg.text && <p className="mt-0.5 text-xs text-slate-700">{msg.text}</p>}
              {msg.problems && <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-red-900">{msg.problems.slice(0, 5).map((p, i) => <li key={i}>{p.message}</li>)}</ul>}
              {msg.options && (msg.options.length
                ? <div className="mt-2 space-y-1"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Changes that pass</p>{msg.options.map((o, i) => <button key={i} type="button" onClick={() => attempt(o.edits, o.label)} className="block min-h-10 w-full rounded-lg bg-white px-3 py-2 text-left text-xs font-semibold text-brand-800 ring-1 ring-brand-300">{o.label}</button>)}</div>
                : <p className="mt-2 text-[11px] text-slate-600">No nearby day or swap passes. Try another day, or another person.</p>)}
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Plan check now</p>
              <p className={cx('mt-1 text-sm font-semibold', blocks.length ? 'text-status-red' : 'text-status-green')}>{blocks.length ? `${blocks.length} problem${blocks.length === 1 ? ' stops' : 's stop'} the plan` : 'Nothing stops the plan'}{warns.length ? ` · ${warns.length} warning${warns.length === 1 ? '' : 's'}` : ''}</p>
              {blocks.length > 0 && <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-4 text-xs text-slate-700">{blocks.slice(0, 12).map((p, i) => <li key={i}>{p.message}</li>)}</ul>}
              {warns.length > 0 && <details className="mt-1 text-xs text-slate-700"><summary className="cursor-pointer font-medium">Warnings</summary><ul className="mt-1 list-disc space-y-0.5 pl-4">{warns.slice(0, 20).map((p, i) => <li key={i}>{p.message}</li>)}</ul></details>}
              <p className="mt-2 text-[11px] text-slate-500">Overtime spread on this plan: highest {check!.spread.max} h, lowest {check!.spread.min} h (difference {check!.spread.diff} h).</p>
            </div>
            <p className="px-1 text-[11px] text-slate-500">Day or night comes from the team. To work a person on the other shift, move him to that team on the plan. The exports (duty schedule, overtime sheet, Excel, shift instructions) read the saved days.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
