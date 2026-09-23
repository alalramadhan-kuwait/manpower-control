import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBatches } from '@/data/queries';
import type { ImportBatch } from '@/data/types';
import { Card, Chip, EmptyState, ErrorBox, PageHeader, Spinner, fmtDate } from '@/ui/components';

export const TYPE_LABEL: Record<string, string> = { u12_manpower_workbook: 'U-12 manpower workbook', promotion_master: 'Promotion master', contractors: 'Contractors' };

export default function ImportHistoryPage() {
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { fetchBatches().then(setBatches).catch(setError); }, []);
  if (error) return <ErrorBox error={error} />;
  return (
    <div>
      <Link to="/imports" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-700"><ArrowLeft className="h-4 w-4" /> Import Center</Link>
      <PageHeader title="Import History" subtitle="Every upload, whether it was committed or not." />
      {!batches ? <Spinner /> : batches.length === 0 ? <EmptyState title="No imports yet" /> : (
        <ul className="space-y-2">
          {batches.map((b) => (
            <li key={b.id}>
              <Card to={`/imports/${b.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-slate-800">{b.file_name}</span>
                  <Chip tone={b.status === 'committed' ? 'green' : b.status === 'aborted' ? 'red' : 'amber'}>{b.status}</Chip>
                </div>
                <div className="mt-1 text-xs text-slate-500">{TYPE_LABEL[b.import_type]} · {new Date(b.created_at).toLocaleString('en-GB')} · by {b.imported_by_label ?? '—'}{b.source_as_of_date ? ` · source as of ${fmtDate(b.source_as_of_date)}` : ''}{b.period_start ? ` · ${fmtDate(b.period_start)} → ${fmtDate(b.period_end)}` : ''}</div>
                <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-slate-600">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{b.records_read} read</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{b.records_matched} matched</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{b.records_changed} changed</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{b.records_new} new</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{b.records_unmatched} unmatched</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{b.records_ignored} ignored</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{b.records_review} review</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{b.records_error} errors</span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
