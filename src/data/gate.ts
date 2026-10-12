// The app's side of the server check: every routine change and every decision is sent to the request-gate edge
// function, which checks it on the server and then makes it as the signed-in user (see supabase/functions/request-gate).
import { supabase } from './supabase';
import { dataChanged } from './changes';
import type { Check } from './validation';
import type { GateType, GateVerdict } from '@/core/requests/gate';

export interface GateResult { id: string; status: 'submitted' | 'approved' | 'recorded' | 'not_approved'; result?: string | null }
/** The server refused the change (hard stop, or a crew below its minimum); the check says why. */
export class GateBlocked extends Error {
  constructor(message: string, public check: Check | null, public verdict: GateVerdict | null) { super(message); }
}

async function call<T>(body: Record<string, unknown>): Promise<T & { check?: Check; verdict?: GateVerdict }> {
  const { data, error } = await supabase.functions.invoke('request-gate', { body });
  if (error) {
    // a 4xx / 5xx carries the message in its body
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  const d = data as { blocked?: boolean; reason?: string; error?: string; check?: Check; verdict?: GateVerdict } & T;
  if (d.error) throw new Error(d.error);
  if (d.blocked) throw new GateBlocked(d.reason ?? 'Not allowed.', d.check ?? null, d.verdict ?? null);
  return d;
}
const changed = () => { dataChanged(); window.dispatchEvent(new Event('requests-changed')); };

export interface SubmitInput { type: GateType; employeeId: string; summary: string; remarks?: string | null; detail: Record<string, unknown>; workflow?: 'approval' | 'record' | 'record_notify' | null }

/** Record (Section Head, or a type recorded without approval) or send for approval (Coordinator). Checked on the server first. */
export async function gateSubmit(v: SubmitInput): Promise<GateResult & { check?: Check }> {
  const start = String(v.detail.start_date);
  const r = await call<{ result: GateResult }>({ action: 'submit', type: v.type, employeeId: v.employeeId, planYear: Number(start.slice(0, 4)), summary: v.summary,
    remarks: v.remarks ?? null, detail: v.detail, workflow: v.workflow ?? null });
  changed();
  return { ...r.result, check: r.check };
}

/** The server's check of a change before it is sent (what the button will do). */
export async function gateCheck(v: SubmitInput): Promise<{ check: Check; verdict: GateVerdict; factual: boolean }> {
  const start = String(v.detail.start_date);
  return call<{ check: Check; verdict: GateVerdict; factual: boolean }>({ action: 'check', type: v.type, employeeId: v.employeeId, planYear: Number(start.slice(0, 4)),
    summary: v.summary, detail: v.detail }) as Promise<{ check: Check; verdict: GateVerdict; factual: boolean }>;
}

/** The Section Head's decision on a waiting request (approval is checked again on the server, at that moment). */
export async function gateDecide(headerId: string, approve: boolean, note: string, accepted: { rule: string; severity: string; message: string }[] = []): Promise<GateResult> {
  const r = await call<{ result: GateResult }>({ action: 'decide', id: headerId, approve, note, accepted });
  changed();
  return r.result;
}

/** The request header of a legacy leave form or reschedule request. */
export async function headerOfLegacy(table: 'leave_requests' | 'leave_change_requests', id: string): Promise<string> {
  const { data, error } = await supabase.from('request_headers').select('id').eq('legacy_table', table).eq('legacy_id', id).single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
