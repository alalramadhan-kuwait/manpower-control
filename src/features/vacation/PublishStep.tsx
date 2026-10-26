// Step 6 · Approve & publish: one action for the Section Head. The server checks the whole plan again with the same
// rules (manpower version, every vacation, other leave, crews' minimums) and, only if nothing blocks, approves and
// writes the vacations to the leave records in one transaction (the Calendar shows them at once). Running it twice
// never creates a second copy. Oracle applications stay separate: nothing is marked in Oracle.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { returnPlan, vacationGate, type GateResult } from '@/data/vacation';
import { Button, ErrorBox } from '@/ui/components';
import { stamp, StatusChip } from './parts';
import type { StepProps } from './VacationPlanPage';

export default function PublishStep({ d, isHead, canEdit, toast, refreshPlan, check, go }: StepProps) {
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null);
  const [server, setServer] = useState<GateResult | null>(null);
  const [ret, setRet] = useState<string | null>(null);
  const published = d.plan?.status === 'published';
  const finalErrors = check ? check.issues.filter((i) => i.level === 'error' || i.code === 'missing') : [];
  async function run(action: 'check_plan' | 'approve_plan') {
    setBusy(action === 'approve_plan' ? 'Checking the whole plan on the server and publishing…' : 'Checking on the server…'); setErr(null); setServer(null);
    try {
      const r = await vacationGate(action, d.year);
      setServer(r);
      if (action === 'approve_plan' && r.ok) { toast(`Vacation Plan ${d.year} approved: ${r.result} vacations are in the Calendar.`); await refreshPlan(); go(7); }
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }
  if (published) return (
    <div className="space-y-2 rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
      <p className="text-[13px]"><StatusChip level="ok" label="Published" /> Vacation Plan {d.year} v{d.plan!.version} · {d.plan!.publishedAt ? stamp(d.plan!.publishedAt) : ''}</p>
      <p className="text-xs text-slate-600">The vacations are leave records of the {d.year} plan: change, move or cancel them in the Calendar with the usual leave workflow. Oracle applications are separate and not marked.</p>
      <div className="flex gap-2"><Link to={`/calendar?view=list&month=${d.year}-01`} className="inline-flex min-h-10 items-center rounded-xl bg-brand-700 px-3 text-sm font-semibold text-white">Open the Calendar ›</Link>
        <Button variant="secondary" className="min-h-10" onClick={() => go(7)}>Share the plan</Button></div>
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="rounded-2xl bg-white px-3 py-2 text-[13px] ring-1 ring-slate-200">
        <p><b>{check?.summary.people ?? 0}</b> people · <b>{check?.summary.periods ?? 0}</b> vacation periods · <b>{check?.summary.system ?? 0}</b> system assigned · manpower v{d.alloc?.version}</p>
        <p className="mt-1">{finalErrors.length ? <StatusChip level="error" label={`${finalErrors.length} blocking`} /> : <StatusChip level="ok" label="No blocking issue in this browser's check" />}</p>
        {finalErrors.length > 0 && <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs text-red-900">{finalErrors.slice(0, 60).map((i, k) => <li key={k}>⛔ {i.text}</li>)}</ul>}
        {finalErrors.length > 0 && <button type="button" onClick={() => go(5)} className="mt-1 text-xs font-semibold text-brand-700">Fix in the review ›</button>}
      </div>
      {d.plan?.status === 'submitted' && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">Waiting for the Section Head{d.plan.note ? `: "${d.plan.note}"` : ''}.</p>}
      {busy && <p className="text-xs text-slate-600">{busy}</p>}
      {err != null && <ErrorBox error={err} />}
      {server && !server.ok && <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-900"><b>Server check: not approved.</b><ul className="mt-1 space-y-0.5">{server.issues.filter((i) => i.level === 'error').slice(0, 20).map((i, k) => <li key={k}>⛔ {i.text}</li>)}</ul></div>}
      {server?.ok && <p className="rounded-xl bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">Server check passed.</p>}
      <div className="flex flex-wrap gap-2">
        {isHead ? <Button className="min-h-11 flex-1 sm:max-w-sm" disabled={!!busy || finalErrors.length > 0 || !d.blocks.length} onClick={() => run('approve_plan')}>Approve {d.year} Vacation Plan</Button>
          : <p className="flex-1 text-xs text-slate-600">Only the Section Head approves the plan.</p>}
        {canEdit && <Button variant="secondary" className="min-h-11" disabled={!!busy || !d.blocks.length} onClick={() => run('check_plan')}>Check on server</Button>}
      </div>
      {isHead && d.plan?.status === 'submitted' && (ret === null ? <button type="button" onClick={() => setRet('')} className="text-xs font-semibold text-brand-700">Return for changes…</button> : (
        <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
          <label htmlFor="ret" className="block text-xs font-medium text-slate-700">What should change?</label>
          <textarea id="ret" rows={2} className="input py-1.5 text-sm" value={ret} onChange={(e) => setRet(e.target.value)} />
          <div className="flex gap-1.5"><Button variant="secondary" className="min-h-9 flex-1" onClick={() => setRet(null)}>Keep</Button>
            <Button className="min-h-9 flex-1" disabled={!!busy || !ret.trim()} onClick={async () => { setBusy('Returning…'); try { await returnPlan(d.year, ret); setRet(null); await refreshPlan(); toast('Returned to the draft.'); } catch (e) { setErr(e); } finally { setBusy(null); } }}>Return</Button></div>
        </div>))}
      <p className="text-[11px] text-slate-500">Approval publishes the plan to the Calendar in the same step (no separate publish). Plan approval is not an Oracle approval: Oracle applications are made and followed separately.</p>
    </div>
  );
}
