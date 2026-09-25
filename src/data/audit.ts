// Audit history (Stage J): reads audit_log (staff only, read-only) and the names needed to describe each row.
import { supabase } from './supabase';
import type { AuditLookups, AuditRow } from '@/core/audit';

export async function fetchAuditLookups(): Promise<AuditLookups> {
  const [e, p, c, a, u, gone] = await Promise.all([
    supabase.from('employees').select('id,display_name'),
    supabase.from('positions').select('id,label'),
    supabase.from('crews').select('id,code'),
    supabase.from('absence_types').select('code,label,short_code'),
    supabase.from('user_profiles').select('auth_user_id,display_name'),
    // staff records deleted since: their names live on in the history
    supabase.from('audit_log').select('entity_id,previous').eq('entity_table', 'employees').eq('action', 'delete')
  ]);
  for (const r of [e, p, c, a, u, gone]) if (r.error) throw r.error;
  const people = new Map<string, string>();
  for (const g of gone.data as { entity_id: string | null; previous: { display_name?: string } | null }[]) if (g.entity_id && g.previous?.display_name) people.set(g.entity_id, g.previous.display_name);
  for (const x of e.data as { id: string; display_name: string }[]) people.set(x.id, x.display_name);
  return {
    people,
    positions: new Map((p.data as { id: string; label: string }[]).map((x) => [x.id, x.label])),
    crews: new Map((c.data as { id: string; code: string }[]).map((x) => [x.id, x.code])),
    absence: new Map((a.data as { code: string; label: string; short_code: string | null }[]).map((x) => [x.code, x.short_code ?? x.label])),
    actors: new Map((u.data as { auth_user_id: string; display_name: string }[]).map((x) => [x.auth_user_id, x.display_name]))
  };
}

export const AUDIT_PAGE = 60;

/** Newest first. `before` continues a list; imports (rows written by a workbook import batch) are left out unless asked for. */
export async function fetchAudit(o: { before?: string; tables?: string[]; employeeId?: string; includeImports?: boolean; limit?: number } = {}): Promise<AuditRow[]> {
  let q = supabase.from('audit_log').select('*').order('occurred_at', { ascending: false }).limit(o.limit ?? AUDIT_PAGE);
  if (o.before) q = q.lt('occurred_at', o.before);
  if (o.tables?.length) q = q.in('entity_table', o.tables);
  if (o.employeeId) q = q.eq('related_employee_id', o.employeeId);
  if (!o.includeImports) q = q.is('batch_id', null);
  const { data, error } = await q;
  if (error) throw error;
  return data as AuditRow[];
}
