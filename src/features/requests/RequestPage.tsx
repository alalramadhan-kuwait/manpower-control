import { AlertTriangle, ArrowLeft, Info, Pencil } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { DayMark } from '@/core/calendar';
import { firstDayBack } from '@/core/leave';
import type { MpAbsence, MpAssignment, MpPerson } from '@/core/manpower';
import { REQUEST_TYPES, REQUEST_TYPE_CODE, REQUEST_TYPE_LABEL, approvalOutcome, requestImpact, type ApprovalOutcome, type RequestType } from '@/core/requests';
import { addDaysIso, isValidIsoDate } from '@/core/roster';
import { fetchManpowerInputs } from '@/data/manpower';
import { fetchDirectory } from '@/data/queries';
import { decideRequest, fetchRequest, isOpen, reviewRequest, saveRequest, withdrawRequest, type LeaveRequest, type RequestForm } from '@/data/requests';
import type { EmployeeDirectoryRow, UserProfile } from '@/data/types';
import { Button, Card, ErrorBox, Field, Row, Spinner, cx, fmtDate } from '@/ui/components';
import { CrewTag, isCrew } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { StatusChip, dayCount } from './shared';

const DOT: Record<DayMark, string> = { green: 'bg-status-green', amber: 'bg-status-amber', red: 'bg-status-red', pending: 'bg-slate-400', off: 'bg-transparent' };
const MARK: Record<DayMark, string> = { green: 'Green', amber: 'Amber', red: 'Red', pending: 'Pending', off: 'Off' };
const SHIFT = { M: 'Morning', A: 'Afternoon', N: 'Night' } as const;
const range = (s: string, e: string) => (s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}${e.slice(0, 4) !== s.slice(0, 4) ? ` ${e.slice(0, 4)}` : ''}`);

const blank = (): RequestForm => ({ employee_id: '', request_type: 'unscheduled', start_date: localToday(), end_date: localToday(), reason: '', address: '', phone: '', balance_days: null, balance_as_of: null, form_date: localToday() });
const toForm = (r: LeaveRequest): RequestForm => ({ employee_id: r.employee_id, request_type: r.request_type, start_date: r.start_date, end_date: r.end_date, reason: r.reason ?? '', address: r.address ?? '', phone: r.phone ?? '', balance_days: r.balance_days, balance_as_of: r.balance_as_of, form_date: r.form_date });

/** One leave request: the paper form's fields, its manpower impact, the Controller / Supervisor review and the Section Head decision. */
export default function RequestPage({ profile }: { profile: UserProfile }) {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const [req, setReq] = useState<LeaveRequest | null>(null);
  const [dir, setDir] = useState<EmployeeDirectoryRow[] | null>(null);
  const [form, setForm] = useState<RequestForm>(blank);
  const [editing, setEditing] = useState(isNew);
  const [error, setError] = useState<unknown>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, r] = await Promise.all([fetchDirectory(), isNew ? Promise.resolve(null) : fetchRequest(id!)]);
    setDir(d); setReq(r); if (r) setForm(toForm(r));
  }, [id, isNew]);
  useEffect(() => { load().catch(setError); }, [load]);

  // manpower inputs around the requested dates, for the impact
  const valid = isValidIsoDate(form.start_date) && isValidIsoDate(form.end_date) && form.end_date >= form.start_date && dayCount(form.start_date, form.end_date) <= 366;
  const [inputs, setInputs] = useState<{ people: MpPerson[]; absences: MpAbsence[]; assignments: MpAssignment[]; key: string } | null>(null);
  useEffect(() => {
    if (!valid) return;
    const key = `${form.start_date}|${form.end_date}`;
    let live = true;
    const t = setTimeout(() => fetchManpowerInputs(addDaysIso(form.start_date, -1), addDaysIso(form.end_date, 1)).then((r) => live && setInputs({ ...r, key })).catch((e) => live && setError(e)), 250);
    return () => { live = false; clearTimeout(t); };
  }, [form.start_date, form.end_date, valid]);

  const emp = dir?.find((p) => p.id === form.employee_id) ?? null;
  const impact = useMemo(() => {
    if (!inputs || !valid || !form.employee_id || inputs.key !== `${form.start_date}|${form.end_date}`) return null;
    // once approved, the leave is already in the plan: show the impact without counting it twice
    const absences = req?.leave_record_id ? inputs.absences.filter((a) => a.id !== req.leave_record_id) : inputs.absences;
    return requestImpact({ employeeId: form.employee_id, start: form.start_date, end: form.end_date, typeCode: REQUEST_TYPE_CODE[form.request_type] }, inputs.people, absences, inputs.assignments);
  }, [inputs, valid, form, req]);

  if (error && !dir) return <ErrorBox error={error} />;
  if (!dir || (!isNew && !req)) return <Spinner />;
  const open = isNew || (req ? isOpen(req) : false);
  const isHead = profile.role_code === 'section_head';
  const done = (m: string) => { setFlash(m); setError(null); load().catch(setError); window.dispatchEvent(new Event('requests-changed')); };

  return (
    <div>
      <Link to="/requests" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-700"><ArrowLeft className="h-4 w-4" /> Leave requests</Link>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-brand-800">{isNew ? 'New leave request' : emp?.display_name ?? 'Leave request'}</h1>
          <p className="text-sm text-slate-600">{isNew ? 'Enter the paper form (MAB Operations Department leave request form).' : `${REQUEST_TYPE_LABEL[req!.request_type]} leave · entered ${fmtDate(req!.created_at.slice(0, 10))}`}</p>
        </div>
        {req && <StatusChip status={req.status} />}
      </div>
      {flash && <div role="status" className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">{flash}</div>}

      {editing ? (
        <FormCard form={form} setForm={setForm} dir={dir} emp={emp} requestId={isNew ? null : req!.id}
          onCancel={() => (isNew ? navigate('/requests') : (setForm(toForm(req!)), setEditing(false)))}
          onSaved={(newId, m) => { setEditing(false); if (isNew) navigate(`/requests/${newId}`, { replace: true }); done(m); }} />
      ) : req && (
        <Card className="mb-3">
          <div className="mb-1 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Request</h2>{open && <Button variant="ghost" className="min-h-9 px-2 text-xs" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Correct</Button>}</div>
          <EmployeeRows emp={emp} />
          <Row label="Leave" value={`${REQUEST_TYPE_LABEL[req.request_type]} · ${range(req.start_date, req.end_date)}`} />
          <Row label="Days" value={impact ? `${impact.calendarDays} calendar · ${impact.dutyDays} duty` : dayCount(req.start_date, req.end_date)} />
          <Row label="Back to work" value={shortDate(firstDayBack(req.end_date, emp && isCrew(emp.crew_code) ? emp.crew_code : null, (d) => d >= req.start_date && d <= req.end_date))} />
          <Row label="Reason" value={req.reason} />
          <Row label="Address while on leave" value={req.address} />
          <Row label="Tel" value={req.phone} />
          <Row label="Leave balance" value={req.balance_days != null ? `${req.balance_days} days${req.balance_as_of ? ` (as of ${fmtDate(req.balance_as_of)})` : ''}` : null} />
          <Row label="Form signed by employee" value={fmtDate(req.form_date)} />
        </Card>
      )}

      {form.employee_id && valid && <ImpactCard impact={impact} crewLabel={emp && isCrew(emp.crew_code) ? emp.crew_code : null} approved={req?.status === 'approved'}
        outcome={open && impact ? approvalOutcome({ type: form.request_type, start: form.start_date, end: form.end_date }, impact.overlaps) : null} typeLabel={REQUEST_TYPE_LABEL[form.request_type]} />}

      {req && <ReviewCard req={req} open={open} impactRed={impact?.red.length ?? 0} onDone={done} />}
      {req && <DecisionCard req={req} open={open} isHead={isHead} onDone={done} />}
      {req && open && <WithdrawCard req={req} onDone={done} />}
    </div>
  );
}

function EmployeeRows({ emp }: { emp: EmployeeDirectoryRow | null }) {
  if (!emp) return null;
  return (
    <>
      <Row label="Employee" value={<Link to={`/employees/${emp.id}`} className="text-brand-700">{emp.display_name}</Link>} />
      <Row label="Employee No." value={<span className="font-mono">{emp.employee_number}</span>} />
      <Row label="Unit" value={emp.section_name ?? 'U-12 Section 1'} />
      <Row label="Job title" value={emp.master_position ?? emp.position_label} />
      <Row label="Shift" value={isCrew(emp.crew_code) ? <CrewTag crew={emp.crew_code} /> : 'Day staff'} />
      <Row label="Joined KNPC" value={fmtDate(emp.join_date)} />
    </>
  );
}

function FormCard({ form, setForm, dir, emp, requestId, onCancel, onSaved }: {
  form: RequestForm; setForm: (f: RequestForm) => void; dir: EmployeeDirectoryRow[]; emp: EmployeeDirectoryRow | null; requestId: string | null;
  onCancel: () => void; onSaved: (id: string, message: string) => void;
}) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const isNew = requestId === null;
  const set = (patch: Partial<RequestForm>) => setForm({ ...form, ...patch });
  const staff = useMemo(() => dir.filter((p) => p.is_active && p.in_unit12_scope).sort((a, b) => a.display_name.localeCompare(b.display_name)), [dir]);
  const problem = !form.employee_id ? 'Choose the employee.' : !isValidIsoDate(form.start_date) || !isValidIsoDate(form.end_date) ? 'Enter both dates.'
    : form.end_date < form.start_date ? 'The last day is before the first day.' : null;
  async function save() {
    setBusy(true); setErr(null);
    try { const id = await saveRequest(requestId, form); onSaved(id, isNew ? 'Request entered. It now waits for the Controller / Supervisor review.' : 'Request corrected.'); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Card className="mb-3">
      <div className="space-y-4">
        <Field label="Employee">
          <select className="input" value={form.employee_id} onChange={(e) => set({ employee_id: e.target.value })}>
            <option value="">Choose…</option>
            {staff.map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.crew_code ? ` (${p.crew_code})` : ''}</option>)}
          </select>
        </Field>
        {emp && <div className="-mt-2 rounded-xl bg-slate-50 px-3 py-1 ring-1 ring-slate-200"><EmployeeRows emp={emp} /></div>}
        <Field label="Please allow me to take vacation">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
            {REQUEST_TYPES.map((t: RequestType) => (
              <button key={t} type="button" aria-pressed={form.request_type === t} onClick={() => set({ request_type: t })}
                className={cx('min-h-9 rounded-lg font-medium', form.request_type === t ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{REQUEST_TYPE_LABEL[t]}</button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" className="input" value={form.start_date} onChange={(e) => set({ start_date: e.target.value, ...(e.target.value > form.end_date ? { end_date: e.target.value } : {}) })} /></Field>
          <Field label="To"><input type="date" className="input" value={form.end_date} min={form.start_date} onChange={(e) => set({ end_date: e.target.value })} /></Field>
        </div>
        <Field label="Reason for vacation"><textarea className="input min-h-16 py-2" value={form.reason} onChange={(e) => set({ reason: e.target.value })} /></Field>
        <Field label="Full address while on vacation"><textarea className="input min-h-16 py-2" value={form.address} onChange={(e) => set({ address: e.target.value })} /></Field>
        <Field label="Tel"><input className="input" inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Leave balance (days)"><input className="input" inputMode="decimal" value={form.balance_days ?? ''} onChange={(e) => set({ balance_days: e.target.value === '' || isNaN(Number(e.target.value)) ? null : Number(e.target.value) })} /></Field>
          <Field label="Balance as of"><input type="date" className="input" value={form.balance_as_of ?? ''} onChange={(e) => set({ balance_as_of: e.target.value || null })} /></Field>
        </div>
        <Field label="Date signed by the employee"><input type="date" className="input" value={form.form_date ?? ''} onChange={(e) => set({ form_date: e.target.value || null })} /></Field>
        {problem && <p className="text-xs text-slate-500">{problem}</p>}
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1" disabled={busy || !!problem} onClick={save}>{busy ? 'Saving…' : isNew ? 'Enter request' : 'Save correction'}</Button>
        </div>
      </div>
    </Card>
  );
}

function ImpactCard({ impact, crewLabel, approved, outcome, typeLabel }: { impact: ReturnType<typeof requestImpact> | null; crewLabel: string | null; approved: boolean; outcome: ApprovalOutcome | null; typeLabel: string }) {
  const [all, setAll] = useState(false);
  if (!impact) return <Card className="mb-3"><Spinner label="Working out the manpower impact…" /></Card>;
  const shown = all ? impact.duties : impact.worse;
  return (
    <Card className="mb-3">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Manpower impact{crewLabel ? ` · ${crewLabel} Shift` : ''}</h2>
      {approved && <p className="mb-1 text-xs text-slate-500">This leave is now in the plan; the result below compares the crew with and without it.</p>}
      {outcome && <OutcomeNote outcome={outcome} typeLabel={typeLabel} />}
      {!crewLabel ? <p className="text-sm text-slate-600">Day staff: no crew minimum is affected. {impact.calendarDays} days.</p> : (
        <>
          <p className="text-sm text-slate-700">{impact.dutyDays} duty day{impact.dutyDays === 1 ? '' : 's'} of {impact.calendarDays} calendar days.{' '}
            {impact.red.length > 0 ? <b className="text-status-red">The crew would be short (RED) on {impact.red.length} dut{impact.red.length === 1 ? 'y' : 'ies'}: overtime likely required.</b>
              : impact.coverNeeded.length > 0 ? <b className="text-slate-800">Controller cover would be needed on {impact.coverNeeded.length} dut{impact.coverNeeded.length === 1 ? 'y' : 'ies'}.</b>
              : impact.worse.length > 0 ? <span className="text-status-amber">Stays at or above minimum; no buffer on {impact.worse.filter((d) => d.after === 'amber').length} dut{impact.worse.filter((d) => d.after === 'amber').length === 1 ? 'y' : 'ies'}.</span>
              : <span className="text-status-green">No change to the crew result.</span>}
          </p>
          {shown.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 text-xs">
              {shown.map((d) => (
                <li key={d.date} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-slate-700">{shortDate(d.date)} · {SHIFT[d.shift]}</span>
                  <span className="flex items-center gap-1.5 text-slate-600"><span className={cx('h-2 w-2 rounded-full', DOT[d.before])} />{MARK[d.before]} → <span className={cx('h-2 w-2 rounded-full', DOT[d.after])} /><b>{MARK[d.after]}</b></span>
                </li>
              ))}
            </ul>
          )}
          {impact.duties.length > impact.worse.length && <button type="button" onClick={() => setAll(!all)} className="mt-1 text-xs font-medium text-brand-700">{all ? 'Show only the duties that change' : `Show all ${impact.duties.length} duties`}</button>}
        </>
      )}
    </Card>
  );
}

function ReviewCard({ req, open, impactRed, onDone }: { req: LeaveRequest; open: boolean; impactRed: number; onDone: (m: string) => void }) {
  const [edit, setEdit] = useState(req.status === 'submitted');
  const [overtime, setOvertime] = useState<boolean | null>(req.overtime_required);
  const [signedBy, setSignedBy] = useState(req.review_signed_by ?? '');
  const [remarks, setRemarks] = useState(req.review_remarks ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  useEffect(() => { setEdit(req.status === 'submitted'); setOvertime(req.overtime_required); setSignedBy(req.review_signed_by ?? ''); setRemarks(req.review_remarks ?? ''); }, [req]);
  async function save() {
    if (overtime === null) return;
    setBusy(true); setErr(null);
    try { await reviewRequest(req.id, overtime, signedBy, remarks); onDone('Controller / Supervisor review recorded. The request now waits for the Section Head.'); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Card className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shift Controller &amp; Supervisor</h2>
        {open && !edit && req.reviewed_at && <Button variant="ghost" className="min-h-9 px-2 text-xs" onClick={() => setEdit(true)}><Pencil className="h-3.5 w-3.5" /> Correct</Button>}
      </div>
      {!edit ? (
        req.reviewed_at ? (
          <>
            <Row label="Overtime" value={req.overtime_required ? 'Required' : 'Not required'} />
            <Row label="Signed on the form by" value={req.review_signed_by} />
            <Row label="Remarks" value={req.review_remarks} />
            <p className="text-xs text-slate-500">Recorded {new Date(req.reviewed_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </>
        ) : <p className="text-sm text-slate-500">{open ? 'Not recorded yet.' : 'Not recorded.'}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Record what the Shift Controller and Shift Supervisor marked on the paper form.{impactRed > 0 ? ` The crew would be RED on ${impactRed} dut${impactRed === 1 ? 'y' : 'ies'}.` : ''}</p>
          <div className="grid grid-cols-2 gap-2">
            {[true, false].map((v) => (
              <label key={String(v)} className={cx('flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm ring-1', overtime === v ? 'bg-brand-50 ring-brand-600/40' : 'ring-slate-200')}>
                <input type="radio" name="overtime" checked={overtime === v} onChange={() => setOvertime(v)} /> Overtime {v ? 'required' : 'not required'}
              </label>
            ))}
          </div>
          <Field label="Signed on the form by (optional)"><input className="input" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="e.g. Controller and Supervisor names" /></Field>
          <Field label="Remarks (optional)"><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
          {err != null && <ErrorBox error={err} />}
          <div className="flex gap-2">
            {req.reviewed_at && <Button variant="secondary" className="flex-1" onClick={() => setEdit(false)}>Cancel</Button>}
            <Button className="flex-1" disabled={busy || overtime === null} onClick={save}>{busy ? 'Saving…' : 'Record review'}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DecisionCard({ req, open, isHead, onDone }: { req: LeaveRequest; open: boolean; isHead: boolean; onDone: (m: string) => void }) {
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState<null | 'yes' | 'no'>(null); const [err, setErr] = useState<unknown>(null);
  async function decide(approve: boolean) {
    setBusy(approve ? 'yes' : 'no'); setErr(null);
    try { await decideRequest(req.id, approve, remarks); onDone(approve ? 'Approved. The leave is now in the plan, the calendar and Today.' : 'Not approved. The request is closed and kept in the history.'); }
    catch (e) { setErr(e); } finally { setBusy(null); }
  }
  return (
    <Card className="mb-3">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Section Head</h2>
      {req.decided_at ? (
        <>
          <Row label="Decision" value={<span className={req.status === 'approved' ? 'text-status-green' : 'text-status-red'}>{req.status === 'approved' ? 'Leave request approved' : 'Leave request not approved'}</span>} />
          <Row label="Remarks" value={req.decision_remarks} />
          <p className="text-xs text-slate-500">Decided {new Date(req.decided_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          {req.status === 'approved' && <Link to={`/employees/${req.employee_id}`} className="mt-2 inline-block text-sm font-medium text-brand-700">See it in the employee's leave</Link>}
        </>
      ) : !open ? <p className="text-sm text-slate-500">No decision (withdrawn).</p> : !isHead ? <p className="text-sm text-slate-500">Waiting for the Section Head.</p> : (
        <div className="space-y-3">
          {req.status === 'submitted' && <p className="text-xs text-status-amber">The Controller / Supervisor review is not recorded yet.</p>}
          <Field label="Remarks (optional)"><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
          {err != null && <ErrorBox error={err} />}
          <div className="flex gap-2">
            <Button variant="danger" className="flex-1" disabled={busy !== null} onClick={() => decide(false)}>{busy === 'no' ? 'Saving…' : 'Not approved'}</Button>
            <Button className="flex-1" disabled={busy !== null} onClick={() => decide(true)}>{busy === 'yes' ? 'Saving…' : 'Approve'}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function WithdrawCard({ req, onDone }: { req: LeaveRequest; onDone: (m: string) => void }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function go() {
    setBusy(true); setErr(null);
    try { await withdrawRequest(req.id, reason); onDone('Request withdrawn. It stays in the history.'); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="w-full py-2 text-center text-sm font-medium text-slate-500">Withdraw this request…</button>;
  return (
    <Card className="mb-3">
      <Field label="Reason for withdrawing"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Employee cancelled the request" /></Field>
      {err != null && <div className="mt-2"><ErrorBox error={err} /></div>}
      <div className="mt-3 flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Keep</Button><Button variant="danger" className="flex-1" disabled={busy || !reason.trim()} onClick={go}>Withdraw</Button></div>
    </Card>
  );
}


const leaveText = (o: { typeShort?: string | null; start: string; end: string }) => `${o.typeShort ?? ''} ${range(o.start, o.end)}`.trim();

/** What approving will do to the plan (one leave is never recorded twice). */
function OutcomeNote({ outcome, typeLabel }: { outcome: ApprovalOutcome; typeLabel: string }) {
  if (outcome.kind === 'refused') {
    return (
      <div className="mb-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Leave already recorded on these dates: <b>{outcome.records.map(leaveText).join(', ')}</b>. Approval will be refused until it is corrected or cancelled in the Annual Leave Plan.</span>
      </div>
    );
  }
  const text = outcome.kind === 'add' ? 'On approval the leave is added to the plan.'
    : outcome.kind === 'confirm' ? `Already in the plan: ${leaveText(outcome.record)}. Approval confirms it; no second record is made${outcome.setsType ? `, and its type becomes ${typeLabel}` : ''}.`
    : `Planned leave ${leaveText(outcome.record)}: approval moves it to the requested dates. The old dates stay in the history.`;
  return <p className="mb-2 flex items-start gap-1.5 text-xs text-slate-600"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{text}</p>;
}
