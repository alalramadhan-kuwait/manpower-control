// Leave detail sheet (Calendar Stage 2, owner 26 Oct 2026): tap a leave or a request in the Calendar and see, in one
// sheet, the person, the leave and its separate status facts, last / next duty, the year's leave, the leave before and
// after, the versions, and the staffing impact. Actions open the existing flows (change dates, cancel with a reason,
// approve in Requests); the Oracle application is recorded only when someone confirms it. Nothing changes by itself.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isOpenEnd } from '@/core/leave';
import { APPROVAL_LABEL, ORACLE_STATE_LABEL, TIME_LABEL, timeState, type ApprovalState, type OracleState, type PendingLeaveRequest } from '@/core/leave/status';
import { fetchLeaveVersions, recordOracle } from '@/data/leave';
import type { EmployeeDirectoryRow, LeaveRecord } from '@/data/types';
import { VersionList } from '@/features/leave/LeaveVersions';
import { BottomSheet, ErrorBox, cx } from '@/ui/components';
import { shortDate } from '@/ui/leave';
import { leaveTone } from '@/ui/leaveTypes';
import { ImpactPreview } from './ImpactPreview';

/** One leave as the Calendar lists it: joined records, or a request waiting for the Section Head. */
export interface LeaveItem {
  key: string; p: EmployeeDirectoryRow; start: string; end: string; codes: string[]; typeCode: string | null; place: string; home: string | null; actual: string | null;
  records: LeaveRecord[]; movedFrom: string | null; approval: ApprovalState | null; oracle: OracleState | 'mixed' | null; request: PendingLeaveRequest | null; cancelAsked: boolean;
}
const range = (s: string, e: string) => (isOpenEnd(e) ? `${shortDate(s)} – return open` : s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}`);
const days = (s: string, e: string) => Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1;
const POS: Record<string, string> = { controller: 'Controller', vr_controller: 'VR Controller', morning_controller: 'Morning Controller', panel_operator: 'Panel Operator', field_operator: 'Field Operator' };
const isPv = (code: string | null) => !!code?.startsWith('annual_leave_') && code !== 'annual_leave_unscheduled';

export function LeaveDetail({ item, around, today, onClose, onChanged }: {
  item: LeaveItem; /** the person's other leaves (joined), oldest first */ around: { start: string; end: string; codes: string[] }[];
  today: string; onClose: () => void; onChanged: () => void;
}) {
  const { p, records, request } = item;
  const [versions, setVersions] = useState<LeaveRecord[][]>([]);
  const [oracleOpen, setOracleOpen] = useState(false);
  const [ref, setRef] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const roots = [...new Set(records.map((r) => r.root_id))];
    Promise.all(roots.map((r) => fetchLeaveVersions(r).catch(() => []))).then((v) => live && setVersions(v.filter((x) => x.length > 1)));
    return () => { live = false; };
  }, [records]);
  const prev = [...around].reverse().find((l) => l.end < item.start) ?? null;
  const next = around.find((l) => l.start > item.end) ?? null;
  const counted = !request && item.approval !== 'lapsed' && item.approval !== 'declined';
  const time = request ? null : timeState({ start_date: item.start, end_date: item.end, return_confirmed_at: records.at(-1)?.return_confirmed_at ?? null }, today);
  async function oracle(status: 'submitted' | 'approved' | 'rejected') {
    setBusy(true); setErr(null);
    try { for (const r of records) await recordOracle(r.id, status, ref); setDone(`Oracle ${status} recorded.`); setOracleOpen(false); onChanged(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const change = isPv(item.typeCode) ? `/requests?view=entry&card=pv&emp=${p.id}&leave=${records[0]?.start_date ?? item.start}` : `/requests?view=entry&card=leave&emp=${p.id}`;
  return (
    <BottomSheet open onClose={onClose} title={p.display_name}>
      <div className="space-y-2.5 text-sm">
        <p className="-mt-1 text-xs text-slate-600">#{p.employee_number} · {POS[p.position_code ?? ''] ?? p.position_label ?? '—'}{p.grade ? ` · G${p.grade}` : ''} · {item.place}</p>

        <div className="rounded-xl px-3 py-2 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-1.5">
            {item.codes.map((c) => <span key={c} className={cx('rounded px-1.5 py-px text-[11px] font-bold', request ? 'border border-dashed border-brand-600 text-brand-700' : leaveTone(item.typeCode).chip)}>{c}{item.movedFrom !== null ? ' ↻' : ''}</span>)}
            <b className="tabular-nums">{range(item.start, item.end)}</b>{!isOpenEnd(item.end) && <span className="text-slate-500">· {days(item.start, item.end)} d</span>}
          </div>
          {request ? <p className="mt-1 text-xs font-medium text-brand-700">Requested {shortDate(request.requestedAt.slice(0, 10))} · waiting for the Section Head · not in the plan yet</p> : (
            <dl className="mt-1 grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5 text-xs">
              <dt className="text-slate-500">Time</dt><dd>{TIME_LABEL[time!]}</dd>
              <dt className="text-slate-500">Approval</dt><dd className={cx(item.approval === 'awaiting' && 'text-amber-800', (item.approval === 'lapsed' || item.approval === 'declined') && 'font-medium text-status-red')}>{APPROVAL_LABEL[item.approval!]}</dd>
              <dt className="text-slate-500">Oracle</dt><dd className={cx(item.oracle === 'rejected' && 'font-medium text-status-red')}>{item.oracle === 'mixed' ? 'Differs by part' : ORACLE_STATE_LABEL[item.oracle!]}
                {' '}<button type="button" onClick={() => setOracleOpen(!oracleOpen)} className="font-medium text-brand-700">Record ›</button></dd>
              {item.movedFrom !== null && <><dt className="text-slate-500">Moved</dt><dd>↻ {item.movedFrom ? `from ${item.movedFrom}` : 'rescheduled'}</dd></>}
              {records.length > 1 && <><dt className="text-slate-500">Records</dt><dd>{records.length} back to back, one leave</dd></>}
            </dl>
          )}
          {item.approval === 'lapsed' && <p className="mt-1 text-xs text-status-red">Started without approval: by the current rule the manpower count treats {p.display_name.split(' ')[0]} as at work.</p>}
          {item.oracle === 'rejected' && counted && <p className="mt-1 text-xs text-status-red">Rejected in Oracle but still in the plan: check whether it was taken.</p>}
          {item.cancelAsked && <p className="mt-1 text-xs text-status-red">A cancellation is waiting for the Section Head.</p>}
          {oracleOpen && (
            <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-2">
              <p className="text-xs text-slate-600">Record what Oracle shows for these dates (only when confirmed):</p>
              <input className="input min-h-9 text-xs" placeholder="Oracle reference (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
              <div className="grid grid-cols-3 gap-1.5">{(['submitted', 'approved', 'rejected'] as const).map((s) =>
                <button key={s} type="button" disabled={busy} onClick={() => oracle(s)} className="min-h-9 rounded-lg bg-white text-xs font-semibold capitalize text-brand-800 ring-1 ring-slate-300 disabled:opacity-50">{s}</button>)}</div>
            </div>
          )}
          {err != null && <div className="mt-1"><ErrorBox error={err} /></div>}
          {done && <p role="status" className="mt-1 text-xs text-status-green">{done}</p>}
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <div className="rounded-lg px-2 py-1 ring-1 ring-slate-200"><span className="text-slate-500">Leave before</span><b className="block tabular-nums">{prev ? `${prev.codes.join('+')} ${range(prev.start, prev.end)}` : '—'}</b></div>
          <div className="rounded-lg px-2 py-1 ring-1 ring-slate-200"><span className="text-slate-500">Leave after</span><b className="block tabular-nums">{next ? `${next.codes.join('+')} ${range(next.start, next.end)}` : '—'}</b></div>
        </div>

        <section>
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Staffing</h3>
          <ImpactPreview leave={{ employeeId: p.id, start: item.start, end: item.end, typeCode: item.typeCode, recordIds: records.map((r) => r.id) }} counted={counted} />
        </section>

        {versions.length > 0 && (
          <details className="rounded-lg ring-1 ring-slate-200">
            <summary className="cursor-pointer px-2 py-1.5 text-xs font-semibold text-slate-700">Versions ({versions.reduce((n, v) => n + v.length, 0)})</summary>
            <div className="space-y-2 px-2 pb-2">{versions.map((v) => <VersionList key={v[0].root_id} versions={v} />)}</div>
          </details>
        )}

        <div className="flex flex-wrap gap-1.5 text-xs font-medium">
          {request ? <Link to="/requests?view=approvals" className="rounded-lg bg-brand-700 px-3 py-2 text-white">Review in Approvals ›</Link> : <>
            {(item.approval === 'awaiting' || item.approval === 'lapsed') && <Link to="/requests?view=leave" className="rounded-lg bg-brand-700 px-3 py-2 text-white">Approve in Requests › Leave</Link>}
            <Link to={change} className="rounded-lg px-3 py-2 text-brand-700 ring-1 ring-slate-200">Change dates</Link>
            {!item.cancelAsked && time !== 'taken' && <Link to={`/requests?view=entry&card=leave&emp=${p.id}&cancel=${records[0].id}`} className="rounded-lg px-3 py-2 text-status-red ring-1 ring-slate-200">Cancel leave…</Link>}
          </>}
          <Link to={`/employees/${p.id}`} className="rounded-lg px-3 py-2 text-slate-700 ring-1 ring-slate-200">Profile</Link>
        </div>
      </div>
    </BottomSheet>
  );
}
