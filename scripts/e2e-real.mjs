// End-to-end against the REAL Supabase project, on an iPhone-size viewport. Run after `npm run dev` (or against a deployed URL).
// env: E2E_EMPLOYEE_NUMBER (a Field Operator used for the round trips), APP_URL (default http://localhost:5173), MC_EMAIL, MC_PASSWORD, WORKBOOK (path to the U-12 manpower workbook), OUT (screenshot dir)
// Uses the pre-installed Chromium when PW_CHROME is set (cloud container: /opt/pw-browsers/chromium-1194/chrome-linux/chrome).
import { chromium } from 'playwright-core';
const BASE = process.env.APP_URL || 'http://localhost:5173'; const EMP = process.env.E2E_EMPLOYEE_NUMBER ?? ''; // a Field Operator's employee number const out = process.env.OUT || '.';
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
try {
  // 1. login
  await page.goto(BASE + '/'); await page.waitForSelector('text=Sign in');
  await page.fill('input[type=email]', process.env.MC_EMAIL); await page.fill('input[type=password]', process.env.MC_PASSWORD); await page.click('button[type=submit]');
  await page.waitForSelector('text=Unit 12 — Section 1', { timeout: 30000 }); check('login through the app', true); await page.screenshot({ path: `${out}/real-01-home.png`, fullPage: true });
  // 2. directory
  await page.goto(BASE + '/employees'); await page.waitForSelector('text=in Section 1 scope', { timeout: 30000 });
  const subtitle = await page.textContent('h1 + p'); check('employee directory loads from Supabase', /60 of 60/.test(subtitle ?? ''), subtitle ?? ''); await page.screenshot({ path: `${out}/real-02-employees.png`, fullPage: true });
  // 3. profile update round trip (notes field)
  await page.fill('input[placeholder="Search name or employee number"]', EMP); await page.locator('main ul li a').first().click(); await page.waitForSelector('text=Qualifications', { timeout: 30000 });
  await page.click('button[aria-label="Edit basics"]'); await page.waitForSelector('[role=dialog]');
  const marker = `e2e ${new Date().toISOString()}`; const before = await page.inputValue('[role=dialog] textarea');
  await page.fill('[role=dialog] textarea', marker); await page.click('[role=dialog] button:has-text("Save")'); await page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 30000 });
  await page.reload(); await page.waitForSelector('text=Qualifications'); await page.click('button[aria-label="Edit basics"]'); await page.waitForSelector('[role=dialog]');
  const after = await page.inputValue('[role=dialog] textarea'); check('employee profile update saves and reads back', after === marker, after);
  await page.fill('[role=dialog] textarea', before); await page.click('[role=dialog] button:has-text("Save")'); await page.waitForSelector('[role=dialog]', { state: 'detached' });
  await page.screenshot({ path: `${out}/real-03-profile.png`, fullPage: true });
  // 4. Take-Charge bulk update: set one person to Yes, verify, then back to Not yet
  await page.goto(BASE + '/review/take-charge'); await page.waitForSelector('text=Take-Charge confirmation', { timeout: 30000 });
  const row = page.locator(`li:has-text("#${EMP}")`);
  await row.locator('button:has-text("Yes")').click(); await page.click('button:has-text("Save")'); await page.waitForSelector('text=Saved 1', { timeout: 30000 });
  await page.reload(); await page.waitForSelector('text=Take-Charge confirmation');
  const nowYes = await page.locator(`li:has-text("#${EMP}") [role=radio][aria-checked="true"]`).textContent(); check('Take-Charge bulk update saved (Yes)', nowYes?.trim() === 'Yes', nowYes ?? '');
  await page.screenshot({ path: `${out}/real-04-take-charge.png`, fullPage: true });
  await page.locator(`li:has-text("#${EMP}") button:has-text("Not yet")`).click(); await page.click('button:has-text("Save")'); await page.waitForSelector('text=Saved 1', { timeout: 30000 });
  await page.reload(); await page.waitForSelector('text=Take-Charge confirmation');
  const back = await page.locator(`li:has-text("#${EMP}") [role=radio][aria-checked="true"]`).textContent(); check('Take-Charge reverted to Not yet confirmed', back?.trim() === 'Not yet', back ?? '');
  // 5. import preview + commit (re-import of the same workbook must change nothing)
  await page.goto(BASE + '/imports'); await page.waitForSelector('text=Excel Import Center');
  await page.setInputFiles('input[type=file]', process.env.WORKBOOK); await page.waitForSelector('button:has-text("Confirm and update database")', { timeout: 180000 });
  await page.screenshot({ path: `${out}/real-05-import-preview.png`, fullPage: true });
  const tiles = await page.$$eval('.grid .rounded-xl', (els) => els.map((e) => e.textContent.trim()));
  const newEmp = tiles.find((t) => t.includes('New employees')) ?? ''; const leaveNew = tiles.find((t) => t.includes('Leave records to add')) ?? '';
  check('import preview reaches Supabase and matches existing data', /^0/.test(newEmp) && /^0/.test(leaveNew), `${newEmp} | ${leaveNew}`);
  await page.click('button:has-text("Confirm and update database")'); await page.waitForSelector('text=Committed', { timeout: 180000 });
  check('import commit succeeds through commit_import_batch', true); await page.screenshot({ path: `${out}/real-06-import-committed.png`, fullPage: true });
  await page.goto(BASE + '/imports/history'); await page.waitForSelector('text=Import History'); await page.screenshot({ path: `${out}/real-07-history.png`, fullPage: true });
} catch (e) { check('run completed without exception', false, String(e.message ?? e)); await page.screenshot({ path: `${out}/real-failure.png`, fullPage: true }).catch(() => {}); }
await browser.close();
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`); process.exit(results.every((r) => r.ok) ? 0 : 1);
