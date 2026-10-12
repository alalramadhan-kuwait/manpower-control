// Employee notes: short general notes on a person (no medical details). Both roles read and add; the Coordinator edits
// only their own, the Section Head any. Notes are never deleted (archived instead) and every change is audited.
import { supabase } from './supabase';
import { fetchRequesterNames } from './changeRequests';

export interface Note { id: string; employeeId: string; body: string; author: string; authorName: string; createdAt: string; editedAt: string | null; editedByName: string | null; archived: boolean }

export async function fetchNotes(employeeId: string): Promise<Note[]> {
  const { data, error } = await supabase.from('employee_notes').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  const rows = data as { id: string; employee_id: string; body: string; author: string; created_at: string; edited_at: string | null; edited_by: string | null; archived: boolean }[];
  const names = await fetchRequesterNames([...new Set(rows.flatMap((r) => [r.author, r.edited_by]).filter((x): x is string => !!x))]);
  return rows.map((r) => ({ id: r.id, employeeId: r.employee_id, body: r.body, author: r.author, authorName: names.get(r.author) ?? '—', createdAt: r.created_at, editedAt: r.edited_at, editedByName: r.edited_by ? names.get(r.edited_by) ?? '—' : null, archived: r.archived }));
}
export async function addNote(employeeId: string, body: string): Promise<void> {
  const { error } = await supabase.from('employee_notes').insert({ employee_id: employeeId, body: body.trim() });
  if (error) throw new Error(error.message);
}
/** Edit or archive: the database allows it only to the author (Coordinator) or the Section Head; nothing else changes. */
export async function updateNote(id: string, patch: { body?: string; archived?: boolean }): Promise<void> {
  const { data, error } = await supabase.from('employee_notes').update(patch).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('Only the author or the Section Head can change this note.');
}
