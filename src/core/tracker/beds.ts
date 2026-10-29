// The fixed-bed reactors R-x01 … R-x04 share one step list (owner, 29 Oct 2026: "R-1 to 4 should have the same steps …
// make them in one page"): one page with the steps down the side and the four reactors across. Each reactor keeps its
// own steps, times, progress and history; this only lines them up by step name.
import { sortActs, type TrkActivity, type TrkEquipment } from '.';

export interface BedSet { label: string; items: TrkEquipment[]; keys: string[] }
export type BedState = 'done' | 'run' | 'open' | 'nr' | 'none';
export interface BedCell { key: string; a: TrkActivity | null; state: BedState }
export interface BedRow { id: string; name: string; cells: BedCell[] }

const BED = /^R-(\d+)-(\d)0([1-4])$/;
const keyOf = (e: TrkEquipment) => e.barchartKey ?? e.tag;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const isNotRequired = (a: TrkActivity) => !a.tracked && !a.outOfScope && /^not required/.test(a.disabledReason ?? '');

/** The sets of four fixed-bed reactors in the list (all four present), e.g. R-12-201 … R-12-204. */
export function bedSets(items: TrkEquipment[]): BedSet[] {
  const by = new Map<string, TrkEquipment[]>();
  for (const e of items) { const m = BED.exec(e.tag); if (!m) continue; const k = `${m[1]}-${m[2]}`; by.set(k, [...(by.get(k) ?? []), e]); }
  return [...by.entries()].filter(([, xs]) => xs.length === 4).map(([k, xs]) => {
    const t = k.split('-')[1], sorted = [...xs].sort((p, q) => p.tag.localeCompare(q.tag));
    return { label: `R-${t}01 – R-${t}04`, items: sorted, keys: sorted.map(keyOf) };
  });
}

const stateOf = (a: TrkActivity | null): BedState => (!a ? 'none' : isNotRequired(a) ? 'nr' : a.actualFinish ? 'done' : a.actualStart ? 'run' : 'open');

/** The steps of the set, one row per step name, in the order the reactors do them (each reactor's own order merged),
 *  and each reactor's step in that row: done, running, open, not required, or none (it has no such step). Field-detail
 *  and operations steps are left out, as on the item's steps page. */
export function bedMatrix(activities: TrkActivity[], keys: string[]): BedRow[] {
  const rows: { id: string; name: string }[] = [];
  const at = new Map<string, Map<string, TrkActivity>>();   // row id → key → step
  for (const k of keys) {
    const xs = sortActs(activities.filter((a) => a.key === k && !a.detail && a.group !== 'Operations' && (a.tracked || isNotRequired(a))));
    const seen = new Map<string, number>(); let last = -1;
    for (const a of xs) {
      const n = norm(a.activity), c = (seen.get(n) ?? 0) + 1; seen.set(n, c);
      const id = c > 1 ? `${n}#${c}` : n;
      let j = rows.findIndex((r) => r.id === id);
      if (j < 0) { j = last + 1; rows.splice(j, 0, { id, name: a.activity }); }
      if (j > last) last = j;
      at.set(id, (at.get(id) ?? new Map()).set(k, a));
    }
  }
  return rows.map((r) => ({ ...r, cells: keys.map((k) => { const a = at.get(r.id)?.get(k) ?? null; return { key: k, a, state: stateOf(a) }; }) }));
}

/** A row finished everywhere it applies (done or not required, at least one done); a row not required anywhere. */
export const bedRowDone = (r: BedRow) => r.cells.some((c) => c.state === 'done') && r.cells.every((c) => c.state === 'done' || c.state === 'nr' || c.state === 'none');
export const bedRowOff = (r: BedRow) => r.cells.every((c) => c.state === 'nr' || c.state === 'none');
