import type * as XLSX from 'xlsx';
import { detectImportType } from './detect';
import { parseManpowerWorkbook } from './parseManpowerWorkbook';
import { parsePromotionMaster } from './parsePromotionMaster';
import type { ParsedWorkbook } from './types';

export * from './types';
export { detectImportType } from './detect';
export { openWorkbook } from './sheet';
export { parseManpowerWorkbook } from './parseManpowerWorkbook';
export { parsePromotionMaster } from './parsePromotionMaster';
export { planManpowerImport, planPromotionImport, inferEmploymentType, summarize } from './plan';

export function parseWorkbook(wb: XLSX.WorkBook, workbookName: string): ParsedWorkbook {
  const det = detectImportType(wb);
  if (det.importType === 'promotion_master') return parsePromotionMaster(wb, workbookName);
  if (det.importType === 'u12_manpower_workbook') return parseManpowerWorkbook(wb, workbookName);
  throw new Error(`Workbook type not recognised: ${det.reason}`);
}
