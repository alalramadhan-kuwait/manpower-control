// Draws PDF pages on canvases (pdf.js, loaded only when a preview or an upload needs it).
import * as pdfjs from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = worker;

/** Each page as a canvas at `scale` (1 = 72 dpi). */
export async function renderPdf(bytes: Uint8Array | ArrayBuffer, scale = 1.5, maxPages = 12): Promise<HTMLCanvasElement[]> {
  const doc = await pdfjs.getDocument({ data: bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes) }).promise;
  const out: HTMLCanvasElement[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(canvas);
  }
  await doc.destroy();
  return out;
}
