// The Coordinator's entry page: what a change does to the crews, position by position (e.g. "B Shift · Field 7 → 6 ✅"),
// over the days it touches. Pure: the manpower engine's days before and after the change.
import type { Crew } from '../roster';
import type { DayResult } from '../manpower';

export type PositionKey = 'controller' | 'panel' | 'field';
export const POSITION_LABEL: Record<PositionKey, string> = { controller: 'Controller', panel: 'Panel', field: 'Field' };
export interface PositionImpact {
  key: PositionKey;
  /** Fewest on any working day of the crew in the dates, before and after the change. */
  before: number; after: number;
  /** The minimum of the operating mode on that worst day. */
  min: number;
  /** The worst day after the change. */
  date: string | null;
  ok: boolean;
}
export interface CrewImpact { crew: Crew; positions: PositionImpact[]; changed: boolean; ok: boolean; worst: string | null }

/** Per crew touched by the change, per position: the fewest people on a working day before and after, against the minimum. */
export function crewImpact(before: DayResult[], after: DayResult[], crews: Crew[]): CrewImpact[] {
  const out: CrewImpact[] = [];
  for (const crew of crews) {
    const positions: PositionImpact[] = (['controller', 'panel', 'field'] as const).map((key) => {
      let b = Infinity, a = Infinity, min = 0, date: string | null = null;
      for (let i = 0; i < after.length; i++) {
        const ca = after[i].crews.find((c) => c.crew === crew), cb = before[i]?.crews.find((c) => c.crew === crew);
        if (!ca?.working) continue;
        if (cb) b = Math.min(b, cb[key].count);
        if (ca[key].count < a || (ca[key].count === a && ca[key].count < ca[key].min && date === null)) { a = ca[key].count; min = ca[key].min; date = after[i].date; }
      }
      const fin = (n: number) => (Number.isFinite(n) ? n : 0);
      return { key, before: fin(b), after: fin(a), min, date, ok: fin(a) >= min };
    });
    const changed = positions.some((p) => p.before !== p.after);
    const bad = positions.filter((p) => !p.ok);
    out.push({ crew, positions, changed, ok: bad.length === 0, worst: bad[0]?.date ?? null });
  }
  return out;
}
