// Rolling 12-month sick-leave figures: the latest confirmed one per person, from the sick-leave checks (typed in, or the
// sick-leave Excel import) and the Oracle statistics (a report covering a rolling 12 months); the newer of the two counts.
// A calendar-year total is never used here. Shared by the engine, the shutdown teams and vacation planning.
import { supabase } from './supabase';
import { fetchStatCodes, fetchStats } from './oracleStats';
import { sickRolling } from '@/core/oracleStats';
import type { SickEntry } from '@/core/shutdown/v2';

export interface SickRow { employee_id: string; as_of: string; days: number; entered_at: string }

/** The latest confirmed rolling 12-month figure of each person (absent: not known). */
export async function fetchSickEntries(ids: string[]): Promise<Map<string, SickEntry>> {
  const out = new Map<string, SickEntry>();
  if (!ids.length) return out;
  const { data, error } = await supabase.from('sick_checks').select('employee_id,as_of,days,entered_at').in('employee_id', ids).order('entered_at', { ascending: false });
  if (error) throw error;
  for (const r of data as SickRow[]) if (!out.has(r.employee_id)) out.set(r.employee_id, { asOf: r.as_of, days: r.days });
  // Oracle statistics: a report covering a rolling 12 months for the person (and every sick code) is a confirmed figure
  // as of the day it was taken; the newer of the two counts. A calendar-year total is never used here.
  const [codes, stats] = await Promise.all([fetchStatCodes(), fetchStats(ids)]);
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  for (const id of ids) {
    const r = sickRolling(id, today, stats.snapshots, stats.values, codes);
    if (r.days === null || !r.snapshot) continue;
    const prev = out.get(id);
    if (!prev || prev.asOf < r.snapshot.extractedOn) out.set(id, { asOf: r.snapshot.extractedOn, days: r.days });
  }
  return out;
}
