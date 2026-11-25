// Section drawings for the Unit log (owner, 25 Nov 2026: "refinery shape equipment"; flow and tags from the Unit-12
// lineup already in this repo). Simplified P&ID symbols drawn as SVG, values read from the shift's log and lab results.
// Only tags and one value per item are drawn (≥ 12 px on a phone); everything else is in the table under the drawing.
import type { FeedRow, ProductRow } from '@/core/logbook/parse';
import type { St } from '@/core/logbook/board';

export type DrawSection = 'feed' | 'heat' | 'rx' | 'gas' | 'sep' | 'frac';
export interface DrawCtx {
  train: 1 | 2;
  r: (key: string) => string | null;                          // this train's reading
  st: (paramId: string) => St;                                 // this train's state for a library parameter
  lab: (material: string, component: string) => string | null; // this train's (or common) lab result that day
  iow: (paramId: string) => number | null;
  feed: FeedRow | null; products: ProductRow[]; override: boolean;
}
const NS = 'http://www.w3.org/2000/svg';
const ICON: Record<St, string> = { bad: '●', off: '▲', chk: '⚑', grey: '○', ok: '' };
const C = { ink: '#0f172a', mut: '#475569', eq: '#f8fafc', eqs: '#64748b', bad: '#c62828', badbg: '#fde2e2', off: '#8a5c00', offline: '#d99100', offbg: '#fff1c2', grey: '#5b6675', greybg: '#e9edf2',
  feed: '#8a5a2b', eff: '#d98a0f', gas: '#2f74c8', bot: '#475569', w: '#0e8f8f', prod: '#15803d', fire: '#c2410c', hatch: '#cbd5e1', chip: '#eef2f6', brand: '#0e2a63', card: '#ffffff' };
type Svc = 'feed' | 'eff' | 'gas' | 'bot' | 'w' | 'prod';
const worst = (...xs: St[]): St => (['bad', 'off', 'chk', 'grey'] as St[]).find((s) => xs.includes(s)) ?? 'ok';

