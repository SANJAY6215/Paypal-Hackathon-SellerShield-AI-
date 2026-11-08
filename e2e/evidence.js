/**
 * Evidence capture for the final validation. Each step is explicit and labelled; nothing is simulated by this script.
 * Usage: node evidence.js <step>   steps: redteam-sandbox | redteam-continue-check | discovery-search | discovery-llm | defence | dashboard
 * Screenshots go to ../docs/screenshots/final/<LABEL>-<name>.png where LABEL is LIVE | MOCK | EMULATOR | LOCAL.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const OUT = path.resolve(__dirname, '../docs/screenshots/final');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = process.argv[2];

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  const text = () => p.evaluate(() => document.body.innerText);
  const waitText = (re, timeout = 60000) => p.waitForFunction((s, f) => new RegExp(s, f).test(document.body.innerText), { timeout }, re.source, re.flags);
  const clickWhenReady = async (re, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await click(re)) return true; await sleep(300); } return false; };
  const click = (re) => p.evaluate((s, f) => { const e = [...document.querySelectorAll('button')].find((x) => new RegExp(s, f).test(x.textContent)); if (e && !e.disabled) { e.click(); return true; } return false; }, re.source, re.flags);
  const api = (pth, opts) => p.evaluate(async (pth, opts) => { const r = await fetch('/api' + pth, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...opts }); return { status: r.status, body: await r.json().catch(() => null) }; }, pth, opts || {});
  const shot = (n) => p.screenshot({ path: path.join(OUT, n + '.png') });
  const go = async (u) => { await p.goto(BASE + u, { waitUntil: 'networkidle0' }); await sleep(900); };
  const scrollTo = (re, tag = 'h3') => p.evaluate((s) => { const e = [...document.querySelectorAll('h1,h2,h3')].find((h) => new RegExp(s, 'i').test(h.textContent)); e && e.scrollIntoView({ block: 'start' }); }, re.source);

  await p.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await p.evaluate(() => fetch('/api/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  const merchant = (await api('/merchants')).body[0];

  if (step === 'redteam-sandbox') {
    await go('/paypal');
    await p.select('select[aria-label=Target]', 'sandbox');
    await sleep(300);
    await click(/Run red team/);
    await waitText(/RT-02/, 60000);
    await sleep(800);
    await scrollTo(/Red Team/);
    await sleep(300);
    await shot('LIVE-paypal-redteam-sandbox-phaseA');
    const runs = (await api(`/redteam?merchantId=${merchant.id}`)).body;
    const r = runs[0];
    console.log(JSON.stringify({ runId: r.id, mode: r.mode, status: r.status, baseUrl: r.baseUrl, approvalUrl: r.approvalUrl, probes: r.results.map((x) => ({ id: x.id, source: x.source, verdict: x.verdict, actual: x.actual })) }, null, 1));
  }

  if (step === 'redteam-complete') {
    await go('/paypal');
    const runs = (await api(`/redteam?merchantId=${merchant.id}`)).body;
    const live = runs.find((r) => r.mode === 'sandbox' && r.status === 'completed');
    if (!live) throw new Error('no completed sandbox run');
    if (await p.$('select[aria-label="Recent runs"]')) await p.select('select[aria-label="Recent runs"]', live.id);
    await sleep(1200);
    await scrollTo(/Red Team/);
    await sleep(300);
    await shot('LIVE-paypal-redteam-sandbox-phaseB-complete');
    await p.evaluate(() => window.scrollBy(0, 640));
    await sleep(300);
    await shot('LIVE-paypal-redteam-sandbox-phaseB-complete-2');
    console.log(JSON.stringify({ runId: live.id, probes: live.results.map((x) => `${x.id} ${x.source} ${x.verdict}`) }));
  }

  if (step === 'discovery-search') {
    await go('/discovery');
    if (!(await clickWhenReady(/Run discovery/))) throw new Error('Run discovery button never became enabled');
    await waitText(/Evaluated [\d,]+ sequences/, 90000);
    await sleep(1500);
    await shot('LOCAL-discovery-guided-search-cancel-for-cash');
    console.log('search done:', /Cancel-for-Cash/.test(await text()));
  }

  if (step === 'discovery-llm') {
    await go('/discovery');
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /LLM attacker/.test(e.textContent)); b && b.click(); });
    await sleep(300);
    // attempts is fixed at 2 by the UI; keep it to a single live session
    await clickWhenReady(/Run discovery/);
    await waitText(/VERIFIED|REJECTED|All LLM providers failed|No shop actions/, 400000).catch(() => {});
    for (let i = 0; i < 120; i++) { const runs = (await api(`/discovery?merchantId=${merchant.id}`)).body; if (runs[0] && runs[0].status !== 'running') break; await sleep(3000); }
    await sleep(1500);
    await shot('LIVE-discovery-groq-llm-session');
    const runs = (await api(`/discovery?merchantId=${merchant.id}`)).body;
    const run = (await api(`/discovery/${runs[0].id}`)).body;
    console.log(JSON.stringify({ engine: run.engine, status: run.status, stats: run.stats, findings: run.findings.map((f) => ({ title: f.title, leakage: f.leakage, novelty: f.novelty, verified: f.verified, blockedBy: f.blockedBy })) }, null, 1));
  }

  if (step === 'discovery-llm-view') {
    await go('/discovery');
    await sleep(1500);
    await p.screenshot({ path: path.join(OUT, 'LIVE-discovery-groq-llm-session-fullpage.png'), fullPage: true });
    const runs = (await api(`/discovery?merchantId=${merchant.id}`)).body;
    const run = (await api(`/discovery/${runs[0].id}`)).body;
    console.log(JSON.stringify(run.findings.map((f) => ({ title: f.title, rationale: f.rationale, leakage: f.leakage, novelty: f.novelty, kinds: f.kinds, sequence: f.sequence.map((a) => ({ tool: a.tool, ...(a.event ? { event: a.event } : {}), ...(a.actor ? { actor: a.actor } : {}), ...(a.code ? { code: a.code, value: a.value } : {}), ...(a.coupons ? { coupons: a.coupons } : {}) })), checks: f.verification.checks.map((c) => c.ok) })), null, 1));
  }

  if (step === 'dashboard') {
    await go('/dashboard');
    await shot('LOCAL-dashboard-demo-fixture');
    await go('/defence');
    await sleep(1200);
    await shot('LOCAL-defence-center-proposed-patch');
    await go('/agents');
    await shot('LOCAL-six-agents-control-center');
    console.log('dashboard/defence/agents captured');
  }

  await b.close();
})().catch((e) => { console.error('EVIDENCE ERROR', e.message); process.exit(1); });
