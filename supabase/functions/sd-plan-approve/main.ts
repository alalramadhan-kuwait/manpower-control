// Area 4 Manpower Control: approval of a shutdown plan under the v2 rules. The browser's own check is never trusted: this
// function loads the plan and everything around it from the database (service key), runs the same check as the app
// (src/core/shutdown/v2), and records the approval only when the plan is Ready AND the data is exactly what the Section
// Head was looking at (the fingerprint he sends). Only the Section Head may call it. The database refuses an approval
// written any other way, and any later change to the plan sends it back to draft.
// This file is bundled with the app's engine into index.ts by scripts/build-shift-alerts.mjs (a test keeps them in step).
import { checkPlan, isV2 } from '../../../src/core/shutdown/v2';
import { loadPlanCheckInput } from '../../../src/data/sdCheck';
import { supabase as admin } from './supabase-shim';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
/** Today in Kuwait (UTC+3). */
const kuwaitToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who.user) return reply(401, { error: 'Sign in again.' });
    const { data: me } = await admin.from('user_profiles').select('role_code,is_active').eq('auth_user_id', who.user.id).maybeSingle();
    if (!me || !me.is_active || me.role_code !== 'section_head') return reply(403, { error: 'Only the Section Head approves a shutdown plan.' });

    const body = await req.json().catch(() => ({})) as { planId?: string; fingerprint?: string };
    if (!body.planId) return reply(400, { error: 'Which plan?' });
    const input = await loadPlanCheckInput(body.planId, kuwaitToday());
    if (!isV2(input.plan)) return reply(400, { error: 'This plan follows the earlier rules: it has no approval step.' });
    const check = checkPlan(input);
    if (check.status !== 'ready') return reply(200, { approved: false, check, reason: check.status === 'verify' ? 'Some figures still need to be entered or verified.' : 'The plan is not operationally ready.' });
    if (body.fingerprint && body.fingerprint !== check.fingerprint) return reply(200, { approved: false, check, reason: 'The plan changed since you checked it. Review the new check, then approve.' });
    const { error } = await admin.from('sd_plans').update({ approval_status: 'approved', approved_by: who.user.id, approved_at: new Date().toISOString(), approval_fingerprint: check.fingerprint, approval_check: check })
      .eq('id', body.planId).eq('rules_version', 2);
    if (error) throw error;
    return reply(200, { approved: true, check });
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : 'Could not check the plan.' });
  }
});
