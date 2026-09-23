import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { evaluateDay } from '@/core/manpower';
import type { CrewDay, DayResult, MpAbsence, MpPerson, PositionResult, Status } from '@/core/manpower';
import { addDaysIso, isValidIsoDate } from '@/core/roster';
import { fetchManpowerInputs } from '@/data/manpower';
import { Card, ErrorBox, Spinner, cx, fmtDate } from '@/ui/components';

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const weekday = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' });

const STATUS_TEXT: Record<Status, string> = { green: 'GREEN', amber: 'AMBER', red: 'RED' };
const STATUS_HINT: Record<Status, string> = { green: 'Above minimum', amber: 'No Manpower Buffer', red: 'Below minimum or requirement missing' };
const STATUS_BG: Record<Status, string> = { green: 'bg-status-green', amber: 'bg-status-amber', red: 'bg-status-red' };
const STATUS_TEXT_CLS: Record<Status, string> = { green: 'text-status-green', amber: 'text-status-amber', red: 'text-status-red' };
const STATUS_RING: Record<Status, string> = { green: 'ring-green-200', amber: 'ring-amber-300', red: 'ring-red-300' };

function StatusPill({ status, small }: { status: Status; small?: boolean }) {
  return <span className={cx('inline-flex items-center rounded-full font-semibold text-white', STATUS_BG[status], small ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs')}>{STATUS_TEXT[status]}{status === 'amber' && !small ? ' · No Buffer' : ''}</span>;
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
        <p className="text-xs text-slate-500">Day Overview · full operation · minimums Controller 1 · Panel 3 (1 Grade 14) · Field 6 (Take-Charge)</p>
      </div>

      {error ? <ErrorBox error={error} /> : !result ? <Spinner /> : (
        <>
          <OverallBanner result={result} />
          {tcPending > 0 && (
            <Link to="/review/take-charge" className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Only Take-Charge = Yes counts for Field. {tcPending} Field Operators are not confirmed yet, so Field shows below minimum until the Section Head confirms them. <span className="font-semibold underline">Confirm Take-Charge</span></span>
            </Link>
          )}
          <div className="space-y-3">
            {result.crews.map((c) => <CrewCard key={c.crew} crew={c} />)}
          </div>
          <DayStaffCard result={result} />
        </>
      )}
    </div>
  );
}

function OverallBanner({ result }: { result: DayResult }) {
  const working = result.crews.filter((c) => c.working);
  const reds = working.filter((c) => c.status === 'red');
  const warnings = result.crews.reduce((n, c) => n + c.unresolved.length, 0) + result.dayStaff.filter((s) => s.unresolved).length;
  return (
    <div className={cx('mb-3 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm ring-2', STATUS_RING[result.overall])}>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-slate-500">Overall</div>
        <div className={cx('text-lg font-semibold', STATUS_TEXT_CLS[result.overall])}>{STATUS_HINT[result.overall]}</div>
        <div className="text-xs text-slate-600">
          {reds.length ? `${reds.map((c) => `${c.crew} (${c.shift})`).join(', ')} below minimum` : `${working.length} crews on duty`}
          {warnings ? ` · ${warnings} unresolved absence warning${warnings > 1 ? 's' : ''}` : ''}
        </div>
      </div>
      <StatusPill status={result.overall} />
    </div>
  );
}

function Metric({ label, value, status, sub }: { label: string; value: string; status: Status | 'neutral'; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2 text-center">
      <div className={cx('text-lg font-semibold tabular-nums', status === 'neutral' ? 'text-brand-800' : STATUS_TEXT_CLS[status])}>{value}</div>
      <div className="text-[11px] leading-tight text-slate-600">{label}</div>
      {sub ? <div className="text-[10px] leading-tight text-slate-400">{sub}</div> : null}
    </div>
  );
}

function CrewCard({ crew: c }: { crew: CrewDay }) {
  const [open, setOpen] = useState(false);
  if (!c.working) {
    return (
      <Card className="bg-slate-50">
        <div className="flex items-center justify-between">
          <div><div className="font-semibold text-slate-700">{c.crew} SHIFT — OFF</div><div className="text-xs text-slate-500">{c.dutyLabel} · {c.members} people · rest day</div></div>
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
  const status = c.status as Status;
  const g14Status: Status = c.panel.grade14 >= 1 ? 'green' : 'red';
  const issues = [...c.controller.issues.filter((i) => !i.startsWith('Acting')), ...c.panel.issues, ...c.field.issues];
  return (
    <Card className={cx('ring-2', STATUS_RING[status])}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-brand-800">{c.crew} SHIFT — {c.shift.toUpperCase()} {c.duty}</div>
          <div className="text-xs text-slate-500">{c.members} people in crew</div>
        </div>
        <StatusPill status={status} />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <Metric label="Controller" value={`${c.controller.count}/${c.controller.min}`} status={c.controller.status} sub={c.controller.acting ? 'Acting' : undefined} />
        <Metric label="Panel" value={`${c.panel.count}/${c.panel.min}`} status={c.panel.status} />
        <Metric label="Grade 14" value={String(c.panel.grade14)} status={g14Status} sub="available" />
        <Metric label="Field" value={`${c.field.count}/${c.field.min}`} status={c.field.status} sub={c.field.notCounted.length ? `${c.field.notCounted.length} not counted` : undefined} />
      </div>
      {c.controller.acting && (
        <div className="mt-2 rounded-lg bg-blue-50 px-2 py-1.5 text-xs text-brand-800 ring-1 ring-brand-100">Acting Controller: <span className="font-semibold">{c.controller.acting.name}</span> (Grade {c.controller.acting.grade})</div>
      )}
      {c.noBuffer && <div className="mt-2 text-xs font-medium text-status-amber">No Manpower Buffer — any further absence drops this crew below minimum.</div>}
      {issues.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-status-red">{issues.map((i) => <li key={i}>• {i}</li>)}</ul>
      )}
      {c.absences.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Absences</div>
          <ul className="mt-1 space-y-0.5 text-sm">
            {c.absences.map((a) => <li key={a.person.id} className="flex justify-between gap-2"><span className="truncate">{a.person.name}</span><span className="shrink-0 text-xs text-slate-500">{a.absence.typeLabel ?? 'Leave'}</span></li>)}
          </ul>
        </div>
      )}
      {c.unresolved.length > 0 && (
        <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 ring-1 ring-amber-200">
          <div className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Unresolved absence — warning only, not deducted</div>
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

function PositionDetail({ pos, acting, grade14 }: { pos: PositionResult; acting?: MpPerson | null; grade14?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span>{pos.label} · counted {pos.count} of minimum {pos.min}</span><StatusPill status={pos.status} small />
      </div>
      <ul className="mt-1 space-y-0.5 text-sm">
        {pos.counted.map((p) => (
          <li key={p.id} className="flex justify-between gap-2">
            <Link to={`/employees/${p.id}`} className="truncate text-brand-700">{p.name}</Link>
            <span className="shrink-0 text-xs text-slate-500">
              {p.grade != null ? `G${p.grade}` : p.employmentType === 'contractor' ? 'Contractor' : 'G?'}
              {grade14 && p.grade != null && p.grade >= 14 ? ' · Grade 14' : ''}
              {acting?.id === p.id ? ' · Acting Controller' : ''}
            </span>
          </li>
        ))}
        {pos.notCounted.map((n) => (
          <li key={n.person.id} className="flex justify-between gap-2 text-slate-400">
            <Link to={`/employees/${n.person.id}`} className="truncate">{n.person.name}</Link>
            <span className="shrink-0 text-right text-xs">{n.reason}</span>
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
      <p className="mt-2 text-[11px] text-slate-500">Not counted in crew manpower. Vacation Relief coverage of a specific shift is recorded in the Controller Management stage.</p>
    </Card>
  );
}
