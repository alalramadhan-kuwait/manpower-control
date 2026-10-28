// The start-up as a picture for WhatsApp (owner, 28 Oct 2026, option C of the second mock-up): a 1080-wide card
// drawn on the phone, 4:5 when it fits so it shows whole in a chat. On top two equal tiles: the progress ring, and the
// time management asks for: when the black oil is cut in, with a bar counting down to it. Under them the time column of the steps still to do (the
// finished ones are one line). Times are rounded to the half hour. Nothing is uploaded: the phone's share sheet sends it.
export interface CardRow {
  kind: 'done' | 'run' | 'next' | 'oil' | 'hold';
  start: string; end: string; date: string; title: string; sub: string | null; right: string; red?: boolean;
}
export interface CardData {
  title: string; when: string; pct: number; planPct: number;
  /** the orange tile: what (BLACK OIL CUT-IN), when (11:30 PM), the day, the countdown bar (0–1, share of the wait
   *  from the start-up's first step to the cut-in that has passed) and how long is left with the full rate */
  box: { label: string; big: string; line1: string; bar: number | null; line2: string | null } | null;
  /** the ring tile's lines ("6 of 8 steps", "3 h behind plan"); under the tiles the running step and the holds */
  steps: string; behind: string; behindRed: boolean; running: string | null; hold: string | null;
  rows: CardRow[]; footLeft: string; footRight: string;
}

const W = 1080, MIN_H = 1350;
const C = { navy: '#22386b', ink: '#172235', grey: '#64748b', light: '#e5e7eb', green: '#16a34a', amber: '#f59e0b', red: '#dc2626', sky: '#0284c7', oil: '#ea580c', oilDark: '#c2410c', note: '#b45309' };
const FONT = '-apple-system, "Segoe UI", Roboto, system-ui, sans-serif';
const ROW = { done: { dot: C.green, bg: '#f0fdf4', title: '#166534' }, run: { dot: C.amber, bg: '#fffbeb', title: C.ink }, next: { dot: '#cbd5e1', bg: '#ffffff', title: C.ink },
  oil: { dot: C.oil, bg: '#fff7ed', title: C.oilDark }, hold: { dot: C.sky, bg: '#f0f9ff', title: '#0369a1' } } as const;

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
  shapes.push((c) => { c.fillStyle = C.navy; c.fillRect(0, 0, W, headH); });
  const hy = 74 + put(d.title, 50, 74, 52, 800, '#ffffff', W - 100); put(d.when, 50, hy + 2, 28, 400, 'rgba(255,255,255,0.8)', W - 100);
  // two equal tiles: the ring with the steps and behind / ahead; the black oil cut-in with its countdown
  const top = headH + 34, gap = 28, tw = (W - 100 - gap) / 2, ox = 50 + tw + gap; const r = 110; const cx = 50 + tw / 2, cy = top + 40 + r;
  let ly = cy + r + 17 + 50;
  ly += put(d.steps, cx, ly, Math.round(30 * k), 500, C.ink, tw - 40, 'center');
  ly += put(d.behind, cx, ly + 2, Math.round(30 * k), 800, d.behindRed ? C.red : C.green, tw - 40, 'center');
  let by = top + 54; let tileH = 0;
  shapes.push((c) => {
    round(c, 50, top, tw, tileH, 26, '#e2e8f0'); round(c, 52, top + 2, tw - 4, tileH - 4, 24, '#ffffff');
    if (d.box) { const g = c.createLinearGradient(ox, top, ox + tw, top + tileH); g.addColorStop(0, C.oil); g.addColorStop(1, C.oilDark); round(c, ox, top, tw, tileH, 26, g); }
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
    L.push({ t: row.right, x: W - 50, y: yy, size: Math.round(big * 0.9), weight: row.red || row.kind === 'oil' ? 800 : 500, color: row.red ? C.red : row.kind === 'oil' ? C.oilDark : C.grey, align: 'right' });
    const sh = row.sub ? put(row.sub, bodyX, yy + th - Math.round(big * 1.22) + Math.round(small * 1.3) + 4, small, 500, row.kind === 'done' || row.kind === 'hold' ? '#0369a1' : C.note, W - bodyX - 50) + 4 : 0;
    const tcol = row.kind === 'oil' ? C.oilDark : row.kind === 'next' ? C.grey : C.ink;
    L.push({ t: row.start, x: tcR, y: yy, size: Math.round(big * 0.95), weight: 800, color: tcol, align: 'right' });
    L.push({ t: row.end, x: tcR, y: yy + Math.round(small * 1.25), size: small, weight: 500, color: row.kind === 'oil' ? C.oilDark : C.grey, align: 'right' });
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
  // ring: progress by plan hours, the plan as a thin mark
  const { cx, cy, r } = lay.ring;
  ctx.lineCap = 'round'; ctx.lineWidth = 34; ctx.strokeStyle = C.light; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  if (d.pct > 0) { ctx.strokeStyle = d.pct >= 100 ? C.green : C.amber; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.min(100, d.pct)) / 100); ctx.stroke(); }
  const pa = -Math.PI / 2 + (Math.PI * 2 * Math.min(100, d.planPct)) / 100;
  ctx.lineWidth = 6; ctx.lineCap = 'butt'; ctx.strokeStyle = C.ink; ctx.beginPath(); ctx.moveTo(cx + Math.cos(pa) * (r - 24), cy + Math.sin(pa) * (r - 24)); ctx.lineTo(cx + Math.cos(pa) * (r + 24), cy + Math.sin(pa) * (r + 24)); ctx.stroke();
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
