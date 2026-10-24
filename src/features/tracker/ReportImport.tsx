// Section Head: import the plant's daily shutdown report. Paste → preview of every change (tickable, with what is not
// changed and why) → Apply. Changes go through the normal saves, so each one is in the history under the Section
// Head's name with the report as its reason; drums go in once per report; the P6 plan is never touched.
import { useMemo, useState } from 'react';
import { parseReport, planImport, type Change, type ImportPlan } from '@/core/tracker/reportImport';
import { addQtyEntry, setActivity, setEquipment, type TrackerData } from '@/data/tracker';
import { Button, ErrorBox, cx } from '@/ui/components';
import { kwDay, kwTime } from '@/core/tracker';

const what = (c: Change) => c.kind === 'remark' ? <>Status: <s className="text-slate-500">{c.from ?? '—'}</s> → <b>{c.to}</b></>
  : c.kind === 'drums' ? <>Drums: {c.current} → <b>{c.total}</b> (+{c.add}{c.corrects ? ', added to this shift' : ''})</>
  : <>{c.kind === 'start' ? '▶ Start' : '✓ Finish'}: <b>{c.activity.activity}</b></>;

export function ReportImport({ data, onDone }: { data: TrackerData; onDone: (msg: string) => void }) {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [errs, setErrs] = useState<string[]>([]); const [err, setErr] = useState<unknown>(null);
  const year = useMemo(() => new Date().getFullYear(), []);
  const read = () => { setErrs([]); setErr(null); try { const p = planImport(data, parseReport(text, year)); setPlan(p); setOff(new Set(p.changes.filter((c) => !c.on).map((c) => c.id))); } catch (e) { setErr(e); } };
  const chosen = plan ? plan.changes.filter((c) => !off.has(c.id)) : [];
  async function apply() {
    if (!plan) return; setBusy(true); const bad: string[] = []; let ok = 0;
    for (const c of chosen) {
      try {
        if (c.kind === 'remark') await setEquipment(c.equipmentId, { remark: c.to });
        else if (c.kind === 'start') await setActivity(c.activity.id, { actual_start: c.at, time_reason: plan.marker });
        else if (c.kind === 'finish') await setActivity(c.activity.id, { actual_start: c.activity.actualStart ?? c.at, actual_finish: c.at, time_reason: plan.marker });
        else if (c.kind === 'drums') await addQtyEntry(c.scopeId, { shiftDate: c.shiftDate, shift: c.shift, kind: c.corrects ? 'correction' : 'removal', method: c.method, qty: c.add, corrects: c.corrects,
          remark: `${plan.marker}: total ${c.total}`, source: 'plant_report', verified: true });
        ok++;
      } catch (e) { bad.push(`${c.tag}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    setBusy(false); setErrs(bad);
    if (!bad.length) { setPlan(null); setText(''); }
    onDone(`${plan.marker}: ${ok} change${ok === 1 ? '' : 's'} saved${bad.length ? `, ${bad.length} not saved` : ''}.`);
  }
  const tags = plan ? [...new Set(plan.changes.map((c) => c.tag))] : [];
  return (
    <div className="space-y-2">
      {!plan && <>
        <textarea className="input min-h-40 py-2 text-[13px]" placeholder="Paste the plant's shutdown report (WhatsApp text)" value={text} onChange={(e) => setText(e.target.value)} />
        <Button className="w-full" disabled={!text.trim()} onClick={read}>Preview changes</Button>
      </>}
      {plan && <>
        <p className="text-[12px] text-slate-600">{plan.marker.replace('Report', 'Report of')} · {kwDay(plan.at)} {kwTime(plan.at)} · steps timed at the report · tick what to save</p>
        <div className="divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-200">
          {tags.map((t) => <div key={t} className="px-3 py-1.5">
            <b className="text-[13px] text-slate-900">{t}</b>
            {plan.changes.filter((c) => c.tag === t).map((c) => <label key={c.id} className="mt-1 flex items-start gap-2 text-[12px] text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={!off.has(c.id)} onChange={(e) => setOff((s) => { const n = new Set(s); if (e.target.checked) n.delete(c.id); else n.add(c.id); return n; })} />
              <span className={cx('min-w-0', off.has(c.id) && 'text-slate-500')}>{what(c)}{c.note && <span className="block text-[11px] text-amber-800">{c.note}</span>}</span></label>)}
          </div>)}
          {!tags.length && <p className="px-3 py-2 text-[12px] text-slate-500">Nothing to change: the tracker already has this report.</p>}
        </div>
        {plan.skipped.length > 0 && <details className="rounded-2xl px-3 py-1.5 text-[12px] text-slate-600 ring-1 ring-slate-200"><summary className="cursor-pointer font-semibold">Not changed · {plan.skipped.length}</summary>
          <ul className="mt-1 space-y-0.5">{plan.skipped.map((s, i) => <li key={i}><b>{s.tag}</b> {s.text} — {s.why}</li>)}</ul></details>}
        <div className="flex gap-2"><Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setPlan(null)}>Back</Button>
          <Button className="flex-1" disabled={busy || !chosen.length} onClick={apply}>{busy ? 'Saving…' : `Save ${chosen.length} change${chosen.length === 1 ? '' : 's'}`}</Button></div>
      </>}
      {errs.length > 0 && <ul className="rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-800">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
      {err != null && <ErrorBox error={err} />}
    </div>
  );
}
