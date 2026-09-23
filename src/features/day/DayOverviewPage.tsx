import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { evaluateDay, FULL_OPERATION } from '@/core/manpower';
import type { CrewDay, DayResult, Finding, MpAbsence, MpAssignment, MpPerson, PositionResult, Status } from '@/core/manpower';
import { addDaysIso, isValidIsoDate } from '@/core/roster';
import { fetchManpowerInputs } from '@/data/manpower';
import { Card, ErrorBox, Spinner, cx, fmtDate } from '@/ui/components';
import { CREW_IDENTITY, CrewBadge, crewEdge } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { onLeaveOn, type OnLeave } from '@/core/leave';
import { CREWS } from '@/core/roster';

const weekday = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' });

const STATUS_TEXT: Record<Status, string> = { green: 'GREEN', amber: 'AMBER', red: 'RED' };
const STATUS_HINT: Record<Status, string> = { green: 'Above minimum', amber: 'No Manpower Buffer', red: 'Below minimum or requirement missing' };
const STATUS_BG: Record<Status, string> = { green: 'bg-status-green', amber: 'bg-status-amber', red: 'bg-status-red' };
const STATUS_TEXT_CLS: Record<Status, string> = { green: 'text-status-green', amber: 'text-status-amber', red: 'text-status-red' };
const STATUS_RING: Record<Status, string> = { green: 'ring-green-200', amber: 'ring-amber-300', red: 'ring-red-300' };

// Four categories kept visually distinct from the GREEN / AMBER / RED manpower result. Pending items are grey;
// no category uses a crew colour (A blue, B green, C orange, D purple).
const CATEGORY = {
  shortage: { label: 'Confirmed shortage', pill: 'bg-status-red text-white', text: 'text-status-red', box: 'bg-red-50 ring-red-200 text-red-800' },
  coverage_required: { label: 'Controller coverage required', pill: 'bg-slate-700 text-white', text: 'text-slate-700', box: 'bg-slate-100 ring-slate-300 text-slate-800' },
  data_incomplete: { label: 'Qualification data incomplete', pill: 'bg-slate-500 text-white', text: 'text-slate-600', box: 'bg-slate-50 ring-slate-300 text-slate-700' },
  unresolved: { label: 'Unresolved absence warning', pill: 'bg-white text-amber-800 ring-1 ring-amber-400', text: 'text-amber-800', box: 'bg-amber-50 ring-amber-200 text-amber-900' }
} as const;
const PENDING_PILL: Record<'coverage_required' | 'data_incomplete', string> = { coverage_required: 'COVERAGE REQUIRED', data_incomplete: 'DATA INCOMPLETE' };

function findingColor(f: Finding): string {
  return f === 'above_minimum' || f === 'staffed' ? 'text-status-green' : f === 'no_buffer' ? 'text-status-amber' : f === 'shortage' ? 'text-status-red' : f === 'coverage_required' ? 'text-slate-700' : 'text-slate-500';
}

function PendingPill({ kind }: { kind: 'coverage_required' | 'data_incomplete' }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold', CATEGORY[kind].pill)}>{PENDING_PILL[kind]}</span>;
}

function StatusPill({ status, small }: { status: Status; small?: boolean }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full font-semibold text-white', STATUS_BG[status], small ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs')}>{STATUS_TEXT[status]}{status === 'amber' && !small ? ' · No Buffer' : ''}</span>;
}

