// Quantity-measured work (reactor catalyst removal, later loading): progress, planned curve and forecast from the
// shift entries. Phase 1 of the progress engine: pure rules, not shown on any screen yet. Only verified entries count;
// a transfer moves material already counted and never adds to it; a correction is its own entry (+/-). Quantity
// alone never closes the work: 99% at most until the vessel is confirmed empty. The forecast is provisional and
// withheld when the evidence is thin.

export type QtyKind = 'removal' | 'transfer' | 'correction';
export type QtyMethod = 'free_fall' | 'vacuum' | 'cone' | 'other';
export type Shift = 'D' | 'N';
export interface QtyEntry {
  id: string; shiftDate: string; shift: Shift; kind: QtyKind; method: QtyMethod; qty: number;
  corrects?: string | null; stoppage?: string | null; verify: 'pending' | 'verified' | 'rejected';
}
export interface QtyScope { working: number | null; initial: number | null; completeAt?: string | null }

const H = 36e5;
const r1 = (x: number) => Math.round(x * 10) / 10;
const counts = (e: QtyEntry) => e.kind !== 'transfer';

/** Verified and pending totals (transfers excluded, corrections signed). */
export function qtyTotals(entries: QtyEntry[]): { verified: number; pending: number } {
  const sum = (state: QtyEntry['verify']) => entries.filter((e) => counts(e) && e.verify === state).reduce((t, e) => t + e.qty, 0);
  return { verified: sum('verified'), pending: sum('pending') };
}

export interface QtyProgress { verified: number; pending: number; remaining: number | null; actualPct: number | null; awaitingEmpty: boolean }
/** Actual progress against the working estimate: held at 99% until the physical completion is confirmed. */
export function qtyProgress(scope: QtyScope, entries: QtyEntry[]): QtyProgress {
  const { verified, pending } = qtyTotals(entries);
  if (!scope.working) return { verified, pending, remaining: null, actualPct: scope.completeAt ? 100 : null, awaitingEmpty: false };
  const raw = (verified / scope.working) * 100;
  const done = !!scope.completeAt;
  return { verified, pending, remaining: Math.max(scope.working - verified, 0), actualPct: done ? 100 : r1(Math.min(raw, 99)), awaitingEmpty: !done && raw >= 99 };
}

/** PROVISIONAL planned % (no production targets in the baseline): elapsed share of the baseline lines' durations. */
export function plannedPct(lines: { start: string; finish: string }[], now: number): number | null {
  const ls = lines.map((l) => ({ s: Date.parse(l.start), f: Date.parse(l.finish) })).filter((l) => l.f > l.s);
  const total = ls.reduce((t, l) => t + (l.f - l.s), 0);
  if (!total) return null;
  return r1((ls.reduce((t, l) => t + Math.min(Math.max(now - l.s, 0), l.f - l.s), 0) / total) * 100);
}
/** Variance in percentage points (actual − planned). */
export const variancePts = (actual: number | null, planned: number | null) => (actual === null || planned === null ? null : r1(actual - planned));

/** Kuwait shifts: day 07:00–19:00, night 19:00–07:00 (dated by its start). */
export function kwShift(ms: number): { date: string; shift: Shift } {
  const k = new Date(ms + 3 * H); const h = k.getUTCHours();
  if (h >= 7 && h < 19) return { date: k.toISOString().slice(0, 10), shift: 'D' };
  if (h >= 19) return { date: k.toISOString().slice(0, 10), shift: 'N' };
  return { date: new Date(ms + 3 * H - 24 * H).toISOString().slice(0, 10), shift: 'N' };
}
const shiftIndex = (date: string, shift: Shift) => Math.round(Date.parse(`${date}T00:00:00Z`) / (24 * H)) * 2 + (shift === 'N' ? 1 : 0);

export interface ShiftRecord { date: string; shift: Shift; qty: number; method: QtyMethod; stopped: boolean }
/** One record per shift from the verified entries (net of corrections), its method the one that removed the most. */
export function shiftRecords(entries: QtyEntry[]): ShiftRecord[] {
  const by = new Map<string, QtyEntry[]>();
  for (const e of entries.filter((x) => x.verify === 'verified' && counts(x))) by.set(`${e.shiftDate}|${e.shift}`, [...(by.get(`${e.shiftDate}|${e.shift}`) ?? []), e]);
  return [...by.entries()].map(([k, es]) => {
    const [date, shift] = k.split('|') as [string, Shift];
    const main = [...es].filter((e) => e.kind === 'removal').sort((a, b) => b.qty - a.qty)[0] ?? es[0];
    const qty = es.reduce((t, e) => t + e.qty, 0);
    return { date, shift, qty, method: main.method, stopped: qty <= 0 && es.some((e) => !!e.stoppage) };
  }).sort((a, b) => shiftIndex(a.date, a.shift) - shiftIndex(b.date, b.shift));
}

