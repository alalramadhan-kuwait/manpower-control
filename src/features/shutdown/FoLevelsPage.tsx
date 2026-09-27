import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FO_LEVEL_LABEL, type FoLevel } from '@/core/shutdown';
import { fetchDirectory } from '@/data/queries';
import { setFoLevel } from '@/data/shutdown';
import type { EmployeeDirectoryRow } from '@/data/types';
import { Card, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';
import { CrewBadge, isCrew } from '@/ui/crew';

const LEVELS: FoLevel[] = ['senior', 'good', 'new'];
const TONE: Record<FoLevel, string> = { senior: 'bg-brand-700 text-white', good: 'bg-green-600 text-white', new: 'bg-amber-500 text-white' };

/** Mark each Field Operator Senior / Good / New for shutdown teams. Saved on tap; kept in the audit history. */
export default function FoLevelsPage() {
  const [rows, setRows] = useState<EmployeeDirectoryRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { fetchDirectory().then(setRows).catch(setError); }, []);
  const fos = useMemo(() => (rows ?? []).filter((r) => r.is_active && r.in_unit12_scope && r.position_code === 'field_operator')
    .sort((a, b) => (a.crew_code ?? 'Z').localeCompare(b.crew_code ?? 'Z') || (b.grade ?? 0) - (a.grade ?? 0) || a.display_name.localeCompare(b.display_name)), [rows]);
  async function set(r: EmployeeDirectoryRow, level: FoLevel) {
    const next = r.fo_level === level ? null : level;
    setRows((x) => x!.map((y) => (y.id === r.id ? { ...y, fo_level: next } : y)));
    try { await setFoLevel(r.id, next); setSaved(`${r.display_name}: ${next ? FO_LEVEL_LABEL[next] : 'no level'}`); }
    catch (e) { setError(e); setRows((x) => x!.map((y) => (y.id === r.id ? { ...y, fo_level: r.fo_level } : y))); }
  }
  const count = (l: FoLevel) => fos.filter((r) => r.fo_level === l).length;
  return (
    <div>
      <Link to="/shutdown" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700"><ArrowLeft className="h-4 w-4" />Shutdown teams</Link>
      <PageHeader title="FO levels" subtitle={`${count('senior')} Senior · ${count('good')} Good · ${count('new')} New · ${fos.length - count('senior') - count('good') - count('new')} not set`}
        info="Your grading of each Field Operator for shutdown teams. Tap a level to set it, tap it again to clear. Saved at once and kept in the audit history." />
      {saved && <p className="mb-2 flex items-center gap-1 text-sm text-status-green"><Check className="h-4 w-4" />{saved}</p>}
      {error ? <ErrorBox error={error} /> : !rows ? <Spinner /> : (
        <Card className="divide-y divide-slate-100 p-0">
          {fos.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2">
              {isCrew(r.crew_code) ? <CrewBadge crew={r.crew_code} size="sm" /> : <span className="h-6 w-6" />}
              <span className="min-w-0 flex-1"><Link to={`/employees/${r.id}`} className="block truncate text-sm font-medium text-slate-900">{r.display_name}</Link>
                <span className="block text-[11px] text-slate-500">#{r.employee_number} · Grade {r.grade ?? '—'}</span></span>
              <div className="flex shrink-0 rounded-lg ring-1 ring-slate-300">
                {LEVELS.map((l) => (
                  <button key={l} type="button" aria-pressed={r.fo_level === l} onClick={() => set(r, l)}
                    className={cx('min-h-9 px-2 text-[11px] font-semibold first:rounded-l-lg last:rounded-r-lg', r.fo_level === l ? TONE[l] : 'bg-white text-slate-600')}>{FO_LEVEL_LABEL[l]}</button>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
