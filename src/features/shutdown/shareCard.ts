// The start-up as a picture for WhatsApp (owner, 28 Oct 2026, option C of the second mock-up): a 1080-wide card
// drawn on the phone, 4:5 when it fits so it shows whole in a chat. On top two equal tiles: the progress ring, and the
// time management asks for: when the black oil is cut in, with a bar counting down to it; under them three chips
// (cut-in, all black oil and 42 KBPD, from the SOP table). Colours after the blue, red and green of the company mark
// (owner, B2), with no name or logo. Under them the time column of the steps still to do (the
// finished ones are one line). Times are rounded to the half hour. Nothing is uploaded: the phone's share sheet sends it.
export interface CardRow {
  kind: 'done' | 'run' | 'next' | 'oil' | 'hold';
  start: string; end: string; date: string; title: string; sub: string | null; right: string;
}
export interface CardData {
  title: string; when: string; pct: number;
  /** the orange tile: what (BLACK OIL CUT-IN), when (11:30 PM), the day, the countdown bar (0–1, share of the wait
   *  from the start-up's first step to the cut-in that has passed) and how long is left with the full rate */
  box: { label: string; big: string; line1: string; bar: number | null; line2: string | null } | null;
  /** the ring tile's line ("6 of 8 steps done"); under the tiles the running step and the holds. No late, behind or
   *  over plan anywhere in the picture (owner, 28 Oct 2026). */
  steps: string; running: string | null; hold: string | null;
  /** the milestones under the tiles: the cut-in (blue), all black oil (red), 42 KBPD (green) */
  chips: { label: string; big: string; sub: string; color: 'blue' | 'red' | 'green' }[];
  rows: CardRow[]; footLeft: string; footRight: string;
}

const W = 1080, MIN_H = 1350;
const C = { blue: '#0b3c8c', brandRed: '#d71920', brandRedDark: '#a3141a', brandGreen: '#00873e', ink: '#172235', grey: '#64748b', light: '#e5e7eb', green: '#16a34a', red: '#dc2626', sky: '#0284c7', note: '#b45309' };
const FONT = '-apple-system, "Segoe UI", Roboto, system-ui, sans-serif';
const ROW = { done: { dot: C.brandGreen, bg: '#eef8f2', title: C.brandGreen }, run: { dot: C.blue, bg: '#eef3fb', title: C.ink }, next: { dot: '#cbd5e1', bg: '#ffffff', title: C.ink },
  oil: { dot: C.brandRed, bg: '#fdeeee', title: C.brandRedDark }, hold: { dot: C.sky, bg: '#f0f9ff', title: '#0369a1' } } as const;

/** A sentence in lines that fit the width: whole, never cut (a word longer than the line is broken). */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = []; let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max) { line = next; continue; }
    if (line) out.push(line);
    let w = word;
    while (ctx.measureText(w).width > max && w.length > 1) { let k = w.length - 1; while (k > 1 && ctx.measureText(w.slice(0, k)).width > max) k--; out.push(w.slice(0, k)); w = w.slice(k); }
    line = w;
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
const font = (ctx: CanvasRenderingContext2D, size: number, weight = 400) => { ctx.font = `${weight} ${size}px ${FONT}`; };
function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
}
type Line = { t: string; x: number; y: number; size: number; weight: number; color: string; align?: CanvasTextAlign };

