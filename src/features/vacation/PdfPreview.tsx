// A compact preview of a generated PDF: its pages drawn small, tap one to see it larger.
import { useEffect, useState } from 'react';
import { BottomSheet, ErrorBox, Spinner, cx } from '@/ui/components';

export function PdfPreview({ title, make, onClose }: { title: string; make: () => Promise<Uint8Array>; onClose: () => void }) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [big, setBig] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const [{ renderPdf }, bytes] = await Promise.all([import('./pdfRender'), make()]);
      const canvases = await renderPdf(bytes, 1.6);
      if (live) setPages(canvases.map((c) => c.toDataURL('image/png')));
    })().catch((e) => live && setErr(e));
    return () => { live = false; };
  }, [make]);
  return (
    <BottomSheet open onClose={onClose} title={title}>
      {err != null ? <ErrorBox error={err} /> : !pages ? <Spinner label="Drawing the pages…" /> : (
        <div className="space-y-2">
          <p className="-mt-2 text-xs text-slate-600">{pages.length} A3 landscape page{pages.length === 1 ? '' : 's'} · tap a page to enlarge</p>
          <div className={cx('grid gap-2', big === null ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
            {pages.map((src, i) => (big === null || big === i) && (
              <button key={i} type="button" onClick={() => setBig(big === i ? null : i)} className="overflow-hidden rounded-lg ring-1 ring-slate-200">
                <img src={src} alt={`Page ${i + 1}`} className="block w-full" />
              </button>
            ))}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
