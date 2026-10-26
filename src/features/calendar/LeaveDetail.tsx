// Leave detail sheet (Calendar, owner 26 Oct 2026): tap a leave or a request in the Calendar and see, in one sheet, the
// person, the leave with its state (the same colours as the List), the leave before and after, the staffing impact and
// the versions — and act on it here, with the existing actions only:
// - a planned PV: Approve · Reject (reason) · Send to the Coordinator (note) · Undo — the Section Head only (leave_approve,
//   leave_decline, leave_send_fix check it again); Reschedule opens the PV form (new dates and its check);
// - leave that is cancelled by a request (fixed types): Cancel with a reason, through the same server check as Requests;
// - a request waiting: Review in Approvals (its own check).
// Nothing changes by itself; the Calendar keeps its place (the sheet stays open and shows the new state).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isOpenEnd } from '@/core/leave';
import { isPlanPv } from '@/core/oracle';
import type { ApprovalState, PendingLeaveRequest, PlanState, RowState, ShutdownPeriod, TimeState } from '@/core/leave/status';
import { cancelLeaveEntry } from '@/data/entry';
import { GateBlocked } from '@/data/gate';
import { approveLeave, declineLeave, fetchLeaveVersions, sendLeaveToFix } from '@/data/leave';
import type { EmployeeDirectoryRow, LeaveRecord } from '@/data/types';
import { VersionList } from '@/features/leave/LeaveVersions';
import { BottomSheet, ErrorBox, cx } from '@/ui/components';
import { shortDate } from '@/ui/leave';
import { leaveTone } from '@/ui/leaveTypes';
import { backHere } from './filters';
import { ImpactPreview } from './ImpactPreview';
import { REQUEST_BAR, ROW_STYLE } from './rowStyle';