function layout(ctx: CanvasRenderingContext2D, d: CardData, k: number) {
  const L: Line[] = []; const shapes: ((c: CanvasRenderingContext2D) => void)[] = [];
  const put = (t: string, x: number, y: number, size: number, weight: number, color: string, max: number, align: CanvasTextAlign = 'left') => {
    font(ctx, size, weight); const lines = wrap(ctx, t, max); const lh = Math.round(size * 1.22);
    lines.forEach((l, i) => L.push({ t: l, x, y: y + i * lh, size, weight, color, align }));
    return lines.length * lh;
  };
  // header
  font(ctx, 52, 800); const tl = wrap(ctx, d.title, W - 100).length; const headH = 56 + tl * 64 + 44;
  shapes.push((c) => { c.fillStyle = C.blue; c.fillRect(0, 0, W, headH); });
  const hy = 74 + put(d.title, 50, 74, 52, 800, '#ffffff', W - 100); put(d.when, 50, hy + 2, 28, 400, 'rgba(255,255,255,0.8)', W - 100);
  // two equal tiles: the ring with the steps done; the black oil cut-in with its countdown
  const top = headH + 34, gap = 28, tw = (W - 100 - gap) / 2, ox = 50 + tw + gap; const r = 110; const cx = 50 + tw / 2, cy = top + 40 + r;
  let ly = cy + r + 17 + 50;
  ly += put(d.steps, cx, ly, Math.round(30 * k), 500, C.ink, tw - 40, 'center');
  let by = top + 54; let tileH = 0;
  shapes.push((c) => {
    round(c, 50, top, tw, tileH, 26, '#e2e8f0'); round(c, 52, top + 2, tw - 4, tileH - 4, 24, '#ffffff');
    if (d.box) { const g = c.createLinearGradient(ox, top, ox + tw, top + tileH); g.addColorStop(0, C.brandRed); g.addColorStop(1, C.brandRedDark); round(c, ox, top, tw, tileH, 26, g); }
  });
  if (d.box) {
    const bx = ox + 30, bw = tw - 60; const box = d.box;
    by += put(box.label, bx, by, Math.round(26 * k), 800, 'rgba(255,255,255,0.92)', bw) + 6;
    by += put(box.big, bx, by + 64, 84, 900, '#ffffff', bw) + 12;
    by += put(box.line1, bx, by + 18, Math.round(30 * k), 600, '#ffffff', bw);
    if (box.bar !== null) {
      const barY = by + 22, f = Math.max(0, Math.min(1, box.bar));
      shapes.push((c) => { round(c, bx, barY, bw, 16, 8, 'rgba(255,255,255,0.3)'); if (f > 0) round(c, bx, barY, Math.max(16, bw * f), 16, 8, '#ffffff'); });
      by += 40;
    }
    // "6 h left · full rate …": one part a line
    if (box.line2) { by += 8; for (const part of box.line2.split(' · ')) by += put(part, bx, by + 30, Math.round(27 * k), 600, 'rgba(255,255,255,0.95)', bw); }
  }
  tileH = Math.max(ly - top + 10, by - top + 26);
  let ty = top + tileH + 18;
  // the three milestones, one chip each
  if (d.chips.length) {
    const cg = 20, y0 = ty, cw = (W - 100 - cg * (d.chips.length - 1)) / d.chips.length, ch = Math.round(150 * k);
    d.chips.forEach((chip, i) => {
      const x = 50 + i * (cw + cg), mid = x + cw / 2; const fill = chip.color === 'blue' ? C.blue : chip.color === 'red' ? C.brandRed : C.brandGreen;
      shapes.push((c) => round(c, x, y0, cw, ch, 22, fill));
      put(chip.label, mid, ty + Math.round(36 * k), Math.round(23 * k), 800, 'rgba(255,255,255,0.92)', cw - 24, 'center');
      put(chip.big, mid, ty + Math.round(92 * k), Math.round(50 * k), 900, '#ffffff', cw - 16, 'center');
      put(chip.sub, mid, ty + Math.round(130 * k), Math.round(23 * k), 500, 'rgba(255,255,255,0.95)', cw - 24, 'center');
    });
    ty += ch + 16;
  }
  // under the tiles: the running step and the holds
  if (d.running) ty += put(d.running, 50, ty + 30, Math.round(28 * k), 500, C.ink, W - 100);
  if (d.hold) ty += put(d.hold, 50, ty + 30, Math.round(26 * k), 500, '#0369a1', W - 100);
  ty += 24;
  // the time column: start (bold) over end and the date, a line with the dot, the step, actual / plan on the right
  const big = Math.round(31 * k), small = Math.round(24 * k), tcR = 230, railX = 258, bodyX = 288;
  const rows: { y: number; h: number; row: CardRow }[] = [];
  shapes.push((c) => { c.fillStyle = '#eef1f5'; c.fillRect(0, ty - 1, W, 2); });
  for (const row of d.rows) {
    const y0 = ty; const yy = y0 + 16 + big;
    font(ctx, big, 600); const rw = ctx.measureText(row.right).width;
    const th = put(row.title, bodyX, yy, big, 600, ROW[row.kind].title, W - bodyX - 60 - rw);
    L.push({ t: row.right, x: W - 50, y: yy, size: Math.round(big * 0.9), weight: row.kind === 'oil' ? 800 : 500, color: row.kind === 'oil' ? C.brandRedDark : C.grey, align: 'right' });
    const sh = row.sub ? put(row.sub, bodyX, yy + th - Math.round(big * 1.22) + Math.round(small * 1.3) + 4, small, 500, row.kind === 'done' || row.kind === 'hold' ? '#0369a1' : C.note, W - bodyX - 50) + 4 : 0;
    const tcol = row.kind === 'oil' ? C.brandRedDark : row.kind === 'next' ? C.grey : C.ink;
    L.push({ t: row.start, x: tcR, y: yy, size: Math.round(big * 0.95), weight: 800, color: tcol, align: 'right' });
    L.push({ t: row.end, x: tcR, y: yy + Math.round(small * 1.25), size: small, weight: 500, color: row.kind === 'oil' ? C.brandRedDark : C.grey, align: 'right' });
    L.push({ t: row.date, x: tcR, y: yy + Math.round(small * 2.35), size: Math.round(small * 0.85), weight: 500, color: '#94a3b8', align: 'right' });
    const h = Math.max(th + sh, Math.round(small * 2.6)) + 30; rows.push({ y: y0, h, row }); ty += h;
  }
  shapes.push((c) => rows.forEach(({ y, h, row }) => {
    c.fillStyle = ROW[row.kind].bg; c.fillRect(0, y, W, h);
    c.fillStyle = '#e2e8f0'; c.fillRect(railX - 2, y, 4, h);
    c.beginPath(); c.arc(railX, y + 16 + big * 0.62, 15, 0, Math.PI * 2); c.fillStyle = ROW[row.kind].dot; c.fill();
    c.fillStyle = '#eef1f5'; c.fillRect(0, y + h - 1, W, 2);
  }));
  // footer
  const foot = ty + 10;
  const fh = Math.max(put(d.footLeft, 50, foot + 46, 26, 500, C.grey, W / 2 - 60), put(d.footRight, W - 50, foot + 46, 26, 500, C.grey, W / 2 - 60, 'right'));
  return { L, shapes, height: foot + 26 + fh, ring: { cx, cy, r } };
}

