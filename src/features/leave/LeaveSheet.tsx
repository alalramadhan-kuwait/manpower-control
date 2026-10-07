import { LEAVE_NEEDS_APPROVAL, submitApproval, submittedText } from '@/data/approvals';
import { useEffect, useState } from 'react';
import { firstDayBack } from '@/core/leave';
import { isValidIsoDate, type Crew } from '@/core/roster';
import { cancelLeave, saveLeave, setLeaveEstimated } from '@/data/leave';
import { fetchSdMembers } from '@/data/shutdown';
import type { AbsenceType, LeaveRecord } from '@/data/types';
import { BottomSheet, Button, ErrorBox, Field, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { leaveTone } from '@/ui/leaveTypes';
import { OraclePill } from '@/ui/oracle';

export interface SheetPerson { id: string; name: string; crew: Crew | null }
export type LeaveTarget = { kind: 'add'; employeeId?: string; start?: string } | { kind: 'edit'; record: LeaveRecord };

export const SOURCE_LABEL: Record<LeaveRecord['source_kind'], string> = { pv_schedule: 'PV plan', monthly_grid: 'Monthly sheet', manual: 'Entered by hand' };
/** The two groups of the type picker: sick and medical absences, and every other leave. */
type Group = 'leave' | 'sick';
const SICK_TYPES = ['sick_leave', 'long_sick', 'medical_absence'];
const GROUP_LABEL: Record<Group, string> = { leave: 'Leave', sick: 'Sick & medical' };
/** Leave that is part of the plan (PV planned and rescheduled, short leave, Hajj, long courses, other known absences) comes from the plan and its requests, not from adding leave by hand. */
const PLAN_ONLY = ['annual_leave_planned', 'annual_leave_rescheduled', 'short_leave', 'hajj_leave', 'long_course', 'other_known_absence'];
/** Leave whose dates can be an estimate until the final notice. */
const CAN_ESTIMATE = ['escort_leave'];
const groupOf = (code: string | null | undefined): Group => (code && SICK_TYPES.includes(code) ? 'sick' : 'leave');
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
  const [estimated, setEstimated] = useState(rec?.dates_estimated ?? false);
  const [mode, setMode] = useState<'edit' | 'cancel'>('edit');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);

  // a shutdown team member takes no leave during the shutdown: say so when the dates fall inside it
  const [team, setTeam] = useState<{ start: string; end: string }[]>([]);
  useEffect(() => {
    if (!employee || !isValidIsoDate(start) || !isValidIsoDate(end) || end < start) { setTeam([]); return; }
    let live = true;
    fetchSdMembers(start, end).then((ms) => { if (live) setTeam(ms.filter((m) => m.employeeId === employee).map((m) => ({ start: m.start, end: m.end }))); }).catch(() => { if (live) setTeam([]); });
    return () => { live = false; };
  }, [employee, start, end]);
  const person = people.find((p) => p.id === employee) ?? null;
  const [group, setGroup] = useState<Group>(groupOf(rec?.absence_type_code));
  // adding by hand offers only leave outside the PV plan; correcting keeps every type (the record's own too)
  const active = types.filter((t) => (t.is_active || t.code === rec?.absence_type_code) && (rec || !PLAN_ONLY.includes(t.code)));
  const inGroup = active.filter((t) => groupOf(t.code) === group);
  const typeOf = (code: string | null) => types.find((t) => t.code === code);
  const unchanged = rec && rec.absence_type_code === type && rec.start_date === start && rec.end_date === end;
  const wasEstimated = rec?.dates_estimated ?? false;
  // only the estimate flag changed (the final notice arrived with the same dates): no correction to record
  const onlyEstimate = !!unchanged && estimated !== wasEstimated;
  const canEstimate = CAN_ESTIMATE.includes(type) || wasEstimated;
  const problem = !employee ? 'Choose the employee.' : !type ? 'Choose the leave type.' : !isValidIsoDate(start) || !isValidIsoDate(end) ? 'Enter both dates.'
    : end < start ? 'The last day is before the first day.' : unchanged && !onlyEstimate ? 'Change the type or the dates.' : rec && !onlyEstimate && !note.trim() ? 'Give the reason for the correction.' : null;
  const back = isValidIsoDate(start) && isValidIsoDate(end) && end >= start ? firstDayBack(end, person?.crew ?? null, (d) => d >= start && d <= end) : null;
  const days = back ? Math.round((Date.parse(end) - Date.parse(start)) / 864e5) + 1 : 0;

  async function save() {
    setBusy(true); setErr(null);
    try {
      if (onlyEstimate) {
        await setLeaveEstimated(rec!.id, estimated);
        onDone(`${person?.name ?? 'Leave'}: ${range(start, end)} ${estimated ? 'marked as an estimate' : 'dates confirmed'}.`);
        return;
      }
      if (!rec && LEAVE_NEEDS_APPROVAL.has(type)) {
        // unplanned annual leave and sick leave added by hand wait for the Section Head (the Section Head's own apply at once)
        const msg = `${person?.name ?? 'Leave'}: ${typeOf(type)?.short_code ?? ''} ${range(start, end)} added.`;
        const r = await submitApproval({ kind: 'leave', employee, start, end, summary: `${person?.name ?? 'Leave'}: ${typeOf(type)?.label ?? type} ${range(start, end)}`, payload: { type, note: note.trim() } });
        onDone(submittedText(r, msg));
        return;
      }
      const id = await saveLeave({ record: rec?.id ?? null, employee: rec ? null : employee, type, start, end, note: note.trim() });
      const wants = CAN_ESTIMATE.includes(type) && estimated;
      if (wants !== wasEstimated) await setLeaveEstimated(id, wants);
      const code = typeOf(type)?.short_code ?? '';
      onDone(`${person?.name ?? 'Leave'}: ${code} ${range(start, end)} ${rec ? 'corrected' : 'added'}${wants ? ' (dates are an estimate)' : ''}. Imports will not change it.`);
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
            {rec.oracle_status && <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">Oracle HR <OraclePill status={rec.oracle_status} />{rec.oracle_ref ? ` #${rec.oracle_ref}` : ''}{rec.start_date > localToday() && rec.oracle_status !== 'not_submitted' && <span>· new dates → Not submitted</span>}</div>}
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
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
              {(['leave', 'sick'] as const).map((g) => (
                <button key={g} type="button" aria-pressed={group === g} onClick={() => { setGroup(g); if (groupOf(type) !== g) setType(''); }}
                  className={cx('min-h-9 rounded-lg font-medium', group === g ? (g === 'sick' ? 'bg-red-600 text-white shadow-sm' : 'bg-brand-700 text-white shadow-sm') : g === 'sick' ? 'text-red-700' : 'text-brand-700')}>{GROUP_LABEL[g]}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Leave type">
              {inGroup.map((t) => { const c = leaveTone(t.code); const on = type === t.code; return (
                <button key={t.code} type="button" role="radio" aria-checked={on} onClick={() => { setType(t.code); if (!rec) setEstimated(CAN_ESTIMATE.includes(t.code)); }}
                  className={cx('flex min-h-11 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium ring-1', on ? c.on : c.chip)}>
                  <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', on ? 'bg-white' : c.dot)} />
                  <span className="min-w-0"><span className="block text-[10px] font-bold uppercase tracking-wide opacity-80">{t.short_code}</span><span className="block leading-tight">{t.label}</span></span>
                </button>
              ); })}
            </div>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
          <Field label="Last day"><input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {back && <p className="-mt-2 text-xs text-slate-600">{days} day{days === 1 ? '' : 's'} · back to work <span className="font-semibold">{shortDate(back)}</span>{person?.crew ? ' (next duty day)' : ''}</p>}
        {team.length > 0 && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-300">
            <b>{person?.name ?? 'This person'}</b> is on a shutdown team ({range(team[0].start, team[0].end)}). A team member takes no leave during the shutdown: keep these dates only for sick or other leave that cannot wait.
          </p>
        )}
        {canEstimate && (
          <label className={cx('flex items-start gap-2 rounded-xl px-3 py-2 text-sm ring-1', estimated ? 'bg-amber-50 text-amber-900 ring-amber-300' : 'bg-slate-50 text-slate-700 ring-slate-200')}>
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={estimated} onChange={(e) => setEstimated(e.target.checked)} />
            <span><span className="block font-medium">{wasEstimated ? 'Dates still an estimate' : 'The dates are an estimate'}</span>
              <span className="block text-xs opacity-80">{estimated ? 'It counts in the manpower and stays marked until the final notice. Untick it when the dates are confirmed.' : 'Tick it while the dates are not final.'}</span></span>
          </label>
        )}
        <Field label={rec && !onlyEstimate ? 'Reason for the correction' : 'Note (optional)'} hint={rec && rec.source_kind !== 'manual' && (start !== rec.start_date || end !== rec.end_date) ? 'The imported record stays in the history; the corrected leave replaces it in the plan.' : undefined}>
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
