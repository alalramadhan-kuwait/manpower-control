// Unit log intake (owner, 25 Nov 2026). The owner's Mac reads the shift-log and lab PDFs after each export (6:50, 14:50, 22:50)
// (tools/logbook/send.mjs) and posts the records here. It holds a random key; this function keeps only its SHA-256 (in
// logbook_ingest_keys, readable by the server alone), so a key can be revoked without touching anything else.
// Records replace the same log / sample when sent again, so a re-send is harmless. Nothing is read back to the caller.
//   POST  x-logbook-key: <64 hex>   { "logs": ShiftLog[] + {file}, "samples": LabSample[] + {file} }
// No login (the Mac has none): verify_jwt is off and the key is the only way in.
// Alerts (owner, 26 Nov 2026): when a new ARDS shift log or new lab samples arrive, the phones that turned on Unit log
// alerts get a push (src/core/logbook/alerts.ts): the newest new log's status per train, then the new lab results
// beyond the library's limits; the log alert adds the sample points overdue by the sample schedule (27 Nov 2026).
// At most two pushes per send; a failed push never fails the save.
// This file is bundled with the app's src/core into index.ts by scripts/build-shift-alerts.mjs (npm run functions:build).
import webpush from 'npm:web-push@3';
import { labAlert, logAlert, type PushText } from '../../../src/core/logbook/alerts';
import { byShiftDesc, sameShift } from '../../../src/core/logbook/view';
import { LIMIT_COLS, LOG_COLS, MATCH_COLS, OVERRIDE_COLS, SAMPLE_COLS, SCHEDULE_COLS, toLimit, toLog, toMatch, toOverride, toSample, toSchedule, type LimitRow, type LogRow, type MatchRow, type OverrideRow, type SampleRow, type ScheduleRow } from '../../../src/core/logbook/rows';
import { overdueByPoint, scheduleStatus } from '../../../src/core/logbook/schedule';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAX_BODY = 4_000_000, MAX_LOGS = 200, MAX_SAMPLES = 600;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const rest = (path: string, init: RequestInit = {}) => fetch(`${URL_}/rest/v1/${path}`, {
  ...init, headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
});
async function sha256(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** JSON copied with limits (depth, string length, list length); anything else is dropped. */
function bounded(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return typeof v === 'number' && !Number.isFinite(v) ? null : v;
  if (typeof v === 'string') return v.slice(0, 4000);
  if (depth > 6) return null;
  if (Array.isArray(v)) return v.slice(0, 500).map((x) => bounded(x, depth + 1));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 40).map(([k, x]) => [k.slice(0, 60), bounded(x, depth + 1)]));
  return null;
}
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const oneOf = <T extends string>(v: unknown, ok: readonly T[]) => (ok.includes(v as T) ? (v as T) : null);
const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? bounded(v) : []);

