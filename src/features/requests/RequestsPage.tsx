import { ChevronRight, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { REQUEST_TYPE_LABEL } from '@/core/requests';
import { fetchDirectory } from '@/data/queries';
import { fetchRequests, isOpen, type LeaveRequest } from '@/data/requests';
import type { EmployeeDirectoryRow } from '@/data/types';
import { Button, Card, EmptyState, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';
import { CrewBadge, isCrew } from '@/ui/crew';
import { shortDate } from '@/ui/leave';
import { StatusChip, dayCount } from './shared';
import { LeaveWorklist } from './LeaveWorklist';

const range = (s: string, e: string) => (s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}`);

/**
 * Requests: the leave work list (running now or starting in 30 days, with the Oracle HR decision), and the leave
 * request forms (MAB paper form: open ones first, waiting for review, then for the decision).
 */
export default function RequestsPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'forms' || params.get('tab') === 'decided' ? 'forms' : 'leave';
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <PageHeader title="Requests" info={<div className="space-y-2 text-sm text-slate-700">
        <p><b>Leave · 30 days:</b> every leave running now or starting in the next 30 days, with what the Oracle HR (EasyHR) request should say: rest days left out, days counted without Fridays, and the day back.</p>
        <p>Approve / Reject records your Oracle decision. Tap a leave to type the EasyHR dates: a match is approved as is; other dates show their effect first and update the plan. A rejected leave stays flagged until it is cancelled or rescheduled.</p>
        <p><b>Forms:</b> the MAB paper leave request form, with the overtime review and the Section Head decision.</p>
      </div>} action={view === 'leave'
        ? <Button className="min-h-10 shrink-0 px-3" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> New</Button>
        : <Link to="/requests/new"><Button className="min-h-10 shrink-0 px-3"><Plus className="h-4 w-4" /> New</Button></Link>} />
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {(['leave', 'forms'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setParams(t === 'leave' ? {} : { view: t }, { replace: true })}
            className={cx('min-h-9 rounded-lg font-medium', view === t ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{t === 'leave' ? 'Leave · 30 days' : 'Forms'}</button>
        ))}
      </div>
      {view === 'leave' ? <LeaveWorklist adding={adding} onAdded={() => setAdding(false)} /> : <Forms />}
    </div>
  );
}

function Forms() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'decided' ? 'decided' : 'open';
  const [data, setData] = useState<{ requests: LeaveRequest[]; people: Map<string, EmployeeDirectoryRow> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    Promise.all([fetchRequests(), fetchDirectory()]).then(([requests, dir]) => setData({ requests, people: new Map(dir.map((p) => [p.id, p])) })).catch(setError);
  }, []);

  const lists = useMemo(() => {
    const all = data?.requests ?? [];
    const open = all.filter(isOpen).sort((a, b) => (a.status === b.status ? a.start_date.localeCompare(b.start_date) : a.status === 'reviewed' ? -1 : 1));
    return { open, decided: all.filter((r) => !isOpen(r)) };
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
      {error ? <ErrorBox error={error} /> : !data ? <Spinner /> : shown.length === 0 ? (
        <EmptyState title={tab === 'open' ? 'No open requests' : 'Nothing decided yet'} body={tab === 'open' ? 'Tap New to enter a form.' : undefined} />
      ) : (
        <Card className="divide-y divide-slate-100 p-0">
          {shown.map((r) => {
            const p = data.people.get(r.employee_id);
            return (
              <Link key={r.id} to={`/requests/${r.id}`} className="flex items-center gap-3 px-3 py-3 active:bg-slate-50">
                {p && isCrew(p.crew_code) ? <CrewBadge crew={p.crew_code} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">DS</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{p?.display_name ?? 'Employee'}</span>
                  <span className="block truncate text-xs text-slate-500">{REQUEST_TYPE_LABEL[r.request_type]} · {range(r.start_date, r.end_date)} · {dayCount(r.start_date, r.end_date)} d{r.overtime_required ? ' · overtime required' : ''}</span>
                </span>
                <StatusChip status={r.status} />
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
