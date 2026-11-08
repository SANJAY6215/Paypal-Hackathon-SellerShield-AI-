import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { prisma, saveState } from '../src/db';
import { guidedSearch, verifySequence, evaluate, ActionSchema, Action } from '../src/discovery';
import { ALL_FIXES, FixId } from '../src/simulator/shop';

const none = new Set<FixId>();

// ---------------------------------------------------------------- small mock HTTP servers (test doubles)
function mockServer(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
  const calls: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { calls.push({ method: req.method!, url: req.url!, headers: req.headers, body }); handler(req, body, res); });
  });
  return new Promise<{ url: string; calls: typeof calls; close: () => void }>((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => server.close() })));
}
const json = (res: http.ServerResponse, status: number, obj: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

// =============================================================== Attack Discovery Lab
describe('Attack Discovery Lab - guided search (no AI)', () => {
  const r = guidedSearch(none);
  it('exhaustively evaluates >100k sequences and finds verified losses', () => {
    expect(r.evaluated).toBeGreaterThan(100000);
    expect(r.findings.length).toBeGreaterThan(5);
    expect(r.findings.every((f) => f.verified)).toBe(true);
  });
  it('discovers "Cancel-for-Cash", a path that is not in the scripted library', () => {
    const f = r.findings.find((x) => x.title.startsWith('Cancel-for-Cash'))!;
    expect(f).toBeTruthy();
    expect(f.novelty).toBe('novel');
    expect(f.sequence.length).toBe(3);
    expect(f.sequence.map((a) => a.tool)).toEqual(['create_order', 'payment_event', 'cancel']);
    expect(f.leakage).toBe(160);
    expect(f.blockedBy).toEqual([['payment-state']]);
  });
  it('re-finds the known weaknesses and labels them known', () => {
    const known = r.findings.filter((f) => f.novelty === 'known').map((f) => f.title);
    expect(known).toContain('Coupon stacking');
    expect(known).toContain('Unauthorised refund');
  });
  it('the root-cause fix removes the finding; replay with all fixes shows zero loss', () => {
    const f = r.findings.find((x) => x.title.startsWith('Cancel-for-Cash'))!;
    expect(evaluate(f.sequence, new Set<FixId>(['payment-state'])).leakage).toBe(0);
    for (const x of r.findings) expect(evaluate(x.sequence, new Set(ALL_FIXES)).leakage).toBe(0);
  });
  it('after applying payment-state, Cancel-for-Cash is no longer discovered', () => {
    const after = guidedSearch(new Set<FixId>(['payment-state']));
    expect(after.findings.some((x) => x.title.startsWith('Cancel-for-Cash'))).toBe(false);
  });
});

describe('Discovery verification does not trust the attacker', () => {
  it('rejects a harmless sequence even if it claims a big loss', () => {
    const f = verifySequence([{ tool: 'create_order', lines: [{ sku: 'NC-CHG', qty: 1 }] }], none, { title: 'Totally critical $1M exploit', engine: 'llm', rationale: 'trust me' });
    expect(f.verified).toBe(false);
    expect(f.verification.checks.find((c) => c.name.includes('loses more money'))!.ok).toBe(false);
  });
  it('does not inflate losses for refunds that merely lack an idempotency key (procedural normalisation)', () => {
    const seq: Action[] = [
      { tool: 'create_order', lines: [{ sku: 'NC-HEADSET', qty: 1 }], coupons: ['SAVE20'] },
      { tool: 'payment_event', order: 'o1', event: 'COMPLETED' },
      { tool: 'refund', order: 'o1', sku: '$first', qty: 1, actor: 'admin', approvedBy: 'cfo' }, // no idemKey
    ];
    const e = evaluate(seq, none);
    expect(e.leakage).toBe(24); // $120 list-price refund vs $96 actually paid, not the full $120
    expect(verifySequence(seq, none, { title: 't', engine: 'llm' }).blockedBy).toContainEqual(['refund-calc']);
  });
  it('rejects empty and over-long sequences', () => {
    expect(verifySequence([], none, { title: 'x', engine: 'llm' }).verified).toBe(false);
    const long: Action[] = Array.from({ length: 13 }, () => ({ tool: 'create_order', lines: [{ sku: 'NC-CHG', qty: 1 }] }));
    expect(verifySequence(long, none, { title: 'x', engine: 'llm' }).verified).toBe(false);
  });
  it('validates actions with a strict schema (no arbitrary tools or values)', () => {
    expect(ActionSchema.safeParse({ tool: 'rm_rf', path: '/' }).success).toBe(false);
    expect(ActionSchema.safeParse({ tool: 'create_order', lines: [{ sku: 'NC-USB', qty: 999 }] }).success).toBe(false);
    expect(ActionSchema.safeParse({ tool: 'create_order', lines: [{ sku: 'NOPE', qty: 1 }] }).success).toBe(false);
    expect(ActionSchema.safeParse({ tool: 'refund', order: 'o1', sku: '$first', qty: 1, actor: 'root' }).success).toBe(false);
  });
});

// ========================================================= API-level: discovery, red team, pull request
let server: http.Server;
let agent: ReturnType<typeof request.agent>;
let viewer: ReturnType<typeof request.agent>;
let merchantId = '';

async function poll(path: string, done: (b: any) => boolean) {
  for (let i = 0; i < 300; i++) { const r = await agent.get(path); if (done(r.body)) return r.body; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timeout ' + path);
}

describe('API: discovery, red team, pull request', () => {
  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    process.env.SELF_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    agent = request.agent(server);
    const r = await agent.post('/api/auth/demo');
    merchantId = r.body.merchantId;
    await agent.post('/api/demo/reset'); // deterministic start regardless of what other test files left behind
    viewer = request.agent(server);
    await viewer.post('/api/auth/register').send({ name: 'View', email: 'viewer2@example.com', password: 'password123' });
    await prisma.user.update({ where: { email: 'viewer2@example.com' }, data: { role: 'viewer' } });
  });
  afterAll(async () => { await agent.post('/api/demo/reset'); server.close(); delete process.env.SELF_URL; }); // leave the shared demo merchant pristine for other test files

  it('runs the search engine as a background job and persists findings', async () => {
    const run = (await agent.post('/api/discovery/run').send({ merchantId, engine: 'search' })).body;
    const done = await poll(`/api/discovery/${run.id}`, (b) => b.status === 'completed' || b.status === 'failed');
    expect(done.status).toBe('completed');
    expect(done.findings.some((f: any) => f.title.startsWith('Cancel-for-Cash') && f.novelty === 'novel')).toBe(true);
    expect(done.trace.length).toBeGreaterThan(1);
  });
  it('refuses the LLM engine without an API key, and viewers cannot run discovery', async () => {
    const r = await agent.post('/api/discovery/run').send({ merchantId, engine: 'llm' });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/GROQ_API_KEY/);
    expect((await viewer.post('/api/discovery/run').send({ merchantId, engine: 'search' })).status).toBe(403); // viewer role may not run discovery
  });

  describe('LLM engine end-to-end through the API (local mock of an OpenAI-compatible provider)', () => {
    let mock: Awaited<ReturnType<typeof mockServer>>;
    const tc = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    beforeAll(async () => {
      let i = 0;
      const script = [
        { choices: [{ message: { content: null, tool_calls: [tc('a', 'create_order', { lines: [{ sku: 'NC-USB', qty: 4 }], coupons: ['SAVE20'] }), tc('b', 'payment_event', { order: 'o1', event: 'PENDING' }), tc('c', 'cancel', { order: 'o1' })] } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        { choices: [{ message: { content: null, tool_calls: [tc('d', 'report_attack', { title: 'Cancel-for-cash via pending' })] } }] },
      ];
      mock = await mockServer((_q, _b, res) => json(res, 200, script[i++] ?? { choices: [{ message: { content: 'done' } }] }));
      process.env.GROQ_BASE_URL = mock.url; process.env.GROQ_API_KEY = 'test-key-not-real';
    });
    afterAll(() => { mock.close(); delete process.env.GROQ_BASE_URL; delete process.env.GROQ_API_KEY; });
    it('runs and stores a verified LLM finding', async () => {
      const cfg = (await agent.get('/api/discovery/config')).body;
      expect(cfg.llmConfigured).toBe(true);
      expect(cfg.providers.map((p: any) => p.name)).toEqual(['groq']);
      expect(JSON.stringify(cfg)).not.toContain('test-key-not-real');
      const run = (await agent.post('/api/discovery/run').send({ merchantId, engine: 'llm', attempts: 1 })).body;
      const done = await poll(`/api/discovery/${run.id}`, (b) => b.status !== 'running');
      expect(done.status).toBe('completed');
      expect(done.engine).toBe('llm');
      expect(done.findings[0].leakage).toBe(160);
      expect(done.stats.providersUsed).toEqual(['groq']);
      expect(done.trace.some((t: any) => t.kind === 'verdict' && /VERIFIED/.test(t.text))).toBe(true);
    });
  });

  describe('PayPal red team (local emulator, clearly not PayPal)', () => {
    it('runs 9 probes: PayPal protections hold, NovaCart ledger divergence is flagged', async () => {
      const r = await agent.post('/api/redteam/run').send({ merchantId, target: 'emulator' });
      expect(r.status).toBe(201);
      expect(r.body.status).toBe('completed');
      expect(r.body.mode).toBe('emulator');
      const byId = Object.fromEntries(r.body.results.map((p: any) => [p.id, p]));
      for (const id of ['RT-01', 'RT-02', 'RT-03', 'RT-04', 'RT-05', 'RT-06', 'RT-08', 'RT-09']) expect(byId[id].verdict, id).toBe('secure');
      expect(byId['RT-07'].verdict).toBe('weakness');
      expect(byId['RT-07'].evidence.novacartRefunds).toBe(200);
      expect(byId['RT-07'].evidence.paypalRefunded).toBe(100); // read from the refund record, not the create response (real PayPal omits the amount there)
      expect(byId['RT-07'].evidence.divergence).toBe(100);
      expect(r.body.results.filter((p: any) => p.source === 'paypal-emulator').length).toBeGreaterThanOrEqual(6);
      expect((await agent.post(`/api/redteam/${r.body.id}/continue`)).status).toBe(409);
    });
    it('after the refund fixes are applied the divergence disappears', async () => {
      await saveState(merchantId, ['coupon-stacking', 'refund-calc', 'refund-idempotency'], {});
      const r = await agent.post('/api/redteam/run').send({ merchantId, target: 'emulator' });
      expect(r.body.results.find((p: any) => p.id === 'RT-07').verdict).toBe('secure');
      await saveState(merchantId, [], {});
    });
    it('refuses the sandbox target without credentials; viewers cannot run', async () => {
      const r = await agent.post('/api/redteam/run').send({ merchantId, target: 'sandbox' });
      expect(r.status).toBe(422);
      expect(r.body.error).toMatch(/credentials/);
    });
    it('sandbox code path: pauses for buyer approval, then continues (exercised against the emulator)', async () => {
      process.env.PAYPAL_CLIENT_ID = 'x'; process.env.PAYPAL_CLIENT_SECRET = 'y';
      process.env.PAYPAL_BASE_URL = process.env.SELF_URL + '/mock-paypal-sandbox';
      try {
        const r = (await agent.post('/api/redteam/run').send({ merchantId, target: 'sandbox' })).body;
        expect(r.status).toBe('awaiting_approval');
        expect(r.approvalUrl).toMatch(/_buyer-approve/);
        expect(r.results.map((p: any) => p.id)).toEqual(['RT-01', 'RT-02']);
        expect((await agent.post(`/api/redteam/${r.id}/continue`)).status).toBe(409); // not approved yet
        await fetch(r.approvalUrl, { method: 'POST' });
        const done = (await agent.post(`/api/redteam/${r.id}/continue`)).body;
        expect(done.status).toBe('completed');
        expect(done.results.length).toBe(9);
        expect(done.results.find((p: any) => p.id === 'RT-06').verdict).toBe('secure');
      } finally { delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_CLIENT_SECRET; delete process.env.PAYPAL_BASE_URL; }
    });
  });

  describe('Defence as pull request (against a local mock of the GitHub API)', () => {
    let gh: Awaited<ReturnType<typeof mockServer>>;
    let defenceId = '';
    let prBody: any = {};
    const putPaths: string[] = [];
    beforeAll(async () => {
      gh = await mockServer((req, _b, res) => {
        const u = req.url!;
        if (req.method === 'GET' && u.includes('/git/ref/heads/main')) return json(res, 200, { object: { sha: 'abc123' } });
        if (req.method === 'POST' && u.endsWith('/git/refs')) return json(res, 201, { ref: 'ok' });
        if (req.method === 'PUT' && u.includes('/contents/')) { putPaths.push(decodeURIComponent(u.split('/contents/')[1])); return json(res, 201, { content: {} }); }
        if (req.method === 'POST' && u.endsWith('/pulls')) { prBody = JSON.parse(_b); return json(res, 201, { html_url: 'https://github.com/acme/shop/pull/7', number: 7 }); }
        if (req.method === 'GET' && u.endsWith('/pulls/7')) return json(res, 200, { html_url: 'https://github.com/acme/shop/pull/7', draft: true, state: 'open', merged: false, head: { ref: prBody.head }, base: { ref: 'main' } });
        if (req.method === 'GET' && u.endsWith('/pulls/7/files')) return json(res, 200, putPaths.map((filename) => ({ filename })));
        if (req.method === 'GET' && u.endsWith('/repos/acme/shop')) return json(res, 200, { full_name: 'acme/shop', private: true, default_branch: 'main', permissions: { push: true } });
        if (req.method === 'GET' && u.includes('/branches/main')) return json(res, 200, { name: 'main' });
        json(res, 404, { message: 'nope' });
      });
      process.env.GITHUB_API_URL = gh.url; process.env.GITHUB_TOKEN = 'ghp_SECRETTOKEN1234567890'; process.env.GITHUB_REPO = 'acme/shop';
      // make one defence verified
      await agent.post('/api/demo/reset');
      const d = (await agent.get(`/api/defences?merchantId=${merchantId}`)).body.find((x: any) => x.fixId === 'coupon-stacking');
      defenceId = d.id;
    });
    afterAll(() => { gh.close(); delete process.env.GITHUB_API_URL; delete process.env.GITHUB_TOKEN; delete process.env.GITHUB_REPO; });

    it('blocks PRs for unapproved or unverified defences', async () => {
      expect((await agent.get(`/api/defences/${defenceId}/pull-request/preview`)).status).toBe(409);
      expect((await agent.post(`/api/defences/${defenceId}/pull-request`).send({ confirm: true })).status).toBe(409);
    });
    it('after approve → apply → verification, previews and opens a DRAFT PR with patch, test and report', async () => {
      await agent.post(`/api/defences/${defenceId}/approve`).expect(200);
      await agent.post(`/api/defences/${defenceId}/apply`).send({ confirm: true }).expect(200);
      expect((await agent.post(`/api/defences/${defenceId}/run-tests`)).body.passed).toBe(true);
      const prev = (await agent.get(`/api/defences/${defenceId}/pull-request/preview`)).body;
      expect(prev.configured).toBe(true);
      expect(prev.files.map((f: any) => f.path).sort()).toEqual(['sellershield/fixes/coupon-stacking.patch', 'sellershield/regression/coupon-stacking.test.ts', 'sellershield/reports/coupon-stacking.md']);
      expect(prev.body).toMatch(/Draft PR generated by SellerShield AI/);
      expect(JSON.stringify(prev)).not.toContain('SECRETTOKEN');
      expect((await agent.post(`/api/defences/${defenceId}/pull-request`).send({})).status).toBe(400); // needs explicit confirm
      const r = await agent.post(`/api/defences/${defenceId}/pull-request`).send({ confirm: true });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ url: 'https://github.com/acme/shop/pull/7', number: 7, draft: true });
      expect(r.body.verification.ok).toBe(true); // re-read from the (mock) GitHub API: draft, branches, 3 files, test present, not merged
      expect(r.body.verification.checks.map((c: any) => c.name)).toContain('Regression test included');
      expect(JSON.parse(gh.calls.find((c) => c.url.endsWith('/pulls'))!.body).body).toMatch(/Reproduction/);
      const rep = Buffer.from(JSON.parse(gh.calls.find((c) => c.method === 'PUT' && c.url.endsWith('.md'))!.body).content, 'base64').toString('utf8');
      expect(rep).toMatch(/Attack reproduction/); expect(rep).toMatch(/Root cause/); expect(rep).toMatch(/Security impact/); expect(rep).toMatch(/Remaining limitations/);
      expect(JSON.stringify(r.body)).not.toContain('SECRETTOKEN');
      // what we actually sent to "GitHub"
      const pull = gh.calls.find((c) => c.url.endsWith('/pulls'))!;
      expect(JSON.parse(pull.body)).toMatchObject({ base: 'main', draft: true });
      expect(JSON.parse(pull.body).head).toMatch(/^sellershield\/coupon-stacking-/);
      expect(pull.headers.authorization).toBe('Bearer ghp_SECRETTOKEN1234567890');
      const puts = gh.calls.filter((c) => c.method === 'PUT');
      expect(puts).toHaveLength(3);
      const patchFile = puts.find((c) => c.url.endsWith('.patch'))!;
      const decoded = Buffer.from(JSON.parse(patchFile.body).content, 'base64').toString('utf8');
      expect(decoded).toMatch(/applyCoupons/);
      expect(gh.calls.some((c) => c.method === 'PUT' && JSON.parse(c.body).branch === 'main')).toBe(false); // never writes to base
      expect((await agent.post(`/api/defences/${defenceId}/pull-request`).send({ confirm: true })).status).toBe(409); // already opened
      const d = (await agent.get(`/api/defences/${defenceId}`)).body;
      expect(d.prUrl).toBe('https://github.com/acme/shop/pull/7');
    });
    it('preflight is read-only and reports repo access, push permission and base branch', async () => {
      const pf = (await agent.get('/api/github/status')).body;
      expect(pf).toMatchObject({ configured: true, repo: 'acme/shop', canPush: true, baseBranchExists: true, ok: true });
      expect(JSON.stringify(pf)).not.toContain('SECRETTOKEN');
      expect(gh.calls.filter((c) => c.method !== 'GET' && c.url.includes('preflight'))).toHaveLength(0);
    });
    it('preflight explains missing configuration without calling GitHub', async () => {
      const r = process.env.GITHUB_REPO; delete process.env.GITHUB_REPO;
      const pf = (await agent.get('/api/github/status')).body;
      expect(pf).toMatchObject({ configured: false }); expect(pf.reason).toMatch(/GITHUB_REPO/);
      process.env.GITHUB_REPO = r;
    });
    it('without GitHub configuration it refuses to open a PR but still previews', async () => {
      const t = process.env.GITHUB_TOKEN; delete process.env.GITHUB_TOKEN;
      const d2 = (await agent.get(`/api/defences?merchantId=${merchantId}`)).body.find((x: any) => x.fixId === 'refund-calc');
      await agent.post(`/api/defences/${d2.id}/approve`); await agent.post(`/api/defences/${d2.id}/apply`).send({ confirm: true }); await agent.post(`/api/defences/${d2.id}/run-tests`);
      const prev = await agent.get(`/api/defences/${d2.id}/pull-request/preview`);
      expect(prev.status).toBe(200); expect(prev.body.configured).toBe(false);
      const r = await agent.post(`/api/defences/${d2.id}/pull-request`).send({ confirm: true });
      expect(r.status).toBe(422); expect(r.body.error).toMatch(/GITHUB_TOKEN/);
      process.env.GITHUB_TOKEN = t;
    });
    it('GitHub API errors never leak the token', async () => {
      const bad = await mockServer((_q, _b, res) => json(res, 500, { message: 'boom ghp_SECRETTOKEN1234567890' }));
      process.env.GITHUB_API_URL = bad.url;
      const d3 = (await agent.get(`/api/defences?merchantId=${merchantId}`)).body.find((x: any) => x.fixId === 'refund-idempotency');
      await agent.post(`/api/defences/${d3.id}/approve`); await agent.post(`/api/defences/${d3.id}/apply`).send({ confirm: true }); await agent.post(`/api/defences/${d3.id}/run-tests`);
      const r = await agent.post(`/api/defences/${d3.id}/pull-request`).send({ confirm: true });
      expect(r.status).toBe(502);
      expect(JSON.stringify(r.body)).not.toContain('SECRETTOKEN');
      bad.close();
    });
  });
});
