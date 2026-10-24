// What a login may open in the app: the three levels (Section Head, Engineer / Assistant Section Head, Controller)
// plus task assignments. The database enforces the same (app_is_staff, trk_can_update); this only shapes the screens.
export type AppAccess = 'full' | 'tracker' | 'none';
/** full: manpower, leave, requests, shutdown teams and the tracker · tracker: the shutdown tracker only · none. */
export function appAccess(role: string | null | undefined, tasks: readonly string[] = []): AppAccess {
  if (role === 'section_head' || role === 'manpower_coordinator' || role === 'engineer') return 'full';
  if (role === 'controller') return tasks.includes('manpower') ? 'full' : 'tracker';
  return 'none';
}
export const TASK_LABEL: Record<string, string> = { manpower: 'Manpower' };
