// Multi-pass fired heater block (R17): the end of a route that splits into passes through one fired heater. Each pass
// keeps its own line through the heater: its instruments, the point where its injection water joins (upstream of the
// heater inlet), its own coil through the firebox and its own outlet; the outlets combine into the outlet header. The
// injection-water manifold feeds every branch from one distribution line; where it must pass a feed pass, the crossing
// is drawn with a break (it cannot be avoided: one manifold reaching every pass between the passes is not planar).
// Nothing is numbered or tagged that the records do not give; a pass ↔ injection pairing that is not recorded is
// marked unverified. Local coordinates flowing left to right; the split's symbol row is y = 0 (its pipe at y + 26).
import { nodeH, nodeW, type Pt } from './schematicFold';
import { esc, HW, ROLE_STYLE, wrap, type Schematic, type SLink } from './schematic';

export type Bx = { x0: number; x1: number; y0: number; y1: number };
export interface HeaterBlock { pos: Map<string, Pt>; paths: { l: SLink; pts: Pt[]; arrow: boolean }[]; extra: { draw: (T: (p: Pt) => Pt) => string; boxes: Bx[] }[];
  bare: Set<string>; hops: Pt[]; w: number; boxes: Bx[]; notes: string[]; anchors: Map<string, Pt> }

export function heaterBlock(s: Schematic, keys: Set<string>, T: string): HeaterBlock | null {
  const node = new Map(s.nodes.map((n) => [n.key, n]));
  const links = s.links.filter((l) => keys.has(l.a) && keys.has(l.b)); const act = links.filter((l) => l.role === 'active');
  const outs = act.filter((l) => l.a === T); if (outs.length < 2) return null;
  // the passes: split → items → (injection point) → heater
  let H: string | null = null; const passes: { items: string[]; mix: string | null; first: SLink; toH: SLink; links: SLink[] }[] = [];
  for (const o of outs) { const items: string[] = [], ls: SLink[] = [o]; let k = o.b, prev = o;
    for (let n = 0; n < 12 && node.get(k)!.kind !== 'heater'; n++) { items.push(k); const nx = act.filter((l) => l.a === k); if (nx.length !== 1 || act.filter((l) => l.b === k).length !== 1) return null; prev = nx[0]; ls.push(prev); k = prev.b; }
    if (node.get(k)!.kind !== 'heater' || (H && H !== k)) return null; H = k;
    const last = items[items.length - 1]; const mix = last && node.get(last)!.kind === 'junction' && links.some((l) => l.b === last && l.role === 'injection') ? last : null;
    passes.push({ items: mix ? items.slice(0, -1) : items, mix, first: o, toH: prev, links: ls }); }
  if (!H) return null; const heater = H;
  const withMix = passes.filter((p) => p.mix).length; if (withMix && withMix !== passes.length) return null;
  // injection: manifold → items → injection point, one branch per pass
  let M: string | null = null; const inj: { items: string[]; links: SLink[] }[] = [];
  for (const p of passes) { if (!p.mix) break; const items: string[] = [], ls: SLink[] = []; let k = p.mix;
    for (let n = 0; n < 8; n++) { const ins = links.filter((l) => l.b === k && l.role === 'injection'); if (ins.length !== 1) return null; ls.unshift(ins[0]); const a = ins[0].a;
      if (!links.some((l) => l.b === a)) { if (M && M !== a) return null; M = a; break; } items.unshift(a); k = a; }
    if (!M) return null; inj.push({ items, links: ls }); }
  const hOut = act.filter((l) => l.a === heater); if (hOut.length > 1) return null; const O = hOut[0]?.b ?? null;
  if (O && (node.get(O)!.kind !== 'junction' || links.some((l) => l.a === O))) return null;
  const covered = new Set([T, heater, ...(O ? [O] : []), ...(M ? [M] : []), ...passes.flatMap((p) => [...p.items, ...(p.mix ? [p.mix] : [])]), ...inj.flatMap((i) => i.items)]);
  if ([...keys].some((k) => !covered.has(k))) return null;
  const drawn = new Set([...passes.flatMap((p) => p.links.map((l) => l.key)), ...inj.flatMap((i) => i.links.map((l) => l.key)), ...hOut.map((l) => l.key)]);
  if (links.some((l) => !drawn.has(l.key))) return null;

  // --- columns ---
  const N = passes.length; const W_ = (k: string) => nodeW(node.get(k)!), H_ = (k: string) => nodeH(node.get(k)!);
  const xT = W_(T) / 2, xh = xT + 22;
  const colsOf = (rows: string[][]) => { const n = Math.max(0, ...rows.map((r) => r.length)); return Array.from({ length: n }, (_, c) => Math.max(56, ...rows.filter((r) => r[c]).map((r) => W_(r[c])))); };
  const pw = colsOf(passes.map((p) => p.items)); const colX: number[] = []; let x = xh + 50; for (const w of pw) { x += w / 2; colX.push(x); x += w / 2 + 60; }
  let xm = 0, xmix = 0; const injX: number[] = [];
  if (M) { xm = x + 10; x = xm + 50; for (const w of colsOf(inj.map((i) => i.items))) { x += w / 2; injX.push(x); x += w / 2 + 60; } xmix = x + 10; x = xmix + 70; } else x += 30;
  const xl = x, HWID = 150, xr = xl + HWID, xc = xl + HWID / 2, xo = xr + 56;
  // --- rows: a feed pass, then its injection branch just under it (in the columns right of the manifold line) ---
  const maxInj = Math.max(0, ...inj.flatMap((i) => i.items.map(H_))), maxPass = Math.max(0, ...passes.flatMap((p) => p.items.map(H_)));
  const P = Math.max(124, M ? 30 + maxInj : 0, maxPass + 34);
  const py = (i: number) => i * P + 26, iy = (i: number) => i * P + 44;
  const pos = new Map<string, Pt>([[T, { x: xT, y: 0 }]]); const paths: HeaterBlock['paths'] = [];
  const pin = (k: string): Pt => ({ x: pos.get(k)!.x - HW[node.get(k)!.kind], y: pos.get(k)!.y + 26 }), pout = (k: string): Pt => ({ x: pos.get(k)!.x + HW[node.get(k)!.kind], y: pos.get(k)!.y + 26 });
  passes.forEach((p, i) => { p.items.forEach((k, c) => pos.set(k, { x: colX[c], y: i * P })); if (p.mix) pos.set(p.mix, { x: xmix, y: i * P }); });
  inj.forEach((b, i) => b.items.forEach((k, c) => pos.set(k, { x: injX[c], y: iy(i) })));
  pos.set(heater, { x: xc, y: 0 });
  // feed passes
  passes.forEach((p, i) => { const y = py(i);
    p.links.forEach((l) => { const a = l.a === T ? { x: xT + HW.junction, y: 26 } : node.get(l.a)!.kind === 'junction' ? { x: xmix, y } : pout(l.a);
      const toH = l.b === heater, toMix = l.b === p.mix; const b = toH ? { x: xl, y } : toMix ? { x: xmix, y } : pin(l.b);
      const pts = l.a === T && i > 0 ? [a, { x: xh, y: 26 }, { x: xh, y }, b] : [a, b];
      paths.push({ l, pts, arrow: !toMix }); }); });
  // injection branches: from the manifold's distribution line, under their pass, rising into the injection point
  const hops: Pt[] = []; let yM = 0;
  if (M) { yM = (N - 1) * P + 44 + maxInj + 20; const xM = xm - 60; pos.set(M, { x: xM, y: yM });
    inj.forEach((b, i) => { const yy = iy(i) + 26;
      b.links.forEach((l) => { const a = l.a === M ? null : pout(l.a); const toMix = l.b === passes[i].mix;
        const end = toMix ? [{ x: xmix, y: yy }, { x: xmix, y: py(i) }] : [pin(l.b)];
        const pts = a ? [a, ...end] : [{ x: xM + HW[node.get(M!)!.kind], y: yM + 26 }, { x: xm, y: yM + 26 }, { x: xm, y: yy }, ...end];
        paths.push({ l, pts, arrow: !toMix }); }); });
    for (let j = 1; j < N; j++) hops.push({ x: xm, y: py(j) }); }
  // heater outlets into the outlet header
  const yOut = (py(0) + py(N - 1)) / 2;
  if (O) { pos.set(O, { x: xo, y: yOut - 26 });
    passes.forEach((_, i) => paths.push({ l: hOut[0], pts: Math.abs(py(i) - yOut) < 0.5 ? [{ x: xr, y: py(i) }, { x: xo, y: yOut }] : [{ x: xr, y: py(i) }, { x: xo, y: py(i) }, { x: xo, y: yOut }], arrow: false }));
    paths.push({ l: hOut[0], pts: [{ x: xo, y: yOut }, { x: xo + 120, y: yOut }], arrow: true }); }

  // --- drawing the block itself: the fired heater with one coil per pass, the outlet header's name, the unverified pairing ---
  const extra: HeaterBlock['extra'] = []; const top = py(0) - 44, bot = py(N - 1) + 44; const hn = node.get(heater)!;
  const c = hn.state === 'standby' ? '#94a3b8' : '#0f172a';
  const anchor = (T2: (p: Pt) => Pt, a: 'start' | 'end') => (T2({ x: 1, y: 0 }).x < T2({ x: 0, y: 0 }).x ? (a === 'start' ? 'end' : 'start') : a);
  extra.push({ draw: (T2) => { const p = (x0: number, y0: number) => { const q = T2({ x: x0, y: y0 }); return `${q.x},${q.y}`; };
    const box = [p(xl, top), p(xr, top), p(xr, bot), p(xl, bot)].join(' ');
    const conv = [p(xl + 14, top), p(xr - 14, top), p(xr - 40, top - 30), p(xl + 40, top - 30)].join(' ');
    const stack = [p(xc - 9, top - 30), p(xc + 9, top - 30), p(xc + 9, top - 64), p(xc - 9, top - 64)].join(' ');
    const coils = passes.map((_, i) => { const y = py(i); const pts = [p(xl, y)]; for (let xx = xl + 10, k = 0; xx < xr - 6; xx += 10, k++) pts.push(p(xx, y + (k % 2 ? 7 : -7))); pts.push(p(xr, y));
      return `<polyline points="${pts.join(' ')}" fill="none" stroke="${ROLE_STYLE.active.color}" stroke-width="2"/>`; }).join('');
    const flames = [-40, 0, 40].map((dx) => `<path d="M ${p(xc + dx, bot - 2)} Q ${p(xc + dx - 9, bot - 14)} ${p(xc + dx, bot - 26)} Q ${p(xc + dx + 9, bot - 14)} ${p(xc + dx, bot - 2)} Z" fill="#f97316" stroke="#c2410c" stroke-width="1"/><polygon points="${[p(xc + dx - 8, bot), p(xc + dx + 8, bot), p(xc + dx + 6, bot + 8), p(xc + dx - 6, bot + 8)].join(' ')}" fill="${c}"/>`).join('');
    const t = T2({ x: xc, y: bot + 28 }), t2 = T2({ x: xc, y: bot + 42 });
    return `<polygon points="${conv}" fill="#fff" stroke="${c}" stroke-width="2"/><polygon points="${stack}" fill="#fff" stroke="${c}" stroke-width="2"/><polygon points="${box}" fill="#fff" stroke="${c}" stroke-width="2.4"/>${coils}${flames}`
      + `<text x="${t.x}" y="${t.y}" text-anchor="middle" font-size="13" font-weight="800" fill="${c}">${esc(hn.tag)}</text><text x="${t2.x}" y="${t2.y}" text-anchor="middle" font-size="9.5" fill="#475569">Fired heater · ${N} passes, each through its own coil</text>`; },
    boxes: [{ x0: xl - 2, x1: xr + 2, y0: top - 66, y1: bot + 48 }] });
  if (O) { const on = node.get(O)!; const ls = wrap(on.label ?? 'Outlet header', 24); const col = on.state === 'unresolved' ? '#b45309' : '#0f172a';
    extra.push({ draw: (T2) => ls.map((w, i) => { const q = T2({ x: xo + 12, y: yOut - 10 - (ls.length - 1 - i) * 12 }); return `<text x="${q.x}" y="${q.y}" text-anchor="${anchor(T2, 'start')}" font-size="10" font-weight="${i ? 400 : 700}" fill="${col}">${esc(w)}</text>`; }).join(''),
      boxes: [{ x0: xo + 8, x1: xo + 16 + 24 * 6, y0: yOut - 22 - (ls.length - 1) * 12, y1: yOut - 4 }] }); }
  const notes: string[] = [];
  if (M && inj.some((b) => b.links.some((l) => l.basis !== 'verified' && l.basis !== 'user_verified'))) {
    const msg = 'UNVERIFIED — which injection branch joins which pass is not recorded';
    extra.push({ draw: (T2) => { const q = T2({ x: xm + 12, y: yM + 14 }); return `<text x="${q.x}" y="${q.y}" text-anchor="${anchor(T2, 'start')}" font-size="9.5" font-weight="700" fill="#b45309">${esc(msg)}</text>`; },
      boxes: [{ x0: xm + 8, x1: xm + 16 + msg.length * 5.4, y0: yM + 2, y1: yM + 18 }] });
    notes.push(`${hn.tag}: the injection branches are drawn into the passes in tag order; which branch joins which pass is not recorded (unverified).`); }
  let yBottomExtra = 0;
  const bare = new Set([heater, ...(O ? [O] : []), ...passes.flatMap((p) => (p.mix ? [p.mix] : []))]);
  const w = (O ? xo + 130 : xr + 20) + 10;
  const yBottom = M ? yM + Math.max(H_(M!), s.marks.some((m) => m.on?.at === 'node' && m.on.a === M) ? 130 : 0) + 20 : bot + 50;
  if (s.marks.some((m) => m.kind === 'protection' && m.on?.a === heater)) yBottomExtra = 80;
  return { pos, paths, extra, bare, hops, anchors: new Map([[heater, { x: xc, y: bot + 50 }]]), w, boxes: [{ x0: 0, x1: w, y0: top - 76, y1: Math.max(yBottom, bot + 50 + yBottomExtra) }], notes };
}
