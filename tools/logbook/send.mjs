// Sends what the 6:50 / 14:50 / 22:50 job saved to the app (owner, 25 Nov 2026): reads every PDF in <folder>/logbook and <folder>/lab
// with read.mjs and posts the records to the logbook-ingest function. The folder only ever holds the last 20 e-mails
// of each kind, and a record sent again replaces itself, so everything is sent every time.
//   node send.mjs <folder>
// Needs, next to this file: ingest.key (the Mac's key, 64 hex, chmod 600) and ingest.url (the function's address).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from './read.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const folder = process.argv[2];
if (!folder) { console.error('usage: node send.mjs <folder>'); process.exit(2); }
const keyFile = join(here, 'ingest.key');
if ((statSync(keyFile).mode & 0o077) !== 0) { console.error('ingest.key must be readable by its owner only (chmod 600)'); process.exit(2); }
const key = readFileSync(keyFile, 'utf8').trim();
const url = readFileSync(join(here, 'ingest.url'), 'utf8').trim();

const logs = [], samples = [], unread = [];
for (const sub of ['logbook', 'lab']) {
  let files = [];
  try { files = readdirSync(join(folder, sub)).filter((f) => f.toLowerCase().endsWith('.pdf')).sort(); } catch { continue; }
  for (const f of files) {
    try {
      const r = await readFile(join(folder, sub, f));
      if (r.type === 'log') logs.push({ ...r.log, file: f });
      else if (r.type === 'lab') for (const s of r.samples) samples.push({ ...s, file: f });
      else unread.push(f);
    } catch (e) { unread.push(`${f} (${e.message})`); }
  }
}
const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-logbook-key': key }, body: JSON.stringify({ logs, samples }) });
const text = await res.text();
console.log(`${new Date().toISOString()} sent ${logs.length} logs, ${samples.length} samples → ${res.status} ${text}${unread.length ? ` · not read: ${unread.join(', ')}` : ''}`);
if (!res.ok) process.exit(1);
