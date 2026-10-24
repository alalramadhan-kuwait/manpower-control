import { lapsedLeave } from '@/core/oracle';
import { ArrowLeft, ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { supabase } from '@/data/supabase';
import { fetchReference } from '@/data/queries';
import { displayNameFor } from '@/core/names';
import { PersonHistory } from '@/features/shutdown/PersonHistory';
import type { AbsenceType, AuditEntry, Crew, EmployeeDirectoryRow, LeaveRecord, LeavePlanChange, Performance, Position, Qualification, QualificationCode, QualificationStatus, RoleAssignment, SickTotal, UserProfile } from '@/data/types';
import { BottomSheet, Button, Card, Chip, ErrorBox, Field, Row, Spinner, fmtDate, qualificationLabel, qualificationTone, cx } from '@/ui/components';
import { CrewBadge, CrewTag, isCrew, DayDutyBadge } from '@/ui/crew';
import { OnLeaveChip, localToday, shortDate } from '@/ui/leave';
import { isOpenEnd, splitLeave, type LeaveBlock, type LeaveSpan } from '@/core/leave';
import { changeLabel } from '@/features/leave/LeaveSheet';
import { Notes } from './Notes';
import { FoLevelPicker } from './FoLevelPicker';
import { PersonStats } from './PersonStats';
import { t } from '@/i18n';
import { withOpenEnd } from '@/data/openEnd';
import { SHIFT_LABEL, dutyFor, stateOf } from '@/core/roster';
import { MovementSheet, type MoveTarget } from '@/features/movements/MovementSheet';
import { fetchMovements, type CrewMovement } from '@/data/movements';
import { fetchAuditLookups } from '@/data/audit';
import { describe, type AuditLookups, type AuditRow } from '@/core/audit';
import { Entry as AuditLine } from '@/features/audit/AuditPage';
import { EstimatedTag } from '@/ui/LeaveCodes';
import { leaveChains } from '@/core/leave/versions';
import { VersionList } from '@/features/leave/LeaveVersions';

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

/** The person: compact on top (who, crew, leave now, notes), everything else on demand. Read only, except notes; with
 *  `edit` (Data quality → Employee records) the master data, role and qualifications are corrected here. */
export default function EmployeeProfilePage({ profile, editId }: { profile: UserProfile; editId?: string }) {
  const params = useParams();
  const id = editId ?? params.id;
  const edit = !!editId;
  const isHead = profile.role_code === 'section_head';
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sheet, setSheet] = useState<null | { kind: 'qual'; code: QualificationCode } | { kind: 'basics' } | { kind: 'role' }>(null);
  const [moveSheet, setMoveSheet] = useState<MoveTarget | null>(null);
  const [moves, setMoves] = useState<CrewMovement[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  // opened from another page (a shutdown plan): the back link returns there
  const from = useLocation().state as { back?: string; backLabel?: string } | null;
  const [auditLk, setAuditLk] = useState<AuditLookups | null>(null);
  useEffect(() => { fetchAuditLookups().then(setAuditLk).catch(() => setAuditLk(null)); }, []);

  const load = useCallback(async () => {
    if (!id) return;
    const [e, q, r, l, c, p, s, a, ref] = await Promise.all([
      supabase.from('employee_directory_v').select('*').eq('id', id).single(),
      supabase.from('employee_qualifications').select('*').eq('employee_id', id).order('effective_from', { ascending: false }),
      supabase.from('employee_role_assignments').select('*, positions(code,label), crews(code)').eq('employee_id', id).order('effective_from', { ascending: false }),
      supabase.from('leave_records').select('*,approval_state').eq('employee_id', id).order('start_date'),
      supabase.from('leave_plan_changes').select('*').eq('employee_id', id).order('created_at', { ascending: false }),
      supabase.from('employee_performance').select('*').eq('employee_id', id).order('year', { ascending: false }),
      supabase.from('sick_leave_totals').select('*').eq('employee_id', id).order('year', { ascending: false }),
      supabase.from('audit_log').select('*').eq('related_employee_id', id).order('occurred_at', { ascending: false }).limit(20),
      fetchReference()
    ]);
    const err = [e, q, r, l, c, p, s, a].find((x) => x.error)?.error; if (err) throw err;
    setData({ emp: e.data as EmployeeDirectoryRow, quals: q.data as Qualification[], roles: r.data as RoleAssignment[], leaves: withOpenEnd(l.data as LeaveRecord[]) as LeaveRecord[], changes: c.data as LeavePlanChange[], perf: p.data as Performance[], sick: s.data as SickTotal[], audit: a.data as AuditEntry[], ...ref });
  }, [id]);
  useEffect(() => { load().catch(setError); }, [load]);
  useEffect(() => { if (id) fetchMovements(id).then(setMoves).catch(() => setMoves([])); }, [id, data]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const { emp } = data;
  const typeOf = (code: string | null) => data.absenceTypes.find((t) => t.code === code);
  const today = localToday();
  const leaveSplit = splitLeave(today, data.leaves.map((l) => ({ employeeId: l.employee_id, start: l.start_date, end: l.end_date, status: l.status, inCurrentPlan: l.in_current_plan && !lapsedLeave({ typeCode: l.absence_type_code, oracle: l.approval_state ?? l.oracle_status, start: l.start_date }, today), typeLabel: typeOf(l.absence_type_code)?.label ?? null, typeShort: typeOf(l.absence_type_code)?.short_code ?? null, rec: l })), isCrew(emp.crew_code) ? emp.crew_code : null);
  const leaveNow = leaveSplit.current;
  const awaitingReview = data.leaves.filter((l) => l.status === 'unresolved' && l.in_current_plan);
  const currentRecord = data.leaves.find((l) => l.in_current_plan && !lapsedLeave({ typeCode: l.absence_type_code, oracle: l.approval_state ?? l.oracle_status, start: l.start_date }, today) && (l.status === 'approved' || l.status === 'planned') && l.start_date <= today && (l.end_date === null || today <= l.end_date)) ?? null;
  const originalLeaves = data.leaves.filter((l) => l.in_original_plan);
  const currentQual = (c: QualificationCode) => data.quals.find((q) => q.qualification === c && !q.effective_to);
  const shiftToday = isCrew(emp.crew_code) ? t(SHIFT_LABEL[stateOf(dutyFor(today, emp.crew_code))]) : null;
  const statsCount = data.sick.length;

  const entry = (card: string, extra = '') => `/requests?view=entry&card=${card}&emp=${emp.id}${extra}`;
  const open = leaveSplit.current && isOpenEnd(leaveSplit.current.until);
  return (
    <div className="lg:max-w-3xl">
      {!edit && <Link to={from?.back ?? '/employees'} className="mb-3 inline-flex min-h-10 items-center gap-1 text-sm text-brand-700"><ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {from?.backLabel ?? t('Employees')}</Link>}
      <Card className="mb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-brand-800">{emp.display_name}</h1>
            {emp.official_name !== emp.display_name && <div className="text-sm text-slate-600">{emp.official_name}</div>}
            {emp.arabic_name && <div dir="rtl" lang="ar" className="text-sm text-slate-600">{emp.arabic_name}</div>}
            <div className="mt-1 text-sm text-slate-500">{t('Employee No.')} <span className="font-mono font-medium text-slate-700">{emp.employee_number}</span></div>
          </div>
          {edit && <Button variant="ghost" className="min-h-10 px-2" onClick={() => setSheet({ kind: 'basics' })} aria-label={t('Edit basics')}><Pencil className="h-4 w-4" /></Button>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip tone="blue">{emp.position_label ?? t('No role assigned')}</Chip>
          {leaveNow && <OnLeaveChip leave={leaveNow} />}
          {isCrew(emp.crew_code) && <span className="inline-flex items-center rounded-full bg-white py-0.5 pe-2.5 ps-0.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-200"><CrewTag crew={emp.crew_code} /></span>}
          {shiftToday && <Chip>{t('Today')}: {shiftToday}</Chip>}
          <Chip tone={emp.employment_type_source === 'confirmed' ? 'neutral' : 'amber'}>{emp.employment_type === 'knpc' ? 'KNPC' : t('Contractor')}{emp.employment_type_source === 'inferred' ? ` (${t('inferred')})` : ''}</Chip>
          {emp.grade && <Chip>{t('Grade')} {emp.grade}</Chip>}
          {(emp.position_code === 'field_operator' || emp.position_code === 'panel_operator') && emp.fo_level && <Chip tone={emp.fo_level === 'below' ? 'amber' : 'blue'}>{t(({ senior: 'Senior FO', good: 'Good FO', new: 'New FO', below: 'Below-average FO' } as const)[emp.fo_level])}</Chip>}
          {emp.position_code === 'panel_operator' && (emp.can_cover_field || (emp.grade ?? 0) >= 13) && <Chip tone="blue">{t('Can cover Field')}</Chip>}
          {!emp.is_active && <Chip tone="red">{t('Inactive')}</Chip>}
        </div>
        {isHead && (emp.position_code === 'field_operator' || emp.position_code === 'panel_operator') && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium text-slate-500">{t('Field Operator level')}</div>
            <FoLevelPicker employeeId={emp.id} level={emp.fo_level ?? null} onChanged={() => { setFlash(t('Level saved.')); load(); }} />
          </div>
        )}
        {!edit && <div className="mt-3 grid grid-cols-2 gap-2">
          <Link to={entry('leave')} className="flex min-h-11 items-center justify-center rounded-xl bg-brand-700 px-3 text-sm font-medium text-white">{t('New entry for this person')}</Link>
          <Link to={entry('shift')} className="flex min-h-11 items-center justify-center rounded-xl bg-white px-3 text-sm font-medium text-brand-800 ring-1 ring-slate-300">{t('Shift change / cover')}</Link>
        </div>}
      </Card>

      {flash && <div role="status" className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">{flash}</div>}
      {leaveNow && (
        <Section title="Current leave / absence" action={<Link to={entry('leave')} className="flex min-h-9 items-center px-2 text-xs font-medium text-brand-700">{open ? t('Extend / confirm return') : t('Change')}</Link>}>
          <div className="flex items-center justify-between gap-3">
            <LeaveCode code={leaveNow.typeShort} />
            <span className="text-lg font-semibold text-slate-900">{open ? t('Return not confirmed') : `${t('Return')} ${shortDate(leaveNow.returnOn)}`}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{leaveNow.typeLabel ?? t('Leave')} · {open ? `${t('since')} ${shortDate(leaveNow.start)} · ${t('unavailable until the return is confirmed')}` : `${dateRange(leaveNow.start, leaveNow.until, today)} · ${dayCount(leaveNow.start, leaveNow.until)}`}</div>
          {currentRecord?.estimated_return && <div className="mt-1 text-xs text-slate-500">{t('Estimated return (provisional)')}: {shortDate(currentRecord.estimated_return)}</div>}
          {currentRecord?.next_review && <div className="text-xs text-slate-500">{t('Next review')}: {shortDate(currentRecord.next_review)}</div>}
        </Section>
      )}
      {!leaveNow && leaveSplit.upcoming[0] && (
        <Section title="Next leave"><div className="text-sm"><LeaveCode code={leaveSplit.upcoming[0].record.typeShort} /> {dateRange(leaveSplit.upcoming[0].start, leaveSplit.upcoming[0].end, today)} · {t('Return')} {shortDate(leaveSplit.upcoming[0].returnOn)}</div></Section>
      )}

      <Section title="Notes"><Notes employeeId={emp.id} profile={profile} limit={3} /></Section>

      <Collapsible title="Oracle statistics" count={statsCount}><PersonStats employeeId={emp.id} sick={data.sick} /></Collapsible>

      <Collapsible title="Upcoming leave" count={leaveSplit.upcoming.length}>
        {leaveSplit.upcoming.length === 0 && <p className="text-sm text-slate-500">{t('None')}</p>}
        <ul className="divide-y divide-slate-100">{leaveSplit.upcoming.map((b) => <BlockRow key={b.record.rec.id} b={b} today={today} showReturn to={b.record.rec.absence_type_code?.startsWith('annual_leave_') && b.record.rec.absence_type_code !== 'annual_leave_unscheduled' ? entry('pv', `&leave=${b.start}`) : entry('leave')} />)}</ul>
      </Collapsible>

      <Collapsible title="Past leave history" count={leaveSplit.past.length}>
        {leaveSplit.past.length === 0 && <p className="text-sm text-slate-500">{t('None')}</p>}
        <ul className="divide-y divide-slate-100">{leaveSplit.past.map((b) => <BlockRow key={b.record.rec.id} b={b} today={today} />)}</ul>
      </Collapsible>

      {awaitingReview.length > 0 && (
        <Section title={`${t('Absences awaiting review')} (${awaitingReview.length})`}>
          <ul className="divide-y divide-slate-100">{awaitingReview.map((l) => <LeaveLine key={l.id} l={l} types={data.absenceTypes} />)}</ul>
        </Section>
      )}

      <Collapsible title="Qualifications" count={data.quals.filter((q) => !q.effective_to).length} startOpen={edit}>
        {edit && <p className="mb-1 text-xs text-slate-500">{t('Tap to edit')}</p>}
        {QUALS.filter((q) => q.code !== 'acting_controller' || emp.position_category === 'panel' || emp.position_category === 'controller' || currentQual('acting_controller')).map((q) => {
          const cur = currentQual(q.code);
          return (
            <button key={q.code} type="button" disabled={!edit} onClick={() => setSheet({ kind: 'qual', code: q.code })} className="flex min-h-11 w-full items-center justify-between gap-3 py-2.5 text-start disabled:cursor-default">
              <span><span className="block text-sm font-medium text-slate-800">{t(q.label)}</span><span className="block text-xs text-slate-500">{cur ? `${cur.source === 'manual' ? t('Set manually') : t('Imported evidence')} · ${fmtDate(cur.effective_from)}${cur.evidence ? ` · ${cur.evidence}` : ''}` : t('Not recorded')}</span></span>
              <Chip tone={qualificationTone(cur?.status)}>{qualificationLabel(cur?.status)}</Chip>
            </button>
          );
        })}
      </Collapsible>

      <Collapsible title="Operations" count={1} startOpen={edit}>
        {edit && <div className="mb-1 text-end"><Button variant="ghost" className="min-h-9 px-2 text-xs" onClick={() => setSheet({ kind: 'role' })}>{t('Correct role / crew')}</Button></div>}
        <Row label={t('Operational role')} value={emp.position_label} />
        <Row label={t('Permanent crew')} value={isCrew(emp.crew_code) ? <CrewTag crew={emp.crew_code} /> : (emp.position_code === 'vr_controller' || emp.position_code === 'morning_controller' ? t('Not crew-bound') : null)} />
        <Row label={t('Since')} value={emp.role_effective_from ? `${fmtDate(emp.role_effective_from)}${emp.role_source === 'manual' ? ` · ${t('set manually')}` : ''}` : null} />
        {emp.role_note ? <Row label={t('Note')} value={emp.role_note} /> : null}
        <Row label={t('Section')} value={emp.section_name} />
      </Collapsible>

      <Collapsible title="KNPC master data" count={1}>
        {emp.employment_type === 'contractor' && <p className="mb-2 text-xs text-slate-500">{t('Contractor · no KNPC HR data')}</p>}
        <Row label={t('Grade')} value={emp.grade} />
        <Row label={t('Master position')} value={emp.master_position} />
        <Row label={t('Cost center')} value={emp.cost_center} />
        <Row label={t('Join date')} value={fmtDate(emp.join_date)} />
        <Row label={t('Last promotion')} value={fmtDate(emp.last_promotion_date)} />
        <Row label={t('Position start')} value={fmtDate(emp.position_start_date)} />
        <Row label={t('Service years')} value={emp.service_years} />
        <Row label={t('Years in grade')} value={emp.years_in_grade} />
        <Row label={t('Education')} value={emp.education} />
        {data.perf.map((p) => <Row key={p.id} label={`${t('Performance')} ${p.year}`} value={<>{p.perf_level ?? '—'}{p.increment_pct != null ? ` · ${t('increment')} ${p.increment_pct}%` : ''}{p.warnings ? ` · ${t('warning on file')}` : ''}</>} />)}
        {!edit && <p className="mt-2 text-[11px] text-slate-500">{t('Master data is corrected in More → Data quality.')}</p>}
      </Collapsible>

      {(emp.position_code === 'field_operator' || emp.position_code === 'panel_operator' || emp.position_code === 'controller' || emp.position_code === 'vr_controller') && (
        <Collapsible title="Shutdown history" count={1}><PersonHistory employeeId={emp.id} crew={isCrew(emp.crew_code) ? emp.crew_code : null} showSick={false} /></Collapsible>
      )}

      <Collapsible title="Original plan (PV Scheduled)" count={originalLeaves.length}>
        <p className="mb-1 text-xs text-slate-500">{t('As first approved · history only')}</p>
        <ul className="divide-y divide-slate-100">{originalLeaves.map((l) => <LeaveLine key={l.id} l={l} types={data.absenceTypes} />)}</ul>
      </Collapsible>

      <Collapsible title="Leave versions (moved or corrected)" count={leaveChains(data.leaves).length}>
        <p className="mb-1 text-xs text-slate-500">{t('Dates are never edited: each change is a new version · oldest first')}</p>
        <ul className="divide-y divide-slate-100">{leaveChains(data.leaves).map((c) => <li key={c[0].root_id} className="py-2"><VersionList versions={c} /></li>)}</ul>
      </Collapsible>

      <Collapsible title="Leave change history" count={data.changes.length}>
        <ul className="divide-y divide-slate-100 text-sm">
          {data.changes.map((c) => (
            <li key={c.id} className="py-2">
              <div className="flex items-center justify-between gap-2"><span className="font-medium text-slate-800">{changeLabel(c)}</span><span className="text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString('en-GB')}</span></div>
              <div className="text-xs text-slate-600">
                {c.from_start ? `${fmtDate(c.from_start)} → ${fmtDate(c.from_end)}` : ''}{c.from_start && c.to_start ? '  ⇒  ' : ''}{c.to_start ? `${fmtDate(c.to_start)} → ${fmtDate(c.to_end)}` : ''}
              </div>
              {c.note ? <div className="text-xs text-slate-500">{c.note}</div> : null}
              {c.evidence ? <div className="text-xs text-slate-500">{t('Evidence')}: {c.evidence}</div> : null}
            </li>
          ))}
        </ul>
      </Collapsible>

      <Collapsible title="Shift movements" count={moves.length}>
        <ul className="divide-y divide-slate-100 text-sm">
          {moves.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium text-slate-800">{m.from_crew && <CrewTag crew={m.from_crew} suffix="" />} → {m.to_crew === 'DAY' ? <span className="inline-flex items-center gap-1.5"><DayDutyBadge size="sm" />{t('Day')}</span> : <CrewTag crew={m.to_crew} suffix="" />} <span className="font-normal text-slate-500">· {t(m.kind === 'permanent' ? 'permanent' : m.to_crew === 'DAY' ? 'day duty' : 'temporary cover')}{m.status === 'cancelled' ? ` · ${t('cancelled')}` : ''}</span></span>
                <span className="block text-xs text-slate-500">{fmtDate(m.start_date)} → {m.kind === 'permanent' ? t('onward') : m.end_date ? fmtDate(m.end_date) : t('until further notice')}{m.reason ? ` · ${m.reason}` : ''}</span>
              </span>
              {isHead && (m.kind === 'temporary' || m.kind === 'placement') && m.status === 'active' && <span className="flex shrink-0 gap-2 text-xs font-medium"><button type="button" className="min-h-9 text-brand-700" onClick={() => setMoveSheet({ kind: 'end', movement: m })}>{t('End')}</button><button type="button" className="min-h-9 text-status-red" onClick={() => setMoveSheet({ kind: 'cancel', movement: m })}>{t('Cancel')}</button></span>}
            </li>
          ))}
        </ul>
      </Collapsible>

      <Collapsible title="Role history" count={data.roles.length}>
        <ul className="divide-y divide-slate-100 text-sm">
          {data.roles.map((r) => <li key={r.id} className="flex justify-between py-2"><span className="inline-flex flex-wrap items-center gap-1.5">{r.positions?.label ?? r.position_id}{isCrew(r.crews?.code) && <><span className="text-slate-500">·</span><CrewTag crew={r.crews?.code} /></>}</span><span className="text-slate-500">{fmtDate(r.effective_from)} → {r.effective_to ? fmtDate(r.effective_to) : t('current')}</span></li>)}
        </ul>
      </Collapsible>

      <Collapsible title="Change history" count={data.audit.length}>
        <div className="mb-1 text-end"><Link to={`/admin?tab=audit&employee=${emp.id}`} className="text-xs font-medium text-brand-700">{t('See all')}</Link></div>
        {data.audit.length === 0 ? <p className="text-sm text-slate-500">{t('No changes recorded.')}</p> : !auditLk ? <p className="text-xs text-slate-500">…</p> : (
          <div className="-mx-3 divide-y divide-slate-100">{data.audit.map((a) => <AuditLine key={a.id} e={describe(a as unknown as AuditRow, auditLk)} showPerson={false} />)}</div>
        )}
      </Collapsible>

      {edit && sheet?.kind === 'qual' && <QualificationSheet emp={emp} code={sheet.code} current={currentQual(sheet.code)} actor={profile} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load().catch(setError); }} />}
      {edit && sheet?.kind === 'basics' && <BasicsSheet emp={emp} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load().catch(setError); }} />}
      {moveSheet && <MovementSheet target={moveSheet} people={[{ id: emp.id, name: emp.display_name, crew: isCrew(emp.crew_code) ? emp.crew_code : null }]} onClose={() => setMoveSheet(null)} onDone={(m) => { setMoveSheet(null); setFlash(m); load().catch(setError); }} />}
      {edit && sheet?.kind === 'role' && <RoleSheet emp={emp} positions={data.positions} crews={data.crews} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load().catch(setError); }} />}
    </div>
  );
}

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

