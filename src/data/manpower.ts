// Data access for the manpower engine: maps Supabase rows to the engine's input types.
import { supabase } from './supabase';
import type { MpAbsence, MpPerson, Role } from '@/core/manpower';
import type { Crew } from '@/core/roster';
import type { EmployeeDirectoryRow } from './types';

const ROLES: Role[] = ['controller', 'vr_controller', 'morning_controller', 'panel_operator', 'field_operator'];

export function toMpPerson(r: EmployeeDirectoryRow): MpPerson {
  return {
    id: r.id, employeeNumber: r.employee_number, name: r.display_name, grade: r.grade,
    role: ROLES.includes(r.position_code as Role) ? (r.position_code as Role) : null,
    crew: (r.crew_code as Crew | null) ?? null,
    employmentType: r.employment_type,
    takeCharge: r.take_charge_status, panelQualified: r.panel_operator_status, actingController: r.acting_controller_status
  };
}

interface LeaveRow { id: string; employee_id: string; start_date: string; end_date: string; status: string; absence_type_code: string | null; source_ref: string | null; in_current_plan: boolean; absence_types: { label: string; short_code: string | null } | null }

export function toMpAbsence(l: LeaveRow): MpAbsence {
  return {
    id: l.id, employeeId: l.employee_id, start: l.start_date, end: l.end_date, status: l.status, typeCode: l.absence_type_code,
    typeLabel: l.absence_types?.label ?? (l.status === 'unresolved' ? 'Unresolved absence' : null), typeShort: l.absence_types?.short_code ?? null, sourceRef: l.source_ref, inCurrentPlan: l.in_current_plan
  };
}

/** Active Section-1 people plus every current-plan absence overlapping [from, to]. */
export async function fetchManpowerInputs(from: string, to: string): Promise<{ people: MpPerson[]; absences: MpAbsence[] }> {
  const [dir, lv] = await Promise.all([
    supabase.from('employee_directory_v').select('*').eq('in_unit12_scope', true).eq('is_active', true),
    supabase.from('leave_records')
      .select('id,employee_id,start_date,end_date,status,absence_type_code,source_ref,in_current_plan,absence_types(label,short_code)')
      .eq('in_current_plan', true).in('status', ['approved', 'planned', 'unresolved'])
      .lte('start_date', to).gte('end_date', from)
  ]);
  if (dir.error) throw dir.error;
  if (lv.error) throw lv.error;
  return { people: (dir.data as EmployeeDirectoryRow[]).map(toMpPerson), absences: (lv.data as unknown as LeaveRow[]).map(toMpAbsence) };
}
