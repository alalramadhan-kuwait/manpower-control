// A3 landscape PDFs of the vacation plan (pdf-lib, vector, true A3 = 420 × 297 mm): the blank selection forms (from
// core/vacation/layout, the same geometry the form reader uses) and the final approved plan. No company name or logo
// (IT rule); no Civil ID anywhere.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { cyclesOf, type PvCycle } from '@/core/pv';
import { A3, BIT, COLS, MARGIN, MARK, bitBoxes, marks, type FormDoc, type FormSection } from '@/core/vacation/layout';
import { VAC_RULES } from '@/core/vacation/rules';
import type { Crew } from '@/core/roster';

const INK = rgb(0.06, 0.09, 0.16), GREY = rgb(0.42, 0.45, 0.5), LINE = rgb(0.72, 0.75, 0.8), BOX = rgb(0.25, 0.28, 0.33);
const SUMMER = rgb(0.99, 0.95, 0.84), BLOCK = rgb(0.86, 0.87, 0.89), NAVY = rgb(0.055, 0.165, 0.388), SYS = rgb(0.98, 0.83, 0.42), APPROVED = rgb(0.13, 0.55, 0.28);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
/** Only characters the standard PDF fonts carry. */
const safe = (s: string) => s.replace(/[^\x20-\x7e -ÿ–—‘’“”•…]/g, '?');

interface Ctx { page: PDFPage; f: PDFFont; b: PDFFont }
/** Draws in top-left coordinates. */
const T = (c: Ctx, s: string, x: number, y: number, size: number, o: { bold?: boolean; color?: ReturnType<typeof rgb>; maxW?: number; align?: 'left' | 'center' | 'right' } = {}) => {
  const font = o.bold ? c.b : c.f; let text = safe(s); let sz = size;
  if (o.maxW) { while (sz > 6 && font.widthOfTextAtSize(text, sz) > o.maxW) sz -= 0.5; while (font.widthOfTextAtSize(text, sz) > o.maxW && text.length > 3) text = text.slice(0, -2) + '…'; }
  const w = font.widthOfTextAtSize(text, sz);
  const dx = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
  c.page.drawText(text, { x: x + dx, y: A3.h - y - sz * 0.8, size: sz, font, color: o.color ?? INK });
};
const R = (c: Ctx, x: number, y: number, w: number, h: number, o: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb>; bw?: number } = {}) =>
  c.page.drawRectangle({ x, y: A3.h - y - h, width: w, height: h, color: o.fill, borderColor: o.border, borderWidth: o.border ? o.bw ?? 0.6 : 0 });
const L = (c: Ctx, x1: number, y1: number, x2: number, y2: number, color = LINE, t = 0.5) => c.page.drawLine({ start: { x: x1, y: A3.h - y1 }, end: { x: x2, y: A3.h - y2 }, thickness: t, color });

function frame(c: Ctx, bits: number[] | null) {
  for (const m of marks()) R(c, m.x, m.y, MARK, MARK, { fill: INK });
  if (bits) bitBoxes().forEach((bx, i) => (bits[i] ? R(c, bx.x, bx.y, bx.w, bx.h, { fill: INK }) : R(c, bx.x, bx.y, bx.w, bx.h, { border: LINE, bw: 0.4 })));
}

function columnsHead(c: Ctx, s: FormSection, y: number, label: string, slots: string | null) {
  const x0 = MARGIN;
  T(c, s.title, x0, y + 1, 10, { bold: true, color: NAVY });
  const hy = y + 15;
  const heads: [string, number][] = [['No', COLS.no], ['Name', COLS.name], ['Emp. no', COLS.number], [label, COLS.detail]];
  let x = x0; for (const [h, w] of heads) { T(c, h, x + 2, hy + 10, 7.5, { bold: true, color: GREY, maxW: w - 4 }); x += w; }
  for (const col of s.cols) {
    if (col.cycle.summer) R(c, col.x, hy, col.w, 30 + 12 + s.rows.length * (s.rows[0]?.h ?? 0), { fill: SUMMER });
    T(c, `C${col.cycle.index + 1}`, col.x + col.w / 2, hy + 1, 8, { bold: true, align: 'center' });
    T(c, dm(col.cycle.start), col.x + col.w / 2, hy + 11, 6.5, { align: 'center', color: GREY, maxW: col.w - 2 });
    T(c, dm(col.cycle.end), col.x + col.w / 2, hy + 19, 6.5, { align: 'center', color: GREY, maxW: col.w - 2 });
  }
  const last = s.cols.at(-1)!;
  if (slots !== null) {
    T(c, 'Initial', last.x + last.w + 4, hy + 10, 7.5, { bold: true, color: GREY });
    T(c, 'Slots per cycle', x0 + COLS.no + 2, hy + 31, 7, { color: GREY });
    for (const col of s.cols) T(c, slots, col.x + col.w / 2, hy + 31, 7, { align: 'center', bold: true, color: GREY, maxW: col.w - 2 });
  }
  L(c, x0, hy + 41, last.x + last.w + COLS.initial, hy + 41, BOX, 0.8);
}