async function getRows<T>(path: string): Promise<T[]> {
  const r = await rest(path);
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status}`);
  return (await r.json()) as T[];
}

interface Sub { id: string; endpoint: string; p256dh: string; auth: string }
/** Push the newest new ARDS log's status and the new lab results to the phones with Unit log alerts on. */
async function notify(newLogs: LogRow[], newSamples: SampleRow[]) {
  const subs = await getRows<Sub>('push_subscriptions?unit_log_alerts=eq.true&select=id,endpoint,p256dh,auth');
  if (!subs.length) return { sent: 0, phones: 0 };
  const [cfg] = await getRows<{ vapid_public: string | null; vapid_private: string | null }>('push_config?id=eq.true&select=vapid_public,vapid_private');
  if (!cfg?.vapid_public || !cfg.vapid_private) return { error: 'push keys not set' };
  webpush.setVapidDetails('https://ops12ards.com', cfg.vapid_public, cfg.vapid_private);
  const [limRows, matchRows, ovRows] = await Promise.all([getRows<LimitRow>(`unit_limits?select=${LIMIT_COLS}&status=neq.retired`), getRows<MatchRow>(`unit_limit_matches?select=${MATCH_COLS}`),
    getRows<OverrideRow>(`unit_overrides?select=${OVERRIDE_COLS}&status=eq.open`)]);
  const limits = new Map(limRows.map((r) => [r.param_id, toLimit(r)])), matches = matchRows.map(toMatch), overrides = ovRows.map(toOverride);
  const texts: PushText[] = [];
  const newest = byShiftDesc(newLogs.map(toLog))[0];
  if (newest) {
    // ten days of lab: the log's day for its checks, and enough for the weekly sample schedule
    const from = new Date(Math.min(Date.parse(`${newest.date}T00:00:00Z`) - 864e5, Date.now() - 10 * 864e5)).toISOString().slice(0, 10);
    const [labRows, ctlRows, schedRows] = await Promise.all([getRows<SampleRow>(`unit_lab_samples?select=${SAMPLE_COLS}&collected_at=gte.${from}T00:00:00%2B03:00`),
      getRows<LogRow>(`unit_shift_logs?select=${LOG_COLS}&kind=eq.controller1&log_date=eq.${newest.date}`),
      getRows<ScheduleRow>(`unit_sample_schedule?select=${SCHEDULE_COLS}&status=eq.active`).catch(() => [] as ScheduleRow[])]);
    const controller = ctlRows.map(toLog).find((c) => sameShift(c, newest)) ?? null;
    const lab = labRows.map(toSample);
    texts.push(logAlert({ log: newest, controller, lab, limits, matches, overrides }, overdueByPoint(scheduleStatus(lab, schedRows.map(toSchedule), new Date()))));
  }
  const lab = labAlert(newSamples.map(toSample), limits, matches);
  if (lab) texts.push(lab);
  let sent = 0, failed = 0; const gone: string[] = [];
  for (const t of texts) {
    const res = await Promise.allSettled(subs.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(t), { TTL: 3600, urgency: 'normal' })));
    res.forEach((r, i) => { if (r.status === 'fulfilled') sent += 1; else { failed += 1; const code = (r.reason as { statusCode?: number }).statusCode; if (code === 404 || code === 410) gone.push(subs[i].id); } });
  }
  if (gone.length) await rest(`push_subscriptions?id=in.(${[...new Set(gone)].join(',')})`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
  return { sent, failed, pushes: texts.map((t) => t.title) };
}

function logRow(x: Record<string, unknown>) {
  const kind = oneOf(x.kind, ['ards', 'htu', 'controller1'] as const);
  const logNo = Number(x.logNo);
  const date = typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : null;
  if (!kind || !Number.isInteger(logNo) || logNo <= 0 || !date) return null;
  return {
    kind, log_no: logNo, log_date: date,
    shift: oneOf(x.shift, ['Morning', 'Afternoon', 'Night'] as const), crew: oneOf(x.crew, ['A', 'B', 'C', 'D'] as const),
    shift_day: oneOf(x.day, ['1st', '2nd'] as const), recorded_at: iso(x.createdAt),
    sections: arr(x.sections), readings: arr(x.readings), feed: arr(x.feed), products: arr(x.products), manpower: arr(x.manpower),
    unplaced: Number.isInteger(x.unplaced) ? x.unplaced : 0, source_file: str(x.file), received_at: new Date().toISOString(),
  };
}
function sampleRow(x: Record<string, unknown>) {
  const id = str(x.sampleId, 80);
  if (!id) return null;
  return {
    sample_id: id, unit_no: str(x.unitNo, 20), material: str(x.material), equipment: str(x.equipment), collected_at: iso(x.collectedAt),
    note: str(x.note, 400), results: arr(x.results), source_file: str(x.file), received_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const key = req.headers.get('x-logbook-key') ?? '';
  if (!/^[0-9a-f]{64}$/.test(key)) return json(401, { error: 'key' });
  const hash = await sha256(key);
  const k = await rest(`logbook_ingest_keys?key_sha256=eq.${hash}&revoked_at=is.null&select=key_sha256`);
  if (!k.ok || !((await k.json()) as unknown[]).length) return json(401, { error: 'key' });

  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { error: 'too large' });
  let body: { logs?: unknown; samples?: unknown };
  try { body = JSON.parse(text); } catch { return json(400, { error: 'not JSON' }); }
  const logsIn = Array.isArray(body.logs) ? body.logs : [], samplesIn = Array.isArray(body.samples) ? body.samples : [];
  if (logsIn.length > MAX_LOGS || samplesIn.length > MAX_SAMPLES) return json(413, { error: 'too many' });
  const logs = logsIn.map((x) => (x && typeof x === 'object' ? logRow(x as Record<string, unknown>) : null));
  const samples = samplesIn.map((x) => (x && typeof x === 'object' ? sampleRow(x as Record<string, unknown>) : null));
  // one row per log / sample (a sample can be in two reports): the copy with the most results wins
  const once = <T>(rows: (T | null)[], key: (r: T) => string, size: (r: T) => number) => {
    const m = new Map<string, T>();
    for (const r of rows) if (r) { const k = key(r), had = m.get(k); if (!had || size(r) >= size(had)) m.set(k, r); }
    return [...m.values()];
  };
  const goodLogs = once(logs, (r) => `${r.kind}:${r.log_no}`, (r) => JSON.stringify(r.sections).length);
  const goodSamples = once(samples, (r) => r.sample_id, (r) => (r.results as unknown[]).length);

  // what is new: compared with what is already stored from the same days
  const minDate = goodLogs.map((r) => r.log_date).sort()[0];
  const minAt = goodSamples.map((r) => r.collected_at).filter((x): x is string => !!x).sort()[0];
  let newArds: typeof goodLogs = [], newSamples: typeof goodSamples = [];
  try {   // a failed look-up only means no alert this time; the save goes ahead
    const [hadLogs, hadSamples] = await Promise.all([
      minDate ? getRows<{ kind: string; log_no: number }>(`unit_shift_logs?select=kind,log_no&log_date=gte.${minDate}`) : Promise.resolve([]),
      minAt ? getRows<{ sample_id: string }>(`unit_lab_samples?select=sample_id&collected_at=gte.${encodeURIComponent(minAt)}`) : Promise.resolve([]),
    ]);
    const seenL = new Set(hadLogs.map((r) => `${r.kind}:${r.log_no}`)), seenS = new Set(hadSamples.map((r) => r.sample_id));
    newArds = goodLogs.filter((r) => r.kind === 'ards' && !seenL.has(`ards:${r.log_no}`));
    newSamples = goodSamples.filter((r) => r.collected_at && !seenS.has(r.sample_id));
  } catch (e) { console.error('new-item look-up failed', String(e).slice(0, 200)); }

  const up = (table: string, conflict: string, rows: unknown[]) => rows.length
    ? rest(`${table}?on_conflict=${conflict}`, { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) })
    : Promise.resolve(new Response(null, { status: 204 }));
  const [a, b] = await Promise.all([up('unit_shift_logs', 'kind,log_no', goodLogs), up('unit_lab_samples', 'sample_id', goodSamples)]);
  if (!a.ok || !b.ok) return json(500, { error: 'save failed', logs: a.ok ? 'ok' : (await a.text()).slice(0, 300), samples: b.ok ? 'ok' : (await b.text()).slice(0, 300) });
  await rest(`logbook_ingest_keys?key_sha256=eq.${hash}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ last_used_at: new Date().toISOString() }) });
  let notified: unknown = null;
  if (newArds.length || newSamples.length) {
    try { notified = await notify(newArds as unknown as LogRow[], newSamples as unknown as SampleRow[]); } catch (e) { notified = { error: String((e as Error).message ?? e).slice(0, 200) }; }
  }
  return json(200, { logs: goodLogs.length, samples: goodSamples.length, skipped: logs.filter((r) => !r).length + samples.filter((r) => !r).length,
    new: { logs: newArds.length, samples: newSamples.length }, notified });
});
