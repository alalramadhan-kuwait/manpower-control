import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/data/supabase';
import { fetchDirectory, fetchReference } from '@/data/queries';
import type { AbsenceType, EmployeeDirectoryRow, ImportRowRecord, LeaveRecord, UserProfile } from '@/data/types';
import { BottomSheet, Button, Card, Chip, ErrorBox, Field, PageHeader, Spinner, fmtDate } from '@/ui/components';
import { RowLine } from '@/features/imports/PlanPreview';

interface Loaded { emps: EmployeeDirectoryRow[]; unresolved: (LeaveRecord & { employees: { short_name: string | null; full_name: string; employee_number: string } })[]; pending: ImportRowRecord[]; absenceTypes: AbsenceType[] }

export default function DataQualityPage({ profile }: { profile: UserProfile }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [resolving, setResolving] = useState<Loaded['unresolved'][number] | null>(null);
  const load = useCallback(async () => {
    const [emps, u, p, ref] = await Promise.all([
      fetchDirectory(),
      supabase.from('leave_records').select('*, employees(short_name, full_name, employee_number)').eq('status', 'unresolved').order('start_date'),
      supabase.from('import_rows').select('*, import_batches!inner(status, file_name)').or('needs_review.eq.true,outcome.eq.unmatched,outcome.eq.error').eq('import_batches.status', 'committed').order('seq').limit(200),
      fetchReference()
    ]);
    if (u.error) throw u.error; if (p.error) throw p.error;
    setData({ emps, unresolved: u.data as Loaded['unresolved'], pending: p.data as ImportRowRecord[], absenceTypes: ref.absenceTypes });
  }, []);
  useEffect(() => { load().catch(setError); }, [load]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const scope = data.emps.filter((e) => e.in_unit12_scope && e.is_active);
  const tc = scope.filter((e) => e.position_category === 'field' && e.take_charge_status !== 'yes' && e.take_charge_status !== 'no');
  const inferred = scope.filter((e) => e.employment_type_source !== 'confirmed');
  const noCrew = scope.filter((e) => !e.crew_code && !['vr_controller', 'morning_controller'].includes(e.position_code ?? ''));
  const noRole = scope.filter((e) => !e.position_code);
  const contractorsNoMaster = scope.filter((e) => e.employment_type === 'contractor');
  return (
    <div>
      <PageHeader title="Data Quality Review" subtitle="Things a person must decide. Nothing here is guessed by the system." />

      <Section title={`Unresolved absences (${data.unresolved.length})`} help="Marked on a monthly manpower sheet but not in the PV plan. Classify or cancel.">
        {data.unresolved.length === 0 && <Ok />}
        <ul className="divide-y divide-slate-100">
          {data.unresolved.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0"><Link to={`/employees/${l.employee_id}`} className="font-medium text-brand-700">{l.employees.short_name ?? l.employees.full_name}</Link> <span className="text-xs text-slate-500">#{l.employees.employee_number}</span><div className="text-xs text-slate-600">{fmtDate(l.start_date)} → {fmtDate(l.end_date)} · {l.source_ref?.split(' / ').slice(1).join(' / ')}</div></div>
              <Button variant="secondary" className="min-h-9 shrink-0 px-3 text-xs" onClick={() => setResolving(l)}>Resolve</Button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Take-Charge not confirmed (${tc.length})`} help="Field Operators only count toward the minimum of 6 once Take-Charge = Yes. Open the profile to set it.">
        {tc.length === 0 && <Ok />}
        <PeopleList people={tc} extra={() => <Chip tone="amber">Not yet confirmed</Chip>} />
      </Section>

      <Section title={`Employment type inferred from the number (${inferred.length})`} help="5-digit = KNPC, 6-digit = contractor was assumed. KNPC master matches confirm KNPC automatically; contractors need a manual confirmation.">
        {inferred.length === 0 && <Ok />}
        <PeopleList people={inferred} extra={(e) => <Chip tone="amber">{e.employment_type === 'knpc' ? 'KNPC' : 'Contractor'} (inferred)</Chip>} />
      </Section>

      <Section title={`Contractors without KNPC master record (${contractorsNoMaster.length})`} help="Expected: contractors are not in the promotion master. Grade and HR dates must be entered manually if needed.">
        <PeopleList people={contractorsNoMaster} extra={() => <Chip>Contractor</Chip>} />
      </Section>

      {(noRole.length > 0 || noCrew.length > 0) && (
        <Section title={`Missing role or crew (${noRole.length + noCrew.length})`} help="Everyone in scope needs an operational role; crew-bound roles need a permanent crew.">
          <PeopleList people={[...noRole, ...noCrew.filter((e) => !noRole.includes(e))]} extra={(e) => <Chip tone="red">{!e.position_code ? 'No role' : 'No crew'}</Chip>} />
        </Section>
      )}

      <Section title={`Import rows flagged in committed batches (${data.pending.length})`} help="Unmatched, errored or review rows from imports. They stay here as the record of what the source said.">
        {data.pending.length === 0 && <Ok />}
        <ul className="divide-y divide-slate-100">
          {data.pending.map((r) => <li key={r.id} className="py-2"><RowLine row={r} /><Link to={`/imports/${r.batch_id}`} className="text-[11px] text-brand-700">Open batch</Link></li>)}
        </ul>
      </Section>

      {resolving && <ResolveSheet record={resolving} absenceTypes={data.absenceTypes} actor={profile} onClose={() => setResolving(null)} onSaved={() => { setResolving(null); load().catch(setError); }} />}
    </div>
  );
}

function Ok() { return <p className="py-2 text-sm text-status-green">Nothing outstanding.</p>; }
function Section({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return <Card className="mb-3"><h2 className="text-sm font-semibold text-brand-800">{title}</h2><p className="mb-1 text-xs text-slate-500">{help}</p>{children}</Card>;
}
function PeopleList({ people, extra }: { people: EmployeeDirectoryRow[]; extra: (e: EmployeeDirectoryRow) => React.ReactNode }) {
  if (people.length === 0) return null;
  return (
    <ul className="divide-y divide-slate-100">
      {people.map((e) => (
        <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <Link to={`/employees/${e.id}`} className="min-w-0 truncate"><span className="font-medium text-brand-700">{e.short_name ?? e.full_name}</span> <span className="text-xs text-slate-500">#{e.employee_number} · {e.position_label ?? 'no role'}{e.crew_code ? ` · ${e.crew_code}` : ''}</span></Link>
          {extra(e)}
        </li>
      ))}
    </ul>
  );
}

function ResolveSheet({ record, absenceTypes, actor, onClose, onSaved }: { record: LeaveRecord; absenceTypes: AbsenceType[]; actor: UserProfile; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  async function save(cancel: boolean) {
    setBusy(true); setError(null);
    const patch = cancel
      ? { status: 'cancelled', review_status: 'resolved', note: `${record.note ?? ''}\nCancelled by ${actor.display_name}: ${note}`.trim() }
      : { status: 'approved', absence_type_code: type, review_status: 'resolved', note: `${record.note ?? ''}\nClassified by ${actor.display_name}: ${note}`.trim() };
    const { error } = await supabase.from('leave_records').update(patch).eq('id', record.id);
    setBusy(false); if (error) setError(error); else onSaved();
  }
  return (
    <BottomSheet open onClose={onClose} title={`Absence ${fmtDate(record.start_date)} → ${fmtDate(record.end_date)}`}>
      <p className="mb-3 text-xs text-slate-500">Source: {record.source_ref}</p>
      <Field label="Absence type"><select className="input" value={type} onChange={(e) => setType(e.target.value)}><option value="">Choose…</option>{absenceTypes.filter((t) => t.is_active).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></Field>
      <Field label="Note"><input className="input mt-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why / reference" /></Field>
      {error ? <div className="mt-2"><ErrorBox error={error} /></div> : null}
      <div className="mt-4 flex gap-2"><Button variant="danger" className="flex-1" disabled={busy} onClick={() => save(true)}>Not an absence</Button><Button className="flex-1" disabled={busy || !type} onClick={() => save(false)}>Save classification</Button></div>
    </BottomSheet>
  );
}
