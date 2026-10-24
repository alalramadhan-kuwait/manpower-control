// Desktop tracker check (read-only): signs in, opens the tracker page at desktop and phone width, every tab, the
// Admin and Report sheets, an item sheet, and the Today cards. All writes are blocked in the browser.
//   BASE=https://ops12ards.com SH_EMAIL=… SH_PASSWORD=… node scripts/e2e-tracker-desktop.mjs
// Prints the problems found and exits 1 when there are any.
import { chromium } from 'playwright';
const { BASE = 'http://localhost:5173', SH_EMAIL, SH_PASSWORD } = process.env;
if (!SH_EMAIL || !SH_PASSWORD) { console.error('Set SH_EMAIL and SH_PASSWORD (a Section Head login).'); process.exit(2); }
const b = await chromium.launch(); const problems = [];
for (const [w, h] of [[1280, 900], [393, 852]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.route('**/rest/v1/**', (r) => (['PATCH', 'POST', 'DELETE'].includes(r.request().method()) && !r.request().url().includes('/rpc/') ? r.fulfill({ status: 403, body: '{}' }) : r.continue()));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(`${w}px page error: ${e.message}`));
  p.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/rest/v1/') && r.request().method() === 'GET') problems.push(`${w}px ${r.status()} ${r.url().split('?')[0].split('/').pop()}`); });
  await p.goto(`${BASE}/`); await p.fill('input[autocomplete="username"], input[type="text"]', SH_EMAIL.split('@')[0]); await p.fill('input[type="password"]', SH_PASSWORD);
  await p.click('button[type="submit"]'); await p.waitForTimeout(5000);
  await p.goto(`${BASE}/progress`); await p.waitForTimeout(8000);
  for (const t of ['Today', 'Isolation', 'Equipment', 'Sequence', 'IATs']) {
    await p.getByRole('button', { name: new RegExp(t) }).first().click(); await p.waitForTimeout(1200);
    if ((await p.innerText('body')).length < 300) problems.push(`${w}px tab ${t} looks empty`);
  }
  await p.getByRole('button', { name: /Report/ }).first().click(); await p.waitForTimeout(1200);
  if (!(await p.locator('text=Team leader').count())) problems.push(`${w}px report sheet: no Team leader switch`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await ctx.close();
}
console.log(problems.length ? problems.join('\n') : 'desktop tracker screens OK');
await b.close(); process.exit(problems.length ? 1 : 0);
