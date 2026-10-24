// Requests › Leave: the leave running now or coming up and where each stands. A PV of the plan is planned until the
// Section Head decides: approve, change the dates, send it to the Manpower Coordinator to fix the dates, or reject it
// (with a reason). Planned and rejected PVs do not take the person off the crew (from the first day; rejected never).
// Unplanned leave (UL, short, emergency …) always counts. Tap a name for the person's card (sick days, last and next
// leave, what it overlaps) before deciding. The Coordinator sees the leave to fix and gives new dates through a PV
// reschedule, which comes back to the Section Head.
import { Check, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { personOn, type MpPerson } from '@/core/manpower';
import { isPlanPv } from '@/core/oracle';
import { expectedRequest } from '@/core/oracle/expected';
import { isOpenEnd } from '@/core/leave';
import { addDaysIso, CREWS, type Crew } from '@/core/roster';
import { fetchChangeRequests, type ChangeRequest } from '@/data/changeRequests';
import { approveLeave, declineLeave, fetchLeaveDecisions, fetchSickDays, sendLeaveToFix, type LeaveDecision } from '@/data/leave';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { fetchSdPlans } from '@/data/shutdown';
import type { SdPlan } from '@/core/shutdown';
import { t } from '@/i18n';
import { BottomSheet, Card, ErrorBox, Spinner, cx } from '@/ui/components';
import { CrewBadge, isCrew } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { LeaveCodes } from '@/ui/LeaveCodes';
import { nameFilter } from '@/ui/nameSearch';
import { mergedLeaves, type MergedLeave } from './leaveTools';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const day = (iso: string) => `${t(WD[new Date(`${iso}T00:00:00Z`).getUTCDay()])} ${shortDate(iso)}`;
const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${isOpenEnd(b) ? t('return not confirmed') : shortDate(b)}`);

type When = 'now' | '14' | '35' | 'later' | 'all';
const WHEN: { key: When; label: string }[] = [{ key: 'now', label: 'On leave now' }, { key: '14', label: '14 days' }, { key: '35', label: '5 weeks' }, { key: 'later', label: 'Later' }, { key: 'all', label: 'All' }];
type State = 'planned' | 'fix' | 'approved' | 'rejected' | 'unplanned';
const STATES: { key: State | 'all'; label: string; cls: string }[] = [
  { key: 'planned', label: 'To approve', cls: 'text-amber-800' }, { key: 'fix', label: 'To fix', cls: 'text-sky-800' },
  { key: 'approved', label: 'Approved', cls: 'text-green-800' }, { key: 'rejected', label: 'Rejected', cls: 'text-slate-600' },
  { key: 'unplanned', label: 'Unplanned', cls: 'text-violet-800' }, { key: 'all', label: 'All', cls: 'text-slate-700' }];
const CHIP: Record<State, string> = { planned: 'bg-amber-100 text-amber-900', fix: 'bg-sky-100 text-sky-900', approved: 'bg-green-100 text-green-800', rejected: 'bg-slate-200 text-slate-700', unplanned: 'bg-violet-100 text-violet-900' };
const CHIP_LABEL: Record<State, string> = { planned: 'Planned', fix: 'To fix', approved: 'Approved', rejected: 'Rejected', unplanned: 'Unplanned' };
interface Item { person: MpPerson; leave: MergedLeave; state: State; decision: LeaveDecision | null; pending: ChangeRequest | null }
const pvRecord = (r: { typeCode?: string | null }) => isPlanPv(r.typeCode);
const ids = (x: Item) => x.leave.records.filter(pvRecord).map((r) => r.id).filter((id): id is string => !!id);

export function LeaveOracle({ isHead, onCount }: { isHead: boolean; onCount?: (n: number) => void }) {
  const today = localToday();
  const [params, setParams] = useSearchParams();
  const when = (WHEN.find((w) => w.key === params.get('when'))?.key ?? '35') as When;
  const st = (STATES.find((s) => s.key === params.get('st'))?.key ?? (isHead ? 'planned' : 'fix')) as State | 'all';
  const c = params.get('crew'); const crew: Crew | null = isCrew(c) ? c : null;
  const [q, setQ] = useState(params.get('q') ?? '');
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  const [data, setData] = useState<{ inputs: ManpowerInputs; decisions: Map<string, LeaveDecision>; open: ChangeRequest[]; plans: SdPlan[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [card, setCard] = useState<Item | null>(null);
  const [menu, setMenu] = useState<Item | null>(null);
  const load = useCallback(() => Promise.all([fetchManpowerInputs(addDaysIso(today, -400), `${Number(today.slice(0, 4)) + 1}-12-31`), fetchLeaveDecisions(), fetchChangeRequests().catch(() => [] as ChangeRequest[]), fetchSdPlans().catch(() => [] as SdPlan[])])
    .then(([inputs, decisions, reqs, plans]) => setData({ inputs, decisions, open: reqs.filter((r) => r.status === 'requested'), plans })).catch(setError), [today]);
  useEffect(() => { load(); }, [load]);

  const crewOf = (p: MpPerson, d: string) => { const x = personOn(p, d); return x.dayDuty ? null : x.crew; };
  const all = useMemo(() => {
    if (!data) return [] as Item[];
    const out: Item[] = [];
    for (const person of data.inputs.people)
      for (const leave of mergedLeaves(data.inputs.absences, person.id, new Set(), true)) {
        const pv = leave.records.filter(pvRecord);
        const decision = pv.map((r) => data.decisions.get(r.id ?? '')).find(Boolean) ?? null;
        const pending = data.open.find((r) => r.employee_id === person.id && r.record_ids.some((id) => leave.records.some((l) => l.id === id))) ?? null;
        const state: State = !pv.length ? 'unplanned' : pv.some((r) => r.oracle === 'rejected') ? 'rejected' : pv.every((r) => r.oracle === 'approved') ? 'approved' : decision?.fix_sent_at ? 'fix' : 'planned';
        out.push({ person, leave, state, decision, pending });
      }
    return out.sort((a, b) => a.leave.start.localeCompare(b.leave.start) || a.person.name.localeCompare(b.person.name));
  }, [data]);
  const items = all.filter((x) => x.leave.end >= today);
  const match = nameFilter(q);
  const inWhen = items.filter((x) => {
    const s = x.leave.start;
    // leave to fix is the Coordinator's to do whatever its dates
    const okWhen = when === 'all' || (st === 'fix' && x.state === 'fix') || (when === 'now' ? s <= today : when === 'later' ? s > addDaysIso(today, 35) : s <= addDaysIso(today, Number(when)));
    return okWhen && (!crew || crewOf(x.person, s) === crew) && match([x.person.name, x.person.arabicName, x.person.employeeNumber]);
  });
  const count = (k: State | 'all') => (k === 'all' ? inWhen.length : k === 'fix' ? items.filter((x) => x.state === 'fix').length : inWhen.filter((x) => x.state === k).length);
  const list = st === 'fix' ? items.filter((x) => x.state === 'fix' && (!crew || crewOf(x.person, x.leave.start) === crew) && match([x.person.name, x.person.arabicName, x.person.employeeNumber])) : inWhen.filter((x) => st === 'all' || x.state === st);
  const planned = list.filter((x) => x.state === 'planned');
  const badge = isHead ? inWhen.filter((x) => x.state === 'planned').length : count('fix');
  useEffect(() => { if (data) onCount?.(badge); }, [data, badge]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(xs: Item[], f: (ids: string[]) => Promise<unknown>, msg: string) {
    const all = xs.flatMap(ids);
    if (!all.length) return;
    setBusy(xs.length === 1 ? keyOf(xs[0]) : 'all'); setError(null); setDone(null);
    try { await f(all); setDone(msg); setMenu(null); setCard(null); await load(); } catch (e) { setError(e); } finally { setBusy(null); }
  }
  const approve = (xs: Item[]) => run(xs, (i) => approveLeave(i, true), xs.length === 1 ? `${xs[0].person.name}: ${t('approved')}` : t('{n} leaves approved', { n: xs.length }));
  const undo = (x: Item) => run([x], (i) => (x.state === 'rejected' ? declineLeave(i, false) : x.state === 'fix' ? sendLeaveToFix(i, '', false) : approveLeave(i, false)), `${x.person.name}: ${t('back to planned')}`);
  const reject = (x: Item, reason: string) => run([x], (i) => declineLeave(i, true, reason), `${x.person.name}: ${t('rejected')}`);
  const toFix = (x: Item, note: string) => run([x], (i) => sendLeaveToFix(i, note, true), `${x.person.name}: ${t('sent to the Coordinator')}`);
  const pvLink = (x: Item) => `/requests?view=entry&card=pv&emp=${x.person.id}&leave=${x.leave.start}`;

  return (
    <div className="lg:max-w-3xl">
      <div className="mb-2 flex gap-1 overflow-x-auto no-scrollbar">
        {WHEN.map((w) => <button key={w.key} type="button" aria-pressed={when === w.key} onClick={() => set('when', w.key)} className={cx('min-h-9 whitespace-nowrap rounded-full px-3 text-xs font-medium ring-1', when === w.key ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200')}>{t(w.label)}</button>)}
      </div>
      <div className="mb-2 flex gap-1 overflow-x-auto no-scrollbar">
        {STATES.map((s) => <button key={s.key} type="button" aria-pressed={st === s.key} onClick={() => set('st', s.key)} className={cx('min-h-9 whitespace-nowrap rounded-full px-3 text-xs font-semibold ring-1', st === s.key ? 'bg-slate-800 text-white ring-slate-800' : cx('bg-white ring-slate-200', s.cls))}>{t(s.label)} <b className="ms-0.5">{data ? count(s.key) : ''}</b></button>)}
      </div>
      <div className="mb-2 flex items-center gap-2">
        <label className="flex min-h-10 flex-1 items-center gap-2 rounded-xl bg-white px-3 ring-1 ring-slate-200">
          <Search className="h-4 w-4 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Name or number')} className="w-full bg-transparent text-sm outline-none" />
          {q && <button type="button" onClick={() => setQ('')} aria-label={t('Clear')}><X className="h-4 w-4 text-slate-500" /></button>}
        </label>
        <div className="flex gap-1">
          {[null, ...CREWS].map((x) => <button key={x ?? 'all'} type="button" aria-pressed={crew === x} onClick={() => set('crew', x)} className={cx('h-10 min-w-9 rounded-lg px-2 text-xs font-semibold ring-1', crew === x ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200')}>{x ?? t('All')}</button>)}
        </div>
      </div>
      {st === 'planned' && <p className="mb-2 px-1 text-[12px] text-slate-500">{t('A planned PV does not count as leave from its first day until it is approved.')}</p>}
      {error != null && <div className="mb-2"><ErrorBox error={error} /></div>}
      {done && <p className="mb-2 flex items-center gap-1 text-sm text-status-green"><Check className="h-4 w-4" />{done}</p>}
      {isHead && planned.length > 1 && (
        <button type="button" disabled={busy !== null} onClick={() => approve(planned)} className="mb-2 min-h-10 w-full rounded-xl bg-white text-sm font-semibold text-green-800 ring-1 ring-green-300 disabled:opacity-60">
          {busy === 'all' ? '…' : `✓ ${t('Approve all shown')} (${planned.length})`}
        </button>
      )}
      {!data ? (error == null && <Spinner />) : list.length === 0 ? <Card><p className="text-sm text-slate-500">{t('Nothing here')} ✓</p></Card> : (
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          {list.map((x) => {
            const { person, leave } = x;
            const key = keyOf(x);
            const cr = crewOf(person, leave.start);
            const late = (x.state === 'planned' || x.state === 'fix') && leave.start <= today;
            const decide = isHead && x.state !== 'unplanned';
            return (
              <div key={key} className={cx('border-b border-slate-100 px-3 py-2 last:border-b-0', x.state === 'rejected' && 'bg-slate-50')}>
                <div className="flex items-center gap-2">
                  {cr ? <CrewBadge crew={cr} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-500 text-[10px] font-bold text-white">{person.role === 'vr_controller' ? 'VR' : t('Day')}</span>}
                  <button type="button" onClick={() => setCard(x)} className="min-w-0 flex-1 text-start">
                    <span className="block text-[14px] font-semibold leading-tight text-slate-900">{person.name}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[12px] text-slate-600"><LeaveCodes codes={leave.codes} />{range(leave.start, leave.end)}</span>
                  </button>
                  {isHead && x.state === 'planned'
                    ? <button type="button" disabled={busy !== null} onClick={() => approve([x])} className="min-h-9 shrink-0 rounded-lg bg-green-600 px-3 text-xs font-bold text-white disabled:opacity-60">{busy === key ? '…' : `✓ ${t('Approve')}`}</button>
                    : !isHead && x.state === 'fix'
                      ? <Link to={pvLink(x)} className="flex min-h-9 shrink-0 items-center rounded-lg bg-brand-700 px-3 text-xs font-bold text-white">📅 {t('New dates')}</Link>
                      : <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', CHIP[x.state])}>{t(CHIP_LABEL[x.state])}</span>}
                  {decide && <button type="button" aria-label={t('More')} disabled={busy !== null} onClick={() => setMenu(x)} className="h-9 w-9 shrink-0 rounded-lg text-base font-bold text-slate-500 ring-1 ring-slate-300 disabled:opacity-60">⋯</button>}
                </div>
                {x.state === 'fix' && <p className="mt-0.5 ps-8 text-[12px] text-sky-800">{t('To Coordinator')}{x.decision?.fix_note ? `: “${x.decision.fix_note}”` : ''}</p>}
                {x.state === 'rejected' && x.decision?.declined_reason && <p className="mt-0.5 ps-8 text-[12px] text-slate-500">{x.decision.declined_reason}</p>}
                {x.pending && <p className="mt-0.5 ps-8 text-[12px] font-medium text-brand-700">{t('New dates sent')}: {range(x.pending.new_start, x.pending.new_end)} · {t('in Approvals')}</p>}
                {late && !x.pending && <p className="mt-0.5 ps-8 text-[12px] font-medium text-red-700">{t('Started, not approved: not counted as leave')}</p>}
              </div>
            );
          })}
        </div>
      )}
      {card && data && <PersonCard x={card} all={all} plans={data.plans} today={today} isHead={isHead} busy={busy} onApprove={() => approve([card])} onMore={() => { setMenu(card); setCard(null); }} onClose={() => setCard(null)} crewOf={crewOf} />}
      {menu && <DecideSheet x={menu} busy={busy} pvLink={pvLink(menu)} onUndo={() => undo(menu)} onReject={(r) => reject(menu, r)} onFix={(n) => toFix(menu, n)} onClose={() => setMenu(null)} />}
    </div>
  );
}
const keyOf = (x: Item) => x.leave.records[0].id ?? `${x.person.id}${x.leave.start}`;

/** The person at a glance before deciding: this leave, sick days, last and next leave, what it overlaps. */
function PersonCard({ x, all, plans, today, isHead, busy, onApprove, onMore, onClose, crewOf }: { x: Item; all: Item[]; plans: SdPlan[]; today: string; isHead: boolean; busy: string | null; onApprove: () => void; onMore: () => void; onClose: () => void; crewOf: (p: MpPerson, d: string) => Crew | null }) {
  const { person, leave } = x;
  const [sick, setSick] = useState<{ year: number; days: number; asOf: string | null }[] | null>(null);
  useEffect(() => { fetchSickDays(person.id).then(setSick).catch(() => setSick([])); }, [person.id]);
  const mine = all.filter((y) => y.person.id === person.id && y.state !== 'rejected');
  const last = [...mine].reverse().find((y) => y.leave.end < leave.start && y.leave.end < today);
  const next = mine.find((y) => y.leave.start > leave.end);
  const overlaps = plans.filter((p) => p.start <= leave.end && leave.start <= p.end);
  const exp = isOpenEnd(leave.end) ? null : expectedRequest(leave.start, leave.end, (d) => crewOf(person, d));
  const y = Number(today.slice(0, 4));
  const now = sick?.find((s) => s.year === y), before = sick?.find((s) => s.year === y - 1);
  const ROLE: Record<string, string> = { field_operator: 'Field operator', panel_operator: 'Panel operator', controller: 'Controller', vr_controller: 'VR Controller', morning_controller: 'Morning Controller' };
  const cr = crewOf(person, leave.start);
  const line = (label: string, value: React.ReactNode, cls = '') => <div className={cx('flex items-baseline gap-2 border-b border-slate-100 px-3 py-2 text-[13px] last:border-b-0', cls)}><span className="w-24 shrink-0 text-slate-500">{t(label)}</span><span className="min-w-0 flex-1">{value}</span></div>;
  return (
    <BottomSheet open onClose={onClose} title={person.name}>
      <p className="-mt-1 mb-2 text-xs text-slate-500">{[ROLE[person.role ?? ''] ?? person.role, person.grade != null ? `G${person.grade}` : null, cr ? `${cr} Shift` : null, person.employeeNumber ? `#${person.employeeNumber}` : null].filter(Boolean).join(' · ')}</p>
      <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
        {line('This leave', <span className="flex flex-wrap items-center gap-1.5"><b>{leave.codes.join(' + ')} {range(leave.start, leave.end)}</b><span className={cx('rounded-md px-1.5 text-[11px] font-bold', CHIP[x.state])}>{t(CHIP_LABEL[x.state])}</span>{exp && <span className="text-xs text-slate-500">{t('{n} d', { n: exp.days })} · {t('back {d}', { d: day(exp.backOn) })}</span>}</span>)}
        {line('Sick', sick == null ? '…' : now || before ? <span><b className={cx((now?.days ?? 0) >= 20 && 'text-orange-700')}>{now ? `${now.days} d in ${now.year}` : `— in ${y}`}</b>{before ? <span className="text-xs text-slate-500"> · {before.year}: {before.days} d</span> : null}</span> : <span className="text-slate-500">{t('No record')}</span>, (now?.days ?? 0) >= 20 ? 'bg-orange-50' : '')}
        {line('Last leave', last ? `${last.leave.codes.join(' + ')} ${range(last.leave.start, last.leave.end)}` : <span className="text-slate-500">{t('None on record')}</span>)}
        {line('Next leave', next ? `${next.leave.codes.join(' + ')} ${range(next.leave.start, next.leave.end)}` : <span className="text-slate-500">{t('None planned')}</span>)}
        {overlaps.length > 0 && line('Overlaps', overlaps.map((p) => `${p.title} (${shortDate(p.start)} – ${shortDate(p.end)})`).join(' · '))}
      </div>
      {isHead && x.state !== 'unplanned' && (
        <div className="mt-3 flex gap-2">
          {x.state !== 'approved' && <button type="button" disabled={busy !== null} onClick={onApprove} className="min-h-11 flex-1 rounded-xl bg-green-600 text-sm font-bold text-white disabled:opacity-60">✓ {t('Approve')}</button>}
          <button type="button" onClick={onMore} className={cx('min-h-11 rounded-xl text-base font-bold text-slate-600 ring-1 ring-slate-300', x.state === 'approved' ? 'flex-1' : 'w-14')}>⋯</button>
        </div>
      )}
      <Link to={`/employees/${person.id}`} className="mt-3 block py-1 text-center text-sm font-semibold text-brand-700">{t('Full profile')} ›</Link>
    </BottomSheet>
  );
}

