// Change requests (reschedule): the Manpower Coordinator picks the employee, the leave and the new dates with a remark,
// sees at once whether the crews would be short (red), and sends it; the Section Head decides it in Requests › Forms.
import { AlertTriangle, Check, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { LeaveApproval } from '@/core/controllers/leaveRules';
import { personOn, type MpAbsence, type MpPerson } from '@/core/manpower';
import { expectedRequest, isRestDay, oracleDays } from '@/core/oracle/expected';
import { addDaysIso, isValidIsoDate } from '@/core/roster';
import { fetchLeaveApprovals } from '@/data/controllers';
import { createChangeRequest, decideChangeRequest, fetchChangeCounts, fetchRequesterNames, withdrawChangeRequest, type ChangeRequest, type ChangeStatus } from '@/data/changeRequests';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { BottomSheet, Button, Chip, ErrorBox, Field, Spinner, cx, type Tone } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';
import { OraclePill } from '@/ui/oracle';
import { leaveImpact, type LeaveImpact, type MergedLeave } from './leaveTools';
import { CheckPanel } from './CheckPanel';
import { checkProposal, type Check as ScheduleCheck } from '@/data/validation';
import { hasHardStop } from '@/core/validation';

const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
const weekday = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
const daysIn = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

export const CHANGE_LABEL: Record<ChangeStatus, string> = { requested: 'Waiting for the Section Head', approved: 'Approved', not_approved: 'Not approved', withdrawn: 'Withdrawn' };
const CHANGE_TONE: Record<ChangeStatus, Tone> = { requested: 'blue', approved: 'green', not_approved: 'red', withdrawn: 'neutral' };
export const ChangeChip = ({ status }: { status: ChangeStatus }) => <Chip tone={CHANGE_TONE[status]}>{CHANGE_LABEL[status]}</Chip>;

/** The shortage check, red when a crew would fall short or two Controllers would be off together. */
function ImpactBox({ impact, label }: { impact: LeaveImpact; label?: string }) {
  const bad = impact.short > 0 || impact.clash.length > 0;
  return (
    <div className={cx('rounded-lg px-3 py-2 text-sm ring-1', bad ? 'bg-red-50 text-red-900 ring-red-300' : 'bg-green-50 text-green-900 ring-green-200')}>
      {label && <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</div>}
      {bad ? <>
        {impact.short > 0 && <div className="flex items-start gap-1 font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Crew short on {impact.short} dut{impact.short === 1 ? 'y' : 'ies'}: {impact.dates.slice(0, 6).map(shortDate).join(', ')}{impact.dates.length > 6 ? ` and ${impact.dates.length - 6} more` : ''}</div>}
        {impact.clash.length > 0 && <div className="flex items-start gap-1 font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />2 Controllers off together · with {impact.clash.join(', ')}</div>}
      </> : <div className="flex items-center gap-1 font-medium"><Check className="h-4 w-4" />No shortage with these dates</div>}
    </div>
  );
}

/** Propose new dates for one leave, with the remark; the crews' cover is checked as the dates change. */
export function ProposeSheet({ person, leave, inputs, approvals, today, changes, onBack, onDone }: { person: MpPerson; leave: MergedLeave; inputs: ManpowerInputs; approvals: LeaveApproval[]; today: string; /** approved changes this year, counted on him */ changes?: number; onBack: () => void; onDone: (m: string) => void }) {
  const crewOn = (d: string) => { const q = personOn(person, d); return q.dayDuty ? null : q.crew; };
  const [start, setStart] = useState(leave.start); const [end, setEnd] = useState(leave.end);
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const valid = isValidIsoDate(start) && isValidIsoDate(end) && end >= start;
  const unchanged = start === leave.start && end === leave.end;
  // the plan keeps the rest days after the last duty day (workbook convention)
  let planEnd = end; if (valid) for (let i = 0; i < 10 && isRestDay(addDaysIso(planEnd, 1), crewOn(addDaysIso(planEnd, 1))); i++) planEnd = addDaysIso(planEnd, 1);
  const exp = valid ? expectedRequest(start, planEnd, crewOn) : null;
  const now = expectedRequest(leave.start, leave.end, crewOn);
  const impact = useMemo(() => (valid && !unchanged ? leaveImpact(person, leave.records, inputs, approvals, start, planEnd, today) : null), [valid, unchanged, person, leave, inputs, approvals, start, planEnd, today]);
  async function send() {
    setBusy(true); setErr(null);
    try {
      await createChangeRequest({ records: leave.records.map((r) => r.id!), start, end: planEnd, remark: remark.trim(), impact: impact ?? { short: 0, dates: [], clash: [] } });
      onDone(`${person.name}: request to move the leave to ${range(start, planEnd)} sent to the Section Head.`);
    } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onBack} title="Request: reschedule">
      <div className="space-y-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
          <div className="font-medium text-slate-800">{person.name}</div>
          <div className="text-xs text-slate-600">Now: <b>{range(leave.start, leave.end)}</b>{now ? ` · ${now.days} days in Oracle · back ${weekday(now.backOn)} ${shortDate(now.backOn)}` : ''}</div>
          {leave.oracle && <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">Oracle now <OraclePill status={leave.oracle} /></div>}
          {changes !== undefined && <div className="mt-1 text-xs font-medium text-amber-800">Counted on him: {changes === 0 ? 'no change approved this year, this would be the first' : `${changes} change${changes === 1 ? '' : 's'} approved this year, this would be no. ${changes + 1}`}</div>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="New first day"><input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
          <Field label="New last day"><input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {valid && !unchanged && <>
          <p className="text-sm font-medium text-slate-800">New plan {range(start, planEnd)} · {oracleDays(start, end)} days in Oracle{exp ? ` · back ${weekday(exp.backOn)} ${shortDate(exp.backOn)}` : ''}</p>
          {impact && <ImpactBox impact={impact} />}
        </>}
        <Field label="Remark"><input className="input" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. Employee asked to move it a week later" /></Field>
        <p className="text-xs text-slate-500">Nothing changes in the plan until the Section Head approves. A crew shortage does not stop you sending it, but say why in the remark.</p>
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onBack}>Back</Button>
          <Button className="flex-1" disabled={busy || !valid || unchanged || !remark.trim()} onClick={send}>{busy ? 'Sending…' : 'Send request'}</Button>
        </div>
      </div>
    </BottomSheet>
  );
}

/** One reschedule request: its dates, the crews' check, and the Section Head's decision (checked again on the server). */
export function ChangeRequestSheet({ req, name, isHead, onClose, onDone }: { req: ChangeRequest; name: string; isHead: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const today = localToday();
  const [state, setState] = useState<{ inputs: ManpowerInputs; approvals: LeaveApproval[]; by: string | null; changes: number } | null>(null);
  const [remarks, setRemarks] = useState(''); const [reason, setReason] = useState(''); const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null);
  const open = req.status === 'requested';
  useEffect(() => {
    const y = Number(today.slice(0, 4));
    Promise.all([fetchManpowerInputs(`${y}-01-01`, `${y + 1}-12-31`), fetchLeaveApprovals(), fetchRequesterNames(req.requested_by ? [req.requested_by] : []), fetchChangeCounts(y)])
      .then(([inputs, approvals, names, counts]) => setState({ inputs, approvals, by: req.requested_by ? names.get(req.requested_by) ?? null : null, changes: counts.get(req.employee_id) ?? 0 })).catch(setErr);
  }, [req, today]);
  const person = state?.inputs.people.find((p) => p.id === req.employee_id) ?? null;
  const records: MpAbsence[] = state ? state.inputs.absences.filter((a) => req.record_ids.includes(a.id ?? '') && a.inCurrentPlan !== false && (a.status === 'approved' || a.status === 'planned')) : [];
  const stale = !!state && open && records.length !== req.record_ids.length;
  const live = state && person && open && !stale ? leaveImpact(person, records, state.inputs, state.approvals, req.new_start, req.new_end, today) : null;
  const [check, setCheck] = useState<ScheduleCheck | null>(null); const [checkErr, setCheckErr] = useState<unknown>(null);
  const first = records[0];
  useEffect(() => {
    if (!open || !first) return;
    checkProposal({ kind: 'reschedule', employeeId: req.employee_id, recordIds: req.record_ids, start: req.new_start, end: req.new_end, typeCode: first.typeCode, typeShort: first.typeShort ?? 'PV' })
      .then(setCheck).catch(setCheckErr);
  }, [open, first, req]);
  const hard = !!check && hasHardStop(check.findings);
  async function decide(approve: boolean) {
    setBusy(approve ? 'yes' : 'no'); setErr(null);
    try { await decideChangeRequest(req.id, approve, remarks.trim(), check); onDone(approve ? `${name}: leave moved to ${range(req.new_start, req.new_end)}. Oracle is back to Not submitted: submit the new request in EasyHR.` : `${name}: change not approved. The plan stays as it was.`); }
    catch (e) { setErr(e); setBusy(null); }
  }
  async function withdraw() {
    setBusy('withdraw'); setErr(null);
    try { await withdrawChangeRequest(req.id, reason.trim()); onDone(`${name}: request withdrawn.`); } catch (e) { setErr(e); setBusy(null); }
  }
  return (
    <BottomSheet open onClose={onClose} title="Reschedule request">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-900">{name}</span><ChangeChip status={req.status} /></div>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
          <div className="text-slate-600">Now: <b className="text-slate-800">{range(req.old_start, req.old_end)}</b> · {daysIn(req.old_start, req.old_end)} days</div>
          <div className="text-slate-600">Asked: <b className="text-slate-800">{range(req.new_start, req.new_end)}</b> · {daysIn(req.new_start, req.new_end)} days</div>
          <div className="mt-1 text-xs text-slate-500">Remark: {req.remark}</div>
          <div className="text-xs text-slate-500">Asked {new Date(req.requested_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{state?.by ? ` by ${state.by}` : ''}</div>
          {state && open && <div className="mt-1 text-xs font-medium text-amber-800">Counted on him: {state.changes === 0 ? 'no change approved this year, this would be the first' : `${state.changes} change${state.changes === 1 ? '' : 's'} approved this year, this would be no. ${state.changes + 1}`}</div>}
        </div>
        {open && !state && !err && <Spinner />}
        {stale && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">This leave has changed since the request was made. Do not approve it: not approve it and ask for the change again.</p>}
        {live && <ImpactBox impact={live} label="Shortage check now" />}
        {open && !stale && <CheckPanel check={check} error={checkErr} />}
        {req.impact && <ImpactBox impact={req.impact} label="When it was asked" />}
        {!open && <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
          {req.status === 'withdrawn' ? <>Withdrawn: {req.withdraw_reason}</> : <>Decision: <b className={req.status === 'approved' ? 'text-status-green' : 'text-status-red'}>{CHANGE_LABEL[req.status]}</b>{req.decision_remarks ? ` · ${req.decision_remarks}` : ''}</>}
        </div>}
        {err != null && <ErrorBox error={err} />}
        {open && isHead && (
          <>
            <Field label="Remarks (optional)"><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Agreed, keep the Oracle request in the new dates" /></Field>
            <div className="flex gap-2">
              <Button variant="danger" className="flex-1" disabled={busy !== null} onClick={() => decide(false)}><X className="h-4 w-4" />{busy === 'no' ? 'Saving…' : 'Not approved'}</Button>
              <Button className="flex-1" disabled={busy !== null || stale || !check || hard} onClick={() => decide(true)}><Check className="h-4 w-4" />{busy === 'yes' ? 'Saving…' : 'Approve'}</Button>
            </div>
          </>
        )}
        {open && !isHead && <p className="text-xs text-slate-500">Waiting for the Section Head to decide.</p>}
        {open && (withdrawing
          ? <div className="space-y-2"><Field label="Reason for withdrawing"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setWithdrawing(false)}>Back</Button><Button variant="danger" className="flex-1" disabled={busy !== null || !reason.trim()} onClick={withdraw}>Withdraw</Button></div></div>
          : <button type="button" onClick={() => setWithdrawing(true)} className="w-full py-1 text-center text-sm font-medium text-status-red">Withdraw this request…</button>)}
      </div>
    </BottomSheet>
  );
}
