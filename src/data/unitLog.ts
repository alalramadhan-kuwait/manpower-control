// Unit log reads (25 Nov 2026): the shift logs and lab samples the owner's Mac sends after each 6:30 export. Read only;
// the app never writes them (only the logbook-ingest function does).
import { supabase } from './supabase';
import type { StoredLog, StoredSample } from '@/core/logbook/view';

interface LogRow { kind: StoredLog['kind']; log_no: number; log_date: string; shift: string | null; crew: string | null; shift_day: string | null; recorded_at: string | null;
  sections: StoredLog['sections']; readings: StoredLog['readings']; feed: StoredLog['feed']; products: StoredLog['products']; received_at: string }
interface SampleRow { sample_id: string; material: string | null; equipment: string | null; collected_at: string | null; note: string | null; results: StoredSample['results'] }

const toLog = (r: LogRow): StoredLog => ({ kind: r.kind, logNo: r.log_no, date: r.log_date, shift: r.shift, crew: r.crew, day: r.shift_day, recordedAt: r.recorded_at,
  sections: r.sections ?? [], readings: r.readings ?? [], feed: r.feed ?? [], products: r.products ?? [] });

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/** The logs of the last `days` days (all three kinds) and when the Mac last sent. */
export async function fetchUnitLogs(days = 21): Promise<{ logs: StoredLog[]; lastReceived: string | null }> {
  const { data, error } = await supabase.from('unit_shift_logs')
    .select('kind,log_no,log_date,shift,crew,shift_day,recorded_at,sections,readings,feed,products,received_at')
    .gte('log_date', daysAgo(days)).order('log_date', { ascending: false }).limit(300);
  if (error) throw error;
  const rows = data as LogRow[];
  return { logs: rows.map(toLog), lastReceived: rows.reduce<string | null>((m, r) => (!m || r.received_at > m ? r.received_at : m), null) };
}

/** Lab samples collected in the last `days` days. */
export async function fetchLabSamples(days = 30): Promise<StoredSample[]> {
  const { data, error } = await supabase.from('unit_lab_samples').select('sample_id,material,equipment,collected_at,note,results')
    .gte('collected_at', `${daysAgo(days)}T00:00:00+03:00`).order('collected_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return (data as SampleRow[]).map((r) => ({ sampleId: r.sample_id, material: r.material, equipment: r.equipment, collectedAt: r.collected_at, note: r.note, results: r.results ?? [] }));
}
