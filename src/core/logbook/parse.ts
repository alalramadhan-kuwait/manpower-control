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
export interface Reading { label: string; key: string; tr1: string | null; tr2: string | null; unit: string | null }
export interface FeedRow { train: string; total: string | null; hot: string | null; cold: string | null; backwashMin: string | null }
export interface ProductRow { product: string; route: string | null; value: string | null; unit: string | null }
/** One person in the log's Manpower section (owner, 28 Nov 2026: "who is the controller … who was there"). */
export interface StaffRow { role: string; empNo: string; name: string; position: string | null; area: string | null }
export interface ShiftLog {
  kind: LogKind; logNo: number; date: string; shift: string | null; crew: string | null; day: string | null; createdAt: string | null;
  sections: RemarkSection[]; readings: Reading[]; feed: FeedRow[]; products: ProductRow[]; unplaced: number; manpower?: StaffRow[];
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
// "CONTROLLER Remarks" (ARDS) or a plain "CONTROLLER" / "CONTROL ROOM OPERATOR" heading (HTU)
const SECTION = /^(?:(.*?)\s*Remarks|(CONTROLLER|CONTROL ROOM(?: OPERATOR)?|FIELD OPERATOR))$/i;
const GROUP = /^(OCR|LP|HP|Low Pressure|High Pressure|Utilities|General|Common|Train\s*-?\s*\d(\s*&\s*\d)?|TR\s*-?\s*\d|TRAIN\s*-?\s*\d|Unit\s*-?\s*\d+)\s*:?$/i;
/** A new item: "# …", "* …", "- …", "• …" or "1) …". */
const ITEM = /^([#*•-]|\d{1,2}[).])/;
const isGroup = (t: string) => !ITEM.test(t) && t.length <= 30 && (GROUP.test(t) || /:$/.test(t));
/** Headings of the tables that follow the remarks (they end a remark section). */
const TABLE_HEAD = /^(FEED & PRODUCTS|HIGH PRESSURE SECTION|LOW PRESSURE SECTION|Train\s*1\s*&\s*2|Lab Test Results|ByPass Conditions|Feed & frequency|Products$|.*\bREADINGS$)/i;
/** The same reading across logs, whatever the spacing or a dash lost at a page break ("PASS 2 … (H 12-102" = "PASS-2 … (H-12-102"). */
export const readingKey = (label: string) => label.toUpperCase().replace(/[^A-Z0-9]/g, '');
const addLine = (g: RemarkGroup, t: string) => {
  if (ITEM.test(t) || !g.items.length) g.items.push(t.replace(/^([#*•]|\d{1,2}[).])\s*/, '').replace(/^-\s+/, '').trim());
  else g.items[g.items.length - 1] = `${g.items[g.items.length - 1]} ${t}`;
};

/** Remark sections ("CONTROLLER Remarks", "CONTROL ROOM REMARKS", "FIELD OPERATOR Remarks"): groups (OCR, Train 1 …)
 *  and their items ("# …"); a line that is neither continues the item before it. A section ends at a table or heading. */
export function parseRemarks(pages: Page[]): RemarkSection[] {
  const out: RemarkSection[] = [];
  let cur: RemarkSection | null = null;
  for (const page of pages) for (const l of linesOf(page.pieces)) {
    const first = l.pieces[0];
    const m = SECTION.exec(l.text);
    if (m && l.pieces.length === 1) { cur = { role: norm(m[1] ?? m[2] ?? '').toUpperCase() || 'REMARKS', groups: [] }; out.push(cur); continue; }
    if (!cur) continue;
    // remark lines are single, left-aligned text; anything else (a table row, a heading further right, a table's
    // heading) ends the section
    if (l.pieces.length > 1 || first.x > 50 || TABLE_HEAD.test(l.text)) { cur = null; continue; }
    const t = l.text;
    if (isGroup(t)) { cur.groups.push({ group: t.replace(/:$/, '').trim(), items: [] }); continue; }
    let g = cur.groups[cur.groups.length - 1];
    if (!g) { g = { group: '', items: [] }; cur.groups.push(g); }
    addLine(g, t);
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
    // the remarks are single left-aligned lines; a table (several pieces on a line) or a table heading ends them
    if (l.pieces.length > 1 || l.pieces[0].x > 50 || TABLE_HEAD.test(t)) { on = false; continue; }
    if (isGroup(t)) { groups.push({ group: t.replace(/:$/, '').trim(), items: [] }); continue; }
    let g = groups[groups.length - 1];
    if (!g) { g = { group: '', items: [] }; groups.push(g); }
    addLine(g, t);
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
  // where the table starts: the "Train1 & 2" line (its right half may already hold table rows)
  let si = -1, y0 = 0;
  for (let pi = 0; pi < pages.length && si < 0; pi++) for (const l of linesOf(pages[pi].pieces)) {
    if (/^Train\s*1\s*&\s*2$/i.test(norm(l.pieces[0].s))) { si = pi; y0 = l.y; break; }
  }
  if (si < 0) return { readings: [], unplaced: 0 };
  // the right block of that page starts below the last remark line on the left, which can be above the title
  const before = pages[si].pieces.filter((q) => blockOf(q) === 0 && q.y < y0 - 2 && q.s.trim());
  const rightFrom = before.length ? Math.max(...before.map((q) => q.y)) + 2 : 0;
  // where it ends: "Lab Test Results" (or the next section) on the left
  let ei = pages.length - 1, y1 = Infinity;
  outer: for (let pi = si; pi < pages.length; pi++) for (const l of linesOf(pages[pi].pieces.filter((q) => blockOf(q) === 0))) {
    if (pi === si && l.y <= y0) continue;
    if (/^(Lab Test Results|ByPass Conditions|FIELD OPERATOR)/i.test(l.text)) { ei = pi; y1 = l.y; break outer; }
  }
  const blocks: { order: number; pieces: Piece[] }[] = [];
  for (let pi = si; pi <= ei; pi++) for (const side of [0, 1]) {
    const pieces = pages[pi].pieces.filter((q) => q.s.trim() && blockOf(q) === side
      && (pi !== si || (side === 0 ? q.y > y0 + 2 : q.y >= rightFrom))
      && (pi !== ei || q.y < y1 - 2));
    if (pieces.length) blocks.push({ order: pi * 2 + side, pieces });
  }
  // Each block: value lines (tuples) and name lines. A name wraps over up to three lines about 12 px apart, while rows
  // are 17 px or more apart, so name lines closer than 15 px are one name (a run), and a run owns the value line that
  // sits within it. A run with no value line beside it was cut by a block or page break: at the bottom of a block it is
  // the start of the next block's first row, at the top the end of the previous block's last row.
  type Tup = { y: number; tr1: string | null; tr2: string | null; unit: string | null; head: Piece[]; own: Piece[]; tail: Piece[] };
  type Run = { pieces: Piece[]; a: number; b: number };
  const perBlock: { tuples: Tup[]; runs: Run[] }[] = [];
  for (const b of blocks) {
    const left = b.order % 2 === 0;
    const nameMax = left ? 130 : 510;
    const col = left ? [142, 235, 329] : [522, 615, 708];
    const tuples: Tup[] = [];
    for (const l of linesOf(b.pieces.filter((q) => q.x >= nameMax), 3)) {
      if (l.pieces.some((q) => /Reading/i.test(q.s))) continue;            // the header row
      const cell: (string | null)[] = [null, null, null];
      for (const q of l.pieces) {
        const i = col.map((c) => Math.abs(q.x - c)).reduce((bi, d, j, a) => (d < a[bi] ? j : bi), 0);
        cell[i] = norm(`${cell[i] ?? ''} ${q.s}`);
      }
      tuples.push({ y: l.y, tr1: cell[0], tr2: cell[1], unit: cell[2], head: [], own: [], tail: [] });
    }
    const names = b.pieces.filter((q) => q.x < nameMax && !/^Parameters/i.test(q.s.trim())).sort((p, q) => p.y - q.y || p.x - q.x);
    const runs: Run[] = [];
    for (const q of names) {
      const r = runs[runs.length - 1];
      if (r && q.y - r.b <= 15) { r.pieces.push(q); r.b = q.y; } else runs.push({ pieces: [q], a: q.y, b: q.y });
    }
    perBlock.push({ tuples, runs });
  }
  let unplaced = 0;
  perBlock.forEach(({ tuples, runs }, bi) => {
    runs.forEach((r, ri) => {
      const inside = tuples.filter((t) => t.y >= r.a - 8 && t.y <= r.b + 8);
      if (inside.length === 1) { inside[0].own.push(...r.pieces); return; }
      if (inside.length > 1) {                                                 // two rows' names ran together: split
        for (const q of r.pieces) inside.reduce((x, t) => (Math.abs(t.y - q.y) < Math.abs(x.y - q.y) ? t : x)).own.push(q);
        return;
      }
      const last = ri === runs.length - 1 && !tuples.some((t) => t.y > r.b);
      const first = ri === 0 && !tuples.some((t) => t.y < r.a);
      const next = perBlock.slice(bi + 1).find((x) => x.tuples.length)?.tuples[0];
      const prev = [...perBlock.slice(0, bi)].reverse().find((x) => x.tuples.length)?.tuples.slice(-1)[0];
      if (last && next) next.head.push(...r.pieces);
      else if (first && prev) prev.tail.push(...r.pieces);
      else unplaced += 1;
    });
  });
  const clean = (v: string | null) => (v === null || /^(nan|-+)$/i.test(v) || v === '' ? null : v);
  const joinName = (ps: Piece[]) => linesOf(ps, 3).map((l) => l.text).reduce((acc, s) => (acc.endsWith('-') ? acc + s : acc ? `${acc} ${s}` : s), '');
  const readings: Reading[] = [];
  for (const t of perBlock.flatMap((x) => x.tuples)) {
    // a row cut by a break is drawn again, clipped, at the top of the next block: no unit, broken text ("CO SSO S", ". 5")
    if (!t.unit) continue;
    const label = [joinName(t.head), joinName(t.own), joinName(t.tail)].filter(Boolean).reduce((acc, s) => (acc.endsWith('-') ? acc + s : acc ? `${acc} ${s}` : s), '');
    readings.push({ label, key: readingKey(label), tr1: clean(t.tr1), tr2: clean(t.tr2), unit: t.unit.replace(/^°?\s*F$/, '°F') });
  }
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

// ── Manpower: "Controller" / "Field Operator" / "Panel Operator", each a table Employee | Position | Designated Area.
// A name may wrap onto the next line; the position and area may sit on the name's line or the next one.
const STAFF_HEAD = /^(Controllers?|Field Operators?|Panel Operators?|Shift (?:Engineer|Supervisor)s?)$/i;
const EMP = /^(\d{3,7})\s*-\s*(.+)$/;
export function parseManpower(pages: Page[]): StaffRow[] {
  const out: StaffRow[] = [];
  let on = false, role: string | null = null, cur: StaffRow | null = null;
  let cols = { pos: 330, area: 480 };                    // where Position and Designated Area start (from the header row)
  for (const page of pages) for (const l of linesOf(page.pieces)) {
    if (!on) { if (/^Manpower$/i.test(l.text)) on = true; continue; }
    if (l.pieces[0].x < 150 && STAFF_HEAD.test(l.text)) { role = l.text.replace(/s$/i, '').replace(/^\w/, (c) => c.toUpperCase()); cur = null; continue; }
    if (/\bEmployee\b/.test(l.text) && /\bPosition\b/.test(l.text)) {
      const at = (w: RegExp) => l.pieces.find((q) => w.test(q.s))?.x;
      const pos = at(/^Position/), area = at(/^Designated/);
      if (pos !== undefined && area !== undefined) cols = { pos: pos - 20, area: area - 20 };
      role ??= '';                                          // a table with no role headings (seen in an HTU log)
      continue;
    }
    if (role === null) continue;
    // a line only at the left margin that is not a role heading is the next section
    if (l.pieces.every((q) => q.x < 150)) { on = false; role = null; cur = null; continue; }
    for (const q of l.pieces) {
      const t = q.s.trim();
      if (q.x < 150) continue;                             // the Unit column
      if (q.x < cols.pos) {
        const m = EMP.exec(t);
        if (m) { cur = { role, empNo: m[1], name: norm(m[2]), position: null, area: null }; out.push(cur); }
        else if (cur) cur.name = cur.name.endsWith('-') ? cur.name + t : norm(`${cur.name} ${t}`);
      } else if (cur && q.x < cols.area) cur.position = norm(`${cur.position ?? ''} ${t}`);
      else if (cur) cur.area = norm(`${cur.area ?? ''} ${t}`);
    }
  }
  // no heading: the role is the position when it says Controller, otherwise not stated
  for (const r of out) if (!r.role) r.role = /^Controller$/i.test(r.position ?? '') ? 'Controller' : 'Staff';
  return out;
}

/** One shift log, or null when the file is not one of the three logs. */
export function parseShiftLog(pages: Page[]): ShiftLog | null {
  const head = pages.length ? parseHeader(linesOf(pages[0].pieces).slice(0, 6).map((l) => l.text).join('\n')) : null;
  if (!head) return null;
  if (head.kind === 'controller1') return { ...head, sections: parseControllerArds(pages), readings: [], feed: [], products: [], unplaced: 0 };
  const r = head.kind === 'ards' ? parseReadings(pages) : { readings: [], unplaced: 0 };
  return { ...head, sections: parseRemarks(pages), readings: r.readings, unplaced: r.unplaced,
    feed: head.kind === 'ards' ? parseFeed(pages) : [], products: head.kind === 'ards' ? parseProducts(pages) : [], manpower: parseManpower(pages) };
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
        const s: LabSample = { sampleId: id, unitNo: get(/^UNIT NO\.?$/i, c), material: get(/^MATERIAL$/i, c), equipment: get(/^EQUIPMENT$/i, c),
          collectedAt: labTime(get(/^COLLECTION DATE$/i, c) ?? '', year), note: get(/^COMPONENT$/i, c), results };
        // a long report repeats the same samples on the next pages with the rest of their tests: one sample each
        const seen = out.find((x) => x.sampleId === id);
        if (!seen) { out.push(s); return; }
        for (const k of ['unitNo', 'material', 'equipment', 'collectedAt', 'note'] as const) seen[k] ??= s[k];
        for (const r of results) if (!seen.results.some((x) => x.component === r.component)) seen.results.push(r);
      });
    });
  }
  return out;
}

/** A number when the text is one ("1.150", "-0.3", "+30"); otherwise null (the text is kept as it is). */
export const num = (v: string | null): number | null => (v !== null && /^[+-]?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
