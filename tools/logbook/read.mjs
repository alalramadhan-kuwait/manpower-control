// Reads the shift-log and lab PDFs saved by the Mac's 6:50 / 14:50 / 22:50 job (owner, 24 Nov 2026) and turns them into records with
// the parser in src/core/logbook/parse.ts (copied next to this file on the Mac; node reads TypeScript directly).
//   node read.mjs check <folder>     what each file holds (nothing is sent)
//   node read.mjs json <file.pdf>    the full record of one file
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseShiftLog, parseLabReport } from './parse.ts';

export async function pagesOf(file) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    pages.push({ h: Math.round(vp.height), pieces: tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ p, x: Math.round(i.transform[4]), y: Math.round(vp.height - i.transform[5]), w: Math.round(i.width), s: i.str })) });
  }
  return pages;
}
export async function readFile(file) {
  const pages = await pagesOf(file);
  const log = parseShiftLog(pages);
  if (log) return { type: 'log', log };
  const samples = parseLabReport(pages);
  return samples.length ? { type: 'lab', samples } : { type: 'unknown' };
}

const [mode, target] = process.argv.slice(2);
if (mode === 'json') console.log(JSON.stringify(await readFile(target), null, 1));
if (mode === 'check') {
  for (const sub of ['logbook', 'lab']) for (const f of readdirSync(join(target, sub)).filter((x) => x.endsWith('.pdf')).sort()) {
    const r = await readFile(join(target, sub, f));
    if (r.type === 'log') { const l = r.log; console.log(`${f} · ${l.kind} #${l.logNo} ${l.date} ${l.shift}/${l.crew}/${l.day} · remarks ${l.sections.map((s) => `${s.role}:${s.groups.reduce((n, g) => n + g.items.length, 0)}`).join(' ')} · readings ${l.readings.length} (unplaced ${l.unplaced}) · feed ${l.feed.length} · products ${l.products.length}`); }
    else if (r.type === 'lab') console.log(`${f} · lab ${r.samples.length} samples: ${r.samples.map((s) => `${s.material}@${s.equipment} ${s.collectedAt?.slice(5, 16)} (${s.results.length})`).join('; ')}`);
    else console.log(`${f} · not recognised`);
  }
}
