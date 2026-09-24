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

/** Within a crew: position first, then the most senior (highest grade; contractors and missing grades after), then name. */
export const bySeniority = (a: { role: string | null; grade: number | null; name: string }, b: { role: string | null; grade: number | null; name: string }) =>
  positionRank(a.role) - positionRank(b.role) || (b.grade ?? -1) - (a.grade ?? -1) || a.name.localeCompare(b.name);
