// The rolling 12-month sick-leave Excel file (employee name, Civil ID, total days): read, checked and matched to staff.
// The Civil ID is the matching key; it is never kept: only a one-way hash (and its last four digits) is stored, linked
// to the employee the first time the Section Head confirms a match by name. Pure; hashing is done by the caller.

export interface SickFileRow { line: number; name: string; civil: string; days: number | null }
export interface SickFileRead { rows: SickFileRow[]; columns: { name: number; civil: number; days: number } | null; problems: string[] }

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
/** Finds the header (a row naming the name, Civil ID and days columns) and reads the rows under it. */
export function readSickSheet(matrix: unknown[][]): SickFileRead {
  for (let h = 0; h < Math.min(matrix.length, 15); h++) {
    const cells = (matrix[h] ?? []).map(norm);
    const civil = cells.findIndex((c) => c.includes('civil'));
    const name = cells.findIndex((c, i) => i !== civil && c.includes('name'));
    const days = cells.findIndex((c, i) => i !== civil && i !== name && (c.includes('sick') || c.includes('days') || c.includes('total')));
    if (civil < 0 || name < 0 || days < 0) continue;
    const rows: SickFileRow[] = [];
    for (let i = h + 1; i < matrix.length; i++) {
      const r = matrix[i] ?? [];
      const nm = String(r[name] ?? '').trim(), cv = String(r[civil] ?? '').replace(/\D/g, ''), dv = r[days];
      if (!nm && !cv && (dv === undefined || dv === null || dv === '')) continue;
      const n = typeof dv === 'number' ? dv : Number(String(dv ?? '').trim());
      rows.push({ line: i + 1, name: nm, civil: cv, days: Number.isFinite(n) && String(dv ?? '').trim() !== '' ? n : null });
    }
    return { rows, columns: { name, civil, days }, problems: [] };
  }
  return { rows: [], columns: null, problems: ['No header row with a name, a Civil ID and a sick-days column was found in the first 15 rows.'] };
}

export interface StaffName { id: string; names: string[] }
export type MatchKind = 'civil' | 'name' | 'name_partial' | 'none';
export interface SickMatch {
  row: SickFileRow; hash: string; last4: string;
  employeeId: string | null; kind: MatchKind;
  /** Why the row cannot be imported (blocking), or null. */
  error: string | null;
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z؀-ۿ ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
/** Rows matched by Civil ID hash first, else by name (exact, then all the file's words in one staff name). */
export function matchSickRows(rows: SickFileRow[], hashes: string[], links: Map<string, string>, staff: StaffName[]): SickMatch[] {
  const count = new Map<string, number>(); for (const r of rows) if (r.civil) count.set(r.civil, (count.get(r.civil) ?? 0) + 1);
  const exact = (n: string) => staff.filter((s) => s.names.some((x) => words(x).join(' ') === words(n).join(' ')));
  const partial = (n: string) => { const w = words(n); return w.length < 2 ? [] : staff.filter((s) => s.names.some((x) => { const xs = new Set(words(x)); return w.every((y) => xs.has(y)); })); };
  return rows.map((row, i) => {
    const hash = hashes[i]; const last4 = row.civil.slice(-4);
    const base = { row, hash, last4 };
    if (!row.civil) return { ...base, employeeId: null, kind: 'none' as const, error: 'No Civil ID' };
    if (row.civil.length !== 12) return { ...base, employeeId: null, kind: 'none' as const, error: `Civil ID has ${row.civil.length} digits (12 expected)` };
    if ((count.get(row.civil) ?? 0) > 1) return { ...base, employeeId: null, kind: 'none' as const, error: 'Civil ID appears twice in the file' };
    if (row.days === null || row.days < 0 || !Number.isInteger(row.days)) return { ...base, employeeId: null, kind: 'none' as const, error: 'Sick days missing or not a whole number' };
    const linked = links.get(hash);
    if (linked) return { ...base, employeeId: linked, kind: 'civil' as const, error: null };
    const e = exact(row.name);
    if (e.length === 1) return { ...base, employeeId: e[0].id, kind: 'name' as const, error: null };
    const p = partial(row.name);
    if (p.length === 1) return { ...base, employeeId: p[0].id, kind: 'name_partial' as const, error: null };
    return { ...base, employeeId: null, kind: 'none' as const, error: e.length + p.length > 1 ? 'Name matches several staff' : null };
  });
}
