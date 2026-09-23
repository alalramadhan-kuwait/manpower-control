// Initial load helper: parse the two workbooks and emit SQL that stages an import batch and commits it
// through commit_import_batch(), acting as a named staff user. Output goes to files; nothing runs here.
// usage: npx tsx scripts/stage-import-sql.ts <actor-auth-uid> <out-dir> data/manpower.xlsx data/promotion.xlsx
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseWorkbook, planManpowerImport, planPromotionImport } from '../src/core/import';
import type { ExistingEmployee, ImportPlan, StagedRow } from '../src/core/import';

const [actor, outDir, manpowerPath, promotionPath] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const open = (p: string) => XLSX.read(readFileSync(p), { type: 'buffer', cellDates: true });
const lit = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;
const jsonLit = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;

function batchSql(plan: ImportPlan, batchId: string, label: string): string[] {
  const s = plan.summary;
  const head = `select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: actor, role: 'authenticated' }))}, false);
select set_config('request.jwt.claim.sub', ${lit(actor)}, false);
select set_config('role', 'authenticated', false);`;
  const insertBatch = `insert into public.import_batches (id, import_type, file_name, imported_by, imported_by_label, source_as_of_date, period_start, period_end, records_read, records_new, records_changed, records_matched, records_unmatched, records_ignored, records_error, records_review, errors, summary, status)
values (${lit(batchId)}, ${lit(plan.importType)}, ${lit(plan.fileName)}, ${lit(actor)}, ${lit(label)}, ${plan.sourceAsOfDate ? lit(plan.sourceAsOfDate) : 'null'}, ${plan.periodStart ? lit(plan.periodStart) : 'null'}, ${plan.periodEnd ? lit(plan.periodEnd) : 'null'},
 ${s.read}, ${s.employeesNew}, ${s.employeesChanged}, ${s.employeesChanged + s.employeesUnchanged}, ${s.unmatched}, ${s.ignored}, ${s.errors}, ${s.review}, ${jsonLit(plan.warnings)}, ${jsonLit({ preview: s })}, 'previewed');`;
  const chunks: string[] = [`${head}\n${insertBatch}`];
  const size = 80;
  const compactPayload = (r: StagedRow): unknown => {
    const p = r.payload as Record<string, unknown> | null; if (!p) return null;
    if (r.entity_kind === 'leave_record') return [p.absence_type_code ?? null, p.status, p.start_date, p.end_date, p.source_kind, p.source_ref, p.review_status ?? 'none', p.note ?? null];
    if (r.entity_kind === 'qualification') return [p.qualification, p.status, p.source, p.evidence, p.effective_from];
    if (r.entity_kind === 'role_assignment') return [p.position_code, p.crew_code ?? null, p.effective_from, p.source_ref];
    return p;
  };
  for (let i = 0; i < plan.rows.length; i += size) {
    const slice: StagedRow[] = plan.rows.slice(i, i + size);
    const arr = slice.map((r) => [r.seq, r.sheet, r.row_ref, r.entity_kind, r.employee_number, r.matched_employee_id, r.outcome, r.needs_review ? 1 : 0, r.message,
      compactPayload(r), r.entity_kind === 'employee' && r.diff ? Object.fromEntries(Object.entries(r.diff).filter(([, v]) => v.from !== null && v.from !== undefined)) : null,
      r.outcome === 'error' || r.needs_review ? r.raw : null]);
    chunks.push(`${head}
insert into public.import_rows (batch_id, seq, sheet, row_ref, entity_kind, employee_number, matched_employee_id, outcome, needs_review, message, payload, diff, raw)
select ${lit(batchId)}, (a->>0)::int, a->>1, a->>2, a->>3, a->>4, (a->>5)::uuid, a->>6, (a->>7)::int = 1, a->>8,
  case when jsonb_typeof(a->9) = 'array' and a->>3 = 'leave_record' then jsonb_strip_nulls(jsonb_build_object('absence_type_code', a->9->>0, 'status', a->9->>1, 'start_date', a->9->>2, 'end_date', a->9->>3, 'source_kind', a->9->>4, 'source_ref', a->9->>5, 'review_status', a->9->>6, 'note', a->9->>7)) || case when a->9->0 = 'null'::jsonb then '{"absence_type_code":null}'::jsonb else '{}'::jsonb end
       when jsonb_typeof(a->9) = 'array' and a->>3 = 'qualification' then jsonb_build_object('qualification', a->9->>0, 'status', a->9->>1, 'source', a->9->>2, 'evidence', a->9->>3, 'effective_from', a->9->>4)
       when jsonb_typeof(a->9) = 'array' and a->>3 = 'role_assignment' then jsonb_build_object('position_code', a->9->>0, 'crew_code', a->9->>1, 'effective_from', a->9->>2, 'source_ref', a->9->>3)
       when jsonb_typeof(a->9) = 'null' then null else a->9 end,
  case when jsonb_typeof(a->10) = 'null' then null else a->10 end,
  case when jsonb_typeof(a->11) = 'null' then null else a->11 end
from jsonb_array_elements(${jsonLit(arr)}) as a;`);
  }
  chunks.push(`${head}\nselect public.commit_import_batch(${lit(batchId)});`);
  return chunks;
}