export function drawCard(canvas: HTMLCanvasElement, d: CardData) {
  const probe = document.createElement('canvas').getContext('2d')!;
  // the largest text that fits 4:5 (shows whole in a chat); if even small text does not fit, the picture grows taller
  let lay = layout(probe, d, 1);
  for (const k of [0.94, 0.88, 0.82]) { if (lay.height <= MIN_H) break; lay = layout(probe, d, k); }
  canvas.width = W; canvas.height = Math.max(MIN_H, lay.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, canvas.height);
  for (const f of lay.shapes) f(ctx);
  // ring: progress by plan hours
  const { cx, cy, r } = lay.ring;
  ctx.lineCap = 'round'; ctx.lineWidth = 34; ctx.strokeStyle = C.light; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  if (d.pct > 0) { ctx.strokeStyle = d.pct >= 100 ? C.brandGreen : C.blue; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.min(100, d.pct)) / 100); ctx.stroke(); }
  font(ctx, 66, 900); ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(`${d.pct}%`, cx, cy + 18);
  font(ctx, 22, 500); ctx.fillStyle = C.grey; ctx.fillText('by plan hours', cx, cy + 50);
  for (const l of lay.L) { font(ctx, l.size, l.weight); ctx.fillStyle = l.color; ctx.textAlign = l.align ?? 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(l.t, l.x, l.y); }
}

