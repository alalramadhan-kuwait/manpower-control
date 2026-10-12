// Oracle absence statistics: reports (snapshots) and per-person figures. Written only through oracle_stats_import
// (a second import of the same report is refused; changed figures wait for the Section Head's confirmation).
import { supabase } from './supabase';
import { dataChanged } from './changes';
import type { StatCode, StatSnapshot, StatValue } from '@/core/oracleStats';

export async function fetchStatCodes(): Promise<StatCode[]> {
  const { data, error } = await supabase.from('oracle_absence_codes').select('*').order('code');
  if (error) throw error;
  return (data as { code: string; label: string; counts_as_sick: boolean; app_type_code: string | null; verified: boolean; source: string; note: string | null }[])
    .map((c) => ({ code: c.code, label: c.label, countsAsSick: c.counts_as_sick, appType: c.app_type_code, verified: c.verified, source: c.source, note: c.note }));
}

export async function fetchStats(employeeIds?: string[]): Promise<{ snapshots: StatSnapshot[]; values: StatValue[] }> {
  const [s, v] = await Promise.all([
    supabase.from('oracle_stat_snapshots').select('*').order('extracted_on', { ascending: false }).limit(500),
    employeeIds ? supabase.from('oracle_stat_values').select('*').in('employee_id', employeeIds).limit(20000) : supabase.from('oracle_stat_values').select('*').limit(20000)
  ]);
  if (s.error) throw s.error; if (v.error) throw v.error;
  return {
    snapshots: (s.data as { id: string; source_report: string; period_start: string; period_end: string; extracted_on: string; codes: string[]; employees: string[]; imported_at: string }[])
      .map((r) => ({ id: r.id, source: r.source_report, periodStart: r.period_start, periodEnd: r.period_end, extractedOn: r.extracted_on, codes: r.codes, employees: r.employees, importedAt: r.imported_at })),
    values: (v.data as { snapshot_id: string; employee_id: string; code: string; days: number | string; occurrences: number | null; status: 'active' | 'superseded' }[])
      .map((r) => ({ snapshotId: r.snapshot_id, employeeId: r.employee_id, code: r.code, days: Number(r.days), occurrences: r.occurrences, status: r.status }))
  };
}

export interface ImportOutcome { snapshot: string | null; inserted: number; unchanged: number; replaced?: number; conflicts: { employee_id: string; code: string; existing: number; new: number }[]; message?: string }
export async function importStats(snapshot: { source: string; periodStart: string; periodEnd: string; extractedOn: string; codes: string[]; note?: string | null },
  values: { employeeId: string; code: string; days: number; occurrences?: number | null }[], replace = false): Promise<ImportOutcome> {
  const { data, error } = await supabase.rpc('oracle_stats_import', {
    p_snapshot: { source_report: snapshot.source, period_start: snapshot.periodStart, period_end: snapshot.periodEnd, extracted_on: snapshot.extractedOn, codes: snapshot.codes, note: snapshot.note ?? null },
    p_values: values.map((v) => ({ employee_id: v.employeeId, code: v.code, days: v.days, occurrences: v.occurrences ?? null })), p_replace: replace
  });
  if (error) throw new Error(error.message);
  dataChanged();
  return data as ImportOutcome;
}
