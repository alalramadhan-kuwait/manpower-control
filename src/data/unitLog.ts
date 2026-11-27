// Unit log reads (25 Nov 2026): the shift logs and lab samples the owner's Mac sends after each morning and evening
// export. Read only; the app never writes them (only the logbook-ingest function does).
import { supabase } from './supabase';
import type { StoredLog, StoredSample } from '@/core/logbook/view';
import type { Limit, LimitMatch } from '@/core/logbook/limits';
import type { Override } from '@/core/logbook/board';
import { LIMIT_COLS, LOG_COLS, MATCH_COLS, OVERRIDE_COLS, SAMPLE_COLS, SCHEDULE_COLS, toLimit, toLog, toMatch, toOverride, toSample, toSchedule, type LimitRow, type LogRow, type MatchRow, type OverrideRow, type SampleRow, type ScheduleRow } from '@/core/logbook/rows';
import type { ScheduleItem } from '@/core/logbook/schedule';

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/** The logs of the last `days` days (all three kinds) and when the Mac last sent. */
export async function fetchUnitLogs(days = 21): Promise<{ logs: StoredLog[]; lastReceived: string | null }> {
  const { data, error } = await supabase.from('unit_shift_logs').select(LOG_COLS).gte('log_date', daysAgo(days)).order('log_date', { ascending: false }).limit(300);
  if (error) throw error;
  const rows = data as LogRow[];
  return { logs: rows.map(toLog), lastReceived: rows.reduce<string | null>((m, r) => (!m || (r.received_at ?? '') > m ? r.received_at ?? m : m), null) };
}

/** Lab samples collected in the last `days` days. */
export async function fetchLabSamples(days = 30): Promise<StoredSample[]> {
  const { data, error } = await supabase.from('unit_lab_samples').select(SAMPLE_COLS)
    .gte('collected_at', `${daysAgo(days)}T00:00:00+03:00`).order('collected_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return (data as SampleRow[]).map(toSample);
}

// ── The limit library (owner's spec of 25 Nov 2026) and its match rules: kept in the database only ──────────────────
/** The current limits and which readings / lab results each one judges (empty until the library is loaded). */
export async function fetchLimits(): Promise<{ limits: Map<string, Limit>; matches: LimitMatch[] }> {
  const [l, m] = await Promise.all([supabase.from('unit_limits').select(LIMIT_COLS).neq('status', 'retired'), supabase.from('unit_limit_matches').select(MATCH_COLS)]);
  if (l.error || m.error) return { limits: new Map(), matches: [] };       // no library yet: the page shows values without colours
  return { limits: new Map((l.data as LimitRow[]).map((r) => [r.param_id, toLimit(r)])), matches: (m.data as MatchRow[]).map(toMatch) };
}

/** Open overrides / bypasses (spec §5.1); they lead the handover. */
export async function fetchOverrides(): Promise<Override[]> {
  const { data, error } = await supabase.from('unit_overrides').select(OVERRIDE_COLS).eq('status', 'open').order('started_on');
  if (error) return [];
  return (data as OverrideRow[]).map(toOverride);
}

/** The routine sample schedule (owner's sampling document; database only). Empty when not loaded. */
export async function fetchSchedule(): Promise<ScheduleItem[]> {
  const { data, error } = await supabase.from('unit_sample_schedule').select(SCHEDULE_COLS).eq('status', 'active').order('id');
  if (error) return [];
  return (data as ScheduleRow[]).map(toSchedule);
}

/** Unit log alerts on this phone (its push subscription): read and set. */
export async function unitLogAlertsOn(endpoint: string): Promise<boolean> {
  const { data } = await supabase.from('push_subscriptions').select('unit_log_alerts').eq('endpoint', endpoint).maybeSingle();
  return !!(data as { unit_log_alerts?: boolean } | null)?.unit_log_alerts;
}
export async function setUnitLogAlerts(endpoint: string, on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('push_unit_log_alerts', { p_endpoint: endpoint, p_on: on });
  if (error) throw error;
  return !!data;
}