// 1) manpower workbook against an empty database
const wb = open(manpowerPath);
const parsed = parseWorkbook(wb, manpowerPath.split('/').pop()!);
if (parsed.kind !== 'u12_manpower_workbook') throw new Error('manpower workbook expected');
const plan1 = planManpowerImport(parsed, [], [], 'ARDs U-12 Manpower 2026.xlsx');
const batch1 = '11111111-0000-4000-8000-000000000001';
batchSql(plan1, batch1, 'Initial load — Stage A (staged from workbook by Claude Code, committed via commit_import_batch)').forEach((sql, i) => writeFileSync(`${outDir}/01-manpower-${String(i).padStart(2, '0')}.sql`, sql));

// 2) promotion master against the employees plan1 creates. The commit assigns real ids, so the planner
//    matches by employee number and the SQL resolves ids at commit time (matched_employee_id filled by a sub-select).
const existing: ExistingEmployee[] = plan1.rows.filter((r) => r.entity_kind === 'employee' && r.outcome === 'new').map((r) => ({
  id: `__EMP__${r.employee_number}`, employee_number: r.employee_number!, official_name: String(r.payload!.official_name), display_name: String(r.payload!.short_name), short_name: String(r.payload!.short_name),
  employment_type: r.payload!.employment_type as 'knpc' | 'contractor', employment_type_source: 'inferred', in_unit12_scope: true,
  grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null,
  education: null, service_years: null, years_in_grade: null, current_role: null, qualifications: {}
}));
const pwb = open(promotionPath);
const pparsed = parseWorkbook(pwb, promotionPath.split('/').pop()!);
if (pparsed.kind !== 'promotion_master') throw new Error('promotion master expected');
const plan2 = planPromotionImport(pparsed, existing, 'Promotion October 2026.xlsm.xlsx');
// placeholders → resolve by employee number in SQL
for (const r of plan2.rows) if (r.matched_employee_id?.startsWith('__EMP__')) r.matched_employee_id = null;
const batch2 = '11111111-0000-4000-8000-000000000002';
const sql2 = batchSql(plan2, batch2, 'Initial load — Stage A (promotion master as of 01-OCT-2026)');
// the commit for employee 'changed' rows needs matched_employee_id → fill from employees before committing
sql2.splice(sql2.length - 1, 0, `update public.import_rows r set matched_employee_id = e.id from public.employees e where r.batch_id = ${lit(batch2)} and r.matched_employee_id is null and r.employee_number = e.employee_number and r.outcome <> 'ignored_out_of_scope';`);
sql2.forEach((sql, i) => writeFileSync(`${outDir}/02-promotion-${String(i).padStart(2, '0')}.sql`, sql));
console.log(JSON.stringify({ plan1: plan1.summary, plan2: plan2.summary, files1: plan1.rows.length, files2: plan2.rows.length }, null, 1));
