import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MONTH_NAMES } from '@/core/calendar';
import { ORACLE_LABEL, ORACLE_STATUSES, daysUntil, oracleCounts, type OracleStatus } from '@/core/oracle';
import { CREWS, type Crew } from '@/core/roster';
import { fetchOracleLeaves, setOracleStatus, type OracleRow } from '@/data/leave';
import { fetchDirectory } from '@/data/queries';
import type { EmployeeDirectoryRow } from '@/data/types';
import { Card, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';
import { CrewBadge, isCrew } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { ORACLE_DOT, ORACLE_PILL } from '@/ui/oracle';

const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}${a.slice(0, 4) !== b.slice(0, 4) ? ` ${b.slice(0, 4)}` : ''}`);

/** Upcoming leave by Oracle HR status; select one or many and mark them submitted, approved or rejected. */
export default function OracleHrPage() {
  const today = localToday();
  const [params, setParams] = useSearchParams();
  const s = params.get('s');
  const tab: OracleStatus = ORACLE_STATUSES.includes(s as OracleStatus) ? (s as OracleStatus) : 'not_submitted';
  const c = params.get('crew');
  const crew: Crew | null = isCrew(c) ? c : null;
  const go = (t: OracleStatus, cr: Crew | null) => { const n = new URLSearchParams(); if (t !== 'not_submitted') n.set('s', t); if (cr) n.set('crew', cr); setParams(n, { replace: true }); setPicked(new Set()); };

  const [rows, setRows] = useState<OracleRow[] | null>(null);
  const [people, setPeople] = useState<Map<string, EmployeeDirectoryRow>>(new Map());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = () => Promise.all([fetchOracleLeaves(today), fetchDirectory()])
    .then(([lv, dir]) => { setPeople(new Map(dir.filter((r) => r.in_unit12_scope && r.is_active).map((r) => [r.id, r]))); setRows(lv); })
    .catch(setError);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(() => (rows ?? []).filter((r) => people.has(r.employee_id) && (!crew || people.get(r.employee_id)!.crew_code === crew)), [rows, people, crew]);
  const counts = useMemo(() => oracleCounts(mine.map((r) => ({ id: r.id, employeeId: r.employee_id, start: r.start_date, end: r.end_date, oracle: r.oracle_status })), today), [mine, today]);
  const list = mine.filter((r) => r.oracle_status === tab);
  const months = useMemo(() => {
    const m = new Map<string, OracleRow[]>();
    for (const r of list) { const k = (r.start_date < today ? today : r.start_date).slice(0, 7); m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.sort((x, y) => x.start_date.localeCompare(y.start_date))] as const);
  }, [list, today]);

  const toggle = (ids: string[], on: boolean) => setPicked((p) => { const n = new Set(p); for (const id of ids) on ? n.add(id) : n.delete(id); return n; });
  async function mark(status: OracleStatus) {
    setBusy(true); setError(null); setDone(null);
    try {
      const n = await setOracleStatus([...picked], status, picked.size === 1 ? ref : undefined);
      setDone(`${n} marked ${ORACLE_LABEL[status]}`); setPicked(new Set()); setRef(''); await load();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className={cx(picked.size > 0 && 'pb-32')}>
      <PageHeader title="Oracle HR" info={<div className="space-y-2 text-sm text-slate-700">
        <p>Where each upcoming leave stands in Oracle HR. Planned leave counts for manpower whatever its Oracle status.</p>
        <p><b>Not submitted</b> → <b>Submitted</b> → <b>Approved</b>, or <b>Rejected</b> (then correct or cancel the leave in the Leave plan).</p>
        <p>Tap leaves to select them, then mark them. New dates on a future leave set it back to Not submitted.</p>
      </div>} />

      {error ? <ErrorBox error={error} /> : !rows ? <Spinner /> : (
        <>
          <div className="mb-2 grid grid-cols-4 gap-1 text-center">
            {ORACLE_STATUSES.map((k) => (
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => go(k, crew)}
                className={cx('rounded-lg bg-white px-1 py-1 ring-1', tab === k ? 'ring-2 ring-brand-700' : 'ring-slate-200')}>
                <div className="flex items-center justify-center gap-1 text-base font-semibold leading-tight tabular-nums text-slate-800"><span className={cx('h-2 w-2 rounded-full', ORACLE_DOT[k])} />{counts[k]}</div>
                <div className="text-[10px] leading-tight text-slate-500">{ORACLE_LABEL[k]}</div>
              </button>
            ))}
          </div>
          <div className="mb-2 flex gap-1">
            {[null, ...CREWS].map((x) => (
              <button key={x ?? 'all'} type="button" aria-pressed={crew === x} onClick={() => go(tab, x)}
                className={cx('rounded-full px-2.5 py-1 text-[11px] font-medium ring-1', crew === x ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200')}>{x ?? 'All'}</button>
            ))}
          </div>
          {done && <p className="mb-2 flex items-center gap-1 text-sm text-status-green"><Check className="h-4 w-4" />{done}</p>}

          {months.length === 0 ? <Card><p className="text-sm text-slate-500">{tab === 'not_submitted' || tab === 'rejected' ? 'None ✓' : 'None'}</p></Card> : months.map(([key, items]) => {
            const all = items.every((r) => picked.has(r.id));
            return (
              <Card key={key} className="mb-2 py-1.5">
                <div className="flex items-center justify-between pt-1">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{MONTH_NAMES[Number(key.slice(5)) - 1]} {key.slice(0, 4)} · {items.length}</h2>
                  <button type="button" className="text-xs font-medium text-brand-700" onClick={() => toggle(items.map((r) => r.id), !all)}>{all ? 'Clear' : 'Select all'}</button>
                </div>
                <div className="divide-y divide-slate-100">
                  {items.map((r) => {
                    const p = people.get(r.employee_id)!;
                    const on = picked.has(r.id);
                    const n = daysUntil(today, r.start_date);
                    const urgent = tab !== 'approved' && n <= 14;
                    return (
                      <button key={r.id} type="button" aria-pressed={on} onClick={() => toggle([r.id], !on)} className={cx('flex w-full items-center gap-2.5 py-2 text-left', on && 'bg-brand-50/60')}>
                        <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-md ring-1', on ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white ring-slate-300')}>{on && <Check className="h-3.5 w-3.5" />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5"><span className="truncate text-sm font-medium text-slate-900">{p.display_name}</span>{isCrew(p.crew_code) && <CrewBadge crew={p.crew_code} size="sm" />}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {r.absence_types?.short_code && <span className="mr-1 rounded bg-yellow-100 px-1 font-semibold text-yellow-900">{r.absence_types.short_code}</span>}
                            {range(r.start_date, r.end_date)}{r.oracle_ref ? ` · #${r.oracle_ref}` : ''}
                          </span>
                        </span>
                        <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', urgent ? 'bg-status-red text-white' : n <= 30 && tab !== 'approved' ? 'bg-amber-100 text-amber-900' : 'text-slate-500')}>{n === 0 ? 'Now' : `${n}d`}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </>
      )}

      {picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-30 mx-auto max-w-5xl px-4 lg:max-w-7xl sm:bottom-4 sm:pl-48">
          <div className="space-y-2 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-slate-200">
            <div className="flex items-center gap-2 text-sm">
              <span className="flex-1 font-medium text-brand-800">{picked.size} selected</span>
              {picked.size === 1 && <input className="input h-9 w-36 text-sm" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Oracle no." aria-label="Oracle request number (optional)" />}
              <button type="button" className="text-xs font-medium text-slate-500" onClick={() => setPicked(new Set())}>Clear</button>
            </div>
            <div className="flex gap-1.5">
              {ORACLE_STATUSES.filter((k) => k !== tab).map((k) => (
                <button key={k} type="button" disabled={busy} onClick={() => mark(k)} className={cx('min-h-10 flex-1 rounded-xl px-1 text-xs font-semibold disabled:opacity-50', ORACLE_PILL[k])}>{busy ? '…' : ORACLE_LABEL[k]}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
