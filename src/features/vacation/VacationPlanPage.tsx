// Plan Vacation for Next Year (owner, 27 Oct 2026): one workspace for the annual vacation plan, seven steps in a compact
// stepper (the step is in the address). Manpower first (allocation → Section Head approval), then the A3 forms, the
// selections (entered or read from the returned forms), the review, one approval that publishes to the Calendar, and
// the final plan to share. Everything saves as it is done; leaving and coming back loses nothing.
import { Check, Lock } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { startAllocation, type VacationData } from '@/data/vacation';
import type { UserProfile } from '@/data/types';
import { ErrorBox, Spinner, cx } from '@/ui/components';
import { ApproveManpowerStep } from './ApproveManpowerStep';
import { ManpowerStep } from './ManpowerStep';
import { stamp, StatusChip, useToast } from './parts';
import { usePlanCheck, useVacation } from './useVacation';

const FormsStep = lazy(() => import('./FormsStep'));
const SelectionsStep = lazy(() => import('./SelectionsStep'));
const ReviewStep = lazy(() => import('./ReviewStep'));
const PublishStep = lazy(() => import('./PublishStep'));
const ShareStep = lazy(() => import('./ShareStep'));

export type StepKey = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const STEPS: { key: StepKey; label: string; long: string }[] = [
  { key: 1, label: 'Manpower', long: 'Manpower setup' }, { key: 2, label: 'Approve', long: 'Review & approve manpower' },
  { key: 3, label: 'Forms', long: 'Generate A3 forms' }, { key: 4, label: 'Selections', long: 'Import vacation selections' },
  { key: 5, label: 'Review', long: 'Review complete plan' }, { key: 6, label: 'Publish', long: 'Approve & publish to Calendar' },
  { key: 7, label: 'Share', long: 'Share / export final plan' }];

export interface StepState { done: Set<StepKey>; open: Set<StepKey>; current: StepKey; status: 'Draft' | 'Needs Review' | 'Approved' | 'Published'; next: string }
export function stepState(d: VacationData, isHead: boolean): StepState {
  const allocOk = d.alloc?.status === 'approved';
  const published = d.plan?.status === 'published';
  const submitted = d.plan?.status === 'submitted';
  const hasBlocks = d.blocks.length > 0;
  const done = new Set<StepKey>(); const open = new Set<StepKey>([1, 2]);
  if (allocOk) { done.add(1); done.add(2); open.add(3); open.add(4); }
  if (allocOk && hasBlocks) { done.add(3); open.add(5); open.add(6); }
  if (submitted || published) done.add(4);
  if (submitted || published) done.add(5);
  if (published) { done.add(4); done.add(5); done.add(6); open.add(7); }
  const current: StepKey = published ? 7 : !allocOk ? 1 : !hasBlocks ? 3 : submitted ? 6 : 4;
  const status = published ? 'Published' : submitted ? 'Needs Review' : allocOk ? 'Approved' : 'Draft';
  const next = published ? 'Share the final plan' : !d.alloc ? 'Check each shift; changes save at once'
    : !allocOk ? (isHead ? 'Approve the manpower allocation' : 'Waiting for the Section Head to approve manpower')
    : !hasBlocks ? 'Print the A3 forms, then enter the selections'
    : submitted ? (isHead ? 'Approve the 2027 plan' : 'Waiting for the Section Head') : 'Enter selections, fill missing periods, send for approval';
  return { done, open, current, status, next };
}

