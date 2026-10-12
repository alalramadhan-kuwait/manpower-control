// Shift movements (Stage G): permanent moves, temporary covers and day duty (to_crew 'DAY'). Every change goes through a database function
// (crew_move / crew_move_end / crew_move_cancel) that checks it and keeps the history.
import { supabase } from './supabase';
import { dataChanged } from './changes';
import type { Crew } from '@/core/roster';

export interface CrewMovement {
  id: string; employee_id: string; kind: 'temporary' | 'permanent' | 'placement'; from_crew: Crew | null; to_crew: Crew | 'DAY';
  start_date: string; end_date: string | null; reason: string | null; status: 'active' | 'cancelled';
  created_at: string; cancelled_at: string | null; cancel_reason: string | null;
}

function plain(error: { message: string }): Error {
  if (error.message.includes('cm_one_placement_at_a_time')) return new Error('This VR already has a placement on some of these dates.');
  if (error.message.includes('cm_one_temporary_at_a_time')) return new Error('This person already has a temporary cover or day duty on some of these dates. End or cancel it first.');
  return new Error(error.message);
}

export async function fetchMovements(employeeId?: string): Promise<CrewMovement[]> {
  let q = supabase.from('crew_movements').select('*').order('start_date', { ascending: false }).limit(2000);
  if (employeeId) q = q.eq('employee_id', employeeId);
  const { data, error } = await q;
  if (error) throw error;
  return data as CrewMovement[];
}

/** End early or cancel an approved movement: the Section Head only (the database refuses anyone else). */
export async function endMovement(id: string, end: string, note: string) {
  const { error } = await supabase.rpc('movement_amend', { p_id: id, p_kind: 'end', p_date: end, p_note: note });
  if (error) throw plain(error);
  dataChanged();
}
export async function cancelMovement(id: string, reason: string) {
  const { error } = await supabase.rpc('movement_amend', { p_id: id, p_kind: 'cancel', p_date: null, p_note: reason });
  if (error) throw plain(error);
  dataChanged();
}