/** The blank selection form: one A3 landscape page per page of the layout. */
export async function formPdf(doc: FormDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title); pdf.setSubject('Annual vacation selection form'); pdf.setCreator('ARDS Operations · Area 4 · Unit 12'); pdf.setProducer('ARDS Operations');
  const f = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const p of doc.pages) {
    const page = pdf.addPage([A3.w, A3.h]);
    const c: Ctx = { page, f, b };
    frame(c, p.bits);
    T(c, p.title, MARGIN + MARK + 10, MARGIN + 1, 16, { bold: true, color: NAVY });
    T(c, p.sub, A3.w - MARGIN - MARK - 10, MARGIN + 4, 9, { align: 'right', color: GREY });
    T(c, `Mark X in each whole cycle you want. Neighbouring cycles make one vacation. ${VAC_RULES.minPeriods}–${VAC_RULES.maxPeriods} vacations a year. "Slots" = how many of your group may be off in that cycle.`, MARGIN + MARK + 10, MARGIN + 24, 9);
    T(c, `Summer (shaded, Jun–Sep): one vacation of ${VAC_RULES.summerMaxCycles} cycles at most.${doc.kind === 'controllers' ? ' Controllers: never two off at the same time (whole unit).' : ''} Grey box: not available (SD = shutdown team, L = already on leave). Initial your row.`, MARGIN + MARK + 10, MARGIN + 37, 9);
    for (const s of p.sections) {
      columnsHead(c, s, s.y, doc.kind === 'controllers' ? 'Grade / role' : 'Grade', s.slots);
      const last = s.cols.at(-1)!;
      for (const r of s.rows) {
        L(c, MARGIN, r.y + r.h, last.x + last.w + COLS.initial, r.y + r.h);
        T(c, String(r.no), MARGIN + 3, r.y + 8, 9);
        T(c, r.name, MARGIN + COLS.no + 2, r.y + (r.note ? 4 : 8), 9.5, { bold: true, maxW: COLS.name - 4 });
        if (r.note) T(c, r.note, MARGIN + COLS.no + 2, r.y + 14.5, 6.5, { color: GREY, maxW: COLS.name - 4 });
        T(c, r.number, MARGIN + COLS.no + COLS.name + 2, r.y + 8, 9, { maxW: COLS.number - 4 });
        T(c, r.detail, MARGIN + COLS.no + COLS.name + COLS.number + 2, r.y + 8, 8, { maxW: COLS.detail - 4 });
        const blocked = s.restricted.get(r.employeeId);
        for (const col of s.cols) {
          const why = blocked?.get(col.cycle.index);
          const bx = col.x + 3, by = r.y + 3, bw = col.w - 6, bh = r.h - 6;
          if (why) { R(c, bx, by, bw, bh, { fill: BLOCK }); T(c, why, bx + bw / 2, by + bh / 2 - 3, 7, { bold: true, align: 'center', color: GREY }); }
          else R(c, bx, by, bw, bh, { border: BOX, bw: 0.8 });
        }
        R(c, last.x + last.w + 4, r.y + 3, COLS.initial - 8, r.h - 6, { border: BOX, bw: 0.8 });
      }
    }
    const fy = A3.h - MARGIN - 58;
    T(c, 'Supervisor review:  Name ____________________________   Signature ____________________   Date ______________        Entered in the app by ______________   on ____________', MARGIN + 4, fy, 9);
    T(c, `${p.sub.split(' · ')[0]} · page ${p.page}/${p.pages} · keep the corner squares and the strip clear when scanning or photographing`, A3.w / 2, A3.h - MARGIN - MARK - 12, 7, { align: 'center', color: GREY });
  }
  return pdf.save();
}

// ── final plan ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface FinalPerson { employeeId: string; name: string; number: string; detail: string; crew: Crew; periods: { start: string; end: string; system: boolean; changed: boolean }[] }
export interface FinalGroup { title: string; crew: Crew; people: FinalPerson[] }
export interface FinalDoc { title: string; year: number; version: string; approved: string; groups: FinalGroup[] }

