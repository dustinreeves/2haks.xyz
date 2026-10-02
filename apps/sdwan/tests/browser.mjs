// End-to-end in headless Chromium under the production CSP. Run: scripts/browser-test.sh
import { createRequire } from 'module';
const { chromium } = createRequire('/tmp/')('playwright');
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = '/app/public', OUT = '/out';
const csp = /Content-Security-Policy "([^"]+)"/.exec(fs.readFileSync('/app/deploy/Caddyfile.snippet', 'utf8'))[1];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.zip': 'application/zip', '.png': 'image/png', '.j2': 'text/plain', '.py': 'text/plain' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Content-Security-Policy': csp, 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(r);
}).listen(8080);

const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage(); const problems = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
let fail = 0; const ok = (c, msg) => { console.log(c ? '  ok  ' : '  FAIL', msg); if (!c) fail++; };

await page.goto('http://localhost:8080/');
await page.waitForSelector('#engine.ok', { timeout: 180000 });
ok(true, 'engine started under CSP: ' + (await page.textContent('#engine')));
await page.screenshot({ path: OUT + '/01-project.png' });

// Import Fortinet's mixed example and compare to oracle
const EX = '/app/public/releases/7.4/examples/';
await page.setInputFiles('#import', [EX + 'Project.dualreg.mixed.nocert.j2', EX + 'inventory.dualreg.mixed.json']);
try { await page.locator('#engine').filter({ hasText: /^7 configs/ }).waitFor({ timeout: 40000 }); }
catch (e) {
  console.log('IMPORT STATE:', JSON.stringify({ engine: await page.textContent('#engine'), toast: await page.textContent('#toast'), problems }));
  await page.screenshot({ path: OUT + '/debug.png' }); throw e;
}
ok(true, 'imported mixed example: ' + (await page.textContent('#engine')));
for (const v of ['regions', 'profiles', 'devices', 'topology']) { await page.click('#nav-' + v); await page.waitForTimeout(250); await page.screenshot({ path: OUT + '/02-' + v + '.png' }); }
await page.click('#nav-configs'); await page.waitForSelector('.cli .ln');
const first = await page.$$eval('.ditem .dn', e => e.map(x => x.textContent));
for (const dev of first) {
  await page.click('.ditem:has-text("' + dev + '")'); await page.waitForSelector('.cli .ln');
  const txt = await page.$$eval('.cli .ln', l => l.map(x => x.textContent).join('\n') + '\n');
  const exp = fs.readFileSync('/app/tests/oracle/mixed/' + dev, 'utf8');
  ok(txt === exp, 'browser output == Fortinet renderer: ' + dev);
}
await page.click('.ditem:has-text("site1-1")'); await page.screenshot({ path: OUT + '/03-configs.png' });

// ---- problems panel: Fortinet's example has a real typo (device site1-3 has hostname site1-2)
await page.click('#problems'); const ptxt = await page.textContent('#ppanel');
ok(/Duplicate hostname "site1-2"/.test(ptxt), 'validator flags the duplicate hostname in the example'); await page.click('#problems');

// ---- edit in the UI -> config reacts
await page.click('#nav-devices');
const row = page.locator('table.inv').nth(1).locator('tbody tr').first();
const vals = await row.locator('input').evaluateAll(es => es.map(e => e.value));
await row.locator('input').nth(vals.indexOf('10.0.1.1/24')).fill('10.77.7.1/24');
await page.locator('#engine').filter({ hasText: /configs/ }).waitFor();
await page.waitForTimeout(800); await page.locator('#engine.ok').waitFor({ timeout: 30000 });
await page.click('#nav-configs'); await page.click('.ditem:has-text("site1-1")');
let t = await page.$$eval('.cli .ln', l => l.map(x => x.textContent).join('\n'));
ok(/10\.77\.7\.1/.test(t) && !/10\.0\.1\.1 /.test(t.split('\n').filter(l => /ip /.test(l)).join('\n')), 'editing a LAN IP in Devices changes the generated config');

// ---- add a device
await page.click('#nav-devices'); await page.locator('button:has-text("+ Device")').click();
await page.locator('#engine[data-fresh="1"]').filter({ hasText: /^8 configs/ }).waitFor({ timeout: 40000 });
ok(true, 'added an Edge: ' + (await page.textContent('#engine')));

// ---- undo twice reverts add + edit
await page.click('#undo'); await page.click('#undo');
await page.locator('#engine').filter({ hasText: /^7 configs/ }).waitFor({ timeout: 40000 });
await page.click('#nav-configs'); await page.click('.ditem:has-text("site1-1")');
t = await page.$$eval('.cli .ln', l => l.map(x => x.textContent).join('\n'));
ok(!/10\.77\.7\.1/.test(t), 'undo restores the original design');

// ---- profile editor: add a LAN interface and see it
await page.click('#nav-profiles'); await page.screenshot({ path: OUT + '/06-profiles-full.png', fullPage: true });

// ---- rename a profile cascades to devices
await page.locator('.peditor .cardhead input.name').first().fill('Renamed'); await page.keyboard.press('Enter');
await page.click('#nav-devices'); 
ok((await page.locator('table.inv select').first().inputValue()) !== '' , 'profile rename cascades (device still has a profile)');
await page.screenshot({ path: OUT + '/07-devices.png' });
await page.click('#nav-topology'); await page.waitForTimeout(300); await page.screenshot({ path: OUT + '/08-topology.png' });

// ---- blank design renders cleanly
page.once('dialog', d => d.accept()); await page.click('#new');
await page.locator('#engine').filter({ hasText: /^2 configs/ }).waitFor({ timeout: 40000 });
ok(await page.locator('#engine.ok').count() === 1, 'blank design renders without errors: ' + (await page.textContent('#engine')));
await page.screenshot({ path: OUT + '/09-blank-project.png' });
await page.click('#nav-regions'); await page.screenshot({ path: OUT + '/10-blank-regions.png', fullPage: true });
await page.click('#nav-topology'); await page.waitForTimeout(300); await page.screenshot({ path: OUT + '/11-blank-topology.png' });

ok(problems.length === 0, 'no console errors/CSP violations' + (problems.length ? '\n' + problems.join('\n') : ''));
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
