import { Check, ChevronLeft, ChevronRight, Sun } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MONTH_NAMES, monthEnd, monthStart, shiftMonth } from '@/core/calendar';
import { CONTROLLER_LEAVE_RULES, checkControllerLeave, isControllerRole, type ExtraLeave, type LeaveApproval, type Overlap } from '@/core/controllers/leaveRules';
import { evaluateRange, isDayDutyWorkday, type MpPerson } from '@/core/manpower';
import { CREWS, type Crew } from '@/core/roster';
import { approveLeaveException, fetchLeaveApprovals, withdrawLeaveApproval } from '@/data/controllers';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import type { UserProfile } from '@/data/types';
import { BottomSheet, Button, Card, ErrorBox, Field, PageHeader, Spinner, cx } from '@/ui/components';
import { CREW_IDENTITY, CrewBadge } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';

const pad = (n: number) => String(n).padStart(2, '0');
const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
const ORDER: Record<string, number> = { controller: 0, vr_controller: 1, morning_controller: 2 };
type Cell = { kind: 'leave'; code: string; clash: boolean; approved: boolean } | { kind: 'cover'; crew: Crew } | { kind: 'morning' } | { kind: 'shift'; state: string } | { kind: 'free' } | { kind: 'off' };
type Pending = { kind: 'overlap'; o: Overlap } | { kind: 'extra'; x: ExtraLeave } | { kind: 'withdraw'; a: LeaveApproval; what: string };

