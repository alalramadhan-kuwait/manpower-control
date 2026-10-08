// Oracle HR check: the leaves starting in the coming weeks, each with what its Oracle request should say (first and last
// working day, days, back on), next to the requests in Oracle. Matches → Approved, and the leave is done. Other dates →
// a change request (the Coordinator files it, the Section Head decides, approved changes are counted on the employee).
// Who has not submitted is their own choice: nothing chases them.
import { CalendarClock, Check, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LeaveApproval } from '@/core/controllers/leaveRules';
import { personOn, type MpPerson } from '@/core/manpower';
import { daysUntil } from '@/core/oracle';
import { expectedRequest } from '@/core/oracle/expected';
import { addDaysIso, CREWS, type Crew } from '@/core/roster';
import { fetchChangeCounts, fetchChangeRequests, type ChangeRequest } from '@/data/changeRequests';
import { fetchLeaveApprovals } from '@/data/controllers';
import { setOracleStatus } from '@/data/leave';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { Card, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';
import { CrewBadge, isCrew } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { LeaveCodes } from '@/ui/LeaveCodes';
import { ProposeSheet } from '@/features/requests/ChangeRequests';
import { mergedLeaves, type MergedLeave } from '@/features/requests/leaveTools';

/** Requests come about 21 days ahead: the list shows the leaves starting in the next five weeks. */
const WINDOW_DAYS = 35;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const day = (iso: string) => `${WD[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${shortDate(iso)}`;
const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
const daysIn = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

type View = 'soon' | 'later' | 'approved';
const VIEWS: { key: View; label: string }[] = [{ key: 'soon', label: 'Next 5 weeks' }, { key: 'later', label: 'Later' }, { key: 'approved', label: 'Approved' }];
interface Item { person: MpPerson; leave: MergedLeave; approved: boolean }

export default function OracleHrPage() {
  const today = localToday();
  const [params, setParams] = useSearchParams();
  const view: View = (['later', 'approved'] as const).find((v) => v === params.get('v')) ?? 'soon';
  const c = params.get('crew');
  const crew: Crew | null = isCrew(c) ? c : null;
  const go = (v: View, cr: Crew | null) => { const n = new URLSearchParams(); if (v !== 'soon') n.set('v', v); if (cr) n.set('crew', cr); setParams(n, { replace: true }); };

  const [data, setData] = useState<{ inputs: ManpowerInputs; approvals: LeaveApproval[]; open: ChangeRequest[]; counts: Map<string, number> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [changing, setChanging] = useState<Item | null>(null);
  const load = useCallback(() => {
    const y = Number(today.slice(0, 4));
    return Promise.all([fetchManpowerInputs(today, `${y + 1}-12-31`), fetchLeaveApprovals(), fetchChangeRequests(), fetchChangeCounts(y)])
      .then(([inputs, approvals, reqs, counts]) => setData({ inputs, approvals, open: reqs.filter((r) => r.status === 'requested'), counts }))
      .catch(setError);
  }, [today]);
  useEffect(() => { load(); }, [load]);

  const crewOf = (p: MpPerson, d: string) => { const q = personOn(p, d); return q.dayDuty ? null : q.crew; };
  const items = useMemo(() => {
    if (!data) return [];
    const out: Item[] = [];
    for (const person of data.inputs.people) {
      for (const leave of mergedLeaves(data.inputs.absences, person.id)) {
        if (leave.start < today) continue;   // a request is made before the leave starts
        out.push({ person, leave, approved: leave.records.every((r) => r.oracle === 'approved') });
      }
    }
    return out.sort((a, b) => a.leave.start.localeCompare(b.leave.start) || a.person.name.localeCompare(b.person.name));
  }, [data, today]);
  const inCrew = (x: Item) => !crew || crewOf(x.person, x.leave.start) === crew;
  const edge = addDaysIso(today, WINDOW_DAYS);
  const groups: Record<View, Item[]> = {
    soon: items.filter((x) => !x.approved && x.leave.start <= edge && inCrew(x)),
    later: items.filter((x) => !x.approved && x.leave.start > edge && inCrew(x)),
    approved: items.filter((x) => x.approved && inCrew(x)),
  };
  const list = groups[view];

  async function mark(x: Item, approved: boolean) {
    const key = x.leave.records[0].id!;
    setBusy(key); setError(null); setDone(null);
    try {
      await setOracleStatus(x.leave.records.map((r) => r.id!), approved ? 'approved' : 'not_submitted');
      setDone(approved ? `${x.person.name}: approved in Oracle` : `${x.person.name}: back in the list`);
      await load();
    } catch (e) { setError(e); } finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader title="Oracle HR" info={<div className="space-y-2 text-sm text-slate-700">
        <p>Open the requests in Oracle and compare each one with its leave here: the first and last working day, the days and the day back.</p>
        <p><b>Same dates</b> → approve it in Oracle and tap <b>Approved in Oracle</b>: the leave is done.</p>
        <p><b>Other dates</b> → the leave needs a change request first (the Coordinator sends it, the Section Head decides after the conflict check). An approved change is counted on the employee and the plan moves to the new dates.</p>
        <p>Who has not submitted is their own choice: the leave just stays in the list.</p>
      </div>} />

      {error != null && <div className="mb-2"><ErrorBox error={error} /></div>}
      {!data ? (error == null && <Spinner />) : (
        <>
          <div className="mb-2 grid grid-cols-3 gap-1 text-center">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => go(v.key, crew)}
                className={cx('rounded-lg bg-white px-1 py-1 ring-1', view === v.key ? 'ring-2 ring-brand-700' : 'ring-slate-200')}>
                <div className="text-base font-semibold leading-tight tabular-nums text-slate-800">{groups[v.key].length}</div>
                <div className="text-[10px] leading-tight text-slate-500">{v.label}</div>
              </button>
            ))}
          </div>
          <div className="mb-2 flex gap-1">
            {[null, ...CREWS].map((x) => (
              <button key={x ?? 'all'} type="button" aria-pressed={crew === x} onClick={() => go(view, x)}
                className={cx('rounded-full px-2.5 py-1 text-[11px] font-medium ring-1', crew === x ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200')}>{x ?? 'All'}</button>
            ))}
          </div>
          {done && <p className="mb-2 flex items-center gap-1 text-sm text-status-green"><Check className="h-4 w-4" />{done}</p>}

          {list.length === 0 ? <Card><p className="text-sm text-slate-500">{view === 'approved' ? 'Nothing approved yet.' : 'No leave to check ✓'}</p></Card> : (
            <Card className="divide-y divide-slate-100 py-0">
              {list.map((x) => {
                const { person, leave } = x;
                const key = leave.records[0].id!;
                const exp = expectedRequest(leave.start, leave.end, (d) => crewOf(person, d));
                const cr = crewOf(person, leave.start);
                const n = daysUntil(today, leave.start);
                const pending = data.open.find((r) => r.employee_id === person.id && r.record_ids.some((id) => leave.records.some((l) => l.id === id)));
                const count = data.counts.get(person.id) ?? 0;
                return (
                  <div key={key} className="py-2.5">
                    <div className="flex items-center gap-2">
                      {cr ? <CrewBadge crew={cr} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-600">Day</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{person.name}</span>
                        <span className="block truncate text-xs text-slate-500">#{person.employeeNumber}{count > 0 ? ` · ${count} change${count === 1 ? '' : 's'} this year` : ''}</span>
                      </span>
                      {!x.approved && <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', n <= 21 ? 'bg-amber-100 text-amber-900' : 'text-slate-500')}>{n === 0 ? 'Today' : `in ${n}d`}</span>}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs ring-1 ring-slate-200">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Plan</div>
                        <div className="flex items-center gap-1 font-medium text-slate-800"><LeaveCodes codes={leave.codes} />{range(leave.start, leave.end)}</div>
                        <div className="text-slate-500">{daysIn(leave.start, leave.end)} days with rest days</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">In Oracle it should say</div>
                        {exp ? <>
                          <div className="font-medium text-slate-800">{day(exp.start)} – {day(exp.end)}</div>
                          <div className="text-slate-500">{exp.days} days · back {day(exp.backOn)}</div>
                        </> : <div className="text-slate-500">Only rest days</div>}
                      </div>
                    </div>
                    {pending && <p className="mt-1 flex items-center gap-1 text-xs font-medium text-brand-700"><CalendarClock className="h-3.5 w-3.5" />Change requested to {range(pending.new_start, pending.new_end)} · waiting for the Section Head</p>}
                    <div className="mt-1.5 flex gap-1.5">
                      {x.approved ? (
                        <button type="button" disabled={busy !== null} onClick={() => mark(x, false)} className="flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-600 ring-1 ring-slate-300 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />{busy === key ? '…' : 'Undo'}</button>
                      ) : <>
                        <button type="button" disabled={busy !== null} onClick={() => mark(x, true)} className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-status-green px-2 text-xs font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" />{busy === key ? 'Saving…' : 'Approved in Oracle'}</button>
                        <button type="button" disabled={busy !== null || !!pending} onClick={() => setChanging(x)} className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-white px-2 text-xs font-semibold text-brand-800 ring-1 ring-brand-300 disabled:opacity-50"><CalendarClock className="h-4 w-4" />Other dates</button>
                      </>}
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}

      {changing && data && (
        <ProposeSheet person={changing.person} leave={changing.leave} inputs={data.inputs} approvals={data.approvals} today={today}
          changes={data.counts.get(changing.person.id) ?? 0} onBack={() => setChanging(null)}
          onDone={(m) => { setChanging(null); setDone(m); load(); }} />
      )}
    </div>
  );
}