export default function DayOverviewPage() {
  const [params, setParams] = useSearchParams();
  const today = localToday();
  const tomorrow = addDaysIso(today, 1);
  const raw = params.get('date') ?? '';
  const date = isValidIsoDate(raw) ? raw : today;
  const setDate = (d: string) => setParams(d === today ? {} : { date: d }, { replace: true });

  const [inputs, setInputs] = useState<{ people: MpPerson[]; absences: MpAbsence[]; assignments: MpAssignment[]; from: string; to: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (inputs && inputs.from <= date && date <= inputs.to) return;
    // load a window around the date so stepping day by day does not refetch
    const from = addDaysIso(date, -45); const to = addDaysIso(date, 60);
    setError(null);
    fetchManpowerInputs(from, to).then((r) => setInputs({ ...r, from, to })).catch(setError);
  }, [date, inputs]);

  const result = useMemo(() => (inputs ? evaluateDay(date, inputs.people, inputs.absences, FULL_OPERATION, inputs.assignments) : null), [date, inputs]);
  const leave = useMemo(() => {
    if (!inputs) return new Map<string, OnLeave>();
    const crewOf = new Map(inputs.people.map((p) => [p.id, p.crew]));
    return onLeaveOn(date, inputs.absences.map((a) => ({ employeeId: a.employeeId, start: a.start, end: a.end, status: a.status, inCurrentPlan: a.inCurrentPlan !== false, typeLabel: a.typeLabel ?? null, typeShort: a.typeShort ?? null })), (id) => crewOf.get(id) ?? null);
  }, [date, inputs]);
  const tcPending = inputs?.people.filter((p) => p.role === 'field_operator' && p.takeCharge !== 'yes').length ?? 0;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button aria-label="Previous day" onClick={() => setDate(addDaysIso(date, -1))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 active:bg-slate-50"><ChevronLeft className="h-5 w-5" /></button>
        <div className="grid flex-1 grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
          <button onClick={() => setDate(today)} className={cx('min-h-9 rounded-lg font-medium', date === today ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>Today</button>
          <button onClick={() => setDate(tomorrow)} className={cx('min-h-9 rounded-lg font-medium', date === tomorrow ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>Tomorrow</button>
          <label className={cx('relative flex min-h-9 items-center justify-center rounded-lg font-medium', date !== today && date !== tomorrow ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>
            Pick date
            <input type="date" aria-label="Pick a date" value={date} onChange={(e) => isValidIsoDate(e.target.value) && setDate(e.target.value)} className="absolute inset-0 opacity-0" />
          </label>
        </div>
        <button aria-label="Next day" onClick={() => setDate(addDaysIso(date, 1))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 active:bg-slate-50"><ChevronRight className="h-5 w-5" /></button>
      </div>

      <div className="mb-3">
        <h1 className="text-xl font-semibold text-brand-800">{weekday(date)}, {fmtDate(date)}</h1>
        <p className="text-xs text-slate-500">Full operation · required per crew: Controller 1 · Panel 3 · Field 6</p>
      </div>

      {error ? <ErrorBox error={error} /> : !result ? <Spinner /> : (
        <>
          <OverallBanner result={result} />
          {tcPending > 0 && (
            <Link to="/review/take-charge" className="mb-3 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-slate-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Qualification data incomplete: {tcPending} Field Operators have Take-Charge not yet confirmed. Only Take-Charge = Yes counts, so Field results are not final until they are confirmed. <span className="font-semibold underline">Confirm Take-Charge</span></span>
            </Link>
          )}
          <div className="space-y-3">
            {result.crews.map((c) => <CrewCard key={c.crew} crew={c} leave={leave} date={date} />)}
          </div>
          <DayStaffCard result={result} leave={leave} />
          <Legend />
        </>
      )}
    </div>
  );
}

function OverallBanner({ result }: { result: DayResult }) {
  const { counts } = result;
  const final = result.finalStatus;
  const ring = final ? STATUS_RING[final] : 'ring-slate-300';
  const headline = final === 'red' ? 'Confirmed manpower shortage' : final ? STATUS_HINT[final] : 'Not final — items pending';
  const headlineCls = final ? STATUS_TEXT_CLS[final] : 'text-slate-700';
  const reds = result.crews.filter((c) => c.confirmedShortage);
  return (
    <div className={cx('mb-3 rounded-2xl bg-white p-4 shadow-sm ring-2', ring)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500">Overall</div>
          <div className={cx('text-lg font-semibold leading-snug', headlineCls)}>{headline}</div>
          <div className="text-xs text-slate-600">
            {reds.length ? <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">{reds.map((c) => <span key={c.crew} className="inline-flex items-center gap-1"><CrewBadge crew={c.crew} size="sm" /> {c.shift}</span>)} confirmed short</span> : final ? `${result.crews.filter((c) => c.working).length} crews on duty` : `Provisional result once resolved: ${STATUS_TEXT[result.provisionalStatus]}`}
          </div>
        </div>
        {final ? <StatusPill status={final} /> : <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">PENDING</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
        <CountChip n={counts.confirmedShortage} label="Confirmed shortage" kind="shortage" unit="crew" />
        <CountChip n={counts.coverageRequired} label="Coverage required" kind="coverage_required" unit="crew" />
        <CountChip n={counts.dataIncomplete} label="Data incomplete" kind="data_incomplete" unit="crew" />
        <CountChip n={counts.unresolvedWarnings} label="Unresolved warnings" kind="unresolved" unit="person" />
      </div>
    </div>
  );
}

function CountChip({ n, label, kind, unit }: { n: number; label: string; kind: keyof typeof CATEGORY; unit: string }) {
  return (
    <div className={cx('flex items-center justify-between rounded-lg px-2 py-1.5 ring-1', n ? CATEGORY[kind].box : 'bg-white text-slate-400 ring-slate-200')}>
      <span>{label}</span><span className="font-semibold tabular-nums" title={`${n} ${unit}${n === 1 ? '' : 's'}`}>{n}</span>
    </div>
  );
}

function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="mt-3">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-sm font-medium text-brand-700">What the labels mean {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
      {open && (
        <dl className="mt-2 space-y-2 text-xs text-slate-600">
          <div><dt className="font-semibold text-slate-700">Crew colours</dt><dd className="mt-1 flex flex-wrap gap-3">{CREWS.map((k) => <span key={k} className="inline-flex items-center gap-1.5"><CrewBadge crew={k} size="sm" /> {CREW_IDENTITY[k].colour}</span>)}</dd><dd className="mt-1">The circle and left edge say which crew it is. They never mean manpower status.</dd></div>
          <div><dt className="font-semibold text-status-green">GREEN</dt><dd>Qualified manpower above minimum, or the crew Controller is available (one Controller is the normal complement). Final.</dd></div>
          <div><dt className="font-semibold text-status-amber">AMBER · No Buffer</dt><dd>Panel or Field has exactly the number required; the card names which one. Final.</dd></div>
          <div><dt className={cx('font-semibold', CATEGORY.shortage.text)}>RED · Confirmed shortage</dt><dd>Fewer people available than required, even if every unconfirmed qualification were confirmed. Panel also needs at least one Grade 14+ operator; if none is available the card says so. Final.</dd></div>
          <div><dt className={cx('font-semibold', CATEGORY.coverage_required.text)}>Controller coverage required</dt><dd>The crew Controller is on leave or on another assignment and no cover is recorded. Not final: it becomes final once a cover is assigned in Controller Management.</dd></div>
          <div><dt className={cx('font-semibold', CATEGORY.data_incomplete.text)}>Qualification data incomplete</dt><dd>Below minimum only because qualifications (for example Take-Charge) are not yet confirmed. Not Yet Confirmed never counts; the result becomes final once the data is confirmed.</dd></div>
          <div><dt className={cx('font-semibold', CATEGORY.unresolved.text)}>Unresolved absence warning</dt><dd>Absence seen on the monthly sheet with no confirmed type. Shown for review only; it never reduces manpower.</dd></div>
        </dl>
      )}
    </Card>
  );
}

type Note = { text: string; tone: 'red' | 'amber' | 'pending' | 'muted' | 'good'; to?: string; link?: string };
const NOTE_CLS: Record<Note['tone'], string> = { red: 'text-status-red', amber: 'text-status-amber', pending: 'text-slate-600', muted: 'text-slate-500', good: 'text-slate-700' };

/** What to say directly under a manpower line. Plain words; the rule details stay in "Who counts". */
const ROLE_SHORT: Record<string, string> = { vr_controller: 'VR', morning_controller: 'Morning Controller', controller: 'Shift Controller' };

function notesFor(c: CrewDay, key: 'controller' | 'panel' | 'field', leave: Map<string, OnLeave>, date: string): Note[] {
  const notes: Note[] = [];
  if (key === 'controller') {
    const p = c.controller;
    if (p.acting) notes.push({ text: `Acting Controller: ${p.acting.name}`, tone: 'muted' });
    const whoIsOut = [...p.onLeave.map((x) => `${x.name}${leave.get(x.id) ? ` (${leaveShort(leave.get(x.id)!)})` : ''}`), ...p.away.map((w) => `${w.person.name} (${w.assignment.kind === 'morning_rotation' ? 'Morning rotation' : `covering ${w.assignment.crew} Shift`})`)];
    if (p.cover?.counted) notes.push({ text: `Covered by ${p.cover.person.name} (${ROLE_SHORT[p.cover.person.role ?? ''] ?? 'Controller'}) until ${shortDate(p.cover.assignment.end)}${whoIsOut.length ? ` · for ${whoIsOut.join(', ')}` : ''}`, tone: 'good' });
    if (p.finding === 'coverage_required') {
      const coverOut = p.cover && !p.cover.counted ? ` — recorded cover ${p.cover.person.name} is on leave` : ' — cover not recorded';
      notes.push({ text: `${whoIsOut.join(', ')}${coverOut}`, tone: 'pending', to: `/controllers?assign=cover&crew=${c.crew}&from=${date}`, link: 'Assign cover' });
    }
    if (p.finding === 'shortage') notes.push({ text: 'No qualified Controller', tone: 'red' });
    if (p.finding === 'data_incomplete') notes.push({ text: 'Controller grade not recorded', tone: 'pending' });
  }
  if (key === 'panel') {
    const p = c.panel;
    if (p.finding === 'shortage') {
      if (p.count < p.min) notes.push({ text: `Short by ${p.min - p.count}`, tone: 'red' });
      if (p.grade14 < 1) notes.push({ text: 'No Grade 14+ Panel Operator available', tone: 'red' });
    }
    if (p.finding === 'data_incomplete') {
      if (p.count < p.min) notes.push({ text: `${p.potential - p.count} Panel qualification not yet confirmed`, tone: 'pending' });
      if (p.grade14 < 1) notes.push({ text: 'Grade 14+ Panel Operator not confirmed', tone: 'pending' });
    }
  }
  if (key === 'field') {
    const p = c.field;
    if (p.finding === 'shortage') notes.push({ text: `Short by ${p.min - p.count}`, tone: 'red' });
    if (p.finding === 'data_incomplete') notes.push({ text: `${p.potential - p.count} Take-Charge not yet confirmed`, tone: 'pending' });
  }
  if (c[key].finding === 'no_buffer') notes.push({ text: 'No buffer — one more absence and the crew is short', tone: 'amber' });
  return notes;
}

const leaveShort = (l: OnLeave) => `${l.typeShort ?? 'Leave'} · Return ${shortDate(l.returnOn)}`;

function ManpowerLine({ label, pos, notes }: { label: string; pos: PositionResult; notes: Note[] }) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className={cx('text-lg font-semibold tabular-nums', findingColor(pos.finding))}>{pos.count} <span className="text-slate-400">/</span> {pos.min}</span>
      </div>
      {notes.map((n) => <div key={n.text} className={cx('text-xs leading-snug', NOTE_CLS[n.tone])}>{n.text}{n.to && <> · <Link to={n.to} className="font-semibold text-brand-700 underline">{n.link}</Link></>}</div>)}
    </div>
  );
}

/** One absent person: name and "PV · Return 27 Sep"; tap for the full type and dates. */
function AbsentRow({ person, absence, leave }: { person: MpPerson; absence: MpAbsence; leave?: OnLeave }) {
  const [open, setOpen] = useState(false);
  const start = leave?.start ?? absence.start; const until = leave?.until ?? absence.end;
  return (
    <li>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-baseline justify-between gap-2 py-1 text-left">
        <span className="truncate font-medium text-slate-800">{person.name}</span>
        <span className="shrink-0 text-xs font-medium text-slate-600">{leave ? leaveShort(leave) : absence.typeShort ?? 'Leave'}</span>
      </button>
      {open && (
        <div className="mb-1 rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
          {absence.typeLabel ?? 'Leave'} · {fmtDate(start)} – {fmtDate(until)}
          {leave && <> · back to work {fmtDate(leave.returnOn)}</>}
          <Link to={`/employees/${person.id}`} className="ml-2 font-medium text-brand-700">Profile</Link>
        </div>
      )}
    </li>
  );
}

function CrewCard({ crew: c, leave, date }: { crew: CrewDay; leave: Map<string, OnLeave>; date: string }) {
  const [open, setOpen] = useState(false);
  if (!c.working) {
    return (
      <Card className={cx('bg-slate-50', crewEdge(c.crew))}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <CrewBadge crew={c.crew} muted />
            <div className="min-w-0"><div className="font-semibold text-slate-700">{c.crew} Shift · Off</div><div className="text-xs text-slate-500">{c.dutyLabel} · rest day</div></div>
          </div>
          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">OFF</span>
        </div>
        {c.absences.length > 0 && (
          <ul className="mt-2 text-sm text-slate-500">
            {c.absences.map((a) => <AbsentRow key={a.person.id} person={a.person} absence={a.absence} leave={leave.get(a.person.id)} />)}
          </ul>
        )}
      </Card>
    );
  }
  const final = c.finalStatus;
  return (
    <Card className={crewEdge(c.crew)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <CrewBadge crew={c.crew} />
          <div className="min-w-0 text-base font-bold leading-tight text-slate-900">{c.crew} Shift <span className="font-medium text-slate-500">· {c.shift} {c.duty}</span></div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {final ? <StatusPill status={final} small /> : null}
          {c.pending.includes('coverage_required') && <PendingPill kind="coverage_required" />}
          {c.pending.includes('data_incomplete') && <PendingPill kind="data_incomplete" />}
        </div>
      </div>
      {!final && c.provisionalStatus && (
        <div className="mt-1 text-xs text-slate-500">Not final. Once resolved: <span className={cx('font-semibold', STATUS_TEXT_CLS[c.provisionalStatus])}>{STATUS_TEXT[c.provisionalStatus]}</span></div>
      )}
      <div className="mt-2 divide-y divide-slate-100">
        <ManpowerLine label="Controller" pos={c.controller} notes={notesFor(c, 'controller', leave, date)} />
        <ManpowerLine label="Panel" pos={c.panel} notes={notesFor(c, 'panel', leave, date)} />
        <ManpowerLine label="Field" pos={c.field} notes={notesFor(c, 'field', leave, date)} />
      </div>
      {c.absences.length > 0 && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Absent</div>
          <ul className="text-sm">
            {c.absences.map((a) => <AbsentRow key={a.person.id} person={a.person} absence={a.absence} leave={leave.get(a.person.id)} />)}
          </ul>
        </div>
      )}
      {c.unresolved.length > 0 && (
        <div className={cx('mt-2 rounded-lg p-2 text-xs ring-1', CATEGORY.unresolved.box)}>
          <div className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Unresolved absence warning — not deducted</div>
          <ul className="mt-1 space-y-0.5">{c.unresolved.map((a) => <li key={a.person.id}>{a.person.name} · {a.absence.start === a.absence.end ? fmtDate(a.absence.start) : `${fmtDate(a.absence.start)} → ${fmtDate(a.absence.end)}`}</li>)}</ul>
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="mt-2 flex min-h-9 w-full items-center justify-center gap-1 rounded-xl text-xs font-medium text-brand-700 hover:bg-brand-50">
        {open ? <>Hide details <ChevronUp className="h-4 w-4" /></> : <>Who counts <ChevronDown className="h-4 w-4" /></>}
      </button>
      {open && (
        <div className="mt-1 space-y-3 border-t border-slate-100 pt-3">
          <PositionDetail pos={c.controller} acting={c.controller.acting} />
          <PositionDetail pos={c.panel} grade14 />
          <PositionDetail pos={c.field} />
        </div>
      )}
    </Card>
  );
}

function PositionDetail({ pos, acting, grade14 }: { pos: PositionResult; acting?: MpPerson | null; grade14?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span>{pos.label} · counted {pos.count} of minimum {pos.min}</span>
        {pos.final ? <StatusPill status={pos.status} small /> : <PendingPill kind={pos.finding as 'coverage_required' | 'data_incomplete'} />}
      </div>
      <ul className="mt-1 space-y-0.5 text-sm">
        {pos.counted.map((p) => (
          <li key={p.id} className="flex justify-between gap-2">
            <Link to={`/employees/${p.id}`} className="truncate text-brand-700">{p.name}</Link>
            <span className="shrink-0 text-xs text-slate-500">
              {p.grade != null ? `G${p.grade}` : p.employmentType === 'contractor' ? 'Contractor' : 'G?'}
              {grade14 && p.grade != null && p.grade >= 14 ? ' · Grade 14+' : ''}
              {acting?.id === p.id ? ' · Acting Controller' : ''}
            </span>
          </li>
        ))}
        {pos.notCounted.map((n) => (
          <li key={n.person.id} className="flex justify-between gap-2 text-slate-400">
            <Link to={`/employees/${n.person.id}`} className="truncate">{n.person.name}</Link>
            <span className={cx('shrink-0 text-right text-xs', n.pendingData && 'text-slate-500')}>{n.reason}</span>
          </li>
        ))}
        {pos.counted.length + pos.notCounted.length === 0 && <li className="text-xs text-slate-400">Nobody available in this position.</li>}
      </ul>
    </div>
  );
}

function DayStaffCard({ result, leave }: { result: DayResult; leave: Map<string, OnLeave> }) {
  if (!result.dayStaff.length) return null;
  const label = (s: DayResult['dayStaff'][number]) =>
    s.morningPost ? `Morning Controller${s.assignment?.kind === 'morning_rotation' ? ` (rotation until ${shortDate(s.assignment.end)})` : ''}`
      : s.person.role === 'vr_controller' ? 'Vacation Relief Controller' : s.person.role === 'morning_controller' ? 'Morning Controller (post on rotation)' : 'Shift Controller';
  const needing = result.crews.filter((c) => c.pending.includes('coverage_required'));
  return (
    <Card className="mt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Controllers outside the crews</div>
      <ul className="mt-1 space-y-1 text-sm">
        {result.dayStaff.map((s) => (
          <li key={s.person.id} className="flex justify-between gap-2">
            <span className="min-w-0"><span className="block truncate font-medium text-slate-800">{s.person.name}</span><span className="block text-xs text-slate-500">{label(s)}</span></span>
            <span className="shrink-0 text-right text-xs">
              {s.absence ? <span className="block text-status-red">{leave.get(s.person.id) ? leaveShort(leave.get(s.person.id)!) : s.absence.typeShort ?? 'On leave'}</span>
                : s.assignment?.kind === 'shift_cover' && s.assignment.crew ? <span className="inline-flex items-center gap-1 font-medium text-slate-700"><CrewBadge crew={s.assignment.crew} size="sm" /> Covering until {shortDate(s.assignment.end)}</span>
                : <span className="block text-status-green">{s.morningPost ? 'On duty' : 'Available'}</span>}
              {s.unresolved ? <span className="block text-status-amber">Unresolved absence (warning only)</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {needing.length > 0 && (
        <p className={cx('mt-2 rounded-lg p-2 text-[11px] ring-1', CATEGORY.coverage_required.box)}>
          Controller coverage required today: {needing.map((c) => <span key={c.crew} className="mr-1 inline-flex items-center gap-1 align-middle"><CrewBadge crew={c.crew} size="sm" /> {c.shift}</span>)}.{' '}
          <Link to="/controllers" className="font-semibold text-brand-700 underline">Controller Management</Link>
        </p>
      )}
    </Card>
  );
}
