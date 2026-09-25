import { FileUp, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { detectImportType, openWorkbook, parseWorkbook, planManpowerImport, planPromotionImport } from '@/core/import';
import type { ImportPlan, ParsedWorkbook } from '@/core/import';
import { commitPlan, fetchExistingForPlanning } from '@/data/queries';
import type { UserProfile } from '@/data/types';
import { Button, Card, Chip, ErrorBox, PageHeader, Spinner } from '@/ui/components';
import { PlanPreview } from './PlanPreview';

type Step = { kind: 'idle' } | { kind: 'parsing'; name: string } | { kind: 'preview'; plan: ImportPlan; parsed: ParsedWorkbook; detection: string } | { kind: 'committing' } | { kind: 'done'; batchId: string; counts: Record<string, number> };

const STEPS = ['Upload', 'Parse', 'Identify', 'Match by Employee No.', 'Validate', 'Preview', 'Confirm', 'Update database'];

export default function ImportCenterPage({ profile }: { profile: UserProfile }) {
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<unknown>(null);

  async function onFile(file: File) {
    setError(null); setStep({ kind: 'parsing', name: file.name });
    try {
      const buf = await file.arrayBuffer();
      const wb = openWorkbook(buf);
      const det = detectImportType(wb);
      if (!det.importType) throw new Error(`This workbook is not recognised. ${det.reason}. Expected the U-12 manpower workbook (PV Scheduled + monthly sheets) or the KNPC promotion list.`);
      const parsed = parseWorkbook(wb, file.name);
      const year = parsed.kind === 'u12_manpower_workbook' ? parsed.year : Number((parsed.asOfDate ?? new Date().toISOString()).slice(0, 4));
      const existing = await fetchExistingForPlanning(year);
      const plan = parsed.kind === 'u12_manpower_workbook'
        ? planManpowerImport(parsed, existing.employees, existing.leaves, file.name)
        : planPromotionImport(parsed, existing.employees, file.name);
      setStep({ kind: 'preview', plan, parsed, detection: det.reason });
    } catch (e) { setError(e); setStep({ kind: 'idle' }); }
  }

  async function confirm(plan: ImportPlan) {
    setError(null); setStep({ kind: 'committing' });
    try {
      const res = await commitPlan(plan, { id: profile.auth_user_id, label: profile.display_name });
      setStep({ kind: 'done', batchId: res.batchId, counts: res.counts });
    } catch (e) { setError(e); setStep({ kind: 'idle' }); }
  }

  return (
    <div>
      <PageHeader title="Excel import" info="The workbook is an input. Nothing is written until you confirm the preview." action={<Link to="/imports/history" className="text-sm text-brand-700">History</Link>} />
      <ol className="mb-4 flex flex-wrap gap-1 text-[11px] text-slate-500">
        {STEPS.map((s, i) => <li key={s} className="rounded-full bg-slate-100 px-2 py-0.5">{i + 1}. {s}</li>)}
      </ol>

      {step.kind === 'idle' && (
        <Card>
          <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-100 bg-brand-50/40 p-6 text-center">
            <FileUp className="h-8 w-8 text-brand-700" />
            <span className="font-medium text-brand-800">Choose an Excel file</span>
            <span className="text-xs text-slate-500">ARD's U-12 Manpower workbook (.xlsx) or Promotion list (.xlsm/.xlsx)</span>
            <input type="file" accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ''; }} />
          </label>
          <ul className="mt-4 space-y-1.5 text-xs text-slate-600">
            <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-brand-700" /> Employees are matched by <strong>Employee Number only</strong>. Names are never used to match.</li>
            <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-brand-700" /> Rows outside the Unit-12 Section 1 population are counted as ignored and never written.</li>
            <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-brand-700" /> Leave types are only imported where the source proves them; unclear absences are flagged for review.</li>
            <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-brand-700" /> Every imported record keeps its workbook, sheet and cell reference.</li>
          </ul>
          {error ? <div className="mt-3"><ErrorBox error={error} /></div> : null}
        </Card>
      )}

      {step.kind === 'parsing' && <Spinner label={`Parsing ${step.name} and matching against the database…`} />}
      {step.kind === 'committing' && <Spinner label="Writing the import batch and updating the database…" />}

      {step.kind === 'preview' && (
        <PlanPreview plan={step.plan} detection={step.detection} onCancel={() => setStep({ kind: 'idle' })} onConfirm={() => confirm(step.plan)} />
      )}

      {step.kind === 'done' && (
        <Card>
          <div className="mb-2 flex items-center gap-2"><Chip tone="green">Committed</Chip><span className="text-sm text-slate-600">Import batch recorded.</span></div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {[['new', 'New'], ['changed', 'Changed'], ['matched', 'Matched'], ['unmatched', 'Unmatched'], ['ignored', 'Ignored'], ['review', 'To review']].map(([k, l]) => (
              <div key={k} className="rounded-xl bg-slate-50 p-2"><div className="text-lg font-semibold tabular-nums text-brand-800">{step.counts[k] ?? 0}</div><div className="text-xs text-slate-500">{l}</div></div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setStep({ kind: 'idle' })}>Import another file</Button>
            <Link to={`/imports/${step.batchId}`} className="flex-1"><Button className="w-full">Open batch</Button></Link>
          </div>
          {(step.counts.review ?? 0) > 0 && <p className="mt-3 text-xs text-slate-600">Some rows need a decision. Open <Link className="text-brand-700 underline" to="/review">Data Quality Review</Link>.</p>}
        </Card>
      )}
    </div>
  );
}
