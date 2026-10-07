import { useEffect, useState } from 'react';
import { planContext, type PlanContext, type PlanYear } from '@/core/plan';
import { fetchPlanYears } from '@/data/plan';
import { cx } from './components';

/** The plan years, loaded once per page. */
export function usePlanYears(): PlanYear[] | null {
  const [years, setYears] = useState<PlanYear[] | null>(null);
  useEffect(() => { fetchPlanYears().then(setYears).catch(() => setYears([])); }, []);
  return years;
}

/** Which plan the page shows: "Active Plan · 2026" or "PV Plan · 2027 · Draft". */
export function PlanBadge({ context, className }: { context: PlanContext; className?: string }) {
  const tone = context.kind === 'active' ? 'bg-green-50 text-green-800 ring-green-300' : context.kind === 'draft' ? 'bg-amber-50 text-amber-900 ring-amber-300' : 'bg-slate-100 text-slate-700 ring-slate-300';
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1', tone, className)}>{context.label}</span>;
}

export { planContext };
