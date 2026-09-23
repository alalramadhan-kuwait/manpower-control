import { useEffect, useState } from 'react';
import { fetchBatches, fetchDirectory } from '@/data/queries';
import type { EmployeeDirectoryRow, ImportBatch } from '@/data/types';
import { Card, Chip, ErrorBox, PageHeader, Spinner, Stat, fmtDate } from '@/ui/components';
import { CrewTag, crewEdge } from '@/ui/crew';

const CREWS = ['A', 'B', 'C', 'D'] as const;

export default function HomePage() {
  const [rows, setRows] = useState<EmployeeDirectoryRow[] | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { Promise.all([fetchDirectory(), fetchBatches()]).then(([r, b]) => { setRows(r); setBatches(b); }).catch(setError); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!rows) return <Spinner />;
  const scope = rows.filter((r) => r.in_unit12_scope && r.is_active);
  const byCat = (c: string) => scope.filter((r) => r.position_category === c);
  const tcUnconfirmed = byCat('field').filter((r) => r.take_charge_status !== 'yes' && r.take_charge_status !== 'no').length;
  const unresolved = scope.reduce((n, r) => n + Number(r.unresolved_absences), 0);
  const inferred = scope.filter((r) => r.employment_type_source !== 'confirmed').length;
  const last = batches[0];
  return (
    <div>
      <PageHeader title="Section summary" subtitle="Unit 12 — Section 1 headcount and data quality. Daily manpower status is on the Today screen." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="In scope" value={scope.length} to="/employees" />
        <Stat label="Controllers" value={byCat('controller').length} to="/employees?role=controller" />
        <Stat label="Panel Operators" value={byCat('panel').length} to="/employees?role=panel" />
        <Stat label="Field Operators" value={byCat('field').length} to="/employees?role=field" />
      </div>
      <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">Crews (permanent assignment)</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CREWS.map((c) => {
          const crew = scope.filter((r) => r.crew_code === c);
          const n = (cat: string) => crew.filter((r) => r.position_category === cat).length;
          return (
            <Card key={c} to={`/employees?crew=${c}`} className={crewEdge(c)}>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><span className="text-lg font-semibold text-slate-900"><CrewTag crew={c} size="md" /></span><span className="whitespace-nowrap text-xs text-slate-500">{crew.length} people</span></div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
                <div><div className="text-base font-semibold tabular-nums">{n('controller')}</div><div className="text-slate-500">Ctrl</div></div>
                <div><div className="text-base font-semibold tabular-nums">{n('panel')}</div><div className="text-slate-500">Panel</div></div>
                <div><div className="text-base font-semibold tabular-nums">{n('field')}</div><div className="text-slate-500">Field</div></div>
              </div>
            </Card>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
        {scope.filter((r) => r.position_code === 'vr_controller').map((r) => <Chip key={r.id} tone="blue">VR Controller: {r.display_name}</Chip>)}
        {scope.filter((r) => r.position_code === 'morning_controller').map((r) => <Chip key={r.id} tone="blue">Morning Controller: {r.display_name}</Chip>)}
        <Chip>{scope.filter((r) => r.employment_type === 'contractor').length} contractors</Chip>
      </div>
      <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">Data quality</h2>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Take-Charge not confirmed" value={tcUnconfirmed} tone={tcUnconfirmed ? 'amber' : 'green'} to="/review" />
        <Stat label="Unresolved absences" value={unresolved} tone={unresolved ? 'amber' : 'green'} to="/review" />
        <Stat label="Employment type inferred" value={inferred} tone={inferred ? 'amber' : 'green'} to="/review" />
      </div>
      <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">Last import</h2>
      {last ? (
        <Card to={`/imports/${last.id}`}>
          <div className="flex items-center justify-between gap-2"><span className="truncate font-medium text-slate-800">{last.file_name}</span><Chip tone={last.status === 'committed' ? 'green' : last.status === 'aborted' ? 'red' : 'amber'}>{last.status}</Chip></div>
          <div className="mt-1 text-xs text-slate-500">{fmtDate(last.created_at)} · {last.records_new} new · {last.records_changed} changed · {last.records_review} to review</div>
        </Card>
      ) : <Card className="text-sm text-slate-500">No import yet. Open the Import Center from More.</Card>}
    </div>
  );
}