/** One calendar for the Controllers only: each crew's Controller cover, each Controller's day, the Morning post, and the leave rules. */
export default function ControllersBoardPage({ profile }: { profile: UserProfile }) {
  const today = localToday();
  const y0 = Number(today.slice(0, 4));
  const [params, setParams] = useSearchParams();
  const mm = /^(\d{4})-(\d{2})$/.exec(params.get('month') ?? '');
  const [year, month] = mm && Number(mm[1]) >= y0 && Number(mm[1]) <= y0 + 1 ? [Number(mm[1]), Number(mm[2])] : [y0, Number(today.slice(5, 7))];
  const go = (y: number, m: number) => setParams(`${y}-${pad(m)}` === today.slice(0, 7) ? {} : { month: `${y}-${pad(m)}` }, { replace: true });
  const isHead = profile.role_code === 'section_head';

  const [inputs, setInputs] = useState<ManpowerInputs | null>(null);
  const [approvals, setApprovals] = useState<LeaveApproval[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [history, setHistory] = useState(false);
  const load = useCallback(() => Promise.all([fetchManpowerInputs(`${y0}-01-01`, `${y0 + 1}-12-31`), fetchLeaveApprovals()])
    .then(([i, a]) => { setInputs(i); setApprovals(a); }).catch(setError), [y0]);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => {
    if (!inputs) return null;
    const from = monthStart(year, month), to = monthEnd(year, month);
    const days = evaluateRange(from, to, inputs.people, inputs.absences, inputs.rules, inputs.assignments);
    const ctl = inputs.people.filter((p) => isControllerRole(p.role))
      .sort((a, b) => (ORDER[a.role!] - ORDER[b.role!]) || (a.crew ?? 'Z').localeCompare(b.crew ?? 'Z') || a.name.localeCompare(b.name));
    const check = checkControllerLeave(inputs.people, inputs.absences, approvals, [y0, y0 + 1]);
    const clash = new Map<string, boolean>();   // `${id}|${date}` → approved?
    for (const o of check.overlaps) for (const d of dates(o.start, o.end)) for (const id of [o.a.employeeId, o.b.employeeId]) {
      const k = `${id}|${d}`; clash.set(k, (clash.get(k) ?? true) && !!o.approval);
    }
    const counted = inputs.absences.filter((a) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false);
    const cell = (p: MpPerson, d: string, crews: (typeof days)[number]['crews']): Cell => {
      const lv = counted.find((a) => a.employeeId === p.id && a.start <= d && d <= a.end);
      if (lv) { const k = clash.get(`${p.id}|${d}`); return { kind: 'leave', code: lv.typeShort ?? 'L', clash: k !== undefined, approved: k === true }; }
      const as = inputs.assignments.find((a) => a.employeeId === p.id && a.start <= d && d <= a.end);
      if (as) return as.kind === 'shift_cover' && as.crew ? { kind: 'cover', crew: as.crew } : { kind: 'morning' };
      if (p.crew) { const c = crews.find((x) => x.crew === p.crew); return c?.working ? { kind: 'shift', state: c.state } : { kind: 'off' }; }
      return p.role === 'vr_controller' ? { kind: 'free' } : { kind: 'off' };
    };
    const grid = days.map((d) => ({
      date: d.date,
      crews: Object.fromEntries(CREWS.map((c) => { const x = d.crews.find((k) => k.crew === c)!; return [c, x.working ? { state: x.state, ok: x.controller.finding !== 'coverage_required' && x.controller.finding !== 'shortage' } : null]; })) as Record<Crew, { state: string; ok: boolean } | null>,
      people: Object.fromEntries(ctl.map((p) => [p.id, cell(p, d.date, d.crews)])) as Record<string, Cell>,
      morning: d.morningPost.status === 'held' ? 'held' : isDayDutyWorkday(d.date) ? 'empty' : 'rest'
    }));
    const inMonth = (s: string, e: string) => s <= to && e >= from;
    const tiles = {
      cover: grid.reduce((n, g) => n + CREWS.filter((c) => g.crews[c] && !g.crews[c]!.ok).length, 0),
      together: new Set(check.overlaps.filter((o) => !o.approval && inMonth(o.start, o.end)).flatMap((o) => dates(o.start, o.end).filter((d) => d >= from && d <= to))).size,
      morning: grid.filter((g) => g.morning === 'empty').length,
      vrFree: grid.reduce((n, g) => n + ctl.filter((p) => g.people[p.id].kind === 'free').length, 0)
    };
    // first names, or the last name where two Controllers share a first name (two "Abdullah" VRs)
    const first = (n: string) => n.split(' ')[0];
    const short = new Map(ctl.map((p) => [p.id, ctl.filter((q) => first(q.name) === first(p.name)).length > 1 ? p.name.split(' ').slice(-1)[0] : first(p.name)]));
    return { grid, ctl, check, tiles, short, name: new Map(inputs.people.map((p) => [p.id, p.name])) };
  }, [inputs, approvals, year, month, y0]);

  // keep today (or the 1st) in view when the month opens
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current; if (!el || !view) return;
    const d = today.slice(0, 7) === `${year}-${pad(month)}` ? Number(today.slice(8)) : 1;
    el.scrollLeft = Math.max(0, (d - 4) * 26);
  }, [view, year, month, today]);

  const [py, pm] = shiftMonth(year, month, -1), [ny, nm] = shiftMonth(year, month, 1);
  const upcoming = view?.check.overlaps.filter((o) => o.end >= today) ?? [];
  const past = view?.check.overlaps.filter((o) => o.end < today) ?? [];
  const extras = view?.check.people.flatMap((p) => p.years.flatMap((y) => y.extras)).filter((x) => x.period.end >= today) ?? [];

  return (
    <div>
      <PageHeader title="Controllers calendar" info={<div className="space-y-2 text-sm text-slate-700">
        <p>Only the Controllers: whether each crew has its Controller, what each Controller does every day, and the Morning post.</p>
        <p><b>Rules:</b> no two Controllers (crew or VR) on leave on the same day without the Section Head's approval; at most {CONTROLLER_LEAVE_RULES.maxLeavesPerYear} annual leaves a year each (more needs approval); at least {CONTROLLER_LEAVE_RULES.minDaysPerYear} days of annual leave a year each.</p>
        <p>Leave is never blocked: a break shows in red until approved. New dates need a new approval.</p>
      </div>} action={<Link to="/controllers" className="text-xs font-medium text-brand-700">Controllers ›</Link>} />

      <div className="mb-2 flex items-center gap-2">
        <button aria-label="Previous month" disabled={year === y0 && month === 1} onClick={() => go(py, pm)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button>
        <div className="flex-1 text-center">
          <div className="text-lg font-semibold leading-tight text-brand-800">{MONTH_NAMES[month - 1]} {year}</div>
          {today.slice(0, 7) !== `${year}-${pad(month)}` && <button onClick={() => go(y0, Number(today.slice(5, 7)))} className="text-[11px] font-medium text-brand-700">Back to this month</button>}
        </div>
        <button aria-label="Next month" disabled={year === y0 + 1 && month === 12} onClick={() => go(ny, nm)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button>
      </div>

      {error ? <ErrorBox error={error} /> : !view ? <Spinner /> : (
        <>
          <div className="mb-2 grid grid-cols-4 gap-1 text-center">
            {[{ n: view.tiles.cover, label: 'Cover needed', dot: 'bg-status-red' }, { n: view.tiles.together, label: '2 on leave', dot: 'bg-status-red' },
              { n: view.tiles.morning, label: 'Morning empty', dot: 'bg-amber-500' }, { n: view.tiles.vrFree, label: 'VR free', dot: 'bg-status-green' }].map((k) => (
              <div key={k.label} className="rounded-lg bg-white px-1 py-1 ring-1 ring-slate-200">
                <div className="flex items-center justify-center gap-1 text-base font-semibold leading-tight tabular-nums text-slate-800"><span className={cx('h-2 w-2 rounded-full', k.dot)} />{k.n}</div>
                <div className="text-[10px] leading-tight text-slate-500">{k.label}</div>
              </div>
            ))}
          </div>

          <Card className="p-0">
            <div ref={scroller} className="overflow-x-auto [scrollbar-width:thin]">
              <table className="border-separate border-spacing-[2px] text-center text-[10px] font-semibold">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white" />
                    {view.grid.map((g) => {
                      const wd = new Date(`${g.date}T00:00:00Z`).getUTCDay();
                      return <th key={g.date} className={cx('w-6 min-w-6 pb-0.5 font-medium leading-tight', wd >= 5 ? 'text-slate-400' : 'text-slate-500')}>
                        <div>{'SMTWTFS'[wd]}</div>
                        <div className={cx('mx-auto flex h-5 w-5 items-center justify-center rounded-full text-[11px]', g.date === today ? 'bg-brand-700 text-white' : 'text-slate-700')}>{Number(g.date.slice(8))}</div>
                      </th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  <Label text="Crew cover" span={view.grid.length} />
                  {CREWS.map((c) => (
                    <tr key={c}>
                      <th className="sticky left-0 z-10 bg-white pr-1 text-left"><CrewBadge crew={c} size="sm" /></th>
                      {view.grid.map((g) => { const x = g.crews[c]; return <td key={g.date} title={x ? (x.ok ? 'Controller in place' : 'Cover needed') : 'Off'}
                        className={cx('h-6 rounded', !x ? '' : x.ok ? 'bg-green-100 text-green-900' : 'bg-status-red text-white')}>{x?.state ?? ''}</td>; })}
                    </tr>
                  ))}
                  <Label text="Controllers" span={view.grid.length} />
                  {view.ctl.map((p) => (
                    <tr key={p.id}>
                      <th className="sticky left-0 z-10 max-w-24 bg-white pr-1 text-left">
                        <Link to={`/employees/${p.id}`} className="flex items-center gap-1 font-medium text-slate-800">
                          <span className="truncate text-[11px]">{view.short.get(p.id)}</span>
                          {p.crew ? <CrewBadge crew={p.crew} size="sm" /> : <span className="rounded bg-slate-100 px-1 text-[9px] text-slate-500">VR</span>}
                        </Link>
                      </th>
                      {view.grid.map((g) => <PersonCell key={g.date} c={g.people[p.id]} />)}
                    </tr>
                  ))}
                  <Label text="Morning post" span={view.grid.length} />
                  <tr>
                    <th className="sticky left-0 z-10 bg-white pr-1 text-left"><Link to="/controllers/morning" className="flex items-center gap-1 text-[11px] font-medium text-slate-800"><Sun className="h-3.5 w-3.5 text-amber-500" />Plan</Link></th>
                    {view.grid.map((g) => <td key={g.date} className={cx('h-6 rounded', g.morning === 'held' ? 'bg-amber-100 text-amber-700' : g.morning === 'empty' ? 'bg-red-200' : '')}>{g.morning === 'held' ? <Sun className="mx-auto h-3 w-3" /> : ''}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="rounded bg-slate-100 px-1 font-bold text-crew-a">M</span>own shift</span>
            <span className="flex items-center gap-1"><span className="rounded bg-crew-b px-1 font-bold text-white">B</span>covering B</span>
            <span className="flex items-center gap-1"><span className="rounded bg-yellow-100 px-1 font-bold text-yellow-900">PV</span>leave</span>
            <span className="flex items-center gap-1"><span className="rounded bg-status-red px-1 font-bold text-white">PV</span>2 on leave</span>
            <span className="flex items-center gap-1"><span className="rounded px-1 font-bold text-status-green ring-1 ring-green-400">·</span>VR free</span>
            <span className="flex items-center gap-1"><Sun className="h-3 w-3 text-amber-600" />Morning</span>
          </div>

          <Card className="mt-3 py-1.5">
            <h2 className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Two on leave together · {upcoming.filter((o) => !o.approval).length} to approve</h2>
            <div className="divide-y divide-slate-100">
              {upcoming.length === 0 ? <p className="py-2 text-sm text-slate-500">None ahead ✓</p> : upcoming.map((o) => (
                <OverlapRow key={`${o.a.ids[0]}${o.b.ids[0]}`} o={o} name={view.name} isHead={isHead}
                  onApprove={() => setPending({ kind: 'overlap', o })} onWithdraw={() => setPending({ kind: 'withdraw', a: o.approval!, what: `${view.name.get(o.a.employeeId)} + ${view.name.get(o.b.employeeId)} · ${range(o.start, o.end)}` })} />
              ))}
              {past.length > 0 && <button type="button" onClick={() => setHistory((h) => !h)} className="w-full py-2 text-left text-xs font-medium text-slate-500">{history ? 'Hide' : 'Show'} {past.length} earlier this year</button>}
              {history && past.map((o) => <OverlapRow key={`${o.a.ids[0]}${o.b.ids[0]}`} o={o} name={view.name} isHead={false} past />)}
            </div>
          </Card>

          <Card className="mt-3 py-1.5">
            <h2 className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Annual leave per year · max {CONTROLLER_LEAVE_RULES.maxLeavesPerYear} · min {CONTROLLER_LEAVE_RULES.minDaysPerYear} days</h2>
            <table className="mt-1 w-full text-sm">
              <thead><tr className="text-left text-[11px] text-slate-500"><th className="py-1 font-medium">Controller</th>{[y0, y0 + 1].map((y) => <th key={y} className="w-24 text-right font-medium">{y}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {view.check.people.map(({ person, years }) => (
                  <tr key={person.id}>
                    <td className="py-1.5"><span className="flex items-center gap-1.5"><span className="truncate">{person.name}</span>{person.crew ? <CrewBadge crew={person.crew} size="sm" /> : <span className="text-[10px] font-semibold text-slate-400">VR</span>}</span></td>
                    {years.map((y) => {
                      const over = y.count > CONTROLLER_LEAVE_RULES.maxLeavesPerYear, open = y.extras.some((x) => !x.approval);
                      return <td key={y.year} className="text-right text-xs tabular-nums">
                        <span className={cx('rounded px-1 font-semibold', over ? (open ? 'bg-status-red text-white' : 'bg-green-100 text-green-900') : 'text-slate-700')}>{y.count}/{CONTROLLER_LEAVE_RULES.maxLeavesPerYear}</span>
                        <span className={cx('ml-1', y.days < CONTROLLER_LEAVE_RULES.minDaysPerYear ? 'font-semibold text-status-amber' : 'text-slate-500')}>{y.days}d</span>
                      </td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {extras.length > 0 && <div className="mt-1 divide-y divide-slate-100 border-t border-slate-100">
              {extras.map((x) => (
                <div key={x.period.ids[0]} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{view.name.get(x.period.employeeId)} · leave {x.nth} in {x.year}</span>
                    <span className="block text-xs text-slate-500">{range(x.period.start, x.period.end)}{x.approval?.note ? ` · ${x.approval.note}` : ''}</span>
                  </span>
                  <ApproveState approval={x.approval} isHead={isHead} onApprove={() => setPending({ kind: 'extra', x })}
                    onWithdraw={() => setPending({ kind: 'withdraw', a: x.approval!, what: `${view.name.get(x.period.employeeId)} · leave ${x.nth} in ${x.year}` })} />
                </div>
              ))}
            </div>}
          </Card>
        </>
      )}

      {pending && view && <DecisionSheet p={pending} name={view.name} onClose={() => setPending(null)} onDone={() => { setPending(null); load(); }} />}
    </div>
  );
}

function dates(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${a}T00:00:00Z`); d.toISOString().slice(0, 10) <= b; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

function Label({ text, span }: { text: string; span: number }) {
  return <tr><th className="sticky left-0 z-10 bg-white pt-1.5 text-left text-[9px] font-semibold uppercase tracking-wide text-slate-400">{text}</th><td colSpan={span} /></tr>;
}

function PersonCell({ c }: { c: Cell }) {
  const base = 'h-6 rounded leading-none';
  switch (c.kind) {
    case 'leave': return <td className={cx(base, c.clash && !c.approved ? 'bg-status-red text-white' : 'bg-yellow-100 text-yellow-900', c.approved && 'ring-1 ring-green-500')} title={c.clash ? (c.approved ? 'Two on leave · approved' : 'Two on leave · needs approval') : 'On leave'}>{c.code.slice(0, 2)}</td>;
    case 'cover': return <td className={cx(base, CREW_IDENTITY[c.crew].bg, 'text-white')} title={`Covering ${c.crew} Shift`}>{c.crew}</td>;
    case 'morning': return <td className={cx(base, 'bg-amber-100 text-amber-600')} title="Morning post"><Sun className="mx-auto h-3 w-3" /></td>;
    case 'shift': return <td className={cx(base, 'bg-slate-100 text-slate-600')}>{c.state}</td>;
    case 'free': return <td className={cx(base, 'text-status-green ring-1 ring-inset ring-green-300')} title="VR free">·</td>;
    default: return <td className={base} />;
  }
}

function ApproveState({ approval, isHead, onApprove, onWithdraw }: { approval: LeaveApproval | null; isHead: boolean; onApprove: () => void; onWithdraw: () => void }) {
  if (approval) return <button type="button" disabled={!isHead} onClick={onWithdraw} className="flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-[11px] font-semibold text-green-900"><Check className="h-3 w-3" />Approved</button>;
  return isHead ? <button type="button" onClick={onApprove} className="shrink-0 rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white">Approve</button>
    : <span className="shrink-0 rounded-full bg-status-red px-2 py-1 text-[11px] font-semibold text-white">Needs approval</span>;
}

function OverlapRow({ o, name, isHead, past, onApprove, onWithdraw }: { o: Overlap; name: Map<string, string>; isHead: boolean; past?: boolean; onApprove?: () => void; onWithdraw?: () => void }) {
  return (
    <div className={cx('flex items-center gap-2 py-2', past && 'opacity-60')}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{name.get(o.a.employeeId)} + {name.get(o.b.employeeId)}</span>
        <span className="block text-xs text-slate-500">{range(o.start, o.end)} · {o.days} day{o.days === 1 ? '' : 's'}{o.approval?.note ? ` · ${o.approval.note}` : ''}</span>
      </span>
      {past ? <span className="text-[11px] text-slate-400">{o.approval ? 'Approved' : 'Past'}</span>
        : <ApproveState approval={o.approval} isHead={isHead} onApprove={onApprove!} onWithdraw={onWithdraw!} />}
    </div>
  );
}

function DecisionSheet({ p, name, onClose, onDone }: { p: Pending; name: Map<string, string>; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const what = p.kind === 'overlap' ? `${name.get(p.o.a.employeeId)} (${range(p.o.a.start, p.o.a.end)}) and ${name.get(p.o.b.employeeId)} (${range(p.o.b.start, p.o.b.end)}) on leave together ${range(p.o.start, p.o.end)}.`
    : p.kind === 'extra' ? `${name.get(p.x.period.employeeId)}: leave ${p.x.nth} in ${p.x.year}, ${range(p.x.period.start, p.x.period.end)}.` : p.what;
  async function save() {
    setBusy(true); setErr(null);
    try {
      if (p.kind === 'overlap') await approveLeaveException({ kind: 'overlap', leaveA: p.o.a.ids[0], leaveB: p.o.b.ids[0], note });
      else if (p.kind === 'extra') await approveLeaveException({ kind: 'extra_leave', leaveA: p.x.period.ids[0], leaveB: null, note });
      else await withdrawLeaveApproval(p.a.id, note.trim());
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const withdraw = p.kind === 'withdraw';
  return (
    <BottomSheet open onClose={onClose} title={withdraw ? 'Withdraw approval' : 'Approve exception'}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{what}</p>
        <Field label={withdraw ? 'Reason' : 'Note (optional)'}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={withdraw ? 'e.g. leave moved' : 'e.g. VR covers both; overtime agreed'} /></Field>
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Back</Button>
          <Button variant={withdraw ? 'danger' : 'primary'} className="flex-1" disabled={busy || (withdraw && !note.trim())} onClick={save}>{busy ? 'Saving…' : withdraw ? 'Withdraw' : 'Approve'}</Button>
        </div>
      </div>
    </BottomSheet>
  );
}
