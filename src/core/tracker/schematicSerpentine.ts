// Serpentine layout (R16): the active route is split into blocks — single items, exchanger groups (the items one bypass
// goes around, with that bypass and its valve drawn just above them) and the end block (the split, the passes, the
// heater and what feeds it) — and the blocks are placed on rows that alternate direction, joined by continuous 180°
// turns at the row ends. Every row split is tried; renderFolded keeps the most compact clean one with a balanced shape.
// Topology is never changed. Where two bypasses would overlap only because the order of a takeoff and an inline valve
// on a line is not recorded, the takeoff is drawn past that valve and a note says so.
import { columns, geometry, nodeH, nodeW, type Geo, type Pt } from './schematicFold';
import { HW, type Schematic, type SLink } from './schematic';

/** space a block takes (local coordinates): rows are packed so that boxes of different rows do not touch */
type Bx = { x0: number; x1: number; y0: number; y1: number };
type Path = { l: SLink; pts: Pt[]; arrow: boolean };
interface Unit { kind: 'single' | 'group' | 'tail'; chain: string[]; w: number; minX: number; boxes: Bx[];
  pos: Map<string, Pt>; dir: Map<string, number>; paths: Path[]; tall: Map<string, { top: number; bot: number }>; joinsBelow: Set<string>; issues: string[] }

const gapFor = (l?: SLink) => Math.max(70, l ? l.lines.slice(0, 2).join(', ').length * 6.2 + 30 : 0);

