import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchDirectory } from '@/data/queries';
import type { EmployeeDirectoryRow } from '@/data/types';
import { Card, Chip, ErrorBox, PageHeader, Spinner, cx, qualificationLabel, qualificationTone } from '@/ui/components';

const ROLE_FILTERS = [['', 'All roles'], ['controller', 'Controllers'], ['panel', 'Panel'], ['field', 'Field']] as const;
const CREW_FILTERS = ['', 'A', 'B', 'C', 'D'] as const;

export default function EmployeesPage() {
  const [rows, setRows] = useState<EmployeeDirectoryRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const role = params.get('role') ?? '';
  const crew = params.get('crew') ?? '';
  const emp = params.get('type') ?? '';
  useEffect(() => { fetchDirectory().then(setRows).catch(setError); }, []);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => r.in_unit12_scope && r.is_active)
      .filter((r) => !role || r.position_category === role)
      .filter((r) => !crew || r.crew_code === crew)
      .filter((r) => !emp || r.employment_type === emp)
      .filter((r) => !needle || r.employee_number.includes(needle) || r.full_name.toLowerCase().includes(needle) || (r.short_name ?? '').toLowerCase().includes(needle))
      .sort((a, b) => (a.position_category ?? 'z').localeCompare(b.position_category ?? 'z') || (a.crew_code ?? 'Z').localeCompare(b.crew_code ?? 'Z') || a.full_name.localeCompare(b.full_name));
  }, [rows, q, role, crew, emp]);

  if (error) return <ErrorBox error={error} />;
  return (
    <div>
      <PageHeader title="Employees" subtitle={rows ? `${filtered.length} of ${rows.filter((r) => r.in_unit12_scope && r.is_active).length} in Section 1 scope` : undefined} />
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder="Search name or employee number" value={q} onChange={(e) => set('q', e.target.value)} inputMode="search" />
      </label>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none]">
        {ROLE_FILTERS.map(([v, l]) => <FilterChip key={v} active={role === v} onClick={() => set('role', v)}>{l}</FilterChip>)}
        <span className="mx-1 w-px shrink-0 bg-slate-300" />
        {CREW_FILTERS.map((v) => <FilterChip key={v || 'all'} active={crew === v} onClick={() => set('crew', v)}>{v ? `${v} Shift` : 'All crews'}</FilterChip>)}
        <span className="mx-1 w-px shrink-0 bg-slate-300" />
        {[['', 'KNPC + Contractor'], ['knpc', 'KNPC'], ['contractor', 'Contractor']].map(([v, l]) => <FilterChip key={v || 'both'} active={emp === v} onClick={() => set('type', v)}>{l}</FilterChip>)}
      </div>
      {!rows ? <Spinner /> : (
        <ul className="mt-3 space-y-2">
          {filtered.map((r) => (
            <li key={r.id}>
              <Card to={`/employees/${r.id}`} className="flex items-center gap-3 p-3">
                <div className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold', r.crew_code ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600')}>{r.crew_code ?? (r.position_code === 'vr_controller' ? 'VR' : r.position_code === 'morning_controller' ? 'M' : '—')}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate font-medium text-slate-800">{r.short_name ?? r.full_name}</span>{r.employment_type === 'contractor' && <Chip>Contractor</Chip>}</div>
                  <div className="truncate text-xs text-slate-500">#{r.employee_number} · {r.position_label ?? 'No role'}{r.grade ? ` · Grade ${r.grade}` : ''}</div>
                </div>
                <div className="shrink-0 text-right">
                  {r.position_category === 'field' && <Chip tone={qualificationTone(r.take_charge_status)}>TC: {qualificationLabel(r.take_charge_status)}</Chip>}
                  {r.position_category === 'panel' && <Chip tone={qualificationTone(r.panel_operator_status)}>Panel: {qualificationLabel(r.panel_operator_status)}</Chip>}
                  {r.position_category === 'controller' && <Chip tone={r.grade && r.grade >= 15 ? 'green' : r.grade === 14 ? 'amber' : 'neutral'}>{r.grade ? `Grade ${r.grade}` : 'Grade —'}</Chip>}
                </div>
              </Card>
            </li>
          ))}
          {filtered.length === 0 && <li className="py-10 text-center text-sm text-slate-500">No employees match.</li>}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cx('shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ring-1', active ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{children}</button>;
}
