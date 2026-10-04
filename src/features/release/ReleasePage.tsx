import { AlertTriangle, Check, Search, UserMinus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { personOn } from '@/core/manpower';
import { checkRelease, type ReleaseDay, type ReleaseVerdict } from '@/core/release';
import { addDaysIso, isValidIsoDate } from '@/core/roster';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { addRelease, cancelRelease, fetchReleases, type TaskRelease } from '@/data/releases';
import { BottomSheet, Button, Card, ErrorBox, Field, PageHeader, Spinner, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { nameFilter } from '@/ui/nameSearch';

const ROLE_LABEL: Record<string, string> = { controller: 'Shift Controller', vr_controller: 'VR Controller', morning_controller: 'Morning Controller', panel_operator: 'Panel Operator', field_operator: 'Field Operator' };
const MAX_DAYS = 31;
const wd = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

const VERDICT: Record<ReleaseVerdict, { label: string; chip: string; box: string }> = {
  safe: { label: 'Buffer kept', chip: 'bg-status-green text-white', box: 'bg-green-50 text-green-900 ring-green-200' },
  no_buffer: { label: 'No buffer', chip: 'bg-status-amber text-white', box: 'bg-amber-50 text-amber-900 ring-amber-300' },
  unclear: { label: 'To confirm', chip: 'bg-slate-500 text-white', box: 'bg-slate-100 text-slate-800 ring-slate-300' },
  cover: { label: 'Needs a cover', chip: 'bg-slate-700 text-white', box: 'bg-slate-100 text-slate-800 ring-slate-300' },
  shortage: { label: 'Shortage', chip: 'bg-status-red text-white', box: 'bg-red-50 text-red-900 ring-red-200' }
};

/**
 * Task release: release one employee from the crew's duty for a time to handle a task. Before recording it, see what it does
 * to the crew on each day: the counts against the minimums, whether a buffer is kept, a shortage, or a Controller cover needed.
 * A release counts as the person being away for the whole shift (the careful reading), whatever the hours.
 */
export default function ReleasePage() {
  const today = localToday();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [fromTime, setFromTime] = useState(''); const [toTime, setToTime] = useState('');
  const [task, setTask] = useState('');
  const [query, setQuery] = useState('');
  const [personId, setPersonId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<ManpowerInputs | null>(null);
  const [releases, setReleases] = useState<TaskRelease[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<TaskRelease | null>(null);

  const validDates = isValidIsoDate(start) && isValidIsoDate(end) && end >= start && Math.round((Date.parse(end) - Date.parse(start)) / 864e5) < MAX_DAYS;
  const from = isValidIsoDate(start) ? addDaysIso(start, -1) : today;
  const to = isValidIsoDate(end) ? addDaysIso(end >= start ? end : start, 1) : today;
  // the people and the plan for the days asked (reloaded when the dates move out of what was loaded)
  useEffect(() => {
    if (!validDates) return;
    let live = true;
    setInputs(null);
    fetchManpowerInputs(from, to).then((x) => { if (live) setInputs(x); }).catch((e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [from, to, validDates]);
  const loadReleases = useCallback(() => { fetchReleases(today).then(setReleases).catch(setError); }, [today]);
  useEffect(loadReleases, [loadReleases]);

  const person = inputs?.people.find((p) => p.id === personId) ?? null;
  const people = useMemo(() => {
    const q = query.trim();
    if (!inputs || !q) return [];
    const match = nameFilter(q);
    return inputs.people.filter((p) => match([p.name, p.employeeNumber])).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8);
  }, [inputs, query]);
  const nameOf = (id: string) => inputs?.people.find((p) => p.id === id)?.name ?? 'Employee';

  const check = useMemo(() => (inputs && person && validDates ? checkRelease(person, start, end, inputs.people, inputs.absencesAll, inputs.rules, inputs.assignments) : null), [inputs, person, start, end, validDates]);
  const timesOk = (!fromTime && !toTime) || (!!fromTime && !!toTime && toTime > fromTime);
  const ready = !!check && task.trim().length > 0 && timesOk;

  async function record() {
    if (!person) return;
    setBusy(true); setError(null);
    try {
      await addRelease({ employeeId: person.id, start, end, fromTime: fromTime || null, toTime: toTime || null, task });
      setNotice(`${person.name} released for ${range(start, end)}${fromTime ? ` ${fromTime}–${toTime}` : ''}: ${task.trim()}.`);
      setPersonId(null); setQuery(''); setTask(''); setFromTime(''); setToTime('');
      loadReleases();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Task release" info={<div className="space-y-2 text-sm text-slate-700">
        <p>Release one employee from the crew&apos;s duty for a time, to handle a task. Pick the person and the day: the check shows, day by day, what the crew is left with against its minimums.</p>
        <p><b>Buffer kept</b> (green): the crew stays above its minimum. <b>No buffer</b> (amber): exactly at the minimum. <b>Shortage</b> (red): below it. <b>Needs a cover</b>: the shift&apos;s Controller is the one released.</p>
        <p>A release counts as the person being away for the whole shift, whatever the hours, so the check is on the careful side. Recording it puts the person in the day&apos;s absent list and the crew counts everywhere; it is not leave and is kept in the audit history.</p>
      </div>} />
      {notice && <p role="status" className="mb-3 flex items-center gap-1 text-sm text-status-green"><Check className="h-4 w-4" />{notice}</p>}
      {error != null && <div className="mb-3"><ErrorBox error={error} /></div>}

      <Card className="mb-3 space-y-3 p-3">
        {person ? (
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            {(() => { const c = personOn(person, start).crew; return c ? <CrewBadge crew={c} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-semibold text-slate-600">DS</span>; })()}
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{person.name}</span><span className="block truncate text-xs text-slate-500">#{person.employeeNumber} · {ROLE_LABEL[person.role ?? ''] ?? ''}{person.grade ? ` · Grade ${person.grade}` : ''}</span></span>
            <button type="button" aria-label="Choose someone else" onClick={() => setPersonId(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input" style={{ paddingLeft: '2.25rem' }} placeholder="Search the employee: name or number" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {query.trim() && (people.length === 0 ? <p className="mt-2 text-sm text-slate-500">{inputs ? 'Nobody found.' : 'Loading…'}</p> : (
              <ul className="mt-2 divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
                {people.map((p) => { const c = personOn(p, start).crew; return (
                  <li key={p.id}><button type="button" onClick={() => { setPersonId(p.id); setQuery(''); }} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                    {c ? <CrewBadge crew={c} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-600">DS</span>}
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{p.name}</span><span className="block truncate text-xs text-slate-500">#{p.employeeNumber} · {ROLE_LABEL[p.role ?? ''] ?? ''}</span></span>
                  </button></li>
                ); })}
              </ul>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
          <Field label="Last day"><input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {!validDates && <p className="text-xs text-status-red">Choose the days (up to {MAX_DAYS}).</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From (optional)"><input type="time" className="input" value={fromTime} onChange={(e) => setFromTime(e.target.value)} /></Field>
          <Field label="Until"><input type="time" className="input" value={toTime} min={fromTime || undefined} onChange={(e) => setToTime(e.target.value)} /></Field>
        </div>
        {!timesOk && <p className="text-xs text-status-red">Give both times, the second after the first.</p>}
        <Field label="The task"><input className="input" value={task} onChange={(e) => setTask(e.target.value)} placeholder="e.g. Permit-to-work round for the Train-2 SD" /></Field>
      </Card>

      {person && validDates && !check && !error && <Spinner label="Checking the crew…" />}
      {check && person && (
        <div className="mb-3 space-y-2">
          <Summary check={check} name={person.name} />
          <Card className="divide-y divide-slate-100 p-0">
            {check.days.map((d) => <DayRow key={d.date} d={d} />)}
          </Card>
          <p className="text-[11px] text-slate-500">The check counts the release as the whole shift away, whatever the hours. Hours are kept with the release for the record.</p>
          <Button className={cx('w-full', check.verdict === 'shortage' && 'bg-status-red')} disabled={busy || !ready} onClick={record}>
            <UserMinus className="h-4 w-4" />{busy ? 'Recording…' : check.verdict === 'shortage' || check.verdict === 'cover' ? 'Record the release anyway' : 'Record the release'}
          </Button>
          {!task.trim() && <p className="text-center text-xs text-slate-500">Write the task to record it.</p>}
        </div>
      )}

      <section className="mt-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Recorded releases · upcoming</h2>
        {!releases ? <Spinner /> : releases.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
          <Card className="divide-y divide-slate-100 p-0">
            {releases.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{nameOf(r.employee_id)}</span>
                  <span className="block truncate text-xs text-slate-600">{range(r.start_date, r.end_date)}{r.from_time ? ` · ${hhmm(r.from_time)}–${hhmm(r.to_time)}` : ''} · {r.task}</span></span>
                <button type="button" onClick={() => setCancelling(r)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-status-red ring-1 ring-red-200">Cancel</button>
              </div>
            ))}
          </Card>
        )}
      </section>
      {cancelling && <CancelSheet r={cancelling} name={nameOf(cancelling.employee_id)} onClose={() => setCancelling(null)} onDone={(m) => { setCancelling(null); setNotice(m); loadReleases(); }} />}
    </div>
  );
}

function Summary({ check, name }: { check: ReturnType<typeof checkRelease>; name: string }) {
  const v = check.verdict;
  if (!v) return <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">No duty day in these dates for {name} (rest days or already away): the crews are not affected.</div>;
  const c = check.counts;
  const parts = [c.shortage && `${c.shortage} ${c.shortage === 1 ? 'day' : 'days'} short`, c.cover && `${c.cover} ${c.cover === 1 ? 'day needs' : 'days need'} a Controller cover`, c.unclear && `${c.unclear} ${c.unclear === 1 ? 'day' : 'days'} to confirm (Take-Charge or grade not recorded)`, c.no_buffer && `${c.no_buffer} ${c.no_buffer === 1 ? 'day' : 'days'} with no buffer`, c.safe && `${c.safe} ${c.safe === 1 ? 'day' : 'days'} with the buffer kept`].filter(Boolean);
  return (
    <div className={cx('flex items-start gap-2 rounded-xl px-3 py-2 text-sm ring-1', VERDICT[v].box)}>
      {v === 'safe' ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span><b>{v === 'safe' ? 'Release is safe: the crew keeps its buffer.' : v === 'no_buffer' ? 'The crew is left at the minimum, with no buffer.' : v === 'cover' ? 'The shift needs a Controller cover.' : v === 'unclear' ? 'Some data is not confirmed: check Take-Charge / grade.' : 'The release causes a shortage.'}</b><span className="block text-xs">{parts.join(' · ')}</span></span>
    </div>
  );
}

function DayRow({ d }: { d: ReleaseDay }) {
  const head = <span className="w-16 shrink-0 text-xs font-medium text-slate-700">{wd(d.date)} {shortDate(d.date)}</span>;
  if (!d.verdict) {
    const why = d.kind === 'rest' ? `${d.crew ? `${d.crew} Shift` : 'His crew'} is off: no effect` : d.kind === 'absent' ? 'Already away that day (leave): no change' : 'Not counted in a crew that day: no effect';
    return <div className="flex items-center gap-2 px-3 py-2 opacity-70">{head}<span className="text-xs text-slate-500">{why}</span></div>;
  }
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        {head}
        {d.crew && <CrewBadge crew={d.crew} size="sm" />}
        <span className="text-xs text-slate-600">{d.shift}</span>
        <span className={cx('ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold', VERDICT[d.verdict].chip)}>{VERDICT[d.verdict].label}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-16 text-xs tabular-nums">
        {d.positions.map((p) => <span key={p.key} className={cx(p.after !== p.before ? (p.after < p.min ? 'font-semibold text-status-red' : p.after === p.min ? 'font-semibold text-amber-700' : 'font-semibold text-slate-800') : 'text-slate-400')}>{p.label} {p.after !== p.before ? `${p.before} → ${p.after}` : p.after} <span className="text-slate-400">/ {p.min}</span></span>)}
      </div>
      {d.issues.length > 0 && <p className="mt-0.5 pl-16 text-[11px] text-slate-600">{d.issues.join(' · ')}</p>}
      {d.already.length > 0 && <p className="mt-0.5 pl-16 text-[11px] text-slate-500">Already open before the release: {d.already.join(' · ')}</p>}
    </div>
  );
}

function CancelSheet({ r, name, onClose, onDone }: { r: TaskRelease; name: string; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function go() { setBusy(true); setErr(null); try { await cancelRelease(r.id, reason); onDone(`${name}: release ${range(r.start_date, r.end_date)} cancelled.`); } catch (e) { setErr(e); setBusy(false); } }
  return (
    <BottomSheet open onClose={onClose} title="Cancel this release">
      <div className="space-y-3">
        <p className="text-sm text-slate-700">{name} · {range(r.start_date, r.end_date)} · {r.task}</p>
        <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The task was moved" /></Field>
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Back</Button><Button variant="danger" className="flex-1" disabled={busy || !reason.trim()} onClick={go}>Cancel release</Button></div>
      </div>
    </BottomSheet>
  );
}
