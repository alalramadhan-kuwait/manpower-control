// Requests › Leave: every leave running today or starting in the next 30 days, one row per leave, with what the
// Oracle HR request should say. Approve / Reject records the Oracle decision; tap a row to check or edit the dates.
import { AlertTriangle, CalendarClock, Check, ChevronDown, ChevronRight, Copy, Search, Trash2, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { checkControllerLeave, type LeaveApproval } from '@/core/controllers/leaveRules';
import { evaluateRange, personOn, type MpAbsence, type MpPerson } from '@/core/manpower';
import { ORACLE_LABEL, type OracleStatus } from '@/core/oracle';
import { expectedRequest, isRestDay, matchesPlan, oracleDays } from '@/core/oracle/expected';
import { buildWorklist, type WorkRow } from '@/core/oracle/worklist';
import { CREWS, addDaysIso, isValidIsoDate, type Crew } from '@/core/roster';
import { fetchLeaveApprovals } from '@/data/controllers';
import { cancelLeave, saveLeave, setOracleStatus } from '@/data/leave';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { fetchEstimatedLeaves } from '@/data/leave';
import { EstimatedTag } from '@/ui/LeaveCodes';
import { fetchReference } from '@/data/queries';
import { fetchSdMembers } from '@/data/shutdown';
import type { SdMember } from '@/core/shutdown';
import type { AbsenceType } from '@/data/types';
import { LeaveSheet } from '@/features/leave/LeaveSheet';
import { NewRequestFlow, ProposeSheet } from './ChangeRequests';
import { leaveImpact, mergedLeaves, type MergedLeave } from './leaveTools';
import { BottomSheet, Button, Card, ErrorBox, Field, Spinner, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { OraclePill } from '@/ui/oracle';
import { LeaveCodes } from '@/ui/LeaveCodes';

const DAYS = 14;
const ROLE_LABEL: Record<string, string> = { controller: 'Shift Controller', vr_controller: 'VR Controller', morning_controller: 'Morning Controller', panel_operator: 'Panel Operator', field_operator: 'Field Operator' };
const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
const weekday = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
type Shift = 'all' | Crew | 'DAY';
type Pos = 'all' | 'controller' | 'vr' | 'panel' | 'field';
const POS: { key: Pos; label: string; of: (r: WorkRow) => boolean }[] = [
  { key: 'all', label: 'All', of: () => true },
  { key: 'controller', label: 'Controller', of: (r) => r.role === 'controller' || r.role === 'morning_controller' },
  { key: 'vr', label: 'VR', of: (r) => r.role === 'vr_controller' },
  { key: 'panel', label: 'Panel', of: (r) => r.role === 'panel_operator' },
  { key: 'field', label: 'Field', of: (r) => r.role === 'field_operator' }
];

export function LeaveWorklist({ adding, onAdded, isHead }: { adding: boolean; onAdded: () => void; isHead: boolean }) {
  const today = localToday();
  const y = Number(today.slice(0, 4));
  const [data, setData] = useState<{ inputs: ManpowerInputs; approvals: LeaveApproval[]; types: AbsenceType[]; sd: SdMember[]; est: Set<string> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [shift, setShift] = useState<Shift>('all');
  const [pos, setPos] = useState<Pos>('all');
  const [open, setOpen] = useState<WorkRow | null>(null);
  const [cancelling, setCancelling] = useState<WorkRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [person, setPerson] = useState<MpPerson | null>(null);
  const [changing, setChanging] = useState<{ person: MpPerson; leave: MergedLeave } | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null);
  const [folded, setFolded] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('requests.folded') ?? '[]') as string[]; } catch { return []; } });
  const fold = (title: string) => setFolded((f) => { const n = f.includes(title) ? f.filter((x) => x !== title) : [...f, title]; try { localStorage.setItem('requests.folded', JSON.stringify(n)); } catch { /* not saved */ } return n; });
  const load = useCallback(() => Promise.all([fetchManpowerInputs(`${y}-01-01`, `${y + 1}-12-31`), fetchLeaveApprovals(), fetchReference(), fetchSdMembers(`${y}-01-01`, `${y + 1}-12-31`), fetchEstimatedLeaves()])
    .then(([inputs, approvals, ref, sd, est]) => setData({ inputs, approvals, types: ref.absenceTypes, sd, est: new Set(est.map((e) => e.id)) })).catch(setError), [y]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const { inputs, approvals } = data;
    return buildWorklist({ today, days: DAYS, people: inputs.people, absences: inputs.absences, sd: data.sd, check: checkControllerLeave(inputs.people, inputs.absences, approvals, [y, y + 1]),
      results: evaluateRange(today, addDaysIso(today, DAYS + 60), inputs.people, inputs.absences, inputs.rules, inputs.assignments) });
  }, [data, today, y]);
  const byShift = (s: Shift) => rows.filter((r) => s === 'all' || r.crew === s);
  const byPos = (p: Pos, list: WorkRow[]) => list.filter(POS.find((x) => x.key === p)!.of);
  const shown = byPos(pos, byShift(shift));
  const now = shown.filter((r) => r.now), soon = shown.filter((r) => !r.now);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!data || !q) return [];
    const words = q.split(/\s+/);
    return data.inputs.people.filter((p) => { const hay = `${p.name} ${p.employeeNumber}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8);
  }, [data, q]);

  async function decide(r: WorkRow, status: OracleStatus) {
    setBusy(r.key); setNotice(null);
    try { await setOracleStatus(r.records.map((x) => x.id!), status); setNotice(`${r.person.name}: ${ORACLE_LABEL[status].toLowerCase()} in Oracle.`); await load(); }
    catch (e) { setError(e); } finally { setBusy(null); }
  }

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const chip = (on: boolean) => cx('shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ring-1', on ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200');
  return (
    <div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input type="text" inputMode="search" autoComplete="off" className="input" style={{ paddingLeft: 36, paddingRight: 40 }} placeholder="Search an employee to see their leave plan" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find an employee" />
        {query && <button type="button" aria-label="Clear the search" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500"><X className="h-4 w-4" /></button>}
      </div>
      {q && (
        <Card className="mb-3 py-1">
          {matches.length === 0 ? <p className="py-2 text-sm text-slate-500">Nobody found.</p> : (
            <ul className="divide-y divide-slate-100">
              {matches.map((p) => { const c = personOn(p, today); return (
                <li key={p.id}>
                  <button type="button" onClick={() => setPerson(p)} className="flex w-full items-center gap-2 py-2 text-left">
                    {c.dayDuty || !c.crew ? <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-600">Day</span> : <CrewBadge crew={c.crew} size="sm" />}
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
                      <span className="block truncate text-xs text-slate-500">#{p.employeeNumber} · {ROLE_LABEL[p.role ?? ''] ?? ''}</span></span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                </li>
              ); })}
            </ul>
          )}
        </Card>
      )}
      <div className="-mx-4 mb-1.5 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none]">
        {(['all', ...CREWS, 'DAY'] as Shift[]).map((s) => { const n = byPos(pos, byShift(s)).length; return (
          <button key={s} type="button" aria-pressed={shift === s} onClick={() => setShift(s)} className={chip(shift === s)}>{s === 'all' ? 'All' : s === 'DAY' ? 'Day' : s} <span className="opacity-70">{n}</span></button>
        ); })}
      </div>
      <div className="-mx-4 mb-2 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none]">
        {POS.map((p) => { const n = byPos(p.key, byShift(shift)).length; return (
          <button key={p.key} type="button" aria-pressed={pos === p.key} onClick={() => setPos(p.key)} className={chip(pos === p.key)}>{p.label} <span className="opacity-70">{n}</span></button>
        ); })}
      </div>
      {notice && <p className="mb-2 flex items-center gap-1 text-sm text-status-green"><Check className="h-4 w-4" />{notice}</p>}

      {[{ title: 'On leave now', list: now }, { title: `Starting in ${DAYS} days`, list: soon }].map((g) => {
        const shut = folded.includes(g.title);
        return (
          <Card key={g.title} className="mb-3 py-1.5">
            <button type="button" aria-expanded={!shut} onClick={() => fold(g.title)} className="flex w-full items-center justify-between gap-2 pt-1 text-left">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title} · {g.list.length}{g.list.some((r) => r.oracle !== 'approved') ? ` · ${g.list.filter((r) => r.oracle !== 'approved').length} to decide` : ''}</h2>
              <ChevronDown className={cx('h-4 w-4 shrink-0 text-slate-500 transition-transform', shut && '-rotate-90')} />
            </button>
            {shut ? null : g.list.length === 0 ? <p className="py-2 text-sm text-slate-500">None</p> : (
              // every leave stays listed (approved ones faded, after the ones to decide) so nothing is hidden
              <div className="divide-y divide-slate-100">
                {g.list.map((r) => <Row key={r.key} r={r} estimated={r.records.some((x) => !!x.id && data.est.has(x.id))} busy={busy === r.key} onOpen={() => setOpen(r)} onDecide={(s) => decide(r, s)} onCancel={() => setCancelling(r)} />)}
              </div>
            )}
          </Card>
        );
      })}

      {person && !changing && <PersonLeavesSheet person={person} absences={data.inputs.absences} estimated={data.est} today={today} onClose={() => setPerson(null)} onChange={(leave) => setChanging({ person, leave })} isHead={isHead} />}
      {changing && (isHead
        ? <ChangeSheet person={changing.person} records={changing.leave.records} inputs={data.inputs} approvals={data.approvals} today={today} onBack={() => setChanging(null)} onDone={(m) => { setChanging(null); setPerson(null); setNotice(m); load(); }} />
        : <ProposeSheet person={changing.person} leave={changing.leave} inputs={data.inputs} approvals={data.approvals} today={today} onBack={() => setChanging(null)} onDone={(m) => { setChanging(null); setPerson(null); setNotice(m); load(); }} />)}
      {open && <EditSheet r={open} inputs={data.inputs} approvals={data.approvals} today={today} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); setNotice(m); load(); }} />}
      {cancelling && <CancelSheet r={cancelling} onClose={() => setCancelling(null)} onDone={(m) => { setCancelling(null); setNotice(m); load(); }} />}
      {adding && !addFor && <NewRequestFlow inputs={data.inputs} estimated={data.est} approvals={data.approvals} today={today} onClose={onAdded} onAddLeave={setAddFor} onDone={(m) => { onAdded(); setNotice(m); load(); }} />}
      {adding && addFor && <LeaveSheet target={{ kind: 'add', employeeId: addFor }} types={data.types}
        people={data.inputs.people.map((p) => ({ id: p.id, name: p.name, crew: personOn(p, today).crew })).sort((a, b) => a.name.localeCompare(b.name))}
        onClose={() => { setAddFor(null); onAdded(); }} onDone={(m) => { setAddFor(null); onAdded(); setNotice(m); load(); }} />}
    </div>
  );
}

/** One person's whole leave plan: every leave of this year and next (back-to-back records joined), with the Oracle status. */
function PersonLeavesSheet({ person, absences, estimated, today, onClose, onChange, isHead }: { person: MpPerson; absences: MpAbsence[]; estimated: Set<string>; today: string; onClose: () => void; onChange: (leave: MergedLeave) => void; isHead: boolean }) {
  const leaves = useMemo(() => mergedLeaves(absences, person.id, estimated), [absences, person.id, estimated]);
  const days = (l: { start: string; end: string }) => Math.round((Date.parse(`${l.end}T00:00:00Z`) - Date.parse(`${l.start}T00:00:00Z`)) / 86400000) + 1;
  const years = [...new Set(leaves.map((l) => l.start.slice(0, 4)))];
  const c = personOn(person, today);
  const crewOn = (d: string) => { const x = personOn(person, d); return x.dayDuty ? null : x.crew; };
  const backOn = (l: { start: string; end: string }) => expectedRequest(l.start, l.end, crewOn)?.backOn ?? addDaysIso(l.end, 1);
  return (
    <BottomSheet open onClose={onClose} title={person.name}>
      <div className="space-y-3">
        <div className="-mt-2 flex items-center gap-2 text-sm">
          <CopyNumber value={person.employeeNumber} />
          <Link to={`/employees/${person.id}`} className="flex min-w-0 flex-1 items-center gap-2">
            {c.crew && !c.dayDuty && <CrewBadge crew={c.crew} size="sm" />}
            <span className="truncate text-slate-500">{ROLE_LABEL[person.role ?? ''] ?? ''}{person.grade ? ` · Grade ${person.grade}` : ''}</span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
          </Link>
        </div>
        {leaves.length > 0 && <p className="text-[11px] text-slate-500">{isHead ? 'Tap a leave to change it (the employee asked to move it).' : 'Tap a leave to request a change from the Section Head.'}</p>}
        {leaves.length === 0 ? <p className="text-sm text-slate-500">No leave in the plan.</p> : years.map((y) => {
          const list = leaves.filter((l) => l.start.slice(0, 4) === y);
          return (
            <section key={y}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{y} · {list.length} {list.length === 1 ? 'leave' : 'leaves'} · {list.reduce((n, l) => n + days(l), 0)} days</h3>
              <ul className="divide-y divide-slate-100 rounded-xl bg-slate-50 px-3 ring-1 ring-slate-200">
                {list.map((l) => {
                  const past = l.end < today; const now = l.start <= today && today <= l.end;
                  return (
                    <li key={l.start}>
                      <button type="button" onClick={() => onChange(l)} className={cx('flex w-full items-center gap-2 py-2 text-left', past && 'opacity-50')}>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900"><LeaveCodes codes={l.codes} />{range(l.start, l.end)}</span>
                          <span className="block text-xs text-slate-500">{days(l)} days · back {weekday(backOn(l))} {shortDate(backOn(l))}{now ? ' · on leave now' : past ? ' · done' : ''}</span>
                        </span>
                        {l.estimated && <EstimatedTag />}
                        {l.oracle && <OraclePill status={l.oracle} small />}
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </BottomSheet>
  );
}

/**
 * A change request: the employee asks to move a leave. Pick the new dates and say why; the crews' cover for the new dates
 * is shown first. Saving keeps the old dates in the history and puts the leave back to Not submitted in Oracle, ready for
 * the new EasyHR request.
 */
function ChangeSheet({ person, records, inputs, approvals, today, onBack, onDone }: { person: MpPerson; records: MpAbsence[]; inputs: ManpowerInputs; approvals: LeaveApproval[]; today: string; onBack: () => void; onDone: (m: string) => void }) {
  const crewOn = (d: string) => { const q = personOn(person, d); return q.dayDuty ? null : q.crew; };
  const cur = { start: records[0].start, end: records[records.length - 1].end };
  const [start, setStart] = useState(cur.start); const [end, setEnd] = useState(cur.end);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const valid = isValidIsoDate(start) && isValidIsoDate(end) && end >= start;
  const unchanged = start === cur.start && end === cur.end;
  // the plan keeps the rest days after the last duty day (workbook convention)
  let planEnd = end; if (valid) for (let i = 0; i < 10 && isRestDay(addDaysIso(planEnd, 1), crewOn(addDaysIso(planEnd, 1))); i++) planEnd = addDaysIso(planEnd, 1);
  const exp = valid ? expectedRequest(start, planEnd, crewOn) : null;
  const now = expectedRequest(cur.start, cur.end, crewOn);
  const impact = useMemo(() => (valid && !unchanged ? leaveImpact(person, records, inputs, approvals, start, planEnd, today) : null), [valid, unchanged, person, records, inputs, approvals, start, planEnd, today]);
  const oracle = records.find((r) => r.oracle && r.oracle !== 'not_submitted')?.oracle;
  const over = cur.end < today;
  // the Oracle (EasyHR) decision on the leave as it is now, when the dates are not being changed
  const status = records[0].oracle ?? null;
  async function decide(next: OracleStatus) {
    setBusy(true); setErr(null);
    try { await setOracleStatus(records.map((x) => x.id!), next); onDone(`${person.name}: ${ORACLE_LABEL[next].toLowerCase()} in Oracle.`); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setErr(null);
    try {
      const ids = await saveLeaveDates(records, start, planEnd, `Change request: ${reason.trim()}`);
      if (oracle && !over) await setOracleStatus(ids, 'not_submitted');
      onDone(`${person.name}: leave moved to ${range(start, planEnd)}. Submit the new request in EasyHR.`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onBack} title="Change this leave">
      <div className="space-y-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
          <div className="font-medium text-slate-800">{person.name}</div>
          <div className="text-xs text-slate-600">Now: <b>{range(cur.start, cur.end)}</b>{now ? ` · ${now.days} days in Oracle · back ${weekday(now.backOn)} ${shortDate(now.backOn)}` : ''}</div>
          {records[0].oracle && <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">Oracle now <OraclePill status={records[0].oracle} /></div>}
        </div>
        {over && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">This leave is already over: changing it corrects the record (for example when he came back early).</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="New first day"><input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
          <Field label="New last day"><input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {valid && !unchanged && (
          <div className="space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
            <div className="font-medium text-slate-800">New plan {range(start, planEnd)} · {oracleDays(start, end)} days in Oracle{exp ? ` · back ${weekday(exp.backOn)} ${shortDate(exp.backOn)}` : ''}</div>
            {impact && (impact.short > 0 || impact.clash.length > 0) ? <>
              {impact.short > 0 && <div className="text-xs font-semibold text-status-red">Crew short on {impact.short} dut{impact.short === 1 ? 'y' : 'ies'} with these dates</div>}
              {impact.clash.length > 0 && <div className="text-xs font-semibold text-status-red">2 Controllers off · with {impact.clash.join(', ')}</div>}
            </> : <div className="text-xs text-green-800">No shortage with these dates ✓</div>}
          </div>
        )}
        {unchanged && !over && status !== 'approved' && (
          <div className="space-y-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Oracle decision on these dates</div>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" className="flex min-h-10 items-center justify-center gap-1 rounded-xl bg-green-600 px-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => decide('approved')}><Check className="h-4 w-4" />Approve</button>
              <Button variant="secondary" className="min-h-10 px-2 text-sm" disabled={busy || status === 'submitted'} onClick={() => decide('submitted')}>Submitted</Button>
              <Button variant="secondary" className="min-h-10 px-2 text-sm text-status-red" disabled={busy || status === 'rejected'} onClick={() => decide('rejected')}><X className="h-4 w-4" />Reject</Button>
            </div>
            <p className="text-[11px] text-slate-500">Record what EasyHR decided. To move the leave instead, change the dates below.</p>
          </div>
        )}
        <Field label="Reason for the change"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Employee asked to move it a week later" /></Field>
        <p className="text-xs text-slate-500">The old dates stay in the history. {oracle && !over ? 'The leave goes back to Not submitted in Oracle: submit the new request in EasyHR, then approve it here.' : 'Submit the new dates in EasyHR when it is time.'}</p>
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onBack}>Back</Button>
          <Button className="flex-1" disabled={busy || !valid || unchanged || !reason.trim()} onClick={save}>{busy ? 'Saving…' : 'Save the change'}</Button>
        </div>
      </div>
    </BottomSheet>
  );
}

/** One leave on two short lines: who / status / quick decision, then the Oracle dates, day back and warnings. */
function Row({ r, estimated, busy, onOpen, onDecide, onCancel }: { r: WorkRow; estimated: boolean; busy: boolean; onOpen: () => void; onDecide: (s: OracleStatus) => void; onCancel: () => void }) {
  const e = r.expected;
  const icon = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-50';
  // approved leave is faded so what still needs a decision stands out; its warnings stay clear
  const fade = r.oracle === 'approved' ? 'opacity-40' : '';
  return (
    <div className="flex items-center gap-2 py-2">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-2 text-left">
        {r.crew === 'DAY' ? <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-600', fade)}>Day</span> : <span className={cx('mt-0.5', fade)}><CrewBadge crew={r.crew} size="sm" /></span>}
        <span className="min-w-0 flex-1">
          <span className={cx('flex items-center gap-1.5', fade)}>
            <span className="truncate text-sm font-medium text-slate-900">{r.person.name}</span>
            {r.role === 'vr_controller' && <span className="text-[10px] font-semibold text-slate-400">VR</span>}
            <OraclePill status={r.oracle} small />
            {estimated && <EstimatedTag />}
          </span>
          <span className={cx('block truncate text-xs text-slate-600', fade)}><LeaveCodes codes={r.codes} />{e ? <><b className="font-semibold text-slate-800">{range(e.start, e.end)}</b> · {e.days}d · back {weekday(e.backOn)} {shortDate(e.backOn)}</> : 'Rest days only'}</span>
          {(r.oracle === 'rejected' || r.shortDuties > 0 || r.clashWith.length > 0 || r.extraNth || r.sdTeam) && (
            <span className="flex flex-wrap gap-x-2 text-[11px] font-semibold">
              {r.oracle === 'rejected' && <span className="text-status-red">Cancel or reschedule</span>}
              {r.shortDuties > 0 && <span className="inline-flex items-center gap-0.5 text-status-red"><AlertTriangle className="h-3 w-3" />Short {r.shortDuties}d</span>}
              {r.clashWith.length > 0 && <span className="inline-flex min-w-0 items-center gap-0.5 text-status-red"><AlertTriangle className="h-3 w-3 shrink-0" /><span className="truncate">With {r.clashWith.join(', ')}</span></span>}
              {r.extraNth && <span className="text-amber-700">Leave {r.extraNth} this year</span>}
              {r.sdTeam && <span className="inline-flex items-center gap-0.5 text-status-red"><AlertTriangle className="h-3 w-3" />On SD team</span>}
            </span>
          )}
        </span>
      </button>
      {r.oracle === 'rejected' ? <>
        <button type="button" aria-label="Reschedule" title="Reschedule" disabled={busy} onClick={onOpen} className={cx(icon, 'bg-white text-brand-700 ring-1 ring-slate-300')}><CalendarClock className="h-4 w-4" /></button>
        <button type="button" aria-label="Cancel leave" title="Cancel leave" disabled={busy} onClick={onCancel} className={cx(icon, 'bg-status-red text-white')}><Trash2 className="h-4 w-4" /></button>
      </> : r.oracle !== 'approved' ? <>
        <button type="button" aria-label="Approve" title="Approve" disabled={busy} onClick={() => onDecide('approved')} className={cx(icon, 'bg-green-600 text-white')}><Check className="h-4 w-4" /></button>
        <button type="button" aria-label="Reject" title="Reject" disabled={busy} onClick={() => onDecide('rejected')} className={cx(icon, 'bg-white text-status-red ring-1 ring-red-300')}><X className="h-4 w-4" /></button>
      </> : null}
    </div>
  );
}

/** Save new dates over the records of one leave (joined back-to-back parts: only the first and the last part can move). Returns the record ids. */
async function saveLeaveDates(records: MpAbsence[], start: string, planEnd: string, note: string): Promise<string[]> {
  if (records.length === 1) return [await saveLeave({ record: records[0].id!, employee: null, type: records[0].typeCode ?? 'annual_leave_planned', start, end: planEnd, note })];
  const [a, z] = [records[0], records[records.length - 1]];
  if (start > a.end || planEnd < z.start) throw new Error('These dates change more than the first and last part of this leave. Correct it in the Leave plan.');
  const out = records.map((x) => x.id!);
  if (start !== a.start) out[0] = await saveLeave({ record: a.id!, employee: null, type: a.typeCode ?? 'annual_leave_planned', start, end: a.end, note });
  if (planEnd !== z.end) out[out.length - 1] = await saveLeave({ record: z.id!, employee: null, type: z.typeCode ?? 'annual_leave_planned', start: z.start, end: planEnd, note });
  return out;
}

/**
 * Check an EasyHR request against the plan: type its dates; a match (rest days aside) is approved as is, other dates
 * show their effect first and are saved into the plan (reason "Oracle request") before approving.
 */
function EditSheet({ r, inputs, approvals, today, onClose, onDone }: { r: WorkRow; inputs: ManpowerInputs; approvals: LeaveApproval[]; today: string; onClose: () => void; onDone: (m: string) => void }) {
  const crewOn = (d: string) => { const q = personOn(r.person, d); return q.dayDuty ? null : q.crew; };
  const [start, setStart] = useState(r.expected?.start ?? r.start);
  const [end, setEnd] = useState(r.expected?.end ?? r.end);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const valid = isValidIsoDate(start) && isValidIsoDate(end) && end >= start;
  const same = valid && matchesPlan({ start, end }, { start: r.start, end: r.end }, crewOn);
  // the plan keeps the rest days after the last duty day (workbook convention)
  let planEnd = end; if (valid) for (let i = 0; i < 10 && isRestDay(addDaysIso(planEnd, 1), crewOn(addDaysIso(planEnd, 1))); i++) planEnd = addDaysIso(planEnd, 1);
  const exp = valid ? expectedRequest(start, planEnd, crewOn) : null;

  const impact = useMemo(() => (!valid || same ? null : leaveImpact(r.person, r.records, inputs, approvals, start, planEnd, today)), [valid, same, r, inputs, approvals, start, planEnd, today]);

  async function apply(status: OracleStatus | null) {
    setBusy(true); setErr(null);
    try {
      let ids = r.records.map((x) => x.id!);
      if (!same) {
        ids = await saveLeaveDates(r.records, start, planEnd, `Oracle request ${range(start, end)}`);
      }
      if (status) await setOracleStatus(ids, status);
      onDone(`${r.person.name}: ${same ? '' : `plan now ${range(start, planEnd)}; `}${status ? `${ORACLE_LABEL[status].toLowerCase()} in Oracle` : 'saved'}.`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  async function undo(status: OracleStatus) {
    setBusy(true); setErr(null);
    try { await setOracleStatus(r.records.map((x) => x.id!), status); onDone(`${r.person.name}: back to ${ORACLE_LABEL[status].toLowerCase()} in Oracle.`); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }

  return (
    <BottomSheet open onClose={onClose} title={r.person.name}>
      <div className="space-y-3">
        <div className="-mt-2 flex items-center gap-2 text-sm">
          <CopyNumber value={r.person.employeeNumber} />
          <Link to={`/employees/${r.person.id}`} className="flex min-w-0 flex-1 items-center gap-2">
            {r.crew !== 'DAY' && <CrewBadge crew={r.crew} size="sm" />}
            <span className="truncate text-slate-500">{ROLE_LABEL[r.role ?? ''] ?? ''}{r.person.grade ? ` · Grade ${r.person.grade}` : ''}</span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
          </Link>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
          <div className="text-slate-700">Plan: <b>{range(r.start, r.end)}</b> {r.codes.join('+')}</div>
          {r.expected && <div className="text-xs text-slate-500">Expected in Oracle: {range(r.expected.start, r.expected.end)} · {r.expected.days} days · back {weekday(r.expected.backOn)} {shortDate(r.expected.backOn)}</div>}
          <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">Oracle now <OraclePill status={r.oracle} /></div>
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">EasyHR request</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start"><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End"><input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {!valid ? <p className="text-sm text-slate-600">Enter both dates (end on or after start).</p> : same ? (
          <p className="flex items-center gap-1 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-800 ring-1 ring-green-200"><Check className="h-4 w-4" />Matches plan · {oracleDays(start, end)} days{exp ? ` · back ${weekday(exp.backOn)} ${shortDate(exp.backOn)}` : ''}</p>
        ) : (
          <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
            <div className="font-medium">Different from plan · new plan {range(start, planEnd)} · {oracleDays(start, end)} days{exp ? ` · back ${weekday(exp.backOn)} ${shortDate(exp.backOn)}` : ''}</div>
            {impact && (impact.short > 0 || impact.clash.length > 0) ? <>
              {impact.short > 0 && <div className="text-xs font-semibold text-status-red">Crew short on {impact.short} dut{impact.short === 1 ? 'y' : 'ies'} with these dates</div>}
              {impact.clash.length > 0 && <div className="text-xs font-semibold text-status-red">2 Controllers off · with {impact.clash.join(', ')}</div>}
            </> : <div className="text-xs text-green-800">No shortage with these dates ✓</div>}
          </div>
        )}
        {err != null && <ErrorBox error={err} />}
        {(r.oracle === 'approved' || r.oracle === 'rejected') && (
          <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            <div className="mb-1.5 text-xs font-medium text-slate-600">{r.oracle === 'approved' ? 'Approved by mistake?' : 'Rejected by mistake?'} Undo:</div>
            <div className="grid grid-cols-2 gap-2">
              {(['submitted', 'not_submitted'] as const).map((st) => (
                <button key={st} type="button" disabled={busy} onClick={() => undo(st)} className="min-h-10 rounded-lg bg-white text-xs font-semibold text-slate-800 ring-1 ring-slate-300 disabled:opacity-50">Back to {ORACLE_LABEL[st]}</button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy || !valid} onClick={() => apply('approved')} className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-green-600 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" />{same ? 'Approve' : 'Save & approve'}</button>
          <button type="button" disabled={busy} onClick={() => apply('rejected')} className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white text-sm font-semibold text-status-red ring-1 ring-red-300 disabled:opacity-50"><X className="h-4 w-4" />Reject</button>
        </div>
        {!same && valid && <Button variant="secondary" className="w-full" disabled={busy} onClick={() => apply('submitted')}>Save dates · mark Submitted</Button>}
      </div>
    </BottomSheet>
  );
}

function CancelSheet({ r, onClose, onDone }: { r: WorkRow; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState('Rejected in Oracle HR');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function go() {
    setBusy(true); setErr(null);
    try { for (const x of r.records) await cancelLeave(x.id!, reason.trim()); onDone(`${r.person.name}: leave ${range(r.start, r.end)} cancelled. It stays in the history.`); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="Cancel this leave">
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{r.person.name} · {r.codes.join('+')} {range(r.start, r.end)}</p>
        <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Back</Button>
          <Button variant="danger" className="flex-1" disabled={busy || !reason.trim()} onClick={go}>{busy ? 'Saving…' : 'Cancel leave'}</Button>
        </div>
      </div>
    </BottomSheet>
  );
}

/** The employee number, tap to copy (to paste into EasyHR). */
function CopyNumber({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); }
    catch {
      // older iOS / no clipboard permission: copy through a hidden text field
      const t = document.createElement('textarea'); t.value = value; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); t.setSelectionRange(0, value.length); document.execCommand('copy'); document.body.removeChild(t);
    }
    setCopied(true); window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" onClick={copy} aria-label={`Copy employee number ${value}`}
      className={cx('flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-base font-semibold tracking-wide ring-1', copied ? 'bg-green-50 text-green-800 ring-green-300' : 'bg-brand-50 text-brand-800 ring-brand-100 active:bg-brand-100')}>
      {value}{copied ? <><Check className="h-4 w-4" /><span className="font-sans text-xs">Copied</span></> : <Copy className="h-3.5 w-3.5 opacity-60" />}
    </button>
  );
}
