// Folded compact layout for a corrected loop topology (connections with roles). It tries several arrangements — the
// whole route on one band, or folded into two or three bands joined by lettered continuation markers — lays each one
// out, and keeps the smallest that has no label collisions and the fewest crossings. Topology is never changed: every
// item, valve, bypass and connection of the schematic is drawn. Rules: .claude/skills/refinery-process-diagram.
//   · each exchanger bypass sits on its own side of the route (above / below), never sharing a line with another
//   · junction dots only where pipes really meet (3 or more directions at a point); crossings are counted
//   · labels are placed after all pipes, never on a pipe, a symbol or another label
import { checkRules, DRAWING_RULES } from './drawingRules';
import { esc, HW, LINK_STYLE, ROLE_STYLE, SCHEMATIC_LABEL, schematicCheck, schematicInfo, symbol, wrap, type Role, type Schematic, type SchematicInfo, type SLink, type SNode } from './schematic';

type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const isState = (n: SNode) => n.state === 'closed' || n.state === 'standby' || n.state === 'open' || (n.state === 'unresolved' && n.kind !== 'junction');
/** down to the last text line under a symbol: tag +72, state +98, label +110 */
const nodeH = (n: SNode) => (n.kind === 'junction' ? 70 : n.label ? 114 : isState(n) ? 102 : n.via.some((v) => !/inlet|feed lines/i.test(v)) ? 90 : 78);
const stateText = (n: SNode) => (n.state === 'closed' ? 'CLOSED' : n.state === 'open' ? 'OPEN' : n.state === 'standby' ? 'STANDBY — ISOLATED' : 'UNVERIFIED tag / position');
const stateLine = (n: SNode) => (n.state === 'unresolved' ? stateText(n) : `${stateText(n)}${n.stateSource ? ` (${n.stateSource})` : ''}`);
const nodeW = (n: SNode) => (n.kind === 'junction' ? 124 : Math.max(2 * HW[n.kind] + 12, n.tag.length * 8.4, isState(n) ? stateLine(n).length * 5.4 : 0, (n.label?.length ?? 0) * 5.3));

/** columns: longest path, then each item as late as possible (just before the first item it feeds) */
function columns(s: Schematic) {
  const col = new Map<string, number>(s.nodes.map((n) => [n.key, 0]));
  for (let i = 0; i < s.nodes.length; i++) for (const l of s.links) { const c = col.get(l.a)! + 1; if (c > col.get(l.b)! && c < s.nodes.length) col.set(l.b, c); }
  for (let i = 0; i < s.nodes.length; i++) for (const n of s.nodes) { const nx = s.links.filter((l) => l.a === n.key).map((l) => col.get(l.b)!); if (nx.length) col.set(n.key, Math.max(col.get(n.key)!, Math.min(...nx) - 1)); }
  return col;
}

interface Laid { parts: string[]; W: number; H: number; issues: string[]; crossings: number; conts: number; dots: number }

