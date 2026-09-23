import { Check, CheckSquare, Search, Square, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ACTION_LABEL, actionsFor, eligibleFor } from '@/core/actions';
import type { ActionCode, ActionItem, BulkAction } from '@/core/actions';
import { confirmEmploymentTypeBulk, setQualificationBulk } from '@/data/bulk';
import { fetchDirectory } from '@/data/queries';
import type { EmployeeDirectoryRow, QualificationStatus, UserProfile } from '@/data/types';
import { BottomSheet, Button, Chip, ErrorBox, PageHeader, Spinner, cx, qualificationLabel, qualificationTone } from '@/ui/components';

const ROLE_FILTERS = [['', 'All roles'], ['controller', 'Controllers'], ['panel', 'Panel'], ['field', 'Field']] as const;
const CREW_FILTERS = ['', 'A', 'B', 'C', 'D'] as const;
const NEED_ORDER: ActionCode[] = ['take_charge', 'panel_qualification', 'employment_type', 'grade_missing', 'controller_grade', 'unresolved_absences'];

type Row = EmployeeDirectoryRow & { actions: ActionItem[] };
interface Choice { key: string; action: BulkAction; status?: QualificationStatus; label: string; tone: 'green' | 'red' | 'blue' }
const CHOICES: Choice[] = [
  { key: 'tc_yes', action: 'take_charge', status: 'yes', label: 'Take-Charge = Yes', tone: 'green' },
  { key: 'tc_no', action: 'take_charge', status: 'no', label: 'Take-Charge = No', tone: 'red' },
  { key: 'panel_yes', action: 'panel_qualification', status: 'yes', label: 'Panel qualification = Yes', tone: 'green' },
  { key: 'panel_no', action: 'panel_qualification', status: 'no', label: 'Panel qualification = No', tone: 'red' },
  { key: 'emp', action: 'employment_type', label: 'Confirm KNPC / Contractor classification as shown', tone: 'blue' }
];

