// Bulk writes for the Employees screen and the Take-Charge screen. Every qualification change is a new dated
// record with the user's name; the previous current record is closed (or replaced when it started today).
import { supabase } from './supabase';
import { dataChanged } from './changes';
import type { QualificationCode, QualificationStatus, UserProfile } from './types';

export async function setQualificationBulk(employeeIds: string[], qualification: QualificationCode, status: QualificationStatus, profile: UserProfile, note: string): Promise<number> {
  if (employeeIds.length === 0) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const { data: current, error: e1 } = await supabase.from('employee_qualifications').select('id, employee_id, effective_from, status')
    .in('employee_id', employeeIds).eq('qualification', qualification).is('effective_to', null);
  if (e1) throw e1;
  const cur = (current ?? []) as { id: string; employee_id: string; effective_from: string; status: string }[];
  const unchanged = new Set(cur.filter((c) => c.status === status).map((c) => c.employee_id));
  const targets = employeeIds.filter((id) => !unchanged.has(id));
  if (targets.length === 0) return 0;
  const toReplace = cur.filter((c) => targets.includes(c.employee_id) && c.effective_from >= today).map((c) => c.id);
  const toClose = cur.filter((c) => targets.includes(c.employee_id) && c.effective_from < today).map((c) => c.id);
  if (toReplace.length) { const { error } = await supabase.from('employee_qualifications').delete().in('id', toReplace); if (error) throw error; }
  if (toClose.length) { const { error } = await supabase.from('employee_qualifications').update({ effective_to: today }).in('id', toClose); if (error) throw error; }
  const evidence = note.trim() || `Confirmed by ${profile.display_name} (bulk approval)`;
  const { error: e2 } = await supabase.from('employee_qualifications').insert(targets.map((employee_id) => ({
    employee_id, qualification, status, effective_from: today, source: 'manual', evidence, created_by: profile.auth_user_id
  })));
  if (e2) throw e2;
  dataChanged();
  return targets.length;
}

/** Confirms the current KNPC / Contractor classification (keeps the type, marks it confirmed). */
export async function confirmEmploymentTypeBulk(employeeIds: string[], note: string, profile: UserProfile): Promise<number> {
  if (employeeIds.length === 0) return 0;
  const { data, error } = await supabase.from('employees').update({ employment_type_source: 'confirmed' })
    .in('id', employeeIds).eq('employment_type_source', 'inferred').select('id');
  if (error) throw error;
  dataChanged();
  void note; void profile; // recorded by the audit trigger (who and when); kept in the signature for a future reason field
  return (data ?? []).length;
}
