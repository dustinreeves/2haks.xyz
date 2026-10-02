// Smoke test against the deployed site: node live-smoke.mjs https://sdwan.2haks.xyz/
import { createRequire } from 'module'; import fs from 'fs';
const { chromium } = createRequire('/tmp/')('playwright');
const URL = process.argv[2] || 'https://sdwan.2haks.xyz/';
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
const problems = []; page.on('console', m => ['error', 'warning'].includes(m.type()) && problems.push(m.text())); page.on('pageerror', e => problems.push(e.message));
let fail = 0; const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fail++; };
await page.goto(URL); await page.locator('#engine.ok').waitFor({ timeout: 120000 }); ok(true, 'engine ready: ' + await page.textContent('#engine'));
for (const [label, dir, n] of [['Dual-region, multi-VRF', 'multi_vrf', 6], ['Dual-region, certificates', 'deployment_guide', 6], ['Dual-region, mixed RR + dynamic BGP', 'mixed', 7]]) {
  await page.click('#nav-files'); page.once('dialog', d => d.accept()); await page.click(`button:has-text("${label}")`);
  await page.locator('#engine[data-fresh="1"]').filter({ hasText: new RegExp('^' + n + ' configs') }).waitFor({ timeout: 60000 });
  await page.click('#nav-configs'); await page.waitForSelector('.cli .ln');
  const names = await page.$$eval('.ditem .dn', e => e.map(x => x.textContent)); let same = 0;
  for (const dev of names) { await page.click(`.ditem:has-text("${dev}")`); const t = await page.$$eval('.cli .ln', l => l.map(x => x.textContent).join('\n') + '\n'); if (t === fs.readFileSync(`/app/tests/oracle/${dir}/${dev}`, 'utf8')) same++; }
  ok(same === names.length, `${label}: ${same}/${names.length} devices identical to Fortinet's renderer`);
}
ok(problems.length === 0, 'no console errors' + (problems.length ? ': ' + problems.join(' | ') : ''));
await b.close(); process.exit(fail ? 1 : 0);
