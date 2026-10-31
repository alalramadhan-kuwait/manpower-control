// Equipment worked to one step list on one page (owner, 29 Oct 2026): "R-1 to 4 … make them in one page", then "group
// them based on requests from which department": the same type (Vessels, Exchangers …) and the same department (an
// item on the Inspection worklist, or cleaning / painting only) share their steps. Steps down the side, the items
// across. Each item keeps its own steps, times, plan dates, progress and history; this only lines them up by name.
import { sortActs, type TrkActivity, type TrkEquipment } from '.';

export type BedDept = 'inspection' | 'cleaning' | 'mixed';
export interface BedSet { label: string; dept: BedDept; items: TrkEquipment[]; keys: string[] }
export type BedState = 'done' | 'run' | 'open' | 'nr' | 'none';
export interface BedCell { key: string; a: TrkActivity | null; state: BedState }
export interface BedRow { id: string; name: string; cells: BedCell[] }

const BED = /^R-(\d+)-(\d)0([1-4])$/;
const keyOf = (e: TrkEquipment) => e.barchartKey ?? e.tag;
/** A step name for matching: case, punctuation and a test pressure ("at 225 PSIG", "(2860 psig)") left out. */
const PSIG = /\s*·?\s*\(?\s*(at\s*)?(\d[\d,]*\s*\/\s*)*\d[\d,]*\s*psig\s*\)?/gi;
export const bedName = (s: string) => s.toLowerCase().replace(PSIG, ' ').replace(/[^a-z0-9/&]+/g, ' ').replace(/\s+/g, ' ').trim();
const isNotRequired = (a: TrkActivity) => !a.tracked && !a.outOfScope && /^not required/.test(a.disabledReason ?? '');
export const bedDept = (e: TrkEquipment): 'inspection' | 'cleaning' => (e.inspRef ? 'inspection' : 'cleaning');
const deptOf = (xs: TrkEquipment[]): BedDept => { const d = new Set(xs.map(bedDept)); return d.size > 1 ? 'mixed' : [...d][0]; };
/** The test steps of linked items move together (one hydrotest, no blind between them). */
export const isLinkedTest = (name: string) => /\btest\b|hydro\s?-?test/i.test(name);

/** The groups of the list (owner, 29–30 Oct 2026): rotating items and machine systems left out;
 *  1. items linked by their test (no blind between them: E-204 + E-205) on a page of their own;
 *  2. the other items of one type on one page when they are four or fewer (H-201 + H-202), whoever asked for the
 *     work, if they share at least three steps;
 *  3. a larger type split by department (on the Inspection worklist, or cleaning / painting), each part kept only
 *     where at least half its step rows are shared by two items or more. */
export function stepGroups(items: TrkEquipment[], activities: TrkActivity[]): BedSet[] {
  const cand = items.filter((e) => e.list !== 'rotating' && !e.system);
  const sortOf = (xs: TrkEquipment[]) => [...xs].sort((p, q) => p.sort - q.sort || p.tag.localeCompare(q.tag));
  const shared = (keys: string[]) => bedMatrix(activities, keys).filter((r) => !bedRowOff(r)).map((r) => r.cells.filter((c) => c.state !== 'none').length >= 2);
  const out: BedSet[] = [];
  const mk = (label: string, xs: TrkEquipment[]) => { const s = sortOf(xs); out.push({ label, dept: deptOf(s), items: s, keys: s.map(keyOf) }); };
  const linked = new Map<string, TrkEquipment[]>();
  for (const e of cand) if (e.linked) linked.set(e.linked, [...(linked.get(e.linked) ?? []), e]);
  for (const [l, xs] of linked) if (xs.length >= 2) mk(`${l} · linked`, xs);
  const taken = new Set(out.flatMap((g) => g.items));
  const byType = new Map<string, TrkEquipment[]>();
  for (const e of cand) if (!taken.has(e)) byType.set(e.group, [...(byType.get(e.group) ?? []), e]);
  for (const [grp, xs] of byType) {
    if (xs.length < 2) continue;
    if (xs.length <= 4) {
      if (shared(sortOf(xs).map(keyOf)).filter(Boolean).length < 3) continue;
      const bed = sortOf(xs).map((e) => BED.exec(e.tag));
      mk(bed.every((m) => m) ? `R-${bed[0]![2]}0${bed[0]![3]} – R-${bed.at(-1)![2]}0${bed.at(-1)![3]}` : grp, xs);
      continue;
    }
    const parts = (['inspection', 'cleaning'] as const).map((d) => [d, xs.filter((e) => bedDept(e) === d)] as const).filter(([, ys]) => ys.length);
    for (const [d, ys] of parts) {
      if (ys.length < 2) continue;
      const sh = shared(sortOf(ys).map(keyOf));
      if (!sh.length || sh.filter(Boolean).length < sh.length / 2) continue;
      const bed = sortOf(ys).map((e) => BED.exec(e.tag));
      mk(bed.every((m) => m) && ys.length <= 4 ? `R-${bed[0]![2]}0${bed[0]![3]} – R-${bed.at(-1)![2]}0${bed.at(-1)![3]}` : parts.length > 1 ? `${grp} · ${d === 'inspection' ? 'inspection' : 'cleaning / painting'}` : grp, ys);
    }
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
      if (j < 0) { j = last + 1; rows.splice(j, 0, { id, name: a.activity.replace(PSIG, '').trim() }); }
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

/** All the items of one type as one page (owner, 31 Oct 2026: "all heaters together … scroll left and right"). */
export const typeSet = (label: string, xs: TrkEquipment[]): BedSet => ({ label, dept: deptOf(xs), items: xs, keys: xs.map(keyOf) });
/** An open step past its plan: not finished after its plan finish, or not started after its plan start. */
export const stepLate = (a: Pick<TrkActivity, 'start' | 'finish' | 'actualStart' | 'actualFinish'>, now: number) =>
  !a.actualFinish && ((!!a.finish && now > Date.parse(a.finish)) || (!a.actualStart && !!a.start && now > Date.parse(a.start)));
/** Done share of a set of steps by their plan hours (no hours planned: by step count); null when there are no steps. */
export function doneShare(acts: Pick<TrkActivity, 'durationH' | 'actualFinish' | 'countTotal' | 'countDone'>[]): number | null {
  if (!acts.length) return null;
  // a counted step (RT joints) not yet finished counts its share done
  const part = (a: (typeof acts)[number]) => (a.actualFinish ? 1 : a.countTotal ? Math.min(1, (a.countDone ?? 0) / a.countTotal) : 0);
  const h = acts.reduce((t, a) => t + (a.durationH ?? 0), 0);
  return h > 0 ? acts.reduce((t, a) => t + (a.durationH ?? 0) * part(a), 0) / h : acts.reduce((t, a) => t + part(a), 0) / acts.length;
}
