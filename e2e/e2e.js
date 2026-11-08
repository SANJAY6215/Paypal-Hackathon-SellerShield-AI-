/**
 * SellerShield AI browser E2E. Requires backend (:4000) and frontend (:3000) running, and Chrome/Edge installed.
 * Usage: node e2e.js   (env: CHROME_PATH, BASE_URL). Writes results/e2e-results.json and ../docs/screenshots/*.png
 * It only talks to the local NovaCart demo environment.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const SHOTS = path.resolve(__dirname, '../docs/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rec = (id, name, ok, detail = '') => { results.push({ id, name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}. ${name}${detail ? ' - ' + detail : ''}`); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await browser.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const consoleErrors = [];
  const badResponses = [];
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  p.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message));
  p.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
  const text = () => p.evaluate(() => document.body.innerText);
  const waitText = (re, timeout = 60000) => p.waitForFunction((s, f) => new RegExp(s, f).test(document.body.innerText), { timeout }, re.source, re.flags);
  const clickBtn = async (re, sel = 'button') => {
    const ok = await p.evaluate((s, f, sel) => { const b = [...document.querySelectorAll(sel)].find((e) => new RegExp(s, f).test(e.textContent)); if (b) { b.click(); return true; } return false; }, re.source, re.flags, sel);
    return ok;
  };
  const shot = (n) => p.screenshot({ path: path.join(SHOTS, n + '.png') });
  const go = async (u) => { await p.goto(BASE + u, { waitUntil: 'networkidle0' }); await sleep(900); };
  const api = (pth, opts) => p.evaluate(async (pth, opts) => { const r = await fetch('/api' + pth, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...opts }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j }; }, pth, opts || {});

  try {
    // 1 homepage
    await go('/');
    rec(1, 'Homepage loads', /vulnerabilities you haven't discovered yet/i.test(await text()) && /Run Security Assessment/.test(await text()));
    await shot('00-landing');

    // 2 explore live demo
    await clickBtn(/Explore Live Demo/);
    await p.waitForFunction(() => location.pathname === '/demo', { timeout: 30000 }).catch(() => {});
    rec(2, 'Explore Live Demo opens the demo workspace', p.url().endsWith('/demo'), p.url());
    await sleep(1500);

    // reset for a clean, repeatable run
    await clickBtn(/Reset demo/); await sleep(2500);

    // 3 run live demo
    const clicked = await clickBtn(/Run Live Demo/);
    // wait until agents are actually working (the idle list also contains the text "Stage 2")
    await waitText(/(analysing|testing|finding discovered)/, 20000).catch(() => {});
    await sleep(2500);
    await shot('01-demo-running');
    rec(3, 'Run Live Demo starts an assessment', clicked);

    // wait for the approval step
    await p.waitForSelector('input[type=checkbox]', { timeout: 120000 });
    await sleep(1500);
    let t = await text();
    // 4 six agents
    const six = ['Opportunist', 'Refund Abuse', 'Payment Manipulation', 'Insider Threat', 'Defence Architect', 'Auditor'].every((n) => t.includes(n));
    const completed = (t.match(/completed/g) || []).length >= 6;
    rec(4, 'Six agents execute and complete', six && completed);
    // 5 findings
    const findings = ['DISC-001', 'REFUND-001', 'REFUND-002', 'PAY-001', 'INV-001', 'ACL-001'].every((id) => t.includes(id));
    rec(5, 'Six security findings appear', findings);
    // 6 chains
    rec(6, 'Compound attack chains appear', t.includes('Discount-Stack Refund Siphon') && t.includes('Phantom Payment Insider Payout'));
    // 7 financial
    rec(7, 'Financial exposure matches verified values ($154 excess; $80 expected; -$74 actual)', t.includes('$154.00') && t.includes('$80.00') && t.includes('-$74.00'));
    // 8 auditor (agents page)
    await go('/agents');
    t = await text();
    await shot('02-agents');
    rec(8, 'Auditor verdicts are displayed', /audit verdicts/i.test(t) && (t.match(/\bverified\b/g) || []).length >= 6);
    // explorer screenshot while the hero chain is still exploitable
    await go('/attack-chains');
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /Discount-Stack Refund Siphon/.test(e.textContent)); b && b.click(); });
    await sleep(1800); await shot('07-attack-chain-explorer');
    await go('/demo');
    await p.waitForSelector('input[type=checkbox]', { timeout: 30000 });
    await sleep(1000);

    // 11 diff display
    const diffTxt = await p.evaluate(() => [...document.querySelectorAll('pre')].map((e) => e.innerText).join('\n'));
    rec(11, 'Patch diffs display (unified diff of real rule source)', /@@/.test(diffTxt) && /^\+.*(const|if|return)/m.test(diffTxt) && /^-.*(const|return|if)/m.test(diffTxt));
    await p.evaluate(() => { const d = document.querySelector('details'); d && d.scrollIntoView({ block: 'start' }); });
    await sleep(500);
    await shot('03-patch-diff-and-approval');
    // 13 explicit confirmation required
    const disabledBefore = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /Approve and apply/.test(e.textContent)); return b ? b.disabled : null; });
    await p.click('input[type=checkbox]');
    const disabledAfter = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /Approve and apply/.test(e.textContent)); return b ? b.disabled : null; });
    rec(13, 'Explicit confirmation required (button disabled until checkbox ticked)', disabledBefore === true && disabledAfter === false, `before disabled=${disabledBefore}, after=${disabledAfter}`);
    // 12 + 14 approval and apply
    await clickBtn(/Approve and apply/);
    await waitText(/Fixes approved by a human/, 30000).catch(() => {});
    rec(12, 'Approval workflow works', /Fixes approved by a human/.test(await text()));
    const merchant = (await api('/merchants')).body[0];
    const st = (await api('/merchants/' + merchant.id)).body;
    rec(14, 'Patch application works (3 chain fixes now in force)', ['coupon-stacking', 'refund-calc', 'refund-idempotency'].every((f) => st.effectiveFixes.includes(f)), st.effectiveFixes.join(','));
    // 16 attack replay
    await clickBtn(/Replay the original attack/);
    await waitText(/FAILED \(blocked\)/, 30000).catch(() => {});
    t = await text();
    await shot('04-attack-blocked');
    rec(16, 'Original attack is blocked after fixes (excess now $0.00)', /FAILED \(blocked\)/.test(t) && /excess per attack now \$0\.00/.test(t));
    await clickBtn(/Generate report/); await sleep(2500);
    await shot('05-demo-final');

    // other screens for docs
    await go('/dashboard'); await shot('06-dashboard');
    await go('/financial'); await sleep(1500); await shot('08-financial-impact');
    const vulns = (await api(`/vulnerabilities?merchantId=${merchant.id}&limit=50`)).body.items;
    const disc = vulns.find((v) => v.testCaseId === 'DISC-001');
    await go('/vulnerabilities/' + disc.id); await shot('09-vulnerability-evidence');

    // 15 rollback via UI on a different fix (inventory race)
    await go('/defence');
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /INV-001/.test(e.textContent)); b && b.click(); });
    await sleep(1200);
    await clickBtn(/Approve patch/); await waitText(/approved/i, 15000).catch(() => {}); await sleep(800);
    const applyDisabled = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /Apply to Demo App/.test(e.textContent)); return b ? b.disabled : null; });
    await p.evaluate(() => { const c = document.querySelector('input[type=checkbox]'); c && c.click(); });
    await sleep(300);
    await clickBtn(/Apply to Demo App/); await sleep(1500);
    await clickBtn(/Run Regression Tests/); await waitText(/Persisted regression tests/, 30000).catch(() => {}); await sleep(800);
    await shot('10-defence-center-verified');
    let afterApply = (await api('/merchants/' + merchant.id)).body.effectiveFixes.includes('inventory-race');
    await clickBtn(/Roll Back/); await sleep(2000);
    const afterRb = (await api('/merchants/' + merchant.id)).body.effectiveFixes.includes('inventory-race');
    const invVuln = (await api(`/vulnerabilities?merchantId=${merchant.id}&limit=50`)).body.items.find((v) => v.testCaseId === 'INV-001');
    rec(15, 'Rollback works (fix removed, vulnerability reopened)', applyDisabled === true && afterApply === true && afterRb === false && invVuln.status === 'verified', `applyDisabledBeforeConfirm=${applyDisabled}, inForceAfterApply=${afterApply}, inForceAfterRollback=${afterRb}, vulnStatus=${invVuln.status}`);

    // 17/18 regression memory + reintroduced
    await go('/merchant');
    const toggled = await p.evaluate(() => { const lab = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && /Allow coupon stacking/.test(d.textContent)); if (!lab) return false; let row = lab; for (let i = 0; i < 6 && row; i++) { row = row.parentElement; const b = row && [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === 'On'); if (b) { b.click(); return true; } } return false; });
    await sleep(1500);
    const cfg = (await api('/merchants/' + merchant.id)).body.config;
    await go('/memory');
    await clickBtn(/Rerun previous tests/);
    await waitText(/Regression run finished/, 60000).catch(() => {});
    await waitText(/\d+\s+reintroduced vulnerabilit/, 15000).catch(() => {});
    t = await text();
    await shot('11-regression-memory');
    rec(17, 'Regression memory reruns saved tests', /Regression run finished/.test(t));
    rec(18, 'Reintroduced vulnerability detected (DISC-001)', toggled && cfg.stackableCoupons === true && /1\s+reintroduced vulnerabilit/.test(t) && /DISC-001/.test(t), `toggled=${toggled}, cfg=${JSON.stringify(cfg)}, textHit=${/1s+reintroduced vulnerabilit/.test(t)}, disc=${/DISC-001/.test(t)}`);
    await api(`/merchants/${merchant.id}/config`, { method: 'PATCH', body: JSON.stringify({ stackableCoupons: false }) });

    // 19 reports
    await go('/reports');
    await clickBtn(/Generate report/); await waitText(/Report preview/, 30000).catch(() => {});
    const repId = (await api('/reports')).body[0].id;
    const pdf = await p.evaluate(async (id) => { const r = await fetch(`/api/reports/${id}/download?format=pdf`); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, magic: String.fromCharCode(...b.slice(0, 4)), size: b.length }; }, repId);
    const js = await api(`/reports/${repId}`);
    await shot('12-report');
    rec(19, 'Reports open (preview, JSON and PDF)', /Report preview/.test(await text()) && pdf.status === 200 && pdf.magic === '%PDF' && js.status === 200, `pdf ${pdf.size} bytes`);

    // 20 navigation + responsive
    const routes = ['/', '/dashboard', '/merchant', '/agents', '/attack-chains', '/discovery', '/vulnerabilities', '/defence', '/financial', '/memory', '/paypal', '/reports', '/demo'];
    const broken = [];
    for (const r of routes) { await go(r); const tt = await text(); if (/Application error|This page could not be found|Unhandled Runtime Error/i.test(tt) || tt.length < 80) broken.push(r); }
    rec(20, 'No broken navigation (13 routes render)', broken.length === 0, broken.join(','));
    // sidebar links actually navigate
    await go('/dashboard');
    const hrefs = await p.evaluate(() => [...document.querySelectorAll('aside a')].map((a) => a.getAttribute('href')));
    rec('20b', 'Sidebar links resolve', hrefs.length >= 13 && hrefs.every((h) => h === '/' || routes.includes(h)), `${hrefs.length} links`);

    const overflow = [];
    for (const [w, h] of [[1024, 768], [768, 1024]]) {
      await p.setViewport({ width: w, height: h });
      for (const r of routes.slice(1)) { await go(r); const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 2) overflow.push(`${r}@${w} (+${o}px)`); }
    }
    await p.setViewport({ width: 1440, height: 900 });
    rec('20c', 'Tablet/desktop layouts have no horizontal page overflow (1024 and 768 wide)', overflow.length === 0, overflow.join('; '));

    // PayPal page smoke - mode aware (never creates real Sandbox orders from the E2E)
    await go('/paypal');
    const ppStatus = (await api('/paypal/status')).body;
    if (ppStatus.mode === 'sandbox') {
      await shot('13-paypal-sandbox-connected');
      rec('21', 'PayPal Sandbox connection: real OAuth succeeds', ppStatus.oauth === 'ok', `mode=sandbox oauth=${ppStatus.oauth} (self-test not run to avoid creating real Sandbox orders)`);
    } else {
      await clickBtn(/^\s*Run\s*$/); await waitText(/Verified webhook processed; replay ignored|Unexpected error/, 60000).catch(() => {});
      t = await text(); await shot('13-paypal-demo-mode');
      rec('21', 'PayPal page self-test passes in DEMO MODE (local simulation, not real Sandbox)', /Verified webhook processed; replay ignored/.test(t) && !/Unexpected error/.test(t));
    }

    // ===== New features: Discovery Lab, PayPal Red Team, Defence-as-PR =====
    await api('/demo/reset', { method: 'POST', body: '{}' });
    await go('/discovery');
    const llmCfg = (await api('/discovery/config')).body;
    const llmDisabled = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /LLM attacker/.test(e.textContent)); return b ? b.disabled : null; });
    if (llmCfg.llmConfigured) rec('22', 'LLM attacker option is enabled when a provider key is configured (not run here: avoids spending free-tier tokens)', llmDisabled === false, `providers=${llmCfg.providers.map((x) => x.name).join(',')}`);
    else rec('22', 'LLM attacker is disabled without an API key (and says why)', llmDisabled === true && /GROQ_API_KEY/.test(await text()));
    await clickBtn(/Run discovery/);
    await waitText(/Evaluated [\d,]+ sequences/, 90000).catch(() => {});
    await sleep(1200);
    t = await text();
    await shot('14-discovery-lab');
    rec('23', 'Discovery Lab (guided search) finds "Cancel-for-Cash" as NOVEL, verified', /Cancel-for-Cash/.test(t) && /Novel/i.test(t) && /Not in the scripted library/.test(t));
    // apply the root-cause fix, rerun: finding must disappear
    const m2 = (await api('/merchants')).body[0];
    const defs = (await api(`/defences?merchantId=${m2.id}`)).body;
    const ps = defs.find((d) => d.fixId === 'payment-state');
    await api(`/defences/${ps.id}/approve`, { method: 'POST', body: '{}' });
    await api(`/defences/${ps.id}/apply`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
    await go('/discovery');
    await clickBtn(/Run discovery/);
    await sleep(1500);
    await waitText(/Evaluated [\d,]+ sequences/, 90000).catch(() => {});
    await p.waitForFunction(() => /against app with fixes: payment-state/.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
    t = await text();
    rec('24', 'After applying payment-state, rerun no longer finds Cancel-for-Cash', /against app with fixes: payment-state/.test(t) && !/Cancel-for-Cash/.test(t));

    // red team
    await go('/paypal');
    await p.select('select[aria-label=Target]', 'emulator'); // always the local emulator here; real Sandbox is run deliberately by a human
    await sleep(300);
    await clickBtn(/Run red team/);
    await waitText(/RT-07/, 30000).catch(() => {});
    await sleep(800);
    t = await text();
    await p.evaluate(() => { const e = [...document.querySelectorAll('h3')].find((h) => /Red Team/.test(h.textContent)); e && e.scrollIntoView(); });
    await sleep(400); await shot('15-paypal-red-team');
    rec('25', 'PayPal Red Team (emulator) runs, labels source, flags ledger divergence', /RT-07/.test(t) && /EMULATOR - NOT PAYPAL/.test(t) && /1 weakness/.test(t) && /divergence \$100/.test(t));

    // defence as PR preview (needs a verified defence)
    const cs = defs.find((d) => d.fixId === 'coupon-stacking');
    await api(`/defences/${cs.id}/approve`, { method: 'POST', body: '{}' });
    await api(`/defences/${cs.id}/apply`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
    await api(`/defences/${cs.id}/run-tests`, { method: 'POST', body: '{}' });
    await go('/defence');
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /DISC-001/.test(e.textContent)); b && b.click(); });
    await sleep(1500);
    await clickBtn(/Preview pull request/);
    await waitText(/sellershield\/fixes\/coupon-stacking\.patch/, 20000).catch(() => {});
    t = await text();
    const openDisabled = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /Open draft pull request/.test(e.textContent)); return b ? b.disabled : null; });
    await p.evaluate(() => { const e = [...document.querySelectorAll('h3')].find((h) => /pull request/i.test(h.textContent)); e && e.scrollIntoView(); });
    await sleep(400); await shot('16-defence-pull-request-preview');
    rec('26', 'Defence-as-PR preview shows patch + regression test + report; cannot open without GitHub config', /coupon-stacking\.test\.ts/.test(t) && /reports\/coupon-stacking\.md/.test(t) && /GitHub is not configured/.test(t) && openDisabled === true, `openDisabled=${openDisabled}`);
    await api('/demo/reset', { method: 'POST', body: '{}' });
  } catch (e) {
    rec('ERR', 'E2E aborted by exception', false, e.message);
  }

  const unexpected = badResponses.filter((r) => !/^404 GET \/favicon/.test(r));
  console.log('\nHTTP >=400 responses observed:', unexpected.length ? unexpected : 'none');
  console.log('Console errors observed:', consoleErrors.length ? consoleErrors : 'none');
  fs.writeFileSync(path.join(__dirname, 'results/e2e-results.json'), JSON.stringify({ at: new Date().toISOString(), results, badResponses: unexpected, consoleErrors }, null, 2));
  await browser.close();
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})();
