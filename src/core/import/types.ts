// Pure types for the Excel import pipeline. No DOM, no Supabase.

export type ImportType = 'u12_manpower_workbook' | 'promotion_master';

export type RoleCode = 'controller' | 'vr_controller' | 'morning_controller' | 'panel_operator' | 'field_operator';
export type CrewCode = 'A' | 'B' | 'C' | 'D';

export interface ParsedPerson {
  employeeNumber: string;
  shortName: string;
  role: RoleCode;
  crew: CrewCode | null;
  sourceRef: string;
  /** Monthly sheets only: the month (YYYY-MM) this row was listed on. */
  month?: string;
}

export interface ParsedLeaveRange {
  employeeNumber: string;
  shortName: string;
  start: string; // ISO date
  end: string;   // ISO date, inclusive
  sourceRef: string;
}

export interface ParsedGridRun {
  employeeNumber: string;
  shortName: string;
  block: string;
  start: string;
  end: string;
  sourceRef: string;
  /** Fill colour key of each marked day (ISO date → key), for the absence type. */
  fills?: Record<string, string | null>;
}

/** Free text found in a day cell of a monthly sheet ("Rescheduled in Nov", "Covering D-shift"). Evidence only. */
export interface ParsedGridRemark {
  employeeNumber: string;
  shortName: string;
  sheet: string;
  cell: string;
  date: string | null;
  text: string;
}

export interface ParsedManpowerWorkbook {
  kind: 'u12_manpower_workbook';
  year: number;
  pvPeople: ParsedPerson[];
  gridPeople: ParsedPerson[];
  /** "PV Scheduled": the ORIGINAL annual leave plan (baseline, historical). */
  pvRanges: ParsedLeaveRange[];
  /** "PV Scheduled Updated": the CURRENT approved plan. Equal to pvRanges when the workbook has no updated sheet. */
  pvCurrentRanges: ParsedLeaveRange[];
  pvOriginalSheet: string | null;
  pvCurrentSheet: string | null;
  gridRuns: ParsedGridRun[];
  gridRemarks: ParsedGridRemark[];
  monthsParsed: string[];
  warnings: string[];
}

export interface ParsedMasterRecord {
  employeeNumber: string;
  fullName: string;
  site: string | null;
  costCenter: string | null;
  grade: number | null;
  position: string | null;
  blockPosition: string | null;
  normalizationDate: string | null;
  joinDate: string | null;
  lastPromotion: string | null;
  positionStart: string | null;
  education: string | null;
  serviceYears: number | null;
  yearsInGrade: number | null;
  sickCurYear: number | null;
  sickPrevYear: number | null;
  incrementCurYear: number | null;
  incrementPrevYear: number | null;
  perfCurYear: number | null;
  perfPrevYear: number | null;
  warnings: boolean | null;
  appreciationLetters: number | null;
  eligibleForScreening: string | null;
  sourceRef: string;
}

export interface ParsedPromotionMaster {
  kind: 'promotion_master';
  asOfDate: string | null;
  division: string | null;
  records: ParsedMasterRecord[];
  warnings: string[];
}

export type ParsedWorkbook = ParsedManpowerWorkbook | ParsedPromotionMaster;

// ---------------------------------------------------------------- existing DB state

export interface ExistingEmployee {
  id: string;
  employee_number: string;
  official_name: string;
  display_name: string | null;
  short_name: string | null;
  employment_type: 'knpc' | 'contractor';
  employment_type_source: 'inferred' | 'confirmed';
  in_unit12_scope: boolean;
  grade: number | null;
  master_position: string | null;
  cost_center: string | null;
  join_date: string | null;
  normalization_date: string | null;
  last_promotion_date: string | null;
  position_start_date: string | null;
  education: string | null;
  service_years: number | null;
  years_in_grade: number | null;
  /** source 'manual' = set by hand (profile correction); an import never replaces it. */
  current_role: { position_code: string; crew_code: CrewCode | null; source?: 'manual' | 'import' | null; effective_from?: string | null } | null;
  qualifications: Partial<Record<'take_charge' | 'panel_operator' | 'acting_controller' | 'controller', string>>;
}

export interface ExistingLeave {
  id?: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  source_kind: 'pv_schedule' | 'monthly_grid' | 'manual';
  status: string;
  absence_type_code?: string | null;
  review_status?: string;
  in_original_plan?: boolean;
  in_current_plan?: boolean;
}

// ---------------------------------------------------------------- staged rows

export type EntityKind = 'employee' | 'role_assignment' | 'qualification' | 'leave_record' | 'performance' | 'sick_total' | 'note';
export type Outcome = 'new' | 'changed' | 'unchanged' | 'unmatched' | 'ignored_out_of_scope' | 'review' | 'error';

export interface StagedRow {
  seq: number;
  sheet: string | null;
  row_ref: string | null;
  entity_kind: EntityKind;
  employee_number: string | null;
  matched_employee_id: string | null;
  outcome: Outcome;
  needs_review: boolean;
  raw: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  diff: Record<string, { from: unknown; to: unknown }> | null;
  message: string | null;
}

export interface PlanSummary {
  read: number;
  employeesNew: number;
  employeesChanged: number;
  employeesUnchanged: number;
  unmatched: number;
  ignored: number;
  review: number;
  errors: number;
  leaveNew: number;
  leaveChanged: number;
  leaveUnchanged: number;
  pvAdded: number;
  pvRescheduled: number;
  pvCancelled: number;
  /** Current leave not marked on the monthly sheets (kept in history, no longer counted). */
  pvNotTaken: number;
  unresolvedNew: number;
  qualificationsNew: number;
  roleAssignmentsNew: number;
}

export interface ImportPlan {
  importType: ImportType;
  fileName: string;
  sourceAsOfDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  rows: StagedRow[];
  summary: PlanSummary;
  warnings: string[];
}
