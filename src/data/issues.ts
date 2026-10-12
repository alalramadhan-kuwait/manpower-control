import { supabase } from './supabase';
import type { IssueLevel } from '@/core/notifications';

export interface Issue { key: string; level: IssueLevel; area: string; title: string; detail: string; target: string; firstDate: string | null; status: 'open' | 'resolved'; openedAt: string; updatedAt: string; resolvedAt: string | null }
/** Resolved issues (history), newest first. */
export async function fetchResolvedIssues(limit = 200): Promise<Issue[]> {
  const { data, error } = await supabase.from('issues').select('*').eq('status', 'resolved').order('resolved_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data as { key: string; level: IssueLevel; area: string; title: string; detail: string; target: string; first_date: string | null; status: 'open' | 'resolved'; opened_at: string; updated_at: string; resolved_at: string | null }[])
    .map((r) => ({ key: r.key, level: r.level, area: r.area, title: r.title, detail: r.detail, target: r.target, firstDate: r.first_date, status: r.status, openedAt: r.opened_at, updatedAt: r.updated_at, resolvedAt: r.resolved_at }));
}
