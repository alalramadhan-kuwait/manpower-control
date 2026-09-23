import { supabase } from './supabase';
import type { MpAssignment } from '@/core/manpower';
import type { ControllerAssignment } from './types';

export const toMpAssignment = (a: ControllerAssignment): MpAssignment =>
  ({ id: a.id, kind: a.kind, employeeId: a.employee_id, crew: a.crew_code, start: a.start_date, end: a.end_date, coversEmployeeId: a.covers_employee_id });

/** The database enforces the Controller Management rules; turn its refusals into plain sentences. */
function friendly(error: { message: string; code?: string }): Error {
  const m = error.message;
  if (m.includes('ca_one_at_a_time')) return new Error('This Controller already has an assignment on some of these dates. One person cannot cover two shifts at the same time.');
  if (m.includes('ca_one_cover_per_crew')) return new Error('This crew already has a cover recorded on some of these dates.');
  if (m.includes('ca_one_morning_rotation')) return new Error('Another Morning rotation already covers some of these dates.');
  if (m.includes('ca_max_two_months')) return new Error('An assignment can last at most 2 months.');
  if (m.includes('ca_dates')) return new Error('The end date is before the start date.');
  return new Error(m);
}

export async function fetchAssignments(): Promise<ControllerAssignment[]> {
  const { data, error } = await supabase.from('controller_assignments').select('*').order('start_date', { ascending: false });
  if (error) throw error;
  return data as ControllerAssignment[];
}

export async function createAssignment(a: { kind: ControllerAssignment['kind']; employee_id: string; crew_code: string | null; covers_employee_id: string | null; start_date: string; end_date: string; note: string | null }) {
  const { error } = await supabase.from('controller_assignments').insert(a);
  if (error) throw friendly(error);
}

export async function endAssignmentEarly(id: string, end_date: string, note: string | null) {
  const { error } = await supabase.from('controller_assignments').update({ end_date, ...(note ? { note } : {}) }).eq('id', id);
  if (error) throw friendly(error);
}

export async function cancelAssignment(id: string, reason: string) {
  const { error } = await supabase.from('controller_assignments').update({ status: 'cancelled', cancel_reason: reason }).eq('id', id);
  if (error) throw friendly(error);
}
