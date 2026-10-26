// Step 3 · Generate A3 forms: Controllers (all, one form), Panel Operators (all shifts, one form), Field A–D (one each),
// built from the approved manpower version. Preview, export one, or export all in one file.
import { Download, Eye, FileText } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { yearForms, type FormDoc } from '@/core/vacation';
import { Button, ErrorBox } from '@/ui/components';
import { download } from './files';
import { PdfPreview } from './PdfPreview';
import { formPdf, mergePdfs } from './pdf';
import { dm, StatusChip } from './parts';
import { restrictedFor } from './restricted';
import type { StepProps } from './VacationPlanPage';

export default function FormsStep({ d, ev, go }: StepProps) {
  const [preview, setPreview] = useState<FormDoc | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const approved = d.alloc?.status === 'approved';
  const forms = useMemo(() => (approved ? yearForms({ year: d.year, version: d.alloc!.version, approvedOn: d.alloc!.approvedAt ? dm(d.alloc!.approvedAt.slice(0, 10)) + ' ' + d.alloc!.approvedAt.slice(0, 4) : null,
    people: d.people, ev, restricted: restrictedFor(d) }) : []), [approved, d, ev]);
  const make = useCallback((f: FormDoc) => () => formPdf(f), []);
  if (!approved) return <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">The forms come from the approved manpower allocation. <button type="button" onClick={() => go(2)} className="font-semibold underline">Approve manpower ›</button></p>;
  const people = (f: FormDoc) => new Set(f.pages.flatMap((p) => p.sections.flatMap((s) => s.rows.map((r) => r.employeeId)))).size;
  async function exportOne(f: FormDoc) { setBusy(true); setErr(null); try { download(await formPdf(f), f.file); } catch (e) { setErr(e); } finally { setBusy(false); } }
  async function exportAll() { setBusy(true); setErr(null); try { download(await mergePdfs(await Promise.all(forms.map((f) => formPdf(f)))), `PV${String(d.year).slice(2)}-all-forms-v${d.alloc!.version}.pdf`); } catch (e) { setErr(e); } finally { setBusy(false); } }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <StatusChip level="ok" label={`Manpower v${d.alloc!.version}`} />
        <span>A3 landscape · whole cycles on the shift rota dates · {d.shutdowns.length ? 'confirmed shutdown dates greyed' : 'no confirmed shutdown in ' + d.year}</span>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {forms.map((f) => (
          <li key={f.file} className="flex min-h-12 items-center gap-2 px-3 py-1.5">
            <FileText className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1"><b className="block text-[13px]">{f.title.replace(`Vacation Plan ${d.year} · `, '')}</b><span className="text-[11px] text-slate-500">{f.file} · {people(f)} people · {f.pages.length} pages</span></span>
            <button type="button" aria-label={`Preview ${f.file}`} onClick={() => setPreview(f)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-700 ring-1 ring-slate-200"><Eye className="h-3.5 w-3.5" />Preview</button>
            <button type="button" aria-label={`Export ${f.file}`} disabled={busy} onClick={() => exportOne(f)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-700 ring-1 ring-slate-200"><Download className="h-3.5 w-3.5" />PDF</button>
          </li>
        ))}
      </ul>
      {err != null && <ErrorBox error={err} />}
      <Button className="min-h-11 w-full sm:w-auto" disabled={busy} onClick={exportAll}><Download className="h-4 w-4" />Export all ({forms.length} forms, one PDF)</Button>
      <p className="text-[11px] text-slate-500">Print at 100 % on A3. Keep the corner squares and the strip at the bottom clear: they let the app read a scan or photo of the completed form (Step 4).</p>
      {preview && <PdfPreview title={preview.title} make={make(preview)} onClose={() => setPreview(null)} />}
    </div>
  );
}
