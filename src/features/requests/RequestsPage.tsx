import { Plus } from 'lucide-react';
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
const VIEWS: View[] = ['entry', 'approvals', 'leave', 'moves'];

/**
 * Requests: three counters on top (waiting for the Section Head's decision, leave to approve, shift moves coming), each
 * opening its list; "+ New" opens Entry (the one place to add or change anything for a person).
 */
export default function RequestsPage({ profile }: { profile: UserProfile }) {
  const [params, setParams] = useSearchParams();
  const isHead = profile.role_code === 'section_head';
  const v = params.get('view');
  const [open, setOpen] = useState<number | null>(null);
  const [leaveN, setLeaveN] = useState<number | null>(null);
  const [movesN, setMovesN] = useState<number | null>(null);
  useEffect(() => {
    const load = () => countPendingApprovals().then(setOpen).catch(() => setOpen(0));
    load();
    window.addEventListener('requests-changed', load);
    return () => window.removeEventListener('requests-changed', load);
  }, []);
  const view: View = VIEWS.includes(v as View) ? (v as View) : params.get('q') ? 'leave' : open ? 'approvals' : 'leave';
  const go = (x: View) => setParams({ view: x }, { replace: true });
  const tile = (x: View, n: number | null, label: string, cls: string) => (
    <button type="button" aria-pressed={view === x} onClick={() => go(x)} className={cx('flex-1 rounded-xl bg-white px-1.5 py-2 text-center', view === x ? 'ring-2 ring-brand-800' : 'ring-1 ring-slate-200')}>
      <span className={cx('block text-2xl font-extrabold tabular-nums leading-tight', n ? cls : 'text-slate-400')}>{n ?? '…'}</span>
      <span className="block text-[11px] font-semibold text-slate-600">{t(label)}</span>
    </button>
  );
  return (
    <div className="lg:max-w-3xl">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1"><PageHeader title="Requests" info={<div className="space-y-2 text-sm text-slate-700">
          <p><b>{t('Approvals')}:</b> {t('everything waiting for the Section Head, with the effect on the crews. The Section Head’s own entries are recorded directly and never wait here.')}</p>
          <p><b>{t('Leave to approve')}:</b> {t('leave now and coming up: planned, approved or unplanned. A planned PV counts as leave only once the Section Head approves it.')}</p>
          <p><b>{t('Shift moves')}:</b> {t('every cover, move, day duty and VR placement coming up, read only. Changes are made with + New.')}</p>
          <p><b>+ {t('New')}:</b> {t('pick the person, then the action: Leave / Absence, PV reschedule, Shift change / cover, Controller assignment or Task release.')}</p>
        </div>} /></div>
        <button type="button" onClick={() => go('entry')} className="mt-1 flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-brand-800 px-4 text-sm font-bold text-white"><Plus className="h-4 w-4" />{t('New')}</button>
      </div>
      {view === 'entry' ? (
        <>
          <button type="button" onClick={() => go(open ? 'approvals' : 'leave')} className="mb-2 text-sm font-semibold text-brand-700">‹ {t('Requests')}</button>
          <EntryPage profile={profile} />
        </>
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            {tile('approvals', open, 'Approvals', 'text-brand-800')}
            {tile('leave', leaveN, isHead ? 'Leave to approve' : 'Leave to fix', isHead ? 'text-amber-600' : 'text-sky-700')}
            {tile('moves', movesN, 'Shift moves', 'text-indigo-600')}
          </div>
          {view === 'approvals' && <Approvals isHead={isHead} />}
          <div className={view === 'leave' ? '' : 'hidden'}><LeaveOracle isHead={isHead} onCount={setLeaveN} /></div>
          <div className={view === 'moves' ? '' : 'hidden'}><ShiftChanges onCount={setMovesN} /></div>
        </>
      )}
    </div>
  );
}
