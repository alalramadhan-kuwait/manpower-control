// Day Supervisor (Morning Controller post) rotation of the plan year: about two-month turns. What the Controllers
// agreed is kept as it is; only empty turns get a proposal: the Controller with the fewest turns so far, then the
// fewest Morning days already held that year (Controllers calendar), then by name. Pure.
import { addDaysIso } from '../roster';

export interface DayTurn { employeeId: string | null; start: string; end: string; source: 'agreed' | 'proposed' }

/** The year cut into six two-month turns (Jan–Feb … Nov–Dec). */
export function dayTurns(year: number): { start: string; end: string }[] {
  return [0, 2, 4, 6, 8, 10].map((m) => ({ start: `${year}-${String(m + 1).padStart(2, '0')}-01`, end: addDaysIso(`${year}-${String(m + 3).padStart(2, '0')}-01`.replace(`${year}-13`, `${year + 1}-01`), -1) }));
}

/**
 * Fills the empty turns. `agreed`: turns already decided (kept); `candidates`: who may hold the post (Grade 15+
 * Controllers of the plan) with the Morning days they already hold that year.
 */
export function proposeDayRotation(year: number, agreed: DayTurn[], candidates: { id: string; name: string; morningDays: number }[]): DayTurn[] {
  const count = new Map(candidates.map((c) => [c.id, 0]));
  for (const t of agreed) if (t.employeeId && count.has(t.employeeId)) count.set(t.employeeId, (count.get(t.employeeId) ?? 0) + 1);
  return dayTurns(year).map((slot) => {
    const kept = agreed.find((t) => t.start <= slot.end && slot.start <= t.end && t.employeeId);
    if (kept) return { ...slot, employeeId: kept.employeeId, source: kept.source };
    const pick = [...candidates].sort((a, b) => (count.get(a.id)! - count.get(b.id)!) || a.morningDays - b.morningDays || a.name.localeCompare(b.name))[0];
    if (!pick) return { ...slot, employeeId: null, source: 'proposed' as const };
    count.set(pick.id, count.get(pick.id)! + 1);
    return { ...slot, employeeId: pick.id, source: 'proposed' as const };
  });
}
