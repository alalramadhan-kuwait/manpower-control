// The vacation plan of one year as the workspace uses it: loaded once, then only the part a change touches is read
// again (allocation or plan), so a tap never reloads the whole year.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAllocPart, loadPlanPart, loadVacation, planCtx, rowsOf, type VacationData } from '@/data/vacation';
import { checkPlan, evaluateAllocation } from '@/core/vacation';

export function useVacation(year: number) {
  const [data, setData] = useState<VacationData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true; setError(null);
    loadVacation(year).then((d) => live && setData(d)).catch((e) => live && setError(e));
    return () => { live = false; };
  }, [year, n]);
  const reloadAll = useCallback(() => setN((x) => x + 1), []);
  const refreshAlloc = useCallback(async () => { const p = await loadAllocPart(year); setData((d) => (d ? { ...d, ...p } : d)); }, [year]);
  const refreshPlan = useCallback(async () => { const p = await loadPlanPart(year); setData((d) => (d ? { ...d, ...p } : d)); }, [year]);
  const ev = useMemo(() => (data ? evaluateAllocation(data.people, rowsOf(data)) : null), [data?.people, data?.rows, data?.alloc, data]);
  return { data, error, ev, reloadAll, refreshAlloc, refreshPlan, setData };
}

/** The whole-plan check, recomputed when the vacations or the allocation change (not on every render). */
export function usePlanCheck(data: VacationData | null, final = false) {
  return useMemo(() => (data && data.alloc?.status === 'approved' ? checkPlan(planCtx(data), { final }) : null), [data?.blocks, data?.rows, data?.alloc, data?.other, final, data]);
}
