import type * as XLSX from 'xlsx';
import { readerFor, text } from './sheet';
import type { ImportType } from './types';

export interface Detection {
  importType: ImportType | null;
  reason: string;
}

/** Decide which import type a workbook is, from sheet names and title cells only. */
export function detectImportType(wb: XLSX.WorkBook): Detection {
  for (const name of wb.SheetNames) {
    const r = readerFor(wb, name);
    for (let row = 1; row <= Math.min(r.rows, 6); row++) {
      for (let col = 1; col <= Math.min(r.cols, 8); col++) {
        const t = text(r.get(row, col));
        if (t && /promotion list as of/i.test(t)) {
          return { importType: 'promotion_master', reason: `Sheet "${name}" ${r.ref(row, col)}: "${t}"` };
        }
      }
    }
  }
  const hasPv = wb.SheetNames.some((n) => /^pv scheduled/i.test(n.trim()));
  let gridSheets = 0;
  for (const name of wb.SheetNames) {
    const r = readerFor(wb, name);
    for (let row = 1; row <= Math.min(r.rows, 6); row++) {
      for (let col = 1; col <= Math.min(r.cols, 6); col++) {
        const t = text(r.get(row, col));
        if (t && /^emp\s*#$/i.test(t)) { gridSheets++; row = 99; break; }
      }
    }
  }
  if (hasPv || gridSheets >= 3) {
    return { importType: 'u12_manpower_workbook', reason: `PV sheet: ${hasPv ? 'yes' : 'no'}; monthly grid sheets: ${gridSheets}` };
  }
  return { importType: null, reason: 'No known title or structure found' };
}
