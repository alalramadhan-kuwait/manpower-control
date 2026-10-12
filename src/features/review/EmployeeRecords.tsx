import { ArrowLeft, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchDirectory } from '@/data/queries';
import type { EmployeeDirectoryRow, UserProfile } from '@/data/types';
import { t } from '@/i18n';
import { ErrorBox, Spinner } from '@/ui/components';
import { nameFilter } from '@/ui/nameSearch';
import EmployeeProfilePage from '@/features/employees/EmployeeProfilePage';

/** Data quality → Employee records: the one place to correct master data, role / crew and qualifications (audited). */
export function EmployeeRecords({ profile }: { profile: UserProfile }) {
  const [params, setParams] = useSearchParams();
  const emp = params.get('emp');
  const [dir, setDir] = useState<EmployeeDirectoryRow[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState('');
  useEffect(() => { fetchDirectory().then((d) => setDir(d.filter((x) => x.in_unit12_scope))).catch(setErr); }, []);
  const go = (id: string | null) => { const n = new URLSearchParams(params); if (id) n.set('emp', id); else n.delete('emp'); setParams(n, { replace: true }); };
  if (err) return <ErrorBox error={err} />;
  if (emp) return (
    <div>
      <button type="button" onClick={() => go(null)} className="mb-3 inline-flex min-h-10 items-center gap-1 text-sm text-brand-700"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('All employee records')}</button>
      <EmployeeProfilePage key={emp} profile={profile} editId={emp} />
    </div>
  );
  if (!dir) return <Spinner />;
  const match = nameFilter(q);
  const list = dir.filter((d) => match([d.display_name, d.official_name, d.employee_number])).sort((a, b) => a.display_name.localeCompare(b.display_name));
  return (
    <div className="lg:max-w-3xl">
      <p className="mb-2 text-sm text-slate-600">{t('Correct master data, role / crew and qualifications here. Every change is kept in the audit history with before and after.')}</p>
      <label className="mb-2 flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 ring-1 ring-slate-200">
        <Search className="h-4 w-4 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Name or number')} className="w-full bg-transparent text-sm outline-none" />
        {q && <button type="button" onClick={() => setQ('')} aria-label={t('Clear')}><X className="h-4 w-4 text-slate-400" /></button>}
      </label>
      <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
        {list.map((d) => (
          <li key={d.id}><button type="button" onClick={() => go(d.id)} className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm">
            <span><span className="block font-medium text-slate-800">{d.display_name}</span><span className="block text-xs text-slate-500">#{d.employee_number} · {d.position_label ?? '—'}{d.crew_code ? ` · ${d.crew_code}` : ''}</span></span>
            {!d.is_active && <span className="text-xs text-red-600">{t('Inactive')}</span>}
          </button></li>
        ))}
      </ul>
    </div>
  );
}