/** The approved plan: each person's whole year on one row (cycles of their rota), the periods with dates beside it. */
export async function finalPdf(doc: FinalDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title); pdf.setSubject(`Approved annual vacation plan ${doc.year}`); pdf.setCreator('ARDS Operations · Area 4 · Unit 12'); pdf.setProducer('ARDS Operations');
  const f = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const nameW = 140, numW = 44, detW = 52, perW = 238, rowH = 17, top = MARGIN + 46, bottom = A3.h - MARGIN - 24;
  const x0 = MARGIN, xCells = x0 + nameW + numW + detW;
  const cellsW = A3.w - 2 * MARGIN - nameW - numW - detW - perW;
  let page!: PDFPage; let c!: Ctx; let y = 0; let n = 0;
  const newPage = () => {
    page = pdf.addPage([A3.w, A3.h]); c = { page, f, b }; n++;
    T(c, doc.title, x0, MARGIN, 16, { bold: true, color: NAVY });
    T(c, `${doc.version} · approved ${doc.approved} · page ${n}`, A3.w - MARGIN, MARGIN + 4, 9, { align: 'right', color: GREY });
    T(c, 'Filled = approved vacation · amber = assigned by the system · * = changed after approval (Calendar) · shaded = summer', x0, MARGIN + 22, 8.5, { color: GREY });
    y = top;
  };
  newPage();
  for (const g of doc.groups) {
    const cycles: PvCycle[] = cyclesOf(g.crew, doc.year);
    const cw = cellsW / cycles.length;
    if (y + 40 + g.people.length * rowH > bottom && y > top) newPage();
    T(c, g.title, x0, y, 10.5, { bold: true, color: NAVY });
    y += 15;
    // month band and cycle numbers
    for (const [i, cy] of cycles.entries()) {
      const x = xCells + i * cw;
      if (cy.summer) R(c, x, y, cw, 20 + g.people.length * rowH, { fill: SUMMER });
      if (i === 0 || cycles[i - 1].start.slice(5, 7) !== cy.start.slice(5, 7)) T(c, MONTHS[Number(cy.start.slice(5, 7)) - 1], x + 1, y, 7, { bold: true, color: GREY });
      T(c, String(i + 1), x + cw / 2, y + 10, 6, { align: 'center', color: GREY });
    }
    T(c, 'Name', x0 + 2, y + 10, 7.5, { bold: true, color: GREY }); T(c, 'Emp. no', x0 + nameW + 2, y + 10, 7.5, { bold: true, color: GREY });
    T(c, 'Role', x0 + nameW + numW + 2, y + 10, 7.5, { bold: true, color: GREY }); T(c, 'Vacation periods', xCells + cellsW + 6, y + 10, 7.5, { bold: true, color: GREY });
    y += 20;
    for (const p of g.people) {
      if (y + rowH > bottom) { newPage(); T(c, `${g.title} (continued)`, x0, y, 10.5, { bold: true, color: NAVY }); y += 15; }
      L(c, x0, y + rowH, A3.w - MARGIN, y + rowH);
      T(c, p.name, x0 + 2, y + 5, 8.5, { bold: true, maxW: nameW - 4 }); T(c, p.number, x0 + nameW + 2, y + 5, 8); T(c, p.detail, x0 + nameW + numW + 2, y + 5, 7.5, { maxW: detW - 4 });
      for (const [i, cy] of cycles.entries()) {
        const per = p.periods.find((x) => x.start <= cy.end && cy.start <= x.end);
        const x = xCells + i * cw;
        if (per) R(c, x + 0.8, y + 3, cw - 1.6, rowH - 6, { fill: per.system ? SYS : APPROVED });
        else R(c, x + 0.8, y + 3, cw - 1.6, rowH - 6, { border: LINE, bw: 0.3 });
      }
      const text = p.periods.map((x) => `${dm(x.start)}–${dm(x.end)}${x.system ? ' (S)' : ''}${x.changed ? '*' : ''}`).join(', ') || '—';
      T(c, `${p.periods.length} · ${text}`, xCells + cellsW + 6, y + 5, 7, { maxW: perW - 8 });
      y += rowH;
    }
    y += 10;
  }
  return pdf.save();
}

/** Several PDFs as one file (Export all). */
export async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const p of parts) { const src = await PDFDocument.load(p); const pages = await out.copyPages(src, src.getPageIndices()); for (const pg of pages) out.addPage(pg); }
  return out.save();
}
export const BIT_COUNT = BIT.count;
