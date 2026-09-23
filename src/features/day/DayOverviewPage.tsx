import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { evaluateDay } from '@/core/manpower';
import type { CrewDay, DayResult, Finding, MpAbsence, MpPerson, PositionResult, Status } from '@/core/manpower';
import { addDaysIso, isValidIsoDate } from '@/core/roster';
import { fetchManpowerInputs } from '@/data/manpower';
import { Card, ErrorBox, Spinner, cx, fmtDate } from '@/ui/components';
import { CREW_IDENTITY, CrewBadge, crewEdge } from '@/ui/crew';
import { CREWS } from '@/core/roster';

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
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

  const [inputs, setInputs] = useState<{ people: MpPerson[]; absences: MpAbsence[]; from: string; to: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (inputs && inputs.from <= date && date <= inputs.to) return;
    // load a window around the date so stepping day by day does not refetch
    const from = addDaysIso(date, -7); const to = addDaysIso(date, 31);
    setError(null);
    fetchManpowerInputs(from, to).then((r) => setInputs({ ...r, from, to })).catch(setError);
  }, [date, inputs]);

  const result = useMemo(() => (inputs ? evaluateDay(date, inputs.people, inputs.absences) : null), [date, inputs]);
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
        <p className="text-xs text-slate-500">Day Overview · full operation · minimums Controller 1 · Panel 3 (1 Grade 14+) · Field 6 (Take-Charge)</p>
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
            {result.crews.map((c) => <CrewCard key={c.crew} crew={c} />)}
          </div>
          <DayStaffCard result={result} />
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
          <div><dt className="font-semibold text-status-amber">AMBER · No Buffer</dt><dd>Panel or Field exactly at minimum. Final.</dd></div>
          <div><dt className={cx('font-semibold', CATEGORY.shortage.text)}>RED · Confirmed shortage</dt><dd>Below minimum, or no Grade 14+ Panel Operator, even if every unconfirmed qualification were confirmed. Final.</dd></div>
          <div><dt className={cx('font-semibold', CATEGORY.coverage_required.text)}>Controller coverage required</dt><dd>The crew Controller is on leave and no cover is recorded yet. Not final: the result becomes final once coverage is assigned (Controller Management stage).</dd></div>
          <div><dt className={cx('font-semibold', CATEGORY.data_incomplete.text)}>Qualification data incomplete</dt><dd>Below minimum only because qualifications (for example Take-Charge) are not yet confirmed. Not Yet Confirmed never counts; the result becomes final once the data is confirmed.</dd></div>
          <div><dt className={cx('font-semibold', CATEGORY.unresolved.text)}>Unresolved absence warning</dt><dd>Absence seen on the monthly sheet with no confirmed type. Shown for review only; it never reduces manpower.</dd></div>
        </dl>
      )}
    </Card>
  );
}

function Metric({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2 text-center">
      <div className={cx('text-lg font-semibold tabular-nums', color)}>{value}</div>
      <div className="text-[11px] leading-tight text-slate-600">{label}</div>
      {sub ? <div className="text-[10px] leading-tight text-slate-400">{sub}</div> : null}
    </div>
  );
}

