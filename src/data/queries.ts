import { supabase } from './supabase';
import type { LeaveSpan } from '@/core/leave';
import { addDaysIso } from '@/core/roster';
import type { ExistingEmployee, ExistingLeave, ImportPlan } from '@/core/import';
import type { AbsenceType, Crew, EmployeeDirectoryRow, ImportBatch, ImportRowRecord, Position } from './types';

export async function fetchDirectory(): Promise<EmployeeDirectoryRow[]> {
  const { data, error } = await supabase.from('employee_directory_v').select('*').order('employee_number');
  if (error) throw error;
  return (data ?? []) as EmployeeDirectoryRow[];
}

/** Counted leave (approved or planned, current plan) around `date`, for the on-leave markers. */
export async function fetchLeaveSpans(date: string): Promise<LeaveSpan[]> {
  const { data, error } = await supabase.from('leave_records')
    .select('employee_id,start_date,end_date,status,in_current_plan,absence_types(label,short_code)')
    .eq('in_current_plan', true).in('status', ['approved', 'planned'])
    .lte('start_date', addDaysIso(date, 120)).gte('end_date', addDaysIso(date, -120));
  if (error) throw error;
  type R = { employee_id: string; start_date: string; end_date: string; status: string; in_current_plan: boolean; absence_types: { label: string; short_code: string | null } | null };
  return ((data ?? []) as unknown as R[]).map((l) => ({ employeeId: l.employee_id, start: l.start_date, end: l.end_date, status: l.status, inCurrentPlan: l.in_current_plan, typeLabel: l.absence_types?.label ?? null, typeShort: l.absence_types?.short_code ?? null }));
}

export async function fetchReference() {
  const [p, c, a] = await Promise.all([
    supabase.from('positions').select('*').order('sort_order'),
    supabase.from('crews').select('*').order('sort_order'),
    supabase.from('absence_types').select('*').order('sort_order')
  ]);
  if (p.error) throw p.error; if (c.error) throw c.error; if (a.error) throw a.error;
  return { positions: p.data as Position[], crews: c.data as Crew[], absenceTypes: a.data as AbsenceType[] };
}

/** Existing state the planner compares a workbook against. */
export async function fetchExistingForPlanning(year: number): Promise<{ employees: ExistingEmployee[]; leaves: ExistingLeave[] }> {
  const rows = await fetchDirectory();
  const employees: ExistingEmployee[] = rows.map((r) => ({
    id: r.id, employee_number: r.employee_number, official_name: r.official_name, display_name: r.display_name, short_name: r.short_name,
    employment_type: r.employment_type, employment_type_source: r.employment_type_source, in_unit12_scope: r.in_unit12_scope,
    grade: r.grade, master_position: r.master_position, cost_center: r.cost_center, join_date: r.join_date,
    normalization_date: r.normalization_date, last_promotion_date: r.last_promotion_date, position_start_date: r.position_start_date,
    education: r.education, service_years: r.service_years, years_in_grade: r.years_in_grade,
    current_role: r.position_code ? { position_code: r.position_code, crew_code: r.crew_code, source: r.role_source, effective_from: r.role_effective_from } : null,
    qualifications: {
      ...(r.take_charge_status ? { take_charge: r.take_charge_status } : {}),
      ...(r.panel_operator_status ? { panel_operator: r.panel_operator_status } : {}),
      ...(r.acting_controller_status ? { acting_controller: r.acting_controller_status } : {}),
      ...(r.controller_status ? { controller: r.controller_status } : {})
    }
  }));
  const { data, error } = await supabase.from('leave_records').select('id,employee_id,start_date,end_date,source_kind,status,absence_type_code,review_status,in_original_plan,in_current_plan,hand_corrected')
    .gte('end_date', `${year - 1}-12-01`).lte('start_date', `${year + 1}-01-31`);
  if (error) throw error;
  return { employees, leaves: (data ?? []) as ExistingLeave[] };
}

/** Stage a plan as a batch + rows, then commit it server-side in one transaction. */
export async function commitPlan(plan: ImportPlan, actor: { id: string; label: string }): Promise<{ batchId: string; counts: Record<string, number> }> {
  const s = plan.summary;
  const { data: batch, error } = await supabase.from('import_batches').insert({
    import_type: plan.importType, file_name: plan.fileName, imported_by: actor.id, imported_by_label: actor.label,
    source_as_of_date: plan.sourceAsOfDate, period_start: plan.periodStart, period_end: plan.periodEnd,
    records_read: s.read, records_new: s.employeesNew, records_changed: s.employeesChanged,
    records_matched: s.employeesChanged + s.employeesUnchanged, records_unmatched: s.unmatched, records_ignored: s.ignored,
    records_error: s.errors, records_review: s.review, errors: plan.warnings, summary: { preview: s }, status: 'previewed'
  }).select('id').single();
  if (error) throw error;
  const batchId = batch.id as string;
  const chunk = 150;
  for (let i = 0; i < plan.rows.length; i += chunk) {
    const rows = plan.rows.slice(i, i + chunk).map((r) => ({ ...r, batch_id: batchId }));
    const { error: e2 } = await supabase.from('import_rows').insert(rows);
    if (e2) { await supabase.from('import_batches').update({ status: 'aborted', errors: [...plan.warnings, e2.message] }).eq('id', batchId); throw e2; }
  }
  const { data: counts, error: e3 } = await supabase.rpc('commit_import_batch', { p_batch_id: batchId });
  if (e3) { await supabase.from('import_batches').update({ status: 'aborted', errors: [...plan.warnings, e3.message] }).eq('id', batchId); throw e3; }
  return { batchId, counts: counts as Record<string, number> };
}

export async function fetchBatches(): Promise<ImportBatch[]> {
  const { data, error } = await supabase.from('import_batches').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ImportBatch[];
}

export async function fetchBatch(id: string): Promise<{ batch: ImportBatch; rows: ImportRowRecord[] }> {
  const [b, r] = await Promise.all([
    supabase.from('import_batches').select('*').eq('id', id).single(),
    supabase.from('import_rows').select('*').eq('batch_id', id).order('seq')
  ]);
  if (b.error) throw b.error; if (r.error) throw r.error;
  return { batch: b.data as ImportBatch, rows: (r.data ?? []) as ImportRowRecord[] };
}
