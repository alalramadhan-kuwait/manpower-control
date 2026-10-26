// Reading a returned vacation form from a scan or a photo (no outside service): the four solid corner squares give the
// page's position (a perspective mapping from the printed layout to the picture), the bit strip says which form and
// page it is (and the manpower version it was printed from), and each box is measured: clearly marked, clearly empty,
// or unclear. Unclear boxes are never decided here: the person entering the form decides them. Pure.
import { A3, BIT, MARK, bitBoxes, cellBoxes, decodeId, marks, type FormDoc } from './layout';

export interface Gray { w: number; h: number; data: Uint8Array | Uint8ClampedArray }
export type Mat3 = number[];

/** Luminance of an RGBA buffer. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const data = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
  return { w, h, data };
}

/** Otsu's threshold over the picture (ink below, paper above). */
export function otsu(g: Gray): number {
  const hist = new Array(256).fill(0); const step = Math.max(1, Math.floor(g.data.length / 400000));
  let n = 0; for (let i = 0; i < g.data.length; i += step) { hist[g.data[i]]++; n++; }
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF; const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return Math.min(t, 170);
}

/**
 * The centre of the solid corner square nearest each corner (top-left, top-right, bottom-left, bottom-right), or null.
 * Dark blobs in each corner quarter are found on a coarse grid; the blob most like a filled square wins.
 */
export function findMarks(g: Gray, thr = otsu(g)): { x: number; y: number }[] | null {
  const cell = Math.max(2, Math.round(Math.min(g.w, g.h) / 450));
  const gw = Math.floor(g.w / cell), gh = Math.floor(g.h / cell);
  const dark = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let d = 0; for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) if (g.data[(gy * cell + y) * g.w + gx * cell + x] < thr) d++;
    dark[gy * gw + gx] = d * 2 > cell * cell ? 1 : 0;
  }
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const out: { x: number; y: number }[] = [];
  const seen = new Uint8Array(gw * gh);
  for (const [cx, cy] of corners) {
    const x0 = cx ? Math.floor(gw * 0.7) : 0, x1 = cx ? gw : Math.ceil(gw * 0.3), y0 = cy ? Math.floor(gh * 0.7) : 0, y1 = cy ? gh : Math.ceil(gh * 0.3);
    let best: { x: number; y: number; score: number } | null = null;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * gw + x; if (!dark[i] || seen[i]) continue;
      // flood fill the blob
      const stack = [i]; seen[i] = 1; let n = 0, sx = 0, sy = 0, minX = x, maxX = x, minY = y, maxY = y;
      while (stack.length) {
        const k = stack.pop()!; const kx = k % gw, ky = (k - kx) / gw; n++; sx += kx; sy += ky;
        if (kx < minX) minX = kx; if (kx > maxX) maxX = kx; if (ky < minY) minY = ky; if (ky > maxY) maxY = ky;
        for (const nb of [k - 1, k + 1, k - gw, k + gw]) { if (nb < 0 || nb >= dark.length || seen[nb] || !dark[nb]) continue; const nx = nb % gw; if (Math.abs(nx - kx) > 1) continue; seen[nb] = 1; stack.push(nb); }
        if (n > 20000) break;
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      if (n < 9 || bw < 3 || bh < 3) continue;
      const fill = n / (bw * bh), ratio = Math.min(bw, bh) / Math.max(bw, bh);
      if (fill < 0.7 || ratio < 0.6) continue;
      // nearest to the corner, larger is better
      const ccx = sx / n, ccy = sy / n;
      const dist = Math.hypot((cx ? gw - ccx : ccx) / gw, (cy ? gh - ccy : ccy) / gh);
      const score = Math.sqrt(n) * fill * ratio / (0.05 + dist);
      if (!best || score > best.score) best = { x: (ccx + 0.5) * cell, y: (ccy + 0.5) * cell, score };
    }
    if (!best) return null;
    out.push({ x: best.x, y: best.y });
  }
  return out;
}

/** The perspective mapping from 4 points to 4 points (direct linear transform). */
export function homography(src: { x: number; y: number }[], dst: { x: number; y: number }[]): Mat3 {
  const A: number[][] = []; const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination
  const n = 8; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const h = M.map((r, i) => r[n] / r[i]);
  return [...h, 1];
}
export const apply = (H: Mat3, x: number, y: number) => { const w = H[6] * x + H[7] * y + H[8]; return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w }; };

/** Share of dark samples inside a layout rectangle (inset by `inset` of its size on each side). */
export function inkRatio(g: Gray, H: Mat3, r: { x: number; y: number; w: number; h: number }, thr: number, inset = 0.2): number {
  const N = 12; let dark = 0, n = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const px = r.x + r.w * (inset + (1 - 2 * inset) * (i + 0.5) / N), py = r.y + r.h * (inset + (1 - 2 * inset) * (j + 0.5) / N);
    const p = apply(H, px, py); const x = Math.round(p.x), y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
    n++; if (g.data[y * g.w + x] < thr) dark++;
  }
  return n ? dark / n : 0;
}

export const MARKED = 0.12, EMPTY = 0.04;
export interface ReadCell { employeeId: string; cycle: number; ratio: number; state: 'marked' | 'empty' | 'unclear' }
export interface ReadPage { ok: true; doc: FormDoc; page: number; cells: ReadCell[] }
export interface ReadFail { ok: false; reason: string }

/**
 * Reads one page against the forms of the plan: which form and page it is (the strip), then every box of that page.
 * `forms` are the forms of the current approved manpower; a page printed from another version is refused.
 */
export function readPage(g: Gray, forms: FormDoc[]): ReadPage | ReadFail {
  const thr = otsu(g);
  const found = findMarks(g, thr);
  if (!found) return { ok: false, reason: 'The four corner squares were not found. Photograph the whole page, flat, in good light.' };
  const centres = marks().map((m) => ({ x: m.x + MARK / 2, y: m.y + MARK / 2 }));
  const H = homography(centres, found);
  const bits = bitBoxes().map((b) => (inkRatio(g, H, b, thr, 0.25) > 0.5 ? 1 : 0));
  const id = decodeId(bits);
  if (!id) return { ok: false, reason: 'The form code strip could not be read (bottom of the page).' };
  const doc = forms.find((f) => f.kind === id.kind && f.crew === id.crew && f.year === id.year);
  if (!doc) return { ok: false, reason: `This is not a ${forms[0]?.year ?? ''} form of this plan.` };
  if (doc.version % 32 !== id.version) return { ok: false, reason: `Printed from manpower version ${id.version}; the approved version is ${doc.version}. Print the current form.` };
  const page = doc.pages[id.page - 1];
  if (!page) return { ok: false, reason: `Page ${id.page} is not in this form.` };
  const restricted = new Set(page.sections.flatMap((s) => [...s.restricted].flatMap(([e, m]) => [...m.keys()].map((c) => `${e}|${c}`))));
  const cells: ReadCell[] = cellBoxes(doc).filter((b) => b.page === id.page && !restricted.has(`${b.employeeId}|${b.cycle}`)).map((b) => {
    const ratio = inkRatio(g, H, b, thr);
    return { employeeId: b.employeeId, cycle: b.cycle, ratio, state: ratio >= MARKED ? 'marked' : ratio <= EMPTY ? 'empty' : 'unclear' };
  });
  return { ok: true, doc, page: id.page, cells };
}
export const PAGE_POINTS = A3;
export const STRIP_BITS = BIT.count;
