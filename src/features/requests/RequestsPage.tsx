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

const range = (s: string, e: string) => (s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}`);

/** Leave requests entered from the MAB leave request form: open ones first (waiting for review, then for the decision). */
export default function RequestsPage() {
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
      <PageHeader title="Leave requests" info="Enter the paper leave request form, record the Controller / Supervisor overtime decision, then the Section Head approves or not. The impact on the crew shows before the decision."
        action={<Link to="/requests/new"><Button className="min-h-10 shrink-0 px-3"><Plus className="h-4 w-4" /> New</Button></Link>} />
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {(['open', 'decided'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setParams(t === 'open' ? {} : { tab: t }, { replace: true })}
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
