// Which employees need an action from the Section Head / Manpower Coordinator, and which of those actions can be
// approved for many people at once. Pure logic, shared by the Employees screen and tests.

export type ActionCode = 'take_charge' | 'panel_qualification' | 'employment_type' | 'grade_missing' | 'controller_grade' | 'unresolved_absences';
export type BulkAction = 'take_charge' | 'panel_qualification' | 'employment_type';

export interface ActionRow {
  position_category: 'controller' | 'panel' | 'field' | 'other' | null;
  position_code: string | null;
  employment_type: 'knpc' | 'contractor';
  employment_type_source: 'inferred' | 'confirmed';
  grade: number | null;
  take_charge_status: string | null;
  panel_operator_status: string | null;
  acting_controller_status: string | null;
  unresolved_absences: number | string;
}

export interface ActionItem { code: ActionCode; label: string; bulk: BulkAction | null }

export const ACTION_LABEL: Record<ActionCode, string> = {
  take_charge: 'Take-Charge not confirmed',
  panel_qualification: 'Panel qualification not confirmed',
  employment_type: 'KNPC / Contractor not confirmed',
  grade_missing: 'Grade not recorded',
  controller_grade: 'Controller below Grade 15',
  unresolved_absences: 'Unresolved absence'
};

const unknown = (s: string | null) => s !== 'yes' && s !== 'no';

export function actionsFor(r: ActionRow): ActionItem[] {
  const out: ActionItem[] = [];
  if (r.position_category === 'field' && unknown(r.take_charge_status)) out.push({ code: 'take_charge', label: ACTION_LABEL.take_charge, bulk: 'take_charge' });
  if (r.position_category === 'panel' && unknown(r.panel_operator_status)) out.push({ code: 'panel_qualification', label: ACTION_LABEL.panel_qualification, bulk: 'panel_qualification' });
  if (r.employment_type_source !== 'confirmed') out.push({ code: 'employment_type', label: ACTION_LABEL.employment_type, bulk: 'employment_type' });
  if (r.employment_type === 'knpc' && r.grade == null) out.push({ code: 'grade_missing', label: ACTION_LABEL.grade_missing, bulk: null });
  if (r.position_code === 'controller' && r.grade != null && r.grade < 15 && r.acting_controller_status !== 'yes') out.push({ code: 'controller_grade', label: ACTION_LABEL.controller_grade, bulk: null });
  const n = Number(r.unresolved_absences) || 0;
  if (n > 0) out.push({ code: 'unresolved_absences', label: n === 1 ? '1 unresolved absence' : `${n} unresolved absences`, bulk: null });
  return out;
}

/** People among `rows` to whom a bulk action applies (others in a mixed selection are skipped, not changed). */
export function eligibleFor<T extends ActionRow>(rows: T[], action: BulkAction): T[] {
  return rows.filter((r) => action === 'take_charge' ? r.position_category === 'field'
    : action === 'panel_qualification' ? r.position_category === 'panel'
    : r.employment_type_source !== 'confirmed');
}