function sheet(W: number, H: number) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${W} ${H}`); s.setAttribute('width', '100%'); s.setAttribute('role', 'img');
  const E = (t: string, a: Record<string, string | number>, p: Element = s) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, String(a[k])); p.appendChild(e); return e; };
  const T = (x: number, y: number, txt: string, o: { fs?: number; fw?: number; c?: string; a?: string; bare?: boolean } = {}) => {
    const e = E('text', { x, y, 'font-size': o.fs ?? 12, 'font-weight': o.fw ?? 500, fill: o.c ?? C.ink, 'text-anchor': o.a ?? 'start' });
    if (!o.bare) { e.setAttribute('stroke', C.card); e.setAttribute('stroke-width', '3.5'); e.setAttribute('paint-order', 'stroke'); e.setAttribute('stroke-linejoin', 'round'); }
    e.textContent = txt; return e;
  };
  const defs = E('defs', {});
  (['feed', 'eff', 'gas', 'bot', 'w', 'prod'] as Svc[]).forEach((k) => { const m = E('marker', { id: `m-${k}`, viewBox: '0 0 8 8', refX: 6, refY: 4, markerWidth: 5, markerHeight: 5, orient: 'auto' }, defs); E('path', { d: 'M0 0L8 4L0 8z', fill: C[k] }, m); });
  const pat = E('pattern', { id: 'cat', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs); E('line', { x1: 0, y1: 0, x2: 0, y2: 5, stroke: C.hatch, 'stroke-width': 2.2 }, pat);
  const FILL: Record<St, string> = { ok: C.eq, off: C.offbg, bad: C.badbg, chk: C.eq, grey: C.eq }, SC: Record<St, string> = { ok: C.eqs, off: C.offline, bad: C.bad, chk: C.grey, grey: C.grey };
  const sw = (st: St) => (st === 'ok' ? 1.5 : 2.6);
  const g = {
    s, E, T,
    pipe: (d: string, svc: Svc, dash = false) => { const e = E('path', { d, fill: 'none', stroke: C[svc], 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'marker-end': `url(#m-${svc})` }); if (dash) e.setAttribute('stroke-dasharray', '5 3'); return e; },
    drum: (x: number, y: number, w: number, h: number, st: St = 'ok') => { const e = E('rect', { x, y, width: w, height: h, rx: h / 2, fill: FILL[st], stroke: SC[st], 'stroke-width': sw(st) }); if (st === 'grey') e.setAttribute('stroke-dasharray', '4 3'); return e; },
    vessel: (x: number, y: number, w: number, h: number, st: St = 'ok') => { const e = E('path', { d: `M${x} ${y + w / 3} Q${x} ${y} ${x + w / 2} ${y} Q${x + w} ${y} ${x + w} ${y + w / 3} L${x + w} ${y + h - w / 3} Q${x + w} ${y + h} ${x + w / 2} ${y + h} Q${x} ${y + h} ${x} ${y + h - w / 3} Z`, fill: FILL[st], stroke: SC[st], 'stroke-width': sw(st) }); if (st === 'grey') e.setAttribute('stroke-dasharray', '4 3'); return e; },
    hx: (x: number, y: number, r = 10) => { E('circle', { cx: x, cy: y, r, fill: C.eq, stroke: C.eqs, 'stroke-width': 1.5 }); E('path', { d: `M${x - r} ${y} L${x - r / 2} ${y - r / 2} L${x} ${y + r / 2} L${x + r / 2} ${y - r / 2} L${x + r} ${y}`, fill: 'none', stroke: C.eqs, 'stroke-width': 1.3 }); },
    pump: (x: number, y: number, r = 10) => { E('path', { d: `M${x - 6} ${y + r - 2} L${x - 9} ${y + r + 5} L${x + 9} ${y + r + 5} L${x + 6} ${y + r - 2}`, fill: C.eq, stroke: C.eqs, 'stroke-width': 1.3 }); E('circle', { cx: x, cy: y, r, fill: C.eq, stroke: C.eqs, 'stroke-width': 1.5 }); E('path', { d: `M${x} ${y - r} L${x + r + 6} ${y - r} L${x + r + 6} ${y - r + 7}`, fill: 'none', stroke: C.eqs, 'stroke-width': 1.5 }); },
    compressor: (x: number, y: number, w: number, h: number, st: St = 'ok') => E('path', { d: `M${x} ${y} L${x + w} ${y + h * 0.28} L${x + w} ${y + h * 0.72} L${x} ${y + h} Z`, fill: FILL[st], stroke: SC[st], 'stroke-width': sw(st) }),
    tag: (x: number, y: number, t: string, a = 'start') => T(x, y, t, { fs: 13, fw: 700, a }),
    val: (x: number, y: number, v: string, st: St = 'ok', a = 'start') => T(x, y, (ICON[st] ? `${ICON[st]} ` : '') + v, { fs: 12.5, fw: st === 'ok' ? 500 : 700, c: st === 'ok' ? C.ink : st === 'bad' ? C.bad : st === 'off' ? C.off : C.grey, a }),
    lbl: (x: number, y: number, t: string, a = 'start', c = C.mut) => T(x, y, t, { fs: 12.5, c, a }),
    stub: (x: number, y: number, t: string, a = 'start', c = C.brand) => T(x, y, t, { fs: 12, fw: 700, c, a }),
    badge: (x: number, y: number, st: St) => { if (!ICON[st] || st === 'ok') return; E('circle', { cx: x, cy: y, r: 8, fill: st === 'bad' ? C.bad : st === 'off' ? C.offline : C.grey, stroke: C.card, 'stroke-width': 1.5 }); T(x, y + 4, st === 'bad' ? '×' : st === 'off' ? '!' : '?', { fs: 11, fw: 800, c: C.card, a: 'middle', bare: true }); },
    reactor: (x: number, y: number, w: number, h: number, st: St = 'ok', beds = 2) => { g.vessel(x, y, w, h, st); for (let k = 0; k < beds; k++) { const bh = h * 0.56 / beds; E('rect', { x: x + 2.5, y: y + h * 0.22 + k * bh, width: w - 5, height: bh - 5, fill: 'url(#cat)' }); } },
    column: (x: number, y: number, w: number, h: number, st: St = 'ok', trays = 8) => { g.vessel(x, y, w, h, st); for (let k = 1; k <= trays; k++) { const yy = y + h * 0.12 + k * (h * 0.76 / (trays + 1)); E('line', { x1: x + (k % 2 ? 2 : w * 0.3), x2: x + (k % 2 ? w * 0.7 : w - 2), y1: yy, y2: yy, stroke: C.eqs, 'stroke-width': 1, opacity: 0.6 }); } },
    furnace: (x: number, y: number, w: number, h: number, st: St = 'ok') => {
      E('rect', { x: x + w * 0.38, y: y - 14, width: w * 0.24, height: 14, fill: C.chip, stroke: C.eqs, 'stroke-width': 1 });
      E('path', { d: `M${x} ${y + h} L${x} ${y + 14} L${x + w * 0.3} ${y} L${x + w * 0.7} ${y} L${x + w} ${y + 14} L${x + w} ${y + h} Z`, fill: FILL[st], stroke: SC[st], 'stroke-width': sw(st) });
      let d = `M${x + 6} ${y + h - 7}`; const k = 4, step = (w - 12) / k; for (let j = 0; j < k; j++) d += ` L${x + 6 + j * step + step / 2} ${y + 20} L${x + 6 + (j + 1) * step} ${y + h - 7}`; E('path', { d, fill: 'none', stroke: C.fire, 'stroke-width': 1.3 });
      [0.3, 0.5, 0.7].forEach((f) => E('path', { d: `M${x + w * f - 3.5} ${y + h - 1} q3.5 -10 7 0z`, fill: '#f59e0b' }));
    },
    filters: (x: number, y: number, w: number, h: number) => { E('rect', { x, y, width: w, height: h, rx: 6, fill: C.eq, stroke: C.eqs, 'stroke-width': 1.2, 'stroke-dasharray': '3 2' }); for (let k = 0; k < 5; k++) { const cx = x + 6 + k * (w - 12) / 4; E('rect', { x: cx - 3.5, y: y + 6, width: 7, height: h - 12, rx: 3.5, fill: C.card, stroke: C.eqs, 'stroke-width': 1 }); } },
  };
  return g;
}

