import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, Sun } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { checkCandidates, coverageNeeds, maxEndDate, type CoverageNeed } from '@/core/controllers';
import { evaluateDay, FULL_OPERATION, type MpAbsence, type MpAssignment, type MpPerson } from '@/core/manpower';
import { onLeaveOn, type OnLeave } from '@/core/leave';
import { addDaysIso, isValidIsoDate, type Crew } from '@/core/roster';
import { cancelAssignment, createAssignment, endAssignmentEarly, fetchAssignments } from '@/data/controllers';
import { fetchManpowerInputs } from '@/data/manpower';
import type { ControllerAssignment } from '@/data/types';
import { BottomSheet, Button, Card, Chip, ErrorBox, Field, PageHeader, Spinner, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';

const HORIZON = 120;
const CREW_LIST: Crew[] = ['A', 'B', 'C', 'D'];
const ROLE: Record<string, string> = { vr_controller: 'Vacation Relief Controller', morning_controller: 'Morning Controller', controller: 'Shift Controller' };
const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}${b.slice(0, 4) !== a.slice(0, 4) ? ` ${b.slice(0, 4)}` : ''}`);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;

interface Draft { kind: MpAssignment['kind']; crew: Crew | null; start: string; end: string; coversId: string | null }

export default function ControllersPage() {
  const today = localToday();
  const [params, setParams] = useSearchParams();
  const [inputs, setInputs] = useState<{ people: MpPerson[]; absences: MpAbsence[]; assignments: MpAssignment[] } | null>(null);
  const [all, setAll] = useState<ControllerAssignment[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ending, setEnding] = useState<ControllerAssignment | null>(null);
  const [cancelling, setCancelling] = useState<ControllerAssignment | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [i, a] = await Promise.all([fetchManpowerInputs(addDaysIso(today, -60), addDaysIso(today, HORIZON + 70)), fetchAssignments()]);
      setInputs(i); setAll(a);
    } catch (e) { setError(e); }
  }, [today]);
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => new Map((inputs?.people ?? []).map((p) => [p.id, p])), [inputs]);
  const name = (id: string | null) => (id ? byId.get(id)?.name ?? 'Unknown' : '');
  const needs = useMemo(() => (inputs ? coverageNeeds(today, addDaysIso(today, HORIZON - 1), inputs.people, inputs.absences, inputs.assignments) : []), [inputs, today]);
  /** Who is on leave on a date, with code and true return date (for the coverage-needed list). */
  const leaveOnDate = useCallback((date: string) => {
    if (!inputs) return new Map<string, OnLeave>();
    const crewOf = new Map(inputs.people.map((p) => [p.id, p.crew]));
    return onLeaveOn(date, inputs.absences.map((a) => ({ employeeId: a.employeeId, start: a.start, end: a.end, status: a.status, inCurrentPlan: a.inCurrentPlan !== false, typeLabel: a.typeLabel ?? null, typeShort: a.typeShort ?? null })), (id) => crewOf.get(id) ?? null);
  }, [inputs]);
  const morningToday = useMemo(() => (inputs ? evaluateDay(today, inputs.people, inputs.absences, FULL_OPERATION, inputs.assignments).dayStaff.find((s) => s.morningPost) ?? null : null), [inputs, today]);

  // Opened from Today's "Assign cover" link: ?assign=cover&crew=A&from=YYYY-MM-DD
  useEffect(() => {
    if (!inputs || params.get('assign') !== 'cover') return;
    const crew = params.get('crew') as Crew | null; const from = params.get('from') ?? today;
    if (!crew || !CREW_LIST.includes(crew) || !isValidIsoDate(from)) return;
    const need = coverageNeeds(from, addDaysIso(from, 60), inputs.people, inputs.absences, inputs.assignments).find((n) => n.crew === crew && n.start <= addDaysIso(from, 1));
    setDraft(fromNeed(need ?? { crew, start: from, end: from, dutyDays: 1, who: [], absentIds: [] }));
    setParams({}, { replace: true });
  }, [inputs, params, setParams, today]);

  const done = (msg: string) => { setDraft(null); setEnding(null); setCancelling(null); setNotice(msg); load(); };
  const current = (all ?? []).filter((a) => a.status === 'active' && a.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const history = (all ?? []).filter((a) => a.status === 'cancelled' || a.end_date < today);

  return (
    <div>
      <PageHeader title="Controller Management" subtitle="Cover for Shift Controllers and the Morning Controller rotation. Grade 15+ only, up to 2 months per assignment." />
      <div className="mb-3 flex flex-wrap gap-2">
        <Button onClick={() => { setNotice(null); setDraft({ kind: 'shift_cover', crew: null, start: today, end: today, coversId: null }); }}>Assign cover</Button>
        <Button variant="secondary" onClick={() => { setNotice(null); setDraft({ kind: 'morning_rotation', crew: null, start: today, end: maxEndDate(today), coversId: null }); }}><Sun className="h-4 w-4" /> Morning rotation</Button>
      </div>
      {notice && <div className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">{notice}</div>}
      {error != null && <div className="mb-3 space-y-2"><ErrorBox error={error} /><Button variant="secondary" onClick={load}><RefreshCw className="h-4 w-4" /> Try again</Button></div>}
      {!inputs || !all ? (!error && <Spinner />) : (
        <>
          <Section title={`Coverage needed · next ${HORIZON} days (${needs.length})`}>
            {needs.length === 0 && <p className="text-sm text-slate-500">Every crew has a Controller on every duty day in the next {HORIZON} days.</p>}
            <ul className="divide-y divide-slate-100">
              {needs.map((n) => {
                const l = leaveOnDate(n.start);
                return (
                  <li key={`${n.crew}${n.start}`} className="flex items-center gap-3 py-2.5">
                    <CrewBadge crew={n.crew} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800">{range(n.start, n.end)} <span className="whitespace-nowrap text-xs font-normal text-slate-500">· {n.dutyDays} duty day{n.dutyDays === 1 ? '' : 's'}</span></div>
                      <div className="truncate text-xs text-slate-500">{n.who.map((w, i) => { const lv = l.get(n.absentIds[i]); return `${w}${lv ? ` (${lv.typeShort ?? 'Leave'} · Return ${shortDate(lv.returnOn)})` : ''}`; }).join(', ') || 'Controller away'}</div>
                    </div>
                    <Button variant="secondary" className="shrink-0" onClick={() => { setNotice(null); setDraft(fromNeed(n)); }}>Assign</Button>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title="Morning Controller">
            {morningToday ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span><span className="font-medium text-slate-800">{morningToday.person.name}</span> <span className="text-xs text-slate-500">holds the post today{morningToday.assignment?.kind === 'morning_rotation' ? ` (rotation until ${shortDate(morningToday.assignment.end)})` : ''}</span></span>
                {morningToday.absence && <Chip tone="red">On leave</Chip>}
              </div>
            ) : <p className="text-sm text-slate-500">Nobody holds the Morning Controller post today.</p>}
          </Section>

          <Section title={`Current and upcoming assignments (${current.length})`}>
            {current.length === 0 && <p className="text-sm text-slate-500">No assignments.</p>}
            <ul className="divide-y divide-slate-100">
              {current.map((a) => (
                <li key={a.id} className="py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <AssignmentTitle a={a} name={name} />
                    <Chip tone={a.start_date <= today ? 'green' : 'neutral'} className="shrink-0 whitespace-nowrap">{a.start_date <= today ? 'Now' : `Starts ${shortDate(a.start_date)}`}</Chip>
                  </div>
                  <div className="text-xs text-slate-500">{range(a.start_date, a.end_date)} · {days(a.start_date, a.end_date)} days{a.covers_employee_id ? ` · for ${name(a.covers_employee_id)}` : ''}{a.note ? ` · ${a.note}` : ''}</div>
                  <div className="mt-1 flex gap-2">
                    {a.end_date > today && a.start_date < a.end_date && <Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={() => setEnding(a)}>End early</Button>}
                    <Button variant="ghost" className="min-h-8 px-2 text-xs text-red-700 hover:bg-red-50" onClick={() => setCancelling(a)}>Cancel</Button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Card className="mb-3">
            <button type="button" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory} className="flex w-full items-center justify-between text-left">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assignment history ({history.length})</h2>
              {showHistory ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>
            {showHistory && (
              <ul className="mt-2 divide-y divide-slate-100">
                {history.length === 0 && <li className="py-2 text-sm text-slate-500">Nothing yet.</li>}
                {history.map((a) => (
                  <li key={a.id} className="py-2">
                    <div className="flex items-start justify-between gap-2"><AssignmentTitle a={a} name={name} /><Chip tone={a.status === 'cancelled' ? 'red' : 'neutral'} className="shrink-0">{a.status === 'cancelled' ? 'Cancelled' : 'Completed'}</Chip></div>
                    <div className="text-xs text-slate-500">{range(a.start_date, a.end_date)}{a.covers_employee_id ? ` · for ${name(a.covers_employee_id)}` : ''}{a.status === 'cancelled' ? ` · cancelled ${a.cancelled_at ? shortDate(a.cancelled_at.slice(0, 10)) : ''}: ${a.cancel_reason ?? ''}` : ''}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <p className="text-[11px] text-slate-500">Every assignment, change and cancellation is kept and written to the audit history. Records are never deleted.</p>
        </>
      )}
      {draft && inputs && <AssignSheet initial={draft} people={inputs.people} absences={inputs.absences} assignments={inputs.assignments} onClose={() => setDraft(null)} onDone={done} />}
      {ending && <EndEarlySheet a={ending} today={today} name={name} onClose={() => setEnding(null)} onDone={done} />}
      {cancelling && <CancelSheet a={cancelling} name={name} onClose={() => setCancelling(null)} onDone={done} />}
    </div>
  );
}

function fromNeed(n: CoverageNeed): Draft {
  const end = n.end <= maxEndDate(n.start) ? n.end : maxEndDate(n.start);
  return { kind: 'shift_cover', crew: n.crew, start: n.start, end, coversId: n.absentIds[0] ?? null };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="mb-3"><h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>{children}</Card>;
}

function AssignmentTitle({ a, name }: { a: ControllerAssignment; name: (id: string | null) => string }) {
  return a.kind === 'shift_cover' && a.crew_code
    ? <span className="flex min-w-0 items-center gap-2 text-sm"><CrewBadge crew={a.crew_code} size="sm" /><span className="truncate"><Link to={`/employees/${a.employee_id}`} className="font-medium text-brand-700">{name(a.employee_id)}</Link> covers {a.crew_code} Shift</span></span>
    : <span className="flex min-w-0 items-center gap-2 text-sm"><Sun className="h-5 w-5 shrink-0 text-amber-500" /><span className="truncate"><Link to={`/employees/${a.employee_id}`} className="font-medium text-brand-700">{name(a.employee_id)}</Link> · Morning Controller rotation</span></span>;
}

function AssignSheet({ initial, people, absences, assignments, onClose, onDone }: { initial: Draft; people: MpPerson[]; absences: MpAbsence[]; assignments: MpAssignment[]; onClose: () => void; onDone: (m: string) => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const set = (patch: Partial<Draft>) => { setD((x) => ({ ...x, ...patch })); setPick(null); };
  const limit = isValidIsoDate(d.start) ? maxEndDate(d.start) : null;
  const problem = !isValidIsoDate(d.start) || !isValidIsoDate(d.end) ? 'Enter both dates.' : d.end < d.start ? 'The end date is before the start date.' : limit && d.end > limit ? `At most 2 months: the latest end date is ${shortDate(limit)}.` : d.kind === 'shift_cover' && !d.crew ? 'Choose the crew to cover.' : null;
  const candidates = problem ? [] : checkCandidates(d.kind, d.crew, d.start, d.end, people, absences, assignments);
  const crewControllers = d.crew ? people.filter((p) => p.role === 'controller' && p.crew === d.crew) : [];
  async function save() {
    if (!pick) return;
    setBusy(true); setErr(null);
    try {
      await createAssignment({ kind: d.kind, employee_id: pick, crew_code: d.kind === 'shift_cover' ? d.crew : null, covers_employee_id: d.kind === 'shift_cover' ? d.coversId : null, start_date: d.start, end_date: d.end, note: note.trim() || null });
      const who = people.find((p) => p.id === pick)?.name ?? 'Controller';
      onDone(d.kind === 'shift_cover' ? `${who} covers ${d.crew} Shift ${range(d.start, d.end)}.` : `${who} holds the Morning Controller post ${range(d.start, d.end)}.`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title={d.kind === 'shift_cover' ? 'Assign Controller cover' : 'Morning Controller rotation'}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
          {(['shift_cover', 'morning_rotation'] as const).map((k) => (
            <button key={k} type="button" onClick={() => set({ kind: k })} className={cx('min-h-9 rounded-lg font-medium', d.kind === k ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{k === 'shift_cover' ? 'Shift cover' : 'Morning rotation'}</button>
          ))}
        </div>
        {d.kind === 'shift_cover' && (
          <Field label="Crew to cover">
            <div className="grid grid-cols-4 gap-2">
              {CREW_LIST.map((c) => (
                <button key={c} type="button" aria-pressed={d.crew === c} onClick={() => set({ crew: c, coversId: people.find((p) => p.role === 'controller' && p.crew === c)?.id ?? null })}
                  className={cx('flex items-center justify-center rounded-xl py-2 ring-1', d.crew === c ? 'bg-slate-100 ring-2 ring-slate-800' : 'ring-slate-300')}><CrewBadge crew={c} muted={d.crew !== c} /></button>
              ))}
            </div>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" className="input" value={d.start} onChange={(e) => set({ start: e.target.value })} /></Field>
          <Field label="Until"><input type="date" className="input" value={d.end} max={limit ?? undefined} onChange={(e) => set({ end: e.target.value })} /></Field>
        </div>
        {limit && <p className="-mt-2 text-xs text-slate-500">Up to 2 months: latest end date {shortDate(limit)}.</p>}
        {d.kind === 'shift_cover' && crewControllers.length > 0 && (
          <Field label="Covering for">
            <select className="input" value={d.coversId ?? ''} onChange={(e) => setD((x) => ({ ...x, coversId: e.target.value || null }))}>
              <option value="">Not specified</option>
              {crewControllers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        {problem ? <p className="text-sm text-slate-600">{problem}</p> : (
          <Field label={d.kind === 'shift_cover' ? 'Who covers' : 'Who holds the Morning post'}>
            <ul className="space-y-1.5">
              {candidates.map((c) => {
                const disabled = c.blocked.length > 0;
                return (
                  <li key={c.person.id}>
                    <label className={cx('flex items-start gap-3 rounded-xl px-3 py-2 ring-1', pick === c.person.id ? 'bg-brand-50 ring-brand-600/40' : 'ring-slate-200', disabled && 'opacity-50')}>
                      <input type="radio" name="who" className="mt-1" disabled={disabled} checked={pick === c.person.id} onChange={() => setPick(c.person.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">{c.person.name}{c.person.crew && <CrewBadge crew={c.person.crew} size="sm" />}</span>
                        <span className="block text-xs text-slate-500">{ROLE[c.person.role ?? ''] ?? 'Controller'} · Grade {c.person.grade ?? '—'}</span>
                        {[...c.blocked.map((t) => ({ t, red: true })), ...c.warnings.map((t) => ({ t, red: false }))].map(({ t, red }) => <span key={t} className={cx('block text-xs', red ? 'text-status-red' : 'text-status-amber')}>{t}</span>)}
                        {!disabled && c.warnings.length === 0 && <span className="block text-xs text-status-green">Available on every day</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Field>
        )}
        <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Approved by Section Head" /></Field>
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={busy || !!problem || !pick} onClick={save}>{busy ? 'Saving…' : 'Assign'}</Button>
        </div>
      </div>
    </BottomSheet>
  );
}

function EndEarlySheet({ a, today, name, onClose, onDone }: { a: ControllerAssignment; today: string; name: (id: string | null) => string; onClose: () => void; onDone: (m: string) => void }) {
  const [end, setEnd] = useState(a.start_date > today ? a.start_date : today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const problem = !isValidIsoDate(end) ? 'Enter a date.' : end < a.start_date ? 'Cannot end before it starts.' : end >= a.end_date ? `Choose a date before ${shortDate(a.end_date)}.` : null;
  async function save() {
    setBusy(true); setErr(null);
    try { await endAssignmentEarly(a.id, end, note.trim() || null); onDone(`${name(a.employee_id)}: assignment now ends ${shortDate(end)}.`); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="End assignment early">
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{name(a.employee_id)} · {range(a.start_date, a.end_date)}</p>
        <Field label="Last day"><input type="date" className="input" value={end} min={a.start_date} max={addDaysIso(a.end_date, -1)} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {problem && <p className="text-xs text-slate-500">{problem}</p>}
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Back</Button><Button className="flex-1" disabled={busy || !!problem} onClick={save}>Save</Button></div>
      </div>
    </BottomSheet>
  );
}

function CancelSheet({ a, name, onClose, onDone }: { a: ControllerAssignment; name: (id: string | null) => string; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function save() {
    setBusy(true); setErr(null);
    try { await cancelAssignment(a.id, reason.trim()); onDone(`Assignment cancelled. It stays in the history.`); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="Cancel assignment">
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{name(a.employee_id)} · {a.kind === 'shift_cover' ? `covers ${a.crew_code} Shift` : 'Morning rotation'} · {range(a.start_date, a.end_date)}</p>
        <Field label="Reason" hint="Kept with the record in the history."><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Keep</Button><Button variant="danger" className="flex-1" disabled={busy || !reason.trim()} onClick={save}>Cancel assignment</Button></div>
      </div>
    </BottomSheet>
  );
}

