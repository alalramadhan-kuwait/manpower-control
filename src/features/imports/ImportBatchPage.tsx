import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchBatch } from '@/data/queries';
import type { ImportBatch, ImportRowRecord } from '@/data/types';
import { Card, Chip, ErrorBox, PageHeader, Row, Spinner, fmtDate } from '@/ui/components';
import { RowBrowser } from './PlanPreview';
import { TYPE_LABEL } from './ImportHistoryPage';
import type { StagedRow } from '@/core/import';

export default function ImportBatchPage() {
  const { batchId } = useParams();
  const [data, setData] = useState<{ batch: ImportBatch; rows: ImportRowRecord[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (batchId) fetchBatch(batchId).then(setData).catch(setError); }, [batchId]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const { batch: b, rows } = data;
  const staged: StagedRow[] = rows.map((r) => ({ seq: r.seq, sheet: r.sheet, row_ref: r.row_ref, entity_kind: r.entity_kind as StagedRow['entity_kind'], employee_number: r.employee_number, matched_employee_id: r.matched_employee_id, outcome: r.outcome as StagedRow['outcome'], needs_review: r.needs_review, raw: r.raw, payload: r.payload, diff: r.diff, message: r.message }));
  return (
    <div>
      <Link to="/imports/history" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-700"><ArrowLeft className="h-4 w-4" /> Import History</Link>
      <PageHeader title={b.file_name} subtitle={TYPE_LABEL[b.import_type]} action={<Chip tone={b.status === 'committed' ? 'green' : b.status === 'aborted' ? 'red' : 'amber'}>{b.status}</Chip>} />
      <Card className="mb-3">
        <Row label="Imported" value={new Date(b.created_at).toLocaleString('en-GB')} />
        <Row label="By" value={b.imported_by_label} />
        {b.source_as_of_date && <Row label="Source as of" value={fmtDate(b.source_as_of_date)} />}
        {b.period_start && <Row label="Period" value={`${fmtDate(b.period_start)} → ${fmtDate(b.period_end)}`} />}
        <Row label="Committed" value={b.committed_at ? new Date(b.committed_at).toLocaleString('en-GB') : 'not committed'} />
        <div className="mt-2 grid grid-cols-4 gap-2 text-center">
          {[['Read', b.records_read], ['Matched', b.records_matched], ['Changed', b.records_changed], ['New', b.records_new], ['Unmatched', b.records_unmatched], ['Ignored', b.records_ignored], ['Review', b.records_review], ['Errors', b.records_error]].map(([l, v]) => (
            <div key={String(l)} className="rounded-xl bg-slate-50 p-2"><div className="text-base font-semibold tabular-nums text-brand-800">{v}</div><div className="text-[11px] text-slate-500">{l}</div></div>
          ))}
        </div>
        {Array.isArray(b.errors) && b.errors.length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer text-amber-800">{b.errors.length} warning(s)</summary><ul className="mt-1 list-disc pl-5 text-slate-600">{b.errors.map((e, i) => <li key={i}>{String(e)}</li>)}</ul></details>}
      </Card>
      <RowBrowser rows={staged} initial="review" />
    </div>
  );
}
