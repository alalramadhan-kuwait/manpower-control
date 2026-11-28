// What the Unit log screens show, worked out from the stored logs and lab samples (owner, 25 Nov 2026). Nothing here
// judges a value: there are no limits until the owner sets them, so a reading is never called high or low. A
// "follow-up" is only an equipment tag the remarks name, and how many logs in a row have named it.
import type { LabResult, RemarkSection, Reading, FeedRow, ProductRow, LogKind, StaffRow } from './parse';

export interface StoredLog {
  kind: LogKind; logNo: number; date: string; shift: string | null; crew: string | null; day: string | null; recordedAt: string | null;
  sections: RemarkSection[]; readings: Reading[]; feed: FeedRow[]; products: ProductRow[]; manpower?: StaffRow[];
}
export interface StoredSample { sampleId: string; material: string | null; equipment: string | null; collectedAt: string | null; note: string | null; results: LabResult[] }

const SHIFT_N: Record<string, number> = { Morning: 0, Afternoon: 1, Night: 2 };
/** Order of shifts in time: date, then Morning → Afternoon → Night (a night shift belongs to the date it starts). */
export const shiftKey = (l: Pick<StoredLog, 'date' | 'shift'>) => `${l.date}#${SHIFT_N[l.shift ?? ''] ?? 9}`;
export const sameShift = (a: Pick<StoredLog, 'date' | 'shift'>, b: Pick<StoredLog, 'date' | 'shift'>) => a.date === b.date && a.shift === b.shift;
/** Newest first. */
export const byShiftDesc = <T extends Pick<StoredLog, 'date' | 'shift' | 'logNo'>>(xs: T[]) => [...xs].sort((a, b) => (shiftKey(b) > shiftKey(a) ? 1 : shiftKey(b) < shiftKey(a) ? -1 : b.logNo - a.logNo));

// ── Equipment tags named in the remarks ────────────────────────────────────────────────────────────────────────
// e.g. "P-901A", "TC-987", "PSV-937", "R-12-905" (the unit prefix is dropped: R-905). Not unit or train numbers.
const TAG = /\b([A-Z]{1,4})-(?:12-)?(\d{3,4}[A-Z]?)\b/g;
const NOT_TAGS = new Set(['U', 'TR', 'UNIT', 'STEP', 'KBPD', 'BPD']);
export function tagsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.toUpperCase().matchAll(TAG)) if (!NOT_TAGS.has(m[1])) out.add(`${m[1]}-${m[2]}`);
  return [...out];
}
const itemsOf = (sections: RemarkSection[]) => sections.flatMap((s) => s.groups.flatMap((g) => g.items.map((text) => ({ role: s.role, group: g.group, text }))));

export interface FollowUp { tag: string; text: string; group: string; logs: number }
/**
 * The tags this shift's remarks name, each with the first remark that names it and how many logs in a row (this one
 * included) have named it. `before` are the earlier logs of the same kind, newest first.
 */
export function followUps(current: RemarkSection[], before: RemarkSection[][]): FollowUp[] {
  const prevTags = before.map((s) => new Set(itemsOf(s).flatMap((i) => tagsIn(i.text))));
  const seen = new Map<string, FollowUp>();
  for (const it of itemsOf(current)) for (const tag of tagsIn(it.text)) {
    if (seen.has(tag)) continue;
    let n = 1;
    for (const p of prevTags) { if (!p.has(tag)) break; n += 1; }
    seen.set(tag, { tag, text: it.text, group: it.group, logs: n });
  }
  return [...seen.values()].sort((a, b) => b.logs - a.logs || a.tag.localeCompare(b.tag, 'en', { numeric: true }));
}

