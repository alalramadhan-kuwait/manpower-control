// Reads an Oracle absence-statistics sheet (exported report, Excel or CSV). Two layouts are understood:
// - long: one row per person and code — columns Employee Number, Code, Days (Occurrences optional);
// - wide: one row per person — Employee Number and one column per Oracle code (SK, AB, PE …) holding the days.
// Nothing is guessed: rows without a number, a code or a valid day count are reported, never imported.
export type RawCell = string | number | boolean | Date | null | undefined;
export interface ParsedStat { row: number; employeeNumber: string; code: string; days: number; occurrences: number | null }
export interface ParseResult { layout: 'long' | 'wide' | null; values: ParsedStat[]; problems: { row: number; message: string }[]; codes: string[] }

const norm = (v: RawCell) => String(v ?? '').trim();
const num = (v: RawCell) => { const s = norm(v).replace(',', '.'); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
const isNumberHeader = (h: string) => /employee\s*(no|num|number|#)|emp\.?\s*(no|number)|person\s*number|staff\s*(no|number)/i.test(h);
const CODE = /^[A-Z][A-Z0-9]{1,5}$/;

export function parseOracleStats(rows: RawCell[][]): ParseResult {
  const problems: ParseResult['problems'] = [];
  for (let h = 0; h < Math.min(rows.length, 15); h++) {
    const head = rows[h].map(norm);
    const numCol = head.findIndex(isNumberHeader);
    if (numCol < 0) continue;
    const codeCol = head.findIndex((x) => /^(absence\s*)?code$|^type$/i.test(x));
    const daysCol = head.findIndex((x) => /^(days|total\s*days|no\.?\s*of\s*days|duration)$/i.test(x));
    const occCol = head.findIndex((x) => /occurrence|times|count/i.test(x));
    const values: ParsedStat[] = [];
    if (codeCol >= 0 && daysCol >= 0) {
      for (let r = h + 1; r < rows.length; r++) {
        const row = rows[r]; const n = norm(row[numCol]); const code = norm(row[codeCol]).toUpperCase(); const d = num(row[daysCol]);
        if (!n && !code && d === null) continue;
        if (!n) { problems.push({ row: r + 1, message: 'No employee number.' }); continue; }
        if (!CODE.test(code)) { problems.push({ row: r + 1, message: `Code "${code}" is not an Oracle code.` }); continue; }
        if (d === null || Number.isNaN(d) || d < 0) { problems.push({ row: r + 1, message: 'Days missing or not a number.' }); continue; }
        const o = occCol >= 0 ? num(row[occCol]) : null;
        values.push({ row: r + 1, employeeNumber: n, code, days: d, occurrences: o === null || Number.isNaN(o) ? null : Math.round(o) });
      }
      return { layout: 'long', values, problems, codes: [...new Set(values.map((v) => v.code))].sort() };
    }
    // a code column header is the two-letter Oracle code itself (SK, AB, PE …), written in capitals; other columns (Name …) are ignored
    const codeCols = head.map((x, i) => ({ code: x, i })).filter((x) => x.i !== numCol && /^[A-Z]{2}$/.test(x.code));
    if (codeCols.length) {
      for (let r = h + 1; r < rows.length; r++) {
        const row = rows[r]; const n = norm(row[numCol]);
        if (!n) { if (row.some((c) => norm(c))) problems.push({ row: r + 1, message: 'No employee number.' }); continue; }
        for (const c of codeCols) {
          const d = num(row[c.i]);
          if (d === null) continue;   // blank in a covered column: counted as 0 by the report's coverage, not stored
          if (Number.isNaN(d) || d < 0) { problems.push({ row: r + 1, message: `${c.code}: not a number.` }); continue; }
          values.push({ row: r + 1, employeeNumber: n, code: c.code, days: d, occurrences: null });
        }
      }
      return { layout: 'wide', values, problems, codes: codeCols.map((c) => c.code).sort() };
    }
  }
  return { layout: null, values: [], problems: [{ row: 0, message: 'No header with an Employee Number column and either Code + Days or one column per Oracle code.' }], codes: [] };
}