export type QtyForecast =
  | { status: 'ok'; provisional: true; method: QtyMethod; shifts: number; ratePerShift: number; availability: number; finish: number }
  | { status: 'unavailable'; provisional: true; reason: string };
/** Forecast finish from the recent verified production of the current removal method (rolling window of productive
 *  shifts), scaled by the share of recorded shifts that were productive. Withheld when the last shift has no entry,
 *  when the current method has fewer than `min` productive shifts, or when nothing remains to be estimated. */
export function qtyForecast(entries: QtyEntry[], remaining: number | null, now: number, opt: { window?: number; min?: number } = {}): QtyForecast {
  const window = opt.window ?? 4, min = opt.min ?? 3;
  const no = (reason: string): QtyForecast => ({ status: 'unavailable', provisional: true, reason });
  if (remaining === null) return no('no working estimate');
  const recs = shiftRecords(entries);
  if (!recs.length) return no('no verified shift yet');
  const cur = kwShift(now), last = recs[recs.length - 1];
  // the shift before the current one must have its entry (a missing update is unknown, not zero)
  if (shiftIndex(last.date, last.shift) < shiftIndex(cur.date, cur.shift) - 1) return no('no entry for the last shift');
  const productive = recs.filter((r) => r.qty > 0 && !r.stopped);
  if (!productive.length) return no('no productive shift yet');
  const method = productive[productive.length - 1].method;
  // the current phase: the shifts since the method last changed (a different method has a different rate)
  let from = recs.length - 1;
  while (from > 0 && (recs[from - 1].stopped || recs[from - 1].qty <= 0 || recs[from - 1].method === method)) from--;
  const phase = recs.slice(from).filter((r) => r.stopped || r.qty <= 0 || r.method === method);
  const prod = phase.filter((r) => r.qty > 0 && !r.stopped);
  if (prod.length < min) return no(`fewer than ${min} productive shifts with the current method (${method.replace('_', ' ')})`);
  const win = prod.slice(-window);
  const ratePerShift = win.reduce((t, r) => t + r.qty, 0) / win.length;
  const span = phase.slice(phase.indexOf(win[0]));
  const availability = win.length / span.length;
  if (remaining <= 0) return { status: 'ok', provisional: true, method, shifts: win.length, ratePerShift: r1(ratePerShift), availability: r1(availability * 100) / 100, finish: now };
  const shiftsLeft = remaining / (ratePerShift * availability);
  return { status: 'ok', provisional: true, method, shifts: win.length, ratePerShift: r1(ratePerShift), availability: Math.round(availability * 100) / 100, finish: now + shiftsLeft * 12 * H };
}

/** The stored records (phase 1 tables) as the screens use them. */
export interface TrkQtyScope { id: string; key: string; scope: 'removal' | 'loading'; unit: string | null; low: number | null; high: number | null; initial: number | null; working: number | null;
  activityIds: string[]; completeAt: string | null; completeBy: string | null }
export interface TrkQtyEntry extends QtyEntry { scopeId: string; remark: string | null; source: 'field' | 'plant_report'; enteredBy: string | null; enteredByName: string | null; enteredAt: string;
  verifiedByName: string | null; verifiedAt: string | null }
export interface TrkQtyEstimate { id: string; scopeId: string; value: number; reason: string; byName: string | null; at: string }
export interface TrkUpdate { id: string; key: string; kind: 'milestone' | 'accept' | 'reject' | 'no_change' | 'delay' | 'forecast'; reason: string | null; expectedFinish: string | null; byName: string | null; at: string }
export interface TrkEngine { scopes: TrkQtyScope[]; entries: TrkQtyEntry[]; estimates: TrkQtyEstimate[]; updates: TrkUpdate[] }
export const METHOD_LABEL: Record<QtyMethod, string> = { vacuum: 'Vacuum', free_fall: 'Free fall', cone: 'Cone', other: 'Other' };
/** The current shift and the two before it (for an entry made after the shift ended). */
export function recentShifts(now: number, n = 3): { date: string; shift: Shift }[] {
  return Array.from({ length: n }, (_, i) => kwShift(now - i * 12 * H));
}
