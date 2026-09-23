import { ArrowLeft, Pencil } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/data/supabase';
import { fetchReference } from '@/data/queries';
import { displayNameFor } from '@/core/names';
import type { AbsenceType, AuditEntry, Crew, EmployeeDirectoryRow, LeaveRecord, LeavePlanChange, Performance, Position, Qualification, QualificationCode, QualificationStatus, RoleAssignment, SickTotal, UserProfile } from '@/data/types';
import { BottomSheet, Button, Card, Chip, ErrorBox, Field, Row, Spinner, fmtDate, qualificationLabel, qualificationTone, cx } from '@/ui/components';
import { CrewBadge, CrewTag, isCrew } from '@/ui/crew';
import { OnLeaveChip, localToday } from '@/ui/leave';
import { onLeaveOn } from '@/core/leave';

const QUALS: { code: QualificationCode; label: string; help: string }[] = [
  { code: 'take_charge', label: 'Take-Charge qualified', help: 'Only Take-Charge = Yes counts toward the Field Operator minimum of 6.' },
  { code: 'panel_operator', label: 'Qualified / accepted Panel Operator', help: 'Required to count toward the Panel minimum of 3.' },
  { code: 'acting_controller', label: 'Acting Controller (Grade 14 exception)', help: 'Uncommon. Allows a Grade 14 to act as Controller; always displayed as Acting Controller.' },
  { code: 'controller', label: 'Controller', help: 'Formally a Controller (normally Grade 15+).' }
];

interface Loaded {
  emp: EmployeeDirectoryRow; quals: Qualification[]; roles: RoleAssignment[]; leaves: LeaveRecord[]; changes: LeavePlanChange[]; perf: Performance[]; sick: SickTotal[]; audit: AuditEntry[];
  positions: Position[]; crews: Crew[]; absenceTypes: AbsenceType[];
}