/** The other decisions on a planned PV: change the dates, send to the Coordinator, reject, or undo a decision. */
function DecideSheet({ x, busy, pvLink, onUndo, onReject, onFix, onClose }: { x: Item; busy: string | null; pvLink: string; onUndo: () => void; onReject: (reason: string) => void; onFix: (note: string) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'menu' | 'fix' | 'reject'>('menu');
  const [text, setText] = useState('');
  const opt = 'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start ring-1 ring-slate-200 disabled:opacity-40';
  const decided = x.state === 'approved' || x.state === 'rejected' || x.state === 'fix';
  return (
    <BottomSheet open onClose={onClose} title={x.person.name}>
      <p className="-mt-1 mb-2 text-xs text-slate-500">{x.leave.codes.join(' + ')} {range(x.leave.start, x.leave.end)} · {t(CHIP_LABEL[x.state])}</p>
      {mode === 'menu' ? (
        <div className="space-y-2">
          <Link to={pvLink} className={opt}><span className="text-xl">📅</span><b className="text-sm">{t('Change dates')}</b></Link>
          <button type="button" disabled={busy !== null} onClick={() => { setText(x.decision?.fix_note ?? ''); setMode('fix'); }} className={cx(opt, 'bg-sky-50 ring-sky-200')}><span className="text-xl">📨</span><span><b className="block text-sm text-sky-900">{t('Send to Coordinator')}</b><span className="text-xs text-slate-500">{t('To fix the dates')}</span></span></button>
          <button type="button" disabled={busy !== null || x.state === 'rejected'} onClick={() => { setText(''); setMode('reject'); }} className={opt}><span className="text-xl">✕</span><b className="text-sm text-red-700">{t('Reject')}</b></button>
          <button type="button" disabled={busy !== null || !decided} onClick={onUndo} className={opt}><span className="text-xl">↶</span><b className="text-sm">{t('Undo')}</b></button>
        </div>
      ) : (
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t(mode === 'fix' ? 'Note' : 'Reason (optional)')}</label>
          <textarea autoFocus className="input mt-1 min-h-16 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'fix' ? t('e.g. after 17 Nov') : t('e.g. shutdown')} />
          <button type="button" disabled={busy !== null} onClick={() => (mode === 'fix' ? onFix(text) : onReject(text))} className={cx('mt-3 min-h-11 w-full rounded-xl text-sm font-bold text-white disabled:opacity-60', mode === 'fix' ? 'bg-brand-700' : 'bg-red-600')}>{busy ? '…' : t(mode === 'fix' ? 'Send' : 'Reject')}</button>
          <button type="button" onClick={() => setMode('menu')} className="mt-1 min-h-10 w-full text-sm font-semibold text-slate-500">{t('Back')}</button>
        </div>
      )}
    </BottomSheet>
  );
}