export default function EmployeesPage({ profile }: { profile: UserProfile }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const q = params.get('q') ?? '';
  const role = params.get('role') ?? '';
  const crew = params.get('crew') ?? '';
  const emp = params.get('type') ?? '';
  const view = params.get('view') ?? '';
  const need = (params.get('need') ?? '') as ActionCode | '';
  const load = () => fetchDirectory().then((r) => setRows(r.filter((x) => x.in_unit12_scope && x.is_active).map((x) => ({ ...x, actions: actionsFor(x) })))).catch(setError);
  useEffect(() => { load(); }, []);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); if (k === 'view' && !v) p.delete('need'); setParams(p, { replace: true }); };

  const needCounts = useMemo(() => {
    const c = {} as Record<ActionCode, number>;
    for (const r of rows ?? []) for (const a of r.actions) c[a.code] = (c[a.code] ?? 0) + 1;
    return c;
  }, [rows]);
  const needingAction = (rows ?? []).filter((r) => r.actions.length > 0).length;

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => view !== 'action' || r.actions.length > 0)
      .filter((r) => !need || r.actions.some((a) => a.code === need))
      .filter((r) => !role || r.position_category === role)
      .filter((r) => !crew || r.crew_code === crew)
      .filter((r) => !emp || r.employment_type === emp)
      .filter((r) => !needle || r.employee_number.includes(needle) || r.official_name.toLowerCase().includes(needle) || r.display_name.toLowerCase().includes(needle) || (r.short_name ?? '').toLowerCase().includes(needle))
      .sort((a, b) => (a.position_category ?? 'z').localeCompare(b.position_category ?? 'z') || (a.crew_code ?? 'Z').localeCompare(b.crew_code ?? 'Z') || a.display_name.localeCompare(b.display_name));
  }, [rows, q, role, crew, emp, view, need]);

  const selectedRows = (rows ?? []).filter((r) => selected.has(r.id));
  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allShownSelected) filtered.forEach((r) => n.delete(r.id)); else filtered.forEach((r) => n.add(r.id)); return n; });

  if (error && !rows) return <ErrorBox error={error} />;
  return (
    <div className={cx(selected.size > 0 && 'pb-28')}>
      <PageHeader title="Employees" subtitle={rows ? `${filtered.length} shown · ${rows.length} in Section 1 scope · ${needingAction} need action` : undefined} />

      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm sm:inline-grid sm:w-auto">
        <button onClick={() => set('view', '')} className={cx('min-h-9 rounded-lg px-4 font-medium', view !== 'action' ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>All employees</button>
        <button onClick={() => set('view', 'action')} className={cx('min-h-9 rounded-lg px-4 font-medium', view === 'action' ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>Needs action{rows ? ` (${needingAction})` : ''}</button>
      </div>

      {view === 'action' && (
        <div className="mb-3 flex flex-wrap gap-2">
          <FilterChip active={!need} onClick={() => set('need', '')}>Any action</FilterChip>
          {NEED_ORDER.filter((c) => needCounts[c]).map((c) => (
            <FilterChip key={c} active={need === c} onClick={() => set('need', c)}>{c === 'unresolved_absences' ? 'Unresolved absences' : ACTION_LABEL[c]} ({needCounts[c]})</FilterChip>
          ))}
        </div>
      )}

      <div className="lg:flex lg:items-center lg:gap-3">
        <label className="relative block lg:w-72 lg:shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input" style={{ paddingLeft: '2.25rem' }} placeholder="Search name or employee number" value={q} onChange={(e) => set('q', e.target.value)} inputMode="search" />
        </label>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] lg:mt-0 lg:flex-wrap">
          {ROLE_FILTERS.map(([v, l]) => <FilterChip key={v} active={role === v} onClick={() => set('role', v)}>{l}</FilterChip>)}
          <span className="mx-1 w-px shrink-0 bg-slate-300" />
          {CREW_FILTERS.map((v) => <FilterChip key={v || 'all'} active={crew === v} onClick={() => set('crew', v)}>{v ? `${v} Shift` : 'All crews'}</FilterChip>)}
          <span className="mx-1 w-px shrink-0 bg-slate-300" />
          {[['', 'KNPC + Contractor'], ['knpc', 'KNPC'], ['contractor', 'Contractor']].map(([v, l]) => <FilterChip key={v || 'both'} active={emp === v} onClick={() => set('type', v)}>{l}</FilterChip>)}
        </div>
      </div>

      {done && <div className="mt-3 flex items-center gap-2 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200"><Check className="h-4 w-4" /> {done}<button className="ml-auto" aria-label="Dismiss" onClick={() => setDone(null)}><X className="h-4 w-4" /></button></div>}

      {!rows ? <Spinner /> : (
        <>
          <div className="mt-3 flex items-center justify-between text-sm">
            <button onClick={toggleAll} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-1 font-medium text-brand-700">
              {allShownSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />} {allShownSelected ? 'Unselect shown' : `Select all shown (${filtered.length})`}
            </button>
            {selected.size > 0 && <span className="text-slate-500">{selected.size} selected</span>}
          </div>

          {/* PC: table */}
          <div className="mt-2 hidden overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 lg:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2"><SelectBox checked={allShownSelected} onChange={toggleAll} label="Select all shown" /></th>
                  <th className="px-2 py-2">Employee</th><th className="px-2 py-2">Emp #</th><th className="px-2 py-2">Role</th><th className="px-2 py-2">Crew</th>
                  <th className="px-2 py-2">Grade</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Qualification</th><th className="px-2 py-2">Needs action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.id} className={cx('align-top', selected.has(r.id) ? 'bg-brand-50/60' : 'hover:bg-slate-50')}>
                    <td className="px-3 py-2"><SelectBox checked={selected.has(r.id)} onChange={() => toggle(r.id)} label={`Select ${r.display_name}`} /></td>
                    <td className="px-2 py-2"><Link to={`/employees/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.display_name}</Link>{r.official_name !== r.display_name && <div className="max-w-56 truncate text-xs text-slate-500">{r.official_name}</div>}</td>
                    <td className="px-2 py-2 tabular-nums text-slate-600">{r.employee_number}</td>
                    <td className="px-2 py-2 text-slate-700">{r.position_label ?? '—'}</td>
                    <td className="px-2 py-2 text-slate-700">{r.crew_code ?? (r.position_code === 'vr_controller' ? 'VR' : r.position_code === 'morning_controller' ? 'M' : '—')}</td>
                    <td className="px-2 py-2 tabular-nums text-slate-700">{r.grade ?? '—'}</td>
                    <td className="px-2 py-2"><span className="text-slate-700">{r.employment_type === 'knpc' ? 'KNPC' : 'Contractor'}</span>{r.employment_type_source !== 'confirmed' && <div className="text-[11px] text-amber-700">inferred</div>}</td>
                    <td className="px-2 py-2"><QualChip r={r} /></td>
                    <td className="px-2 py-2"><ActionChips actions={r.actions} /></td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-slate-500">No employees match.</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Phone: cards */}
          <ul className="mt-2 space-y-2 lg:hidden">
            {filtered.map((r) => (
              <li key={r.id} className={cx('flex items-stretch gap-1 rounded-2xl bg-white shadow-sm ring-1', selected.has(r.id) ? 'ring-brand-600' : 'ring-slate-200')}>
                <div className="flex items-center pl-2"><SelectBox checked={selected.has(r.id)} onChange={() => toggle(r.id)} label={`Select ${r.display_name}`} /></div>
                <Link to={`/employees/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3 p-3 pl-1">
                  <div className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold', r.crew_code ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600')}>{r.crew_code ?? (r.position_code === 'vr_controller' ? 'VR' : r.position_code === 'morning_controller' ? 'M' : '—')}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="truncate font-medium text-slate-800">{r.display_name}</span>{r.employment_type === 'contractor' && <Chip>Contractor</Chip>}</div>
                    <div className="truncate text-xs text-slate-500">#{r.employee_number} · {r.position_label ?? 'No role'}{r.grade ? ` · Grade ${r.grade}` : ''}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1"><QualChip r={r} />{r.actions.filter((a) => a.code !== 'take_charge' && a.code !== 'panel_qualification').map((a) => <Chip key={a.code} tone={a.bulk ? 'amber' : 'neutral'} className="whitespace-nowrap text-[11px]">{a.label}</Chip>)}</div>
                  </div>
                </Link>
              </li>
            ))}
            {filtered.length === 0 && <li className="py-10 text-center text-sm text-slate-500">No employees match.</li>}
          </ul>
        </>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-30 mx-auto max-w-5xl px-4 lg:max-w-7xl sm:bottom-4 sm:pl-48">
          <div className="flex items-center gap-2 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-slate-200">
            <div className="flex-1 text-sm font-medium text-brand-800">{selected.size} selected</div>
            <Button variant="secondary" className="min-h-10" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button className="min-h-10" onClick={() => setSheet(true)}>Approve…</Button>
          </div>
        </div>
      )}

      {sheet && <ApproveSheet rows={selectedRows} profile={profile} onClose={() => setSheet(false)}
        onDone={(msg) => { setSheet(false); setSelected(new Set()); setDone(msg); load(); }} />}
    </div>
  );
}

