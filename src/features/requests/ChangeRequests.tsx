// Change requests (reschedule): the Manpower Coordinator picks the employee, the leave and the new dates with a remark,
// sees at once whether the crews would be short (red), and sends it; the Section Head decides it in Requests › Forms.
import { AlertTriangle, CalendarClock, Check, ChevronRight, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { LeaveApproval } from '@/core/controllers/leaveRules';
import { personOn, type MpAbsence, type MpPerson } from '@/core/manpower';
import { expectedRequest, isRestDay, oracleDays } from '@/core/oracle/expected';
import { addDaysIso, isValidIsoDate } from '@/core/roster';
import { fetchLeaveApprovals } from '@/data/controllers';
import { createChangeRequest, decideChangeRequest, fetchRequesterNames, withdrawChangeRequest, type ChangeRequest, type ChangeStatus } from '@/data/changeRequests';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { BottomSheet, Button, Chip, ErrorBox, Field, Spinner, cx, type Tone } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { OraclePill } from '@/ui/oracle';
import { EstimatedTag } from '@/ui/LeaveCodes';
import { leaveImpact, mergedLeaves, type LeaveImpact, type MergedLeave } from './leaveTools';
import { LeaveCodes } from '@/ui/LeaveCodes';
import { nameFilter } from '@/ui/nameSearch';
import { CheckPanel } from './CheckPanel';
import { checkProposal, type Check as ScheduleCheck } from '@/data/validation';
import { hasHardStop } from '@/core/validation';

const ROLE_LABEL: Record<string, string> = { controller: 'Shift Controller', vr_controller: 'VR Controller', morning_controller: 'Morning Controller', panel_operator: 'Panel Operator', field_operator: 'Field Operator' };
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
export function ProposeSheet({ person, leave, inputs, approvals, today, onBack, onDone }: { person: MpPerson; leave: MergedLeave; inputs: ManpowerInputs; approvals: LeaveApproval[]; today: string; onBack: () => void; onDone: (m: string) => void }) {
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

type Step = 'who' | 'what' | 'kind' | 'leave';
/** New: search the employee, then Add leave or a Request (reschedule is the only request for now), then the leave, then the new dates. */
export function NewRequestFlow({ inputs, estimated, approvals, today, onClose, onAddLeave, onDone }: { inputs: ManpowerInputs; estimated: Set<string>; approvals: LeaveApproval[]; today: string; onClose: () => void; onAddLeave: (personId: string) => void; onDone: (m: string) => void }) {
  const [step, setStep] = useState<Step>('who');
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState<MpPerson | null>(null);
  const [leave, setLeave] = useState<MergedLeave | null>(null);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    const match = nameFilter(q);
    return inputs.people.filter((p) => match([p.name, p.employeeNumber, p.arabicName])).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8);
  }, [inputs.people, q]);
  const leaves = useMemo(() => (person ? mergedLeaves(inputs.absences, person.id, estimated) : []), [inputs.absences, person, estimated]);
  const crewBadge = (p: MpPerson) => { const c = personOn(p, today); return c.dayDuty || !c.crew ? <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-600">Day</span> : <CrewBadge crew={c.crew} size="sm" />; };

  if (person && leave) return <ProposeSheet person={person} leave={leave} inputs={inputs} approvals={approvals} today={today} onBack={() => setLeave(null)} onDone={onDone} />;
  const back = step === 'who' ? onClose : () => setStep(step === 'leave' ? 'kind' : step === 'kind' ? 'what' : 'who');
  return (
    <BottomSheet open onClose={onClose} title={step === 'who' ? 'New' : step === 'leave' ? 'Which leave?' : step === 'kind' ? 'Request' : person?.name ?? 'New'}>
      <div className="space-y-3">
        {step === 'who' && <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input autoFocus type="text" inputMode="search" autoComplete="off" className="input" style={{ paddingLeft: 36 }} placeholder="Search the employee by name or number" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the employee" />
          </div>
          {!q ? <p className="text-sm text-slate-500">Type part of the name or the employee number.</p> : matches.length === 0 ? <p className="text-sm text-slate-500">Nobody found.</p> : (
            <ul className="divide-y divide-slate-100">
              {matches.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => { setPerson(p); setStep('what'); }} className="flex w-full items-center gap-2 py-2 text-left">
                    {crewBadge(p)}
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
                      <span className="block truncate text-xs text-slate-500">#{p.employeeNumber} · {ROLE_LABEL[p.role ?? ''] ?? ''}</span></span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>}
        {person && step !== 'who' && <div className="-mt-2 flex items-center gap-2 text-sm text-slate-600">{crewBadge(person)}<span className="truncate">#{person.employeeNumber} · {ROLE_LABEL[person.role ?? ''] ?? ''}</span></div>}
        {step === 'what' && person && (
          <div className="grid gap-2">
            <button type="button" onClick={() => onAddLeave(person.id)} className="flex min-h-14 items-center gap-3 rounded-xl bg-white px-3 text-left ring-1 ring-slate-300 active:bg-slate-50">
              <Plus className="h-5 w-5 shrink-0 text-brand-700" /><span><span className="block text-sm font-semibold text-slate-900">Add leave</span><span className="block text-xs text-slate-500">Enter a leave by hand (sick, unplanned…)</span></span>
            </button>
            <button type="button" onClick={() => setStep('kind')} className="flex min-h-14 items-center gap-3 rounded-xl bg-brand-700 px-3 text-left text-white active:bg-brand-800">
              <CalendarClock className="h-5 w-5 shrink-0" /><span><span className="block text-sm font-semibold">Request</span><span className="block text-xs opacity-80">Ask the Section Head to change a leave</span></span>
            </button>
          </div>
        )}
        {step === 'kind' && (
          <div className="grid gap-2">
            <button type="button" onClick={() => setStep('leave')} className="flex min-h-14 items-center gap-3 rounded-xl bg-white px-3 text-left ring-1 ring-slate-300 active:bg-slate-50">
              <CalendarClock className="h-5 w-5 shrink-0 text-brand-700" /><span><span className="block text-sm font-semibold text-slate-900">Reschedule a leave</span><span className="block text-xs text-slate-500">Move one of their leaves to other dates</span></span>
              <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
            </button>
          </div>
        )}
        {step === 'leave' && (leaves.length === 0 ? <p className="text-sm text-slate-500">No leave in the plan for this employee.</p> : (
          <ul className="divide-y divide-slate-100 rounded-xl bg-slate-50 px-3 ring-1 ring-slate-200">
            {leaves.map((l) => { const over = l.end < today; return (
              <li key={l.start}>
                <button type="button" onClick={() => setLeave(l)} className={cx('flex w-full items-center gap-2 py-2 text-left', over && 'opacity-50')}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900"><LeaveCodes codes={l.codes} />{range(l.start, l.end)} <span className="text-xs font-normal text-slate-500">{l.start.slice(0, 4)}</span></span>
                    <span className="block text-xs text-slate-500">{daysIn(l.start, l.end)} days{over ? ' · done' : l.start <= today ? ' · on leave now' : ''}</span>
                  </span>
                  {l.estimated && <EstimatedTag />}
                  {l.oracle && <OraclePill status={l.oracle} small />}
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              </li>
            ); })}
          </ul>
        ))}
        {step !== 'who' && <Button variant="secondary" className="w-full" onClick={back}>Back</Button>}
      </div>
    </BottomSheet>
  );
}

/** One change request: the dates, the remark, the shortage check now (and as it was when asked), and the decision. */
export function ChangeRequestSheet({ req, name, isHead, onClose, onDone }: { req: ChangeRequest; name: string; isHead: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const today = localToday();
  const [state, setState] = useState<{ inputs: ManpowerInputs; approvals: LeaveApproval[]; by: string | null } | null>(null);
  const [remarks, setRemarks] = useState(''); const [reason, setReason] = useState(''); const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null);
  const open = req.status === 'requested';
  useEffect(() => {
    const y = Number(today.slice(0, 4));
    Promise.all([fetchManpowerInputs(`${y}-01-01`, `${y + 1}-12-31`), fetchLeaveApprovals(), fetchRequesterNames(req.requested_by ? [req.requested_by] : [])])
      .then(([inputs, approvals, names]) => setState({ inputs, approvals, by: req.requested_by ? names.get(req.requested_by) ?? null : null })).catch(setErr);
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