/** One leave as the Calendar lists it: joined records, a cancelled / replaced version, or a request waiting. */
export interface LeaveItem {
  key: string; p: EmployeeDirectoryRow; start: string; end: string; codes: string[]; typeCode: string | null; place: string; home: string | null; actual: string | null;
  records: LeaveRecord[]; movedFrom: string | null; movedTo: string | null; approval: ApprovalState | null; plan: PlanState; time: TimeState | null;
  state: RowState; label: string; /** cancelled through a request (fixed leave types; a PV is moved, not cancelled) */ cancellable: boolean;
  request: PendingLeaveRequest | null; cancelAsked: boolean;
  /** Not approved and overlapping a planned shutdown: may still be cancelled for it (display only). */
  sd: ShutdownPeriod | null;
}
const range = (s: string, e: string) => (isOpenEnd(e) ? `${shortDate(s)} – return open` : s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}`);
const days = (s: string, e: string) => Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1;
const POS: Record<string, string> = { controller: 'Controller', vr_controller: 'VR Controller', morning_controller: 'Morning Controller', panel_operator: 'Panel Operator', field_operator: 'Field Operator' };
type Ask = null | 'reject' | 'fix' | 'cancel';

export function LeaveDetail({ item, around, isHead, onClose, onChanged }: {
  item: LeaveItem; /** the person's other leaves (joined), oldest first */ around: { start: string; end: string; codes: string[] }[];
  today: string; isHead: boolean; onClose: () => void; onChanged: () => void;
}) {
  const { p, records, request } = item;
  const [versions, setVersions] = useState<LeaveRecord[][]>([]);
  const [ask, setAsk] = useState<Ask>(null); const [text, setText] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState<{ msg: string; undo?: () => Promise<unknown> } | null>(null);
  useEffect(() => {
    let live = true;
    const roots = [...new Set(records.map((r) => r.root_id))];
    Promise.all(roots.map((r) => fetchLeaveVersions(r).catch(() => []))).then((v) => live && setVersions(v.filter((x) => x.length > 1)));
    return () => { live = false; };
  }, [records]);
  const prev = [...around].reverse().find((l) => l.end < item.start) ?? null;
  const next = around.find((l) => l.start > item.end) ?? null;
  const st = ROW_STYLE[item.state];
  const ids = records.map((r) => r.id);
  const pv = isPlanPv(item.typeCode) && item.plan === 'current';
  const decided = records.some((r) => r.approved_at) ? 'approved' : records.some((r) => r.declined_at) ? 'declined' : records.some((r) => r.fix_sent_at) ? 'fix' : null;
  const counted = !request && item.plan === 'current' && item.approval !== 'lapsed' && item.approval !== 'declined';
  const back = `&back=${backHere()}`;

  async function act(fn: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); setDone({ msg, undo }); setAsk(null); setText(''); onChanged(); }
    catch (e) { setErr(e instanceof GateBlocked ? new Error(e.message) : e); } finally { setBusy(false); }
  }
  const approve = () => act(() => approveLeave(ids, true), 'Approved.', () => approveLeave(ids, false));
  const reject = () => act(() => declineLeave(ids, true, text), 'Not approved. The reason is kept.', () => declineLeave(ids, false));
  const toFix = () => act(() => sendLeaveToFix(ids, text, true), 'Sent to the Coordinator to fix.', () => sendLeaveToFix(ids, '', false));
  const undoDecision = () => act(() => (decided === 'approved' ? approveLeave(ids, false) : decided === 'declined' ? declineLeave(ids, false) : sendLeaveToFix(ids, '', false)), 'Back to planned (not approved).');
  const cancel = () => { const r = records[0];
    return act(() => cancelLeaveEntry({ employeeId: p.id, recordId: r.id, code: r.absence_type_code ?? '', label: item.codes.join('+'), start: r.start_date, end: r.end_date, reason: text, summaryDates: range(r.start_date, r.end_date) }),
      isHead ? 'Cancelled. The leave is kept in the history.' : 'Cancellation sent to the Section Head.'); };
  const reschedule = `/requests?view=entry&card=pv&emp=${p.id}&leave=${records[0]?.start_date ?? item.start}${back}`;
  const btn = 'min-h-10 rounded-xl px-3 text-sm font-semibold ring-1 disabled:opacity-50';

  return (
    <BottomSheet open onClose={onClose} title={p.display_name}>
      <div className="space-y-2.5 text-sm">
        <p className="-mt-1 text-xs text-slate-600">#{p.employee_number} · {POS[p.position_code ?? ''] ?? p.position_label ?? '—'}{p.grade ? ` · G${p.grade}` : ''} · {item.place}</p>

        <div className={cx('rounded-xl border-l-[3px] px-3 py-2', st.row, request && REQUEST_BAR)}>
          <div className="flex flex-wrap items-center gap-1.5">
            {item.codes.map((c) => <span key={c} className={cx('rounded px-1.5 py-px text-[11px] font-bold', leaveTone(item.typeCode).chip)}>{c}{item.movedFrom !== null ? ' ↻' : ''}</span>)}
            <b className={cx('tabular-nums', item.state === 'cancelled' && 'line-through decoration-red-300')}>{range(item.start, item.end)}</b>{!isOpenEnd(item.end) && <span className="text-slate-500">· {days(item.start, item.end)} d</span>}
            <span className={cx('ml-auto text-xs font-bold', st.text)}>{item.label}</span>
          </div>
          <div className="mt-1 space-y-0.5 text-xs text-slate-600">
            {request && <p>Requested {shortDate(request.requestedAt.slice(0, 10))} · waiting for the Section Head · not in the plan yet</p>}
            {records.find((r) => r.approved_at) && <p>Approved{records[0].approved_by_name ? ` by ${records[0].approved_by_name}` : ''} {shortDate(records.find((r) => r.approved_at)!.approved_at!.slice(0, 10))}</p>}
            {records.find((r) => r.declined_at) && <p className="text-red-700">Not approved: {records.find((r) => r.declined_at)!.declined_reason ?? 'no reason given'}</p>}
            {records.find((r) => r.fix_sent_at) && <p className="text-amber-800">Sent to the Coordinator to fix{records.find((r) => r.fix_sent_at)!.fix_note ? `: ${records.find((r) => r.fix_sent_at)!.fix_note}` : ''}</p>}
            {item.approval === 'lapsed' && <p className="text-amber-800">{item.sd ? 'Shutdown rule: counted as planned available until you decide. Not confirmed attendance.' : 'Started without your approval: the current rule counts this person as planned available. Not confirmed attendance.'}</p>}
            {item.approval === 'awaiting' && item.sd && <p className="text-amber-800">Counted as on leave until its first day; if still not approved then, counted as planned available for the shutdown.</p>}
            {item.sd && <p className="font-semibold text-amber-800">Shutdown — Cancellation possible · {item.sd.title} {shortDate(item.sd.start)}–{shortDate(item.sd.end)}</p>}
            {item.movedFrom !== null && <p>↻ {item.movedFrom ? `moved from ${item.movedFrom}` : 'rescheduled'}</p>}
            {item.movedTo && <p>Replaced: now {item.movedTo}</p>}
            {records.length > 1 && <p>{records.length} records back to back, one leave</p>}
            {item.cancelAsked && <p className="text-red-700">A cancellation is waiting for the Section Head.</p>}
          </div>
        </div>

        {/* actions: the existing workflow only, shown by the record's state and your role */}
        {item.plan === 'current' && (
          <div className="space-y-1.5">
            {done && <p role="status" className="flex items-center gap-2 text-xs font-medium text-status-green">{done.msg}
              {done.undo && <button type="button" disabled={busy} onClick={() => act(done.undo!, 'Undone.')} className="font-semibold text-brand-700 underline">Undo</button>}</p>}
            {request ? <Link to={`/requests?view=approvals${back}`} className={cx(btn, 'flex items-center justify-center bg-brand-700 text-white ring-brand-700')}>Review in Approvals (with its check) ›</Link> : <>
              {pv && isHead && !decided && (
                <div className="grid grid-cols-3 gap-1.5">
                  <button type="button" disabled={busy} onClick={approve} className={cx(btn, 'bg-brand-700 text-white ring-brand-700')}>✓ Approve</button>
                  <button type="button" disabled={busy} onClick={() => setAsk(ask === 'reject' ? null : 'reject')} className={cx(btn, 'bg-white text-red-700 ring-slate-200')}>Reject…</button>
                  <button type="button" disabled={busy} onClick={() => setAsk(ask === 'fix' ? null : 'fix')} className={cx(btn, 'bg-white text-slate-700 ring-slate-200')}>To fix…</button>
                </div>
              )}
              {pv && isHead && decided && !done && <button type="button" disabled={busy} onClick={undoDecision} className={cx(btn, 'w-full bg-white text-slate-700 ring-slate-200')}>↶ Back to planned (undo {decided === 'approved' ? 'approval' : decided === 'declined' ? 'rejection' : 'send to fix'})</button>}
              <div className="flex flex-wrap gap-1.5 text-xs font-medium">
                {pv && item.time !== 'taken' && <Link to={reschedule} className="rounded-lg px-3 py-2 text-brand-700 ring-1 ring-slate-200">Reschedule ›</Link>}
                {item.cancellable && !item.cancelAsked && item.time !== 'taken' && <button type="button" onClick={() => setAsk(ask === 'cancel' ? null : 'cancel')} className="rounded-lg px-3 py-2 text-red-700 ring-1 ring-slate-200">Cancel leave…</button>}
                <Link to={`/employees/${p.id}`} className="rounded-lg px-3 py-2 text-slate-700 ring-1 ring-slate-200">Profile</Link>
              </div>
            </>}
            {ask && (
              <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
                <label className="block text-xs font-medium text-slate-700" htmlFor="leave-act-text">{ask === 'reject' ? 'Reason (kept with the leave)' : ask === 'fix' ? 'What to fix (sent to the Coordinator)' : 'Reason for cancelling (required)'}</label>
                <textarea id="leave-act-text" rows={2} className="input py-1.5 text-sm" value={text} onChange={(e) => setText(e.target.value)} />
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => { setAsk(null); setText(''); }} className={cx(btn, 'flex-1 bg-white text-slate-700 ring-slate-200')}>Keep</button>
                  <button type="button" disabled={busy || !text.trim()} onClick={ask === 'reject' ? reject : ask === 'fix' ? toFix : cancel}
                    className={cx(btn, 'flex-1 text-white', ask === 'fix' ? 'bg-brand-700 ring-brand-700' : 'bg-status-red ring-status-red')}>{ask === 'reject' ? 'Reject' : ask === 'fix' ? 'Send to fix' : isHead ? 'Cancel leave' : 'Send cancellation'}</button>
                </div>
              </div>
            )}
            {err != null && <ErrorBox error={err} />}
          </div>
        )}

        <section>
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Staffing{pv && item.approval !== 'approved' ? ' · before you approve' : ''}</h3>
          <ImpactPreview leave={{ employeeId: p.id, start: item.start, end: item.end, typeCode: item.typeCode, recordIds: item.plan === 'current' ? ids : [] }} counted={counted} />
        </section>

        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <div className="rounded-lg px-2 py-1 ring-1 ring-slate-200"><span className="text-slate-500">Leave before</span><b className="block tabular-nums">{prev ? `${prev.codes.join('+')} ${range(prev.start, prev.end)}` : '—'}</b></div>
          <div className="rounded-lg px-2 py-1 ring-1 ring-slate-200"><span className="text-slate-500">Leave after</span><b className="block tabular-nums">{next ? `${next.codes.join('+')} ${range(next.start, next.end)}` : '—'}</b></div>
        </div>

        {versions.length > 0 && (
          <details className="rounded-lg ring-1 ring-slate-200">
            <summary className="cursor-pointer px-2 py-1.5 text-xs font-semibold text-slate-700">Versions ({versions.reduce((n, v) => n + v.length, 0)})</summary>
            <div className="space-y-2 px-2 pb-2">{versions.map((v) => <VersionList key={v[0].root_id} versions={v} />)}</div>
          </details>
        )}
        {item.plan !== 'current' && <Link to={`/employees/${p.id}`} className="inline-block rounded-lg px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200">Profile</Link>}
      </div>
    </BottomSheet>
  );
}
