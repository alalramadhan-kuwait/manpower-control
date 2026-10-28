// The start-up as a picture for WhatsApp (owner, 28 Oct 2026, option A of the mock-up): a 1080 × 1350 (4:5) card
// drawn on the phone, so it shows whole in a chat. Nothing is uploaded: the phone's share sheet sends it.
export interface CardStep { title: string; status: 'done' | 'running' | 'not_started' | 'not_required'; right: string; red: boolean; sub: string | null }
export interface CardData {
  title: string; when: string; pct: number; planPct: number; stepsLine: string; runningLine: string | null; expectedLine: string; behindLine: string | null; behindRed: boolean;
  planLine: string | null; steps: CardStep[]; footLeft: string; footRight: string;
}

const W = 1080, HGT = 1350;
const C = { navy: '#22386b', ink: '#172235', grey: '#64748b', light: '#e5e7eb', green: '#16a34a', amber: '#f59e0b', red: '#dc2626', band: '#f1f5f9' };
const FONT = '-apple-system, "Segoe UI", Roboto, system-ui, sans-serif';

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, weight = 400, max = W - x - 50, align: CanvasTextAlign = 'left') {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText(fit(ctx, s, max), x, y);
}
function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
}

export function drawCard(canvas: HTMLCanvasElement, d: CardData) {
  canvas.width = W; canvas.height = HGT;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, HGT);
  // header
  ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, 170);
  text(ctx, d.title, 50, 85, 54, '#ffffff', 800);
  text(ctx, d.when, 50, 135, 30, 'rgba(255,255,255,0.8)');
  // ring: progress by standard hours, the plan as a thin mark
  const cx = 190, cy = 345, r = 120;
  ctx.lineCap = 'round';
  ctx.lineWidth = 34; ctx.strokeStyle = C.light; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  if (d.pct > 0) { ctx.strokeStyle = d.pct >= 100 ? C.green : C.amber; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.min(100, d.pct)) / 100); ctx.stroke(); }
  const pa = -Math.PI / 2 + (Math.PI * 2 * Math.min(100, d.planPct)) / 100;
  ctx.lineWidth = 6; ctx.lineCap = 'butt'; ctx.strokeStyle = C.ink; ctx.beginPath(); ctx.moveTo(cx + Math.cos(pa) * (r - 24), cy + Math.sin(pa) * (r - 24)); ctx.lineTo(cx + Math.cos(pa) * (r + 24), cy + Math.sin(pa) * (r + 24)); ctx.stroke();
  text(ctx, `${d.pct}%`, cx, cy + 20, 70, C.ink, 800, 220, 'center');
  text(ctx, 'by std hours', cx, cy + 58, 24, C.grey, 500, 220, 'center');
  // the figures beside it
  let y = 265;
  text(ctx, d.stepsLine, 370, y, 40, C.ink, 800); y += 52;
  if (d.runningLine) { text(ctx, d.runningLine, 370, y, 30, C.ink); y += 44; }
  text(ctx, d.expectedLine, 370, y, 30, C.ink, 600); y += 44;
  if (d.behindLine) text(ctx, d.behindLine, 370, y, 32, d.behindRed ? C.red : C.green, 800);
  // plan line
  let top = 500;
  if (d.planLine) { round(ctx, 40, top, W - 80, 70, 14, C.band); text(ctx, d.planLine, 64, top + 46, 28, C.ink, 500, W - 128); top += 90; } else top += 20;
  // the steps, as many as fit
  const foot = HGT - 80; const n = d.steps.length || 1;
  const rowH = Math.min(84, Math.floor((foot - top - 10) / n));
  const big = Math.max(22, Math.min(32, rowH * 0.4)); const small = Math.max(18, Math.min(24, rowH * 0.29));
  d.steps.forEach((s, i) => {
    const ry = top + i * rowH; const mid = ry + (s.sub ? rowH * 0.36 : rowH * 0.5);
    const col = s.status === 'done' ? C.green : s.status === 'running' ? C.amber : C.light;
    ctx.beginPath(); ctx.arc(70, mid, Math.min(20, rowH * 0.24), 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    ctx.font = `800 ${Math.round(big * 0.75)}px ${FONT}`; ctx.fillStyle = s.status === 'not_started' || s.status === 'not_required' ? C.grey : '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s.status === 'done' ? '✓' : s.status === 'running' ? '▶' : s.status === 'not_required' ? '–' : String(i + 1), 70, mid + 1);
    ctx.textBaseline = 'alphabetic';
    text(ctx, s.right, W - 50, mid + big * 0.35, big, s.red ? C.red : C.grey, s.red ? 800 : 500, 260, 'right');
    ctx.font = `${s.red ? 800 : 500} ${big}px ${FONT}`; const rw = ctx.measureText(s.right).width;
    text(ctx, s.title, 110, mid + big * 0.35, big, s.status === 'not_required' ? C.grey : C.ink, 500, W - 110 - 70 - rw);
    if (s.sub) text(ctx, s.sub, 110, ry + rowH * 0.8, small, '#b45309', 500, W - 160);
    if (i < d.steps.length - 1) { ctx.fillStyle = '#eef1f5'; ctx.fillRect(110, ry + rowH - 1, W - 160, 2); }
  });
  // footer
  ctx.fillStyle = '#eef1f5'; ctx.fillRect(0, foot, W, 2);
  text(ctx, d.footLeft, 50, foot + 50, 26, C.grey, 500, W / 2 - 60);
  text(ctx, d.footRight, W - 50, foot + 50, 26, C.grey, 500, W / 2 - 60, 'right');
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
