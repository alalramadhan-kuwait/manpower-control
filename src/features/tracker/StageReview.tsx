// Items whose stage and finished steps disagree. Nothing changes by itself: a person opens the item and decides.
// A finished step is never taken as a formal handover; "behind" can be moved to the steps' stage in one tap
// (handed-over items only), the rest are opened in the item sheet.
import { useState } from 'react';
import { STAGE_SHORT, stageReview, type EquipView, type StageIssue } from '@/core/tracker';
import { setEquipment, type TrackerData } from '@/data/tracker';
import { ErrorBox, cx } from '@/ui/components';

const SAY: Record<StageIssue, string> = {
  ho_missing: 'Blinded or work started, handover not recorded',
  behind: 'Steps are further than the stage',
  ahead: 'Stage is further than the finished steps',
  no_stage: 'Steps carry no stage: the stage cannot follow them',
};
const TONE: Record<StageIssue, string> = { ho_missing: 'text-status-red', behind: 'text-amber-800', ahead: 'text-slate-600', no_stage: 'text-slate-600' };

export function StageReview({ data, eqs, canEdit, onOpen, onDone }: { data: TrackerData; eqs: EquipView[]; canEdit: boolean; onOpen: (tag: string) => void; onDone: () => void }) {
  const items = stageReview(data, eqs);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  if (!items.length) return null;
  const urgent = items.filter((i) => i.issue === 'ho_missing' || i.issue === 'behind').length;
  async function follow(id: string, stage: number) { setBusy(true); setErr(null); try { await setEquipment(id, { stage }); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); } }
  return (
    <section className={cx('mb-3 rounded-2xl p-3 ring-1', urgent ? 'bg-red-50/60 ring-red-100' : 'bg-white ring-slate-200')}>
      <button type="button" onClick={() => setShow((x) => !x)} className="flex w-full items-center justify-between text-left">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-700">Stage review · {items.length}{urgent ? ` · ${urgent} to check` : ''}</span>
        <span className="text-[12px] font-bold text-brand-700">{show ? 'Hide' : 'Show'}</span>
      </button>
      {show && <>
        {items.map((i) => (
          <div key={i.eq.id} className="flex items-center gap-2 border-t border-slate-100 py-2 first:mt-2">
            <button type="button" onClick={() => onOpen(i.eq.tag)} className="min-w-0 flex-1 text-left">
              <span className="block text-[13px]"><b>{i.eq.tag.replace(/^([A-Z]{1,3})-12-/, '$1-')}</b> · stage {STAGE_SHORT[i.stage]}{i.steps != null ? ` · steps reach ${STAGE_SHORT[i.steps]}` : ''} · {i.done}/{i.total} done</span>
              <span className={cx('block text-[12px]', TONE[i.issue])}>{SAY[i.issue]}</span>
            </button>
            {canEdit && i.issue === 'behind' && i.steps != null
              ? <button type="button" disabled={busy} onClick={() => follow(i.eq.id, i.steps!)} className="min-h-9 shrink-0 rounded-lg bg-white px-2.5 text-[12px] font-bold text-brand-700 ring-1 ring-slate-300">Set {STAGE_SHORT[i.steps]}</button>
              : <button type="button" onClick={() => onOpen(i.eq.tag)} className="min-h-9 shrink-0 rounded-lg bg-white px-2.5 text-[12px] font-bold text-slate-700 ring-1 ring-slate-300">Open</button>}
          </div>
        ))}
        <p className="mt-1 text-[11px] text-slate-500">Handover is never set from finished steps: confirm it in the item the normal way.</p>
        {err != null && <ErrorBox error={err} />}
      </>}
    </section>
  );
}
