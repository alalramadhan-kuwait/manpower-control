// Several status lines for one item (owner's notes, 27 Oct 2026: "what will it do if there are multiple statuses?"):
// two reports (Ops Eng., Shift Ops …) each propose a status for the same item. Only the newest by the time of the report
// can be applied; the older ones are shown as older, not applied (they may still be dismissed). Nothing is stored:
// the newest is worked out each time the list is read, so a later report always takes over.
import { DEPT_SHORT, type Department } from './parse';

interface StatusLike { id: string; type: string; key: string | null; status: string; eventAt: string; createdAt: string; department: Department; issues: string[]; title: string }
const OPEN = new Set(['ready', 'review', 'conflict']);
const KW = 3 * 36e5;
const at = (iso: string) => { const d = new Date(Date.parse(iso) + KW); return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

/** The proposals with every older open status line of an item turned into an "older" information row. */
export function latestStatusOnly<T extends StatusLike>(rows: T[]): (T & { superseded?: boolean })[] {
  const newest = new Map<string, T>();
  for (const p of rows) {
    if (p.type !== 'status_line' || !OPEN.has(p.status) || !p.key) continue;
    const n = newest.get(p.key);
    if (!n || Date.parse(p.eventAt) > Date.parse(n.eventAt) || (p.eventAt === n.eventAt && p.createdAt > n.createdAt)) newest.set(p.key, p);
  }
  return rows.map((p) => {
    if (p.type !== 'status_line' || !OPEN.has(p.status) || !p.key) return p;
    const n = newest.get(p.key)!;
    if (n.id === p.id) return p;
    return { ...p, status: 'info', superseded: true, issues: [`older: the newer status from ${DEPT_SHORT[n.department]} ${at(n.eventAt)} is the one to apply`, ...p.issues] };
  });
}