/** Small icon for an overview tile. */
export function tileIcon(k: DrawSection): SVGSVGElement {
  const g = sheet(84, 44);
  if (k === 'feed') { g.drum(2, 14, 30, 13); g.pipe('M32 20 L40 20 L40 26', 'feed'); g.pump(46, 32, 6); g.hx(70, 20, 8); }
  if (k === 'heat') { g.furnace(4, 12, 30, 30); g.furnace(44, 12, 30, 30); }
  if (k === 'rx') { g.reactor(6, 2, 16, 40, 'ok', 2); g.reactor(28, 6, 14, 36, 'ok', 2); g.reactor(48, 6, 14, 36, 'ok', 2); g.reactor(68, 6, 14, 36, 'ok', 2); }
  if (k === 'gas') { g.column(4, 2, 13, 40, 'ok', 5); g.vessel(26, 8, 10, 18); g.compressor(46, 12, 22, 22); }
  if (k === 'sep') { g.vessel(4, 4, 13, 36); g.vessel(24, 10, 12, 28); g.drum(44, 22, 36, 12); }
  if (k === 'frac') { g.column(6, 0, 16, 44, 'ok', 6); g.column(32, 14, 10, 28, 'ok', 3); g.column(52, 10, 12, 32, 'ok', 4); }
  g.s.setAttribute('height', '38'); g.s.setAttribute('width', '72');
  return g.s;
}

