// Tracker screen check (read-only): opens the engineer view with a link, every tab, an item's steps, the time field
// and the >48 h request form. All writes are blocked in the browser, so nothing is saved.
//   BASE=https://ops12ards.com TRK_ID=<link id> TRK_KEY=<link key> node scripts/e2e-tracker.mjs
// Prints the problems found (page errors, failed requests, missing screens) and exits 1 when there are any.
import { chromium } from 'playwright';
const { BASE = 'http://localhost:5173', TRK_ID, TRK_KEY, ITEM = 'E-205' } = process.env;
if (!TRK_ID || !TRK_KEY) { console.error('Set TRK_ID and TRK_KEY (an active engineer link).'); process.exit(2); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
await ctx.route('**/rest/v1/**', (r) => (['PATCH', 'POST', 'DELETE'].includes(r.request().method()) && !r.request().url().includes('/rpc/') ? r.fulfill({ status: 403, body: '{}' }) : r.continue()));
const p = await ctx.newPage(); const problems = [];
p.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
p.on('response', (r) => { if (r.status() >= 400 && r.url().includes('supabase') && r.request().method() === 'GET') problems.push(`${r.status()} ${r.url().split('?')[0].split('/').slice(-1)}`); });
const need = async (sel, what) => { if (!(await p.locator(sel).count())) problems.push(`missing: ${what}`); };
await p.goto(`${BASE}/?sd=${TRK_KEY}`); await p.waitForTimeout(1500);
if (await p.locator('input').count()) { await p.fill('input', TRK_ID); await p.click('button:has-text("Open")'); }
await p.waitForTimeout(8000);
await need('nav button', 'engineer tabs');
for (let n = 0; n < 5; n++) { await p.click(`nav button >> nth=${n}`); await p.waitForTimeout(1000); if ((await p.innerText('body')).length < 200) problems.push(`tab ${n} looks empty`); }
await p.click('nav button >> nth=1'); await p.waitForTimeout(800);
await p.getByText(ITEM, { exact: true }).first().click(); await p.waitForTimeout(800);
await p.click('button:has-text("All steps")'); await p.waitForTimeout(800);
await p.locator('div.fixed.inset-0 main button.text-left').first().click(); await p.waitForTimeout(500);
await need('input[type="datetime-local"]', 'time field on a step');
await p.locator('input[type="datetime-local"]').fill(new Date(Date.now() - 72 * 36e5 + 3 * 36e5).toISOString().slice(0, 16)); await p.waitForTimeout(300);
await need('input[placeholder^="Reason (over"]', '>48 h reason field');
console.log(problems.length ? problems.join('\n') : 'tracker screens OK');
await b.close(); process.exit(problems.length ? 1 : 0);
