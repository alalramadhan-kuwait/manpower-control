// Step 7 · Share / export the final plan: read from the leave records as they are now (so changes made later in the
// Calendar show, marked *), grouped by the approved manpower. Complete plan, Controllers, Panel, Field A–D; preview,
// PDF, the device's share sheet where it can share files, or Export all.
import { Download, Eye, Share2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CREWS, type Crew } from '@/core/roster';
import { cycleCrewOf, isControllerGroup } from '@/core/vacation';
import { fetchPublished, type PublishedLeave } from '@/data/vacation';
import { ErrorBox, Spinner } from '@/ui/components';
import { canShareFiles, download, shareOrDownload } from './files';
import { finalPdf, mergePdfs, type FinalDoc, type FinalGroup } from './pdf';
import { PdfPreview } from './PdfPreview';
import { stamp } from './parts';
import type { StepProps } from './VacationPlanPage';

export default function ShareStep({ d, ev, toast }: StepProps) {
  const [leave, setLeave] = useState<PublishedLeave[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [preview, setPreview] = useState<{ doc: FinalDoc; make: () => Promise<Uint8Array> } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchPublished(d.year).then(setLeave).catch(setErr); }, [d.year]);
  const docs = useMemo(() => {
    if (!leave || !d.plan) return [];
    const live = leave.filter((l) => l.inCurrentPlan && (l.status === 'approved' || l.status === 'planned'));
    const byId = new Map(d.people.map((p) => [p.id, p]));
    const periods = (id: string) => live.filter((l) => l.employeeId === id).map((l) => ({ start: l.start, end: l.end, system: (l.sourceRef ?? '').endsWith(':system'),
      changed: !l.inOriginalPlan || !(l.sourceRef ?? '').startsWith(`pv_plan:${d.plan!.id}:`) }));
    const person = (id: string, crew: Crew, detail: string) => { const p = byId.get(id)!; return { employeeId: id, name: p.name, number: p.number, detail, crew, periods: periods(id) }; };
    const placed = [...ev.placed.values()];
    const ctl: FinalGroup[] = CREWS.map((c) => ({ title: `Controllers / Supervisors · ${c} Shift rota`, crew: c, people: placed.filter(({ row }) => isControllerGroup(row) && cycleCrewOf(row) === c)
      .map(({ row }) => person(row.employeeId, c, row.group === 'relief' ? (row.relief === 'vr' ? 'VR' : 'Day Sup.') : 'Controller')) })).filter((g) => g.people.length);
    const panel: FinalGroup[] = CREWS.map((c) => ({ title: `Panel Operators · ${c} Shift`, crew: c, people: [...ev.crews[c].panel, ...ev.crews[c].acting].map((p) => person(p.id, c, ev.crews[c].acting.includes(p) ? 'Acting' : p.employmentType === 'contractor' ? 'Contractor' : 'Panel')) }))
      .concat(CREWS.map((c) => ({ title: `Floating Panel relief · ${c} rota`, crew: c, people: placed.filter(({ row }) => row.group === 'relief' && row.relief === 'float_panel' && row.cycleCrew === c).map(({ row }) => person(row.employeeId, c, 'Float')) })))
      .filter((g) => g.people.length);
    const field = (c: Crew): FinalGroup[] => [{ title: `Field Operators · ${c} Shift`, crew: c, people: [...ev.crews[c].field.map((p) => person(p.id, c, p.employmentType === 'contractor' ? 'Contractor' : 'Field')),
      ...placed.filter(({ row }) => row.group === 'relief' && row.relief === 'day_duty' && row.cycleCrew === c).map(({ row }) => person(row.employeeId, c, 'Day duty'))] }];
    const base = { year: d.year, version: `Plan v${d.plan.version} · manpower v${d.alloc?.version ?? '—'}`, approved: d.plan.publishedAt ? stamp(d.plan.publishedAt) : '—' };
    const one = (title: string, groups: FinalGroup[], file: string) => ({ file, doc: { ...base, title, groups } as FinalDoc });
    return [one(`Vacation Plan ${d.year} · Complete`, [...ctl, ...panel, ...CREWS.flatMap(field)], `Vacation-Plan-${d.year}-complete.pdf`),
      one(`Vacation Plan ${d.year} · Controllers / Supervisors`, ctl, `Vacation-Plan-${d.year}-controllers.pdf`),
      one(`Vacation Plan ${d.year} · Panel Operators`, panel, `Vacation-Plan-${d.year}-panel.pdf`),
      ...CREWS.map((c) => one(`Vacation Plan ${d.year} · Field ${c} Shift`, field(c), `Vacation-Plan-${d.year}-field-${c}.pdf`))];
  }, [leave, d, ev]);
  if (d.plan?.status !== 'published') return <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">The final plan is shared after the Section Head approves it.</p>;
  if (err) return <ErrorBox error={err} />;
  if (!leave) return <Spinner />;
  const changed = leave.filter((l) => l.inCurrentPlan && (!l.inOriginalPlan || !(l.sourceRef ?? '').startsWith(`pv_plan:${d.plan!.id}:`))).length;
  async function act(i: number, how: 'pdf' | 'share') {
    setBusy(true); setErr(null);
    try { const bytes = await finalPdf(docs[i].doc);
      if (how === 'pdf') download(bytes, docs[i].file); else { const shared = await shareOrDownload(bytes, docs[i].file, docs[i].doc.title); if (!shared) toast('Downloaded: forward the file to the supervisors.'); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-600">From the Calendar's leave records now{changed ? ` · ${changed} changed after approval (marked *)` : ''}. A3 landscape.</p>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {docs.map((x, i) => (
          <li key={x.file} className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-1.5">
            <span className="min-w-0 flex-1"><b className="block text-[13px]">{x.doc.title.replace(`Vacation Plan ${d.year} · `, '')}</b><span className="text-[11px] text-slate-500">{x.doc.groups.reduce((n, g) => n + g.people.length, 0)} people<span className="hidden sm:inline"> · {x.file}</span></span></span>
            <button type="button" onClick={() => setPreview({ doc: x.doc, make: () => finalPdf(x.doc) })} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-700 ring-1 ring-slate-200"><Eye className="h-3.5 w-3.5" />Preview</button>
            <button type="button" disabled={busy} onClick={() => act(i, 'pdf')} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-700 ring-1 ring-slate-200"><Download className="h-3.5 w-3.5" />PDF</button>
            {canShareFiles() && <button type="button" disabled={busy} onClick={() => act(i, 'share')} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-700 ring-1 ring-slate-200"><Share2 className="h-3.5 w-3.5" />Share</button>}
          </li>
        ))}
      </ul>
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { download(await mergePdfs(await Promise.all(docs.slice(1).map((x) => finalPdf(x.doc)))), `Vacation-Plan-${d.year}-all.pdf`); } catch (e) { setErr(e); } finally { setBusy(false); } }}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white"><Download className="h-4 w-4" />Export all</button>
      {preview && <PdfPreview title={preview.doc.title} make={preview.make} onClose={() => setPreview(null)} />}
    </div>
  );
}
