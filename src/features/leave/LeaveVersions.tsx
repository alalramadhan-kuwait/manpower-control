// One leave's versions, oldest first: the dates are never edited, each change is a new version.
import { useEffect, useState } from 'react';
import { ORIGIN_LABEL, versionState } from '@/core/leave/versions';
import { fetchLeaveVersions } from '@/data/leave';
import type { LeaveRecord } from '@/data/types';
import { Chip, cx } from '@/ui/components';
import { shortDate } from '@/ui/leave';

const STATE = { current: { label: 'In the plan', tone: 'green' }, replaced: { label: 'Replaced', tone: 'neutral' }, cancelled: { label: 'Cancelled', tone: 'neutral' } } as const;
const span = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);

export function VersionList({ versions }: { versions: LeaveRecord[] }) {
  return (
    <ol className="space-y-1.5 text-sm">
      {versions.map((v) => {
        const st = STATE[versionState(v)];
        return (
          <li key={v.id} className={cx('flex items-start gap-2', st.tone === 'neutral' && 'text-slate-500')}>
            <span className="mt-0.5 w-6 shrink-0 text-xs font-semibold tabular-nums text-slate-500">v{v.version_no}</span>
            <span className="min-w-0 flex-1">
              <span className={cx('font-medium', st.tone === 'neutral' ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-900')}>{span(v.start_date, v.end_date)}</span>
              <span className="text-xs text-slate-500"> · {ORIGIN_LABEL[v.origin] ?? v.origin}</span>
              {v.change_reason && <span className="block text-xs text-slate-500">{v.change_reason}</span>}
            </span>
            <Chip tone={st.tone}>{st.label}</Chip>
          </li>
        );
      })}
    </ol>
  );
}

/** Loads and shows the versions of the leave `record` belongs to (nothing when it has only one). */
export function LeaveVersions({ record }: { record: LeaveRecord }) {
  const [versions, setVersions] = useState<LeaveRecord[] | null>(null);
  useEffect(() => { fetchLeaveVersions(record.root_id).then(setVersions).catch(() => setVersions(null)); }, [record.root_id]);
  if (!versions || versions.length < 2) return null;
  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Versions of this leave</p>
      <VersionList versions={versions} />
    </div>
  );
}
