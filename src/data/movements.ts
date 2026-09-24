// Shift movements (Stage G): permanent moves and temporary covers. Every change goes through a database function
// (crew_move / crew_move_end / crew_move_cancel) that checks it and keeps the history.
import { supabase } from './supabase';
import type { Crew } from '@/core/roster';

export interface CrewMovement {
  id: string; employee_id: string; kind: 'temporary' | 'permanent'; from_crew: Crew | null; to_crew: Crew;
  start_date: string; end_date: string | null; reason: string | null; status: 'active' | 'cancelled';
  created_at: string; cancelled_at: string | null; cancel_reason: string | null;
}

function plain(error: { message: string }): Error {
  if (error.message.includes('cm_one_temporary_at_a_time')) return new Error('This person already has a temporary cover on some of these dates. End or cancel it first.');
  return new Error(error.message);
}

export async function fetchMovements(employeeId?: string): Promise<CrewMovement[]> {
  let q = supabase.from('crew_movements').select('*').order('start_date', { ascending: false }).limit(2000);
  if (employeeId) q = q.eq('employee_id', employeeId);
  const { data, error } = await q;
  if (error) throw error;
  return data as CrewMovement[];
}

export async function recordMovement(v: { employee: string; kind: CrewMovement['kind']; to: Crew; start: string; end: string | null; reason: string }): Promise<string> {
  const { data, error } = await supabase.rpc('crew_move', { p_employee: v.employee, p_kind: v.kind, p_to_crew: v.to, p_start: v.start, p_end: v.end, p_reason: v.reason });
  if (error) throw plain(error);
  return data as string;
}
export async function endMovement(id: string, end: string, note: string) {
  const { error } = await supabase.rpc('crew_move_end', { p_id: id, p_end: end, p_note: note });
  if (error) throw plain(error);
}
export async function cancelMovement(id: string, reason: string) {
  const { error } = await supabase.rpc('crew_move_cancel', { p_id: id, p_reason: reason });
  if (error) throw plain(error);
}
