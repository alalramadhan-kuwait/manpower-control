import type * as XLSX from 'xlsx';
import { isoDate, monthIndexFromName, normalizeEmployeeNumber, num, readerFor, text } from './sheet';
import type { CrewCode, ParsedGridRun, ParsedLeaveRange, ParsedManpowerWorkbook, ParsedPerson, RoleCode } from './types';

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function roleFromPvTitle(title: string): RoleCode | null {
  const t = title.toUpperCase();
  if (t.includes('CONTROLLER')) return 'controller';
  if (t.includes('CCR')) return 'panel_operator';
  if (t.includes('FIELD')) return 'field_operator';
  return null;
}

function roleFromBlockTitle(title: string): { role: RoleCode; crew: CrewCode | null } | null {
  const t = title.toUpperCase();
  const crew = t.match(/"?([ABCD])"?\s*SHIFT/);
  if (crew) return { role: 'field_operator', crew: crew[1] as CrewCode };
  if (t.includes('PANEL')) return { role: 'panel_operator', crew: null };
  if (t.includes('CONTROL')) return { role: 'controller', crew: null };
  return null;
}

export function detectYear(wb: XLSX.WorkBook): number | null {
  for (const name of wb.SheetNames) {
    const m = name.match(/(20\d\d)/);
    if (m && /schedule/i.test(name)) return Number(m[1]);
  }
  for (const name of wb.SheetNames) {
    if (!/^pv scheduled/i.test(name)) continue;
    const r = readerFor(wb, name);
    for (let row = 1; row <= Math.min(r.rows, 6); row++) {
      const t = text(r.get(row, 1));
      const m = t?.match(/YEAR\s+(20\d\d)/i);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

/** PV Scheduled: annual paid-vacation plan with crews. Authoritative for leave and for crew. */
export function parsePvSheet(wb: XLSX.WorkBook, sheetName: string, year: number, workbookName: string, warnings: string[]) {
  const r = readerFor(wb, sheetName);
  const people: ParsedPerson[] = [];
  const ranges: ParsedLeaveRange[] = [];
  let currentTitle = '';
  let row = 1;
  while (row <= r.rows) {
    const a = text(r.get(row, 1));
    if (a && /LEAVE SCHEDULE/i.test(a)) { currentTitle = a; row++; continue; }
    if (a !== 'S.N.') { row++; continue; }
    // header row: month columns
    const monthStarts: { col: number; month: number }[] = [];
    for (let col = 5; col <= r.cols; col++) {
      const h = text(r.get(row, col));
      if (h && MONTH_NAMES.includes(h.toUpperCase())) monthStarts.push({ col, month: MONTH_NAMES.indexOf(h.toUpperCase()) + 1 });
    }
    const role = roleFromPvTitle(currentTitle);
    if (!role) warnings.push(`${sheetName} row ${row}: could not determine role from section title "${currentTitle}"`);
    row++;
    while (row <= r.rows) {
      const sn = r.get(row, 1);
      if (sn === null || text(sn) === 'S.N.') break;
      const emp = normalizeEmployeeNumber(r.get(row, 2));
      const name = text(r.get(row, 3));
      const shift = (text(r.get(row, 4)) ?? '').toUpperCase();
      if (!emp || !name) { warnings.push(`${sheetName} row ${row}: missing employee number or name`); row++; continue; }
      let personRole: RoleCode = role ?? 'field_operator';
      let crew: CrewCode | null = null;
      if (['A', 'B', 'C', 'D'].includes(shift)) crew = shift as CrewCode;
      else if (shift === 'VR') personRole = 'vr_controller';
      else if (shift === 'M') personRole = 'morning_controller';
      else warnings.push(`${sheetName} row ${row}: unknown SHIFT code "${shift}" for ${emp}`);
      people.push({ employeeNumber: emp, shortName: name, role: personRole, crew, sourceRef: `${workbookName} / ${sheetName} / ${r.ref(row, 2)}` });
      for (let col = 5; col <= r.cols; col++) {
        const v = text(r.get(row, col));
        if (!v || !v.includes('~')) continue;
        const m = v.match(/^(\d{1,2})\s*~+\s*(\d{1,2})$/);
        const group = [...monthStarts].reverse().find((g) => g.col <= col);
        if (!m || !group) { warnings.push(`${sheetName} ${r.ref(row, col)}: cannot parse "${v}"`); continue; }
        const s = Number(m[1]); const e = Number(m[2]);
        let endMonth = group.month, endYear = year;
        if (e < s) { endMonth = group.month + 1; if (endMonth === 13) { endMonth = 1; endYear = year + 1; } }
        const start = isoDate(year, group.month, s); const end = isoDate(endYear, endMonth, e);
        if (!start || !end) { warnings.push(`${sheetName} ${r.ref(row, col)}: invalid dates in "${v}"`); continue; }
        ranges.push({ employeeNumber: emp, shortName: name, start, end, sourceRef: `${workbookName} / ${sheetName} / ${r.ref(row, col)}` });
      }
      row++;
    }
  }
  return { people, ranges };
}

/** Monthly grid: a 1 in a day cell = absent. Type is NOT encoded; only presence.
 *  Two layouts are seen in the field: (a) block title on the row directly above the `EMP #` header and day
 *  numbers on the header row itself; (b) the title several rows above, F/S letters on the header row and the
 *  day numbers on a following row (Panel/Controller blocks may put an Off-crew letter row in between). */
export function parseMonthlyGridSheet(wb: XLSX.WorkBook, sheetName: string, year: number, month: number, workbookName: string, warnings: string[]) {
  const r = readerFor(wb, sheetName);
  const people: ParsedPerson[] = [];
  const runs: ParsedGridRun[] = [];
  const dayColsOn = (rr: number) => {
    const cols: { col: number; day: number }[] = [];
    for (let col = 1; col <= r.cols; col++) {
      const d = num(r.get(rr, col));
      if (d !== null && Number.isInteger(d) && d >= 1 && d <= 31) cols.push({ col, day: d });
    }
    return cols;
  };
  for (let row = 1; row <= r.rows; row++) {
    let empCol = -1;
    for (let col = 1; col <= Math.min(r.cols, 6); col++) {
      const t = text(r.get(row, col));
      if (t && /^emp\s*#$/i.test(t)) { empCol = col; break; }
    }
    if (empCol === -1) continue;
    const nameCol = empCol - 1; const noCol = empCol - 2;
    // Block title: nearest recognised text above the header (up to 8 rows), else the nearest text for the warning.
    let title = ''; let info: ReturnType<typeof roleFromBlockTitle> = null; let nearest = '';
    for (let up = row - 1; up >= Math.max(1, row - 8) && !info; up--) {
      for (let col = 1; col <= empCol; col++) {
        const t = text(r.get(up, col));
        if (!t) continue;
        if (!nearest) nearest = t;
        const cand = roleFromBlockTitle(t);
        if (cand) { title = t; info = cand; }
        break;
      }
    }
    if (!info) { warnings.push(`${sheetName} row ${row}: block title "${nearest}" not recognised; block skipped`); continue; }
    // Day numbers: on the header row, or on the first of the next three rows that carries them.
    let dayRow = row; let dayCols = dayColsOn(row).filter((c) => c.col > empCol);
    for (let rr = row + 1; rr <= row + 3 && dayCols.length < 28; rr++) {
      const cols = dayColsOn(rr).filter((c) => c.col > empCol);
      if (cols.length >= 28) { dayRow = rr; dayCols = cols; }
    }
    if (dayCols.length < 28) { warnings.push(`${sheetName} row ${row}: no day-number row found under block "${title}"; block skipped`); continue; }
    // rows until TOTAL
    let groupIndex = 0; let blank = 0;
    for (let rr = dayRow + 1; rr <= dayRow + 60 && rr <= r.rows; rr++) {
      const no = text(r.get(rr, noCol));
      if (no && /^total/i.test(no)) break;
      const emp = normalizeEmployeeNumber(r.get(rr, empCol));
      const name = text(r.get(rr, nameCol));
      if (!emp && !name) { blank++; if (blank === 1 && info.role === 'panel_operator') groupIndex++; continue; }
      blank = 0;
      if (!emp || !name) { warnings.push(`${sheetName} row ${rr}: employee row missing ${emp ? 'name' : 'employee number'}`); continue; }
      const crew = info.crew ?? (info.role === 'panel_operator' && groupIndex < 4 ? (['A', 'B', 'C', 'D'][groupIndex] as CrewCode) : null);
      people.push({ employeeNumber: emp, shortName: name, role: info.role, crew, sourceRef: `${workbookName} / ${sheetName} / ${r.ref(rr, empCol)}` });
      let runStart: string | null = null; let prev: string | null = null; let startRef = '';
      const flush = () => { if (runStart && prev) runs.push({ employeeNumber: emp, shortName: name, block: title, start: runStart, end: prev, sourceRef: `${workbookName} / ${sheetName} / ${startRef}` }); runStart = null; prev = null; };
      for (const { col, day } of dayCols) {
        const v = r.get(rr, col);
        const marked = v === 1 || v === '1';
        if (!marked && v !== null && v !== undefined && text(v)) warnings.push(`${sheetName} ${r.ref(rr, col)}: ${name} (${emp}) day ${day} holds "${String(text(v)).slice(0, 40)}" instead of 1; not treated as an absence`);
        const date = isoDate(year, month, day);
        if (!date) { if (marked) warnings.push(`${sheetName} ${r.ref(rr, col)}: day ${day} does not exist in month ${month}`); continue; }
        if (marked) { if (!runStart) { runStart = date; startRef = r.ref(rr, col); } prev = date; }
        else flush();
      }
      flush();
    }
    row = dayRow;
  }
  return { people, runs };
}

export function parseManpowerWorkbook(wb: XLSX.WorkBook, workbookName: string): ParsedManpowerWorkbook {
  const warnings: string[] = [];
  const year = detectYear(wb) ?? new Date().getFullYear();
  if (!detectYear(wb)) warnings.push(`Could not detect the plan year from the workbook; assuming ${year}.`);
  let pvPeople: ParsedPerson[] = []; let pvRanges: ParsedLeaveRange[] = [];
  const pvSheet = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'pv scheduled') ?? wb.SheetNames.find((n) => /^pv scheduled/i.test(n));
  if (pvSheet) { const res = parsePvSheet(wb, pvSheet, year, workbookName, warnings); pvPeople = res.people; pvRanges = res.ranges; }
  else warnings.push('No "PV Scheduled" sheet found; crews for Panel Operators and Controllers cannot be read.');
  const extra = wb.SheetNames.filter((n) => /^pv scheduled/i.test(n) && n !== pvSheet);
  if (extra.length) warnings.push(`Additional PV sheets ignored (identical layout, use "PV Scheduled" as the plan): ${extra.join(', ')}`);

  const gridPeople: ParsedPerson[] = []; const gridRuns: ParsedGridRun[] = []; const monthsParsed: string[] = [];
  for (const name of wb.SheetNames) {
    const month = monthIndexFromName(name);
    if (!month || name.trim().length > 5) continue; // Jan .. Sept; skip "SCHEDULE-2026" etc
    const res = parseMonthlyGridSheet(wb, name, year, month, workbookName, warnings);
    if (res.people.length) { monthsParsed.push(name); gridPeople.push(...res.people); gridRuns.push(...res.runs); }
  }
  return { kind: 'u12_manpower_workbook', year, pvPeople, gridPeople, pvRanges, gridRuns, monthsParsed, warnings };
}
