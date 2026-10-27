// Step 2 · Review & approve manpower: one table of the four shifts, the blocking issues (approval impossible until
// they are fixed) and the warnings to review. The Section Head approves on the server's own check; approval freezes
// the allocation (and the sick figures it used) and unlocks the forms. Reopening makes the next version.
import { useState } from 'react';
import { CREWS } from '@/core/roster';
import { RELIEF_LABEL, type AllocEval, type ReliefKind } from '@/core/vacation';
import { VAC_RULES } from '@/core/vacation/rules';
import { reopenAllocation, vacationGate, type GateResult, type VacationData } from '@/data/vacation';
import { Button, ErrorBox, cx } from '@/ui/components';
import { CREW_IDENTITY } from '@/ui/crew';
import { StatusChip, levelOf, stamp } from './parts';

export function ApproveManpowerStep({ d, ev, isHead, canEdit, onChanged, toast, goFix }: { d: VacationData; ev: AllocEval; isHead: boolean; canEdit: boolean; onChanged: () => Promise<void>; toast: (m: string) => void; goFix: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [server, setServer] = useState<GateResult | null>(null);
  const [reopen, setReopen] = useState<string | null>(null);
  const errors = ev.issues.filter((i) => i.level === 'error'), warnings = ev.issues.filter((i) => i.level === 'warning');
  const approved = d.alloc?.status === 'approved';
  const sickKnown = d.people.filter((p) => p.sick).length;
  async function run(action: 'check_alloc' | 'approve_alloc') {
    setBusy(true); setErr(null); setServer(null);
    try {
      const r = await vacationGate(action, d.year);
      setServer(r);
      if (action === 'approve_alloc' && r.ok) { toast(`Manpower allocation ${d.year} approved.`); await onChanged(); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const reliefCount = (k: ReliefKind) => ev.relief.filter((x) => x.row.relief === k).length;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-[13px] tabular-nums">
          <thead><tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <th className="px-3 py-1.5">Shift</th><th className="px-2">Ctl</th><th className="px-2">Panel</th><th className="px-2">Field</th><th className="px-2">Slots P/F</th><th className="px-3 text-right">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {CREWS.map((c) => { const x = ev.crews[c]; const lv = levelOf(ev.issues.filter((i) => i.crew === c));
              return (
                <tr key={c}>
                  <td className="px-3 py-1.5"><span className={cx('inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white', CREW_IDENTITY[c].bg)}>{c}</span></td>
                  <td className={cx('px-2', x.controllers.length !== 1 && 'font-bold text-red-700')}>{x.controllers.length}</td>
                  <td className={cx('px-2', x.panelGroup < VAC_RULES.panelGroup && 'font-bold text-red-700')}>{x.panelGroup}{x.acting.length ? <span className="text-[11px] text-slate-500"> ({x.acting.length} act.)</span> : null}</td>
                  <td className={cx('px-2', x.fieldEligible.length < 7 && 'font-bold text-red-700')}>{x.fieldEligible.length}</td>
                  <td className="px-2">{x.panelSlots} / {x.fieldSlots}</td>
                  <td className="px-3 text-right"><StatusChip level={lv} label={lv === 'ok' ? 'OK' : undefined} /></td>
                </tr>
              ); })}
          </tbody>
        </table>
        <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-600">Relief: {(['vr', 'day_supervisor', 'float_panel', 'day_duty'] as ReliefKind[]).map((k) => `${RELIEF_LABEL[k]} ${reliefCount(k)}`).join(' · ')} · Left out {ev.excluded.length} · Sick figures known {sickKnown}</p>
      </div>

      {errors.length > 0 && (
        <section className="rounded-2xl bg-white ring-1 ring-red-200">
          <p className="flex items-center gap-2 px-3 pt-2 text-[13px] font-semibold text-red-800"><StatusChip level="error" label={`${errors.length} blocking`} />Fix before approval</p>
          <ul className="space-y-0.5 px-3 py-2 text-xs text-red-900">{errors.map((i) => <li key={i.code + i.text}>⛔ {i.text}</li>)}</ul>
          {canEdit && !approved && <button type="button" onClick={goFix} className="px-3 pb-2 text-xs font-semibold text-brand-700">Fix in Manpower setup ›</button>}
        </section>
      )}
      {warnings.length > 0 && (
        <details className="rounded-2xl bg-white ring-1 ring-amber-200" open={!errors.length}>
          <summary className="flex min-h-10 cursor-pointer items-center gap-2 px-3 text-[13px] font-semibold text-amber-900"><StatusChip level="warning" label={`${warnings.length} to review`} />Warnings (approval allowed)</summary>
          <ul className="space-y-0.5 px-3 pb-2 text-xs text-amber-950">{warnings.map((i) => <li key={i.code + i.text + (i.employeeId ?? '')}>⚠ {i.text}</li>)}</ul>
        </details>
      )}
      {!errors.length && !warnings.length && <p className="rounded-xl bg-green-50 px-3 py-2 text-[13px] font-semibold text-green-800">✓ Every shift meets the rules.</p>}

      {err != null && <ErrorBox error={err} />}
      {server && !server.ok && <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-900"><b>Server check: not approved.</b> {server.issues.filter((i) => i.level === 'error').slice(0, 5).map((i) => i.text).join(' ')}</div>}
      {server?.ok && !approved && <p className="rounded-xl bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">Server check passed.</p>}

      {approved ? (
        <div className="space-y-2 rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <p className="text-[13px]"><StatusChip level="ok" label="Approved" /> <b>Version {d.alloc!.version}</b> · {d.alloc!.approvedBy ?? 'Section Head'} · {d.alloc!.approvedAt ? stamp(d.alloc!.approvedAt) : ''}</p>
          <p className="text-[11px] text-slate-500">Locked: forms and vacations use this version. Sick figures frozen at approval: {d.alloc!.snapshot?.rows.filter((r) => r.sick !== null).length ?? 0}.</p>
          {isHead && d.plan?.status !== 'published' && (reopen === null
            ? <button type="button" onClick={() => setReopen('')} className="text-xs font-semibold text-brand-700">Reopen for changes…</button>
            : <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
                <label htmlFor="reopen" className="block text-xs font-medium text-slate-700">Why reopen? Vacations already entered stay and are checked again against the new version; forms already printed show the old version.</label>
                <textarea id="reopen" rows={2} className="input py-1.5 text-sm" value={reopen} onChange={(e) => setReopen(e.target.value)} />
                <div className="flex gap-1.5"><Button variant="secondary" className="min-h-9 flex-1" onClick={() => setReopen(null)}>Keep approved</Button>
                  <Button className="min-h-9 flex-1" disabled={busy || !reopen.trim()} onClick={async () => { setBusy(true); setErr(null); try { await reopenAllocation(d.year, reopen); setReopen(null); toast('Reopened as a new draft version.'); await onChanged(); } catch (e) { setErr(e); } finally { setBusy(false); } }}>Reopen</Button></div>
              </div>)}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {isHead ? <Button className="min-h-11 flex-1" disabled={busy || !d.alloc || errors.length > 0} onClick={() => run('approve_alloc')}>{busy ? 'Checking on the server…' : 'Approve Manpower Allocation'}</Button>
            : <p className="flex-1 text-xs text-slate-600">The Section Head approves the allocation.</p>}
          <Button variant="secondary" className="min-h-11" disabled={busy || !d.alloc} onClick={() => run('check_alloc')}>Check on server</Button>
          {!d.alloc && <p className="w-full text-xs text-slate-500">Make the first change in Manpower setup to save a draft.</p>}
        </div>
      )}
    </div>
  );
}