export default function VacationPlanPage({ profile }: { profile: UserProfile }) {
  const [params, setParams] = useSearchParams();
  const year = Number(params.get('year')) || new Date(Date.now() + 3 * 3600_000).getUTCFullYear() + 1;
  const { data, error, ev, refreshAlloc, refreshPlan, reloadAll } = useVacation(year);
  const isHead = profile.role_code === 'section_head';
  const canEdit = ['section_head', 'manpower_coordinator', 'engineer', 'controller'].includes(profile.role_code);
  const { show, el: toastEl } = useToast();
  const st = useMemo(() => (data ? stepState(data, isHead) : null), [data, isHead]);
  const step = (Number(params.get('step')) || st?.current || 1) as StepKey;
  const go = (k: StepKey) => setParams((p) => { const n = new URLSearchParams(p); n.set('step', String(k)); return n; }, { replace: false });
  const check = usePlanCheck(data);
  // autosave: the first visit of an editor starts the draft from where everyone stands
  const started = useRef(false);
  useEffect(() => {
    if (!data || data.alloc || !canEdit || started.current) return;
    started.current = true;
    startAllocation(data.year, data.initial).then(refreshAlloc).catch(() => { started.current = false; });
  }, [data, canEdit, refreshAlloc]);

  if (error) return <ErrorBox error={error} />;
  if (!data || !ev || !st) return <Spinner label="Loading the plan…" />;
  const saved = [data.alloc?.updatedAt, data.plan?.updatedAt].filter(Boolean).sort().at(-1);
  const props = { d: data, ev, isHead, canEdit, toast: show, refreshAlloc, refreshPlan, reloadAll, check, go };
  return (
    <div className="space-y-2 lg:max-w-6xl">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="text-base font-semibold text-brand-800">Plan Vacation for Next Year · {year}</h2>
        <StatusChip level={st.status === 'Published' || st.status === 'Approved' ? 'ok' : st.status === 'Needs Review' ? 'warning' : 'warning'} label={st.status === 'Approved' ? 'Manpower approved' : st.status} />
        {saved && <span className="text-[11px] text-slate-500">Saved {stamp(saved)}</span>}
      </div>
      <nav aria-label="Steps" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
        {STEPS.map((s) => {
          const isOpen = st.open.has(s.key), isDone = st.done.has(s.key), active = step === s.key;
          return (
            <button key={s.key} type="button" disabled={!isOpen} onClick={() => go(s.key)} aria-current={active ? 'step' : undefined} title={s.long}
              className={cx('flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold ring-1',
                active ? 'bg-brand-700 text-white ring-brand-700' : isDone ? 'bg-green-50 text-green-800 ring-green-200' : isOpen ? 'bg-white text-slate-700 ring-slate-200' : 'bg-slate-50 text-slate-400 ring-slate-100')}>
              <span className={cx('flex h-4 w-4 items-center justify-center rounded-full text-[10px]', active ? 'bg-white/20' : isDone ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600')}>
                {isDone && !active ? <Check className="h-3 w-3" /> : !isOpen ? <Lock className="h-2.5 w-2.5" /> : s.key}
              </span>{s.label}
            </button>
          );
        })}
      </nav>
      <p className="text-xs text-slate-600"><b className="text-slate-800">{STEPS[step - 1].long}</b> · Next: {st.next}</p>
      <Suspense fallback={<Spinner />}>
        {step === 1 && <ManpowerStep d={data} ev={ev} canEdit={canEdit} onChanged={async () => { await refreshAlloc(); }} toast={show} />}
        {step === 2 && <ApproveManpowerStep d={data} ev={ev} isHead={isHead} canEdit={canEdit} onChanged={async () => { await Promise.all([refreshAlloc(), refreshPlan()]); }} toast={show} goFix={() => go(1)} />}
        {step === 3 && <FormsStep {...props} />}
        {step === 4 && <SelectionsStep {...props} />}
        {step === 5 && <ReviewStep {...props} />}
        {step === 6 && <PublishStep {...props} />}
        {step === 7 && <ShareStep {...props} />}
      </Suspense>
      {toastEl}
    </div>
  );
}

export interface StepProps {
  d: VacationData; ev: NonNullable<ReturnType<typeof useVacation>['ev']>; isHead: boolean; canEdit: boolean;
  toast: (m: string, undo?: () => void) => void; refreshAlloc: () => Promise<void>; refreshPlan: () => Promise<void>; reloadAll: () => void;
  check: ReturnType<typeof usePlanCheck>; go: (k: StepKey) => void;
}
