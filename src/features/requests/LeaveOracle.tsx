// Requests › Leave: the leave running now or coming up and where each stands: planned (a PV of the plan, not approved
// yet), approved by the Section Head, or unplanned (short, unpaid, emergency … recorded outside the plan; it always
// counts). A planned PV does not take the person off the crew from its first day until it is approved: the plan may have
// changed, or the person changed their mind. What the leave covers in working days and the day back are worked out
// from the plan. Only the Section Head approves.
import { Check, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { personOn, type MpPerson } from '@/core/manpower';
import { isPlanPv } from '@/core/oracle';
import { expectedRequest } from '@/core/oracle/expected';
import { isOpenEnd } from '@/core/leave';
import { addDaysIso, CREWS, type Crew } from '@/core/roster';
import { approveLeave } from '@/data/leave';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { t } from '@/i18n';
import { Card, ErrorBox, Spinner, cx } from '@/ui/components';
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
type State = 'planned' | 'approved' | 'unplanned';
const STATES: { key: State | 'all'; label: string; cls: string }[] = [
  { key: 'planned', label: 'Needs approval', cls: 'text-amber-800' }, { key: 'approved', label: 'Approved', cls: 'text-green-800' },
  { key: 'unplanned', label: 'Unplanned', cls: 'text-sky-800' }, { key: 'all', label: 'All', cls: 'text-slate-700' }];
const CHIP: Record<State, string> = { planned: 'bg-amber-100 text-amber-900', approved: 'bg-green-100 text-green-800', unplanned: 'bg-sky-100 text-sky-900' };
const CHIP_LABEL: Record<State, string> = { planned: 'Planned', approved: 'Approved', unplanned: 'Unplanned' };
interface Item { person: MpPerson; leave: MergedLeave; state: State }
const pvRecord = (r: { typeCode?: string | null }) => isPlanPv(r.typeCode);

export function LeaveOracle({ isHead, onCount }: { isHead: boolean; onCount?: (n: number) => void }) {
  const today = localToday();
  const [params, setParams] = useSearchParams();
  const when = (WHEN.find((w) => w.key === params.get('when'))?.key ?? '35') as When;
  const st = (STATES.find((s) => s.key === params.get('st'))?.key ?? 'planned') as State | 'all';
  const c = params.get('crew'); const crew: Crew | null = isCrew(c) ? c : null;
  const [q, setQ] = useState(params.get('q') ?? '');
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  const [inputs, setInputs] = useState<ManpowerInputs | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = useCallback(() => fetchManpowerInputs(addDaysIso(today, -60), `${Number(today.slice(0, 4)) + 1}-12-31`).then(setInputs).catch(setError), [today]);
  useEffect(() => { load(); }, [load]);

  const crewOf = (p: MpPerson, d: string) => { const x = personOn(p, d); return x.dayDuty ? null : x.crew; };
  const items = useMemo(() => {
    if (!inputs) return [];
    const out: Item[] = [];
    for (const person of inputs.people)
      for (const leave of mergedLeaves(inputs.absences, person.id, new Set(), true)) {
        if (leave.end < today) continue;
        const pv = leave.records.filter(pvRecord);
        out.push({ person, leave, state: !pv.length ? 'unplanned' : pv.every((r) => r.oracle === 'approved') ? 'approved' : 'planned' });
      }
    return out.sort((a, b) => a.leave.start.localeCompare(b.leave.start) || a.person.name.localeCompare(b.person.name));
  }, [inputs, today]);
  const match = nameFilter(q);
  const inWhen = items.filter((x) => {
    const s = x.leave.start;
    const okWhen = when === 'all' || (when === 'now' ? s <= today : when === 'later' ? s > addDaysIso(today, 35) : s <= addDaysIso(today, Number(when)));
    return okWhen && (!crew || crewOf(x.person, s) === crew) && match([x.person.name, x.person.arabicName, x.person.employeeNumber]);
  });
  const count = (k: State | 'all') => (k === 'all' ? inWhen.length : inWhen.filter((x) => x.state === k).length);
  const list = inWhen.filter((x) => st === 'all' || x.state === st);
  const planned = list.filter((x) => x.state === 'planned');
  const toApprove = inWhen.filter((x) => x.state === 'planned').length;
  useEffect(() => { if (inputs) onCount?.(toApprove); }, [inputs, toApprove]); // eslint-disable-line react-hooks/exhaustive-deps

  async function approve(xs: Item[], yes: boolean) {
    const ids = xs.flatMap((x) => x.leave.records.filter(pvRecord).map((r) => r.id)).filter((id): id is string => !!id);
    if (!ids.length) return;
    setBusy(xs.length === 1 ? xs[0].leave.records[0].id ?? 'one' : 'all'); setError(null); setDone(null);
    try {
      await approveLeave(ids, yes);
      setDone(xs.length === 1 ? `${xs[0].person.name}: ${yes ? t('approved') : t('back to planned')}` : t('{n} leaves approved', { n: xs.length }));
      await load();
    } catch (e) { setError(e); } finally { setBusy(null); }
  }

  return (
    <div className="lg:max-w-3xl">
      <div className="mb-2 flex gap-1 overflow-x-auto no-scrollbar">
        {WHEN.map((w) => <button key={w.key} type="button" aria-pressed={when === w.key} onClick={() => set('when', w.key)} className={cx('min-h-9 whitespace-nowrap rounded-full px-3 text-xs font-medium ring-1', when === w.key ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200')}>{t(w.label)}</button>)}
      </div>
      <div className="mb-2 flex gap-1 overflow-x-auto no-scrollbar">
        {STATES.map((s) => <button key={s.key} type="button" aria-pressed={st === s.key} onClick={() => set('st', s.key)} className={cx('min-h-9 whitespace-nowrap rounded-full px-3 text-xs font-semibold ring-1', st === s.key ? 'bg-slate-800 text-white ring-slate-800' : cx('bg-white ring-slate-200', s.cls))}>{t(s.label)} <b className="ms-0.5">{inputs ? count(s.key) : ''}</b></button>)}
      </div>
      <div className="mb-2 flex items-center gap-2">
        <label className="flex min-h-10 flex-1 items-center gap-2 rounded-xl bg-white px-3 ring-1 ring-slate-200">
          <Search className="h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Name or number')} className="w-full bg-transparent text-sm outline-none" />
          {q && <button type="button" onClick={() => setQ('')} aria-label={t('Clear')}><X className="h-4 w-4 text-slate-400" /></button>}
        </label>
        <div className="flex gap-1">
          {[null, ...CREWS].map((x) => <button key={x ?? 'all'} type="button" aria-pressed={crew === x} onClick={() => set('crew', x)} className={cx('h-10 min-w-9 rounded-lg px-2 text-xs font-semibold ring-1', crew === x ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200')}>{x ?? t('All')}</button>)}
        </div>
      </div>
      {st === 'planned' && <p className="mb-2 px-1 text-[11.5px] text-slate-500">{t('A planned PV does not count as leave from its first day until you approve it.')}</p>}
      {error != null && <div className="mb-2"><ErrorBox error={error} /></div>}
      {done && <p className="mb-2 flex items-center gap-1 text-sm text-status-green"><Check className="h-4 w-4" />{done}</p>}
      {isHead && planned.length > 1 && (
        <button type="button" disabled={busy !== null} onClick={() => approve(planned, true)} className="mb-2 min-h-10 w-full rounded-xl bg-white text-sm font-semibold text-green-800 ring-1 ring-green-300 disabled:opacity-60">
          {busy === 'all' ? '…' : `✓ ${t('Approve all shown')} (${planned.length})`}
        </button>
      )}
      {!inputs ? (error == null && <Spinner />) : list.length === 0 ? <Card><p className="text-sm text-slate-500">{t('Nothing here')} ✓</p></Card> : (
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          {list.map((x) => {
            const { person, leave } = x;
            const key = leave.records[0].id ?? `${person.id}${leave.start}`;
            const open = isOpenEnd(leave.end);
            const exp = open ? null : expectedRequest(leave.start, leave.end, (d) => crewOf(person, d));
            const cr = crewOf(person, leave.start);
            const late = x.state === 'planned' && leave.start <= today;
            return (
              <div key={key} className="border-b border-slate-100 px-3 py-1.5 last:border-b-0">
                <div className="flex items-center gap-2">
                  {cr ? <CrewBadge crew={cr} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-500 text-[9px] font-bold text-white">{person.role === 'vr_controller' ? 'VR' : t('Day')}</span>}
                  <Link to={`/employees/${person.id}`} className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-slate-900">{person.name}</Link>
                  <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px] text-slate-600" title={exp ? `${t('{n} d', { n: exp.days })} · ${t('back {d}', { d: day(exp.backOn) })}` : undefined}><LeaveCodes codes={leave.codes} />{range(leave.start, leave.end)}</span>
                  {isHead && x.state === 'planned'
                    ? <button type="button" disabled={busy !== null} onClick={() => approve([x], true)} className="min-h-8 shrink-0 rounded-lg bg-green-600 px-2.5 text-xs font-bold text-white disabled:opacity-60">{busy === key ? '…' : `✓ ${t('Approve')}`}</button>
                    : <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', CHIP[x.state])}>{t(CHIP_LABEL[x.state])}</span>}
                  {isHead && x.state === 'approved' && <button type="button" aria-label={t('Undo approval')} title={t('Undo approval')} disabled={busy !== null} onClick={() => approve([x], false)} className="h-7 w-7 shrink-0 rounded-md text-sm text-slate-400 ring-1 ring-slate-200 disabled:opacity-60">{busy === key ? '…' : '↶'}</button>}
                </div>
                {late && <p className="ps-8 text-[11px] font-medium text-red-700">{t('Started, not approved: not counted as leave')}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
