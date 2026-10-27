// Area 4 Manpower Control: annual vacation planning approvals. The app's own check is never trusted: this function
// loads the plan with the service key, checks it with the same code as the workspace (src/core/vacation through
// src/data/vacationServer), records the check (pv_server_checks, which only this function writes) on the database
// fingerprint read BEFORE loading, and then approves AS THE SIGNED-IN USER, so the database applies their role
// (Section Head only) and refuses the check if anything changed meanwhile (the fingerprint no longer matches).
// Bundled with the app's code into index.ts by scripts/build-shift-alerts.mjs (a test keeps them in step).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { checkAllocation, checkVacationPlan } from '../../../src/data/vacationServer';
import { supabase as admin } from './supabase-shim';
import { loadAppRules } from '../../../src/data/rules';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
type Action = 'check_alloc' | 'approve_alloc' | 'check_plan' | 'approve_plan';

Deno.serve(async (req) => {
  // the organization rules as they stand now (Rules page), before anything is computed
  if (req.method !== 'OPTIONS') await loadAppRules();
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who.user) return reply(401, { error: 'Sign in again.' });
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false }
    });
    const [{ data: staff }, { data: head }] = await Promise.all([asUser.rpc('app_is_staff'), asUser.rpc('app_is_section_head')]);
    if (!staff) return reply(403, { error: 'Only the manpower staff can use the vacation plan.' });
    const body = await req.json().catch(() => ({})) as { action?: Action; year?: number };
    const year = Number(body.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return reply(400, { error: 'Which year?' });
    const kind = body.action === 'check_alloc' || body.action === 'approve_alloc' ? 'alloc' : body.action === 'check_plan' || body.action === 'approve_plan' ? 'plan' : null;
    if (!kind) return reply(400, { error: 'Unknown action.' });
    const approve = body.action!.startsWith('approve');
    if (approve && !head) return reply(403, { error: kind === 'alloc' ? 'Only the Section Head approves the manpower allocation.' : 'Only the Section Head approves the vacation plan.' });

    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: fp, error: fpErr } = await admin.rpc(kind === 'alloc' ? 'pv_alloc_fingerprint' : 'pv_plan_fingerprint', { p_year: year });
      if (fpErr) throw fpErr;
      const sc = kind === 'alloc' ? await checkAllocation(year) : await checkVacationPlan(year);
      if (!approve) return reply(200, { ok: sc.ok, issues: sc.issues });
      const { data: row, error: insErr } = await admin.from('pv_server_checks').insert({ kind, year, fingerprint: fp as string, ok: sc.ok, created_for: who.user.id,
        result: { reason: sc.reason, snapshot: sc.snapshot ?? null, issues: sc.issues.slice(0, 200) } }).select('id').single();
      if (insErr) throw insErr;
      if (!sc.ok) return reply(200, { ok: false, issues: sc.issues });
      const { data, error } = await asUser.rpc(kind === 'alloc' ? 'pv_alloc_approve_checked' : 'pv_plan_approve_checked', { p_check: (row as { id: string }).id });
      if (error && /STALE_CHECK/.test(error.message) && attempt < 2) continue;
      if (error) return reply(400, { error: error.message.replace(/^STALE_CHECK:\s*/, ''), ok: false, issues: sc.issues });
      return reply(200, { ok: true, issues: sc.issues, result: data });
    }
    return reply(409, { error: 'The plan kept changing during the check. Try again.' });
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
