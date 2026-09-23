import * as XLSX from 'xlsx';

/** Build a small synthetic U-12 manpower workbook (no real employee data). */
export function syntheticManpowerWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  // PV Scheduled: header layout like the real sheet (4 columns per month starting at E)
  const pv: (string | number | null)[][] = [];
  pv[2] = ['OPERATIONS, AREA-4 - ARDs / CONTROLLER, LEAVE SCHEDULE FOR THE YEAR 2026'];
  const hdr: (string | null)[] = ['S.N.', 'B. NO.', 'NAME', 'SHIFT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  for (const m of months) hdr.push(m, null, null, null);
  pv[3] = hdr;
  pv[4] = [1, 10001, 'Ctrl One', 'A', null, null, null, null, '2~~~23'];          // FEB 2 → FEB 23
  pv[5] = [2, 10002, 'Ctrl VR', 'VR', ...Array(16).fill(null), '26~~8']; // column U = MAY: 26 May → 8 Jun
  pv[7] = ['OPERATIONS, AREA-4 - ARDs / FIELD OPERATORS LEAVE SCHEDULE FOR THE YEAR 2026'];
  pv[8] = hdr;
  pv[9] = [1, 20001, 'Field One', 'A', '9~~14'];                 // JAN 9 → JAN 14 (A crew: M1..N2, then Off 15–16)
  pv[11] = [3, 20002, 'Field Two', 'A', '9~~12'];                // JAN 9 → JAN 12 (ends on A2, a working day)
  pv[10] = [2, 400001, 'Contractor One', 'A', null, null, null, null, null, null, null, null, ...Array(4 * 9).fill(null), '30~~~13']; // DEC 30 → JAN 13 next year
  const pvSheet = XLSX.utils.aoa_to_sheet(pv.map((r) => r ?? []));
  XLSX.utils.book_append_sheet(wb, pvSheet, 'PV Scheduled');

  // Jan grid: A SHIFT block with two people; Field One absent 5..20 (PV 5..18 + 2 off days) and 25..26 (not in PV)
  const jan: (string | number | null)[][] = [];
  jan[1] = [null, '"A" SHIFT'];
  jan[2] = [null, 'NO', 'NAME', 'EMP #', ...Array.from({ length: 31 }, (_, i) => i + 1)];
  // Field One absent 9..16 (PV 9–14 + roster Off 15–16) and 25..26 (M1, M2: not in PV)
  const row1: (string | number | null)[] = [null, 1, 'Field One', 20001];
  for (let d = 1; d <= 31; d++) row1.push((d >= 9 && d <= 16) || d === 25 || d === 26 ? 1 : null);
  jan[3] = row1;
  const row2: (string | number | null)[] = [null, 2, 'Contractor One', 400001];
  for (let d = 1; d <= 31; d++) row2.push(d === 31 ? 1 : null);
  jan[4] = row2;
  // Field Two absent 9..14: PV covers 9–12 only; 13–14 are N1/N2 working days → must NOT be absorbed as "end + 2"
  const row3: (string | number | null)[] = [null, 3, 'Field Two', 20002];
  for (let d = 1; d <= 31; d++) row3.push(d >= 9 && d <= 14 ? 1 : null);
  jan[5] = row3;
  jan[6] = [null, 'TOTAL'];
  jan[8] = [null, 'CONTROLER'];
  jan[9] = [null, 'NO', 'NAME', 'EMP #', ...Array.from({ length: 31 }, (_, i) => i + 1)];
  jan[10] = [null, 1, 'Ctrl One', 10001];
  jan[11] = [null, 'TOTAL AVILABLE'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(jan.map((r) => r ?? [])), 'Jan');
  // Feb grid: contractor absent 1..2 (continues Jan 31 run)
  const feb: (string | number | null)[][] = [];
  feb[1] = [null, '"A" SHIFT'];
  feb[2] = [null, 'NO', 'NAME', 'EMP #', ...Array.from({ length: 28 }, (_, i) => i + 1)];
  const frow: (string | number | null)[] = [null, 1, 'Contractor One', 400001];
  for (let d = 1; d <= 28; d++) frow.push(d <= 2 ? 1 : null);
  feb[3] = frow;
  feb[4] = [null, 'TOTAL'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(feb.map((r) => r ?? [])), 'Feb');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'SCHEDULE-2026');
  return wb;
}

export function syntheticPromotionWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const HDR = ['Sl No', 'Emp No', 'Name', 'Site', 'Cost Center', 'Grade', 'Position', 'Normalization Date', 'Join Date', 'Last Promotion', 'Pos Start', 'Education', 'Service Years', 'Years in Grade', 'Sick Cur Year', 'Sick Prev Year', 'Increment Cur Year', 'Increment Prev Year', 'Perf Level Cur Year', 'Perf Level Prev Year', 'Warnings', 'Appreciation Letters', 'Eligible for Screening'];
  const rows: (string | number | Date | null)[][] = [];
  rows[0] = [null, null, 'Operations Department Promotions System (MAB)'];
  rows[1] = [null, null, 'Promotion List as of 01-OCT-2026'];
  rows[3] = ['Division: 302080 / Operations Area - 4'];
  rows[4] = ['Position: Controller'];
  rows[5] = HDR;
  rows[6] = [1, 10001, 'CTRL ONE FULL NAME', 1, 71122, 16, 'Controller', new Date(2005, 10, 4), new Date(2004, 8, 25), new Date(2020, 3, 2), new Date(2019, 3, 2), '12 Yr. At School', 22, 7.5, 3, 0, 8.75, 8.75, 3.52, 3.71, 'No', 0, 'Yes'];
  rows[7] = [2, 30001, 'SOMEONE ELSEWHERE', 1, 71015, 16, 'Controller', new Date(2005, 10, 4), new Date(2004, 8, 25), null, null, null, 22, 1, 12, 3, 8.5, 8, 3.3, 3.16, 'No', 0, 'Yes'];
  rows[8] = [3, 10001, 'CTRL ONE DUPLICATE', 1, 71122, 16, 'Controller', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows.map((r) => r ?? [])), 'KNPC_Oper_Prom_01__Personnel_D_');
  return wb;
}
