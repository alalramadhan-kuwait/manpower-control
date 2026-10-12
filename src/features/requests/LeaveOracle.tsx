// Requests › Leave & Oracle: the leave running now or coming up, each with two separate answers: is it authorised in the
// plan (the app's own approval), and what Oracle HR says (not submitted / submitted / approved / rejected, marked by
// the Coordinator after looking in Oracle). What the Oracle request should say is worked out from the plan (first and
// last working day, days, day back). Other dates → a PV reschedule in Entry. Who has not submitted is their own choice.
// Oracle statistics (sick, AB, escort totals) are not leave cases: they are in the employee profile and Data quality.
import { CalendarClock, Check, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { personOn, type MpPerson } from '@/core/manpower';
import { daysUntil, ORACLE_LABEL, type OracleStatus } from '@/core/oracle';
import { expectedRequest } from '@/core/oracle/expected';
import { isOpenEnd } from '@/core/leave';
import { addDaysIso, CREWS, type Crew } from '@/core/roster';
import { fetchChangeCounts, fetchChangeRequests, type ChangeRequest } from '@/data/changeRequests';
import { setOracleStatus } from '@/data/leave';
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
const daysIn = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

type When = 'now' | '14' | '35' | 'later' | 'all';
const WHEN: { key: When; label: string }[] = [{ key: 'now', label: 'On leave now' }, { key: '14', label: '14 days' }, { key: '35', label: '5 weeks' }, { key: 'later', label: 'Later' }, { key: 'all', label: 'All' }];
type Status = 'open' | OracleStatus | 'any';
const STATUS: { key: Status; label: string }[] = [{ key: 'open', label: 'Not approved in Oracle' }, { key: 'submitted', label: 'Submitted' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }, { key: 'any', label: 'Any' }];
const ORACLE_TONE: Record<OracleStatus, string> = { not_submitted: 'bg-amber-50 text-amber-900 ring-amber-300', submitted: 'bg-sky-50 text-sky-900 ring-sky-300', approved: 'bg-green-50 text-green-800 ring-green-300', rejected: 'bg-red-50 text-red-800 ring-red-300' };
const RANK: OracleStatus[] = ['rejected', 'not_submitted', 'submitted', 'approved'];
interface Item { person: MpPerson; leave: MergedLeave; oracle: OracleStatus }

export function LeaveOracle() {
  const today = localToday();
  const [params, setParams] = useSearchParams();
  const when = (WHEN.find((w) => w.key === params.get('when'))?.key ?? '35') as When;
  const status = (STATUS.find((s) => s.key === params.get('st'))?.key ?? 'open') as Status;
  const c = params.get('crew'); const crew: Crew | null = isCrew(c) ? c : null;
  const [q, setQ] = useState(params.get('q') ?? '');
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  const [data, setData] = useState<{ inputs: ManpowerInputs; open: ChangeRequest[]; counts: Map<string, number> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = useCallback(() => {
    const y = Number(today.slice(0, 4));
    return Promise.all([fetchManpowerInputs(addDaysIso(today, -60), `${y + 1}-12-31`), fetchChangeRequests(), fetchChangeCounts(y)])
      .then(([inputs, reqs, counts]) => setData({ inputs, open: reqs.filter((r) => r.status === 'requested'), counts }))
      .catch(setError);
  }, [today]);
  useEffect(() => { load(); }, [load]);

  const crewOf = (p: MpPerson, d: string) => { const x = personOn(p, d); return x.dayDuty ? null : x.crew; };
  const items = useMemo(() => {
    if (!data) return [];
    const out: Item[] = [];
    for (const person of data.inputs.people)
      for (const leave of mergedLeaves(data.inputs.absences, person.id)) {
        if (leave.end < today) continue;
        const oracle = leave.records.map((r) => r.oracle ?? 'not_submitted').sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0] as OracleStatus;
        out.push({ person, leave, oracle });
      }
    return out.sort((a, b) => a.leave.start.localeCompare(b.leave.start) || a.person.name.localeCompare(b.person.name));
  }, [data, today]);
  const match = nameFilter(q);
  const list = items.filter((x) => {
    const s = x.leave.start;
    const okWhen = when === 'all' || (when === 'now' ? s <= today : when === 'later' ? s > addDaysIso(today, 35) : s <= addDaysIso(today, Number(when)));
    const okStatus = status === 'any' || (status === 'open' ? x.oracle !== 'approved' : x.oracle === status);
    return okWhen && okStatus && (!crew || crewOf(x.person, s) === crew) && match([x.person.name, x.person.arabicName, x.person.employeeNumber]);
  });

  async function mark(x: Item, s: OracleStatus) {
    const key = x.leave.records[0].id!;
    setBusy(key); setError(null); setDone(null);
    try {
      await setOracleStatus(x.leave.records.map((r) => r.id!), s);
      setDone(`${x.person.name}: ${t('Oracle')} ${t(ORACLE_LABEL[s])}`);
      await load();
    } catch (e) { setError(e); } finally { setBusy(null); }
  }

  return (
    <div className="lg:max-w-3xl">
      <div className="mb-2 flex gap-1 overflow-x-auto no-scrollbar">
        {WHEN.map((w) => <button key={w.key} type="button" aria-pressed={when === w.key} onClick={() => set('when', w.key)} className={cx('min-h-9 whitespace-nowrap rounded-full px-3 text-xs font-medium ring-1', when === w.key ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200')}>{t(w.label)}</button>)}
      </div>
      <div className="mb-2 flex gap-1 overflow-x-auto no-scrollbar">
        {STATUS.map((s) => <button key={s.key} type="button" aria-pressed={status === s.key} onClick={() => set('st', s.key)} className={cx('min-h-9 whitespace-nowrap rounded-full px-3 text-xs font-medium ring-1', status === s.key ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-slate-600 ring-slate-200')}>{t(s.label)}</button>)}
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
      {error != null && <div className="mb-2"><ErrorBox error={error} /></div>}
      {done && <p className="mb-2 flex items-center gap-1 text-sm text-status-green"><Check className="h-4 w-4" />{done}</p>}
      {!data ? (error == null && <Spinner />) : list.length === 0 ? <Card><p className="text-sm text-slate-500">{t('Nothing to check')} ✓</p></Card> : (
        <Card className="divide-y divide-slate-100 py-0">
          {list.map((x) => {
            const { person, leave } = x;
            const key = leave.records[0].id!;
            const open = isOpenEnd(leave.end);
            const exp = open ? null : expectedRequest(leave.start, leave.end, (d) => crewOf(person, d));
            const cr = crewOf(person, leave.start);
            const n = daysUntil(today, leave.start);
            const pending = data.open.find((r) => r.employee_id === person.id && r.record_ids.some((id) => leave.records.some((l) => l.id === id)));
            const count = data.counts.get(person.id) ?? 0;
            return (
              <div key={key} className="py-3">
                <div className="flex items-center gap-2">
                  {cr ? <CrewBadge crew={cr} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-600">{t('Day')}</span>}
                  <Link to={`/employees/${person.id}`} className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{person.name}</span>
                    <span className="block truncate text-xs text-slate-500">#{person.employeeNumber}{count > 0 ? ` · ${t('{n} approved changes this year', { n: count })}` : ''}</span>
                  </Link>
                  <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', n <= 0 ? 'bg-brand-50 text-brand-800' : n <= 21 ? 'bg-amber-100 text-amber-900' : 'text-slate-500')}>{n < 0 ? t('Now') : n === 0 ? t('Today') : t('in {n} d', { n })}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-green-800 ring-1 ring-green-300">{t('In the plan')}: {t('authorised')}</span>
                  <span className={cx('rounded-full px-2 py-0.5 ring-1', ORACLE_TONE[x.oracle])}>{t('Oracle')}: {t(ORACLE_LABEL[x.oracle])}</span>
                  {pending && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-800 ring-1 ring-brand-200"><CalendarClock className="me-1 inline h-3 w-3" />{t('Change waiting')}: {range(pending.new_start, pending.new_end)}</span>}
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs ring-1 ring-slate-200">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t('Plan')}</div>
                    <div className="flex items-center gap-1 font-medium text-slate-800"><LeaveCodes codes={leave.codes} />{range(leave.start, leave.end)}</div>
                    {!open && <div className="text-slate-500">{t('{n} days with rest days', { n: daysIn(leave.start, leave.end) })}</div>}
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t('In Oracle it should say')}</div>
                    {open ? <div className="text-slate-500">{t('Return not confirmed yet')}</div> : exp ? <>
                      <div className="font-medium text-slate-800">{day(exp.start)} – {day(exp.end)}</div>
                      <div className="text-slate-500">{t('{n} days · back {d}', { n: exp.days, d: day(exp.backOn) })}</div>
                    </> : <div className="text-slate-500">{t('Only rest days')}</div>}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {(['submitted', 'approved', 'rejected', 'not_submitted'] as const).map((s) => (
                    <button key={s} type="button" disabled={busy !== null || x.oracle === s} onClick={() => mark(x, s)}
                      className={cx('min-h-10 rounded-lg px-1 text-[11px] font-semibold ring-1 disabled:opacity-60', x.oracle === s ? ORACLE_TONE[s] : 'bg-white text-slate-700 ring-slate-300')}>
                      {busy === key ? '…' : t(s === 'not_submitted' ? 'Not submitted' : ORACLE_LABEL[s])}
                    </button>
                  ))}
                </div>
                {!open && !pending && x.oracle !== 'approved' && leave.records.some((r) => r.typeShort === 'PV') && (
                  <Link to={`/requests?view=entry&card=pv&emp=${person.id}&leave=${leave.start}`} className="mt-1.5 flex min-h-10 items-center justify-center gap-1 rounded-lg bg-white text-xs font-semibold text-brand-800 ring-1 ring-brand-300">
                    <CalendarClock className="h-4 w-4" />{t('Other dates in Oracle → PV reschedule')}
                  </Link>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
