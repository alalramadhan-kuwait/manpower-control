// Task releases: an employee released from the crew's duty for a time to handle a task. Staff read and write; audited; never deleted.
import { supabase } from './supabase';
import { dataChanged } from './changes';
import type { MpAbsence } from '@/core/manpower';
import { RELEASE_TYPE } from '@/core/release';

export interface TaskRelease {
  id: string; employee_id: string; start_date: string; end_date: string; from_time: string | null; to_time: string | null;
  task: string; status: 'active' | 'cancelled'; cancel_reason: string | null; created_at: string;
}

/** A release counts as the person being away for the day (the whole shift). */
export const releaseAbsence = (r: Pick<TaskRelease, 'id' | 'employee_id' | 'start_date' | 'end_date'>): MpAbsence =>
  ({ id: `release-${r.id}`, employeeId: r.employee_id, start: r.start_date, end: r.end_date, status: 'approved', typeCode: RELEASE_TYPE, typeLabel: 'Task release', typeShort: 'TASK', inCurrentPlan: true });

/** Active releases that end on or after `from` (soonest first). */
export async function fetchReleases(from: string): Promise<TaskRelease[]> {
  const { data, error } = await supabase.from('task_releases').select('*').eq('status', 'active').gte('end_date', from).order('start_date');
  if (error) throw error;
  return data as TaskRelease[];
}

export async function addRelease(v: { employeeId: string; start: string; end: string; fromTime: string | null; toTime: string | null; task: string }) {
  const { error } = await supabase.from('task_releases').insert({ employee_id: v.employeeId, start_date: v.start, end_date: v.end, from_time: v.fromTime, to_time: v.fromTime ? v.toTime : null, task: v.task.trim() });
  if (error) throw error;
  dataChanged();
}

export async function cancelRelease(id: string, reason: string) {
  const { error } = await supabase.from('task_releases').update({ status: 'cancelled', cancel_reason: reason.trim() }).eq('id', id);
  if (error) throw error;
  dataChanged();
}
