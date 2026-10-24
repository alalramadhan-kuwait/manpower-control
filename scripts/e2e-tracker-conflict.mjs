// Two people on one record: saves never overwrite someone else's change, Undo only if nothing changed since.
// Uses a TEST tracker link (switch it on briefly); restores the step's note at the end.
//   BASE=http://localhost:5173 TRK_ID=<test link id> TRK_KEY=<test link key> TRACKER=<test tracker id> node scripts/e2e-tracker-conflict.mjs
import { chromium } from 'playwright';
const { BASE = 'http://localhost:5173', TRK_ID, TRK_KEY, TRACKER } = process.env;
if (!TRK_ID || !TRK_KEY || !TRACKER) { console.error('Set TRK_ID, TRK_KEY and TRACKER (a TEST tracker and its link).'); process.exit(2); }
const b = await chromium.launch();
const mk = async () => { const c = await b.newContext(); const p = await c.newPage(); await p.goto(`${BASE}/version.json`);
  await p.evaluate((l) => localStorage.setItem('trk-link', JSON.stringify(l)), { key: TRK_KEY, id: TRK_ID }); await p.goto(`${BASE}/version.json`);
  await p.evaluate(async (t) => { const D = await import('/src/data/tracker.ts'); window.D = D; window.d = await D.fetchTrackerData(t); }, TRACKER); return p; };
const A = await mk(), B = await mk();
const run = (p, js) => p.evaluate(async (js) => { try { await (0, eval)(`(async () => { ${js} })()`); return 'saved'; } catch (e) { return e.name; } }, js);
const id = await A.evaluate(() => window.d.activities.find((a) => a.tracked && a.actualStart && !a.detail)?.id);
const orig = JSON.stringify(await A.evaluate((id) => window.d.activities.find((x) => x.id === id).actualNote ?? null, id));
const got = [
  await run(A, `await D.setActivity('${id}', { actual_note: 'CHECK A' })`),
  await run(B, `await D.setActivity('${id}', { actual_note: 'CHECK B' })`),
  await run(B, `window.d = await D.fetchTrackerData('${TRACKER}'); await D.setActivity('${id}', { actual_note: 'CHECK B' })`),
  await run(A, `await D.setActivity('${id}', { actual_note: ${orig} })`),
  await run(B, `await D.setActivity('${id}', { actual_note: ${orig} })`),
];
const want = ['saved', 'ConflictError', 'saved', 'ConflictError', 'saved'];
console.log(JSON.stringify(got) === JSON.stringify(want) ? 'conflict checks OK' : `conflict checks FAILED: ${JSON.stringify(got)}`);
await b.close(); process.exit(JSON.stringify(got) === JSON.stringify(want) ? 0 : 1);
