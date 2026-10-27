// Area 4 Manpower Control: every routine change (Requests → Entry) and every Section Head decision goes through here.
// The app's own check is never trusted: this function reads the plan with the service key, checks the change with the
// same engine as the app (src/core/validation, src/core/requests/gate), records the check (server_checks, which only
// this function can write) on the current manpower version, and then makes the change AS THE SIGNED-IN USER (their
// token), so the database still applies their role: the Coordinator's requests wait for the Section Head, the Section
// Head's own entries are recorded directly, never self-approved. The database takes the version row lock and refuses
// the check if anything changed meanwhile (another approval at the same moment): the check is then run again.
// This file is bundled with the app's engine into index.ts by scripts/build-shift-alerts.mjs (a test keeps them in step).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requestFromHeader, serverCheck, typeInfo, recordOf } from '../../../src/data/gateServer';
import type { GateRequest, GateType } from '../../../src/core/requests/gate';
import { supabase as admin } from './supabase-shim';
import { loadAppRules } from '../../../src/data/rules';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const TYPES: GateType[] = ['pv_reschedule', 'unscheduled_pv', 'personal_pc', 'absence', 'shift_change', 'vr_placement', 'controller_cover', 'task_release'];

interface SubmitBody { action: 'submit' | 'check'; type: GateType; employeeId: string; planYear: number; summary: string; remarks?: string | null; detail: Record<string, unknown>; workflow?: string | null }
interface DecideBody { action: 'decide'; id: string; approve: boolean; note?: string; accepted?: unknown[] }

Deno.serve(async (req) => {
  // the organization rules as they stand now (Rules page), before anything is computed
  if (req.method !== 'OPTIONS') await loadAppRules();
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who.user) return reply(401, { error: 'Sign in again.' });
    const { data: me } = await admin.from('user_profiles').select('role_code,is_active').eq('auth_user_id', who.user.id).maybeSingle();
    if (!me || !me.is_active || !['section_head', 'manpower_coordinator'].includes(me.role_code)) return reply(403, { error: 'Only the Section Head or the Manpower Coordinator makes changes.' });
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false }
    });
    const body = await req.json().catch(() => ({})) as SubmitBody | DecideBody;

    if (body.action === 'decide' && !body.approve) {
      const { data, error } = await asUser.rpc('request_header_decide_checked', { p_server_check: null, p_id: body.id, p_approve: false, p_note: body.note ?? '', p_accepted: [] });
      if (error) return reply(400, { error: error.message });
      return reply(200, { result: data });
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: ver } = await admin.from('manpower_version').select('v').eq('id', 1).single();
      const stamp = (ver as { v: number }).v;
      let gr: GateRequest; let start: string; let end: string | null; let requestId: string | null = null;
      if (body.action === 'decide') {
        const r = await requestFromHeader(body.id);
        if (!r) return reply(404, { error: 'Request not found.' });
        gr = r.req; start = r.start; end = r.end; requestId = body.id;
      } else {
        if (!TYPES.includes(body.type)) return reply(400, { error: 'This change is not made here.' });
        const detail = { ...body.detail };
        if (detail.action === 'extend' && detail.target_record_id && !('old_end' in detail)) {
          const { data: t } = await admin.from('leave_records').select('end_date').eq('id', detail.target_record_id as string).maybeSingle();
          detail.old_end = (t as { end_date: string | null } | null)?.end_date ?? null;
        }
        gr = { type: body.type, employeeId: body.employeeId, detail, ...(await typeInfo(detail.absence_type_code)) };
        const ret = typeof detail.return_date === 'string' ? detail.return_date : null;
        start = detail.start_date as string;
        end = (detail.end_date as string | null | undefined) ?? (ret ? new Date(Date.parse(ret) - 86400000).toISOString().slice(0, 10) : null);
      }
      const sc = await serverCheck(gr);
      if (body.action === 'check') return reply(200, { check: sc.check, verdict: sc.verdict, factual: sc.factual });
      const { data: row, error: insErr } = await admin.from('server_checks').insert({
        created_for: who.user.id, stamp, request_id: requestId, employee_id: gr.employeeId, type: gr.type, start_date: start, end_date: end,
        allowed: sc.verdict.allowed, factual: sc.factual, reason: sc.verdict.reason, check_body: recordOf(sc.check)
      }).select('id').single();
      if (insErr) throw insErr;
      if (!sc.verdict.allowed) return reply(200, { blocked: true, reason: sc.verdict.reason, check: sc.check, verdict: sc.verdict });
      const id = (row as { id: string }).id;
      const { data, error } = body.action === 'decide'
        ? await asUser.rpc('request_header_decide_checked', { p_server_check: id, p_id: body.id, p_approve: true, p_note: body.note ?? '', p_accepted: body.accepted ?? [] })
        : await asUser.rpc('request_header_submit_checked', { p_server_check: id, p_type: gr.type, p_employee: gr.employeeId, p_plan_year: body.planYear,
            p_summary: body.summary, p_remarks: body.remarks ?? null, p_detail: body.detail, p_workflow: body.workflow ?? null });
      if (error && /STALE_CHECK/.test(error.message)) continue;
      if (error) return reply(400, { error: error.message, check: sc.check, verdict: sc.verdict });
      return reply(200, { result: data, check: sc.check, verdict: sc.verdict, factual: sc.factual });
    }
    return reply(409, { error: 'The plan kept changing while this was checked. Try again in a moment.' });
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : 'Could not check the change.' });
  }
});
