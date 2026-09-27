// Data access for the manpower engine: maps Supabase rows to the engine's input types.
import { supabase } from './supabase';
import { SD_TEAM, type MpAbsence, type MpAssignment, type MpCrewMove, type MpPerson, type MpRolePeriod, type Role, type Rules } from '@/core/manpower';
import { fetchSdMembers } from './shutdown';
import { rulesByDate, type OperationPlan } from '@/core/modes';
import { fetchOperationPlan } from './modes';
import { toMpAssignment } from './controllers';
import type { Crew } from '@/core/roster';
import type { OracleStatus } from '@/core/oracle';
import type { ControllerAssignment, EmployeeDirectoryRow } from './types';

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

interface LeaveRow { id: string; employee_id: string; start_date: string; end_date: string; status: string; absence_type_code: string | null; source_ref: string | null; in_current_plan: boolean; oracle_status?: OracleStatus; absence_types: { label: string; short_code: string | null } | null }

export function toMpAbsence(l: LeaveRow): MpAbsence {
  return {
    id: l.id, employeeId: l.employee_id, start: l.start_date, end: l.end_date, status: l.status, typeCode: l.absence_type_code,
    typeLabel: l.absence_types?.label ?? (l.status === 'unresolved' ? 'Unresolved absence' : null), typeShort: l.absence_types?.short_code ?? null, sourceRef: l.source_ref, inCurrentPlan: l.in_current_plan, oracle: l.oracle_status
  };
}

interface RoleRow { employee_id: string; effective_from: string; effective_to: string | null; positions: { code: string } | null; crews: { code: string } | null }
interface MoveRow { employee_id: string; start_date: string; end_date: string | null; to_crew: Crew | 'DAY'; kind: 'temporary' | 'placement' }

/**
 * Active Section-1 people (with their dated role history and temporary shift covers, so each date uses the crew
 * the person was in that day), every current-plan absence and every active Controller assignment overlapping [from, to].
 */
export interface ManpowerInputs { people: MpPerson[]; absences: MpAbsence[]; assignments: MpAssignment[]; plan: OperationPlan; rules: (date: string) => Rules }

export async function fetchManpowerInputs(from: string, to: string): Promise<ManpowerInputs> {
  const [dir, lv, ca, ra, mv, op, sd] = await Promise.all([
    supabase.from('employee_directory_v').select('*').eq('in_unit12_scope', true).eq('is_active', true),
    supabase.from('leave_records')
      .select('id,employee_id,start_date,end_date,status,absence_type_code,source_ref,in_current_plan,oracle_status,absence_types(label,short_code)')
      .eq('in_current_plan', true).in('status', ['approved', 'planned', 'unresolved'])
      .lte('start_date', to).gte('end_date', from),
    supabase.from('controller_assignments').select('*').eq('status', 'active').lte('start_date', to).gte('end_date', from),
    supabase.from('employee_role_assignments').select('employee_id,effective_from,effective_to,positions(code),crews(code)').limit(5000),
    supabase.from('crew_movements').select('employee_id,start_date,end_date,to_crew,kind').eq('status', 'active').in('kind', ['temporary', 'placement']).lte('start_date', to).or(`end_date.is.null,end_date.gte.${from}`),
    fetchOperationPlan(from, to),
    fetchSdMembers(from, to)
  ]);
  const err = [dir, lv, ca, ra, mv].find((r) => r.error)?.error; if (err) throw err;
  const history = new Map<string, MpRolePeriod[]>();
  for (const r of ra.data as unknown as RoleRow[]) {
    const role = ROLES.includes(r.positions?.code as Role) ? (r.positions!.code as Role) : null;
    history.set(r.employee_id, [...(history.get(r.employee_id) ?? []), { from: r.effective_from, to: r.effective_to, role, crew: (r.crews?.code as Crew | undefined) ?? null }]);
  }
  const moves = new Map<string, MpCrewMove[]>();
  for (const m of mv.data as MoveRow[]) moves.set(m.employee_id, [...(moves.get(m.employee_id) ?? []), { start: m.start_date, end: m.end_date, crew: m.to_crew, kind: m.kind }]);
  // shutdown team members leave their crew for the team's dates: Controllers as an assignment (their crew needs a
  // cover, and they may still cover a normal shift), everyone else as a move out of the crew
  const roleOf = new Map((dir.data as EmployeeDirectoryRow[]).map((r) => [r.id, r.position_code]));
  const sdAssignments: MpAssignment[] = [];
  for (const m of sd) {
    if (['controller', 'vr_controller', 'morning_controller'].includes(roleOf.get(m.employeeId) ?? '')) sdAssignments.push({ id: `sd-${m.id}`, kind: 'sd_team', employeeId: m.employeeId, crew: null, start: m.start, end: m.end });
    else moves.set(m.employeeId, [...(moves.get(m.employeeId) ?? []), { start: m.start, end: m.end, crew: SD_TEAM, kind: 'sd' }]);
  }
  const people = (dir.data as EmployeeDirectoryRow[]).map((r) => ({ ...toMpPerson(r), history: history.get(r.id), moves: moves.get(r.id) }));
  return { people, absences: (lv.data as unknown as LeaveRow[]).map(toMpAbsence), assignments: [...(ca.data as ControllerAssignment[]).map(toMpAssignment), ...sdAssignments], plan: op.plan, rules: rulesByDate(op.plan) };
}
