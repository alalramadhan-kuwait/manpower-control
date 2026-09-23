import type * as XLSX from 'xlsx';
import { dateOf, normalizeEmployeeNumber, num, readerFor, text } from './sheet';
import type { ParsedMasterRecord, ParsedPromotionMaster } from './types';

const EXPECTED_HEADERS = ['Sl No', 'Emp No', 'Name', 'Site', 'Cost Center', 'Grade', 'Position'];

export function parsePromotionMaster(wb: XLSX.WorkBook, workbookName: string): ParsedPromotionMaster {
  const warnings: string[] = [];
  const records: ParsedMasterRecord[] = [];
  let asOfDate: string | null = null;
  let division: string | null = null;

  for (const sheetName of wb.SheetNames) {
    const r = readerFor(wb, sheetName);
    let blockPosition: string | null = null;
    let headerSeen = false;
    for (let row = 1; row <= r.rows; row++) {
      const a = text(r.get(row, 1));
      const c = text(r.get(row, 3));
      if (!asOfDate && c && /promotion list as of/i.test(c)) {
        const m = c.match(/as of\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/i);
        asOfDate = m ? dateOf(m[1]) : null;
        continue;
      }
      if (a && /^division:/i.test(a)) { division = a.replace(/^division:\s*/i, '').trim(); continue; }
      if (a && /^position:/i.test(a)) { blockPosition = a.replace(/^position:\s*/i, '').trim() || null; continue; }
      if (a === 'Sl No') {
        headerSeen = true;
        for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
          const h = text(r.get(row, i + 1));
          if (h !== EXPECTED_HEADERS[i]) warnings.push(`${sheetName} row ${row}: expected header "${EXPECTED_HEADERS[i]}" in column ${i + 1}, found "${h ?? ''}"`);
        }
        continue;
      }
      const sl = num(r.get(row, 1));
      const emp = normalizeEmployeeNumber(r.get(row, 2));
      if (sl === null || !emp) continue;
      if (!headerSeen) warnings.push(`${sheetName} row ${row}: data row before any header`);
      const warn = text(r.get(row, 21));
      records.push({
        employeeNumber: emp,
        fullName: text(r.get(row, 3)) ?? '',
        site: text(r.get(row, 4)),
        costCenter: text(r.get(row, 5)),
        grade: num(r.get(row, 6)),
        position: text(r.get(row, 7)),
        blockPosition,
        normalizationDate: dateOf(r.get(row, 8)),
        joinDate: dateOf(r.get(row, 9)),
        lastPromotion: dateOf(r.get(row, 10)),
        positionStart: dateOf(r.get(row, 11)),
        education: text(r.get(row, 12)),
        serviceYears: num(r.get(row, 13)),
        yearsInGrade: num(r.get(row, 14)),
        sickCurYear: num(r.get(row, 15)),
        sickPrevYear: num(r.get(row, 16)),
        incrementCurYear: num(r.get(row, 17)),
        incrementPrevYear: num(r.get(row, 18)),
        perfCurYear: num(r.get(row, 19)),
        perfPrevYear: num(r.get(row, 20)),
        warnings: warn === null ? null : /^y/i.test(warn),
        appreciationLetters: num(r.get(row, 22)),
        eligibleForScreening: text(r.get(row, 23)),
        sourceRef: `${workbookName} / ${sheetName} / row ${row}`
      });
    }
  }
  if (!asOfDate) warnings.push('Could not read the "Promotion List as of" date; performance and sick years will be based on today.');
  return { kind: 'promotion_master', asOfDate, division, records, warnings };
}
