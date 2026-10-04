// What the desktop side panel shows: the next two weeks of crews, who is on leave, what waits for a decision, the
// estimated dates and the notifications. One small load, kept for a few minutes and refreshed when anything changes.
import { useEffect, useState } from 'react';
import { evaluateRange, type DayResult, type MpAbsence } from '@/core/manpower';
import type { Notice } from '@/core/notifications';
import { addDaysIso } from '@/core/roster';
import { fetchChangeRequests, isChangeOpen, type ChangeRequest } from '@/data/changeRequests';
import { fetchEstimatedLeaves, type EstimatedLeave } from '@/data/leave';
import { fetchManpowerInputs } from '@/data/manpower';
import { loadNotices } from '@/data/notifications';
import { fetchDirectory } from '@/data/queries';
import { fetchRequests, isOpen, type LeaveRequest } from '@/data/requests';
import { localToday } from '@/ui/leave';

export interface SideData {
  today: string;
  notices: Notice[];
  days: DayResult[];
  absences: MpAbsence[];
  names: Map<string, string>;
  requests: LeaveRequest[];
  changes: ChangeRequest[];
  estimated: EstimatedLeave[];
}
const TTL = 3 * 60 * 1000;
let cache: { key: string; at: number; data: SideData } | null = null;
if (typeof window !== 'undefined') window.addEventListener('notices-changed', () => { cache = null; });

async function load(isHead: boolean): Promise<SideData> {
  const today = localToday();
  const key = `${today}|${isHead}`;
  if (cache && cache.key === key && Date.now() - cache.at < TTL) return cache.data;
  const to = addDaysIso(today, 14);
  const [inputs, notices, dir, reqs, changes, estimated] = await Promise.all([fetchManpowerInputs(addDaysIso(today, -1), addDaysIso(to, 8)), loadNotices(isHead), fetchDirectory(), fetchRequests(), fetchChangeRequests(), fetchEstimatedLeaves()]);
  const data: SideData = {
    today, notices,
    days: evaluateRange(today, to, inputs.people, inputs.absencesAll, inputs.rules, inputs.assignments),
    absences: inputs.absences.filter((a) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false),
    names: new Map(dir.map((r) => [r.id, r.display_name])),
    requests: reqs.filter(isOpen), changes: changes.filter(isChangeOpen), estimated: estimated.filter((e) => e.end_date >= today)
  };
  cache = { key, at: Date.now(), data };
  return data;
}

export function useSideData(isHead: boolean): SideData | null | 'error' {
  const [data, setData] = useState<SideData | null | 'error'>(null);
  useEffect(() => {
    let live = true;
    const run = () => load(isHead).then((d) => { if (live) setData(d); }).catch(() => { if (live) setData((x) => x ?? 'error'); });
    run();
    const again = () => { window.setTimeout(run, 400); };
    window.addEventListener('notices-changed', again); window.addEventListener('requests-changed', again);
    return () => { live = false; window.removeEventListener('notices-changed', again); window.removeEventListener('requests-changed', again); };
  }, [isHead]);
  return data;
}
