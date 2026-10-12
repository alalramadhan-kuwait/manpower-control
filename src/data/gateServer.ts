// The server side of the request check (bundled into the request-gate edge function; the supabase client there is the
// service-key client). Reads a request back from the database and checks it with the same engine as the app.
import { supabase } from './supabase';
import { checkProposal, checkRecord, type Check } from './validation';
import { gateDates, gateProposal, gateVerdict, isFactual, type GateRequest, type GateType, type GateVerdict } from '@/core/requests/gate';

type Row = Record<string, unknown>;
const one = (x: unknown): Row | null => (Array.isArray(x) ? (x[0] as Row) ?? null : (x as Row) ?? null);

/** The leave type's short code, label and entry mode. */
export async function typeInfo(code: unknown): Promise<{ typeShort: string | null; typeLabel: string | null; entryMode: string | null }> {
  if (typeof code !== 'string' || !code) return { typeShort: null, typeLabel: null, entryMode: null };
  const { data } = await supabase.from('absence_types').select('short_code,label,entry_mode').eq('code', code).maybeSingle();
  const t = data as { short_code: string; label: string; entry_mode: string } | null;
  return { typeShort: t?.short_code ?? null, typeLabel: t?.label ?? null, entryMode: t?.entry_mode ?? null };
}

/** A waiting request as the check sees it, with the dates it is bound to (the header's). */
export async function requestFromHeader(id: string): Promise<{ req: GateRequest; start: string; end: string | null } | null> {
  const { data, error } = await supabase.from('request_headers').select('*, request_leave(*), request_shift(*), request_assignment(*)').eq('id', id).maybeSingle();
  if (error) throw error;
  const h = data as Row | null;
  if (!h) return null;
  const type = h.type as GateType;
  let detail: Row = {};
  if (h.legacy_table === 'leave_change_requests') {
    const { data: c } = await supabase.from('leave_change_requests').select('record_ids,new_start,new_end').eq('id', h.legacy_id as string).single();
    const cr = c as { record_ids: string[]; new_start: string; new_end: string };
    detail = { start_date: cr.new_start, end_date: cr.new_end, replaces_record_ids: cr.record_ids };
  } else if (h.legacy_table === 'leave_requests') {
    const { data: f } = await supabase.from('leave_requests').select('start_date,end_date,request_type').eq('id', h.legacy_id as string).single();
    const lf = f as { start_date: string; end_date: string; request_type: string };
    detail = { start_date: lf.start_date, end_date: lf.end_date, absence_type_code: lf.request_type === 'unpaid' ? 'unpaid_leave' : lf.request_type === 'unscheduled' ? 'annual_leave_unscheduled' : 'annual_leave_planned' };
  } else {
    detail = { ...(one(h.request_leave) ?? one(h.request_shift) ?? one(h.request_assignment) ?? {}) };
    if (type === 'shift_change' && detail.kind === 'day_duty') detail.to_crew = 'DAY';
    if (detail.action === 'extend' && detail.target_record_id) {
      const { data: t } = await supabase.from('leave_records').select('end_date').eq('id', detail.target_record_id as string).maybeSingle();
      detail.old_end = (t as { end_date: string | null } | null)?.end_date ?? null;
    }
  }
  const info = await typeInfo(detail.absence_type_code);
  return { req: { type, employeeId: h.employee_id as string, detail, ...info }, start: h.start_date as string, end: (h.end_date as string) ?? null };
}

const EMPTY_CHECK = (): Check => ({ findings: [], existing: [], worst: null, timeline: [], ranAt: new Date().toISOString(), proposal: null as never } as unknown as Check);

export interface ServerCheck { check: Check; verdict: GateVerdict; factual: boolean; dates: { start: string; end: string | null } }

/** The check of one request, as recorded with it. */
export async function serverCheck(req: GateRequest): Promise<ServerCheck> {
  const pr = gateProposal(req);
  const check = pr ? await checkProposal(pr) : EMPTY_CHECK();
  const factual = isFactual(req);
  return { check, verdict: gateVerdict(check.findings, factual), factual, dates: gateDates(req.detail) };
}

export const recordOf = (c: Check) => (c.proposal ? checkRecord(c) : { ranAt: c.ranAt, findings: [], existing: [] });