/** The phone's share sheet with the picture (WhatsApp, …); where it cannot share a file, the picture is saved. */
export async function sharePicture(blob: Blob, name: string, caption: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], text: caption }); return 'shared'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return 'saved';
}

// ── Design A (owner, 13 Nov 2026): the start-up as a table, plan against actual face to face, with the reason ────────
export interface TableRow { label: string; sub: string; state: 'done' | 'run' | 'next'; oil: boolean; plan: [string, string]; act: [string, string]; varText: string; varRed: boolean; reason: string }
export interface TableCardData {
  title: string; when: string;
  kpis: { label: string; big: string; sub: string; tone: 'plain' | 'red' | 'green' | 'est' }[];
  /** under the figures: the estimate is not confirmed (owner, 13 Nov 2026: plan first, estimate secondary) */
  note?: string;
  /** the roadmap (option 2): each stage's plan bar (solid, the reference) and its estimate (dashed, under it) */
  roadmap?: { from: number; to: number; now: number; bars: { label: string; sub: string; state: 'done' | 'run' | 'next'; oil: boolean; planStart: number | null; planEnd: number | null; start: number | null; end: number | null }[] };
  rows: TableRow[]; footLeft: string; footRight: string;
}
export function drawTableCard(canvas: HTMLCanvasElement, d: TableCardData) {
  const probe = document.createElement('canvas').getContext('2d')!;
  const M = 30, cols = [{ x: M, w: 290 }, { x: 330, w: 170 }, { x: 510, w: 190 }, { x: 710, w: 110 }, { x: 830, w: W - M - 830 }];
  const draw = (ctx: CanvasRenderingContext2D | null) => {
    const lines: Line[] = []; const shapes: ((c: CanvasRenderingContext2D) => void)[] = [];
    const put = (t: string, x: number, y: number, size: number, weight: number, color: string, max: number, align: CanvasTextAlign = 'left') => {
      const c = ctx ?? probe; font(c, size, weight); const ls = wrap(c, t, max); const lh = Math.round(size * 1.24);
      ls.forEach((l, i) => lines.push({ t: l, x, y: y + i * lh, size, weight, color, align })); return ls.length * lh;
    };
    // header
    let y = 64; y += put(d.title, M + 10, y, 48, 800, '#ffffff', W - 2 * M - 20); y += put(d.when, M + 10, y + 4, 26, 400, 'rgba(255,255,255,0.85)', W - 2 * M - 20); const headH = y + 22;
    shapes.push((c) => { c.fillStyle = C.blue; c.fillRect(0, 0, W, headH); });
    // the three figures
    const ky = headH + 22, kg = 16, kw = (W - 2 * M - 2 * kg) / 3; let kh = 0;
    d.kpis.forEach((k, i) => {
      const x = M + i * (kw + kg); let h = 0;
      h += put(k.label.toUpperCase(), x + 18, ky + 36, 20, 800, C.grey, kw - 36);
      h += put(k.big, x + 18, ky + 44 + h + 8, 34, 800, k.tone === 'red' ? C.red : k.tone === 'green' ? C.green : k.tone === 'est' ? '#475569' : C.ink, kw - 36);
      if (k.sub) h += put(k.sub, x + 18, ky + 52 + h + 4, 21, 600, k.tone === 'red' ? C.red : C.grey, kw - 36);
      kh = Math.max(kh, h + 64);
    });
    d.kpis.forEach((k, i) => shapes.push((c) => {
      const x = M + i * (kw + kg);
      if (k.tone === 'est') { round(c, x, ky, kw, kh, 18, '#ffffff'); c.save(); c.setLineDash([10, 7]); c.lineWidth = 3; c.strokeStyle = '#94a3b8'; c.beginPath(); c.roundRect(x + 1.5, ky + 1.5, kw - 3, kh - 3, 17); c.stroke(); c.restore(); }
      else round(c, x, ky, kw, kh, 18, k.tone === 'red' ? '#fef2f2' : k.tone === 'green' ? '#ecfdf3' : '#f1f5f9');
    }));
    let ty = ky + kh + 18;
    if (d.note) { const ny = ty; const nh = put(d.note, M + 18, ty + 32, 21, 500, '#92400e', W - 2 * M - 36) + 24; shapes.push((c) => round(c, M, ny, W - 2 * M, nh, 14, '#fffbeb')); ty += nh + 18; }
    // the roadmap: plan bar first (solid), the estimate under it (dashed); done green, over plan striped, now orange
    if (d.roadmap) {
      const rm = d.roadmap, nx = M, cx0 = 360, cx1 = W - M, span = rm.to - rm.from;
      const X = (t: number) => cx0 + ((t - rm.from) / span) * (cx1 - cx0);
      const ay = ty + 28; const days: number[] = [];
      for (let t = Math.ceil((rm.from + 3 * 36e5) / 864e5) * 864e5 - 3 * 36e5; t < rm.to; t += 864e5) days.push(t);
      days.forEach((t, i) => put(`${new Date(t + 3 * 36e5).getUTCDate()}${i === 0 ? ` ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(t + 3 * 36e5).getUTCMonth()]}` : ''}`, X(t) + 6, ay, 19, 600, C.grey, 120));
      const top = ay + 14; let ry = top; const RH = 74;
      const rowsY: number[] = [];
      for (const b of rm.bars) { rowsY.push(ry); put(b.label, nx, ry + 32, 22, 800, b.oil ? C.brandRedDark : C.ink, cx0 - nx - 20); put(b.sub, nx, ry + 58, 17, 500, C.grey, cx0 - nx - 20); ry += RH; }
      const bottom = ry;
      shapes.push((c) => {
        c.fillStyle = '#eef2f7'; for (const t of days) c.fillRect(X(t), top, 2, bottom - top);
        rm.bars.forEach((b, i) => {
          const y = rowsY[i]; c.fillStyle = '#f1f5f9'; c.fillRect(nx, y + RH - 1, W - 2 * M, 1);
          if (b.planStart !== null && b.planEnd !== null) {
            const x0 = X(b.planStart), w = Math.max(10, X(b.planEnd) - x0);
            round(c, x0, y + 16, w, 22, 5, b.oil ? C.brandRed : b.state === 'done' ? C.green : b.state === 'run' ? '#d97706' : '#1e3a8a');
            // done past its plan: striped green from the plan end to the actual end
            if (b.state === 'done' && b.end !== null && b.end > b.planEnd) {
              const sx = X(b.planEnd), sw = X(b.end) - sx; c.save(); c.beginPath(); c.rect(sx, y + 16, sw, 22); c.clip(); c.fillStyle = '#86efac'; c.fillRect(sx, y + 16, sw, 22);
              c.strokeStyle = C.green; c.lineWidth = 5; for (let k = sx - 30; k < sx + sw + 30; k += 11) { c.beginPath(); c.moveTo(k, y + 40); c.lineTo(k + 22, y + 14); c.stroke(); } c.restore();
            }
          }
          // the estimate (not confirmed), dashed under the plan, for what is not done
          if (b.state !== 'done' && b.start !== null && b.end !== null) {
            const x0 = X(b.start), w = Math.max(10, X(b.end) - x0);
            c.fillStyle = b.oil ? 'rgba(254,226,226,0.7)' : 'rgba(219,234,254,0.7)'; c.fillRect(x0, y + 44, w, 16);
            c.save(); c.setLineDash([8, 5]); c.lineWidth = 2.5; c.strokeStyle = b.oil ? C.red : '#2563eb'; c.strokeRect(x0, y + 44, w, 16); c.restore();
          }
        });
        const n = X(Math.min(Math.max(rm.now, rm.from), rm.to)); c.fillStyle = '#d97706'; c.fillRect(n - 2, top - 6, 4, bottom - top + 6);
      });
      put('NOW', X(Math.min(Math.max(rm.now, rm.from), rm.to)), top - 2, 17, 800, '#d97706', 80, 'center');
      // the legend
      const ly = bottom + 30; const items: [string, string][] = [['Plan', '#1e3a8a'], ['Done', C.green], ['In progress', '#d97706'], ['Estimate · not confirmed', 'est'], ['Cut-in', C.brandRed], ['Now', 'now']];
      let lx = M; const probeC = ctx ?? probe; font(probeC, 19, 600);
      for (const [t, col] of items) {
        const x0 = lx; shapes.push((c) => {
          if (col === 'est') { c.fillStyle = 'rgba(219,234,254,0.9)'; c.fillRect(x0, ly - 15, 30, 14); c.save(); c.setLineDash([6, 4]); c.lineWidth = 2; c.strokeStyle = '#2563eb'; c.strokeRect(x0, ly - 15, 30, 14); c.restore(); }
          else if (col === 'now') { c.fillStyle = '#d97706'; c.fillRect(x0 + 13, ly - 19, 4, 22); }
          else round(c, x0, ly - 15, 30, 14, 3, col);
        });
        put(t, lx + 38, ly, 19, 600, '#334155', 400); lx += 38 + probeC.measureText(t).width + 26;
      }
      ty = ly + 26;
    }
    // the table
    ty += 8; const th = 46; const hy = ty;
    shapes.push((c) => { c.fillStyle = '#f1f5f9'; c.fillRect(0, hy, W, th); });
    ['Stage', 'Plan', 'Actual / est.', 'Var', 'Reason'].forEach((h, i) => put(h.toUpperCase(), cols[i].x, ty + 30, 18, 800, C.grey, cols[i].w - 8));
    ty += th;
    for (const r of d.rows) {
      const y0 = ty + 34; const ink = r.state === 'done' ? C.green : r.state === 'run' ? C.blue : r.oil ? C.brandRedDark : C.ink;
      let h0 = put(r.label, cols[0].x, y0, 25, 800, r.oil ? C.brandRedDark : C.ink, cols[0].w - 10);
      h0 += put(r.sub, cols[0].x, y0 + h0 - 4, 19, 500, C.grey, cols[0].w - 10);
      const h1 = put(r.plan[0], cols[1].x, y0, 22, 500, C.ink, cols[1].w - 6) + put(r.plan[1], cols[1].x, y0 + 28, 22, 500, C.ink, cols[1].w - 6);
      const h2 = put(r.act[0], cols[2].x, y0, 22, r.state === 'next' && !r.oil ? 500 : 800, ink, cols[2].w - 6) + put(r.act[1], cols[2].x, y0 + 28, 22, r.state === 'next' && !r.oil ? 500 : 800, ink, cols[2].w - 6);
      const h3 = put(r.varText, cols[3].x, y0, 24, 800, r.varRed ? C.red : C.grey, cols[3].w - 6);
      const h4 = r.reason ? put(r.reason, cols[4].x, y0, 20, 500, '#7c2d12', cols[4].w) : 0;
      const rh = Math.max(h0, h1, h2, h3, h4) + 30; const yy = ty;
      shapes.push((c) => { c.fillStyle = r.oil ? '#fdeeee' : r.state === 'done' ? '#eef8f2' : r.state === 'run' ? '#eef3fb' : '#ffffff'; c.fillRect(0, yy, W, rh); c.fillStyle = '#e2e8f0'; c.fillRect(0, yy + rh - 2, W, 2); });
      ty += rh;
    }
    const fy = ty + 44; put(d.footLeft, M, fy, 22, 500, C.grey, W / 2 - M); put(d.footRight, W - M, fy, 22, 500, C.grey, W / 2 - M, 'right');
    return { lines, shapes, height: fy + 30 };
  };
  const lay = draw(null);
  canvas.width = W; canvas.height = Math.max(MIN_H, lay.height);
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, canvas.height);
  for (const f of lay.shapes) f(ctx);
  for (const l of lay.lines) { font(ctx, l.size, l.weight); ctx.fillStyle = l.color; ctx.textAlign = l.align ?? 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(l.t, l.x, l.y); }
}
