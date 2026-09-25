import { useState } from 'react';
import { firstDayBack } from '@/core/leave';
import { isValidIsoDate, type Crew } from '@/core/roster';
import { cancelLeave, saveLeave } from '@/data/leave';
import type { AbsenceType, LeaveRecord } from '@/data/types';
import { BottomSheet, Button, ErrorBox, Field } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';

export interface SheetPerson { id: string; name: string; crew: Crew | null }
export type LeaveTarget = { kind: 'add'; employeeId?: string; start?: string } | { kind: 'edit'; record: LeaveRecord };

export const SOURCE_LABEL: Record<LeaveRecord['source_kind'], string> = { pv_schedule: 'PV plan', monthly_grid: 'Monthly sheet', manual: 'Entered by hand' };
const range = (s: string, e: string) => (s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}${e.slice(0, 4) !== s.slice(0, 4) ? ` ${e.slice(0, 4)}` : ''}`);

/**
 * Add leave by hand, or correct / cancel one current record. The database keeps every change in the history
 * and a later workbook import never overrides it.
 */
export function LeaveSheet({ target, people, types, onClose, onDone }: { target: LeaveTarget; people: SheetPerson[]; types: AbsenceType[]; onClose: () => void; onDone: (message: string) => void }) {
  const rec = target.kind === 'edit' ? target.record : null;
  const [employee, setEmployee] = useState(rec?.employee_id ?? (target.kind === 'add' ? target.employeeId ?? '' : ''));
  const [type, setType] = useState(rec?.absence_type_code ?? '');
  const [start, setStart] = useState(rec?.start_date ?? (target.kind === 'add' ? target.start ?? localToday() : localToday()));
  const [end, setEnd] = useState(rec?.end_date ?? (target.kind === 'add' ? target.start ?? localToday() : localToday()));
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'edit' | 'cancel'>('edit');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);

  const person = people.find((p) => p.id === employee) ?? null;
  const active = types.filter((t) => t.is_active || t.code === rec?.absence_type_code);
  const typeOf = (code: string | null) => types.find((t) => t.code === code);
  const unchanged = rec && rec.absence_type_code === type && rec.start_date === start && rec.end_date === end;
  const problem = !employee ? 'Choose the employee.' : !type ? 'Choose the leave type.' : !isValidIsoDate(start) || !isValidIsoDate(end) ? 'Enter both dates.'
    : end < start ? 'The last day is before the first day.' : unchanged ? 'Change the type or the dates.' : rec && !note.trim() ? 'Give the reason for the correction.' : null;
  const back = isValidIsoDate(start) && isValidIsoDate(end) && end >= start ? firstDayBack(end, person?.crew ?? null, (d) => d >= start && d <= end) : null;
  const days = back ? Math.round((Date.parse(end) - Date.parse(start)) / 864e5) + 1 : 0;

  async function save() {
    setBusy(true); setErr(null);
    try {
      await saveLeave({ record: rec?.id ?? null, employee: rec ? null : employee, type, start, end, note: note.trim() });
      const code = typeOf(type)?.short_code ?? '';
      onDone(`${person?.name ?? 'Leave'}: ${code} ${range(start, end)} ${rec ? 'corrected' : 'added'}. Imports will not change it.`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!rec) return;
    setBusy(true); setErr(null);
    try { await cancelLeave(rec.id, note.trim()); onDone(`${person?.name ?? 'Leave'}: ${range(rec.start_date, rec.end_date)} cancelled. It stays in the history.`); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }

  if (rec && mode === 'cancel') {
    return (
      <BottomSheet open onClose={onClose} title="Cancel this leave">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">{person?.name} · {typeOf(rec.absence_type_code)?.short_code ?? '—'} {range(rec.start_date, rec.end_date)}</p>
          <p className="text-xs text-slate-500">Removed from the plan · kept in history · imports won't bring it back.</p>
          <Field label="Reason"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Did not travel; worked normally" /></Field>
          {err != null && <ErrorBox error={err} />}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => { setMode('edit'); setErr(null); }}>Back</Button>
            <Button variant="danger" className="flex-1" disabled={busy || !note.trim()} onClick={cancel}>{busy ? 'Saving…' : 'Cancel leave'}</Button>
          </div>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet open onClose={onClose} title={rec ? 'Correct leave' : 'Add leave'}>
      <div className="space-y-4">
        {rec ? (
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-1.5 font-medium text-slate-800">{person?.name}{person?.crew && <CrewBadge crew={person.crew} size="sm" />}</div>
            <div className="text-xs text-slate-500">Now: {typeOf(rec.absence_type_code)?.short_code ?? '—'} {range(rec.start_date, rec.end_date)} · {SOURCE_LABEL[rec.source_kind]}</div>
          </div>
        ) : target.kind === 'add' && target.employeeId ? (
          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800">{person?.name}{person?.crew && <CrewBadge crew={person.crew} size="sm" />}</div>
        ) : (
          <Field label="Employee">
            <select className="input" value={employee} onChange={(e) => setEmployee(e.target.value)}>
              <option value="">Choose…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.crew ? ` (${p.crew})` : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label="Type">
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Choose…</option>
            {active.map((t) => <option key={t.code} value={t.code}>{t.short_code} · {t.label}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
          <Field label="Last day"><input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {back && <p className="-mt-2 text-xs text-slate-600">{days} day{days === 1 ? '' : 's'} · back to work <span className="font-semibold">{shortDate(back)}</span>{person?.crew ? ' (next duty day)' : ''}</p>}
        <Field label={rec ? 'Reason for the correction' : 'Note (optional)'} hint={rec && rec.source_kind !== 'manual' && (start !== rec.start_date || end !== rec.end_date) ? 'The imported record stays in the history; the corrected leave replaces it in the plan.' : undefined}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={rec ? 'e.g. Came back two days early' : 'e.g. Sick leave, certificate received'} />
        </Field>
        <p className="text-xs text-slate-500">Imports never change leave entered by hand.</p>
        {problem && <p className="text-xs text-slate-500">{problem}</p>}
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button>
          <Button className="flex-1" disabled={busy || !!problem} onClick={save}>{busy ? 'Saving…' : rec ? 'Save correction' : 'Add leave'}</Button>
        </div>
        {rec && <button type="button" onClick={() => { setMode('cancel'); setErr(null); setNote(''); }} className="w-full py-1 text-center text-sm font-medium text-status-red">Cancel this leave…</button>}
      </div>
    </BottomSheet>
  );
}

/** History line label; a 'rescheduled' row with no new dates means the leave was not taken on those dates. */
export function changeLabel(c: { change_kind: string; to_start: string | null; by_hand?: boolean }): string {
  const base = c.change_kind === 'added' ? (c.by_hand ? 'Added by hand' : 'Added to current plan')
    : c.change_kind === 'rescheduled' ? (c.to_start ? 'Moved to other dates' : 'Not taken on these dates')
    : c.change_kind === 'cancelled' ? (c.by_hand ? 'Cancelled by hand' : 'Cancelled')
    : c.change_kind === 'corrected' ? 'Corrected by hand'
    : c.change_kind === 'baseline_added' ? 'Added to original plan (later workbook)'
    : c.change_kind === 'source_data_changed' ? 'Source data changed between workbook versions' : c.change_kind;
  return base;
}
