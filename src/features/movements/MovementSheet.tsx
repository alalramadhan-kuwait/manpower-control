import { useState } from 'react';
import { CREWS, isValidIsoDate, type Crew } from '@/core/roster';
import { cancelMovement, endMovement, recordMovement, type CrewMovement } from '@/data/movements';
import { BottomSheet, Button, ErrorBox, Field, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';

export interface MovePerson { id: string; name: string; crew: Crew | null }
export type MoveTarget = { kind: 'new'; employeeId?: string; to?: Crew; start?: string; reason?: string; dayDuty?: boolean } | { kind: 'end' | 'cancel'; movement: CrewMovement };

const range = (m: CrewMovement) => `${shortDate(m.start_date)} – ${m.end_date ? shortDate(m.end_date) : 'until further notice'}`;

/** Record a shift movement, or end / cancel a temporary cover. The database checks every rule and keeps history. */
export function MovementSheet({ target, people, onClose, onDone }: { target: MoveTarget; people: MovePerson[]; onClose: () => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); setErr(null); try { await fn(); onDone(msg); } catch (e) { setErr(e); } finally { setBusy(false); } };
  if (target.kind !== 'new') return <ChangeSheet target={target} people={people} busy={busy} err={err} run={run} onClose={onClose} />;

  return <NewSheet target={target} people={people} busy={busy} err={err} run={run} onClose={onClose} />;
}

function NewSheet({ target, people, busy, err, run, onClose }: { target: Extract<MoveTarget, { kind: 'new' }>; people: MovePerson[]; busy: boolean; err: unknown; run: (fn: () => Promise<unknown>, m: string) => void; onClose: () => void }) {
  const [employee, setEmployee] = useState(target.employeeId ?? '');
  const [kind, setKind] = useState<CrewMovement['kind'] | 'day'>(target.dayDuty ? 'day' : 'temporary');
  const [to, setTo] = useState<Crew | null>(target.to ?? null);
  const [start, setStart] = useState(target.start ?? localToday());
  const [openEnded, setOpenEnded] = useState(false);
  const [end, setEnd] = useState(target.start ?? localToday());
  const [reason, setReason] = useState(target.reason ?? '');
  const person = people.find((p) => p.id === employee) ?? null;
  const crewPeople = people.filter((p) => p.crew);
  const day = kind === 'day';
  const dated = kind !== 'permanent';                                  // a temporary cover and day duty have a last day
  const problem = !employee ? 'Choose the employee.' : !day && !to ? 'Choose the crew.' : !day && person?.crew === to ? `Already in ${to} Shift.` : !isValidIsoDate(start) ? 'Enter the first day.'
    : dated && !openEnded && (!isValidIsoDate(end) || end < start) ? 'The last day must be on or after the first day.' : !reason.trim() ? 'Give the reason.' : null;
  const until = openEnded ? 'until further notice' : shortDate(end);
  const save = () => run(() => recordMovement({ employee, kind: day ? 'temporary' : kind, to: day ? 'DAY' : to!, start, end: dated && !openEnded ? end : null, reason: reason.trim() }),
    kind === 'permanent' ? `${person?.name}: in ${to} Shift from ${shortDate(start)}.` : day ? `${person?.name}: day duty ${shortDate(start)} – ${until} (Sunday to Thursday).` : `${person?.name}: covering ${to} Shift ${shortDate(start)} – ${until}.`);
  const KINDS = [['temporary', 'Temporary cover'], ['permanent', 'Permanent move'], ['day', 'Day duty']] as const;
  const HELP = { temporary: 'Works with another crew for a period, then returns to their own crew.', permanent: 'Their crew changes from the first day. Earlier dates keep the old crew.',
    day: 'Leaves the crew for the period and works day shift, Sunday to Thursday (Friday and Saturday off), counted with the crew on Morning shift. Back to their own crew after the last day.' };
  return (
    <BottomSheet open onClose={onClose} title="Shift movement">
      <div className="space-y-4">
        {target.employeeId && person ? (
          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800">{person.name}{person.crew && <><span className="text-slate-400">· now</span><CrewBadge crew={person.crew} size="sm" /></>}</div>
        ) : (
          <Field label="Employee">
            <select className="input" value={employee} onChange={(e) => setEmployee(e.target.value)}>
              <option value="">Choose…</option>
              {crewPeople.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.crew})</option>)}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cx('min-h-9 rounded-lg px-1 font-medium leading-tight', kind === k ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{label}</button>
          ))}
        </div>
        <p className="-mt-2 text-xs text-slate-500">{HELP[kind]}</p>
        {!day && <Field label={kind === 'temporary' ? 'Covering' : 'New crew'}>
          <div className="grid grid-cols-4 gap-2">
            {CREWS.map((c) => (
              <button key={c} type="button" aria-pressed={to === c} disabled={person?.crew === c} onClick={() => setTo(c)}
                className={cx('flex items-center justify-center rounded-xl py-2 ring-1 disabled:opacity-30', to === c ? 'bg-slate-100 ring-2 ring-slate-800' : 'ring-slate-300')}><CrewBadge crew={c} muted={to !== c} /></button>
            ))}
          </div>
        </Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
          {dated && <Field label="Last day"><input type="date" className="input" value={end} min={start} disabled={openEnded} onChange={(e) => setEnd(e.target.value)} /></Field>}
        </div>
        {dated && <label className="-mt-2 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={openEnded} onChange={(e) => setOpenEnded(e.target.checked)} /> Until further notice</label>}
        <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={day ? 'e.g. Day duty for training or a project' : 'e.g. Covering D Shift for a Field Operator on long leave'} /></Field>
        {problem && <p className="text-xs text-slate-500">{problem}</p>}
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button><Button className="flex-1" disabled={busy || !!problem} onClick={save}>{busy ? 'Saving…' : 'Record'}</Button></div>
      </div>
    </BottomSheet>
  );
}

