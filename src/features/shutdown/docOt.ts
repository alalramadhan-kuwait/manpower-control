// One overtime calculation for the plan, its print pages and the Excel file. Plans before v2: each day against the
// member's crew, months by the duty date (as before). Rules v2: the engine of the plan check (each day against the
// 8-day crew roster: duty day 12 h = 4 h, off day 12 h = 12 h; src/core/shutdown/overtime).
import { dayOvertime } from '@/core/shutdown';
import { isV2, memberOvertime } from '@/core/shutdown/v2';
import type { Doc, Row } from './SdDocuments';

export interface RowOt { day: (date: string) => number; month: (ym: string) => number; total: number }
const cache = new WeakMap<Row, RowOt>();

export function rowOvertime(doc: Doc, x: Row): RowOt {
  const hit = cache.get(x); if (hit) return hit;
  const { plan, dates } = doc;
  const onTeam = (d: string) => d >= x.m.start && d <= x.m.end;
  let out: RowOt;
  if (isV2(plan)) {
    const duties = memberOvertime(plan, x.team, x.m, x.person, doc.leaveOn ? (d) => doc.leaveOn!(x.m.employeeId, d) : undefined);
    const byDay = new Map(duties.map((d) => [d.date, d.ot]));
    const byMonth = new Map<string, number>();
    for (const d of duties) for (const p of d.parts) byMonth.set(p.month, Math.round(((byMonth.get(p.month) ?? 0) + p.hours) * 100) / 100);
    out = { day: (d) => byDay.get(d) ?? 0, month: (ym) => byMonth.get(ym) ?? 0, total: Math.round(duties.reduce((t, d) => t + d.ot, 0) * 100) / 100 };
  } else {
    const day = (d: string) => (onTeam(d) ? dayOvertime(plan, x.m, x.crew, d) : 0);
    out = { day, month: (ym) => dates.filter((d) => d.startsWith(ym)).reduce((n, d) => n + day(d), 0), total: dates.reduce((n, d) => n + day(d), 0) };
  }
  cache.set(x, out);
  return out;
}
