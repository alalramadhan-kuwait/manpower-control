import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { minimumsText, minimumsWithDown, sectionsName, type UnitSection } from '@/core/modes';
import { isValidIsoDate } from '@/core/roster';
import { EVENT_CATEGORY_LABEL, TAKES_UNITS_DOWN, cancelEvent, deleteHoliday, saveEvent, saveHoliday, type EventCategory, type Holiday, type UnitEvent } from '@/data/calendar';
import { BottomSheet, Button, ErrorBox, Field, cx } from '@/ui/components';
import { localToday } from '@/ui/leave';

function useRun(onDone: () => void) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return { busy, err, run };
}

/**
 * Add or edit a unit event (shutdown, startup, maintenance, catalyst, outage, ...); an existing one can be cancelled.
 * A shutdown / outage names the unit sections it takes down: the crews' minimums on its dates follow.
 */
export function EventSheet({ event, date, units, sections = [], onClose, onDone }: { event: UnitEvent | null; date?: string; units: string[]; sections?: UnitSection[]; onClose: () => void; onDone: () => void }) {
  const { busy, err, run } = useRun(onDone);
  const [category, setCategory] = useState<EventCategory>(event?.category ?? 'shutdown');
  const [title, setTitle] = useState(event?.title ?? '');
  const [unit, setUnit] = useState(event?.unit ?? '');
  const [down, setDown] = useState<string[]>(event?.unitCodes ?? []);
  const takesDown = TAKES_UNITS_DOWN.includes(category) && sections.length > 0;
  const toggle = (code: string) => { const next = down.includes(code) ? down.filter((c) => c !== code) : [...down, code]; setDown(next); setUnit(sectionsName(next, sections)); };
  const mins = minimumsWithDown(down, sections);
  const [start, setStart] = useState(event?.start ?? date ?? localToday());
  const [end, setEnd] = useState(event?.end ?? date ?? localToday());
  const [note, setNote] = useState(event?.note ?? '');
  const [cancelling, setCancelling] = useState(false); const [reason, setReason] = useState('');
  const problem = title.trim().length < 2 ? 'Give a short title, e.g. "SD" or "Catalyst change".' : !isValidIsoDate(start) ? 'Enter the first day.' : !isValidIsoDate(end) || end < start ? 'The last day must be on or after the first day.' : null;
  return (
    <BottomSheet open onClose={onClose} title={event ? 'Unit event' : 'New unit event'}>
      <div className="space-y-4">
        {event && TAKES_UNITS_DOWN.includes(event.category) && <Link to={`/sd/${event.id}`} className="flex items-center justify-between rounded-xl bg-slate-800 px-3 py-2.5 text-sm font-medium text-white">Shutdown page · steps, team, file<ChevronRight className="h-4 w-4" /></Link>}
        <Field label="Type"><select className="input" value={category} onChange={(e) => setCategory(e.target.value as EventCategory)}>{(Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[]).map((k) => <option key={k} value={k}>{EVENT_CATEGORY_LABEL[k]}</option>)}</select></Field>
        {takesDown && (
          <Field label="Sections down">
            <div className="flex flex-wrap gap-1.5">
              {sections.map((u) => (
                <button key={u.code} type="button" aria-pressed={down.includes(u.code)} onClick={() => toggle(u.code)}
                  className={cx('min-h-9 rounded-full px-3 text-sm font-medium ring-1', down.includes(u.code) ? 'bg-status-red text-white ring-status-red' : 'bg-white text-slate-700 ring-slate-300')}>{u.label}</button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-600">{down.length ? `Minimum per crew on these dates: ${minimumsText(mins)}${mins.controllerMin === 0 ? ' (unit down)' : ''}` : 'No section down: the minimums stay as normal.'}</p>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit / train"><input className="input" list="units" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. Train-1" /><datalist id="units">{units.map((u) => <option key={u} value={u} />)}</datalist></Field>
          <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. SD" /></Field>
        </div>
        <p className="-mt-2 text-xs text-slate-500">"{unit.trim() ? `${unit.trim()} ` : ''}{title.trim() || 'Title'}"</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
          <Field label="Last day"><input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {problem && <p className="text-xs text-slate-500">{problem}</p>}
        {err != null && <ErrorBox error={err} />}
        {cancelling ? (
          <div className="space-y-2 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
            <Field label="Reason for cancelling"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setCancelling(false)}>Back</Button><Button variant="danger" className="flex-1" disabled={busy || !reason.trim()} onClick={() => run(() => cancelEvent(event!.id, reason.trim()))}>Cancel event</Button></div>
          </div>
        ) : (
          <div className="flex gap-2">
            {event && <Button variant="secondary" onClick={() => setCancelling(true)}>Cancel event</Button>}
            <Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button>
            <Button className="flex-1" disabled={busy || !!problem} onClick={() => run(() => saveEvent({ id: event?.id, category, title, unit: unit || null, unitCodes: takesDown ? down : [], start, end, note: note.trim() || null }))}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

/** Add, correct or remove a Kuwait public holiday (e.g. when the official Eid dates are announced). */
export function HolidaySheet({ holiday, date, onClose, onDone }: { holiday: Holiday | null; date?: string; onClose: () => void; onDone: () => void }) {
  const { busy, err, run } = useRun(onDone);
  const [name, setName] = useState(holiday?.name ?? '');
  const [start, setStart] = useState(holiday?.start ?? date ?? localToday());
  const [end, setEnd] = useState(holiday?.end ?? date ?? localToday());
  const [expected, setExpected] = useState(holiday?.expected ?? false);
  const [note, setNote] = useState(holiday?.note ?? '');
  const problem = name.trim().length < 2 ? 'Enter the holiday name.' : !isValidIsoDate(start) ? 'Enter the first day.' : !isValidIsoDate(end) || end < start ? 'The last day must be on or after the first day.' : null;
  return (
    <BottomSheet open onClose={onClose} title={holiday ? 'Public holiday' : 'New public holiday'}>
      <div className="space-y-4">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Eid al-Fitr" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
          <Field label="Last day"><input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={expected} onChange={(e) => setExpected(e.target.checked)} /> Expected, not yet officially announced</label>
        <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {problem && <p className="text-xs text-slate-500">{problem}</p>}
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          {holiday && <Button variant="danger" disabled={busy} onClick={() => run(() => deleteHoliday(holiday.id))}>Remove</Button>}
          <Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button>
          <Button className="flex-1" disabled={busy || !!problem} onClick={() => run(() => saveHoliday({ id: holiday?.id, name, start, end, expected, note: note.trim() || null }))}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </BottomSheet>
  );
}
