// Database rows → the Unit log's own shapes. Shared by the app (src/data/unitLog.ts) and the logbook-ingest function,
// so the alert a phone gets is worked out from exactly what the app shows. Pure.
import type { Limit, LimitMatch } from './limits';
import type { Override, TrainId } from './board';
import type { StoredLog, StoredSample } from './view';

export interface LogRow { kind: StoredLog['kind']; log_no: number; log_date: string; shift: string | null; crew: string | null; shift_day: string | null; recorded_at: string | null;
  sections: StoredLog['sections']; readings: StoredLog['readings']; feed: StoredLog['feed']; products: StoredLog['products']; received_at?: string }
export interface SampleRow { sample_id: string; material: string | null; equipment: string | null; collected_at: string | null; note: string | null; results: StoredSample['results'] }
export interface LimitRow { param_id: string; section: string; description: string; unit: string; target: string | null; normal_lo: number | string | null; normal_hi: number | string | null;
  iow_std: string | null; iow_crit: string | null; trip: string | null; roc_max: string | null; source: string | null; action: string | null; status: Limit['status'] }
export interface MatchRow { param_id: string; kind: 'reading' | 'reading_sum' | 'reading_diff' | 'lab'; reading_key: string | null; reading_key2: string | null; scale: number | string | null; material: string | null; component: string | null; equipment: string | null }
export interface OverrideRow { id: string; train: TrainId; item: string; tags: string | null; reason: string | null; moc: string | null; started_on: string | null; expires_on: string | null; source: string | null }

export const LOG_COLS = 'kind,log_no,log_date,shift,crew,shift_day,recorded_at,sections,readings,feed,products,received_at';
export const SAMPLE_COLS = 'sample_id,material,equipment,collected_at,note,results';
export const LIMIT_COLS = 'param_id,section,description,unit,target,normal_lo,normal_hi,iow_std,iow_crit,trip,roc_max,source,action,status';
export const MATCH_COLS = 'param_id,kind,reading_key,reading_key2,scale,material,component,equipment';
export const OVERRIDE_COLS = 'id,train,item,tags,reason,moc,started_on,expires_on,source';

export const toLog = (r: LogRow): StoredLog => ({ kind: r.kind, logNo: r.log_no, date: r.log_date, shift: r.shift, crew: r.crew, day: r.shift_day, recordedAt: r.recorded_at,
  sections: r.sections ?? [], readings: r.readings ?? [], feed: r.feed ?? [], products: r.products ?? [] });
export const toSample = (r: SampleRow): StoredSample => ({ sampleId: r.sample_id, material: r.material, equipment: r.equipment, collectedAt: r.collected_at, note: r.note, results: r.results ?? [] });
const num = (v: number | string | null) => (v === null ? null : Number(v));
export const toLimit = (r: LimitRow): Limit => ({ paramId: r.param_id, section: r.section, description: r.description, unit: r.unit, target: r.target, normalLo: num(r.normal_lo), normalHi: num(r.normal_hi),
  iowStd: r.iow_std, iowCrit: r.iow_crit, trip: r.trip, roc: r.roc_max, source: r.source, action: r.action, status: r.status });
export const toMatch = (r: MatchRow): LimitMatch => (r.kind === 'lab'
  ? { paramId: r.param_id, kind: 'lab', material: r.material ?? '', component: r.component ?? '', equipment: r.equipment ?? undefined }
  : r.kind === 'reading_diff' ? { paramId: r.param_id, kind: 'reading_diff', key: r.reading_key ?? '', key2: r.reading_key2, scale: Number(r.scale ?? 1) }
    : { paramId: r.param_id, kind: r.kind, key: r.reading_key ?? '', scale: Number(r.scale ?? 1) });
export const toOverride = (r: OverrideRow): Override => ({ id: r.id, train: r.train, item: r.item, tags: r.tags, reason: r.reason, moc: r.moc, startedOn: r.started_on, expiresOn: r.expires_on, source: r.source });
