// Latest update of one item (its sheet): the latest reported status, the current confirmed step, the latest completed
// work, outstanding work, the issues reported (defects, holds, risks), the proposals waiting next to the steps they
// touch, and the source report. Compact; folded when nothing was reported.
import { useMemo } from 'react';
import { latestFor, DEPT_SHORT } from '@/core/tracker/intel';
import type { TrackerData } from '@/data/tracker';
import { cx } from '@/ui/components';
import { useIntel } from './UpdateIntelligence';
import { ProposalRowView, when } from './ProposalList';

export function LatestUpdate({ d, tag, canEdit, onDone }: { d: TrackerData; tag: string; canEdit: boolean; onDone: (msg: string) => void }) {
  const { intel, reload } = useIntel(d.tracker.id);
  const mine = useMemo(() => (intel ? intel.proposals.filter((p) => p.tag === tag) : []), [intel, tag]);
  const l = useMemo(() => latestFor(d, tag, mine), [d, tag, mine]);
  if (!intel || !mine.length) return null;
  const last = [...mine].sort((a, b) => Date.parse(b.eventAt) - Date.parse(a.eventAt))[0];
  const report = intel.reports.find((r) => r.id === last.reportId);
  const open = l.proposed;
  return (
    <section className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
      <p className="flex items-baseline justify-between text-[11px] font-bold uppercase tracking-wide text-slate-500"><span>Latest update</span><span className="font-semibold normal-case tracking-normal">{report ? `${DEPT_SHORT[report.department]} ${report.reportDate}${report.shift ? ` ${report.shift}` : ''}` : when(last.eventAt)}</span></p>
      <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[12px]">
        <dt className="text-slate-500">Status</dt><dd className="font-semibold text-slate-900">{l.status ?? '—'}</dd>
        <dt className="text-slate-500">Current</dt><dd>{l.current ? `▶ ${l.current.activity}` : '—'}</dd>
        <dt className="text-slate-500">Done</dt><dd>{l.done ? `✓ ${l.done.activity}` : '—'}</dd>
        <dt className="text-slate-500">Outstanding</dt><dd>{l.outstanding.length ? `${l.outstanding.length} step${l.outstanding.length === 1 ? '' : 's'} · next ${l.outstanding.find((a) => !a.actualStart)?.activity ?? '—'}` : 'none'}</dd>
        {l.issues.length > 0 && <><dt className="text-slate-500">Issues</dt><dd>{l.issues.map((p) => <span key={p.id} className={cx('mr-1 inline-block rounded px-1 text-[11px] font-semibold', p.type === 'hold' ? 'bg-red-100 text-red-900' : p.type === 'defect' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700')}>{p.type === 'hold' ? '⛔' : p.type === 'defect' ? '⚠' : '◔'} {p.title.replace(/^[^:]+:\s*/, '')}</span>)}</dd></>}
      </dl>
      {open.length > 0 && <div className="mt-1 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
        <p className="px-3 py-1 text-[11px] font-semibold text-slate-600">Proposed · {open.length}</p>
        {open.map((p) => <ProposalRowView key={p.id} p={p} d={d} canEdit={canEdit} onDone={(m) => { onDone(m); reload(); }} />)}
      </div>}
      {report && <details className="mt-1 text-[11px] text-slate-500"><summary className="cursor-pointer">Source report</summary><pre className="whitespace-pre-wrap rounded bg-slate-50 p-2">{report.body}</pre></details>}
    </section>
  );
}
