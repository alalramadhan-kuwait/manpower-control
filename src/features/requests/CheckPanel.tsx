// What a change breaks (by severity) and the person's days around it: Date | Duty | Other, the changed days marked.
import { AlertTriangle, Check as CheckIcon, Info, OctagonX } from 'lucide-react';
import { useState } from 'react';
import { SEVERITY_LABEL, SEVERITY_RANK, type Finding, type Severity } from '@/core/validation';
import type { Check } from '@/data/validation';
import { Spinner, cx } from '@/ui/components';
import { shortDate } from '@/ui/leave';

const TONE: Record<Severity, string> = {
  hard_stop: 'bg-red-50 text-red-800 ring-red-300', critical: 'bg-orange-50 text-orange-900 ring-orange-300',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200', info: 'bg-slate-50 text-slate-700 ring-slate-200'
};
const ICON: Record<Severity, typeof Info> = { hard_stop: OctagonX, critical: AlertTriangle, warning: AlertTriangle, info: Info };
const DUTY_TONE: Record<string, string> = { M: 'text-sky-700', A: 'text-orange-700', N: 'text-indigo-700', D: 'text-teal-700', 'SD-D': 'text-rose-700', 'SD-N': 'text-rose-700', OFF: 'text-slate-400', '—': 'text-slate-400' };
const weekday = (d: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${d}T00:00:00Z`).getUTCDay()];

function Findings({ list }: { list: Finding[] }) {
  return (
    <ul className="space-y-1.5">
      {[...list].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]).map((f) => {
        const Icon = ICON[f.severity];
        return (
          <li key={f.key} className={cx('flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1', TONE[f.severity])}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span><b>{SEVERITY_LABEL[f.severity]}</b> · {f.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The check of one change: problems it creates, problems already there, and the ±7-day timeline. */
export function CheckPanel({ check, error }: { check: Check | null; error?: unknown }) {
  const [showExisting, setShowExisting] = useState(false);
  if (error) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">The check could not run. Do not approve until it does.</p>;
  if (!check) return <Spinner label="Checking the schedule and the crews…" />;
  const hard = check.findings.some((f) => f.severity === 'hard_stop');
  return (
    <div className="space-y-2">
      {check.findings.length === 0
        ? <p className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200"><CheckIcon className="h-4 w-4 shrink-0" />No rule broken: days in a row, rest, overlaps and crew minimums are fine.</p>
        : <Findings list={check.findings} />}
      {hard && <p className="text-xs font-medium text-red-800">A hard stop cannot be approved. Change the dates or not approve it.</p>}
      {check.existing.length > 0 && (
        <button type="button" onClick={() => setShowExisting(!showExisting)} className="text-xs font-medium text-slate-600 underline">
          {showExisting ? 'Hide' : 'Show'} {check.existing.length} problem{check.existing.length === 1 ? '' : 's'} already there before this change
        </button>
      )}
      {showExisting && <Findings list={check.existing} />}
      <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-2 py-1.5 font-medium">Date</th><th className="px-2 py-1.5 font-medium">Duty</th><th className="px-2 py-1.5 font-medium">Other</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {check.timeline.map((r) => (
              <tr key={r.date} className={cx(r.changed && 'bg-amber-50/70')}>
                <td className={cx('whitespace-nowrap px-2 py-1 tabular-nums', r.changed ? 'border-l-4 border-amber-400 font-medium text-slate-900' : 'border-l-4 border-transparent text-slate-600')}>
                  <span className="mr-1 text-xs text-slate-400">{weekday(r.date)}</span>{shortDate(r.date)}
                </td>
                <td className={cx('px-2 py-1 font-semibold', DUTY_TONE[r.duty] ?? 'text-slate-700')}>
                  {r.duty}{r.flagged && <span className={cx('ml-1 inline-block h-2 w-2 rounded-full align-middle', r.flagged === 'hard_stop' ? 'bg-red-600' : r.flagged === 'critical' ? 'bg-orange-500' : 'bg-amber-400')} title={SEVERITY_LABEL[r.flagged]} />}
                  {r.changed && r.restHours !== null && <span className="ml-1 text-[11px] font-normal text-slate-500">rest {r.restHours} h</span>}
                </td>
                <td className="px-2 py-1 text-slate-700">{r.other}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">Highlighted: days the change touches. Duty times: M 07:00, A 15:00, N 23:00 (8 h); shutdown shifts from the team&apos;s hours.</p>
    </div>
  );
}
