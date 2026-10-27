// Update Intelligence: the review workspace of the pasted reports. Filters All · Ready · Proposals · Conflicts ·
// Applied as one chip row; the proposals grouped by item; the reports read, folded. Not another equipment list.
import { useEffect, useMemo, useState } from 'react';
import { DEPT_SHORT } from '@/core/tracker/intel';
import { fetchIntel, type IntelData } from '@/data/trackerIntel';
import type { TrackerData } from '@/data/tracker';
import { ErrorBox, Spinner, cx } from '@/ui/components';
import { ProposalList, when } from './ProposalList';

type Filter = 'all' | 'ready' | 'proposals' | 'conflicts' | 'applied';
const FILTERS: [Filter, string][] = [['all', 'All'], ['ready', 'Ready'], ['proposals', 'Proposals'], ['conflicts', 'Conflicts'], ['applied', 'Applied']];

export function useIntel(trackerId: string, tick = 0) {
  const [intel, setIntel] = useState<IntelData | null>(null); const [err, setErr] = useState<unknown>(null);
  // read again after any save in the app (dataChanged) so the summary and the lists follow
  useEffect(() => { let live = true; const load = () => fetchIntel(trackerId).then((x) => live && setIntel(x)).catch((e) => live && setErr(e)); load(); window.addEventListener('notices-changed', load); return () => { live = false; window.removeEventListener('notices-changed', load); }; }, [trackerId, tick]);
  return { intel, err, reload: () => fetchIntel(trackerId).then(setIntel).catch(setErr) };
}

export function UpdateIntelligence({ d, canEdit, onDone, onPaste }: { d: TrackerData; canEdit: boolean; onDone: (msg: string) => void; onPaste: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [tick, setTick] = useState(0);
  const { intel, err } = useIntel(d.tracker.id, tick);
  const rows = useMemo(() => {
    if (!intel) return [];
    const open = (s: string) => s === 'ready' || s === 'review' || s === 'conflict';
    return intel.proposals.filter((p) => filter === 'all' ? open(p.status) || p.status === 'info' : filter === 'ready' ? p.status === 'ready' : filter === 'proposals' ? ['new_step', 'defect', 'hold', 'risk', 'review'].includes(p.type) && open(p.status) : filter === 'conflicts' ? p.status === 'conflict' : p.status === 'applied' || p.status === 'dismissed');
  }, [intel, filter]);
  const count = (f: Filter) => { if (!intel) return 0; const open = (s: string) => s === 'ready' || s === 'review' || s === 'conflict'; return intel.proposals.filter((p) => f === 'all' ? open(p.status) : f === 'ready' ? p.status === 'ready' : f === 'proposals' ? ['new_step', 'defect', 'hold', 'risk', 'review'].includes(p.type) && open(p.status) : f === 'conflicts' ? p.status === 'conflict' : p.status === 'applied').length; };
  if (err) return <ErrorBox error={err} />;
  if (!intel) return <Spinner />;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="no-scrollbar flex flex-1 gap-1 overflow-x-auto">
          {FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cx('min-h-8 shrink-0 rounded-lg px-2.5 text-[12px] font-semibold ring-1', filter === k ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200')}>{l}{count(k) ? <span className="ml-1 tabular-nums opacity-80">{count(k)}</span> : null}</button>)}
        </div>
        {canEdit && <button type="button" onClick={onPaste} className="min-h-8 shrink-0 rounded-lg bg-brand-700 px-2.5 text-[12px] font-bold text-white">📋 Paste</button>}
      </div>
      <ProposalList rows={rows} d={d} canEdit={canEdit} onDone={(m) => { onDone(m); setTick((t) => t + 1); }} />
      <details className="rounded-2xl bg-white px-3 py-1.5 text-[12px] ring-1 ring-slate-200">
        <summary className="cursor-pointer font-semibold text-slate-700">Reports read · {intel.reports.length}</summary>
        <ul className="mt-1 divide-y divide-slate-100">
          {intel.reports.map((r) => <li key={r.id} className="py-1"><b>{DEPT_SHORT[r.department]}</b> {r.reportDate}{r.shift ? ` ${r.shift}` : ''}{r.reporter ? ` · ${r.reporter}` : ''} · {r.status} · <span className="text-slate-500">{Object.entries(r.summary).filter(([k]) => k !== 'facts').map(([k, v]) => `${v} ${k}`).join(' · ')} · {when(r.submittedAt)}{r.submittedBy ? ` by ${r.submittedBy}` : ''}</span>
            <details className="mt-0.5"><summary className="cursor-pointer text-[11px] text-brand-700">Original text</summary><pre className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px]">{r.body}</pre></details></li>)}
          {!intel.reports.length && <li className="py-1 text-slate-500">No report pasted yet.</li>}
        </ul>
      </details>
    </div>
  );
}

/** The one-line summary under the Dashboard overview: new updates · proposals · active holds · conflicts. */
export function IntelSummary({ d, onOpen }: { d: TrackerData; onOpen: () => void }) {
  const { intel } = useIntel(d.tracker.id);
  if (!intel) return null;
  const since = Date.now() - 864e5;
  const open = intel.proposals.filter((p) => p.status === 'ready' || p.status === 'review' || p.status === 'conflict');
  const n = { reports: intel.reports.filter((r) => Date.parse(r.submittedAt) >= since).length, proposals: open.filter((p) => ['new_step', 'defect', 'hold', 'risk'].includes(p.type)).length,
    holds: d.equipment.filter((e) => e.tracked && e.pendingReason).length, conflicts: open.filter((p) => p.status === 'conflict').length, ready: open.filter((p) => p.status === 'ready').length };
  return (
    <button type="button" onClick={onOpen} className="mb-2 flex min-h-9 w-full items-center gap-2 rounded-xl bg-white px-3 text-left text-[12px] ring-1 ring-slate-200">
      <span className="font-bold text-slate-700">Updates</span>
      <span className="min-w-0 flex-1 truncate text-slate-600">{n.reports} new today · {n.ready} ready · {n.proposals} proposals · {n.holds} active hold{n.holds === 1 ? '' : 's'}{n.conflicts ? <> · <b className="text-status-red">{n.conflicts} conflict{n.conflicts === 1 ? '' : 's'}</b></> : ''}</span>
      <span className="text-slate-500">›</span>
    </button>
  );
}
