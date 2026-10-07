import { ChevronRight, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { REQUEST_TYPE_LABEL } from '@/core/requests';
import { countOpenChangeRequests, fetchChangeRequests, isChangeOpen, type ChangeRequest } from '@/data/changeRequests';
import { fetchDirectory } from '@/data/queries';
import { countOpenRequests, fetchRequests, isOpen, type LeaveRequest } from '@/data/requests';
import type { EmployeeDirectoryRow, UserProfile } from '@/data/types';
import { Button, Card, EmptyState, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';
import { CrewBadge, isCrew } from '@/ui/crew';
import { shortDate } from '@/ui/leave';
import { StatusChip, dayCount } from './shared';
import { LeaveWorklist } from './LeaveWorklist';
import { CHANGE_LABEL, ChangeChip, ChangeRequestSheet } from './ChangeRequests';
import { ShiftChanges } from './ShiftChanges';

const range = (s: string, e: string) => (s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}`);

/**
 * Requests: the leave work list (running now or starting in 30 days, with the Oracle HR decision), and the leave
 * request forms (MAB paper form: open ones first, waiting for review, then for the decision).
 */
export default function RequestsPage({ profile }: { profile: UserProfile }) {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'shift' ? 'shift' : params.get('view') === 'forms' || params.get('tab') === 'decided' ? 'forms' : 'leave';
  const [adding, setAdding] = useState(false);
  // open requests (forms and reschedule requests) wait in the Forms tab: say so on the tab and on the Leave tab
  const [open, setOpen] = useState(0);
  useEffect(() => {
    const load = () => Promise.all([countOpenRequests(), countOpenChangeRequests()]).then(([a, b]) => setOpen(a + b)).catch(() => setOpen(0));
    load();
    window.addEventListener('requests-changed', load);
    return () => window.removeEventListener('requests-changed', load);
  }, []);
  return (
    <div>
      <PageHeader title="Requests" info={<div className="space-y-2 text-sm text-slate-700">
        <p><b>Leave · 14 days:</b> every leave running now or starting in the next 14 days, with what the Oracle HR (EasyHR) request should say: rest days left out, days counted without Fridays, and the day back.</p>
        <p>Approve (✓) / Reject (✕) records your Oracle decision; approved leave stays listed (faded), to review or edit. Tap a leave to type the EasyHR dates: a match is approved as is; other dates show their effect first and update the plan. A rejected leave stays flagged until it is cancelled or rescheduled.</p>
        <p><b>New:</b> search the employee, then add a leave by hand or make a request. A reschedule request needs the leave, the new dates and a remark; the crews' cover is checked in red first. The Section Head decides it in Forms.</p>
        <p><b>Shift changes:</b> every shift move by date: VR placements, temporary covers, permanent moves and day duty (from the last 60 days on), and the shutdown instructions (who follows another shift or takes off before joining, and when each goes back to the own shift). Tap one to open where it is kept.</p>
        <p><b>Forms:</b> the MAB paper leave request form, with the overtime review and the Section Head decision, and the reschedule requests.</p>
      </div>} action={view === 'leave'
        ? <Button className="min-h-10 shrink-0 px-3" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> New</Button>
        : view === 'shift' ? undefined : <Link to="/requests/new"><Button className="min-h-10 shrink-0 px-3"><Plus className="h-4 w-4" /> New</Button></Link>} />
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {(['leave', 'shift', 'forms'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setParams(t === 'leave' ? {} : { view: t }, { replace: true })}
            className={cx('min-h-9 rounded-lg font-medium', view === t ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{t === 'leave' ? 'Leave · 14 d' : t === 'shift' ? 'Shift changes' : <>Forms{open > 0 && <span className="ml-1.5 rounded-full bg-brand-700 px-1.5 text-[11px] font-bold text-white">{open}</span>}</>}</button>
        ))}
      </div>
      {view === 'leave' && open > 0 && (
        <button type="button" onClick={() => setParams({ view: 'forms' }, { replace: true })} className="mb-3 flex w-full items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 ring-1 ring-amber-300">
          <span><b>{open} {open === 1 ? 'request is' : 'requests are'} waiting</b> {profile.role_code === 'section_head' ? 'for your decision' : 'for the Section Head'} in Forms</span><ChevronRight className="h-4 w-4 shrink-0" />
        </button>
      )}
      {view === 'leave' ? <LeaveWorklist adding={adding} onAdded={() => setAdding(false)} isHead={profile.role_code === 'section_head'} /> : view === 'shift' ? <ShiftChanges /> : <Forms isHead={profile.role_code === 'section_head'} />}
    </div>
  );
}

function Forms({ isHead }: { isHead: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'decided' ? 'decided' : 'open';
  const [data, setData] = useState<{ requests: LeaveRequest[]; changes: ChangeRequest[]; people: Map<string, EmployeeDirectoryRow> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [change, setChange] = useState<ChangeRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => Promise.all([fetchRequests(), fetchChangeRequests(), fetchDirectory()]).then(([requests, changes, dir]) => setData({ requests, changes, people: new Map(dir.map((p) => [p.id, p])) })).catch(setError);
  useEffect(() => { load(); }, []);

  type Item = { kind: 'form'; r: LeaveRequest; at: string; start: string } | { kind: 'change'; c: ChangeRequest; at: string; start: string };
  const lists = useMemo(() => {
    const all: Item[] = [...(data?.requests ?? []).map((r) => ({ kind: 'form' as const, r, at: r.created_at, start: r.start_date })), ...(data?.changes ?? []).map((c) => ({ kind: 'change' as const, c, at: c.requested_at, start: c.new_start }))];
    const isOpenItem = (i: Item) => (i.kind === 'form' ? isOpen(i.r) : isChangeOpen(i.c));
    const open = all.filter(isOpenItem).sort((a, b) => a.start.localeCompare(b.start));
    return { open, decided: all.filter((i) => !isOpenItem(i)).sort((a, b) => b.at.localeCompare(a.at)) };
  }, [data]);
  const shown = tab === 'open' ? lists.open : lists.decided;

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {(['open', 'decided'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setParams(t === 'open' ? { view: 'forms' } : { view: 'forms', tab: t }, { replace: true })}
            className={cx('min-h-9 rounded-lg font-medium', tab === t ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>
            {t === 'open' ? `Open${data ? ` (${lists.open.length})` : ''}` : 'Decided'}
          </button>
        ))}
      </div>
      {notice && <p role="status" className="mb-2 text-sm text-status-green">{notice}</p>}
      {error ? <ErrorBox error={error} /> : !data ? <Spinner /> : shown.length === 0 ? (
        <EmptyState title={tab === 'open' ? 'No open requests' : 'Nothing decided yet'} body={tab === 'open' ? 'Tap New to enter a form.' : undefined} />
      ) : (
        <Card className="divide-y divide-slate-100 p-0">
          {shown.map((i) => {
            const id = i.kind === 'form' ? i.r.employee_id : i.c.employee_id;
            const p = data.people.get(id);
            const badge = p && isCrew(p.crew_code) ? <CrewBadge crew={p.crew_code} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">DS</span>;
            const body = (
              <>
                {badge}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{p?.display_name ?? 'Employee'}</span>
                  <span className="block truncate text-xs text-slate-500">{i.kind === 'form'
                    ? `${REQUEST_TYPE_LABEL[i.r.request_type]} · ${range(i.r.start_date, i.r.end_date)} · ${dayCount(i.r.start_date, i.r.end_date)} d${i.r.overtime_required ? ' · overtime required' : ''}`
                    : `Reschedule · now ${range(i.c.old_start, i.c.old_end)}`}</span>
                  {i.kind === 'change' && <span className="block truncate text-xs text-slate-700">Asked {range(i.c.new_start, i.c.new_end)}</span>}
                  {i.kind === 'change' && i.c.impact && (i.c.impact.short > 0 || i.c.impact.clash.length > 0) && isChangeOpen(i.c) && <span className="block truncate text-[11px] font-semibold text-status-red">{i.c.impact.short > 0 ? `Crew short ${i.c.impact.short}d` : ''}{i.c.impact.short > 0 && i.c.impact.clash.length > 0 ? ' · ' : ''}{i.c.impact.clash.length > 0 ? '2 Controllers off' : ''}</span>}
                  {i.kind === 'change' && <span className="mt-1 block"><ChangeChip status={i.c.status} /></span>}
                </span>
                {i.kind === 'form' ? <StatusChip status={i.r.status} /> : null}
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </>
            );
            return i.kind === 'form'
              ? <Link key={i.r.id} to={`/requests/${i.r.id}`} className="flex items-center gap-3 px-3 py-3 active:bg-slate-50">{body}</Link>
              : <button key={i.c.id} type="button" onClick={() => setChange(i.c)} className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-slate-50" title={CHANGE_LABEL[i.c.status]}>{body}</button>;
          })}
        </Card>
      )}
      {change && <ChangeRequestSheet req={change} name={data?.people.get(change.employee_id)?.display_name ?? 'Employee'} isHead={isHead} onClose={() => setChange(null)} onDone={(m) => { setChange(null); setNotice(m); load(); }} />}
    </div>
  );
}
