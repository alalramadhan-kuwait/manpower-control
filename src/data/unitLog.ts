// Unit log reads (25 Nov 2026): the shift logs and lab samples the owner's Mac sends after each 6:30 export. Read only;
// the app never writes them (only the logbook-ingest function does).
import { supabase } from './supabase';
import type { StoredLog, StoredSample } from '@/core/logbook/view';
import type { Limit, LimitMatch } from '@/core/logbook/limits';
import type { Override, TrainId } from '@/core/logbook/board';

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

// ── The limit library (owner's spec of 25 Nov 2026) and its match rules: kept in the database only ──────────────────
interface LimitRow { param_id: string; section: string; description: string; unit: string; target: string | null; normal_lo: number | null; normal_hi: number | null;
  iow_std: string | null; iow_crit: string | null; trip: string | null; roc_max: string | null; source: string | null; action: string | null; status: Limit['status'] }
interface MatchRow { param_id: string; kind: 'reading' | 'reading_sum' | 'lab'; reading_key: string | null; scale: number | null; material: string | null; component: string | null; equipment: string | null }

/** The current limits and which readings / lab results each one judges (empty until the library is loaded). */
export async function fetchLimits(): Promise<{ limits: Map<string, Limit>; matches: LimitMatch[] }> {
  const [l, m] = await Promise.all([supabase.from('unit_limits').select('param_id,section,description,unit,target,normal_lo,normal_hi,iow_std,iow_crit,trip,roc_max,source,action,status').neq('status', 'retired'),
    supabase.from('unit_limit_matches').select('param_id,kind,reading_key,scale,material,component,equipment')]);
  if (l.error || m.error) return { limits: new Map(), matches: [] };       // no library yet: the page shows values without colours
  const limits = new Map((l.data as LimitRow[]).map((r) => [r.param_id, { paramId: r.param_id, section: r.section, description: r.description, unit: r.unit, target: r.target,
    normalLo: r.normal_lo === null ? null : Number(r.normal_lo), normalHi: r.normal_hi === null ? null : Number(r.normal_hi), iowStd: r.iow_std, iowCrit: r.iow_crit, trip: r.trip, roc: r.roc_max, source: r.source, action: r.action, status: r.status } as Limit]));
  const matches = (m.data as MatchRow[]).map((r): LimitMatch => (r.kind === 'lab'
    ? { paramId: r.param_id, kind: 'lab', material: r.material ?? '', component: r.component ?? '', equipment: r.equipment ?? undefined }
    : { paramId: r.param_id, kind: r.kind, key: r.reading_key ?? '', scale: Number(r.scale ?? 1) }));
  return { limits, matches };
}

/** Open overrides / bypasses (spec §5.1); they lead the handover. */
export async function fetchOverrides(): Promise<Override[]> {
  const { data, error } = await supabase.from('unit_overrides').select('id,train,item,tags,reason,moc,started_on,expires_on,source').eq('status', 'open').order('started_on');
  if (error) return [];
  return (data as { id: string; train: TrainId; item: string; tags: string | null; reason: string | null; moc: string | null; started_on: string | null; expires_on: string | null; source: string | null }[])
    .map((r) => ({ id: r.id, train: r.train, item: r.item, tags: r.tags, reason: r.reason, moc: r.moc, startedOn: r.started_on, expiresOn: r.expires_on, source: r.source }));
}
