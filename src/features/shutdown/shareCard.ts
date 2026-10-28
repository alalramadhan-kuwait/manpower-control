// The start-up as a picture for WhatsApp (owner, 28 Oct 2026, option A of the mock-up): a 1080 × 1350 (4:5) card
// drawn on the phone, so it shows whole in a chat. Nothing is uploaded: the phone's share sheet sends it.
export interface CardStep { title: string; status: 'done' | 'running' | 'not_started' | 'not_required'; right: string; red: boolean; sub: string | null }
export interface CardData {
  title: string; when: string; pct: number; planPct: number; stepsLine: string; runningLine: string | null; expectedLine: string; behindLine: string | null; behindRed: boolean;
  planLine: string | null; steps: CardStep[]; footLeft: string; footRight: string;
}

const W = 1080, MIN_H = 1350;
const C = { navy: '#22386b', ink: '#172235', grey: '#64748b', light: '#e5e7eb', green: '#16a34a', amber: '#f59e0b', red: '#dc2626', band: '#f1f5f9', note: '#b45309' };
const FONT = '-apple-system, "Segoe UI", Roboto, system-ui, sans-serif';

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
function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
}
type Line = { t: string; x: number; y: number; size: number; weight: number; color: string; align?: CanvasTextAlign };

/** Lays the card out at a text scale; returns what to draw and the height it needs. */
function layout(ctx: CanvasRenderingContext2D, d: CardData, k: number) {
  const L: Line[] = []; const shapes: ((c: CanvasRenderingContext2D) => void)[] = [];
  const put = (t: string, x: number, y: number, size: number, weight: number, color: string, max: number, align: CanvasTextAlign = 'left') => {
    font(ctx, size, weight); const lines = wrap(ctx, t, max); const lh = Math.round(size * 1.22);
    lines.forEach((l, i) => L.push({ t: l, x, y: y + i * lh, size, weight, color, align }));
    return lines.length * lh;
  };
  // header
  let y = 78;
  font(ctx, 54, 800); const titleLines = wrap(ctx, d.title, W - 100).length;
  const headH = 60 + titleLines * 66 + 48;
  shapes.push((c) => { c.fillStyle = C.navy; c.fillRect(0, 0, W, headH); });
  y += put(d.title, 50, y, 54, 800, '#ffffff', W - 100);
  put(d.when, 50, y + 4, 30, 400, 'rgba(255,255,255,0.8)', W - 100);
  // ring and figures
  const top = headH + 40; const r = 120; const cx = 190, cy = top + r + 10;
  let fy = top + 50; const fx = 370, fw = W - fx - 50;
  fy += put(d.stepsLine, fx, fy, Math.round(40 * k), 800, C.ink, fw) + 6;
  if (d.runningLine) fy += put(d.runningLine, fx, fy, Math.round(30 * k), 400, C.ink, fw) + 4;
  fy += put(d.expectedLine, fx, fy, Math.round(30 * k), 600, C.ink, fw) + 4;
  if (d.behindLine) fy += put(d.behindLine, fx, fy, Math.round(32 * k), 800, d.behindRed ? C.red : C.green, fw);
  let ty = Math.max(cy + r + 50, fy + 10);
  // plan line
  if (d.planLine) {
    const size = Math.round(28 * k); font(ctx, size, 500); const n = wrap(ctx, d.planLine, W - 128).length; const h = n * Math.round(size * 1.22) + 30;
    const by = ty; shapes.push((c) => round(c, 40, by, W - 80, h, 14, C.band));
    put(d.planLine, 64, by + 16 + size, size, 500, C.ink, W - 128); ty += h + 16;
  }
  // steps: the title wraps beside the hours; the reasons under it, whole
  const big = Math.round(30 * k), small = Math.round(23 * k), bl = Math.round(big * 1.22), sl = Math.round(small * 1.25);
  const rows: { y: number; h: number; s: CardStep; i: number }[] = [];
  d.steps.forEach((s, i) => {
    font(ctx, big, s.red ? 800 : 500); const rw = ctx.measureText(s.right).width;
    const yy = ty + 14 + big;
    const th = put(s.title, 110, yy, big, 500, s.status === 'not_required' ? C.grey : C.ink, W - 110 - 70 - rw);
    L.push({ t: s.right, x: W - 50, y: yy, size: big, weight: s.red ? 800 : 500, color: s.red ? C.red : C.grey, align: 'right' });
    const sh = s.sub ? put(s.sub, 110, yy + th - bl + sl + 4, small, 500, C.note, W - 160) + 4 : 0;
    const h = 14 + th + sh + 10; rows.push({ y: ty, h, s, i }); ty += h;
  });
  shapes.push((c) => rows.forEach(({ y: ry, h, s, i }, n) => {
    const mid = ry + 14 + bl / 2 - 2; const col = s.status === 'done' ? C.green : s.status === 'running' ? C.amber : C.light;
    c.beginPath(); c.arc(70, mid, 20, 0, Math.PI * 2); c.fillStyle = col; c.fill();
    font(c, 22, 800); c.fillStyle = s.status === 'not_started' || s.status === 'not_required' ? C.grey : '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(s.status === 'done' ? '✓' : s.status === 'running' ? '▶' : s.status === 'not_required' ? '–' : String(i + 1), 70, mid + 1); c.textBaseline = 'alphabetic';
    if (n < rows.length - 1) { c.fillStyle = '#eef1f5'; c.fillRect(110, ry + h - 1, W - 160, 2); }
  }));
  // footer
  const foot = ty + 20;
  shapes.push((c) => { c.fillStyle = '#eef1f5'; c.fillRect(0, foot, W, 2); });
  const fh = Math.max(put(d.footLeft, 50, foot + 50, 26, 500, C.grey, W / 2 - 60), put(d.footRight, W - 50, foot + 50, 26, 500, C.grey, W / 2 - 60, 'right'));
  return { L, shapes, height: foot + 30 + fh, ring: { cx, cy, r } };
}

export function drawCard(canvas: HTMLCanvasElement, d: CardData) {
  const probe = document.createElement('canvas').getContext('2d')!;
  // the largest text that fits 4:5 (shows whole in a chat); if even small text does not fit, the picture grows taller
  let lay = layout(probe, d, 1);
  for (const k of [0.94, 0.88, 0.82, 0.76]) { if (lay.height <= MIN_H) break; lay = layout(probe, d, k); }
  canvas.width = W; canvas.height = Math.max(MIN_H, lay.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, canvas.height);
  for (const f of lay.shapes) f(ctx);
  // ring: progress by standard hours, the plan as a thin mark
  const { cx, cy, r } = lay.ring;
  ctx.lineCap = 'round'; ctx.lineWidth = 34; ctx.strokeStyle = C.light; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  if (d.pct > 0) { ctx.strokeStyle = d.pct >= 100 ? C.green : C.amber; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.min(100, d.pct)) / 100); ctx.stroke(); }
  const pa = -Math.PI / 2 + (Math.PI * 2 * Math.min(100, d.planPct)) / 100;
  ctx.lineWidth = 6; ctx.lineCap = 'butt'; ctx.strokeStyle = C.ink; ctx.beginPath(); ctx.moveTo(cx + Math.cos(pa) * (r - 24), cy + Math.sin(pa) * (r - 24)); ctx.lineTo(cx + Math.cos(pa) * (r + 24), cy + Math.sin(pa) * (r + 24)); ctx.stroke();
  font(ctx, 70, 800); ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.fillText(`${d.pct}%`, cx, cy + 20);
  font(ctx, 24, 500); ctx.fillStyle = C.grey; ctx.fillText('by plan hours', cx, cy + 58);
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