function ApproveSheet({ rows, profile, onClose, onDone }: { rows: Row[]; profile: UserProfile; onClose: () => void; onDone: (msg: string) => void }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const eligible = choice ? eligibleFor(rows, choice.action) : [];
  const skipped = rows.length - eligible.length;

  async function apply() {
    if (!choice) return;
    setBusy(true); setError(null);
    try {
      const ids = eligible.map((r) => r.id);
      const n = choice.action === 'employment_type'
        ? await confirmEmploymentTypeBulk(ids, note, profile)
        : await setQualificationBulk(ids, choice.action === 'take_charge' ? 'take_charge' : 'panel_operator', choice.status!, profile, note);
      onDone(`${choice.label}: saved for ${n} employee${n === 1 ? '' : 's'}${eligible.length - n > 0 ? ` (${eligible.length - n} already had this value)` : ''}.`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <BottomSheet open onClose={onClose} title={`Approve for ${rows.length} selected`}>
      <div className="space-y-2">
        {CHOICES.map((c) => {
          const n = eligibleFor(rows, c.action).length;
          return (
            <button key={c.key} type="button" disabled={n === 0} onClick={() => setChoice(c)}
              className={cx('flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm ring-1 disabled:opacity-40', choice?.key === c.key ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-800 ring-slate-300')}>
              <span className="font-medium">{c.label}</span><span className="text-xs">{n} eligible</span>
            </button>
          );
        })}
      </div>
      {choice && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-slate-700">Applies to <span className="font-semibold">{eligible.length}</span> of the {rows.length} selected{skipped ? `; ${skipped} will be skipped because it does not apply to their role or they are already confirmed` : ''}.</p>
          <ul className="max-h-40 overflow-y-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{eligible.map((r) => <li key={r.id}>{r.display_name} · #{r.employee_number}{r.crew_code ? ` · ${r.crew_code}` : ''}</li>)}</ul>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Note (optional)
            <input className="input mt-1 normal-case tracking-normal" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed against Section Head list, Sep 2026" />
          </label>
          <p className="text-[11px] text-slate-500">Each change is recorded with your name and date; earlier records are kept in history.</p>
        </div>
      )}
      {error ? <div className="mt-2"><ErrorBox error={error} /></div> : null}
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button className="flex-1" disabled={!choice || eligible.length === 0 || busy} onClick={apply}>{busy ? 'Saving…' : choice ? `Approve ${eligible.length}` : 'Choose an action'}</Button>
      </div>
    </BottomSheet>
  );
}

function SelectBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={onChange} className="flex h-10 w-10 items-center justify-center rounded-lg text-brand-700 hover:bg-brand-50">
      {checked ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5 text-slate-400" />}
    </button>
  );
}

function QualChip({ r }: { r: EmployeeDirectoryRow }) {
  if (r.position_category === 'field') return <Chip tone={qualificationTone(r.take_charge_status)} className="whitespace-nowrap">TC: {qualificationLabel(r.take_charge_status)}</Chip>;
  if (r.position_category === 'panel') return <Chip tone={qualificationTone(r.panel_operator_status)} className="whitespace-nowrap">Panel: {qualificationLabel(r.panel_operator_status)}</Chip>;
  if (r.position_category === 'controller') return <Chip tone={r.grade && r.grade >= 15 ? 'green' : r.grade === 14 ? 'amber' : 'neutral'}>{r.acting_controller_status === 'yes' ? 'Acting Controller' : r.grade ? `Grade ${r.grade}` : 'Grade —'}</Chip>;
  return null;
}

function ActionChips({ actions }: { actions: ActionItem[] }) {
  if (!actions.length) return <span className="text-xs text-slate-400">—</span>;
  return <div className="flex flex-wrap gap-1">{actions.map((a) => <Chip key={a.code} tone={a.bulk ? 'amber' : 'neutral'} className="whitespace-nowrap text-[11px]">{a.label}</Chip>)}</div>;
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cx('shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ring-1', active ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{children}</button>;
}

