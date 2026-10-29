// Equipment worked to one step list on one page (owner, 29 Oct 2026): "R-1 to 4 … make them in one page", then "group
// them based on requests from which department": the same type (Vessels, Exchangers …) and the same department (an
// item on the Inspection worklist, or cleaning / painting only) share their steps. Steps down the side, the items
// across. Each item keeps its own steps, times, plan dates, progress and history; this only lines them up by name.
import { sortActs, type TrkActivity, type TrkEquipment } from '.';

export type BedDept = 'inspection' | 'cleaning';
export interface BedSet { label: string; dept: BedDept; items: TrkEquipment[]; keys: string[] }
export type BedState = 'done' | 'run' | 'open' | 'nr' | 'none';
export interface BedCell { key: string; a: TrkActivity | null; state: BedState }
export interface BedRow { id: string; name: string; cells: BedCell[] }

const BED = /^R-(\d+)-(\d)0([1-4])$/;
const keyOf = (e: TrkEquipment) => e.barchartKey ?? e.tag;
/** A step name for matching: case, punctuation and a test pressure ("at 225 PSIG", "(2860 psig)") left out. */
export const bedName = (s: string) => s.toLowerCase().replace(/\(?\s*(at\s*)?\d+\s*psig\s*\)?/g, ' ').replace(/[^a-z0-9/&]+/g, ' ').replace(/\s+/g, ' ').trim();
const isNotRequired = (a: TrkActivity) => !a.tracked && !a.outOfScope && /^not required/.test(a.disabledReason ?? '');
export const bedDept = (e: TrkEquipment): BedDept => (e.inspRef ? 'inspection' : 'cleaning');

/** The groups of the list: same type and department, two items or more, rotating items and machine systems left out,
 *  and only where the steps line up (at least half the step rows are shared by two items or more). */
export function stepGroups(items: TrkEquipment[], activities: TrkActivity[]): BedSet[] {
  const by = new Map<string, TrkEquipment[]>();
  for (const e of items) { if (e.list === 'rotating' || e.system) continue; const k = `${e.group}|${bedDept(e)}`; by.set(k, [...(by.get(k) ?? []), e]); }
  const out: BedSet[] = [];
  for (const [k, xs] of by) {
    if (xs.length < 2) continue;
    const [grp, dept] = k.split('|') as [string, BedDept];
    const sorted = [...xs].sort((p, q) => p.sort - q.sort || p.tag.localeCompare(q.tag)), keys = sorted.map(keyOf);
    const rows = bedMatrix(activities, keys).filter((r) => !bedRowOff(r));
    if (!rows.length || rows.filter((r) => r.cells.filter((c) => c.state !== 'none').length >= 2).length < rows.length / 2) continue;
    const both = by.has(`${grp}|${dept === 'inspection' ? 'cleaning' : 'inspection'}`);
    const bed = sorted.map((e) => BED.exec(e.tag));
    const label = bed.every((m) => m) && sorted.length <= 4 ? `R-${bed[0]![2]}0${bed[0]![3]} – R-${bed.at(-1)![2]}0${bed.at(-1)![3]}`
      : both ? `${grp} · ${dept === 'inspection' ? 'inspection' : 'cleaning / painting'}` : grp;
    out.push({ label, dept, items: sorted, keys });
  }
  return out;
}
/** The fixed-bed reactor sets alone (R-x01 … R-x04), kept for the reactors' page title. */
export const bedSets = (items: TrkEquipment[], activities: TrkActivity[] = []) => stepGroups(items.filter((e) => BED.test(e.tag)), activities).filter((s) => s.label.startsWith('R-'));

const stateOf = (a: TrkActivity | null): BedState => (!a ? 'none' : isNotRequired(a) ? 'nr' : a.actualFinish ? 'done' : a.actualStart ? 'run' : 'open');

/** The steps of the set, one row per step name, in the order the items do them (each item's own order merged), and
 *  each item's step in that row: done, running, open, not required, or none (it has no such step). Field-detail and
 *  operations steps are left out, as on the item's steps page. */
export function bedMatrix(activities: TrkActivity[], keys: string[]): BedRow[] {
  const rows: { id: string; name: string }[] = [];
  const at = new Map<string, Map<string, TrkActivity>>();   // row id → key → step
  for (const k of keys) {
    const xs = sortActs(activities.filter((a) => a.key === k && !a.detail && a.group !== 'Operations' && (a.tracked || isNotRequired(a))));
    const seen = new Map<string, number>(); let last = -1;
    for (const a of xs) {
      const n = bedName(a.activity), c = (seen.get(n) ?? 0) + 1; seen.set(n, c);
      const id = c > 1 ? `${n}#${c}` : n;
      let j = rows.findIndex((r) => r.id === id);
      if (j < 0) { j = last + 1; rows.splice(j, 0, { id, name: a.activity.replace(/\s*\(?\s*(at\s*)?\d+\s*psig\s*\)?/i, '').trim() }); }
      if (j > last) last = j;
      at.set(id, (at.get(id) ?? new Map()).set(k, a));
    }
  }
  return rows.map((r) => ({ ...r, cells: keys.map((k) => { const a = at.get(r.id)?.get(k) ?? null; return { key: k, a, state: stateOf(a) }; }) }));
}

/** A row finished everywhere it applies (done or not required, at least one done); a row not required anywhere. */
export const bedRowDone = (r: BedRow) => r.cells.some((c) => c.state === 'done') && r.cells.every((c) => c.state === 'done' || c.state === 'nr' || c.state === 'none');
export const bedRowOff = (r: BedRow) => r.cells.every((c) => c.state === 'nr' || c.state === 'none');
/** An item whose steps are all done (or not required): it leaves the columns ("handed back"). */
export const bedItemDone = (rows: BedRow[], i: number) => rows.some((r) => r.cells[i].state === 'done') && rows.every((r) => ['done', 'nr', 'none'].includes(r.cells[i].state));

const H = 36e5;
/** Against its plan (owner, 29 Oct 2026: "see the date of the planned step, so I know I am within it"): late when not
 *  started after the plan start or not finished after the plan finish; a finish over an hour past the plan is late. */
export function bedLate(c: BedCell, now: number): { late: boolean; byH: number } {
  const a = c.a; if (!a || c.state === 'nr' || c.state === 'none') return { late: false, byH: 0 };
  const ps = a.start ? Date.parse(a.start) : NaN, pf = a.finish ? Date.parse(a.finish) : NaN;
  if (c.state === 'done') { const f = Date.parse(a.actualFinish!); return !Number.isNaN(pf) && f - pf > H ? { late: true, byH: (f - pf) / H } : { late: false, byH: 0 }; }
  if (!Number.isNaN(pf) && now > pf) return { late: true, byH: (now - pf) / H };
  if (c.state === 'open' && !Number.isNaN(ps) && now > ps) return { late: true, byH: (now - ps) / H };
  return { late: false, byH: 0 };
}
/** The plan window of a row: the earliest plan start and the latest plan finish of its items (null: no plan). */
export function bedWindow(r: BedRow): { start: number; finish: number } | null {
  const xs = r.cells.filter((c) => c.a && c.state !== 'nr' && c.state !== 'none' && c.a.start && c.a.finish);
  if (!xs.length) return null;
  return { start: Math.min(...xs.map((c) => Date.parse(c.a!.start!))), finish: Math.max(...xs.map((c) => Date.parse(c.a!.finish!))) };
}
