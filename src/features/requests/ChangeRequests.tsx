// Change requests (reschedule): pick the employee, the leave (or a cancelled PV, the leave owed) and the new dates with a
// remark; the full check runs as the dates change. The Coordinator sends it and the Section Head decides it in Requests ›
// Approvals, where he can change the dates first. The Section Head's own change is approved at once (same server check).
import { AlertTriangle, Check, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { LeaveApproval } from '@/core/controllers/leaveRules';
import { personOn, type MpAbsence, type MpPerson } from '@/core/manpower';
import { expectedRequest, isRestDay, oracleDays } from '@/core/oracle/expected';
import { addDaysIso, isValidIsoDate } from '@/core/roster';
import { fetchLeaveApprovals } from '@/data/controllers';
import { createChangeRequest, decideChangeRequest, fetchChangeCounts, fetchRequesterNames, withdrawChangeRequest, type ChangeRequest, type ChangeStatus } from '@/data/changeRequests';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { saveWorkingPlan } from '@/data/workingPlan';
import { BottomSheet, Button, Chip, ErrorBox, Field, Spinner, cx, type Tone } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';
import { OraclePill } from '@/ui/oracle';
import { leaveImpact, type LeaveImpact, type MergedLeave } from './leaveTools';
import { CheckPanel } from './CheckPanel';
import { checkProposal, type Check as ScheduleCheck } from '@/data/validation';
import { hasHardStop } from '@/core/validation';
import { gateVerdict } from '@/core/requests/gate';
import { amendChangeRequest } from '@/data/changeRequests';

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

/** The full check of new dates for a leave (the same check the server runs before approving), as the dates change. */
function useDatesCheck(employeeId: string, recordIds: string[], typeCode: string | null | undefined, typeShort: string | null | undefined, start: string, end: string, on: boolean, nonce = 0) {
  const [check, setCheck] = useState<ScheduleCheck | null>(null); const [err, setErr] = useState<unknown>(null);
  const key = `${recordIds.join()}|${start}|${end}|${nonce}`;
  useEffect(() => {
    setCheck(null); setErr(null);
    if (!on) return;
    let live = true;
    const t = setTimeout(() => {
      checkProposal({ kind: 'reschedule', employeeId, recordIds, start, end, typeCode: typeCode ?? 'annual_leave_planned', typeShort: typeShort ?? 'PV' })
        .then((c) => live && setCheck(c)).catch((e) => live && setErr(e));
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [key, on]); // eslint-disable-line react-hooks/exhaustive-deps
  const verdict = check ? gateVerdict(check.findings, false) : null;
  return { check, err, verdict };
}

/**
 * A hard stop made by a run of duty days that starts on his shutdown team: would a day (or two) off the team at the end
 * of that part fix it? The same check runs as if; the first that passes is proposed. Null when it is not that case.
 */
function useSdFix(check: ScheduleCheck | null) {
  const [fix, setFix] = useState<{ dates: string[]; check: ScheduleCheck } | null>(null);
  const f = check?.findings.find((x) => x.rule === 'max_consecutive_duty_days' && x.severity === 'hard_stop' && x.run?.sd.length);
  const key = f ? `${check!.ranAt}|${f.key}` : '';
  useEffect(() => {
    setFix(null);
    if (!f || !check) return;
    let live = true;
    (async () => {
      const sd = f.run!.sd;
      for (const n of [1, 2]) {
        if (sd.length < n) break;
        const dates = sd.slice(-n);
        const c = await checkProposal(check.proposal, { sdOff: dates });
        if (!live) return;
        if (!hasHardStop(c.findings)) { setFix({ dates, check: c }); return; }
      }
    })().catch(() => {});
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return fix;
}

/** One line: the day off the shutdown team that would fix the hard stop, and Apply (the team day is set to off). */
function SdFixLine({ fix, person, inputs, onApplied }: { fix: { dates: string[]; check: ScheduleCheck }; person: MpPerson; inputs: ManpowerInputs; onApplied: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const member = inputs.assignments.find((a) => a.kind === 'sd_team' && a.employeeId === person.id && !a.rest && a.id.startsWith('sd-') && fix.dates.every((d) => a.start <= d && d <= a.end));
  const worst = fix.check.worst;
  async function apply() {
    if (!member) return;
    setBusy(true); setErr(null);
    try { await saveWorkingPlan(fix.dates.map((d) => ({ memberId: member.id.slice(3), date: d, works: false, hours: null, locked: true, unavailable: false })), []); onApplied(); }
    catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900 ring-1 ring-brand-200">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1"><b>Fix:</b> {fix.dates.map(shortDate).join(' and ')} off the shutdown team → {worst === null ? 'no rule broken' : worst === 'critical' ? 'crew short: Section Head may accept' : 'only warnings'}.</span>
        {member && <Button className="min-h-9 shrink-0" disabled={busy} onClick={apply}>{busy ? 'Applying…' : 'Apply'}</Button>}
      </div>
      {err != null && <ErrorBox error={err} />}
    </div>
  );
}

const EstimateSwitch = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
    <input type="checkbox" className="mt-0.5" checked={value} onChange={(e) => onChange(e.target.checked)} />
    <span><b>Dates not confirmed yet</b><span className="block text-xs text-slate-500">Kept as an estimate (shown with a mark, and on the notices) until you confirm it.</span></span>
  </label>
);

/**
 * New dates for one leave, with the remark; the crews and the person's schedule are checked as the dates change.
 * `leave.replan`: a cancelled PV (the leave owed): approval adds it back with the new dates.
 */
export function ProposeSheet({ person, leave, inputs, approvals, today, changes, isHead = false, onBack, onDone }: { person: MpPerson; leave: MergedLeave & { replan?: boolean }; inputs: ManpowerInputs; approvals: LeaveApproval[]; today: string; /** approved changes this year, counted on him */ changes?: number; isHead?: boolean; onBack: () => void; onDone: (m: string) => void }) {
  const crewOn = (d: string) => { const q = personOn(person, d); return q.dayDuty ? null : q.crew; };
  const replan = !!leave.replan;
  const [start, setStart] = useState(replan ? '' : leave.start); const [end, setEnd] = useState(replan ? '' : leave.end);
  const [remark, setRemark] = useState(''); const [estimated, setEstimated] = useState(leave.estimated);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const valid = isValidIsoDate(start) && isValidIsoDate(end) && end >= start;
  const unchanged = !replan && start === leave.start && end === leave.end;
  // the plan keeps the rest days after the last duty day (workbook convention)
  let planEnd = end; if (valid) for (let i = 0; i < 10 && isRestDay(addDaysIso(planEnd, 1), crewOn(addDaysIso(planEnd, 1))); i++) planEnd = addDaysIso(planEnd, 1);
  const exp = valid ? expectedRequest(start, planEnd, crewOn) : null;
  const now = replan ? null : expectedRequest(leave.start, leave.end, crewOn);
  const days = oracleDays(leave.start, leave.end);
  const first = leave.records[0];
  const impactRecords = replan ? [] : leave.records;
  const impact = useMemo(() => (valid && !unchanged ? leaveImpact(person, impactRecords.length ? impactRecords : [first], inputs, approvals, start, planEnd, today) : null), [valid, unchanged, person, leave, inputs, approvals, start, planEnd, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nonce, setNonce] = useState(0);
  const { check, err: checkErr, verdict } = useDatesCheck(person.id, leave.records.map((r) => r.id!), first?.typeCode, first?.typeShort, start, planEnd, valid && !unchanged, nonce);
  const hard = !!check && hasHardStop(check.findings);
  const sdFix = useSdFix(hard ? check : null);
  // the Section Head's own change is approved at once: only when the server would approve it
  const headBlocked = isHead && !!verdict && !verdict.allowed;
  async function send() {
    setBusy(true); setErr(null);
    try {
      const id = await createChangeRequest({ records: leave.records.map((r) => r.id!), start, end: planEnd, remark: remark.trim(), impact: impact ?? { short: 0, dates: [], clash: [] }, estimated });
      if (isHead) {
        await decideChangeRequest(id, true, '', check);
        onDone(`${person.name}: leave ${replan ? 'given new dates' : 'moved'}: ${range(start, planEnd)}${estimated ? ' (estimate)' : ''}. Oracle: submit the request in EasyHR.`);
      } else onDone(`${person.name}: request for ${range(start, planEnd)} sent to the Section Head.`);
    } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onBack} title={replan ? 'Leave owed: new dates' : isHead ? 'Reschedule' : 'Request: reschedule'}>
      <div className="space-y-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
          <div className="font-medium text-slate-800">{person.name}</div>
          {replan
            ? <div className="text-xs text-slate-600">Cancelled: <b>{range(leave.start, leave.end)}</b> · {days} working days to give again</div>
            : <div className="text-xs text-slate-600">Now: <b>{range(leave.start, leave.end)}</b>{now ? ` · ${now.days} working days · back ${weekday(now.backOn)} ${shortDate(now.backOn)}` : ''}</div>}
          {leave.oracle && !replan && <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">Now <OraclePill status={leave.oracle} /></div>}
          {changes !== undefined && !replan && <div className="mt-1 text-xs font-medium text-amber-800">Counted on him: {changes === 0 ? 'no change approved this year, this would be the first' : `${changes} change${changes === 1 ? '' : 's'} approved this year, this would be no. ${changes + 1}`}</div>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="New first day"><input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (!end || e.target.value > end) setEnd(e.target.value); }} /></Field>
          <Field label="New last day"><input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {valid && !unchanged && <>
          <p className="text-sm font-medium text-slate-800">New plan {range(start, planEnd)} · {oracleDays(start, end)} working days{replan && oracleDays(start, end) !== days ? ` (owed ${days})` : ''}{exp ? ` · back ${weekday(exp.backOn)} ${shortDate(exp.backOn)}` : ''}</p>
          {impact && <ImpactBox impact={impact} />}
          <CheckPanel check={check} error={checkErr} fix={hard && sdFix ? <SdFixLine fix={sdFix} person={person} inputs={inputs} onApplied={() => setNonce((n) => n + 1)} /> : undefined} />
          {verdict && !verdict.allowed && !hard && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900 ring-1 ring-red-200">{isHead ? 'Cover the crew first (Shift change / cover), then save these dates.' : 'The crew must be covered before the Section Head can approve these dates. You can send it: say how in the remark.'}</p>}
        </>}
        <EstimateSwitch value={estimated} onChange={setEstimated} />
        <Field label="Remark"><input className="input" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={replan ? 'e.g. Leave owed after the Train-2 shutdown' : 'e.g. Employee asked to move it a week later'} /></Field>
        <p className="text-xs text-slate-500">{isHead ? 'Saved and approved at once, after the same check the server runs.' : 'Nothing changes in the plan until the Section Head approves.'}</p>
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onBack}>Back</Button>
          <Button className="flex-1" disabled={busy || !valid || unchanged || !remark.trim() || !check || hard || headBlocked} onClick={send}>{busy ? 'Saving…' : isHead ? 'Save' : 'Send request'}</Button>
        </div>
        {valid && !unchanged && !busy && (hard || headBlocked || !remark.trim()) && (
          <p className="text-xs font-medium text-red-800">{hard ? `${isHead ? 'Save' : 'Send'} is off: a hard stop above. ${sdFix ? 'Apply the fix above, or choose other dates' : 'Choose dates that avoid it'}.` : headBlocked ? 'Save is off: cover the crew first.' : `Add a remark to ${isHead ? 'save' : 'send'}.`}</p>
        )}
      </div>
    </BottomSheet>
  );
}

/** One reschedule request: its dates, the full check, and the Section Head's decision; he may change the dates first. */
export function ChangeRequestSheet({ req, name, isHead, onClose, onDone }: { req: ChangeRequest; name: string; isHead: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const today = localToday();
  const [state, setState] = useState<{ inputs: ManpowerInputs; approvals: LeaveApproval[]; by: string | null; changes: number } | null>(null);
  const [remarks, setRemarks] = useState(''); const [reason, setReason] = useState(''); const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null);
  const [start, setStart] = useState(req.new_start); const [end, setEnd] = useState(req.new_end); const [estimated, setEstimated] = useState(req.estimated);
  const [editing, setEditing] = useState(false);
  const open = req.status === 'requested';
  useEffect(() => {
    const y = Number(today.slice(0, 4));
    Promise.all([fetchManpowerInputs(`${y}-01-01`, `${y + 1}-12-31`), fetchLeaveApprovals(), fetchRequesterNames(req.requested_by ? [req.requested_by] : []), fetchChangeCounts(y)])
      .then(([inputs, approvals, names, counts]) => setState({ inputs, approvals, by: req.requested_by ? names.get(req.requested_by) ?? null : null, changes: counts.get(req.employee_id) ?? 0 })).catch(setErr);
  }, [req, today]);
  const person = state?.inputs.people.find((p) => p.id === req.employee_id) ?? null;
  // a part that started without approval (lapsed) is still the leave this request moves
  const records: MpAbsence[] = state ? state.inputs.absences.filter((a) => req.record_ids.includes(a.id ?? '') && (a.inCurrentPlan !== false || a.lapsed) && (a.status === 'approved' || a.status === 'planned')) : [];
  const stale = !!state && open && !req.replan && records.length !== req.record_ids.length;
  const valid = isValidIsoDate(start) && isValidIsoDate(end) && end >= start;
  const changed = start !== req.new_start || end !== req.new_end || estimated !== req.estimated;
  const owed: MpAbsence = { id: req.record_ids[0], employeeId: req.employee_id, start: req.old_start, end: req.old_end, status: 'approved', typeCode: 'annual_leave_planned', typeShort: 'PV', inCurrentPlan: true };
  const live = state && person && open && !stale && valid ? leaveImpact(person, req.replan ? [owed] : records, state.inputs, state.approvals, start, end, today) : null;
  const first = records[0];
  const { check, err: checkErr, verdict } = useDatesCheck(req.employee_id, req.record_ids, first?.typeCode, first?.typeShort, start, end, open && !stale && valid && (req.replan || !!first));
  const blocked = !!verdict && !verdict.allowed;
  async function decide(approve: boolean) {
    setBusy(approve ? 'yes' : 'no'); setErr(null);
    try {
      if (approve && changed) await amendChangeRequest(req.id, start, end, estimated);
      await decideChangeRequest(req.id, approve, remarks.trim(), check);
      onDone(approve ? `${name}: leave ${req.replan ? 'given new dates' : 'moved'}: ${range(start, end)}${estimated ? ' (estimate)' : ''}. Oracle is back to Not submitted: submit the new request in EasyHR.` : `${name}: change not approved. The plan stays as it was.`);
    } catch (e) { setErr(e); setBusy(null); }
  }
  async function withdraw() {
    setBusy('withdraw'); setErr(null);
    try { await withdrawChangeRequest(req.id, reason.trim()); onDone(`${name}: request withdrawn.`); } catch (e) { setErr(e); setBusy(null); }
  }
  return (
    <BottomSheet open onClose={onClose} title={req.replan ? 'Leave owed: new dates' : 'Reschedule request'}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-900">{name}</span><ChangeChip status={req.status} /></div>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
          <div className="text-slate-600">{req.replan ? 'Cancelled' : 'Now'}: <b className="text-slate-800">{range(req.old_start, req.old_end)}</b> · {daysIn(req.old_start, req.old_end)} days</div>
          <div className="text-slate-600">Asked: <b className="text-slate-800">{range(req.new_start, req.new_end)}</b> · {daysIn(req.new_start, req.new_end)} days{req.estimated ? ' · estimate' : ''}</div>
          <div className="mt-1 text-xs text-slate-500">Remark: {req.remark}</div>
          <div className="text-xs text-slate-500">Asked {new Date(req.requested_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{state?.by ? ` by ${state.by}` : ''}</div>
          {state && open && !req.replan && <div className="mt-1 text-xs font-medium text-amber-800">Counted on him: {state.changes === 0 ? 'no change approved this year, this would be the first' : `${state.changes} change${state.changes === 1 ? '' : 's'} approved this year, this would be no. ${state.changes + 1}`}</div>}
        </div>
        {open && isHead && !stale && (editing ? (
          <div className="space-y-2 rounded-xl bg-brand-50 p-3 ring-1 ring-brand-200">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First day"><input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
              <Field label="Last day"><input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
            </div>
            <EstimateSwitch value={estimated} onChange={setEstimated} />
            {changed && <p className="text-xs font-medium text-brand-800">Approving records {range(start, end)} · {daysIn(start, end)} days{estimated ? ' (estimate)' : ''}.</p>}
          </div>
        ) : <button type="button" onClick={() => setEditing(true)} className="w-full rounded-lg py-2 text-center text-sm font-semibold text-brand-700 ring-1 ring-brand-300">Change the dates…</button>)}
        {open && !state && !err && <Spinner />}
        {stale && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">This leave has changed since the request was made. Do not approve it: not approve it and ask for the change again.</p>}
        {live && <ImpactBox impact={live} label="Shortage check now" />}
        {open && !stale && <CheckPanel check={check} error={checkErr} />}
        {blocked && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900 ring-1 ring-red-200">{verdict!.reason}</p>}
        {req.impact && !changed && <ImpactBox impact={req.impact} label="When it was asked" />}
        {!open && <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
          {req.status === 'withdrawn' ? <>Withdrawn: {req.withdraw_reason}</> : <>Decision: <b className={req.status === 'approved' ? 'text-status-green' : 'text-status-red'}>{CHANGE_LABEL[req.status]}</b>{req.decision_remarks ? ` · ${req.decision_remarks}` : ''}</>}
        </div>}
        {err != null && <ErrorBox error={err} />}
        {open && isHead && (
          <>
            <Field label="Remarks (optional)"><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Agreed, keep the Oracle request in the new dates" /></Field>
            <div className="flex gap-2">
              <Button variant="danger" className="flex-1" disabled={busy !== null} onClick={() => decide(false)}><X className="h-4 w-4" />{busy === 'no' ? 'Saving…' : 'Not approved'}</Button>
              <Button className="flex-1" disabled={busy !== null || stale || !valid || !check || blocked} onClick={() => decide(true)}><Check className="h-4 w-4" />{busy === 'yes' ? 'Saving…' : changed ? 'Approve new dates' : 'Approve'}</Button>
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