const num = (v: string | null) => (v !== null && /^[+-]?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
const or = (v: string | null, unit = '') => (v === null ? '—' : `${v}${unit ? ` ${unit}` : ''}`);

/** The drawing of one section for one train (Fractionation is common). */
export function drawSection(sec: DrawSection, c: DrawCtx): SVGSVGElement {
  const n = (t: string) => t.replace(/x/g, String(c.train));
  if (sec === 'feed') {
    const g = sheet(360, 262);
    g.stub(4, 22, 'U-11 hot resid'); g.pipe('M4 40 L44 40', 'feed'); g.hx(56, 40); g.tag(56, 72, 'E-112', 'middle');
    g.stub(4, 106, 'Storage, cold'); g.pipe('M4 124 L44 124', 'feed'); g.hx(56, 124); g.tag(56, 156, 'E-118', 'middle'); g.pipe('M56 114 L56 52', 'feed');
    g.pipe('M66 40 L92 40', 'feed'); g.hx(104, 40); g.tag(104, 72, 'E-117', 'middle');
    g.pipe('M114 40 L130 40', 'feed'); g.filters(132, 22, 46, 36); g.tag(155, 72, n('F-x01'), 'middle');
    const bw = c.feed?.backwashMin ?? c.r('CHARGEFILTERBACKWASHFREQUENCY'); g.val(155, 90, `backwash ${or(bw, 'min')}`, 'ok', 'middle');
    g.pipe('M155 58 L155 104 L172 104', 'feed', true); g.drum(174, 96, 36, 16); g.tag(192, 130, 'V-104', 'middle');
    const naSt = c.st('FEED-NA'); g.pipe('M178 40 L204 40', 'feed'); g.drum(206, 28, 56, 24, naSt === 'grey' ? 'grey' : naSt); g.tag(234, 72, n('V-x01'), 'middle');
    if (naSt === 'grey') g.val(234, 90, 'feed Na, visc.', 'grey', 'middle');
    const hs = c.lab('HIGH SULFUR RESIDUE', 'Sulphur, Total'); if (hs !== null) g.lbl(234, 106, `HS residue S ${hs} %`, 'middle', C.ink);
    g.pipe('M262 40 L332 40 L332 180', 'feed'); g.pump(320, 190); g.tag(320, 224, n('P-x03'), 'middle'); g.val(320, 242, or(c.r('FEEDRATE'), 'KBPD'), c.st('FEED-RATE'), 'middle');
    g.pipe('M310 190 L274 190', 'feed'); g.hx(262, 190); g.tag(262, 224, n('E-x03'), 'middle');
    g.pipe('M252 190 L222 190', 'feed'); g.hx(210, 190); g.tag(210, 224, n('E-x16'), 'middle');
    g.pipe('M200 190 L170 190', 'feed'); g.hx(158, 190); g.tag(158, 224, n('E-x29'), 'middle');
    g.pipe('M148 190 L30 190 L30 240 L52 240', 'feed'); g.stub(58, 245, `to ${n('H-x01')} ›`);
    return g.s;
  }
  if (sec === 'heat') {
    const g = sheet(360, 300);
    const P1 = [1, 2, 3, 4].map((p) => num(c.r(`PASS${p}SKINTEMPH12101201`))), P2 = [1, 2, 3, 4].map((p) => num(c.r(`PASS${p}SKINTEMPH12102202`)));
    const W = [1, 2, 3, 4].map((p) => num(c.r(`INJECTIONWATERRATEPASS${p}`)));
    const cell = (x: number, y: number, v: number | null, iow: number | null) => {
      const p = v === null || !iow ? null : v / iow;
      g.E('rect', { x, y, width: 62, height: 42, rx: 7, fill: v === null ? C.greybg : p !== null && p > 1 ? C.badbg : C.gas, 'fill-opacity': v === null || (p !== null && p > 1) ? 1 : (0.1 + 0.5 * Math.max(0, ((p ?? 0) - 0.55) / 0.45)).toFixed(2) });
      g.T(x + 31, y + 19, v === null ? '○ —' : String(v), { fs: 14, fw: 700, a: 'middle', bare: true, c: v === null ? C.grey : C.ink });
      g.T(x + 31, y + 36, v === null ? 'none' : p === null ? '' : `${Math.round(p * 100)}%`, { fs: 12.5, a: 'middle', bare: true, c: C.mut });
    };
    [0, 1, 2, 3].forEach((k) => g.lbl(119 + k * 60, 16, `pass ${k + 1}`, 'middle'));
    g.furnace(6, 38, 58, 58, worst(c.st('H1-SKIN'))); g.tag(35, 118, n('H-x01'), 'middle'); P1.forEach((v, k) => cell(88 + k * 60, 24, v, c.iow('H1-SKIN')));
    W.forEach((v, k) => { g.E('rect', { x: 88 + k * 60, y: 70, width: 62, height: 24, rx: 6, fill: v === 0 ? C.offbg : C.chip }); g.T(119 + k * 60, 87, v === null ? '—' : `${v} gpm`, { fs: 12, fw: v === 0 ? 800 : 500, c: v === 0 ? C.off : C.w, a: 'middle', bare: true }); });
    const sum = W.every((v) => v !== null) ? (W as number[]).reduce((a, b) => a + b, 0) : null;
    g.val(88, 116, `water ${or(sum === null ? null : String(sum), 'gpm')}`, c.st('H1-INJW')); g.lbl(352, 116, 'per train', 'end');
    g.furnace(6, 170, 58, 58, worst(c.st('H2-SKIN'))); g.tag(35, 250, n('H-x02'), 'middle'); P2.forEach((v, k) => cell(88 + k * 60, 166, v, c.iow('H2-SKIN')));
    g.lbl(88, 230, '% = share of skin IOW limit');
    g.val(88, 266, 'H-103 skin: none', c.st('H103-SKIN') === 'grey' ? 'grey' : 'ok'); g.lbl(88, 286, 'common heater');
    return g.s;
  }
  if (sec === 'rx') {
    const g = sheet(360, 350);
    g.stub(4, 18, `from ${n('H-x01')}`); g.pipe('M4 26 L120 26 L120 40 L148 40', 'feed'); g.stub(356, 18, `${n('H-x02')} gas`, 'end', C.gas); g.pipe('M300 24 L170 24 L170 28', 'gas');
    const ocr = worst(c.st('OCR-TIN'), c.st('OCR-MAXBED'), c.st('OCR-DP-TOT'), c.st('OCR-DP-IN'), c.st('OCR-DP-OUT'));
    g.reactor(150, 30, 38, 118, ocr === 'grey' ? 'ok' : ocr, 3); g.badge(188, 32, ocr === 'grey' ? 'ok' : ocr);
    g.tag(198, 50, `${n('R-x05')} OCR`); g.val(198, 72, `in ${or(c.r('INLETTEMPERATURER12105205'), '°F')}`, c.st('OCR-TIN'));
    g.val(198, 92, `max bed ${or(c.r('BEDMAXIMUMTEMPERATURER12105205'))}`, c.st('OCR-MAXBED')); g.val(198, 112, `ΔP ${or(c.r('REACTORDELTAPRESSURER12105205'))} · tray ${or(c.r('INLETTRAYDELTAPRESSURER12105205'))}`, worst(c.st('OCR-DP-TOT'), c.st('OCR-DP-IN')));
    g.val(198, 132, `basket ${or(c.r('OUTLETBASKETDELTAPRESSURER12105205'))}`, c.st('OCR-DP-OUT'));
    g.pipe('M169 148 L169 166 L329 166 L329 180', 'eff'); g.lbl(250, 160, `via ${n('E-x29')}`, 'middle');
    ([[312, '101201', 'R-x01'], [242, '102202', 'R-x02'], [172, '103203', 'R-x03'], [102, '104204', 'R-x04']] as const).forEach(([x, k2, tg], k) => {
      g.reactor(x, 182, 34, 78, 'ok', 2); g.tag(x + 17, 284, n(tg), 'middle'); g.val(x + 17, 302, `max ${or(c.r(`BEDMAXIMUMTEMPERATURER12${k2}`))}`, 'ok', 'middle');
      if (k < 3) g.pipe(`M${x} 248 L${x - 12} 248 L${x - 12} 192 L${x - 34} 192`, 'eff');
    });
    g.pipe('M352 270 L120 270', 'gas', true); [329, 189, 119].forEach((x) => g.pipe(`M${x} 270 L${x} 263`, 'gas')); g.lbl(114, 274, 'quench', 'end', C.gas);
    g.val(180, 326, `WABT ${or(c.r('WABTTOTAL'))} · outlet ${or(c.r('OUTLETTEMPERATURER12104204'), '°F')}`, worst(c.st('FB-CAT'), c.st('FB-OUT')), 'middle');
    g.pipe('M102 248 L30 248 L30 336 L48 336', 'eff'); g.stub(54, 341, `to ${n('V-x06')} ›`);
    return g.s;
  }
  if (sec === 'gas') {
    const g = sheet(360, 330);
    g.stub(4, 318, `from ${n('V-x08')}`, 'start', C.gas); g.pipe('M10 304 L10 186 L20 186', 'gas');
    const scr = worst(c.st('MEA-CONC'), c.st('RG-PURITY'), c.st('MEA-AGL'), c.st('RG-H2S'));
    g.column(22, 40, 28, 156, scr === 'grey' ? 'ok' : scr); g.badge(50, 42, scr === 'grey' ? 'ok' : scr);
    g.tag(58, 60, n('T-x01')); g.val(58, 82, `MEA ${or(c.lab('RICH MEA', 'Total MEA'), 'wt%')}`, c.st('MEA-CONC')); g.val(58, 102, `H₂ ${or(c.lab('H2S SCRUBBER O/L', 'Hydrogen (H2)'), '%vol')}`, c.st('RG-PURITY'));
    g.val(58, 122, `loading ${or(c.lab('RICH MEA', 'Acid Gas Loading'))}`, c.st('MEA-AGL'));
    g.pipe('M36 40 L36 18 L212 18 L212 40', 'gas'); g.vessel(202, 42, 20, 34); g.tag(198, 64, n('V-x12'), 'end');
    g.pipe('M222 52 L300 52', 'gas'); g.lbl(352, 44, 'purge → U-15/16', 'end');
    const cxSt: St = c.override ? 'bad' : c.st('CX-SPEED');
    g.pipe('M212 76 L212 133 L226 133', 'gas'); g.compressor(228, 114, 44, 38, cxSt === 'grey' ? 'ok' : cxSt); g.badge(272, 116, cxSt === 'grey' ? 'ok' : cxSt);
    const rpm = num(c.r('COMPRESSORSPEED'));
    g.tag(250, 172, n('C-x01'), 'middle'); g.val(250, 190, rpm === null ? '—' : `${Math.round(rpm * 1000).toLocaleString('en-US')} rpm`, c.st('CX-SPEED'), 'middle'); if (c.override) g.val(250, 208, 'trip override', 'bad', 'middle');
    g.pipe('M272 133 L296 133 L296 236 L230 236', 'gas', true); g.lbl(224, 240, 'quench → reactors', 'end');
    g.pipe('M296 133 L336 133 L336 286 L344 286', 'gas'); g.lbl(318, 104, `make-up ${or(c.r('H2MAKEUP'))}`, 'middle', C.gas); g.pipe('M318 110 L318 131', 'gas');
    g.stub(356, 306, `to ${n('H-x02')} ›`, 'end', C.gas);
    return g.s;
  }
  if (sec === 'sep') {
    const g = sheet(360, 290);
    g.stub(4, 16, `from ${n('R-x04')}`, 'start', C.eff); g.pipe('M4 24 L10 24 L10 50 L18 50', 'eff');
    g.vessel(20, 36, 28, 70); g.tag(34, 124, n('V-x06'), 'middle');
    g.pipe('M34 36 L34 26 L74 26', 'gas'); g.hx(86, 26, 9); g.pipe('M95 26 L123 26 L123 38', 'gas'); g.vessel(110, 40, 26, 56); g.tag(123, 114, n('V-x07'), 'middle'); g.pipe('M123 96 L123 104 L50 104', 'eff', true);
    g.pipe('M136 54 L154 54', 'gas'); g.hx(164, 54, 9); g.stub(196, 14, `wash water ${or(c.r('WASHWATERRATE'), 'gpm')}`, 'start', C.w); g.pipe('M192 20 L192 50', 'w');
    const hp = c.st('HPCS-IF'); g.pipe('M173 54 L214 54 L214 60', 'gas'); g.drum(202, 62, 72, 22, hp); g.tag(238, 104, n('V-x08'), 'middle'); if (hp === 'grey') g.val(238, 122, 'level', 'grey', 'middle');
    g.pipe('M274 73 L330 73 L330 126', 'gas'); g.stub(356, 144, `to ${n('T-x01')} ›`, 'end', C.gas);
    const lp = c.st('LPHS-LVL'); g.pipe('M34 106 L34 138 L8 138 L8 222 L18 222', 'bot'); g.vessel(20, 200, 26, 48, lp); g.tag(33, 266, n('V-x13'), 'middle'); if (lp === 'grey') g.val(4, 284, 'level', 'grey');
    g.pipe('M46 222 L62 222', 'bot'); g.stub(66, 227, 'to H-103 ›');
    g.pipe('M222 84 L222 160 L190 160 L190 208 L176 208', 'bot', true); g.drum(118, 200, 58, 16); g.tag(147, 236, n('V-x09'), 'middle');
    const cl = c.lab('SOUR WATER', 'Chloride (Cl)'), fe = c.lab('SOUR WATER', 'IRON Fe'), ph = c.lab('SOUR WATER', 'pH');
    const sw = worst(c.st('SW-CL'), c.st('SW-FE'), c.st('SW-PH'));
    g.pipe('M262 84 L262 150 L300 150 L300 198', 'w', true); g.drum(272, 200, 58, 16, sw); g.tag(301, 236, n('V-x36'), 'middle');
    g.val(356, 256, cl === null && fe === null && ph === null ? 'no sample' : `Cl ${or(cl)} · Fe ${or(fe)} · pH ${or(ph)}`, cl === null && fe === null && ph === null ? 'grey' : sw, 'end');
    return g.s;
  }
  // Fractionation (common)
  const g = sheet(360, 352);
  const prod = (re: RegExp) => c.products.find((p) => re.test(p.product));
  g.stub(4, 20, 'V-113 · V-213'); g.lbl(4, 36, 'LP hot seps'); g.pipe('M40 42 L40 52', 'bot');
  g.furnace(12, 66, 54, 52, c.st('H103-SKIN') === 'grey' ? 'ok' : c.st('H103-SKIN')); g.tag(39, 138, 'H-103', 'middle'); g.pipe('M66 96 L118 96', 'bot');
  g.stub(4, 172, 'V-109 · V-209'); g.lbl(4, 188, 'via E-110/210 · E-108'); g.pipe('M4 198 L118 198', 'bot');
  g.column(120, 28, 36, 276); g.tag(114, 300, 'T-102', 'end');
  g.pipe('M138 28 L138 14 L194 14 L194 20', 'gas'); g.drum(176, 22, 52, 18); g.tag(202, 58, 'V-115', 'middle');
  g.pipe('M228 31 L313 31 L313 50', 'prod'); g.lbl(270, 24, 'via V-117 · E-125', 'middle');
  const nap = c.st('NAP-H2S'); g.column(300, 52, 26, 112, nap === 'grey' ? 'ok' : nap, 7); g.badge(326, 54, nap === 'grey' ? 'ok' : nap); g.tag(294, 74, 'T-104', 'end');
  const h2s = c.lab('NAPHTHA', 'H2S'), np = prod(/naphtha/i);
  g.pipe('M313 164 L313 178', 'prod'); g.val(356, 196, `Naphtha H₂S ${or(h2s, 'ppm')}`, nap, 'end'); g.lbl(356, 212, `${or(np?.value ?? null, np?.unit ?? '')} → ${np?.route ?? '—'}`, 'end');
  const dist = prod(/distillate/i), dsl = prod(/diesel/i), lsar = prod(/lsar/i);
  g.pipe('M156 110 L196 110 L196 116', 'prod'); g.column(186, 118, 20, 52, 'ok', 4); g.tag(212, 132, 'T-103');
  g.pipe('M196 170 L196 236 L208 236', 'prod'); g.stub(212, 241, `Distillate ${or(dist?.value ?? null, dist?.unit ?? '')}`, 'start', C.prod);
  g.pipe('M156 200 L172 200 L172 262 L186 262', 'prod'); g.column(188, 254, 18, 42, 'ok', 3); g.tag(212, 270, 'T-105'); g.stub(212, 292, `Diesel ${or(dsl?.value ?? null, dsl?.unit ?? '')}`, 'start', C.prod);
  g.pipe('M138 304 L138 334 L150 334', 'bot'); g.stub(156, 339, `LSAR ${or(lsar?.value ?? null, lsar?.unit ?? '')} → ${lsar?.route ?? 'U-13'}`, 'start', C.bot);
  return g.s;
}
