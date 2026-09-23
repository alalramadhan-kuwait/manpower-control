// Hand-written row types for the Stage A schema (kept in step with supabase/migrations).

export type RoleCode = 'section_head' | 'manpower_coordinator' | 'controller' | 'employee';
export type QualificationCode = 'take_charge' | 'panel_operator' | 'acting_controller' | 'controller';
export type QualificationStatus = 'yes' | 'no' | 'not_yet_confirmed';

export interface UserProfile {
  id: string; auth_user_id: string; role_code: RoleCode; display_name: string; employee_id: string | null; is_active: boolean;
}

export interface EmployeeDirectoryRow {
  id: string; employee_number: string; official_name: string; display_name: string; short_name: string | null;
  employment_type: 'knpc' | 'contractor'; employment_type_source: 'inferred' | 'confirmed';
  in_unit12_scope: boolean; is_active: boolean; grade: number | null; master_position: string | null; cost_center: string | null;
  join_date: string | null; normalization_date: string | null; last_promotion_date: string | null; position_start_date: string | null;
  education: string | null; service_years: number | null; years_in_grade: number | null; notes: string | null;
  created_at: string; updated_at: string; section_code: string | null; section_name: string | null;
  role_assignment_id: string | null; role_effective_from: string | null;
  position_code: string | null; position_label: string | null; position_category: 'controller' | 'panel' | 'field' | 'other' | null;
  crew_code: 'A' | 'B' | 'C' | 'D' | null;
  take_charge_status: QualificationStatus | null; panel_operator_status: QualificationStatus | null;
  acting_controller_status: QualificationStatus | null; controller_status: QualificationStatus | null;
  unresolved_absences: number;
}

export interface Position { id: string; code: string; label: string; category: string; sort_order: number }
export interface Crew { id: string; code: 'A' | 'B' | 'C' | 'D'; name: string; sort_order: number }
export interface AbsenceType { code: string; label: string; short_code: string; reduces_manpower: boolean; requires_approval: boolean; is_active: boolean; sort_order: number }

export interface Qualification {
  id: string; employee_id: string; qualification: QualificationCode; status: QualificationStatus; effective_from: string; effective_to: string | null;
  source: 'manual' | 'import_inference'; evidence: string | null; created_at: string;
}

export interface RoleAssignment {
  id: string; employee_id: string; position_id: string; home_crew_id: string | null; effective_from: string; effective_to: string | null;
  source: string; source_ref: string | null; note: string | null; positions?: { code: string; label: string } | null; crews?: { code: string } | null;
}

export interface LeaveRecord {
  id: string; employee_id: string; absence_type_code: string | null; start_date: string; end_date: string;
  status: 'planned' | 'approved' | 'unresolved' | 'cancelled' | 'rescheduled'; source_kind: 'pv_schedule' | 'monthly_grid' | 'manual'; source_ref: string | null;
  source_batch_id: string | null; review_status: 'none' | 'pending_review' | 'resolved'; note: string | null; created_at: string;
  in_original_plan: boolean; in_current_plan: boolean; superseded_by: string | null; rescheduled_from: string | null;
}

export interface LeavePlanChange {
  id: string; employee_id: string; change_kind: 'added' | 'rescheduled' | 'cancelled' | 'source_data_changed' | 'baseline_added';
  original_record_id: string | null; current_record_id: string | null; from_start: string | null; from_end: string | null; to_start: string | null; to_end: string | null;
  evidence: string | null; note: string | null; source_batch_id: string | null; created_by: string | null; created_at: string;
}

export interface Performance { id: string; employee_id: string; year: number; perf_level: number | null; increment_pct: number | null; warnings: boolean | null; appreciation_letters: number | null; screening_eligibility: string | null; reported_as_of: string | null }
export interface SickTotal { id: string; employee_id: string; year: number; days: number; reported_as_of: string | null }

export interface ImportBatch {
  id: string; import_type: 'u12_manpower_workbook' | 'promotion_master' | 'contractors'; file_name: string; imported_by: string | null; imported_by_label: string | null;
  source_as_of_date: string | null; period_start: string | null; period_end: string | null;
  records_read: number; records_matched: number; records_changed: number; records_new: number; records_unmatched: number; records_ignored: number; records_error: number; records_review: number;
  errors: unknown[]; summary: Record<string, unknown>; status: 'previewed' | 'committed' | 'aborted'; created_at: string; committed_at: string | null;
}

export interface ImportRowRecord {
  id: string; batch_id: string; seq: number; sheet: string | null; row_ref: string | null; entity_kind: string; employee_number: string | null; matched_employee_id: string | null;
  outcome: string; needs_review: boolean; raw: Record<string, unknown> | null; payload: Record<string, unknown> | null; diff: Record<string, { from: unknown; to: unknown }> | null; message: string | null; applied: boolean;
}

export interface AuditEntry { id: string; actor_id: string | null; entity_table: string; entity_id: string | null; action: string; previous: Record<string, unknown> | null; next: Record<string, unknown> | null; reason: string | null; occurred_at: string }

export interface ControllerAssignment {
  id: string; kind: 'shift_cover' | 'morning_rotation'; employee_id: string; crew_code: 'A' | 'B' | 'C' | 'D' | null; covers_employee_id: string | null;
  start_date: string; end_date: string; status: 'active' | 'cancelled'; note: string | null;
  created_by: string | null; created_at: string; updated_at: string; cancelled_by: string | null; cancelled_at: string | null; cancel_reason: string | null;
}
