// The server side of the vacation plan approvals (bundled into the vacation-plan edge function, where `supabase` is the
// service-key client): the same loader and the same checks as the workspace, so what the Section Head saw is what is
// recorded. Pure of HTTP; main.ts does the authentication and calls the database as the signed-in user.
import { checkPlan, evaluateAllocation } from '@/core/vacation';
import { loadVacation, planCtx, rowsOf, snapshotOf, type AllocSnapshot } from './vacation';

export interface ServerCheck { ok: boolean; issues: { level: 'error' | 'warning'; text: string }[]; reason: string | null; snapshot?: AllocSnapshot }

/** The manpower allocation of the year, as it is now: errors block the approval. */
export async function checkAllocation(year: number): Promise<ServerCheck> {
  const d = await loadVacation(year);
  if (!d.alloc) return { ok: false, issues: [{ level: 'error', text: `No ${year} manpower allocation yet.` }], reason: 'No allocation' };
  const ev = evaluateAllocation(d.people, rowsOf(d));
  const errors = ev.issues.filter((i) => i.level === 'error');
  return { ok: errors.length === 0, issues: ev.issues.map((i) => ({ level: i.level, text: i.text })), reason: errors.length ? errors.slice(0, 3).map((i) => i.text).join(' ') : null, snapshot: snapshotOf(d, ev) };
}

/** The whole vacation plan, final rules (fewer than four periods blocks too). */
export async function checkVacationPlan(year: number): Promise<ServerCheck> {
  const d = await loadVacation(year);
  if (!d.alloc || d.alloc.status !== 'approved') return { ok: false, issues: [{ level: 'error', text: 'Approve the manpower allocation first.' }], reason: 'Allocation not approved' };
  if (!d.blocks.length) return { ok: false, issues: [{ level: 'error', text: 'No vacation entered yet.' }], reason: 'Empty plan' };
  const r = checkPlan(planCtx(d), { final: true });
  const errors = r.issues.filter((i) => i.level === 'error');
  return { ok: errors.length === 0, issues: r.issues.map((i) => ({ level: i.level, text: i.text })), reason: errors.length ? `${errors.length} blocking: ${errors.slice(0, 3).map((i) => i.text).join(' ')}` : null };
}