/** "12 Oct – 25 Oct", with the year only when it is not this year. */
const dateRange = (start: string, end: string, today: string) => `${shortDate(start)} – ${shortDate(end)}${end.slice(0, 4) !== today.slice(0, 4) ? ` ${end.slice(0, 4)}` : ''}`;
const dayCount = (start: string, end: string) => { const n = Math.round((Date.parse(end) - Date.parse(start)) / 864e5) + 1; return `${n} day${n === 1 ? '' : 's'}`; };

function LeaveCode({ code }: { code: string | null | undefined }) {
  return <span className="mr-1 inline-flex min-w-9 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-700">{code ?? '—'}</span>;
}

type ProfileSpan = LeaveSpan & { rec: LeaveRecord };
function BlockRow({ b, today, showReturn, to }: { b: LeaveBlock<ProfileSpan>; today: string; showReturn?: boolean; to?: string }) {
  const inner = (
      <span className="flex w-full items-center justify-between gap-3 py-2 text-start text-sm active:bg-slate-50">
        <span className="min-w-0">
          <span className="block font-medium text-slate-800"><LeaveCode code={b.record.typeShort} /> {dateRange(b.start, b.end, today)}{b.record.rec.dates_estimated && <> <EstimatedTag /></>}</span>
          <span className="block text-xs text-slate-500">{b.record.typeLabel ?? t('Leave')} · {dayCount(b.start, b.end)}{b.record.rec.hand_corrected ? ` · ${t('by hand')}` : ''}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {showReturn && <span className="text-xs font-medium text-slate-600">{t('Return')} {shortDate(b.returnOn)}</span>}
          {to && <Pencil className="h-3.5 w-3.5 text-slate-500" />}
        </span>
      </span>
  );
  return <li>{to ? <Link to={to} aria-label={t('Change through Entry')}>{inner}</Link> : inner}</li>;
}

