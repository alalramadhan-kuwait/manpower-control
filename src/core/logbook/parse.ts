// The unit's shift logs and lab reports, read from the PDFs the e-logbook and the lab system e-mail every shift (owner,
// 24 Nov 2026). Pure functions on the PDF's text pieces with their positions (x, y from the top of the page), so a
// value is matched to its name by where it sits on the page, never by the order the text comes out (a plain text read
// runs table cells together: injection water "6" and "7" came out as "67"). Nothing is guessed: a cell that cannot be
// placed is left out and counted, and an empty or "NAN" cell stays empty.
// Runs on the owner's Mac (node, which reads TypeScript directly), so this file imports nothing.

export interface Piece { p: number; x: number; y: number; w: number; s: string }
export interface Page { h: number; pieces: Piece[] }

export type LogKind = 'ards' | 'htu' | 'controller1';
export interface RemarkGroup { group: string; items: string[] }
export interface RemarkSection { role: string; groups: RemarkGroup[] }
export interface Reading { label: string; tr1: string | null; tr2: string | null; unit: string | null }
export interface FeedRow { train: string; total: string | null; hot: string | null; cold: string | null; backwashMin: string | null }
export interface ProductRow { product: string; route: string | null; value: string | null; unit: string | null }
export interface ShiftLog {
  kind: LogKind; logNo: number; date: string; shift: string | null; crew: string | null; day: string | null; createdAt: string | null;
  sections: RemarkSection[]; readings: Reading[]; feed: FeedRow[]; products: ProductRow[]; unplaced: number;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Pieces of one page grouped into lines (same y within tol), each line's pieces left to right. */
export function linesOf(pieces: Piece[], tol = 2): { y: number; pieces: Piece[]; text: string }[] {
  const sorted = [...pieces].filter((q) => q.s.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const out: { y: number; pieces: Piece[]; text: string }[] = [];
  for (const q of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(q.y - last.y) <= tol) last.pieces.push(q); else out.push({ y: q.y, pieces: [q], text: '' });
  }
  for (const l of out) { l.pieces.sort((a, b) => a.x - b.x); l.text = norm(l.pieces.map((q) => q.s).join(' ')); }
  return out;
}

const KUWAIT = '+03:00';
const isoDate = (d: string, m: string, y: string) => `${y}-${m}-${d}`;

/** Header of any of the three logs: kind, number, date, shift / crew / day, record created time. */
export function parseHeader(text: string): Pick<ShiftLog, 'kind' | 'logNo' | 'date' | 'shift' | 'crew' | 'day' | 'createdAt'> | null {
  const k = /Logbook #(\d+),\s*(ARDS|HTU)\b/i.exec(text);
  const c = /Controller I Log #(\d+)/i.exec(text);
  if (!k && !c) return null;
  const d = /Date:\s*(\d{2})-(\d{2})-(\d{4})/.exec(text);
  if (!d) return null;
  const s = /(Morning|Afternoon|Night)\/([A-D])\/(1st|2nd)/i.exec(text);
  const t = /Record Created Time:\s*(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/.exec(text);
  return {
    kind: c ? 'controller1' : (k![2].toLowerCase() as 'ards' | 'htu'), logNo: Number(c ? c[1] : k![1]),
    date: isoDate(d[1], d[2], d[3]), shift: s ? s[1][0].toUpperCase() + s[1].slice(1).toLowerCase() : null,
    crew: s ? s[2].toUpperCase() : null, day: s ? s[3].toLowerCase() : null,
    createdAt: t ? `${isoDate(t[1], t[2], t[3])}T${t[4]}:${t[5]}:${t[6]}${KUWAIT}` : null,
  };
}

// ── Remarks ─────────────────────────────────────────────────────────────────────────────────────────────────────
const SECTION = /^(.*?)\s*Remarks$/i;
const GROUP = /^(OCR|LP|HP|Low Pressure|High Pressure|Utilities|General|Common|Train\s*-?\s*\d(\s*&\s*\d)?|TR\s*-?\s*\d|TRAIN\s*-?\s*\d)\s*:?$/i;
const isGroup = (t: string) => !/^[#*]/.test(t) && t.length <= 30 && (GROUP.test(t) || /:$/.test(t));

/** Remark sections ("CONTROLLER Remarks", "CONTROL ROOM REMARKS", "FIELD OPERATOR Remarks"): groups (OCR, Train 1 …)
 *  and their items ("# …"); a line that is neither continues the item before it. A section ends at a table or heading. */
export function parseRemarks(pages: Page[]): RemarkSection[] {
  const out: RemarkSection[] = [];
  let cur: RemarkSection | null = null;
  for (const page of pages) for (const l of linesOf(page.pieces)) {
    const first = l.pieces[0];
    const m = SECTION.exec(l.text);
    if (m && l.pieces.length === 1) { cur = { role: norm(m[1]).toUpperCase() || 'REMARKS', groups: [] }; out.push(cur); continue; }
    if (!cur) continue;
    // remark lines are single, left-aligned text; anything else (a table row, a heading further right) ends the section
    if (l.pieces.length > 1 || first.x > 50) { cur = null; continue; }
    const t = l.text;
    if (isGroup(t)) { cur.groups.push({ group: t.replace(/:$/, '').trim(), items: [] }); continue; }
    let g = cur.groups[cur.groups.length - 1];
    if (!g) { g = { group: '', items: [] }; cur.groups.push(g); }
    if (/^[#*]/.test(t) || !g.items.length) g.items.push(t.replace(/^[#*]\s*/, '').trim());
    else g.items[g.items.length - 1] = `${g.items[g.items.length - 1]} ${t}`;
  }
  return out.filter((s) => s.groups.some((g) => g.items.length));
}

/** The Controller I log covers several sections: only its "Section-1 U-12 ARDS" part (up to the next "Section-"). */
export function parseControllerArds(pages: Page[]): RemarkSection[] {
  const groups: RemarkGroup[] = [];
  let on = false;
  for (const page of pages) for (const l of linesOf(page.pieces)) {
    const t = l.text;
    if (/^Section-\d/i.test(t)) { on = /U-?12\b.*ARDS|ARDS.*U-?12\b/i.test(t); continue; }
    if (!on) continue;
    if (isGroup(t)) { groups.push({ group: t.replace(/:$/, '').trim(), items: [] }); continue; }
    let g = groups[groups.length - 1];
    if (!g) { g = { group: '', items: [] }; groups.push(g); }
    if (/^[#*]/.test(t) || !g.items.length) g.items.push(t.replace(/^[#*]\s*/, '').trim());
    else g.items[g.items.length - 1] = `${g.items[g.items.length - 1]} ${t}`;
  }
  const kept = groups.filter((g) => g.items.length);
  return kept.length ? [{ role: 'CONTROLLER I', groups: kept }] : [];
}

// ── Train readings ("Train1 & 2"): two blocks per page, flowing A → B → next page A … ────────────────────────────
const blockOf = (q: Piece) => (q.x < 400 ? 0 : 1);

/**
 * The readings table. Each page has a left block (names at x≈50, TR-1 / TR-2 / unit at ≈142 / 235 / 329) and a right
 * block (≈429; 522 / 615 / 708); the table flows down the left block, then the right, then the next page, and a name
 * can wrap over two or three lines and across a block or page break. Laid end to end in that order, each name piece
 * belongs to the value line nearest to it.
 */
export function parseReadings(pages: Page[]): { readings: Reading[]; unplaced: number } {
  // the table starts at "Train1 & 2" and ends at "Lab Test Results" (or the next section)
  let started = false, ended = false;
  const blocks: { key: string; order: number; h: number; pieces: Piece[] }[] = [];
  pages.forEach((page, pi) => {
    if (ended) return;
    for (const l of linesOf(page.pieces)) {
      if (!started) { if (/^Train\s*1\s*&\s*2$/i.test(l.text)) { started = true; } continue; }
      if (/^(Lab Test Results|ByPass Conditions|FIELD OPERATOR)/i.test(l.text)) { ended = true; break; }
      for (const q of l.pieces) {
        const key = `${pi}:${blockOf(q)}`;
        let b = blocks.find((x) => x.key === key);
        if (!b) { b = { key, order: pi * 2 + blockOf(q), h: page.h, pieces: [] }; blocks.push(b); }
        b.pieces.push(q);
      }
    }
  });
  blocks.sort((a, b) => a.order - b.order);
  // end to end: each block starts where the one before it ends (a page height further down)
  let offset = 0;
  type Tup = { y: number; tr1: string | null; tr2: string | null; unit: string | null; labels: { y: number; s: string }[] };
  const tuples: Tup[] = []; const labels: { y: number; s: string }[] = [];
  for (const b of blocks) {
    const left = b.order % 2 === 0;
    const nameMax = left ? 130 : 510;
    const col = left ? [142, 235, 329] : [522, 615, 708];
    const vals = b.pieces.filter((q) => q.x >= nameMax);
    for (const l of linesOf(vals, 3)) {
      if (l.pieces.some((q) => /Reading/i.test(q.s))) continue;            // the header row
      const cell: (string | null)[] = [null, null, null];
      for (const q of l.pieces) {
        const i = col.map((c) => Math.abs(q.x - c)).reduce((bi, d, j, a) => (d < a[bi] ? j : bi), 0);
        cell[i] = norm(`${cell[i] ?? ''} ${q.s}`);
      }
      tuples.push({ y: offset + l.y, tr1: cell[0], tr2: cell[1], unit: cell[2], labels: [] });
    }
    for (const q of b.pieces.filter((x) => x.x < nameMax)) {
      if (/^Parameters/i.test(q.s.trim())) continue;
      labels.push({ y: offset + q.y, s: q.s });
    }
    offset += b.h;
  }
  let unplaced = 0;
  for (const lab of labels) {
    let best: Tup | null = null;
    for (const t of tuples) if (!best || Math.abs(t.y - lab.y) < Math.abs(best.y - lab.y)) best = t;
    if (best && Math.abs(best.y - lab.y) <= 20) best.labels.push(lab); else unplaced++;
  }
  const clean = (v: string | null) => (v === null || /^nan$/i.test(v) || v === '' ? null : v);
  const readings = tuples.map((t) => ({
    label: t.labels.sort((a, b) => a.y - b.y).map((l) => l.s.trim()).reduce((acc, s) => (acc.endsWith('-') ? acc + s : acc ? `${acc} ${s}` : s), ''),
    tr1: clean(t.tr1), tr2: clean(t.tr2), unit: t.unit ? t.unit.replace(/^°?\s*F$/, '°F') : null,
  }));
  return { readings: readings.filter((r) => r.label || r.tr1 || r.tr2), unplaced };
}

// ── Feed & frequency, Products (left half of the controller's page) ─────────────────────────────────────────────
function tableAfter(pages: Page[], heading: RegExp, maxX = 400): string[][] {
  const rows: string[][] = [];
  let on = false;
  for (const page of pages) for (const l of linesOf(page.pieces.filter((q) => q.x < maxX))) {
    if (heading.test(l.text) && l.pieces.length === 1) { on = true; continue; }
    if (!on) continue;
    if (l.pieces.length === 1 && l.pieces[0].x < 47) return rows;            // the next heading
    rows.push(l.pieces.map((q) => norm(q.s)));
  }
  return rows;
}
export function parseFeed(pages: Page[]): FeedRow[] {
  return tableAfter(pages, /^Feed & frequency/i).filter((r) => /^TR-?\d/i.test(r[0])).map((r) => ({
    train: r[0].toUpperCase().replace(/^TR(\d)/, 'TR-$1'), total: r[1] ?? null, hot: r[2] ?? null, cold: r[3] ?? null, backwashMin: r[4] ?? null }));
}
export function parseProducts(pages: Page[]): ProductRow[] {
  return tableAfter(pages, /^Products$/i).filter((r) => r.length >= 3 && !/^Description$/i.test(r[0])).map((r) => ({
    product: r[0], route: r[1] ?? null, value: r[2] ?? null, unit: r[3] ?? null }));
}

/** One shift log, or null when the file is not one of the three logs. */
export function parseShiftLog(pages: Page[]): ShiftLog | null {
  const head = pages.length ? parseHeader(linesOf(pages[0].pieces).slice(0, 6).map((l) => l.text).join('\n')) : null;
  if (!head) return null;
  if (head.kind === 'controller1') return { ...head, sections: parseControllerArds(pages), readings: [], feed: [], products: [], unplaced: 0 };
  const r = head.kind === 'ards' ? parseReadings(pages) : { readings: [], unplaced: 0 };
  return { ...head, sections: parseRemarks(pages), readings: r.readings, unplaced: r.unplaced,
    feed: head.kind === 'ards' ? parseFeed(pages) : [], products: head.kind === 'ards' ? parseProducts(pages) : [] };
}

// ── Lab report ("AREA 4 UNIT 12 RESULTS"): one column per sample ────────────────────────────────────────────────
export interface LabResult { component: string; unit: string | null; value: string }
export interface LabSample { sampleId: string; unitNo: string | null; material: string | null; equipment: string | null; collectedAt: string | null; note: string | null; results: LabResult[] }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Nov 202 02:36" (the report cuts the year): the year comes from the report's "From : 24 Nov 2026". */
export function labTime(cell: string, reportYear: number | null): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})\s+\d{0,4}\s*(\d{1,2}):(\d{2})/.exec(cell);
  if (!m || reportYear === null) return null;
  const mo = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  if (mo < 0) return null;
  const two = (n: number | string) => String(n).padStart(2, '0');
  return `${reportYear}-${two(mo + 1)}-${two(m[1])}T${two(m[3])}:${m[4]}:00${KUWAIT}`;
}

export function parseLabReport(pages: Page[]): LabSample[] {
  const out: LabSample[] = [];
  let year: number | null = null;
  for (const page of pages) {
    const lines = linesOf(page.pieces, 1);
    for (const l of lines) { const f = /From\s*:\s*\d{1,2}\s+[A-Za-z]{3}\s+(\d{4})/.exec(l.text); if (f) year = Number(f[1]); }
    // name pieces sit left (x < 115: name and unit columns); each block starts with SAMPLEID
    const names = page.pieces.filter((q) => q.x < 115 && q.s.trim());
    // value pieces: right of the name / unit columns, above the page footer ("PRINTED ON …  Page 1 of 1")
    const values = page.pieces.filter((q) => q.x >= 115 && q.s.trim() && q.y < page.h - 30);
    const starts = names.filter((q) => /^SAMPLEID$/i.test(q.s.trim())).map((q) => q.y).sort((a, b) => a - b);
    starts.forEach((y0, bi) => {
      const y1 = starts[bi + 1] ?? page.h - 30;
      const inBlock = (q: Piece) => q.y >= y0 - 4 && q.y < y1 - 4;
      const bNames = names.filter(inBlock), bVals = values.filter(inBlock).filter((q) => !/KUWAIT|REFINERY|RESULTS|From\s*:/i.test(q.s));
      // columns: one per value piece on the UNIT NO. row (centres)
      const unitRow = bNames.find((q) => /^UNIT NO\.?$/i.test(q.s.trim()));
      if (!unitRow) return;
      const cols = bVals.filter((q) => Math.abs(q.y - unitRow.y) <= 3).map((q) => q.x + q.w / 2).sort((a, b) => a - b);
      if (!cols.length) return;
      const colOf = (q: Piece) => cols.map((c) => Math.abs(q.x + q.w / 2 - c)).reduce((bi2, d, j, a) => (d < a[bi2] ? j : bi2), 0);
      // name rows: the name piece (x < 80) and its unit piece (80–115) on the same row
      const rowNames = linesOf(bNames, 3).map((l) => ({ y: l.y, name: norm(l.pieces.filter((q) => q.x < 80).map((q) => q.s).join(' ')), unit: norm(l.pieces.filter((q) => q.x >= 80).map((q) => q.s).join(' ')) || null }));
      const cells = new Map<string, string[]>();                                 // `${row}:${col}` → text
      const sampleIdExtra = new Map<number, string>();
      for (const q of bVals) {
        let best = -1, dist = Infinity;
        rowNames.forEach((r, i) => { const d = Math.abs(r.y - q.y); if (d < dist) { dist = d; best = i; } });
        const c = colOf(q);
        if (best >= 0 && dist <= 6) { const k = `${best}:${c}`; cells.set(k, [...(cells.get(k) ?? []), q.s.trim()]); }
        else if (best >= 0 && /^SAMPLEID$/i.test(rowNames[best].name)) sampleIdExtra.set(c, `${sampleIdExtra.get(c) ?? ''}${q.s.trim()}`);
        else if (rowNames.findIndex((r) => /^SAMPLEID$/i.test(r.name)) >= 0) {
          // the second line of a wrapped sample id sits under the SAMPLEID row
          const si = rowNames.findIndex((r) => /^SAMPLEID$/i.test(r.name));
          if (q.y > rowNames[si].y && q.y - rowNames[si].y <= 14) sampleIdExtra.set(c, `${sampleIdExtra.get(c) ?? ''}${q.s.trim()}`);
        }
      }
      const get = (re: RegExp, c: number) => { const i = rowNames.findIndex((r) => re.test(r.name)); return i < 0 ? null : (cells.get(`${i}:${c}`) ?? []).join(' ') || null; };
      cols.forEach((_, c) => {
        const id = `${get(/^SAMPLEID$/i, c) ?? ''}${sampleIdExtra.get(c) ?? ''}`.replace(/\s+/g, '');
        if (!id) return;
        const results: LabResult[] = [];
        rowNames.forEach((r, i) => {
          if (/^(SAMPLEID|UNIT NO\.?|MATERIAL|COLLECTION DATE|EQUIPMENT|COMPONENT)$/i.test(r.name) || !r.name) return;
          const v = (cells.get(`${i}:${c}`) ?? []).join(' ').trim();
          if (v) results.push({ component: r.name, unit: r.unit && r.unit !== '-' ? r.unit.replace(/^°\s*F$/, '°F') : null, value: v });
        });
        out.push({ sampleId: id, unitNo: get(/^UNIT NO\.?$/i, c), material: get(/^MATERIAL$/i, c), equipment: get(/^EQUIPMENT$/i, c),
          collectedAt: labTime(get(/^COLLECTION DATE$/i, c) ?? '', year), note: get(/^COMPONENT$/i, c), results });
      });
    });
  }
  return out;
}

/** A number when the text is one ("1.150", "-0.3", "+30"); otherwise null (the text is kept as it is). */
export const num = (v: string | null): number | null => (v !== null && /^[+-]?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
