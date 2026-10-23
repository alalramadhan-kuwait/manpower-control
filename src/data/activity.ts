// User activity: visits recorded by the app (app_activity), and for the Section Head who used it and what they did:
// visits, changes in the app (audit_log) and in the shutdown tracker (trk_log).
import { supabase } from './supabase';
import type { AuditRow } from '@/core/audit';
import type { TrkLog } from '@/core/tracker';

/** The device in a word, from the browser. */
export function deviceName(ua = navigator.userAgent): string {
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Other';
}

/** Records that the person (a login or an engineer link) opened a page; repeats within 10 minutes count once. */
export function recordVisit(page: string): void {
  void supabase.rpc('app_visit', { p_page: page, p_device: deviceName() }).then(() => undefined, () => undefined);
}

export interface ActivityPerson { name: string; kind: 'app' | 'link'; role: string | null; lastSeen: string | null; visits: number; appChanges: number; trackerChanges: number; lastPage: string | null }
export async function fetchActivitySummary(days: number): Promise<ActivityPerson[]> {
  const { data, error } = await supabase.rpc('user_activity_summary', { p_days: days });
  if (error) throw error;
  return (data as { name: string; kind: 'app' | 'link'; role: string | null; last_seen: string | null; visits: number; app_changes: number; tracker_changes: number; last_page: string | null }[])
    .map((r) => ({ name: r.name, kind: r.kind, role: r.role, lastSeen: r.last_seen, visits: Number(r.visits), appChanges: Number(r.app_changes), trackerChanges: Number(r.tracker_changes), lastPage: r.last_page }));
}

export interface Visit { at: string; name: string; kind: 'app' | 'link'; page: string; device: string | null }
/** One person's visits, tracker changes and app changes since `days` ago (the app changes by their login). */
export async function fetchPersonActivity(name: string, kind: 'app' | 'link', days: number): Promise<{ visits: Visit[]; tracker: TrkLog[]; app: AuditRow[] }> {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const [v, t, u] = await Promise.all([
    supabase.from('app_activity').select('at,name,kind,page,device').eq('name', name).gte('at', since).order('at', { ascending: false }).limit(1000),
    supabase.from('trk_log').select('kind,ref,field,old_value,new_value,by_name,at').eq('by_name', name).gte('at', since).order('at', { ascending: false }).limit(2000),
    kind === 'app' ? supabase.from('user_profiles').select('auth_user_id').eq('display_name', name).limit(1) : Promise.resolve({ data: [], error: null })
  ]);
  for (const r of [v, t, u]) if (r.error) throw r.error;
  const uid = (u.data as { auth_user_id: string }[])[0]?.auth_user_id;
  let app: AuditRow[] = [];
  if (uid) {
    const a = await supabase.from('audit_log').select('*').eq('actor_id', uid).is('batch_id', null).gte('occurred_at', since).order('occurred_at', { ascending: false }).limit(1000);
    if (a.error) throw a.error; app = a.data as AuditRow[];
  }
  return {
    visits: v.data as Visit[],
    tracker: (t.data as { kind: TrkLog['kind']; ref: string; field: string; old_value: string | null; new_value: string | null; by_name: string | null; at: string }[])
      .map((r) => ({ kind: r.kind, ref: r.ref, field: r.field, oldValue: r.old_value, newValue: r.new_value, byName: r.by_name, at: r.at })),
    app
  };
}