function layout(s: Schematic, col0: Map<string, number>, cuts: number[], top: number, flip: boolean): Laid {
  const issues: string[] = []; const node = new Map(s.nodes.map((n) => [n.key, n]));
  const col = new Map(col0);
  const bandOf = (c: number) => cuts.filter((x) => x < c).length;
  const band = new Map(s.nodes.map((n) => [n.key, bandOf(col.get(n.key)!)]));
  const bands = cuts.length + 1, start = [0, ...cuts.map((c) => c + 1)];
  const lc = (k: string) => col.get(k)! - start[band.get(k)!];
  const active = (k: string) => s.links.some((l) => l.role === 'active' && (l.a === k || l.b === k));
  // rows: the active route on row 0 (several active items in one column stack below); each bypass on its own side
  const row = new Map<string, number>(); const used = new Map<string, number>(); const key = (b: number, c: number) => `${b}:${c}`;
  for (const n of s.nodes.filter((x) => active(x.key))) { const k = key(band.get(n.key)!, lc(n.key)); row.set(n.key, used.get(k) ?? 0); used.set(k, (used.get(k) ?? 0) + 1); }
  const comps: string[][] = []; const seen = new Set<string>();
  for (const n of s.nodes) { if (active(n.key) || seen.has(n.key)) continue; const comp = [n.key]; seen.add(n.key);
    for (let i = 0; i < comp.length; i++) for (const l of s.links) for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) if (x === comp[i] && !active(y) && !seen.has(y)) { seen.add(y); comp.push(y); }
    comps.push(comp); }
  const isBypass = (comp: string[]) => comp.every((k) => s.links.filter((l) => l.a === k || l.b === k).every((l) => l.role === 'bypass'));
  // a branch that only feeds an end item with a free right side (the heater) may be drawn on that side, flowing left into it
  const flipped = new Set<string>(); const depth = new Map<string, number>(); const joinsBelow = new Set<string>();
  if (flip) for (const comp of comps) { if (isBypass(comp)) continue;
    const ext = s.links.filter((l) => comp.includes(l.a) !== comp.includes(l.b)); const sink = ext[0]?.b;
    if (!sink || ext.some((l) => !comp.includes(l.a) || l.b !== sink)) continue;
    const under = node.get(sink)!.kind === 'junction' && row.get(sink) === 0;   // a branch into a tie-in: drawn under the route, joining from below
    if (!under && s.links.some((l) => l.a === sink)) continue;
    if (under) joinsBelow.add(sink);
    for (const k of comp) { let d = 0, cur = [k]; while (cur.length && !cur.includes(sink) && d < 9) { d++; cur = s.links.filter((l) => cur.includes(l.a)).map((l) => l.b); } depth.set(k, d); flipped.add(k); col.set(k, col.get(sink)! + d); band.set(k, band.get(sink)!); } }
  const span = (comp: string[]) => { const ends = s.links.filter((l) => comp.includes(l.a) || comp.includes(l.b)).flatMap((l) => [l.a, l.b]).map((k) => col.get(k)!); return [Math.min(...ends), Math.max(...ends)]; };
  const sides: { lo: number; hi: number; side: number }[] = [];
  for (const comp of comps.filter(isBypass).sort((a, b) => span(a)[0] - span(b)[0])) {
    const [lo, hi] = span(comp); const clash = (sd: number) => sides.some((o) => o.side === sd && lo < o.hi && o.lo < hi);
    const side = !clash(1) ? 1 : !clash(-1) ? -1 : 1; sides.push({ lo, hi, side });
    for (const k of comp) { const kk = key(band.get(k)!, lc(k)); const r = side < 0 ? -1 : Math.max(1, used.get(kk) ?? 0); row.set(k, r); if (side > 0) used.set(kk, r + 1); }
  }
  for (const comp of comps.filter((c) => c.every((k) => flipped.has(k)))) {   // drawn beside the end item: rows from the top (under a tie-in: below what is there)
    const sink = s.links.find((l) => comp.includes(l.a) && !comp.includes(l.b))!.b; const ks = comp.map((k) => key(band.get(k)!, lc(k)));
    const base = joinsBelow.has(sink) ? Math.max(1, ...ks.map((k) => used.get(k) ?? 0)) : 0;
    const inCol = new Map<string, number>(); for (const k of comp) { const kk = key(band.get(k)!, lc(k)); row.set(k, base + (inCol.get(kk) ?? 0)); inCol.set(kk, (inCol.get(kk) ?? 0) + 1); }
    for (const kk of new Set(ks)) used.set(kk, Math.max(used.get(kk) ?? 0, base + (inCol.get(kk) ?? 0))); }
  for (const comp of comps.filter((c) => !isBypass(c) && !c.every((k) => flipped.has(k)))) {   // standby, injection: below everything in their columns
    const ks = comp.map((k) => key(band.get(k)!, lc(k))); const base = Math.max(0, ...ks.map((k) => used.get(k) ?? 0)); const inCol = new Map<string, number>();
    for (const k of comp) { const kk = key(band.get(k)!, lc(k)); const r = base + (inCol.get(kk) ?? 0); inCol.set(kk, (inCol.get(kk) ?? 0) + 1); row.set(k, r); }
    for (const kk of new Set(ks)) used.set(kk, Math.max(used.get(kk) ?? 0, base + (inCol.get(kk) ?? 0)));
  }
  // continuation links (between bands) and their margins
  const cross = s.links.filter((l) => band.get(l.a) !== band.get(l.b));
  const letter = new Map(cross.map((l, i) => [l.key, String.fromCharCode(65 + i)]));
  // geometry per band
  const pos = new Map<string, Pt>(); let y0 = top; let W = 0; const bandBox: { top: number; bot: number }[] = [];
  for (let b = 0; b < bands; b++) {
    const ks = s.nodes.filter((n) => band.get(n.key) === b).map((n) => n.key); if (!ks.length) { bandBox.push({ top: y0, bot: y0 }); continue; }
    const ncol = Math.max(...ks.map(lc)) + 1;
    const w = Array.from({ length: ncol }, (_, c) => Math.max(56, ...ks.filter((k) => lc(k) === c).map((k) => nodeW(node.get(k)!))));
    const gap = Array.from({ length: ncol }, (_, c) => { const out = s.links.filter((l) => band.get(l.a) === b && band.get(l.b) === b && lc(l.a) === c);
      return Math.max(70, ...out.map((l) => l.lines.slice(0, 2).join(', ').length * 6.2 + 30)); });
    const left = cross.some((l) => band.get(l.b) === b) ? 96 : 24, right = cross.some((l) => band.get(l.a) === b) ? 96 : 24;
    // empty columns (left by items drawn elsewhere) take no space
    const filled = (c: number) => ks.some((k) => lc(k) === c); const last = Math.max(...ks.map(lc));
    let x = left; const xs: number[] = []; for (let c = 0; c < ncol; c++) { if (!filled(c)) { xs[c] = x; continue; } x += w[c] / 2; xs[c] = x; x += w[c] / 2 + (c < last ? gap[c] : 0); }
    W = Math.max(W, x + right);
    const rs = ks.map((k) => row.get(k)!); const rmin = Math.min(0, ...rs), rmax = Math.max(...rs);
    const rh = new Map<number, number>(); for (let r = rmin; r <= rmax; r++) rh.set(r, r === 0 ? 96 : 60);
    for (const k of ks) rh.set(row.get(k)!, Math.max(rh.get(row.get(k)!)!, nodeH(node.get(k)!) + 22));
    const ry = new Map<number, number>(); let yy = y0 + (rmin < 0 ? 30 : 34); for (let r = rmin; r <= rmax; r++) { ry.set(r, yy); yy += rh.get(r)!; }
    for (const k of ks) pos.set(k, { x: xs[lc(k)], y: ry.get(row.get(k)!)! });
    bandBox.push({ top: y0, bot: yy }); y0 = yy + 18;
  }
  // tall multi-pass heater: every line enters on its own
  const tall = new Map<string, { top: number; bot: number }>();
  const port = (k: string, out: boolean, side?: string | null, fromY?: number, fromX?: number): Pt => { const p = pos.get(k)!, n = node.get(k)!;
    if (!out && fromY !== undefined && tall.has(k)) return { x: p.x + ((fromX ?? 0) > p.x ? HW[n.kind] : -HW[n.kind]), y: fromY };
    if (flipped.has(k)) return { x: p.x + (out ? -HW[n.kind] : HW[n.kind]), y: p.y + 26 };
    if (!out && fromX !== undefined && fromX > p.x) return { x: p.x + HW[n.kind], y: p.y + 26 };
    const vap = out && /vapou?r/i.test(side ?? '') && ['vessel', 'column', 'reactor'].includes(n.kind);
    return { x: p.x + (out ? HW[n.kind] : -HW[n.kind]) + (n.kind === 'pump' && out ? 4 : 0), y: p.y + (n.kind === 'pump' && out ? 10 : vap ? 8 : 26) }; };
  const inner = s.links.filter((l) => band.get(l.a) === band.get(l.b));
  for (const n of s.nodes) if (n.kind === 'heater') { const ys = inner.filter((l) => l.b === n.key).map((l) => port(l.a, true, l.aSide).y);
    if (ys.length >= 3) { const t = { top: Math.min(...ys) - 22, bot: Math.max(...ys) + 22 }; tall.set(n.key, t); const bb = bandBox[band.get(n.key)!]; bb.bot = Math.max(bb.bot, t.bot + 40); } }
  const H0 = Math.max(...bandBox.map((b) => b.bot));
  // the look of a pipe: role colour and weight, verification pattern
  const look = (l: SLink) => { const st = LINK_STYLE[l.basis]; const r = l.role ? ROLE_STYLE[l.role] : null;
    return { color: r?.color ?? st.color, width: r?.width ?? st.width, dash: st.dash, marker: r ? `r-${l.role}` : l.basis }; };
  const paths: { l: SLink; pts: Pt[]; arrow: boolean }[] = [];
  const inCount = (k: string) => inner.filter((l) => l.b === k).length, outCount = (k: string) => inner.filter((l) => l.a === k).length;
  const mergeX = new Map<string, number>();
  for (const l of inner) {
    const a = port(l.a, true, l.aSide), b = port(l.b, false, l.bSide, a.y, a.x); const ra = row.get(l.a)!, rb = row.get(l.b)!; const sg = b.x >= a.x ? 1 : -1;
    const toJ = node.get(l.b)!.kind === 'junction', fromJ = node.get(l.a)!.kind === 'junction';
    let pts: Pt[];
    if (flipped.has(l.a) && joinsBelow.has(l.b)) { const j = pos.get(l.b)!; pts = [a, { x: j.x, y: a.y }, { x: j.x, y: j.y + 26 }]; paths.push({ l, pts, arrow: false }); continue; }
    if (a.y === b.y) {
      const blocked = s.nodes.some((o) => o.key !== l.a && o.key !== l.b && band.get(o.key) === band.get(l.a) && Math.abs(pos.get(o.key)!.y + 26 - a.y) < 30 && pos.get(o.key)!.x > Math.min(a.x, b.x) && pos.get(o.key)!.x < Math.max(a.x, b.x));
      pts = blocked ? [a, { x: a.x + 14 * sg, y: a.y }, { x: a.x + 14 * sg, y: a.y - 60 }, { x: b.x - 14 * sg, y: a.y - 60 }, { x: b.x - 14 * sg, y: b.y }, b] : [a, b];
    } else {
      let vx: number;
      if (ra !== 0 && rb === 0 && !toJ && !flipped.has(l.a)) vx = b.x - 16 * sg;     // from a side row: rise / drop just before the target
      else if (rb !== 0 && ra === 0 && !fromJ && !flipped.has(l.b)) vx = a.x + 16 * sg;   // into a side row: leave just after the source
      else if (inCount(l.b) > 1 && !toJ && !tall.has(l.b)) { vx = mergeX.get(l.b) ?? b.x - 20 * sg; mergeX.set(l.b, vx); }
      else if (outCount(l.a) > 1 || fromJ) vx = a.x + (fromJ ? 22 : 16) * sg;
      else if (toJ) vx = b.x - 22 * sg;
      else vx = (a.x + b.x) / 2;
      pts = [a, { x: vx, y: a.y }, { x: vx, y: b.y }, b];
    }
    paths.push({ l, pts, arrow: !toJ });
  }
  // continuation stubs
  const marker = (x: number, y: number, ch: string, dir: 'out' | 'in') => `<polygon points="${x - 12},${y - 10} ${x + 4},${y - 10} ${x + 14},${y} ${x + 4},${y + 10} ${x - 12},${y + 10}" fill="#fff" stroke="#0f172a" stroke-width="1.6"/><text x="${x - 1}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="800">${ch}</text>${dir === 'out' ? '' : ''}`;
  const contParts: string[] = []; const contBoxes: Box[] = [];
  for (const l of cross) { const ch = letter.get(l.key)!; const a = port(l.a, true, l.aSide); const b0 = pos.get(l.b)!, bn = node.get(l.b)!;
    const b = tall.has(l.b) ? { x: b0.x - HW[bn.kind], y: b0.y + 26 } : port(l.b, false, l.bSide);
    const ox = a.x + 52, ix = b.x - 52;
    paths.push({ l, pts: [a, { x: ox - 12, y: a.y }], arrow: false }, { l, pts: [{ x: ix + 14, y: b.y }, b], arrow: node.get(l.b)!.kind !== 'junction' });
    contParts.push(marker(ox, a.y, ch, 'out'), marker(ix, b.y, ch, 'in'),
      `<text x="${ox}" y="${a.y + 24}" text-anchor="middle" font-size="9.5" fill="#334155">to ${esc(bn.tag.replace(/^J:/, ''))}</text>`,
      `<text x="${ix}" y="${b.y + 24}" text-anchor="middle" font-size="9.5" fill="#334155">from ${esc(node.get(l.a)!.tag.replace(/^J:/, ''))}</text>`);
    contBoxes.push({ x: ox - 34, y: a.y - 12, w: 68, h: 40 }, { x: ix - 34, y: b.y - 12, w: 68, h: 40 }); }
  // junction dots: a point where 3 or more pipe directions meet; crossings: pipes passing through each other
  const segs = paths.flatMap((p, i) => p.pts.slice(1).map((q, j) => ({ i, a: p.pts[j], b: q }))).filter((g) => g.a.x !== g.b.x || g.a.y !== g.b.y);
  const on = (pt: Pt, g: { a: Pt; b: Pt }) => (g.a.x === g.b.x ? Math.abs(pt.x - g.a.x) < 0.5 && pt.y > Math.min(g.a.y, g.b.y) - 0.5 && pt.y < Math.max(g.a.y, g.b.y) + 0.5
    : Math.abs(pt.y - g.a.y) < 0.5 && pt.x > Math.min(g.a.x, g.b.x) - 0.5 && pt.x < Math.max(g.a.x, g.b.x) + 0.5);
  const dirs = (pt: Pt) => { const d = new Set<string>(); for (const g of segs) { if (!on(pt, g)) continue;
    for (const e of [g.a, g.b]) { if (Math.abs(e.x - pt.x) < 0.5 && Math.abs(e.y - pt.y) < 0.5) continue; d.add(e.x > pt.x + 0.5 ? 'E' : e.x < pt.x - 0.5 ? 'W' : e.y > pt.y ? 'S' : 'N'); } } return d; };
  const dots: Pt[] = [];
  const nodePorts = new Set(s.nodes.flatMap((n) => { const p = pos.get(n.key)!; return [`${Math.round(p.x - HW[n.kind])}:${Math.round(p.y + 26)}`, `${Math.round(p.x + HW[n.kind])}:${Math.round(p.y + 26)}`]; }));
  for (const p of paths) for (const v of p.pts) { if (dots.some((d) => Math.abs(d.x - v.x) < 0.5 && Math.abs(d.y - v.y) < 0.5)) continue;
    if (nodePorts.has(`${Math.round(v.x)}:${Math.round(v.y)}`)) continue; if (dirs(v).size >= 3) dots.push(v); }
  // R9: two different connections running along the same line look like one pipe (unless they share their start or end: a tee)
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) { const g = segs[i], h = segs[j]; if (g.i === h.i) continue;
    const L1 = paths[g.i].l, L2 = paths[h.i].l; if (L1.a === L2.a || L1.b === L2.b || L1.key === L2.key) continue;
    const ov = g.a.y === g.b.y && h.a.y === h.b.y && Math.abs(g.a.y - h.a.y) < 3 ? Math.min(Math.max(g.a.x, g.b.x), Math.max(h.a.x, h.b.x)) - Math.max(Math.min(g.a.x, g.b.x), Math.min(h.a.x, h.b.x))
      : g.a.x === g.b.x && h.a.x === h.b.x && Math.abs(g.a.x - h.a.x) < 3 ? Math.min(Math.max(g.a.y, g.b.y), Math.max(h.a.y, h.b.y)) - Math.max(Math.min(g.a.y, g.b.y), Math.min(h.a.y, h.b.y)) : 0;
    if (ov > 20) issues.push(`shared-looking line: ${L1.a} → ${L1.b} and ${L2.a} → ${L2.b}`); }
  let crossings = 0;
  const hs = segs.filter((g) => g.a.y === g.b.y), vs = segs.filter((g) => g.a.x === g.b.x);
  for (const h of hs) for (const v of vs) { if (h.i === v.i) continue; const x = v.a.x, y = h.a.y;
    if (x > Math.min(h.a.x, h.b.x) + 1 && x < Math.max(h.a.x, h.b.x) - 1 && y > Math.min(v.a.y, v.b.y) + 1 && y < Math.max(v.a.y, v.b.y) - 1 && !dots.some((d) => Math.abs(d.x - x) < 1 && Math.abs(d.y - y) < 1)) crossings++; }
  // collision boxes: symbols, item text, pipes, continuation markers
  const boxes: Box[] = [...contBoxes];
  for (const n of s.nodes) { const p = pos.get(n.key)!; const tl = tall.get(n.key);
    if (tl) { boxes.push({ x: p.x - 30, y: tl.top - 12, w: 60, h: tl.bot - tl.top + 52 }); continue; }
    if (n.kind === 'junction' && joinsBelow.has(n.key)) { boxes.push({ x: p.x - 134, y: p.y + 36, w: 126, h: 44 }); continue; }
    const tw = n.kind === 'junction' ? 62 : Math.max(HW[n.kind], nodeW(n) / 2 - 6);
    boxes.push({ x: p.x - HW[n.kind] - 4, y: p.y - 6, w: 2 * HW[n.kind] + 8, h: 62 }, { x: p.x - tw, y: p.y + 58, w: 2 * tw, h: nodeH(n) - 56 }); }
  const pipeBoxes: Box[] = segs.map((g) => ({ x: Math.min(g.a.x, g.b.x) - 2, y: Math.min(g.a.y, g.b.y) - 2, w: Math.abs(g.a.x - g.b.x) + 4, h: Math.abs(g.a.y - g.b.y) + 4 }));
  const t = (x: number, y: number, txt: string, o = '') => `<text x="${x}" y="${y}" ${o}>${esc(txt)}</text>`;
  const labels: string[] = [];
  const place = (txt: string, x: number, y: number, color: string) => { const w = txt.length * 6 + 8;
    for (const dy of [0, -14, 22, 36, -28]) for (const dx of [0, 16, -16, 32, -32, 48, -48]) { const b = { x: x + dx - w / 2, y: y + dy - 11, w, h: 14 };
      if (!boxes.some((o) => hit(o, b)) && !pipeBoxes.some((o) => hit(o, b))) { boxes.push(b); labels.push(t(x + dx, y + dy, txt, `text-anchor="middle" font-size="10" fill="${color}"`)); return; } }
    issues.push(`label "${txt}" has no free place`); labels.push(t(x, y, txt, `text-anchor="middle" font-size="10" fill="${color}"`)); };
  const small = (txt: string, x: number, y: number, anchor: 'start' | 'end') => { const w = txt.length * 5.4 + 4; const b = { x: anchor === 'start' ? x : x - w, y: y - 10, w, h: 12 };
    if (!boxes.some((o) => hit(o, b)) && !pipeBoxes.some((o) => hit(o, b))) { boxes.push(b); labels.push(t(x, y, txt, `text-anchor="${anchor}" font-size="9" fill="#334155" font-weight="600"`)); } };
  const labelled = new Set<string>();
  for (const p of paths) { const l = p.l; if (labelled.has(l.key)) continue; labelled.add(l.key);
    const first = l.role && l.role !== 'active' && l.role !== 'bypass' && !s.links.some((o) => o.b === l.a && o.role === l.role) && s.links.filter((o) => o.a === l.a && o.role === l.role)[0] === l;
    const txt = [l.lines.slice(0, 2).join(', '), first ? ROLE_STYLE[l.role!].tag : '', l.conflict ? '⚠ direction conflict' : ''].filter(Boolean).join(' · ');
    if (txt) { const hseg = p.pts.slice(1).map((q, j) => [p.pts[j], q] as const).filter(([u, v]) => u.y === v.y).sort((u, v) => Math.abs(v[1].x - v[0].x) - Math.abs(u[1].x - u[0].x))[0];
      if (hseg) place(txt, (hseg[0].x + hseg[1].x) / 2, hseg[0].y - 8, look(l).color); }
    if (l.bSide && /^pass/.test(l.bSide)) small(l.bSide.replace(/ inlet$/, ''), p.pts[0].x + 4, p.pts[0].y - 6, 'start');
    else if (l.aSide && outCount(l.a) < 2) small(l.aSide, p.pts[0].x + 4, p.pts[0].y + 14, 'start'); }
  // draw
  const parts: string[] = [];
  for (const p of [...paths].sort((u, v) => Number(u.l.role === 'active') - Number(v.l.role === 'active'))) { const st = look(p.l);
    parts.push(`<path d="M ${p.pts.map((q) => `${q.x} ${q.y}`).join(' L ')}" fill="none" stroke="${st.color}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}${p.arrow ? ` marker-end="url(#ar-${st.marker})"` : ''}/>`); }
  parts.push(...contParts);
  for (const n of s.nodes) {
    const p = pos.get(n.key)!; const c = n.state === 'standby' ? '#94a3b8' : '#0f172a';
    if (n.kind === 'junction' && n.state === 'known') { const jl = wrap(n.label ?? n.tag.slice(2), 22);
      // a branch joining from below: the name goes to the left, clear of that pipe
      const ax = joinsBelow.has(n.key) ? p.x - 10 : p.x, anc = joinsBelow.has(n.key) ? 'end' : 'middle', rx = joinsBelow.has(n.key) ? p.x - 132 : p.x - 62;
      parts.push(`<circle cx="${p.x}" cy="${p.y + 26}" r="5" fill="#0f172a"/>`, `<rect x="${rx}" y="${p.y + 38}" width="124" height="${jl.length * 12 + 4}" fill="#fff"/>`,
        ...jl.map((w, i) => t(ax, p.y + 48 + i * 12, w, `text-anchor="${anc}" font-size="10" font-weight="600" fill="#0f172a"`))); continue; }
    const tl = tall.get(n.key);
    if (tl) { const zig = Array.from({ length: Math.max(2, Math.floor((tl.bot - tl.top - 20) / 14)) }, (_, i) => `${p.x + (i % 2 ? 14 : -14)},${tl.top + 10 + i * 14}`).join(' ');
      parts.push(`<rect x="${p.x - 28}" y="${tl.top}" width="56" height="${tl.bot - tl.top}" fill="#fff" stroke="${c}" stroke-width="2"/><rect x="${p.x - 7}" y="${tl.top - 10}" width="14" height="10" fill="#fff" stroke="${c}" stroke-width="2"/><polyline points="${zig}" fill="none" stroke="${c}" stroke-width="1.4"/>`,
        t(p.x, tl.bot + 20, n.tag, `text-anchor="middle" font-size="13" font-weight="800" fill="${c}"`)); continue; }
    parts.push(symbol(n.kind, p.x, p.y, c, n.state === 'closed'));
    if (n.kind === 'junction') { const ls = wrap(n.label ?? 'Split / header not recorded', 20);
      parts.push(`<rect x="${p.x - 58}" y="${p.y + 41}" width="116" height="${6 + ls.length * 12}" fill="#fff" stroke="#b45309" stroke-width="0.8" stroke-dasharray="2 2"/>`,
        ...ls.map((w, i) => t(p.x, p.y + 52 + i * 12, w, `text-anchor="middle" font-size="10" ${i ? '' : 'font-weight="700" '}fill="#b45309"`))); continue; }
    parts.push(t(p.x, p.y + 72, n.tag, `text-anchor="middle" font-size="13" font-weight="800" fill="${c}"`));
    if (isState(n)) parts.push(t(p.x, p.y + 98, stateLine(n), `text-anchor="middle" font-size="9.5" font-weight="700" fill="${n.state === 'closed' ? '#b91c1c' : n.state === 'unresolved' ? '#b45309' : '#64748b'}"`));
    if (n.label) parts.push(t(p.x, p.y + 110, n.label, 'text-anchor="middle" font-size="9.5" fill="#475569"'));
    const via = n.via.filter((v) => !/inlet|feed lines/i.test(v)).join(' / '); if (via) parts.push(t(p.x, p.y + 86, via, 'text-anchor="middle" font-size="10" fill="#475569"'));
  }
  parts.push(...dots.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="3.6" fill="#0f172a"/>`), ...labels);
  for (let b = 1; b < bands; b++) parts.push(`<line x1="24" y1="${bandBox[b].top - 9}" x2="${W - 24}" y2="${bandBox[b].top - 9}" stroke="#e2e8f0" stroke-dasharray="4 4"/>`);
  return { parts, W, H: H0, issues, crossings, conts: cross.length, dots: dots.length };
}

/** Try the arrangements, keep the most compact clean one, and draw the sheet around it. */
export function renderFolded(s: Schematic, generatedAt: string): { svg: string; issues: string[]; info: SchematicInfo } {
  const col = columns(s); const n = Math.max(...[...col.values()]) + 1;
  const head = `${s.ref} · ${s.title}`; const TOP = 96;
  const cands: number[][] = [[]];
  for (let c = 0; c < n - 1; c++) cands.push([c]);
  for (let a = 0; a < n - 1; a++) for (let b = a + 2; b < n - 1; b++) cands.push([a, b]);
  let best: Laid | null = null, bestScore = Infinity;
  // a fold goes only through the active route: never through a bypass, a branch or between two shells in series
  const crosses = (cut: number[], l: SLink) => cut.some((c) => col.get(l.a)! <= c && col.get(l.b)! > c);
  const series = (l: SLink) => { const a = s.nodes.find((x) => x.key === l.a)!, b = s.nodes.find((x) => x.key === l.b)!; return a.kind === b.kind && a.tag.replace(/[A-Z]$/, '') === b.tag.replace(/[A-Z]$/, ''); };
  for (const cut of cands) for (const flip of [false, true]) {
    if (cut.some((c) => !s.nodes.some((x) => col.get(x.key) === c) || !s.nodes.some((x) => col.get(x.key) === c + 1))) continue;
    if (s.links.some((l) => crosses(cut, l) && (l.role !== 'active' || series(l)))) continue;
    const r = layout(s, col, cut, TOP, flip); const W = Math.max(r.W, head.length * 10.5 + 48, 700);
    const score = W * r.H * (1 + 0.1 * r.conts) + r.crossings * 60000 + r.issues.length * 120000;
    if (score < bestScore) { best = r; bestScore = score; }
  }
  const r = best!; const issues = [...schematicCheck(s), ...r.issues, ...(r.crossings ? [`${r.crossings} pipe crossing${r.crossings > 1 ? 's' : ''}`] : [])];
  const W = Math.max(r.W, head.length * 10.5 + 48, 700);
  const t = (x: number, y: number, txt: string, o = '') => `<text x="${x}" y="${y}" ${o}>${esc(txt)}</text>`;
  const parts: string[] = [`<defs>${[...Object.entries(LINK_STYLE), ...Object.entries(ROLE_STYLE).map(([k, v]) => [`r-${k}`, v] as const)].map(([k, v]) => `<marker id="ar-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${v.color}"/></marker>`).join('')}</defs>`,
    `<rect x="0" y="0" width="${W}" height="32" fill="#b91c1c"/>`, t(W / 2, 21, SCHEMATIC_LABEL.toUpperCase(), 'text-anchor="middle" fill="#fff" font-size="13.5" font-weight="800" letter-spacing="0.4"'),
    t(24, 62, head, 'font-size="18" font-weight="800" fill="#0f172a"'), t(24, 82, `${s.type} · Status: ${s.status} · Rev auto-${s.revision} · ${generatedAt}`, 'font-size="11" fill="#475569"'), ...r.parts];
  // one-row legend, a pointer to Details, the warning
  let y = r.H + 8;
  const usedR = [...new Set(s.links.map((l) => l.role).filter(Boolean))] as Role[]; const usedB = [...new Set(s.links.map((l) => l.basis))];
  const ents: { icon: (x: number, y: number) => string; text: string }[] = [
    ...usedR.map((ro) => ({ icon: (x: number, yy: number) => `<line x1="${x}" y1="${yy}" x2="${x + 30}" y2="${yy}" stroke="${ROLE_STYLE[ro].color}" stroke-width="${ROLE_STYLE[ro].width}"/>`, text: ROLE_STYLE[ro].label.replace(/ \(not part of the active loop\)/, '') })),
    ...usedB.map((b) => ({ icon: (x: number, yy: number) => `<line x1="${x}" y1="${yy}" x2="${x + 30}" y2="${yy}" stroke="#475569" stroke-width="2.2"${LINK_STYLE[b].dash ? ` stroke-dasharray="${LINK_STYLE[b].dash}"` : ''}/>`, text: LINK_STYLE[b].label })),
    ...(s.nodes.some((x) => x.state === 'closed') ? [{ icon: (x: number, yy: number) => `<polygon points="${x + 5},${yy - 6} ${x + 5},${yy + 6} ${x + 15},${yy} ${x + 25},${yy - 6} ${x + 25},${yy + 6} ${x + 15},${yy}" fill="#0f172a"/>`, text: 'Closed per the procedure step named' }] : []),
    ...(r.dots ? [{ icon: (x: number, yy: number) => `<circle cx="${x + 15}" cy="${yy}" r="3.6" fill="#0f172a"/>`, text: 'Junction' }] : []),
    ...(r.conts ? [{ icon: (x: number, yy: number) => `<polygon points="${x + 3},${yy - 7} ${x + 15},${yy - 7} ${x + 23},${yy} ${x + 15},${yy + 7} ${x + 3},${yy + 7}" fill="#fff" stroke="#0f172a" stroke-width="1.4"/>`, text: 'Continues at the same letter' }] : []),
    ...(s.nodes.some((x) => x.kind === 'junction' && x.state !== 'known') ? [{ icon: (x: number, yy: number) => `<circle cx="${x + 15}" cy="${yy}" r="6" fill="#fff" stroke="#b45309" stroke-width="2" stroke-dasharray="3 2"/>`, text: 'Not recorded' }] : [])];
  parts.push(`<line x1="24" y1="${y}" x2="${W - 24}" y2="${y}" stroke="#e2e8f0"/>`); y += 20;
  let lx = 24; for (const e of ents) { const w = 40 + e.text.length * 5.7 + 22; if (lx + w > W - 24) { lx = 24; y += 18; } parts.push(e.icon(lx, y - 4), t(lx + 38, y, e.text, 'font-size="10.5" fill="#334155"')); lx += w; }
  y += 20;
  parts.push(t(24, y, `Details panel: procedure points, notes, ${s.unknown.length} unknown / unresolved items, sources, revision.${issues.length ? `  ⚠ Layout check: ${issues.length} issue${issues.length > 1 ? 's' : ''}` : ''}`, `font-size="10.5" fill="${issues.length ? '#b91c1c' : '#64748b'}"`)); y += 14;
  parts.push(`<rect x="0" y="${y}" width="${W}" height="24" fill="#b91c1c"/>`, t(W / 2, y + 16, 'REFERENCE ONLY — NOT AN AUTHORIZATION FOR ISOLATION, LINE-UP, VALVE OPERATION OR CHEMICAL WORK', 'text-anchor="middle" fill="#fff" font-size="10" font-weight="800"'));
  const H = y + 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${parts.join('')}</svg>`;
  // every approved review rule is checked on the finished sheet
  const rules = checkRules(s, svg, issues); for (const f of rules.failed) if (!issues.includes(f)) issues.push(f);
  const info = schematicInfo(s, generatedAt);
  info.meta.push(['Review rules', `${rules.passed.length}/${DRAWING_RULES.length} passed${rules.failed.length ? ` — ${rules.failed.join('; ')}` : ''}`]); info.meta.push(['Layout', `${r.conts ? `folded, ${r.conts} continuation${r.conts > 1 ? 's' : ''}` : 'one band'} · ${r.crossings} crossing${r.crossings === 1 ? '' : 's'}`], ['Automatic check', issues.length ? issues.join('; ') : 'passed (connections, junctions, labels, crossings)']);
  return { svg, issues, info };
}
