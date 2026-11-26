// Product quality (owner, 26 Nov 2026: "build products quality cards"): the latest lab result of each product up to the
// end of the shift, beside the one before it, judged by the limit library where it has a limit (only a few product specs are
// in it; the rest show without colour). Pure.
import { limitForLab, limitState, plainNumber, type Limit, type LimitMatch } from './limits';
import { kuwaitParts, type StoredSample } from './view';

export interface ProductDef { name: string; material: string }
/** The products the lab reports for the unit (material names as on the report). */
export const PRODUCTS: ProductDef[] = [
  { name: 'Naphtha', material: 'NAPHTHA' },
  { name: 'Distillate', material: 'DISTILLATE' },
  { name: 'Residue (LSAR)', material: 'FRAC. RESIDUE' },
];

/** "Distillation 05%" → "5%", "Sulphur, Total" → "Sulphur", "API Gravity @ 60 F" → "API". */
export function shortComponent(c: string): string {
  const t = c.trim();
  if (/^API/i.test(t)) return 'API';
  if (/^colou?r/i.test(t)) return 'Colour';
  if (/^sulph?ur/i.test(t)) return 'Sulphur';
  if (/^H2S$/i.test(t)) return 'H₂S';
  const d = /^distil\w*\s+(.+)$/i.exec(t);
  if (d) return d[1].replace(/^0(\d%)$/, '$1');
  return t;
}

/** Card order: API, sulphur, colour, H₂S, then the distillation curve IBP → 5% … 95% → FBP, recovery, the rest. */
export function componentRank(label: string): number {
  const fixed: Record<string, number> = { API: 0, Sulphur: 1, Colour: 2, 'H₂S': 3, IBP: 10, FBP: 30, Recovery: 31 };
  if (label in fixed) return fixed[label];
  const pc = /^(\d+)%$/.exec(label);
  return pc ? 10 + Number(pc[1]) / 10 : 40;
}

export type Move = 'up' | 'down' | 'same' | null;
export interface ProductValue { component: string; label: string; value: string; unit: string | null; prev: string | null; move: Move; state: ReturnType<typeof limitState>; limit: Limit | null; sample: StoredSample }
export interface ProductCard { def: ProductDef; sample: StoredSample | null; when: string | null; values: ProductValue[] }

const order = (s: StoredSample) => s.collectedAt ?? '';
const SHIFT_END: Record<string, [number, string]> = { Morning: [0, '14:00'], Afternoon: [0, '22:00'], Night: [1, '06:00'] };
/** The end of a shift in Kuwait time, "YYYY-MM-DD HH:MM" (a log with no shift: the end of its day). */
export function shiftEnd(date: string, shift: string | null): string {
  const [plus, hm] = SHIFT_END[shift ?? ''] ?? [1, '00:00'];
  const d = new Date(Date.parse(`${date}T00:00:00Z`) + plus * 864e5).toISOString().slice(0, 10);
  return `${d} ${hm}`;
}

/** One card per product, from the samples collected up to `upTo` (Kuwait "YYYY-MM-DD HH:MM", the shift's end): each
 *  result is the newest one reported for it, beside the one before. `date` is the shift's day, for the time label. */
export function productCards(lab: StoredSample[], upTo: string, date: string, limits: Map<string, Limit>, matches: LimitMatch[]): ProductCard[] {
  return PRODUCTS.map((def) => {
    const xs = lab.filter((s) => { const k = kuwaitParts(s.collectedAt); return (s.material ?? '').trim().toUpperCase() === def.material && !!k && `${k.date} ${k.time}` < upTo && s.results.length; })
      .sort((a, b) => order(b).localeCompare(order(a)));
    const s = xs[0];
    if (!s) return { def, sample: null, when: null, values: [] };
    const k = kuwaitParts(s.collectedAt);
    const fullest = [...xs].sort((a, b) => b.results.length - a.results.length)[0];
    const comps = [...new Set([...fullest.results, ...xs.flatMap((x) => x.results)].map((r) => r.component))].sort((a, b) => componentRank(shortComponent(a)) - componentRank(shortComponent(b)));
    const values = comps.map((component): ProductValue => {
      const has = xs.filter((x) => x.results.some((y) => y.component === component));
      const r = has[0].results.find((y) => y.component === component)!;
      const prev = has[1]?.results.find((y) => y.component === component)?.value ?? null;
      const a = plainNumber(r.value), b = plainNumber(prev);
      const l = limitForLab(has[0].material, has[0].equipment, component, matches, limits);
      return { component, label: shortComponent(component), value: r.value, unit: r.unit, prev, move: a === null || b === null ? null : a > b ? 'up' : a < b ? 'down' : 'same', state: l ? limitState(r.value, l) : null, limit: l, sample: has[0] };
    });
    return { def, sample: s, when: k ? (k.date === date ? k.time : `${k.date.slice(8, 10)}/${k.date.slice(5, 7)} ${k.time}`) : null, values };
  });
}
