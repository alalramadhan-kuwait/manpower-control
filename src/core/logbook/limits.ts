// Operating limits (owner's limit library, 25 Nov 2026: "ARDS Shift Panel Log — App Module Specification" §4).
// The library itself lives in the database (it is refinery data: never in this public repo); this file only knows how
// to read a limit and how to judge a value against it, exactly as the spec's traffic light says (§4.1):
//   normal    inside the normal range (an open side has no bound)
//   off       outside the normal range but not beyond the IOW standard limit            (amber)
//   breach    beyond the IOW standard limit                                             (red, comment required)
//   critical  beyond the IOW critical limit                                             (dark red)
// A value that is not a plain number, or a parameter with no numeric limit, gets no colour. Trip settings are text
// ("FSL 16,000 / FSLL 14,000") and are shown for awareness only; they never colour a value.

export interface Limit {
  paramId: string; section: string; description: string; unit: string;
  target: string | null; normalLo: number | null; normalHi: number | null;
  iowStd: string | null; iowCrit: string | null; trip: string | null; roc: string | null;
  source: string | null; action: string | null; status: 'active' | 'verify' | 'retired';
}
export type LimitState = 'normal' | 'off' | 'breach' | 'critical';

/** "1,500" → 1500; anything that is not one plain number → null. */
export const plainNumber = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined) return null;
  const t = s.replace(/,/g, '').trim();
  return /^[+-]?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** An IOW cell: "8–9" / "15-20" is a band; one number is an upper limit; anything else is not usable. */
export function iowBand(s: string | null): { lo: number | null; hi: number | null } | null {
  if (!s) return null;
  const r = /^\s*([\d.,]+)\s*[–-]\s*([\d.,]+)\s*$/.exec(s);
  if (r) { const lo = plainNumber(r[1]), hi = plainNumber(r[2]); return lo !== null && hi !== null ? { lo, hi } : null; }
  const n = plainNumber(s);
  return n === null ? null : { lo: null, hi: n };
}
const outside = (v: number, lo: number | null, hi: number | null) => (lo !== null && v < lo) || (hi !== null && v > hi);

/** The traffic light for one value, or null when there is nothing to judge it by. */
export function limitState(value: string | number | null, l: Limit, scale = 1): LimitState | null {
  const raw = typeof value === 'number' ? value : plainNumber(value);
  if (raw === null || l.status === 'retired') return null;
  const v = raw * scale;
  const crit = iowBand(l.iowCrit), std = iowBand(l.iowStd);
  if (crit && outside(v, crit.lo, crit.hi)) return 'critical';
  if (std && outside(v, std.lo, std.hi)) return 'breach';
  if (l.normalLo === null && l.normalHi === null) return std || crit ? 'normal' : null;
  return outside(v, l.normalLo, l.normalHi) ? 'off' : 'normal';
}

/** The band to show beside a value: "≤ 42", "677–682", "≥ 1500", plus "IOW 988" when there is one. */
export function limitBand(l: Limit): string {
  const { normalLo: lo, normalHi: hi } = l;
  const n = lo !== null && hi !== null ? `${lo}–${hi}` : hi !== null ? `≤ ${hi}` : lo !== null ? `≥ ${lo}` : '';
  const iow = l.iowStd && !(lo !== null && hi !== null && iowBand(l.iowStd)?.lo === lo && iowBand(l.iowStd)?.hi === hi) ? `IOW ${l.iowStd}` : '';
  return [n, iow].filter(Boolean).join(' · ') || (l.target ? `target ${l.target}` : '');
}

const RANK: Record<LimitState, number> = { normal: 0, off: 1, breach: 2, critical: 3 };
/** The worse of two states (null counts as nothing). */
export const worse = (a: LimitState | null, b: LimitState | null): LimitState | null => (!a ? b : !b ? a : RANK[b] > RANK[a] ? b : a);

// ── Which library parameter a logbook reading or a lab result is judged by (the match rules are stored with the library)
export interface ReadingMatch { kind: 'reading'; key: string; scale?: number }
export interface LabMatch { kind: 'lab'; material: string; component: string; equipment?: string }
/** Several readings added per train (injection water: the four passes against the per-train limit). */
export interface SumMatch { kind: 'reading_sum'; key: string; scale?: number }
/** One reading minus another per train (a reactor's exotherm); without key2, the same key with OUTLET → INLET. */
export interface DiffMatch { kind: 'reading_diff'; key: string; key2?: string | null; scale?: number }
export type LimitMatch = (ReadingMatch | LabMatch | SumMatch | DiffMatch) & { paramId: string };

/** Reading keys are matched exactly, or as a pattern when the rule is written /…/. */
export const keyMatches = (rule: string, key: string) => (rule.startsWith('/') && rule.endsWith('/') ? new RegExp(rule.slice(1, -1)).test(key) : rule === key);
export function limitForReading(key: string, matches: LimitMatch[], limits: Map<string, Limit>) {
  const m = matches.find((x): x is ReadingMatch & { paramId: string } => x.kind === 'reading' && keyMatches(x.key, key));
  const l = m && limits.get(m.paramId);
  return m && l ? { limit: l, scale: m.scale ?? 1 } : null;
}
const same = (a: string | null | undefined, b: string) => (a ?? '').trim().toUpperCase() === b.trim().toUpperCase();
export function limitForLab(material: string | null, equipment: string | null, component: string, matches: LimitMatch[], limits: Map<string, Limit>) {
  const m = matches.find((x): x is LabMatch & { paramId: string } => x.kind === 'lab' && same(material, x.material) && same(component, x.component) && (!x.equipment || same(equipment, x.equipment)));
  const l = m && limits.get(m.paramId);
  return l ?? null;
}
