// Which form boxes are not available to a person: on a confirmed shutdown team (SD) or already on leave (L).
import type { PvCycle } from '@/core/pv';
import type { VacationData } from '@/data/vacation';

const overlap = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start <= b.end && b.start <= a.end;
export function restrictedFor(d: VacationData) {
  return (employeeId: string, c: PvCycle): string | null => {
    if (d.shutdowns.some((s) => s.employeeId === employeeId && overlap(s, c))) return 'SD';
    if (d.other.some((a) => a.employeeId === employeeId && (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && overlap(a, c))) return 'L';
    return null;
  };
}
