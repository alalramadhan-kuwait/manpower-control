import * as XLSX from 'xlsx';

export type Cell = string | number | boolean | Date | null;

export interface SheetReader {
  name: string;
  rows: number; // 1-based count
  cols: number;
  get(r: number, c: number): Cell; // 1-based row and column
  ref(r: number, c: number): string;
}

export function openWorkbook(data: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  return XLSX.read(data, { type: data instanceof Uint8Array ? 'array' : 'array', cellDates: true });
}

export function readerFor(wb: XLSX.WorkBook, name: string): SheetReader {
  const ws = wb.Sheets[name];
  const range = ws && ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };
  return {
    name,
    rows: range.e.r + 1,
    cols: range.e.c + 1,
    get(r, c) {
      const cell = ws?.[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })];
      if (!cell || cell.v === undefined || cell.v === null) return null;
      if (cell.t === 'd' || cell.v instanceof Date) return cell.v as Date;
      return cell.v as Cell;
    },
    ref(r, c) {
      return XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
    }
  };
}

export function text(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function num(v: Cell): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function monthIndexFromName(name: string): number | null {
  const key = name.trim().toLowerCase().slice(0, 3);
  const i = MONTHS.indexOf(key);
  return i === -1 ? null : i + 1; // 1..12
}

export function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Excel dates arrive as Date (cellDates) or as serial numbers; normalise to ISO. */
export function dateOf(v: Cell): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // SheetJS builds dates in local time; take the calendar parts, not the UTC instant
    return isoDate(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number') {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? isoDate(p.y, p.m, p.d) : null;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const mi = monthIndexFromName(m[2]);
    return mi ? isoDate(Number(m[3]), mi, Number(m[1])) : null;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function normalizeEmployeeNumber(v: Cell): string | null {
  const s = text(v);
  if (!s) return null;
  const digits = s.replace(/\.0+$/, '').replace(/\s+/g, '');
  return /^\d+$/.test(digits) ? digits : null;
}