export default function EmployeeProfilePage({ profile }: { profile: UserProfile }) {
  const { id } = useParams();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sheet, setSheet] = useState<null | { kind: 'qual'; code: QualificationCode } | { kind: 'basics' } | { kind: 'role' }>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [e, q, r, l, c, p, s, a, ref] = await Promise.all([
      supabase.from('employee_directory_v').select('*').eq('id', id).single(),
      supabase.from('employee_qualifications').select('*').eq('employee_id', id).order('effective_from', { ascending: false }),
      supabase.from('employee_role_assignments').select('*, positions(code,label), crews(code)').eq('employee_id', id).order('effective_from', { ascending: false }),
      supabase.from('leave_records').select('*').eq('employee_id', id).order('start_date'),
      supabase.from('leave_plan_changes').select('*').eq('employee_id', id).order('created_at', { ascending: false }),
      supabase.from('employee_performance').select('*').eq('employee_id', id).order('year', { ascending: false }),
      supabase.from('sick_leave_totals').select('*').eq('employee_id', id).order('year', { ascending: false }),
      supabase.from('audit_log').select('*').eq('related_employee_id', id).order('occurred_at', { ascending: false }).limit(20),
      fetchReference()
    ]);
    const err = [e, q, r, l, c, p, s, a].find((x) => x.error)?.error; if (err) throw err;
    setData({ emp: e.data as EmployeeDirectoryRow, quals: q.data as Qualification[], roles: r.data as RoleAssignment[], leaves: l.data as LeaveRecord[], changes: c.data as LeavePlanChange[], perf: p.data as Performance[], sick: s.data as SickTotal[], audit: a.data as AuditEntry[], ...ref });
  }, [id]);
  useEffect(() => { load().catch(setError); }, [load]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const { emp } = data;
  const currentLeaves = data.leaves.filter((l) => l.in_current_plan && l.status !== 'cancelled' && l.status !== 'rescheduled');
  const originalLeaves = data.leaves.filter((l) => l.in_original_plan);
  const leaveNow = onLeaveOn(localToday(), data.leaves.map((l) => ({ employeeId: l.employee_id, start: l.start_date, end: l.end_date, status: l.status, inCurrentPlan: l.in_current_plan, typeLabel: data.absenceTypes.find((t) => t.code === l.absence_type_code)?.label ?? null, typeShort: data.absenceTypes.find((t) => t.code === l.absence_type_code)?.short_code ?? null })), () => (isCrew(emp.crew_code) ? emp.crew_code : null)).get(emp.id);
  const currentQual = (c: QualificationCode) => data.quals.find((q) => q.qualification === c && !q.effective_to);

  return (
    <div>
      <Link to="/employees" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-700"><ArrowLeft className="h-4 w-4" /> Employees</Link>
      <Card className="mb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-brand-800">{emp.display_name}</h1>
            {emp.official_name !== emp.display_name && <div className="text-sm text-slate-600">{emp.official_name}</div>}
            <div className="mt-1 text-sm text-slate-500">Employee No. <span className="font-mono font-medium text-slate-700">{emp.employee_number}</span></div>
          </div>
          <Button variant="ghost" className="min-h-9 px-2" onClick={() => setSheet({ kind: 'basics' })} aria-label="Edit basics"><Pencil className="h-4 w-4" /></Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip tone="blue">{emp.position_label ?? 'No role assigned'}</Chip>
          {leaveNow && <OnLeaveChip leave={leaveNow} />}
          {isCrew(emp.crew_code) && <span className="inline-flex items-center rounded-full bg-white py-0.5 pl-0.5 pr-2.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-200"><CrewTag crew={emp.crew_code} /></span>}
          <Chip tone={emp.employment_type_source === 'confirmed' ? 'neutral' : 'amber'}>{emp.employment_type === 'knpc' ? 'KNPC' : 'Contractor'}{emp.employment_type_source === 'inferred' ? ' (inferred)' : ''}</Chip>
          {emp.grade && <Chip>Grade {emp.grade}</Chip>}
          {!emp.is_active && <Chip tone="red">Inactive</Chip>}
        </div>
      </Card>

      <Section title="Qualifications" action={<span className="text-xs text-slate-500">Tap to edit</span>}>
        {QUALS.filter((q) => q.code !== 'acting_controller' || emp.position_category === 'panel' || emp.position_category === 'controller' || currentQual('acting_controller')).map((q) => {
          const cur = currentQual(q.code);
          return (
            <button key={q.code} type="button" onClick={() => setSheet({ kind: 'qual', code: q.code })} className="flex w-full items-center justify-between gap-3 py-2.5 text-left">
              <span><span className="block text-sm font-medium text-slate-800">{q.label}</span><span className="block text-xs text-slate-500">{cur ? `${cur.source === 'manual' ? 'Set manually' : 'Imported evidence'} · ${fmtDate(cur.effective_from)}${cur.evidence ? ` · ${cur.evidence}` : ''}` : 'Not recorded'}</span></span>
              <Chip tone={qualificationTone(cur?.status)}>{qualificationLabel(cur?.status)}</Chip>
            </button>
          );
        })}
      </Section>

      <Section title="Operations" action={<Button variant="ghost" className="min-h-9 px-2 text-xs" onClick={() => setSheet({ kind: 'role' })}>Correct role / crew</Button>}>
        <Row label="Operational role" value={emp.position_label} />
        <Row label="Permanent crew" value={isCrew(emp.crew_code) ? <CrewTag crew={emp.crew_code} /> : (emp.position_code === 'vr_controller' || emp.position_code === 'morning_controller' ? 'Not crew-bound' : null)} />
        <Row label="Since" value={fmtDate(emp.role_effective_from)} />
        <Row label="Section" value={emp.section_name} />
      </Section>

      <Section title="KNPC master data">
        {emp.employment_type === 'contractor' && <p className="mb-2 text-xs text-slate-500">Contractors are not in the KNPC promotion master. Grade and HR dates are not available from the source files.</p>}
        <Row label="Grade" value={emp.grade} />
        <Row label="Master position" value={emp.master_position} />
        <Row label="Cost center" value={emp.cost_center} />
        <Row label="Join date" value={fmtDate(emp.join_date)} />
        <Row label="Last promotion" value={fmtDate(emp.last_promotion_date)} />
        <Row label="Position start" value={fmtDate(emp.position_start_date)} />
        <Row label="Service years" value={emp.service_years} />
        <Row label="Years in grade" value={emp.years_in_grade} />
        <Row label="Education" value={emp.education} />
      </Section>

      <Section title="Performance and sick leave (as reported)">
        {data.perf.length === 0 && data.sick.length === 0 && <p className="text-sm text-slate-500">Nothing imported yet.</p>}
        {data.perf.map((p) => <Row key={p.id} label={`Performance ${p.year}`} value={<>{p.perf_level ?? '—'}{p.increment_pct != null ? ` · increment ${p.increment_pct}%` : ''}{p.warnings ? ' · warning on file' : ''}</>} />)}
        {data.sick.map((s) => <Row key={s.id} label={`Sick leave ${s.year}`} value={`${s.days} days (as of ${fmtDate(s.reported_as_of)})`} />)}
      </Section>

      <Section title={`Current plan and absences ${currentLeaves.length ? `(${currentLeaves.length})` : ''}`}>
        <p className="mb-1 text-xs text-slate-500">What reduces manpower now: the current approved plan (PV Scheduled Updated) plus operational absences.</p>
        {currentLeaves.length === 0 && <p className="text-sm text-slate-500">No current leave records.</p>}
        <ul className="divide-y divide-slate-100">{currentLeaves.map((l) => <LeaveLine key={l.id} l={l} types={data.absenceTypes} />)}</ul>
      </Section>

      <Section title={`Original plan ${originalLeaves.length ? `(${originalLeaves.length})` : ''}`}>
        <p className="mb-1 text-xs text-slate-500">The annual plan as first approved (PV Scheduled). Historical; a block shown as rescheduled or cancelled no longer reduces manpower.</p>
        {originalLeaves.length === 0 && <p className="text-sm text-slate-500">No original plan records.</p>}
        <ul className="divide-y divide-slate-100">{originalLeaves.map((l) => <LeaveLine key={l.id} l={l} types={data.absenceTypes} />)}</ul>
      </Section>

      <Section title={`Leave change history ${data.changes.length ? `(${data.changes.length})` : ''}`}>
        {data.changes.length === 0 && <p className="text-sm text-slate-500">No changes recorded.</p>}
        <ul className="divide-y divide-slate-100 text-sm">
          {data.changes.map((c) => (
            <li key={c.id} className="py-2">
              <div className="flex items-center justify-between gap-2"><span className="font-medium text-slate-800">{CHANGE_LABEL[c.change_kind]}</span><span className="text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString('en-GB')}</span></div>
              <div className="text-xs text-slate-600">
                {c.from_start ? `${fmtDate(c.from_start)} → ${fmtDate(c.from_end)}` : ''}{c.from_start && c.to_start ? '  ⇒  ' : ''}{c.to_start ? `${fmtDate(c.to_start)} → ${fmtDate(c.to_end)}` : ''}
              </div>
              {c.note ? <div className="text-xs text-slate-500">{c.note}</div> : null}
              {c.evidence ? <div className="text-xs text-slate-400">Evidence: {c.evidence}</div> : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Role history">
        <ul className="divide-y divide-slate-100 text-sm">
          {data.roles.map((r) => <li key={r.id} className="flex justify-between py-2"><span className="inline-flex flex-wrap items-center gap-1.5">{r.positions?.label ?? r.position_id}{isCrew(r.crews?.code) && <><span className="text-slate-400">·</span><CrewTag crew={r.crews?.code} /></>}</span><span className="text-slate-500">{fmtDate(r.effective_from)} → {r.effective_to ? fmtDate(r.effective_to) : 'current'}</span></li>)}
        </ul>
      </Section>

      <Section title="Recent changes (audit)">
        {data.audit.length === 0 && <p className="text-sm text-slate-500">No changes recorded.</p>}
        <ul className="divide-y divide-slate-100 text-xs">
          {data.audit.map((a) => <li key={a.id} className="flex justify-between gap-3 py-2"><span className="text-slate-700">{a.action} · {a.entity_table.replace(/_/g, ' ')}</span><span className="shrink-0 text-slate-500">{new Date(a.occurred_at).toLocaleString('en-GB')}</span></li>)}
        </ul>
      </Section>

      {sheet?.kind === 'qual' && <QualificationSheet emp={emp} code={sheet.code} current={currentQual(sheet.code)} actor={profile} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load().catch(setError); }} />}
      {sheet?.kind === 'basics' && <BasicsSheet emp={emp} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load().catch(setError); }} />}
      {sheet?.kind === 'role' && <RoleSheet emp={emp} positions={data.positions} crews={data.crews} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load().catch(setError); }} />}
    </div>
  );
}

