import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { UserProfile } from '@/data/types';
import { countPendingApprovals } from '@/data/approvals';
import { t } from '@/i18n';
import { PageHeader, cx } from '@/ui/components';
import { Approvals } from './Approvals';
import { EntryPage } from './EntryPage';
import { LeaveOracle } from './LeaveOracle';
import { ShiftChanges } from './ShiftChanges';

type View = 'entry' | 'approvals' | 'leave' | 'moves';
const VIEWS: { key: View; label: string }[] = [{ key: 'entry', label: 'Entry' }, { key: 'approvals', label: 'Approvals' }, { key: 'leave', label: 'Leave' }, { key: 'moves', label: 'Shift movements' }];

/**
 * Requests: Entry (the one place to add or change anything for a person), Approvals (the Section Head's inbox), Leave
 * (planned, approved by the Section Head, or unplanned) and Shift movements (read-only list).
 */
export default function RequestsPage({ profile }: { profile: UserProfile }) {
  const [params, setParams] = useSearchParams();
  const isHead = profile.role_code === 'section_head';
  const v = params.get('view');
  const view: View = VIEWS.some((x) => x.key === v) ? (v as View) : params.get('q') ? 'leave' : isHead ? 'approvals' : 'entry';
  const [open, setOpen] = useState(0);
  useEffect(() => {
    const load = () => countPendingApprovals().then(setOpen).catch(() => setOpen(0));
    load();
    window.addEventListener('requests-changed', load);
    return () => window.removeEventListener('requests-changed', load);
  }, []);
  return (
    <div>
      <PageHeader title="Requests" info={<div className="space-y-2 text-sm text-slate-700">
        <p><b>{t('Entry')}:</b> {t('pick the person, then the action: Leave / Absence, PV reschedule, Shift change / cover, Controller assignment or Task release. The crews are checked on the server before anything is recorded or sent.')}</p>
        <p><b>{t('Approvals')}:</b> {t('everything waiting for the Section Head, with the effect on the crews. The Section Head’s own entries are recorded directly and never wait here.')}</p>
        <p><b>{t('Leave')}:</b> {t('leave now and coming up: planned, approved or unplanned. A planned PV counts as leave only once the Section Head approves it.')}</p>
        <p><b>{t('Shift movements')}:</b> {t('every cover, move, day duty and VR placement, read only. Changes are made in Entry.')}</p>
      </div>} />
      <div role="tablist" className="no-scrollbar mb-3 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 text-sm lg:max-w-3xl">
        {VIEWS.map((x) => (
          <button key={x.key} role="tab" type="button" aria-selected={view === x.key} onClick={() => setParams({ view: x.key }, { replace: true })}
            className={cx('min-h-10 flex-1 whitespace-nowrap rounded-lg px-3 font-medium', view === x.key ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>
            {t(x.label)}{x.key === 'approvals' && open > 0 && <span className="ms-1.5 rounded-full bg-brand-700 px-1.5 text-[11px] font-bold text-white">{open}</span>}
          </button>
        ))}
      </div>
      {view !== 'approvals' && open > 0 && isHead && (
        <button type="button" onClick={() => setParams({ view: 'approvals' }, { replace: true })} className="mb-3 flex w-full items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-start text-sm text-amber-900 ring-1 ring-amber-300 lg:max-w-3xl">
          <span><b>{t('{n} waiting for your decision', { n: open })}</b></span><ChevronRight className="h-4 w-4 shrink-0 rtl:rotate-180" />
        </button>
      )}
      {view === 'entry' ? <EntryPage profile={profile} /> : view === 'leave' ? <LeaveOracle isHead={isHead} /> : view === 'moves' ? <ShiftChanges /> : <Approvals isHead={isHead} />}
    </div>
  );
}