function ChangeSheet({ target, people, busy, err, run, onClose }: { target: Extract<MoveTarget, { kind: 'end' | 'cancel' }>; people: MovePerson[]; busy: boolean; err: unknown; run: (fn: () => Promise<unknown>, m: string) => void; onClose: () => void }) {
  const m = target.movement;
  const today = localToday();
  const [end, setEnd] = useState(today < m.start_date ? m.start_date : today);
  const [note, setNote] = useState('');
  const name = people.find((p) => p.id === m.employee_id)?.name ?? 'Employee';
  const ending = target.kind === 'end';
  const day = m.to_crew === 'DAY';
  const what = day ? 'day duty' : 'cover';
  const problem = ending ? (!isValidIsoDate(end) || end < m.start_date ? `Choose ${shortDate(m.start_date)} or later.` : m.end_date && end >= m.end_date ? `Choose a day before ${shortDate(m.end_date)}.` : null) : !note.trim() ? 'Give the reason.' : null;
  return (
    <BottomSheet open onClose={onClose} title={`${ending ? 'End' : 'Cancel'} the ${what}`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{name} · {day ? 'day duty' : `covering ${m.to_crew} Shift`} · {range(m)}</p>
        {ending && <Field label={day ? 'Last day of day duty' : 'Last day with the other crew'}><input type="date" className="input" value={end} min={m.start_date} onChange={(e) => setEnd(e.target.value)} /></Field>}
        <Field label={ending ? 'Note (optional)' : 'Reason'} hint={ending ? undefined : `The ${what} is kept in the history as cancelled.`}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {problem && <p className="text-xs text-slate-500">{problem}</p>}
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Back</Button>
          {ending ? <Button className="flex-1" disabled={busy || !!problem} onClick={() => run(() => endMovement(m.id, end, note.trim()), `${name}: back to their own crew after ${shortDate(end)}.`)}>Save</Button>
            : <Button variant="danger" className="flex-1" disabled={busy || !!problem} onClick={() => run(() => cancelMovement(m.id, note.trim()), `${day ? 'Day duty' : 'Cover'} cancelled. It stays in the history.`)}>Cancel {what}</Button>}
        </div>
      </div>
    </BottomSheet>
  );
}
