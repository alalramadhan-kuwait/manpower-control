// Local dry run: parse workbook(s) and print the import plan summary. Nothing is written anywhere.
// usage: npx tsx scripts/dry-run.ts data/manpower.xlsx [data/promotion.xlsx]
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { detectImportType, parseWorkbook, planManpowerImport, planPromotionImport } from '../src/core/import';
import type { ExistingEmployee, StagedRow } from '../src/core/import';

function open(path: string) { return XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true }); }

const [manpowerPath, promotionPath] = process.argv.slice(2);
const wb = open(manpowerPath);
console.log('detect:', detectImportType(wb));
const parsed = parseWorkbook(wb, manpowerPath.split('/').pop()!);
if (parsed.kind !== 'u12_manpower_workbook') throw new Error('expected manpower workbook');
console.log(`year=${parsed.year} pvPeople=${parsed.pvPeople.length} gridPeople=${parsed.gridPeople.length} pvRanges=${parsed.pvRanges.length} gridRuns=${parsed.gridRuns.length} months=${parsed.monthsParsed.join(',')}`);
console.log('warnings:', parsed.warnings.slice(0, 10));
const plan = planManpowerImport(parsed, [], [], manpowerPath);
console.log('manpower plan summary:', plan.summary, 'period', plan.periodStart, plan.periodEnd);
const by = (rows: StagedRow[], k: string) => rows.filter((r) => r.entity_kind === k);
console.log('review rows:'); for (const r of plan.rows.filter((r) => r.needs_review)) console.log('  ', r.outcome, r.message);
console.log('panel crews from grid+pv:', by(plan.rows, 'role_assignment').filter((r) => (r.payload as any)?.position_code === 'panel_operator').map((r) => `${r.employee_number}:${(r.payload as any).crew_code}`).join(' '));
if (promotionPath) {
  // simulate "existing" = employees created by the manpower plan
  const existing: ExistingEmployee[] = by(plan.rows, 'employee').map((r, i) => ({
    id: `emp-${i}`, employee_number: r.employee_number!, full_name: String((r.payload as any).full_name), short_name: String((r.payload as any).short_name),
    employment_type: (r.payload as any).employment_type, employment_type_source: 'inferred', in_unit12_scope: true, grade: null, master_position: null, cost_center: null,
    join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null, current_role: null, qualifications: {}
  }));
  const pwb = open(promotionPath);
  console.log('detect:', detectImportType(pwb));
  const pparsed = parseWorkbook(pwb, promotionPath.split('/').pop()!);
  if (pparsed.kind !== 'promotion_master') throw new Error('expected promotion master');
  console.log(`asOf=${pparsed.asOfDate} records=${pparsed.records.length} warnings=${pparsed.warnings.length}`, pparsed.warnings);
  const pplan = planPromotionImport(pparsed, existing, promotionPath);
  console.log('promotion plan summary:', pplan.summary);
  const sample = pplan.rows.find((r) => r.entity_kind === 'employee' && r.outcome === 'changed');
  console.log('sample changed row:', JSON.stringify(sample?.diff, null, 0).slice(0, 600));
  console.log('unmatched:', pplan.rows.filter((r) => r.outcome === 'unmatched').map((r) => r.message));
}
