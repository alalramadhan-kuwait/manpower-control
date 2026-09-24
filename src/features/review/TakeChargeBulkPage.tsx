import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { setQualificationBulk } from '@/data/bulk';
import { fetchDirectory } from '@/data/queries';
import type { EmployeeDirectoryRow, QualificationStatus, UserProfile } from '@/data/types';
import { Button, Card, Chip, ErrorBox, PageHeader, Spinner, cx, qualificationLabel, qualificationTone } from '@/ui/components';
import { CrewTag, crewEdge } from '@/ui/crew';

const CREWS = ['A', 'B', 'C', 'D'] as const;
const OPTIONS: { value: QualificationStatus; label: string; tone: 'green' | 'red' | 'amber' }[] = [
  { value: 'yes', label: 'Yes', tone: 'green' }, { value: 'no', label: 'No', tone: 'red' }, { value: 'not_yet_confirmed', label: 'Not yet', tone: 'amber' }
];

/** Bulk confirmation of Take-Charge for Field Operators. Nothing is written until Save; every change is its own audited record. */
export default function TakeChargeBulkPage({ profile }: { profile: UserProfile }) {
  const [rows, setRows] = useState<EmployeeDirectoryRow[] | null>(null);
  const [pending, setPending] = useState<Record<string, QualificationStatus>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const load = () => fetchDirectory().then((r) => { setRows(r); setPending({}); }).catch(setError);
  useEffect(() => { load(); }, []);

  const field = useMemo(() => (rows ?? []).filter((r) => r.in_unit12_scope && r.is_active && r.position_category === 'field'), [rows]);
  const changes = Object.entries(pending).filter(([id, v]) => field.find((r) => r.id === id)?.take_charge_status !== v);

  async function save() {
    setBusy(true); setError(null); setSaved(null);
    try {
      let n = 0;
      for (const status of ['yes', 'no', 'not_yet_confirmed'] as QualificationStatus[]) {
        const ids = changes.filter(([, v]) => v === status).map(([id]) => id);
        n += await setQualificationBulk(ids, 'take_charge', status, profile, note.trim() || `Confirmed by ${profile.display_name} (bulk edit)`);
      }
      setSaved(n); await load();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  if (error && !rows) return <ErrorBox error={error} />;
  if (!rows) return <Spinner />;
  const unconfirmed = field.filter((r) => r.take_charge_status !== 'yes' && r.take_charge_status !== 'no').length;

  return (
    <div className="pb-24">
      <Link to="/review" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-700"><ArrowLeft className="h-4 w-4" /> Data Quality Review</Link>
      <PageHeader title="Take-Charge confirmation" subtitle={`${field.length} Field Operators · ${unconfirmed} not yet confirmed. Only Take-Charge = Yes will count toward the Field minimum of 6.`} />
      <Card className="mb-3">
        <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Note for this confirmation (optional)</label>
        <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed against Section Head list, Sep 2026" />
        <p className="mt-2 text-xs text-slate-500">Each change is stored as a new dated qualification record with your name; the previous record is closed, not deleted.</p>
      </Card>
      {CREWS.map((crew) => {
        const list = field.filter((r) => r.crew_code === crew);
        if (list.length === 0) return null;
        return (
          <Card key={crew} className={`mb-3 p-0 ${crewEdge(crew)}`}>
            <div className="flex items-center justify-between px-4 py-2"><span className="font-semibold text-slate-900"><CrewTag crew={crew} /></span><span className="text-xs text-slate-500">{list.length} field operators</span></div>
            <ul className="divide-y divide-slate-100">
              {list.map((r) => {
                const value = pending[r.id] ?? (r.take_charge_status ?? 'not_yet_confirmed');
                const changed = pending[r.id] !== undefined && pending[r.id] !== r.take_charge_status;
                return (
                  <li key={r.id} className={cx('flex items-center gap-2 px-3 py-2.5', changed && 'bg-brand-50/60')}>
                    <div className="min-w-0 flex-1">
                      <Link to={`/employees/${r.id}`} className="block truncate text-sm font-medium text-slate-800">{r.display_name}</Link>
                      <div className="truncate text-[11px] text-slate-500">#{r.employee_number}{r.grade ? ` · Grade ${r.grade}` : ''}{r.employment_type === 'contractor' ? ' · Contractor' : ''} · now: <Chip tone={qualificationTone(r.take_charge_status)} className="px-1.5 py-0">{qualificationLabel(r.take_charge_status)}</Chip></div>
                    </div>
                    <div className="flex shrink-0 rounded-lg ring-1 ring-slate-300" role="radiogroup" aria-label={`Take-Charge for ${r.display_name}`}>
                      {OPTIONS.map((o) => (
                        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => setPending((p) => ({ ...p, [r.id]: o.value }))}
                          className={cx('min-h-10 px-2.5 text-xs font-medium first:rounded-l-lg last:rounded-r-lg', value === o.value ? (o.tone === 'green' ? 'bg-green-600 text-white' : o.tone === 'red' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white') : 'bg-white text-slate-600')}>{o.label}</button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-30 mx-auto max-w-5xl px-4 lg:max-w-7xl sm:bottom-4 sm:pl-48">
        <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-slate-200">
          <div className="flex-1 text-sm">{changes.length === 0 ? <span className="text-slate-500">No changes yet</span> : <span className="font-medium text-brand-800">{changes.length} change{changes.length === 1 ? '' : 's'} ready</span>}{saved !== null && changes.length === 0 && <span className="ml-2 text-status-green"><Check className="inline h-4 w-4" /> Saved {saved}</span>}</div>
          {changes.length > 0 && <Button variant="secondary" className="min-h-10" onClick={() => setPending({})}>Discard</Button>}
          <Button className="min-h-10" disabled={busy || changes.length === 0} onClick={save}>{busy ? 'Saving…' : `Save ${changes.length || ''}`}</Button>
        </div>
        {error ? <div className="mt-2"><ErrorBox error={error} /></div> : null}
      </div>
    </div>
  );
}