/** Remarks that report a trip, a leak, a fire or an emergency, with the word that matched. */
export const EVENT = /\b(trip(?:ped|led|s)?|leak(?:ing|age|s)?|fire|emergency)\b/i;
export function eventsIn(sections: RemarkSection[]): { word: string; text: string; group: string }[] {
  const out: { word: string; text: string; group: string }[] = [];
  for (const it of itemsOf(sections)) {
    const m = EVENT.exec(it.text);
    if (m && !out.some((x) => x.text === it.text)) out.push({ word: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), text: it.text, group: it.group });
  }
  return out;
}

// ── Train readings ─────────────────────────────────────────────────────────────────────────────────────────────
export const readingBy = (l: StoredLog | undefined, key: string) => l?.readings.find((r) => r.key === key);
/** Heater skin temperatures: "PASS-n SKIN TEMP (H-12-101/201)" rows as a pass × heater grid (TR-1 heater, TR-2 heater). */
const SKIN = /^PASS(\d)SKINTEMPH(?:12)?(\d{3})(\d{3})$/;
/** keys: one per heater pair, with # where the pass number goes (to find the pair's limit). */
export interface SkinGrid { heaters: string[]; passes: { pass: number; values: (string | null)[] }[]; unit: string | null; keys: string[] }
export function skinGrid(readings: Reading[]): SkinGrid | null {
  const rows = readings.map((r) => ({ r, m: SKIN.exec(r.key) })).filter((x) => x.m);
  if (!rows.length) return null;
  const pairs = [...new Set(rows.map((x) => `${x.m![2]}/${x.m![3]}`))];
  const heaters = pairs.flatMap((p) => p.split('/').map((n) => `H-${n}`));
  const passes = [...new Set(rows.map((x) => Number(x.m![1])))].sort((a, b) => a - b).map((pass) => ({
    pass, values: pairs.flatMap((p) => { const x = rows.find((y) => Number(y.m![1]) === pass && `${y.m![2]}/${y.m![3]}` === p); return [x?.r.tr1 ?? null, x?.r.tr2 ?? null]; }),
  }));
  const keys = pairs.map((p) => { const x = rows.find((y) => `${y.m![2]}/${y.m![3]}` === p)!; return x.r.key.replace(/^PASS\d/, 'PASS#'); });
  return { heaters, passes, unit: rows[0].r.unit, keys };
}
export const isSkin = (r: Reading) => SKIN.test(r.key);

/** One reading over the logs given (newest first): [log, TR-1, TR-2]. */
export const trendOf = (logs: StoredLog[], key: string) => logs.map((l) => ({ log: l, r: readingBy(l, key) })).filter((x) => x.r);

// ── Lab ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Kuwait date and time of a sample ("2026-11-24", "09:57"). */
export function kuwaitParts(iso: string | null): { date: string; time: string } | null {
  if (!iso) return null;
  const d = new Date(Date.parse(iso) + 3 * 3600_000);
  if (Number.isNaN(d.getTime())) return null;
  const s = d.toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}
/** Days that have samples, newest first. */
export const labDays = (xs: StoredSample[]) => [...new Set(xs.map((s) => kuwaitParts(s.collectedAt)?.date).filter((d): d is string => !!d))].sort().reverse();
/** The samples collected on a Kuwait date, in time order. */
export const samplesOn = (xs: StoredSample[], date: string) => xs.filter((s) => kuwaitParts(s.collectedAt)?.date === date).sort((a, b) => (a.collectedAt ?? '').localeCompare(b.collectedAt ?? ''));
/** Where a sample came from: material and equipment, or whichever the lab filled in. */
export const samplePoint = (s: StoredSample) => [s.material, s.equipment].filter(Boolean).join(' · ') || s.sampleId;
/** The same point (material + equipment) over time, newest first, for one test. */
export function labTrend(xs: StoredSample[], s: StoredSample, component: string) {
  return xs.filter((x) => x.material === s.material && x.equipment === s.equipment)
    .map((x) => ({ s: x, r: x.results.find((r) => r.component === component) })).filter((x) => x.r)
    .sort((a, b) => (b.s.collectedAt ?? '').localeCompare(a.s.collectedAt ?? ''));
}