function CrewCard({ crew: c }: { crew: CrewDay }) {
  const [open, setOpen] = useState(false);
  if (!c.working) {
    return (
      <Card className={cx('bg-slate-50', crewEdge(c.crew))}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <CrewBadge crew={c.crew} muted />
            <div className="min-w-0"><div className="font-semibold text-slate-700">{c.crew} SHIFT · Off</div><div className="text-xs text-slate-500">{c.dutyLabel} · {c.members} people · rest day</div></div>
          </div>
          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">OFF</span>
        </div>
        {c.absences.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
            {c.absences.map((a) => <li key={a.person.id}>{a.person.name} — {a.absence.typeLabel ?? 'Leave'} (Off day, no manpower impact)</li>)}
          </ul>
        )}
      </Card>
    );
  }
  const final = c.finalStatus;
  const g14Color = c.panel.grade14 >= 1 ? 'text-status-green' : findingColor(c.panel.finding);
  const byFinding = (f: Finding) => [c.controller, c.panel, c.field].filter((p) => p.finding === f).flatMap((p) => p.issues.filter((i) => !i.startsWith('Acting')));
  const shortages = byFinding('shortage'); const coverage = byFinding('coverage_required'); const incomplete = byFinding('data_incomplete');
  return (
    <Card className={crewEdge(c.crew)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <CrewBadge crew={c.crew} size="lg" />
          <div className="min-w-0">
            <div className="text-lg font-bold leading-tight text-slate-900">{c.crew} SHIFT</div>
            <div className="text-xs text-slate-500"><span className="whitespace-nowrap">{c.shift} · {c.duty}</span> · <span className="whitespace-nowrap">{c.members} people</span></div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {final ? <StatusPill status={final} /> : null}
          {c.pending.includes('coverage_required') && <PendingPill kind="coverage_required" />}
          {c.pending.includes('data_incomplete') && <PendingPill kind="data_incomplete" />}
        </div>
      </div>
      {!final && c.provisionalStatus && (
        <div className="mt-1 text-xs text-slate-500">Not final. Provisional once resolved: <span className={cx('font-semibold', STATUS_TEXT_CLS[c.provisionalStatus])}>{STATUS_TEXT[c.provisionalStatus]}{c.provisionalStatus === 'amber' ? ' (No Buffer)' : ''}</span></div>
      )}
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <Metric label="Controller" value={`${c.controller.count}/${c.controller.min}`} color={findingColor(c.controller.finding)} sub={c.controller.acting ? 'Acting' : c.controller.finding === 'coverage_required' ? 'cover needed' : undefined} />
        <Metric label="Panel" value={`${c.panel.count}/${c.panel.min}`} color={findingColor(c.panel.finding)} sub={c.panel.finding === 'data_incomplete' ? `${c.panel.potential - c.panel.count} unconfirmed` : undefined} />
        <Metric label="Grade 14+" value={String(c.panel.grade14)} color={g14Color} sub="available" />
        <Metric label="Field" value={`${c.field.count}/${c.field.min}`} color={findingColor(c.field.finding)} sub={c.field.finding === 'data_incomplete' ? `${c.field.potential - c.field.count} unconfirmed` : c.field.notCounted.length ? `${c.field.notCounted.length} not counted` : undefined} />
      </div>
      {c.controller.acting && (
        <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-800 ring-1 ring-slate-200">Acting Controller: <span className="font-semibold">{c.controller.acting.name}</span> (Grade {c.controller.acting.grade})</div>
      )}
      {c.noBuffer && <div className="mt-2 text-xs font-medium text-status-amber">No Manpower Buffer — any further absence drops this crew below minimum.</div>}
      <FindingBox kind="shortage" items={shortages} />
      <FindingBox kind="coverage_required" items={coverage} />
      <FindingBox kind="data_incomplete" items={incomplete} />
      {c.absences.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Absences</div>
          <ul className="mt-1 space-y-0.5 text-sm">
            {c.absences.map((a) => <li key={a.person.id} className="flex justify-between gap-2"><span className="truncate">{a.person.name}</span><span className="shrink-0 text-xs text-slate-500">{a.absence.typeLabel ?? 'Leave'}</span></li>)}
          </ul>
        </div>
      )}
      {c.unresolved.length > 0 && (
        <div className={cx('mt-2 rounded-lg p-2 text-xs ring-1', CATEGORY.unresolved.box)}>
          <div className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Unresolved absence warning — not deducted</div>
          <ul className="mt-1 space-y-0.5">{c.unresolved.map((a) => <li key={a.person.id}>{a.person.name} · {a.absence.start === a.absence.end ? fmtDate(a.absence.start) : `${fmtDate(a.absence.start)} → ${fmtDate(a.absence.end)}`}</li>)}</ul>
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="mt-3 flex min-h-10 w-full items-center justify-center gap-1 rounded-xl text-sm font-medium text-brand-700 hover:bg-brand-50">
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

function FindingBox({ kind, items }: { kind: 'shortage' | 'coverage_required' | 'data_incomplete'; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className={cx('mt-2 rounded-lg p-2 text-xs ring-1', CATEGORY[kind].box)}>
      <div className="font-semibold">{CATEGORY[kind].label}</div>
      <ul className="mt-0.5 space-y-0.5">{items.map((i) => <li key={i}>{i.replace(/^Confirmed shortage: /, '').replace(/^Controller coverage required: /, '')}</li>)}</ul>
    </div>
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

function DayStaffCard({ result }: { result: DayResult }) {
  if (!result.dayStaff.length) return null;
  const label = (r: string | null) => (r === 'vr_controller' ? 'Vacation Relief Controller' : 'Morning Controller');
  return (
    <Card className="mt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Controllers outside the crews</div>
      <ul className="mt-1 space-y-1 text-sm">
        {result.dayStaff.map((s) => (
          <li key={s.person.id} className="flex justify-between gap-2">
            <span className="min-w-0"><span className="block truncate font-medium text-slate-800">{s.person.name}</span><span className="block text-xs text-slate-500">{label(s.person.role)}</span></span>
            <span className="shrink-0 text-right text-xs">
              <span className={cx('block', s.absence ? 'text-status-red' : 'text-status-green')}>{s.absence ? s.absence.typeLabel ?? 'On leave' : 'Available'}</span>
              {s.unresolved ? <span className="block text-status-amber">Unresolved absence (warning only)</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {result.counts.coverageRequired > 0 && (
        <p className={cx('mt-2 rounded-lg p-2 text-[11px] ring-1', CATEGORY.coverage_required.box)}>
          Controller coverage required today: {result.crews.filter((c) => c.pending.includes('coverage_required')).map((c) => <span key={c.crew} className="mr-1 inline-flex items-center gap-1 align-middle"><CrewBadge crew={c.crew} size="sm" /> {c.shift}</span>)}. Assigning the covering Controller arrives with Controller Management.
        </p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">Not counted in crew manpower until coverage of a specific shift is recorded.</p>
    </Card>
  );
}
