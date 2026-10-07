import { ChevronRight, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { countOpenChangeRequests } from '@/data/changeRequests';
import { countOpenRequests } from '@/data/requests';
import type { UserProfile } from '@/data/types';
import { Button, PageHeader, cx } from '@/ui/components';
import { LeaveWorklist } from './LeaveWorklist';
import { ShiftChanges } from './ShiftChanges';
import { Approvals } from './Approvals';
import { countPendingApprovals } from '@/data/approvals';

/**
 * Requests: Approvals (everything waiting for the Section Head, by type), the leave work list (running now or starting
 * in 14 days, with the Oracle HR decision) and the shift changes by date.
 */
export default function RequestsPage({ profile }: { profile: UserProfile }) {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'shift' ? 'shift' : params.get('view') === 'leave' || (!params.get('view') && params.get('q')) ? 'leave' : 'approvals';
  const [adding, setAdding] = useState(false);
  // open requests (forms and reschedule requests) wait in the Forms tab: say so on the tab and on the Leave tab
  const [open, setOpen] = useState(0);
  useEffect(() => {
    const load = () => Promise.all([countOpenRequests(), countOpenChangeRequests(), countPendingApprovals()]).then(([a, b, c]) => setOpen(a + b + c)).catch(() => setOpen(0));
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
        <p><b>Approvals:</b> everything that waits for the Section Head, by type: leave request forms (the MAB paper form, with the overtime review), reschedule requests, and the Manpower Coordinator&apos;s changes: unplanned or sick leave added by hand, shift moves, VR placements, task releases and Controller covers. Each shows the crews&apos; check before the decision; nothing changes in the plan until it is approved. The Section Head&apos;s own changes apply at once and are listed under Decided.</p>
      </div>} action={view === 'leave'
        ? <Button className="min-h-10 shrink-0 px-3" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> New</Button>
        : view === 'shift' ? undefined : <Link to="/requests/new"><Button className="min-h-10 shrink-0 px-3"><Plus className="h-4 w-4" /> Leave form</Button></Link>} />
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm lg:max-w-xl">
        {(['approvals', 'leave', 'shift'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setParams(t === 'approvals' ? {} : { view: t }, { replace: true })}
            className={cx('min-h-9 rounded-lg font-medium', view === t ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>
            {t === 'approvals' ? <>Approvals{open > 0 && <span className="ml-1.5 rounded-full bg-brand-700 px-1.5 text-[11px] font-bold text-white">{open}</span>}</> : t === 'leave' ? 'Leave · 14 d' : 'Shift changes'}
          </button>
        ))}
      </div>
      {view !== 'approvals' && open > 0 && (
        <button type="button" onClick={() => setParams({}, { replace: true })} className="mb-3 flex w-full items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 ring-1 ring-amber-300">
          <span><b>{open} {open === 1 ? 'request is' : 'requests are'} waiting</b> {profile.role_code === 'section_head' ? 'for your decision' : 'for the Section Head'} in Approvals</span><ChevronRight className="h-4 w-4 shrink-0" />
        </button>
      )}
      {view === 'leave' ? <LeaveWorklist adding={adding} onAdded={() => setAdding(false)} isHead={profile.role_code === 'section_head'} /> : view === 'shift' ? <ShiftChanges /> : <Approvals isHead={profile.role_code === 'section_head'} />}
    </div>
  );
}