export function serpentine(s: Schematic, top: number): Geo[] {
  const node = new Map(s.nodes.map((n) => [n.key, n]));
  const act = s.links.filter((l) => l.role === 'active');
  const srcs = s.nodes.filter((n) => act.some((l) => l.a === n.key) && !act.some((l) => l.b === n.key));
  if (srcs.length !== 1) return [];
  // the active route up to the first split
  const chain = [srcs[0].key];
  for (;;) { const outs = act.filter((l) => l.a === chain[chain.length - 1]); if (outs.length !== 1) break; const nx = outs[0].b;
    if (chain.includes(nx)) return []; if (act.filter((l) => l.b === nx).length !== 1) return []; chain.push(nx); }
  if (chain.length < 4) return [];
  const T = chain[chain.length - 1]; const hasTail = act.filter((l) => l.a === T).length >= 2;
  const ci = (k: string) => chain.indexOf(k);
  const tailSet = new Set<string>(); if (hasTail) { const q = [T]; while (q.length) { const k = q.pop()!; if (tailSet.has(k)) continue; tailSet.add(k); for (const l of act) if (l.a === k) q.push(l.b); } }
  for (const k of chain.slice(0, -1)) if (tailSet.has(k)) return [];
  // the other branches: bypass groups, branches into a junction of the route (satellites), branches of the end block
  const rest = s.nodes.filter((n) => !chain.includes(n.key) && !tailSet.has(n.key)).map((n) => n.key); const seen = new Set<string>(); const comps: string[][] = [];
  for (const k0 of rest) { if (seen.has(k0)) continue; const comp = [k0]; seen.add(k0);
    for (let i = 0; i < comp.length; i++) for (const l of s.links) for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) if (x === comp[i] && rest.includes(y) && !seen.has(y)) { seen.add(y); comp.push(y); }
    comps.push(comp); }
  const linear = (comp: string[]) => { const inner = s.links.filter((l) => comp.includes(l.a) && comp.includes(l.b)); const first = comp.filter((k) => !inner.some((l) => l.b === k));
    if (first.length !== 1) return null; const ord = [first[0]]; for (;;) { const o = inner.filter((l) => l.a === ord[ord.length - 1]); if (!o.length) break; if (o.length > 1) return null; ord.push(o[0].b); }
    return ord.length === comp.length ? ord : null; };
  type Group = { by: string[]; from: number; to: number; lo: number; hi: number; atJ: boolean; inL: SLink; outL: SLink };
  const groups: Group[] = []; const sats: { at: string; ord: string[]; last: SLink }[] = [];
  for (const comp of comps) {
    const ext = s.links.filter((l) => comp.includes(l.a) !== comp.includes(l.b)); const ord = linear(comp);
    if (hasTail && ext.every((l) => tailSet.has(comp.includes(l.a) ? l.b : l.a))) { comp.forEach((k) => tailSet.add(k)); continue; }
    const ins = ext.filter((l) => comp.includes(l.b)), outs = ext.filter((l) => comp.includes(l.a));
    if (ord && ins.length === 1 && outs.length === 1 && s.links.filter((l) => comp.includes(l.a) || comp.includes(l.b)).every((l) => l.role === 'bypass') && ins[0].b === ord[0] && outs[0].a === ord[ord.length - 1]) {
      const i = ci(ins[0].a), j = ci(outs[0].b); if (i < 0 || j <= i) return [];
      const atJ = node.get(chain[i])!.kind === 'junction'; groups.push({ by: ord, from: i, to: j, lo: atJ ? i : i + 1, hi: j - 1, atJ, inL: ins[0], outL: outs[0] }); continue; }
    if (ord && !ins.length && outs.length === 1 && outs[0].a === ord[ord.length - 1] && ci(outs[0].b) >= 0 && node.get(outs[0].b)!.kind === 'junction') { sats.push({ at: outs[0].b, ord, last: outs[0] }); continue; }
    return [];
  }
  // overlapping groups: move a takeoff past an inline valve (its order on the line is not recorded), else the rejoin back
  const notes: string[] = []; const inline = (k: string) => ['valve', 'junction'].includes(node.get(k)!.kind);
  const tagOf = (k: string) => node.get(k)!.tag.replace(/^J:/, '');
  groups.sort((a, b) => a.lo - b.lo);
  for (let n = 1; n < groups.length; n++) { const p = groups[n - 1], g = groups[n]; const movedS: string[] = [], movedE: string[] = [];
    while (g.lo <= p.hi) {
      if (g.lo < g.hi && inline(chain[g.lo]) && !(g.atJ && g.lo === g.from)) { movedS.push(tagOf(chain[g.lo])); g.lo++; }
      else if (g.atJ && g.lo === g.from && g.lo < g.hi) { g.atJ = false; g.lo++; }
      else if (p.hi > p.lo && inline(chain[p.hi])) { movedE.push(tagOf(chain[p.hi])); p.hi--; }
      else return [];
    }
    if (movedS.length) notes.push(`${g.by.map(tagOf).join(' / ')} bypass is drawn leaving the line after ${movedS.join(', ')}: the order of its takeoff and ${movedS.join(', ')} on the line is not recorded.`);
    if (movedE.length) notes.push(`${p.by.map(tagOf).join(' / ')} bypass is drawn rejoining the line before ${movedE.join(', ')}: their order on the line is not recorded.`); }
  if (groups.some((g) => g.lo > g.hi || (hasTail && g.hi >= chain.length - 1))) return [];

  // --- blocks (local coordinates, flowing left to right; y = 0 is the route's symbol row, pipes at y + 26) ---
  const linkOf = (a: string, b: string) => s.links.find((l) => l.a === a && l.b === b);
  const portIn = (u: Unit, k: string): Pt => { const p = u.pos.get(k)!, d = u.dir.get(k) ?? 1; return { x: p.x - d * HW[node.get(k)!.kind], y: p.y + 26 }; };
  const portOut = (u: Unit, k: string): Pt => { const p = u.pos.get(k)!, d = u.dir.get(k) ?? 1, n = node.get(k)!; return { x: p.x + d * (HW[n.kind] + (n.kind === 'pump' ? 4 : 0)), y: p.y + (n.kind === 'pump' ? 10 : 26) }; };
  const straight = (a: Pt, b: Pt): Pt[] => (Math.abs(a.y - b.y) < 0.5 ? [a, b] : [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b]);
  const blank = (kind: Unit['kind'], ch: string[]): Unit => ({ kind, chain: ch, w: 0, minX: 0, boxes: [], pos: new Map(), dir: new Map(), paths: [], tall: new Map(), joinsBelow: new Set(), issues: [] });
  const markOn = (k: string, kind: string) => s.marks.some((m) => m.on?.at === 'node' && m.on.a === k && m.kind === kind);
  const band = (ks: string[], w: number): Bx => ({ x0: 0, x1: w, y0: ks.some((k) => markOn(k, 'vent')) ? -70 : -24, y1: Math.max(...ks.map((k) => (markOn(k, 'drain') ? 130 : nodeH(node.get(k)!)))) + 10 });
  // a branch into a junction of the route: drawn on a row below, behind (flowing forward) or ahead of it (flowing back)
  const addSat = (u: Unit, ahead: boolean) => { for (const sat of sats.filter((x) => u.pos.has(x.at))) {
    const j = u.pos.get(sat.at)!; const yS = Math.max(150, ...u.chain.map((k) => nodeH(node.get(k)!) + 40)); const d = ahead ? -1 : 1;
    let x = j.x - d * 40; for (let i = sat.ord.length - 1; i >= 0; i--) { const k = sat.ord[i], w = nodeW(node.get(k)!); const gp = i < sat.ord.length - 1 ? gapFor(linkOf(k, sat.ord[i + 1])) : 20;
      x -= d * (gp + w / 2); u.pos.set(k, { x, y: yS }); u.dir.set(k, d); x -= d * (w / 2); }
    for (let i = 0; i + 1 < sat.ord.length; i++) u.paths.push({ l: linkOf(sat.ord[i], sat.ord[i + 1])!, pts: straight(portOut(u, sat.ord[i]), portIn(u, sat.ord[i + 1])), arrow: true });
    const a = portOut(u, sat.ord[sat.ord.length - 1]); u.paths.push({ l: sat.last, pts: [a, { x: j.x, y: a.y }, { x: j.x, y: j.y + 26 }], arrow: false });
    u.joinsBelow.add(sat.at); u.minX = Math.min(u.minX, x); u.w = Math.max(u.w, x);
    u.boxes.push({ x0: Math.min(x, j.x) - 10, x1: Math.max(x, j.x) + 10, y0: yS - 14, y1: yS + Math.max(...sat.ord.map((k) => nodeH(node.get(k)!))) + 16 }); } };
  const single = (k: string, ahead: boolean): Unit => { const u = blank('single', [k]); const n = node.get(k)!; const w = nodeW(n);
    u.pos.set(k, { x: w / 2, y: 0 }); u.w = w; u.boxes.push(band([k], w)); addSat(u, ahead); return u; };
  const group = (g: Group, ahead: boolean): Unit => { const ms = chain.slice(g.lo, g.hi + 1); const u = blank('group', ms);
    const ws = ms.map((k) => nodeW(node.get(k)!)), gaps = ms.slice(0, -1).map((k, i) => gapFor(linkOf(k, ms[i + 1])));
    const bw = g.by.map((k) => nodeW(node.get(k)!)), bTot = bw.reduce((a, b) => a + b, 0) + g.by.slice(0, -1).reduce((t, k, i) => t + gapFor(linkOf(k, g.by[i + 1])), 0);
    const sL = g.atJ ? 0 : 60, span = ws.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
    const xT0 = g.atJ ? ws[0] / 2 : 36, xR0 = sL + span + 60; const extra = Math.max(0, bTot + 2 * 56 - (xR0 - xT0));
    let x = sL + extra / 2; ms.forEach((k, i) => { x += ws[i] / 2; u.pos.set(k, { x, y: 0 }); x += ws[i] / 2 + (gaps[i] ?? 0); });
    const xT = g.atJ ? u.pos.get(ms[0])!.x : 36, xR = x + extra / 2 + 60; u.w = xR + 24;
    const yB = -(Math.max(...g.by.map((k) => nodeH(node.get(k)!))) + (ms.some((k) => markOn(k, 'vent')) ? 76 : 36));
    let bx = (xT + xR) / 2 - bTot / 2; g.by.forEach((k, i) => { bx += bw[i] / 2; u.pos.set(k, { x: bx, y: yB }); bx += bw[i] / 2 + (i < g.by.length - 1 ? gapFor(linkOf(k, g.by[i + 1])) : 0); });
    for (let i = 0; i + 1 < ms.length; i++) { const l = linkOf(ms[i], ms[i + 1]); if (l) u.paths.push({ l, pts: straight(portOut(u, ms[i]), portIn(u, ms[i + 1])), arrow: node.get(ms[i + 1])!.kind !== 'junction' }); }
    const b0 = portIn(u, g.by[0]), b1 = portOut(u, g.by[g.by.length - 1]);
    u.paths.push({ l: g.inL, pts: [{ x: xT, y: 26 }, { x: xT, y: b0.y }, b0], arrow: true });
    for (let i = 0; i + 1 < g.by.length; i++) u.paths.push({ l: linkOf(g.by[i], g.by[i + 1])!, pts: straight(portOut(u, g.by[i]), portIn(u, g.by[i + 1])), arrow: true });
    u.paths.push({ l: g.outL, pts: [b1, { x: xR, y: b1.y }, { x: xR, y: 26 }], arrow: true });
    u.boxes.push(band(ms, u.w), { x0: xT - 14, x1: xR + 14, y0: yB - 24, y1: -24 }); addSat(u, ahead); return u; };
  const tail = (): Unit | null => { const ks = s.nodes.filter((n) => tailSet.has(n.key));
    const s2: Schematic = { ...s, nodes: ks, links: s.links.filter((l) => tailSet.has(l.a) && tailSet.has(l.b)) };
    const g = geometry(s2, columns(s2), [], 0, true, false); const t = g.pos.get(T)!; const u = blank('tail', [T]);
    const ys = [...g.pos.values()].map((p) => p.y);
    for (const [k, p] of g.pos) u.pos.set(k, { x: p.x - 24, y: p.y - t.y });
    u.paths = g.paths.map((p) => ({ ...p, pts: p.pts.map((q) => ({ x: q.x - 24, y: q.y - t.y })) }));
    for (const [k, v] of g.tall) u.tall.set(k, { top: v.top - t.y, bot: v.bot - t.y });
    g.joinsBelow.forEach((k) => u.joinsBelow.add(k)); u.issues = g.issues;
    u.w = g.W - 48; u.boxes.push({ x0: 0, x1: u.w, y0: Math.min(...ys) - t.y - 30, y1: g.H - t.y }); return u; };

  // --- the blocks in route order ---
  const out: Geo[] = [];
  for (const ahead of sats.length ? [false, true] : [false]) {
    const units: Unit[] = [];
    for (let i = 0; i < chain.length;) { const g = groups.find((x) => x.lo === i);
      if (g) { units.push(group(g, ahead)); i = g.hi + 1; continue; }
      if (hasTail && i === chain.length - 1) { const u = tail(); if (!u) return []; units.push(u); i++; continue; }
      units.push(single(chain[i], ahead)); i++; }
    if (sats.some((x) => !units.some((u) => u.joinsBelow.has(x.at)))) return [];
    const U = units.length;
    // every split of the blocks into 1 – 4 rows
    for (let mask = 0; mask < 1 << (U - 1); mask++) {
      const breaks = [...Array(U - 1).keys()].filter((b) => mask & (1 << b)); if (breaks.length > 3) continue;
      const rows: Unit[][] = []; let cur: Unit[] = []; units.forEach((u, i) => { cur.push(u); if (breaks.includes(i)) { rows.push(cur); cur = []; } }); rows.push(cur);
      out.push(place(rows, ahead));
    }
  }
  return out;

  function place(rows: Unit[][], ahead: boolean): Geo {
    // flow position of each block in its row
    const fs = new Map<Unit, number>(); const ext: { min: number; max: number }[] = [];
    for (const row of rows) { let f = 0; let mn = Infinity, mx = -Infinity;
      row.forEach((u, i) => { fs.set(u, f); mn = Math.min(mn, f + u.minX); mx = Math.max(mx, f + u.w); f += u.w;
        if (i < row.length - 1) f += gapFor(linkOf(u.chain[u.chain.length - 1], row[i + 1].chain[0])); });
      ext.push({ min: mn, max: mx }); }
    const leftTurns = rows.length > 2, rightTurns = rows.length > 1;
    const Lm = 24 + (leftTurns ? 44 : 0), maxW = Math.max(...ext.map((e) => e.max - e.min)), Rm = Lm + maxW;
    const W = Rm + (rightTurns ? 54 : 24);
    // rows packed down as far as their blocks allow (a bypass may sit in the empty space under the row above)
    const ys: number[] = []; const placed: Bx[] = [];
    rows.forEach((row, r) => { const d = r % 2 ? -1 : 1, e = ext[r]; const X = (f: number) => (d === 1 ? Lm + f - e.min : Rm - (f - e.min));
      const bs: Bx[] = row.flatMap((u) => u.boxes.map((b) => { const a = X(fs.get(u)! + b.x0), c = X(fs.get(u)! + b.x1); return { x0: Math.min(a, c), x1: Math.max(a, c), y0: b.y0, y1: b.y1 }; }));
      // the pipe to and from the turns at the row ends
      if (r > 0) { const q = X(fs.get(row[0])!); bs.push({ x0: Math.min(q, d === 1 ? Lm - 40 : Rm + 40), x1: Math.max(q, d === 1 ? Lm - 40 : Rm + 40), y0: 10, y1: 42 }); }
      if (r < rows.length - 1) { const q = X(fs.get(row[row.length - 1])! + row[row.length - 1].w); bs.push({ x0: Math.min(q, d === 1 ? Rm + 40 : Lm - 40), x1: Math.max(q, d === 1 ? Rm + 40 : Lm - 40), y0: 10, y1: 42 }); }
      let y = top - Math.min(...bs.map((b) => b.y0));
      for (const b of bs) for (const o of placed) if (b.x0 < o.x1 && o.x0 < b.x1) y = Math.max(y, o.y1 + 22 - b.y0);
      ys.push(y); placed.push(...bs.map((b) => ({ ...b, y0: b.y0 + y, y1: b.y1 + y }))); });
    const H = Math.max(...placed.map((b) => b.y1)) + 10;
    const pos = new Map<string, Pt>(); const paths: Path[] = []; const tall = new Map<string, { top: number; bot: number }>(); const joinsBelow = new Set<string>(); const issues: string[] = [];
    const gdir = new Map<string, number>(); const rowOf = new Map<string, number>();
    rows.forEach((row, r) => { const d = r % 2 ? -1 : 1, e = ext[r];
      const X = (f: number) => (d === 1 ? Lm + f - e.min : Rm - (f - e.min));
      for (const u of row) { const f0 = fs.get(u)!; const T2 = (q: Pt): Pt => ({ x: X(f0 + q.x), y: ys[r] + q.y });
        for (const [k, p] of u.pos) { pos.set(k, T2(p)); gdir.set(k, d * (u.dir.get(k) ?? 1)); rowOf.set(k, r); }
        for (const p of u.paths) paths.push({ ...p, pts: p.pts.map(T2) });
        for (const [k, v] of u.tall) tall.set(k, { top: ys[r] + v.top, bot: ys[r] + v.bot });
        u.joinsBelow.forEach((k) => joinsBelow.add(k)); issues.push(...u.issues); } });
    const gIn = (k: string): Pt => { const p = pos.get(k)!; return { x: p.x - gdir.get(k)! * HW[node.get(k)!.kind], y: p.y + 26 }; };
    const gOut = (k: string): Pt => { const p = pos.get(k)!, n = node.get(k)!; return { x: p.x + gdir.get(k)! * (HW[n.kind] + (n.kind === 'pump' ? 4 : 0)), y: p.y + (n.kind === 'pump' ? 10 : 26) }; };
    // the route between blocks: straight on a row, a continuous 180° turn at the row end between rows (R14)
    const units = rows.flat();
    for (let i = 0; i + 1 < units.length; i++) { const a = units[i].chain[units[i].chain.length - 1], b = units[i + 1].chain[0]; const l = linkOf(a, b); if (!l) continue;
      const p = gOut(a), q = gIn(b); const ra = rowOf.get(a)!, rb = rowOf.get(b)!; const arrow = node.get(b)!.kind !== 'junction';
      if (ra === rb) { paths.push({ l, pts: straight(p, q), arrow }); continue; }
      const xt = ra % 2 ? Lm - 30 : Rm + 30; paths.push({ l, pts: [p, { x: xt, y: p.y }, { x: xt, y: q.y }, q], arrow }); }
    const n = rows.length; const name = n === 1 ? 'one row (exchanger groups)' : `${n} rows, serpentine (exchanger groups${ahead ? ', standby ahead' : ''})`;
    return { pos, paths, tall, contParts: [], contBoxes: [], joinsBelow, issues, W, H, bandLines: [], conts: 0, notes, name };
  }
}