const CHANGE_LABEL: Record<LeavePlanChange['change_kind'], string> = {
  added: 'Added to current plan', rescheduled: 'Rescheduled', cancelled: 'Cancelled', source_data_changed: 'Source data changed between workbook versions', baseline_added: 'Added to original plan (later workbook)'
};

function LeaveLine({ l, types }: { l: LeaveRecord; types: AbsenceType[] }) {
  const tone = l.status === 'unresolved' ? 'amber' : l.status === 'cancelled' || l.status === 'rescheduled' ? 'neutral' : 'green';
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <div>
        <div className="font-medium text-slate-800">{fmtDate(l.start_date)} → {fmtDate(l.end_date)}</div>
        <div className="text-xs text-slate-500">{types.find((t) => t.code === l.absence_type_code)?.label ?? 'Type not yet classified'} · {l.source_kind.replace('_', ' ')}{l.source_ref ? ` · ${l.source_ref.split(' / ').slice(1).join(' / ')}` : ''}{l.in_original_plan && l.in_current_plan ? ' · original and current plan' : ''}</div>
      </div>
      <Chip tone={tone}>{l.status}</Chip>
    </li>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="mb-3">
      <div className="mb-1 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>{action}</div>
      {children}
    </Card>
  );
}

function QualificationSheet({ emp, code, current, actor, onClose, onSaved }: { emp: EmployeeDirectoryRow; code: QualificationCode; current?: Qualification; actor: UserProfile; onClose: () => void; onSaved: () => void }) {
  const meta = QUALS.find((q) => q.code === code)!;
  const [status, setStatus] = useState<QualificationStatus>(current?.status ?? 'not_yet_confirmed');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  async function save() {
    setBusy(true); setError(null);
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (current) {
        if (current.effective_from >= today) { const { error } = await supabase.from('employee_qualifications').delete().eq('id', current.id); if (error) throw error; }
        else { const { error } = await supabase.from('employee_qualifications').update({ effective_to: today }).eq('id', current.id); if (error) throw error; }
      }
      const { error } = await supabase.from('employee_qualifications').insert({ employee_id: emp.id, qualification: code, status, effective_from: today, source: 'manual', evidence: note.trim() || `Set by ${actor.display_name}`, created_by: actor.auth_user_id });
      if (error) throw error;
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title={meta.label}>
      <p className="mb-3 text-sm text-slate-600">{meta.help}</p>
      <div className="space-y-2">
        {(['yes', 'no', 'not_yet_confirmed'] as QualificationStatus[]).map((s) => (
          <label key={s} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 ring-1 ${status === s ? 'bg-brand-50 ring-brand-600' : 'ring-slate-200'}`}>
            <input type="radio" name="status" checked={status === s} onChange={() => setStatus(s)} />
            <span className="text-sm font-medium">{qualificationLabel(s)}</span>
          </label>
        ))}
      </div>
      <Field label="Note / evidence (optional)"><input className="input mt-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed by Section Head on 23 Sep 2026" /></Field>
      {error ? <div className="mt-2"><ErrorBox error={error} /></div> : null}
      <div className="mt-4 flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button><Button className="flex-1" disabled={busy} onClick={save}>Save</Button></div>
    </BottomSheet>
  );
}

function BasicsSheet({ emp, onClose, onSaved }: { emp: EmployeeDirectoryRow; onClose: () => void; onSaved: () => void }) {
  const [shortName, setShortName] = useState(emp.short_name ?? '');
  const [fullName, setFullName] = useState(emp.official_name);
  const [displayName, setDisplayName] = useState(emp.display_name);
  const [type, setType] = useState(emp.employment_type);
  const [confirmed, setConfirmed] = useState(emp.employment_type_source === 'confirmed');
  const [active, setActive] = useState(emp.is_active);
  const [notes, setNotes] = useState(emp.notes ?? '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  async function save() {
    setBusy(true); setError(null);
    const { error } = await supabase.from('employees').update({ short_name: shortName.trim() || null, official_name: fullName.trim(), display_name: displayName.trim() || displayNameFor({ officialName: fullName, shortName, employmentType: type, employmentTypeSource: confirmed ? 'confirmed' : 'inferred' }) || fullName.trim(), employment_type: type, employment_type_source: confirmed ? 'confirmed' : 'inferred', is_active: active, notes: notes.trim() || null }).eq('id', emp.id);
    setBusy(false); if (error) setError(error); else onSaved();
  }
  return (
    <BottomSheet open onClose={onClose} title="Edit employee">
      <div className="space-y-3">
        <Field label="Official name" hint="Full name as in the KNPC Promotion Master. Never shortened."><input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <Field label="Display name" hint="Shown on screens. Leave empty to derive it (first and last name for confirmed KNPC staff, workbook name otherwise)."><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <Field label="Workbook name" hint="Name as written on the U-12 manpower sheets."><input className="input" value={shortName} onChange={(e) => setShortName(e.target.value)} /></Field>
        <Field label="Employment classification" hint="Classification only. It never decides manpower eligibility by itself.">
          <div className="flex gap-2">{(['knpc', 'contractor'] as const).map((t) => <button key={t} type="button" onClick={() => { setType(t); setConfirmed(true); }} className={`flex-1 rounded-xl py-2.5 text-sm font-medium ring-1 ${type === t ? 'bg-brand-700 text-white ring-brand-700' : 'ring-slate-300'}`}>{t === 'knpc' ? 'KNPC' : 'Contractor'}</button>)}</div>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Classification confirmed (not just inferred from the number)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active in Unit-12 manpower</label>
        <Field label="Notes"><textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error ? <div className="mt-2"><ErrorBox error={error} /></div> : null}
      <div className="mt-4 flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button><Button className="flex-1" disabled={busy} onClick={save}>Save</Button></div>
    </BottomSheet>
  );
}

function RoleSheet({ emp, positions, crews, onClose, onSaved }: { emp: EmployeeDirectoryRow; positions: Position[]; crews: Crew[]; onClose: () => void; onSaved: () => void }) {
  const [positionCode, setPositionCode] = useState(emp.position_code ?? 'field_operator');
  const [crewCode, setCrewCode] = useState<string>(emp.crew_code ?? '');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const crewBound = !['vr_controller', 'morning_controller', 'section_head', 'operating_engineer'].includes(positionCode);
  async function save() {
    setBusy(true); setError(null);
    try {
      const pos = positions.find((p) => p.code === positionCode)!;
      const crew = crewBound && crewCode ? crews.find((c) => c.code === crewCode) : null;
      if (emp.role_assignment_id) {
        if (emp.role_effective_from && emp.role_effective_from >= from) { const { error } = await supabase.from('employee_role_assignments').delete().eq('id', emp.role_assignment_id); if (error) throw error; }
        else { const prev = new Date(from + 'T00:00:00Z'); prev.setUTCDate(prev.getUTCDate() - 1); const { error } = await supabase.from('employee_role_assignments').update({ effective_to: prev.toISOString().slice(0, 10) }).eq('id', emp.role_assignment_id); if (error) throw error; }
      }
      const { error } = await supabase.from('employee_role_assignments').insert({ employee_id: emp.id, position_id: pos.id, home_crew_id: crew?.id ?? null, effective_from: from, source: 'manual', note: 'Data correction from the employee profile (not a shift-change request)' });
      if (error) throw error;
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="Correct role / crew">
      <p className="mb-3 text-xs text-slate-500">Use this to fix imported data. Planned temporary and permanent shift changes go through the movement workflow in Stage G.</p>
      <div className="space-y-3">
        <Field label="Operational role">
          <select className="input" value={positionCode} onChange={(e) => setPositionCode(e.target.value)}>{positions.map((p) => <option key={p.id} value={p.code}>{p.label}</option>)}</select>
        </Field>
        {crewBound && <Field label="Permanent crew"><div className="grid grid-cols-4 gap-2">{crews.map((c) => <button key={c.id} type="button" onClick={() => setCrewCode(c.code)} className={cx('flex items-center justify-center rounded-xl py-2 ring-1', crewCode === c.code ? 'bg-slate-100 ring-2 ring-slate-800' : 'ring-slate-300')} aria-pressed={crewCode === c.code}>{isCrew(c.code) ? <CrewBadge crew={c.code} muted={crewCode !== c.code} /> : c.code}</button>)}</div></Field>}
        <Field label="Effective from"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      </div>
      {error ? <div className="mt-2"><ErrorBox error={error} /></div> : null}
      <div className="mt-4 flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button><Button className="flex-1" disabled={busy || (crewBound && !crewCode)} onClick={save}>Save</Button></div>
    </BottomSheet>
  );
}
