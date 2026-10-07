// Leave versions: a leave's dates are never edited; every change is a new version of the same leave (same root_id,
// version_no + 1), and the earlier versions stay as history.

export interface VersionRow {
  id: string; root_id: string; version_no: number; created_at: string; start_date: string; end_date: string;
  status: string; in_current_plan: boolean; origin: string; change_reason: string | null;
}

export const ORIGIN_LABEL: Record<string, string> = {
  import: 'Imported', manual: 'Entered by hand', request: 'By request', oracle_correction: 'Oracle correction', system: 'System'
};

/** Every leave with more than one version, each chain oldest first (pieces of one version side by side). */
export function leaveChains<T extends VersionRow>(rows: T[]): T[][] {
  const by = new Map<string, T[]>();
  for (const r of rows) by.set(r.root_id, [...(by.get(r.root_id) ?? []), r]);
  return [...by.values()].filter((c) => c.length > 1)
    .map((c) => [...c].sort((a, b) => a.version_no - b.version_no || a.created_at.localeCompare(b.created_at) || a.start_date.localeCompare(b.start_date)))
    .sort((a, b) => a[0].start_date.localeCompare(b[0].start_date));
}

/** What a version is now: in the plan, replaced by a later version, or cancelled. */
export function versionState(r: Pick<VersionRow, 'status' | 'in_current_plan'>): 'current' | 'replaced' | 'cancelled' {
  if (r.in_current_plan) return 'current';
  return r.status === 'cancelled' ? 'cancelled' : 'replaced';
}
