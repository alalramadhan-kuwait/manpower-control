// Staff lists read in operational order: most senior position first, then by name.
const ORDER = ['section_head', 'operating_engineer', 'controller', 'vr_controller', 'morning_controller', 'panel_operator', 'field_operator', 'trainee'];

/** Rank of a position code in that order; unknown or missing positions go last. */
export const positionRank = (code: string | null | undefined) => {
  const i = ORDER.indexOf(code ?? '');
  return i < 0 ? ORDER.length : i;
};

/** Sort people by position, then name. */
export const byPosition = (a: { position_code: string | null; display_name: string }, b: { position_code: string | null; display_name: string }) =>
  positionRank(a.position_code) - positionRank(b.position_code) || a.display_name.localeCompare(b.display_name);

/** Employee numbers are given in order, so a lower number is an older (longer-serving) employee; none go last. */
export const serviceNo = (n: string | null | undefined) => { const v = Number(n); return Number.isFinite(v) && v > 0 ? v : Number.MAX_SAFE_INTEGER; };

/** Sort people by position, then the longest-serving first (lowest employee number). */
export const byPositionAndService = (a: { position_code: string | null; employee_number: string | null }, b: { position_code: string | null; employee_number: string | null }) =>
  positionRank(a.position_code) - positionRank(b.position_code) || serviceNo(a.employee_number) - serviceNo(b.employee_number);

/** Within a crew: position first, then the most senior (highest grade; contractors and missing grades after), then the
 *  longest-serving (lowest employee number), then name. */
export const bySeniority = (a: { role: string | null; grade: number | null; name: string; employeeNumber?: string | null }, b: { role: string | null; grade: number | null; name: string; employeeNumber?: string | null }) =>
  positionRank(a.role) - positionRank(b.role) || (b.grade ?? -1) - (a.grade ?? -1) || serviceNo(a.employeeNumber) - serviceNo(b.employeeNumber) || a.name.localeCompare(b.name);

/** Position groups for lists split by a thin line: Controllers, Panel Operators, Field Operators, others. */
export const positionGroup = (code: string | null | undefined) =>
  ['controller', 'vr_controller', 'morning_controller', 'section_head', 'operating_engineer'].includes(code ?? '') ? 'Controllers'
    : code === 'panel_operator' ? 'Panel Operators' : code === 'field_operator' ? 'Field Operators' : 'Others';
