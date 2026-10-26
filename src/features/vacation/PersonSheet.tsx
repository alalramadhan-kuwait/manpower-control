// One person in the plan: facts first, then the actions their qualifications allow. Every action saves at once
// (Undo in the toast). Removing someone only leaves them out of this plan; the directory is never touched.
import { useState } from 'react';
import { ACTING_PANEL } from '@/core/manpower';
import { CREWS, type Crew } from '@/core/roster';
import { GROUP_LABEL, RELIEF_LABEL, type ActingChoice, type AllocEval, type AllocIssue, type AllocRow, type PlanGroup, type PlanPerson, type ReliefKind } from '@/core/vacation';
import { rowsOf, startAllocation, switchAllocation, undoAllocation, type VacationData } from '@/data/vacation';
import { BottomSheet, ErrorBox, cx } from '@/ui/components';
import { POS_SHORT } from './ManpowerStep';
import { StatusChip, dm } from './parts';

const isCtl = (p: PlanPerson) => ['controller', 'vr_controller', 'morning_controller'].includes(p.position ?? '') || (p.grade ?? 0) >= 15;
const chip = (on: boolean) => cx('min-h-9 rounded-lg px-3 text-sm font-semibold ring-1 disabled:opacity-40', on ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200');

export function PersonSheet({ d, ev, person: p, row, issues, editable, busy, onClose, onSave, onChanged, toast }: {
  d: VacationData; ev: AllocEval; person: PlanPerson; row: AllocRow | null; issues: AllocIssue[]; editable: boolean; busy: boolean;
  onClose: () => void; onSave: (r: AllocRow, msg: string) => Promise<void>; onChanged: () => Promise<void>; toast: (m: string, undo?: () => void) => void;
}) {
  const [mode, setMode] = useState<null | 'switch' | 'remove'>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const r: AllocRow = row ?? { employeeId: p.id, group: 'excluded', crew: null, relief: null, cycleCrew: null, acting: 'auto', note: null };
  const acting = ev.placed.get(p.id)?.acting ?? false;
  const cand = r.crew ? ev.crews[r.crew].candidates.find((c) => c.person.id === p.id) : undefined;
  const set = async (patch: Partial<AllocRow>, msg: string) => { await onSave({ ...r, ...patch }, msg); onClose(); };
  const groups: { g: PlanGroup; ok: boolean }[] = [
    { g: 'controller', ok: isCtl(p) }, { g: 'panel', ok: p.position === 'panel_operator' }, { g: 'field', ok: p.position === 'field_operator' }];
  const reliefs: { k: ReliefKind; ok: boolean }[] = [
    { k: 'vr', ok: isCtl(p) }, { k: 'day_supervisor', ok: isCtl(p) }, { k: 'float_panel', ok: p.position === 'panel_operator' && p.panelQualified === 'yes' },
    { k: 'day_duty', ok: p.position === 'panel_operator' || p.position === 'field_operator' }];
  const peers = rowsOf(d).filter((x) => x.employeeId !== p.id && x.group === r.group && x.group !== 'excluded' && (x.crew !== r.crew || x.relief !== r.relief))
    .map((x) => ({ x, q: d.people.find((y) => y.id === x.employeeId)! })).filter((y) => y.q).sort((a, b) => (a.x.crew ?? 'Z').localeCompare(b.x.crew ?? 'Z') || a.q.name.localeCompare(b.q.name));

  async function doSwitch(other: string, name: string) {
    setErr(null);
    try {
      if (!d.alloc) await startAllocation(d.year, d.initial);
      const ev = await switchAllocation(d.year, p.id, other);
      await onChanged(); onClose();
      toast(`${p.name} and ${name} switched.`, async () => { await undoAllocation(d.year, ev); await onChanged(); toast('Undone.'); });
    } catch (e) { setErr(e); }
  }
  const where = r.group === 'excluded' ? 'Left out of the plan' : r.group === 'relief' ? `${RELIEF_LABEL[r.relief!]} · rota ${r.cycleCrew ?? '—'}` : `${r.crew} Shift · ${GROUP_LABEL[r.group]}${acting ? ' (acting Panel)' : ''}`;
  return (
    <BottomSheet open title={p.name} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="-mt-2 space-y-0.5 text-xs text-slate-600">
          <p>#{p.number} · G{p.grade ?? '—'} · {POS_SHORT[p.position ?? ''] ?? '—'} · {p.employmentType === 'contractor' ? 'Contractor' : 'Company'} · directory {p.dirCrew ?? '—'}{p.crew && p.crew !== p.dirCrew ? ` · dated move ${p.crew}` : ''}{p.dayDuty ? ' · day duty' : ''}</p>
          <p>Panel {p.panelQualified === 'yes' ? 'qualified' : p.panelQualified === 'no' ? 'not qualified' : 'not recorded'} · Take-Charge {p.takeCharge === 'yes' ? 'Yes' : p.takeCharge === 'no' ? 'No' : 'n/k'} · Sick (12 months) {p.sick ? `${p.sick.days} d, ${dm(p.sick.asOf)}` : 'not known'}</p>
          <p className="font-semibold text-slate-800">In the plan: {where}</p>
          {cand && <p>Acting Panel: {cand.state === 'picked' ? 'chosen by the rule' : cand.state === 'sick' ? `not eligible (over ${ACTING_PANEL.sickMax} sick days)` : cand.state === 'manual_no' ? 'kept in Field by hand' : 'eligible, not needed'} · {cand.reason}</p>}
        </div>
        {issues.length > 0 && <ul className="space-y-1">{issues.map((i) => <li key={i.code + i.text} className="flex items-start gap-1.5 text-xs"><StatusChip level={i.level} label={i.level === 'error' ? 'Blocking' : 'Review'} /><span>{i.text}</span></li>)}</ul>}
        {err != null && <ErrorBox error={err} />}
        {!editable ? <p className="text-xs text-slate-500">{d.alloc?.status === 'approved' ? 'The allocation is approved: the Section Head reopens it for changes.' : 'View only.'}</p> : mode === 'switch' ? (
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-700">Switch with ({GROUP_LABEL[r.group]} in another place)</p>
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-slate-200">
              {peers.map(({ x, q }) => <li key={q.id}><button type="button" disabled={busy} onClick={() => doSwitch(q.id, q.name)} className="flex min-h-11 w-full items-center gap-2 px-3 text-left">
                <span className="min-w-0 flex-1"><b className="block text-[13px]">{q.name}</b><span className="text-[11px] text-slate-500">#{q.number} · G{q.grade ?? '—'}</span></span>
                <span className="text-xs font-semibold text-slate-600">{x.group === 'relief' ? RELIEF_LABEL[x.relief!] : `${x.crew} Shift`}</span></button></li>)}
              {!peers.length && <li className="px-3 py-2 text-xs text-slate-500">Nobody in the same group elsewhere.</li>}
            </ul>
            <button type="button" onClick={() => setMode(null)} className="mt-2 text-xs font-semibold text-brand-700">‹ Back</button>
          </div>
        ) : mode === 'remove' ? (
          <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
            <label className="block text-xs font-medium text-slate-700" htmlFor="rm-note">Why is this person left out of the {d.year} plan? (kept with the plan; the directory is not changed)</label>
            <textarea id="rm-note" rows={2} className="input py-1.5 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setMode(null)} className={cx(chip(false), 'flex-1')}>Keep</button>
              <button type="button" disabled={busy || !note.trim()} onClick={async () => { await set({ group: 'excluded', crew: null, relief: null, cycleCrew: null, note: note.trim() }, `${p.name}: left out of the plan.`); onClose(); }} className="min-h-9 flex-1 rounded-lg bg-status-red px-3 text-sm font-semibold text-white disabled:opacity-40">Leave out</button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Shift</p>
              <div className="flex gap-1.5">{CREWS.map((c) => <button key={c} type="button" disabled={busy || r.group === 'excluded' || r.group === 'relief'} onClick={() => set({ crew: c }, `${p.name}: ${c} Shift.`)} className={chip(r.crew === c)}>{c}</button>)}</div>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Planning role</p>
              <div className="flex flex-wrap gap-1.5">
                {groups.map(({ g, ok }) => <button key={g} type="button" disabled={busy || !ok} title={ok ? undefined : 'Not qualified'} onClick={() => set({ group: g, crew: r.crew ?? r.cycleCrew ?? p.crew ?? p.dirCrew ?? 'A', relief: null, cycleCrew: null }, `${p.name}: ${GROUP_LABEL[g]}.`)} className={chip(r.group === g)}>{GROUP_LABEL[g]}</button>)}
              </div>
            </div>
            {p.position === 'field_operator' && (p.grade ?? 0) >= ACTING_PANEL.grade && r.group === 'field' && (
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Acting Panel</p>
                <div className="flex gap-1.5">{(['auto', 'yes', 'no'] as ActingChoice[]).map((a) => <button key={a} type="button" disabled={busy} onClick={() => set({ acting: a }, `${p.name}: acting Panel ${a === 'auto' ? 'by the rule' : a === 'yes' ? 'yes' : 'no'}.`)} className={chip(r.acting === a)}>{a === 'auto' ? 'By rule' : a === 'yes' ? 'Yes' : 'No'}</button>)}</div>
              </div>
            )}
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Relief</p>
              <div className="flex flex-wrap gap-1.5">
                {reliefs.map(({ k, ok }) => <button key={k} type="button" disabled={busy || !ok} onClick={() => set({ group: 'relief', relief: k, crew: null, cycleCrew: r.cycleCrew ?? r.crew ?? p.placement ?? p.dirCrew }, `${p.name}: ${RELIEF_LABEL[k]}.`)} className={chip(r.group === 'relief' && r.relief === k)}>{RELIEF_LABEL[k]}</button>)}
              </div>
              {r.group === 'relief' && (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600">Rota (vacation cycles of)
                  {CREWS.map((c) => <button key={c} type="button" disabled={busy} onClick={() => set({ cycleCrew: c as Crew }, `${p.name}: follows the ${c} Shift rota.`)} className={chip(r.cycleCrew === c)}>{c}</button>)}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
              {r.group !== 'excluded' && <button type="button" disabled={busy} onClick={() => setMode('switch')} className={chip(false)}>Switch with…</button>}
              {r.group === 'relief' && <button type="button" disabled={busy} onClick={() => set({ group: p.position === 'panel_operator' ? 'panel' : p.position === 'field_operator' ? 'field' : 'controller', crew: r.cycleCrew ?? p.dirCrew ?? 'A', relief: null, cycleCrew: null }, `${p.name}: back from relief.`)} className={chip(false)}>Return from relief</button>}
              {r.group !== 'excluded' ? <button type="button" disabled={busy} onClick={() => setMode('remove')} className={cx(chip(false), 'text-red-700')}>Leave out…</button>
                : <button type="button" disabled={busy} onClick={() => set({ group: p.position === 'panel_operator' ? 'panel' : p.position === 'field_operator' ? 'field' : 'controller', crew: p.crew ?? p.dirCrew ?? 'A', relief: null, cycleCrew: null, note: null }, `${p.name}: back in the plan.`)} className={chip(false)}>Add back</button>}
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
