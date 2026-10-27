// Update Intelligence: the review workspace of the pasted reports. Filters All · Ready · Proposals · Conflicts ·
// Applied as one chip row; the proposals grouped by item; the reports read, folded. Not another equipment list.
import { useEffect, useMemo, useState } from 'react';
import { DEPT_SHORT } from '@/core/tracker/intel';
import { fetchIntel, type IntelData } from '@/data/trackerIntel';
import type { TrackerData } from '@/data/tracker';
import { ErrorBox, Spinner, cx } from '@/ui/components';
import { ProposalList, when } from './ProposalList';
import { ItemCards, toCards } from './ItemCards';

export function useIntel(trackerId: string, tick = 0) {
  const [intel, setIntel] = useState<IntelData | null>(null); const [err, setErr] = useState<unknown>(null);
  // read again after any save in the app (dataChanged) so the summary and the lists follow
  useEffect(() => { let live = true; const load = () => fetchIntel(trackerId).then((x) => live && setIntel(x)).catch((e) => live && setErr(e)); load(); window.addEventListener('notices-changed', load); return () => { live = false; window.removeEventListener('notices-changed', load); }; }, [trackerId, tick]);
  return { intel, err, reload: () => fetchIntel(trackerId).then(setIntel).catch(setErr) };
}

/** Updates by item (owner, 27 Oct 2026): three counts on top (tap one to show only that part), one card per item
 *  (Need your look first, then Ready to apply with Apply all), the notes and what was applied folded at the bottom. */
export function UpdateIntelligence({ d, canEdit, onDone, onPaste }: { d: TrackerData; canEdit: boolean; onDone: (msg: string) => void; onPaste: () => void }) {
  const [show, setShow] = useState<'all' | 'look' | 'ready'>('all');
  const [tick, setTick] = useState(0);
  const { intel, err } = useIntel(d.tracker.id, tick);
  const { cards, notes } = useMemo(() => toCards(intel?.proposals ?? []), [intel]);
  const applied = useMemo(() => (intel?.proposals ?? []).filter((p) => (p.status === 'applied' || p.status === 'dismissed') && Date.parse(p.reviewedAt ?? p.createdAt) > Date.now() - 864e5), [intel]);
  if (err) return <ErrorBox error={err} />;
  if (!intel) return <Spinner />;
  const done = (m: string) => { onDone(m); setTick((t) => t + 1); };
  const look = cards.filter((c) => c.look).length, ready = cards.length - look;
  const count = (k: 'look' | 'ready', n: number, label: string) => (
    <button type="button" aria-pressed={show === k} onClick={() => setShow((x) => (x === k ? 'all' : k))}
      className={cx('min-w-0 flex-1 rounded-xl bg-white px-2.5 py-1.5 text-left ring-1', show === k ? 'ring-2 ring-brand-700' : 'ring-slate-200')}>
      <b className="block text-[18px] leading-tight tabular-nums">{n}</b><span className="block truncate text-[11px] text-slate-500">{label}</span></button>);
  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-1.5">
        {count('look', look, 'To check')}
        {count('ready', ready, 'Ready')}
        <a href="#updates-notes" className="min-w-0 flex-1 rounded-xl bg-white px-2.5 py-1.5 ring-1 ring-slate-200"><b className="block text-[18px] leading-tight tabular-nums">{notes.length}</b><span className="block truncate text-[11px] text-slate-500">Notes</span></a>
        {canEdit && <button type="button" onClick={onPaste} className="shrink-0 rounded-xl bg-brand-700 px-2.5 text-[12px] font-bold text-white">📋 Paste</button>}
      </div>
      <ItemCards cards={cards} d={d} canEdit={canEdit} onDone={done} show={show} />
      <details id="updates-notes" className="rounded-2xl bg-white px-3 py-1.5 text-[12px] ring-1 ring-slate-200">
        <summary className="cursor-pointer font-semibold text-slate-700">Notes · {notes.length} <span className="font-normal text-slate-500">Train-1 conditions, items not in this tracker, unclear lines, older statuses</span></summary>
        <div className="mt-1.5">{notes.length ? <ProposalList rows={notes} d={d} canEdit={canEdit} onDone={done} /> : <p className="text-slate-500">No notes.</p>}</div>
      </details>
      <details className="rounded-2xl bg-white px-3 py-1.5 text-[12px] ring-1 ring-slate-200">
        <summary className="cursor-pointer font-semibold text-slate-700">Applied today · {applied.length}</summary>
        <div className="mt-1.5">{applied.length ? <ProposalList rows={applied} d={d} canEdit={false} onDone={done} /> : <p className="text-slate-500">Nothing yet.</p>}</div>
      </details>
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
