// Leave Impact Preview (Calendar Stage 2): one compact block, the same in the Leave detail sheet and in Approvals.
// Duty by duty what the leave does to the person's crew (manpower engine), who else of the crew is off, and for a
// Controller: Controllers off together, the yearly count, and Controllers free to cover. Confirmed shortage (red) and
// cover needed / data missing (grey) are kept apart. Reads only.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CONTROLLER_LEAVE_RULES, type LeaveApproval } from '@/core/controllers/leaveRules';
import { personOn } from '@/core/manpower';
import { leavePreview, PREVIEW_MAX_DAYS, type DutyIssue, type PreviewDuty } from '@/core/requests/preview';
import { addDaysIso } from '@/core/roster';
import { fetchLeaveApprovals } from '@/data/controllers';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { Spinner, cx } from '@/ui/components';
import { shortDate } from '@/ui/leave';
import { SHIFT_STYLE, StatusBar } from './parts';

export interface PreviewLeave { employeeId: string; start: string; end: string; typeCode: string | null; recordIds: string[] }
const ISSUE: Record<Exclude<DutyIssue, null>, { text: string; cls: string }> = {
  short: { text: 'Short', cls: 'bg-status-red text-white' }, cover_needed: { text: 'Cover needed', cls: 'bg-slate-200 text-slate-800' }, data_missing: { text: 'Data missing', cls: 'bg-slate-200 text-slate-800' }
};
const DOT = { green: 'bg-green-600', amber: 'bg-amber-500', red: 'bg-status-red', pending: 'bg-slate-400', off: 'bg-slate-200' } as const;
const wd = (d: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${d}T00:00:00Z`).getUTCDay()];
const nth = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export function ImpactPreview({ leave, counted = true }: { leave: PreviewLeave; /** false: the leave does not count yet (request, or started without approval) */ counted?: boolean }) {
  const [inputs, setInputs] = useState<ManpowerInputs | null>(null);
  const [approvals, setApprovals] = useState<LeaveApproval[]>([]);
  const [error, setError] = useState(false);
  const [all, setAll] = useState(false);
  const last = leave.end >= '9999' ? addDaysIso(leave.start, PREVIEW_MAX_DAYS) : leave.end;
  useEffect(() => {
    let live = true;
    Promise.all([fetchManpowerInputs(addDaysIso(leave.start, -45), addDaysIso(last, 45)), fetchLeaveApprovals().catch(() => [])])
      .then(([i, a]) => { if (live) { setInputs(i); setApprovals(a); } }).catch(() => live && setError(true));
    return () => { live = false; };
  }, [leave.start, last]);
  const p = useMemo(() => (inputs ? leavePreview(leave, inputs.people, inputs.absencesAll, inputs.assignments, inputs.rules, approvals) : null), [inputs, approvals, leave]);
  if (error) return <p className="text-xs text-amber-800">The staffing check could not run. Do not decide on it until it does.</p>;
  if (!p || !inputs) return <Spinner label="Checking the crews…" />;
  const people = new Map(inputs.people.map((x) => [x.id, x]));
  const shown = all ? p.duties : p.duties.filter((d) => d.issue || d.before !== d.after);
  const crew = p.duties[0]?.crew ?? null;
  const summary = p.short ? <b className="text-status-red">Short on {p.short} dut{p.short === 1 ? 'y' : 'ies'}</b>
    : p.coverNeeded ? <b className="text-slate-800">Controller cover needed on {p.coverNeeded} dut{p.coverNeeded === 1 ? 'y' : 'ies'}</b>
    : p.dataMissing ? <b className="text-slate-800">Data missing on {p.dataMissing} dut{p.dataMissing === 1 ? 'y' : 'ies'}</b>
    : p.duties.length ? <span className="text-status-green">No crew falls below its minimum ✓</span> : <span className="text-slate-600">No duty in these dates</span>;
  // others of the crew off on these duties, once each, by position
  const others = new Map<string, string | null>(); for (const d of p.duties) for (const o of d.othersOff) others.set(o.id, o.role);
  const byRole = [...others.values()].reduce<Record<string, number>>((m, r) => ({ ...m, [r ?? 'other']: (m[r ?? 'other'] ?? 0) + 1 }), {});
  const ROLE = { controller: 'Controller', vr_controller: 'VR', morning_controller: 'Morning Ctl', panel_operator: 'Panel', field_operator: 'Field', other: 'Other' } as Record<string, string>;
  return (
    <div className="space-y-1.5 text-xs">
      <p className="text-slate-600">Last duty <b className="text-slate-800">{p.lastDuty ? `${p.lastDuty.shift} ${shortDate(p.lastDuty.date)}` : '—'}</b> · next duty <b className="text-slate-800">{p.nextDuty ? `${p.nextDuty.shift} ${shortDate(p.nextDuty.date)}` : '—'}</b> · this year {p.year.count} annual leave{p.year.count === 1 ? '' : 's'}, {p.year.days} d</p>
      <p>{!counted && <span className="text-slate-500">If it counts: </span>}{p.duties.length} dut{p.duties.length === 1 ? 'y' : 'ies'}{crew ? ` of ${crew} Shift` : ''} · {summary}</p>
      {shown.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {shown.map((d) => <DutyRow key={d.date} d={d} />)}
        </ul>
      )}
      {p.duties.length > shown.length && <button type="button" onClick={() => setAll(true)} className="font-medium text-brand-700">Show all {p.duties.length} duties</button>}
      {others.size > 0 && <p className="text-slate-600">Also off in the crew on these duties: <b>{others.size}</b> ({Object.entries(byRole).map(([r, n]) => `${ROLE[r] ?? r} ${n}`).join(' · ')})</p>}
      {p.controller && (
        <div className="space-y-1 border-t border-slate-100 pt-1.5">
          <p className={cx(p.controller.offTogether.length ? 'text-status-red' : 'text-slate-600')}>
            {p.controller.offTogether.length ? <>Controllers off together: <b>{p.controller.offTogether.map((o) => `${o.vr ? (o.crew ? `VR in ${o.crew}` : 'VR') : `${o.crew ?? '—'} Shift`} (${shortDate(o.start)}${o.end !== o.start ? `–${shortDate(o.end)}` : ''})`).join(' · ')}</b> · needs your approval</> : 'No other Controller off on these days'}
          </p>
          <p className={cx(p.controller.extra ? 'text-amber-800' : 'text-slate-600')}>{p.controller.nth ? `${nth(p.controller.nth)} annual leave this year` : 'Not annual leave'}{p.controller.extra ? ` · over ${CONTROLLER_LEAVE_RULES.maxLeavesPerYear}, needs your approval` : ''}</p>
          {crew && (p.coverNeeded > 0 || p.controller.candidates.length > 0) && (
            <div>
              <p className="text-slate-600">Free to cover {crew} Shift: {p.controller.candidates.length ? p.controller.candidates.slice(0, 4).map((c) => {
                const q = people.get(c.id); const at = q ? personOn(q, leave.start) : null;
                return `${c.name} (${at?.role === 'vr_controller' ? (at.crew ? `VR in ${at.crew}` : 'VR') : at?.crew ?? 'Day'}${c.warnings.length ? ', see warning' : ''})`;
              }).join(' · ') : 'none recorded'}</p>
              <Link to={`/requests?view=entry&card=controller&kind=cover&crew=${crew}&from=${leave.start}&to=${last}`} className="font-medium text-brand-700">Assign cover ›</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DutyRow({ d }: { d: PreviewDuty }) {
  const pos = (label: string, x: { before: number; after: number; min: number }) =>
    <span className={cx(x.after < x.min && 'font-semibold text-status-red')}>{label} {x.before !== x.after ? <>{x.before}→<b>{x.after}</b></> : x.after}/{x.min}</span>;
  return (
    <li className="flex items-center gap-1.5 px-2 py-1 tabular-nums">
      <span className="w-[52px] shrink-0 text-slate-600">{wd(d.date)} {Number(d.date.slice(8))}</span>
      <span className={cx('relative flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded text-[10px] font-bold', SHIFT_STYLE[d.shift].cell)}>{d.shift}{d.after !== 'off' && <StatusBar mark={d.after} />}</span>
      <span className="flex min-w-0 flex-1 flex-wrap gap-x-1.5 text-slate-700">{pos('Ctl', d.controller)}{pos('P', d.panel)}{pos('F', d.field)}</span>
      {d.issue ? <span className={cx('shrink-0 rounded px-1 text-[10px] font-semibold', ISSUE[d.issue].cls)}>{ISSUE[d.issue].text}</span>
        : <span className="flex shrink-0 items-center gap-0.5"><span className={cx('h-2 w-2 rounded-full', DOT[d.before])} />→<span className={cx('h-2 w-2 rounded-full', DOT[d.after])} /></span>}
    </li>
  );
}
