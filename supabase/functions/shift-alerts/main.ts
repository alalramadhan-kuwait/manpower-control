// Area 4 Manpower Control: shift alerts. The database's cron calls this every minute; when a shift starts within the
// lead time (15 minutes) it works out which crew comes on and who the Controller in charge is, with the same
// engine as the app, and sends a push notification to every phone that turned alerts on.
//   - cron: header x-cron-secret (kept in push_config) -> send what is due, once per shift per day; with
//     { action: 'preview', at } it only says what the next alert after `at` would be.
//   - a signed-in Section Head / Manpower Coordinator: { action: 'test' } sends the next shift's alert to their own
//     phones, marked Test; { action: 'preview' } returns what it would say, sending nothing.
// This file is bundled with the app's engine into index.ts by scripts/build-shift-alerts.mjs (a test keeps them in step).
import webpush from 'npm:web-push@3';
import { evaluateRange } from '../../../src/core/manpower';
import { addDaysIso, crewsByShift } from '../../../src/core/roster';
import { DEFAULT_SHIFT_ALERTS, alertText, dueShifts, nextShift, type AlertFacts, type ShiftAlertSettings, type ShiftStart } from '../../../src/core/shiftAlerts';
import { fetchManpowerInputs } from '../../../src/data/manpower';
import { supabase as admin } from './supabase-shim';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const APP_URL = 'https://alalramadhan-kuwait.github.io/manpower-control/';

interface Config { vapid_public: string | null; vapid_private: string | null; cron_secret: string }
interface Sub { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }

async function config(): Promise<Config> {
  const { data, error } = await admin.from('push_config').select('vapid_public,vapid_private,cron_secret').eq('id', true).single();
  if (error) throw error;
  const c = data as Config;
  if (!c.vapid_public || !c.vapid_private) throw new Error('Push keys are not set up (push_config).');
  webpush.setVapidDetails(APP_URL, c.vapid_public, c.vapid_private);
  return c;
}

async function settings(): Promise<ShiftAlertSettings> {
  const { data, error } = await admin.from('shift_alert_settings').select('*').eq('id', true).maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_SHIFT_ALERTS;
  const t = (v: string) => String(v).slice(0, 5);
  return { enabled: data.enabled, leadMinutes: data.lead_minutes, tz: data.tz, starts: { M: t(data.morning_start), A: t(data.afternoon_start), N: t(data.night_start) } };
}

/** The crew coming on, who is in charge, and what is short, from the app's own engine. */
async function factsFor(s: ShiftStart, test = false): Promise<AlertFacts> {
  const inputs = await fetchManpowerInputs(addDaysIso(s.date, -1), addDaysIso(s.date, 1));
  const day = evaluateRange(s.date, s.date, inputs.people, inputs.absencesAll, inputs.rules, inputs.assignments)[0];
  const crew = crewsByShift(s.date)[s.shift];
  const cd = day.crews.find((c) => c.crew === crew)!;
  // in charge: the crew's own Controller(s); when none is counted, whoever is (the cover, a VR); the rest are listed as also on
  const counted = cd.controller.counted;
  const own = counted.filter((p) => p.role === 'controller');
  const lead = own.length ? own : counted;
  const name = (p: { name: string; role: string | null }) => (p.role === 'vr_controller' ? `${p.name} (VR)` : p.name);
  return {
    crew, shift: s.shift, date: s.date, startsAt: s.startsAt, test,
    controllers: lead.map(name), also: counted.filter((p) => !lead.includes(p)).map(name),
    short: [cd.controller, cd.panel, cd.field].filter((p) => p.finding === 'shortage').map((p) => `${p.label} ${p.count} of ${p.min}`)
  };
}

async function send(subs: Sub[], payload: ReturnType<typeof alertText>): Promise<{ sent: number; failed: number }> {
  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(subs.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 600, urgency: 'high' })));
  const gone: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const code = (r.reason as { statusCode?: number }).statusCode;
      console.error('push failed', code, String((r.reason as Error).message ?? r.reason).slice(0, 200));
      if (code === 404 || code === 410) gone.push(subs[i].id); // the phone removed the subscription
    }
  });
  if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone);
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  if (sent) await admin.from('push_subscriptions').update({ last_sent_at: new Date().toISOString() }).in('id', subs.filter((_, i) => results[i].status === 'fulfilled').map((s) => s.id));
  return { sent, failed: results.length - sent };
}

async function allSubs(): Promise<Sub[]> {
  const { data, error } = await admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth');
  if (error) throw error;
  return data as Sub[];
}

async function runCron() {
  const s = await settings();
  if (!s.enabled) return { enabled: false };
  const due = dueShifts(Date.now(), s);
  if (!due.length) return { due: 0 };
  const subs = await allSubs();
  if (!subs.length) return { due: due.length, phones: 0 };
  const out = [];
  for (const d of due) {
    // claim the shift first so an overlapping run cannot alert twice
    const claim = await admin.from('shift_alert_log').upsert({ shift_date: d.date, shift: d.shift }, { onConflict: 'shift_date,shift', ignoreDuplicates: true }).select();
    if (claim.error) throw claim.error;
    if (!claim.data?.length) { out.push({ ...d, skipped: 'already sent' }); continue; }
    const f = await factsFor(d);
    const r = await send(subs, alertText(f));
    await admin.from('shift_alert_log').update({ crew: f.crew, sent: r.sent, failed: r.failed }).eq('shift_date', d.date).eq('shift', d.shift);
    out.push({ ...d, crew: f.crew, ...r });
  }
  return { due: due.length, phones: subs.length, out };
}

async function staffUser(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: p } = await admin.from('user_profiles').select('role_code,is_active').eq('auth_user_id', data.user.id).maybeSingle();
  return p?.is_active && ['section_head', 'manpower_coordinator'].includes(p.role_code) ? data.user.id : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const cfg = await config();
    const secret = req.headers.get('x-cron-secret');
    if (secret) {
      if (secret !== cfg.cron_secret) return reply(401, { error: 'Not allowed.' });
      const b = await req.json().catch(() => ({})) as { action?: string; at?: string };
      if (b.action !== 'preview') return reply(200, await runCron());
      // what the alert for the next shift after `at` (default now) would say; nothing is sent
      const next = nextShift(b.at ? Date.parse(b.at) : Date.now(), await settings());
      return reply(200, next ? { next, alert: alertText(await factsFor(next)) } : { error: 'No shift found.' });
    }
    const user = await staffUser(req);
    if (!user) return reply(401, { error: 'Sign in as the Section Head or the Manpower Coordinator.' });
    const body = await req.json().catch(() => ({})) as { action?: string };
    const next = nextShift(Date.now(), await settings());
    if (!next) return reply(200, { error: 'No shift found.' });
    if (body.action === 'preview') return reply(200, { next, alert: alertText(await factsFor(next)) });
    if (body.action === 'test') {
      const mine = (await allSubs()).filter((s) => s.user_id === user);
      if (!mine.length) return reply(200, { error: 'This phone is not subscribed yet.' });
      return reply(200, { next, ...(await send(mine, alertText(await factsFor(next, true)))) });
    }
    return reply(400, { error: 'Unknown action.' });
  } catch (e) {
    console.error(e);
    return reply(500, { error: String((e as Error).message ?? e) });
  }
});
