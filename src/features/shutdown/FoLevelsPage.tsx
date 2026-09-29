import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FO_LEVEL_LABEL, sdOperatorEligible, type FoLevel } from '@/core/shutdown';
import { fetchDirectory } from '@/data/queries';
import { setFoLevel } from '@/data/shutdown';
import type { EmployeeDirectoryRow } from '@/data/types';
import { Card, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';
import { CrewBadge, isCrew } from '@/ui/crew';

const LEVELS: FoLevel[] = ['senior', 'good', 'new', 'below'];
const TONE: Record<FoLevel, string> = { senior: 'bg-brand-700 text-white', good: 'bg-green-600 text-white', new: 'bg-amber-500 text-white', below: 'bg-red-600 text-white' };

/** Mark each Field Operator, and each Panel Operator who can work on a shutdown team, Senior / Good / New. Saved on tap; kept in the audit history. */
export default function FoLevelsPage() {
  const [rows, setRows] = useState<EmployeeDirectoryRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { fetchDirectory().then(setRows).catch(setError); }, []);
  const byCrew = (a: EmployeeDirectoryRow, b: EmployeeDirectoryRow) => (a.crew_code ?? 'Z').localeCompare(b.crew_code ?? 'Z') || (b.grade ?? 0) - (a.grade ?? 0) || a.display_name.localeCompare(b.display_name);
  const live = useMemo(() => (rows ?? []).filter((r) => r.is_active && r.in_unit12_scope), [rows]);
  const fieldOps = useMemo(() => live.filter((r) => r.position_code === 'field_operator').sort(byCrew), [live]);
  // Panel Operators who can work on a shutdown team (Grade 13 and below, contractors) or were cleared to cover Field
  const panelOps = useMemo(() => live.filter((r) => r.position_code === 'panel_operator'
    && (r.can_cover_field === true || sdOperatorEligible({ role: 'panel_operator', grade: r.grade, employmentType: r.employment_type }))).sort(byCrew), [live]);
  const fos = useMemo(() => [...fieldOps, ...panelOps], [fieldOps, panelOps]);
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
      <PageHeader title="FO levels" subtitle={`${count('senior')} Senior · ${count('good')} Good · ${count('new')} New · ${count('below')} Below · ${fos.length - LEVELS.reduce((n, l) => n + count(l), 0)} not set`}
        info="Your grading of each Field Operator, and of the Panel Operators who can work on a shutdown team (Grade 13 and below, and contractors), for shutdown teams. Below = below average: ranked after everyone else when a shutdown team is picked. Tap a level to set it, tap it again to clear. Saved at once and kept in the audit history." />
      {saved && <p className="mb-2 flex items-center gap-1 text-sm text-status-green"><Check className="h-4 w-4" />{saved}</p>}
      {error ? <ErrorBox error={error} /> : !rows ? <Spinner /> : (
        <div className="space-y-4">
          {[{ title: 'Field Operators', list: fieldOps }, { title: 'Panel Operators · can work on a shutdown team', list: panelOps }].filter((g) => g.list.length > 0).map((g) => (
            <section key={g.title}>
              <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title} ({g.list.length})</h2>
              <Card className="divide-y divide-slate-100 p-0">
                {g.list.map((r) => (
                  <div key={r.id} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {isCrew(r.crew_code) ? <CrewBadge crew={r.crew_code} size="sm" /> : <span className="h-6 w-6" />}
                      <span className="min-w-0 flex-1"><Link to={`/employees/${r.id}`} className="block text-sm font-medium text-slate-900">{r.display_name}</Link>
                        <span className="block text-[11px] leading-tight text-slate-500">#{r.employee_number} · {r.employment_type === 'contractor' ? 'Contractor' : `Grade ${r.grade ?? '—'}`}{r.position_code === 'panel_operator' && r.can_cover_field ? ' · covers Field' : ''}</span></span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-4 rounded-lg ring-1 ring-slate-300">
                      {LEVELS.map((l) => (
                        <button key={l} type="button" aria-pressed={r.fo_level === l} onClick={() => set(r, l)}
                          className={cx('min-h-9 text-xs font-semibold first:rounded-l-lg last:rounded-r-lg', r.fo_level === l ? TONE[l] : 'bg-white text-slate-600')}>{FO_LEVEL_LABEL[l]}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