/** A profile section that starts closed and shows how many records it holds. */
function Collapsible({ title, count, children, startOpen = false }: { title: string; count: number; children: React.ReactNode; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <Card className="mb-3">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-9 w-full items-center justify-between text-start">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t(title)} ({count})</h2>
        {open ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </Card>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="mb-3">
      <div className="mb-1 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t(title)}</h2>{action}</div>
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

/** The day and month of `iso` in the current year (29 Feb → 28 Feb in a common year); today when `iso` is empty. */
function sameDayThisYear(iso: string): string {
  const now = new Date(); const y = now.getFullYear();
  if (!iso) return `${y}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [m, d] = [Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

function BasicsSheet({ emp, onClose, onSaved }: { emp: EmployeeDirectoryRow; onClose: () => void; onSaved: () => void }) {
  const [shortName, setShortName] = useState(emp.short_name ?? '');
  const [fullName, setFullName] = useState(emp.official_name);
  const [displayName, setDisplayName] = useState(emp.display_name);
  const [type, setType] = useState(emp.employment_type);
  const [confirmed, setConfirmed] = useState(emp.employment_type_source === 'confirmed');
  const [active, setActive] = useState(emp.is_active);
  const [notes, setNotes] = useState(emp.notes ?? '');
  const [grade, setGrade] = useState(emp.grade != null ? String(emp.grade) : '');
  const [promoted, setPromoted] = useState(emp.last_promotion_date ?? '');
  const [fieldCover, setFieldCover] = useState(emp.can_cover_field === true);
  const [arabicName, setArabicName] = useState(emp.arabic_name ?? '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const gradeNum = grade.trim() === '' ? null : Number(grade);
  const gradeBad = gradeNum !== null && (!Number.isInteger(gradeNum) || gradeNum < 1 || gradeNum > 25);
  async function save() {
    setBusy(true); setError(null);
    const { error } = await supabase.from('employees').update({ short_name: shortName.trim() || null, official_name: fullName.trim(), display_name: displayName.trim() || displayNameFor({ officialName: fullName, shortName, employmentType: type, employmentTypeSource: confirmed ? 'confirmed' : 'inferred' }) || fullName.trim(), employment_type: type, employment_type_source: confirmed ? 'confirmed' : 'inferred', is_active: active, notes: notes.trim() || null, grade: gradeNum, last_promotion_date: promoted || null, arabic_name: arabicName.trim() || null, ...(emp.position_code === 'panel_operator' ? { can_cover_field: fieldCover } : {}) }).eq('id', emp.id);
    setBusy(false); if (error) setError(error); else onSaved();
  }
  return (
    <BottomSheet open onClose={onClose} title="Edit employee">
      <div className="space-y-3">
        <Field label="Official name" hint="As in the KNPC Promotion Master"><input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <Field label="Display name" hint="Empty = first and last name"><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <Field label="Workbook name" hint="As on the U-12 sheets"><input className="input" value={shortName} onChange={(e) => setShortName(e.target.value)} /></Field>
        <Field label="Name in Arabic" hint="For search: the Arabic name finds him in Employees, Leave plan and Requests"><input className="input" dir="rtl" lang="ar" value={arabicName} onChange={(e) => setArabicName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Grade" hint={gradeBad ? 'A whole number, 1–25' : emp.grade != null && gradeNum !== emp.grade ? `Was ${emp.grade}` : undefined}>
            <input className="input" inputMode="numeric" value={grade} onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, ''); setGrade(v);
              // a new grade suggests the last promotion's day and month in this year (promotions fall on the same date),
              // or today when none is recorded; editable. Back to the old grade restores the recorded date.
              const was = emp.last_promotion_date ?? '';
              if (v === String(emp.grade ?? '')) setPromoted(was); else if (promoted === was) setPromoted(sameDayThisYear(was));
            }} />
          </Field>
          <Field label="Last promotion"><input type="date" className="input" value={promoted} onChange={(e) => setPromoted(e.target.value)} /></Field>
        </div>
        <Field label="Employment classification" >
          <div className="flex gap-2">{(['knpc', 'contractor'] as const).map((t) => <button key={t} type="button" onClick={() => { setType(t); setConfirmed(true); }} className={`flex-1 rounded-xl py-2.5 text-sm font-medium ring-1 ${type === t ? 'bg-brand-700 text-white ring-brand-700' : 'ring-slate-300'}`}>{t === 'knpc' ? 'KNPC' : 'Contractor'}</button>)}</div>
        </Field>
        {emp.position_code === 'panel_operator' && (
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={fieldCover} onChange={(e) => setFieldCover(e.target.checked)} />
            <span>Can cover a Field post{(emp.grade ?? 0) >= 13 ? <span className="block text-[11px] text-slate-500">Grade 13 and above count as Field cover anyway.</span> : <span className="block text-[11px] text-slate-500">Counts as the Field buffer when the crew has a Panel Operator to spare.</span>}</span></label>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Classification confirmed (not just inferred from the number)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active in Unit-12 manpower</label>
        <Field label="Notes"><textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error ? <div className="mt-2"><ErrorBox error={error} /></div> : null}
      <div className="mt-4 flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button><Button className="flex-1" disabled={busy || gradeBad} onClick={save}>Save</Button></div>
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
      <p className="mb-3 text-xs text-slate-500">Fixes wrong data. Real crew changes → Shift movements.</p>
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
