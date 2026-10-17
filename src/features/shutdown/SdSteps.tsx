// Shutdown plan (rules v2): the steps to a ready plan, in order, with one button for the step to do now.
// Done steps fold to a tick; later steps wait. Everything else on the page is detail behind it.
import { Check, Loader2, RefreshCw } from 'lucide-react';
import type { SdMember } from '@/core/shutdown';
import type { PlanCheck } from '@/core/shutdown/v2';
import type { ApprovalState } from '@/data/sdCheck';
import { Button, Card, cx } from '@/ui/components';

export interface Step { key: string; title: string; detail: string; done: boolean; action?: { label: string; run: () => void }; locked?: boolean }

export function planSteps(v: {
  members: SdMember[]; needTotal: number; check: PlanCheck | null; approval: ApprovalState | null; isHead: boolean;
  onTeam: () => void; onDays: () => void; onFix: () => void; onFigures: () => void; onApprove: () => void;
}): Step[] {
  const { members, needTotal, check } = v;
  const issues = check?.issues ?? [];
  const stale = issues.filter((i) => i.code === 'days_stale').length;
  const unplanned = members.filter((m) => !Object.keys(m.days ?? {}).length).length;
  const blocking = issues.filter((i) => i.level === 'block' && i.code !== 'days_stale');
  const verify = issues.filter((i) => i.level === 'verify');
  const approved = v.approval?.status === 'approved' && v.approval.fingerprint === check?.fingerprint;
  return [
    { key: 'team', title: 'Team', detail: members.length >= needTotal ? `${members.length} people placed` : `${members.length} of ${needTotal} placed`, done: members.length > 0 && members.length >= needTotal, action: { label: 'Add people', run: v.onTeam } },
    { key: 'days', title: 'Days & hours', detail: stale ? `Planned for other dates: ${stale} ${stale === 1 ? 'person' : 'people'}` : unplanned ? `${unplanned} not planned yet` : 'Planned for the shutdown dates', done: !stale && !unplanned && members.length > 0, action: { label: 'Set days & hours', run: v.onDays } },
    { key: 'fix', title: 'Problems that stop the plan', detail: check ? (blocking.length ? `${blocking.length} to solve` : 'None') : 'Checking…', done: !!check && !blocking.length, action: { label: `Solve ${blocking.length || ''}`.trim(), run: v.onFix } },
    { key: 'figures', title: 'Oracle & HR figures', detail: check ? (verify.length ? `${verify.length} to enter or verify` : 'All entered') : 'Checking…', done: !!check && !verify.length, action: { label: 'Enter the figures', run: v.onFigures } },
    { key: 'approve', title: 'Approval', detail: approved ? 'Approved' : check?.status === 'ready' ? (v.isHead ? 'Ready: approve the plan' : 'Ready: waiting for the Section Head') : 'After the steps above', done: approved, locked: check?.status !== 'ready' || !v.isHead, action: { label: 'Approve', run: v.onApprove } },
  ];
}

export function NextSteps({ steps, checking, loadedAt, onRefresh }: { steps: Step[]; checking: boolean; loadedAt: Date | null; onRefresh: () => void }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <Card className="mb-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next step</h2>
        <button type="button" onClick={onRefresh} disabled={checking} className="flex items-center gap-1 text-[11px] font-medium text-brand-700 disabled:text-slate-500">
          {checking ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking…</> : <><RefreshCw className="h-3.5 w-3.5" />{loadedAt ? `Updated ${loadedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Refresh'}</>}
        </button>
      </div>
      <ol className="mt-1.5 space-y-1">
        {steps.map((s, i) => {
          const now = i === current;
          return (
            <li key={s.key} className={cx('rounded-lg px-2 py-1.5', now ? 'bg-brand-50 ring-1 ring-brand-300' : '')}>
              <div className="flex items-center gap-2">
                <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', s.done ? 'bg-status-green text-white' : now ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-600')}>
                  {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-sm font-semibold', s.done ? 'text-slate-500' : 'text-slate-800')}>{s.title}</span>
                  <span className="block truncate text-[11px] text-slate-500">{s.detail}</span>
                </span>
                {!now && !s.done && s.action && !s.locked && (
                  <button type="button" onClick={s.action.run} className="shrink-0 text-[11px] font-semibold text-brand-700">{s.action.label} ›</button>
                )}
              </div>
              {now && s.action && !s.locked && <Button className="mt-1.5 min-h-10 w-full text-sm" onClick={s.action.run}>{s.action.label}</Button>}
            </li>
          );
        })}
      </ol>
      {current === -1 && <p className="mt-1 text-xs font-medium text-status-green">The plan is approved.</p>}
    </Card>
  );
}
