// Method 2 · Upload completed forms (scanned PDF or a clear photo). The file is kept privately (manpower staff only),
// each page is read in the browser against the printed layout, and everything comes back to one review: clear marks
// are ticked, unclear boxes must be decided by you, and nothing is saved until you press Save. Every saved cycle is
// checked like a hand entry; a cycle that breaks a rule is not saved and is listed with its reason.
import { Camera, FileUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { blocksFromPicks, cellInfo, cyclesFor, prepare, readPage, runsOf, toGray, type Block, type FormDoc, type ReadPage } from '@/core/vacation';
import { downloadUpload, planCtx, saveBlocks, updateUpload, uploadForm, type VacationData } from '@/data/vacation';
import { Button, ErrorBox, Spinner, cx } from '@/ui/components';
import { dm, stamp, StatusChip } from './parts';

type Decision = 'yes' | 'no' | null;
interface PageResult { uploadId: string; fileName: string; pageNo: number; read: ReadPage | { ok: false; reason: string } }

async function rasterise(file: File): Promise<HTMLCanvasElement[]> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const { renderPdf } = await import('./pdfRender');
    return renderPdf(await file.arrayBuffer(), 1.8);
  }
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return [c];
}

export function UploadPanel({ d, forms, editable, toast, refreshPlan }: { d: VacationData; forms: FormDoc[]; editable: boolean; toast: (m: string) => void; refreshPlan: () => Promise<void> }) {
  const [results, setResults] = useState<PageResult[]>([]);
  const [decide, setDecide] = useState<Map<string, Decision>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [summary, setSummary] = useState<null | { people: number; missing: number; conflicts: { name: string; cycle: number; reason: string }[]; unclear: number; periods: number; freePanel: number; freeField: number }>(null);
  const byId = useMemo(() => new Map(d.people.map((p) => [p.id, p])), [d.people]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setErr(null); setSummary(null);
    const out: PageResult[] = [];
    try {
      for (const f of [...files]) {
        setBusy(`Saving ${f.name}…`);
        const up = await uploadForm(d.year, f);
        setBusy(`Reading ${f.name}…`);
        const pages = await rasterise(f);
        for (const [i, c] of pages.entries()) {
          await new Promise((r) => setTimeout(r, 0));
          const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
          out.push({ uploadId: up.id, fileName: f.name, pageNo: i + 1, read: readPage(toGray(img.data, c.width, c.height), forms) });
        }
        const mine = out.filter((r) => r.uploadId === up.id);
        await updateUpload(up.id, 'read', mine.find((r) => r.read.ok) ? (mine.find((r) => r.read.ok)!.read as ReadPage).doc.file.replace('.pdf', '') : null,
          { pages: mine.map((r) => (r.read.ok ? { page: r.read.page, marked: r.read.cells.filter((x) => x.state === 'marked').length, unclear: r.read.cells.filter((x) => x.state === 'unclear').length } : { error: r.read.reason })) });
      }
      const dec = new Map(decide);
      for (const r of out) if (r.read.ok) for (const c of r.read.cells) { const k = `${r.uploadId}|${r.read.page}|${c.employeeId}|${c.cycle}`; dec.set(k, c.state === 'marked' ? 'yes' : c.state === 'empty' ? 'no' : null); }
      setDecide(dec); setResults((x) => [...x, ...out]);
      await refreshPlan();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }
  const ok = results.filter((r): r is PageResult & { read: ReadPage } => r.read.ok);
  const unclearLeft = ok.reduce((n, r) => n + r.read.cells.filter((c) => decide.get(`${r.uploadId}|${r.read.page}|${c.employeeId}|${c.cycle}`) === null).length, 0);

  async function save() {
    setBusy('Checking and saving…'); setErr(null);
    try {
      let blocks: Block[] = [...d.blocks];
      const conflicts: { name: string; cycle: number; reason: string }[] = [];
      const touched = new Set<string>();
      for (const r of ok) {
        const pageCycles = new Map<string, Set<number>>();
        for (const c of r.read.cells) { const s = pageCycles.get(c.employeeId) ?? new Set<number>(); s.add(c.cycle); pageCycles.set(c.employeeId, s); }
        for (const [emp, cycles] of pageCycles) {
          const pr0 = prepare(planCtx(d, blocks));
          const keep = new Set([...(pr0.picks.get(emp) ?? [])].filter((i) => !cycles.has(i)));
          const want = [...cycles].filter((i) => decide.get(`${r.uploadId}|${r.read.page}|${emp}|${i}`) === 'yes').sort((a, b) => a - b);
          // start from the cycles outside this page, then add the page's marks one by one with every check
          let cur = blocksFromPicks(cyclesFor(pr0, emp), emp, keep, blocks, 'form');
          blocks = [...blocks.filter((b) => b.employeeId !== emp), ...cur];
          for (const i of want) {
            const pr = prepare(planCtx(d, blocks));
            const info = cellInfo(pr, emp, i);
            if (info.state !== 'available' && info.state !== 'selected') { conflicts.push({ name: byId.get(emp)?.name ?? 'Employee', cycle: i, reason: info.reason ?? info.state }); continue; }
            const picks = new Set(pr.picks.get(emp) ?? []); picks.add(i);
            cur = blocksFromPicks(cyclesFor(pr, emp), emp, picks, blocks, 'form');
            blocks = [...blocks.filter((b) => b.employeeId !== emp), ...cur];
          }
          touched.add(emp);
        }
      }
      for (const emp of touched) await saveBlocks(d.year, emp, blocks.filter((b) => b.employeeId === emp), ok.find((r) => r.read.cells.some((c) => c.employeeId === emp))?.uploadId);
      for (const id of new Set(ok.map((r) => r.uploadId))) await updateUpload(id, 'committed', null, null);
      await refreshPlan();
      const pr = prepare(planCtx({ ...d, blocks }, blocks));
      const people = [...touched];
      setSummary({ people: people.length, missing: people.filter((e) => !(pr.picks.get(e)?.size)).length, conflicts, unclear: 0,
        periods: people.reduce((n, e) => n + runsOf(pr.picks.get(e) ?? []).length, 0), freePanel: 0, freeField: 0 });
      setResults([]); setDecide(new Map());
      toast(`Selections saved for ${people.length} people${conflicts.length ? ` · ${conflicts.length} not saved (see list)` : ''}.`);
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }
  const key = (r: PageResult & { read: ReadPage }, emp: string, c: number) => `${r.uploadId}|${r.read.page}|${emp}|${c}`;
  return (
    <div className="space-y-2">
      {editable && (
        <label className={cx('flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-3 text-sm font-semibold text-brand-700', busy && 'pointer-events-none opacity-60')}>
          <FileUp className="h-5 w-5" /><Camera className="h-5 w-5" />Scanned PDF or photos of the completed forms
          <input type="file" multiple accept="application/pdf,image/*" className="sr-only" onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
        </label>
      )}
      <p className="text-[11px] text-slate-500">Only forms printed from this plan can be read: the corner squares and the strip at the bottom must be in the picture. Clear crosses are ticked for you; anything unclear is left for you to decide. Files are kept privately for the manpower staff.</p>
      {busy && <Spinner label={busy} />}
      {err != null && <ErrorBox error={err} />}
      {results.filter((r) => !r.read.ok).map((r) => <p key={`${r.uploadId}${r.pageNo}`} className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-900"><b>{r.fileName} · page {r.pageNo}:</b> {(r.read as { reason: string }).reason} Enter this page by hand.</p>)}
      {ok.map((r) => {
        const rows = r.read.doc.pages[r.read.page - 1].sections.flatMap((s) => s.rows);
        return (
          <section key={`${r.uploadId}${r.read.page}`} className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
            <p className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-[13px]"><b>{r.read.doc.title.replace(/^Vacation Plan \d+ · /, '')}</b><span className="text-xs text-slate-500">page {r.read.page}/{r.read.doc.pages.length} · {r.fileName}</span>
              <StatusChip level={r.read.cells.some((c) => decide.get(key(r, c.employeeId, c.cycle)) === null) ? 'warning' : 'ok'} label={`${r.read.cells.filter((c) => c.state === 'marked').length} marked · ${r.read.cells.filter((c) => c.state === 'unclear').length} unclear`} /></p>
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => {
                const cells = r.read.cells.filter((c) => c.employeeId === row.employeeId && c.state !== 'empty');
                const cyc = cyclesFor(prepare(planCtx(d)), row.employeeId);
                return (
                  <li key={row.employeeId} className="flex flex-wrap items-center gap-1.5 px-3 py-1.5">
                    <span className="w-full text-[12px] font-semibold text-slate-900 sm:w-48">{row.no}. {row.name}</span>
                    {cells.length ? cells.map((c) => { const k = key(r, c.employeeId, c.cycle); const v = decide.get(k) ?? null;
                      return <button key={k} type="button" disabled={!editable} onClick={() => setDecide((m) => new Map(m).set(k, v === 'yes' ? 'no' : 'yes'))}
                        className={cx('min-h-8 rounded-md px-2 text-[11px] font-bold ring-1', v === 'yes' ? 'bg-brand-700 text-white ring-brand-700' : v === 'no' ? 'bg-white text-slate-400 line-through ring-slate-200' : 'bg-amber-100 text-amber-900 ring-amber-400')}>
                        {v === null ? '? ' : v === 'yes' ? '✓ ' : ''}C{c.cycle + 1} {cyc[c.cycle] ? dm(cyc[c.cycle].start) : ''}</button>; })
                      : <span className="text-[11px] text-amber-800">No mark read</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {ok.length > 0 && editable && <Button className="min-h-11 w-full" disabled={!!busy || unclearLeft > 0} onClick={save}>{unclearLeft ? `Decide ${unclearLeft} unclear box${unclearLeft === 1 ? '' : 'es'} first` : 'Save these selections'}</Button>}
      {summary && (
        <div className="rounded-2xl bg-white px-3 py-2 text-xs ring-1 ring-slate-200">
          <p className="font-semibold text-slate-800">Imported: {summary.people} people · {summary.periods} vacation periods · {summary.missing} with no selection · {summary.conflicts.length} not saved</p>
          {summary.conflicts.length > 0 && <ul className="mt-1 space-y-0.5 text-red-800">{summary.conflicts.map((c, i) => <li key={i}>⛔ {c.name} · cycle {c.cycle + 1}: {c.reason}</li>)}</ul>}
        </div>
      )}
      {d.uploads.length > 0 && (
        <details className="rounded-2xl bg-white ring-1 ring-slate-200">
          <summary className="flex min-h-10 cursor-pointer items-center px-3 text-[13px] font-semibold text-slate-700">Uploaded files · {d.uploads.length}</summary>
          <ul className="divide-y divide-slate-100 text-xs">{d.uploads.map((u) => (
            <li key={u.id} className="flex items-center gap-2 px-3 py-1.5"><span className="min-w-0 flex-1 truncate">{u.fileName}</span><span className="text-slate-500">{stamp(u.uploadedAt)} · {u.formCode ?? '—'} · {u.status}</span>
              <button type="button" className="font-semibold text-brand-700" onClick={async () => { const b = await downloadUpload(u.path); window.open(URL.createObjectURL(b), '_blank'); }}>Open</button>
              {editable && u.status !== 'committed' && <button type="button" className="font-semibold text-red-700" onClick={async () => { await updateUpload(u.id, 'discarded', null, null); await refreshPlan(); }}>Discard</button>}</li>))}</ul>
        </details>
      )}
    </div>
  );
}
