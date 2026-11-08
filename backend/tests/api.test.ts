import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';

const app = createApp();
let admin: ReturnType<typeof request.agent>;
let other: ReturnType<typeof request.agent>;
let merchantId = '';

async function waitDone(id: string) {
  for (let i = 0; i < 300; i++) {
    const r = await admin.get(`/api/assessments/${id}/status`);
    if (r.body.status === 'completed' || r.body.status === 'failed') return r.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('assessment timeout');
}

beforeAll(async () => {
  admin = request.agent(app);
  const r = await admin.post('/api/auth/demo');
  expect(r.status).toBe(200);
  merchantId = r.body.merchantId;
  other = request.agent(app);
  await other.post('/api/auth/register').send({ name: 'Eve', email: 'eve@example.com', password: 'password123' }).expect(201);
});

describe('auth and authorization', () => {
  it('requires a session', async () => { expect((await request(app).get('/api/vulnerabilities')).status).toBe(401); });
  it('rejects bad credentials and invalid input', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'demo@sellershield.ai', password: 'wrong-password' })).status).toBe(401);
    expect((await request(app).post('/api/auth/register').send({ email: 'x', password: '1' })).status).toBe(400);
  });
  it('isolates tenants: another user cannot read the demo merchant data', async () => {
    expect((await other.get(`/api/merchants/${merchantId}`)).status).toBe(404);
    expect((await other.get(`/api/dashboard?merchantId=${merchantId}`)).status).toBe(404);
    const v = (await admin.get('/api/vulnerabilities')).body.items[0];
    expect((await other.get(`/api/vulnerabilities/${v.id}`)).status).toBe(404);
    expect((await other.post(`/api/vulnerabilities/${v.id}/generate-fix`)).status).toBe(404);
  });
});

describe('seeded demo fixture is produced by the real simulator', () => {
  it('has labelled demo data with verified vulnerabilities and chains', async () => {
    const list = (await admin.get(`/api/vulnerabilities?merchantId=${merchantId}`)).body;
    expect(list.items.map((v: any) => v.testCaseId).sort()).toEqual(['ACL-001', 'DISC-001', 'INV-001', 'PAY-001', 'REFUND-001', 'REFUND-002']);
    expect(list.items.every((v: any) => v.status === 'verified')).toBe(true);
    const asm = (await admin.get(`/api/assessments?merchantId=${merchantId}`)).body.items[0];
    expect(asm.isDemoData).toBe(true);
    const ch = (await admin.get(`/api/attack-chains?merchantId=${merchantId}`)).body.items;
    expect(ch.map((c: any) => c.title).sort()).toEqual(['Discount-Stack Refund Siphon', 'Phantom Payment Insider Payout']);
  });
});

describe('live assessment, defence, verification, regression memory', () => {
  let assessmentId = '';
  let refundDefence = '';
  it('runs six agents on real backend jobs and persists results', async () => {
    const r = await admin.post('/api/demo/run').expect(202);
    assessmentId = r.body.assessmentId;
    const s = await waitDone(assessmentId);
    expect(s.status).toBe('completed');
    expect(s.isDemoData).toBe(false);
    expect(s.agents.map((a: any) => a.agentType).sort()).toEqual(['auditor', 'defence-architect', 'insider-threat', 'opportunist', 'payment-manipulation', 'refund-abuse']);
    expect(s.agents.every((a: any) => a.status === 'completed')).toBe(true);
    expect(s.agents.find((a: any) => a.agentType === 'refund-abuse').progress.total).toBe(3);
    expect(s.summary.classification.new).toBe(6);
    expect(s.summary.classification.newChains).toBe(2);
  });
  it('chain has verified steps, graph, and compound exposure above the isolated sum', async () => {
    const chains = (await admin.get(`/api/attack-chains?assessmentId=${assessmentId}`)).body.items;
    const c = chains.find((x: any) => x.signature === 'DISC-001>REFUND-001>REFUND-002');
    const d = (await admin.get(`/api/attack-chains/${c.id}`)).body;
    expect(d.steps.length).toBe(4);
    expect(d.graph.nodes.some((n: any) => n.type === 'vuln')).toBe(true);
    expect(d.exposure.perAttack).toBe(154);
    expect(d.exposure.isolatedSum).toBe(84);
    expect(d.expectedOutcome.merchantPosition).toBe(80);
    expect(d.actualOutcome.merchantPosition).toBe(-74);
    const ex = (await admin.post(`/api/attack-chains/${c.id}/execute`)).body;
    expect(ex.blocked).toBe(false);
    expect(ex.label).toMatch(/LOCAL SIMULATION/);
  });
  it('defence proposals have real diffs and passing dry-runs, but nothing is applied automatically', async () => {
    const defs = (await admin.get(`/api/defences?merchantId=${merchantId}`)).body;
    expect(defs).toHaveLength(6);
    expect(defs.every((d: any) => d.status === 'proposed')).toBe(true);
    const full = (await admin.get(`/api/defences/${defs[0].id}`)).body;
    expect(full.patch).toMatch(/^@@/m);
    expect(full.dryRun.passed).toBe(true);
    expect((await admin.get(`/api/merchants/${merchantId}`)).body.appliedFixes).toEqual([]);
    refundDefence = defs.find((d: any) => d.fixId === 'refund-calc').id;
  });
  it('enforces approve, confirm, apply and blocks shortcuts', async () => {
    expect((await admin.post(`/api/defences/${refundDefence}/apply`).send({ confirm: true })).status).toBe(409);
    expect((await admin.post(`/api/defences/${refundDefence}/run-tests`)).status).toBe(409);
    expect((await other.post(`/api/defences/${refundDefence}/approve`)).status).toBe(404);
    expect((await admin.post(`/api/defences/${refundDefence}/approve`)).status).toBe(200);
    expect((await admin.post(`/api/defences/${refundDefence}/apply`).send({})).status).toBe(400);
    expect((await admin.post(`/api/defences/${refundDefence}/apply`).send({ confirm: true })).status).toBe(200);
  });
  it('verifies the fix: attack blocked, legitimate refund works, no regressions', async () => {
    const r = (await admin.post(`/api/defences/${refundDefence}/run-tests`)).body;
    expect(r.passed).toBe(true);
    const names = r.tests.map((t: any) => t.testName).join('\n');
    expect(names).toMatch(/Original attack REFUND-001 is blocked/);
    expect(names).toMatch(/Legitimate partial refund/);
    expect(r.tests.every((t: any) => t.status === 'passed')).toBe(true);
    const v = (await admin.get('/api/vulnerabilities?merchantId=' + merchantId + '&limit=50')).body.items.find((x: any) => x.testCaseId === 'REFUND-001');
    expect(v.status).toBe('fixed');
    const rep = (await admin.post(`/api/vulnerabilities/${v.id}/reproduce`)).body;
    expect(rep.exploited).toBe(false);
    const chains = (await admin.get(`/api/attack-chains?merchantId=${merchantId}`)).body.items;
    expect(chains.find((c: any) => c.signature.startsWith('DISC')).status).toBe('verified');
  });
  it('fixing every link of a chain mitigates it; rollback reopens it', async () => {
    const defs = (await admin.get(`/api/defences?merchantId=${merchantId}`)).body.filter((d: any) => d.status === 'proposed' && ['coupon-stacking', 'refund-idempotency'].includes(d.fixId));
    expect(defs).toHaveLength(2);
    for (const d of defs) {
      await admin.post(`/api/defences/${d.id}/approve`).expect(200);
      await admin.post(`/api/defences/${d.id}/apply`).send({ confirm: true }).expect(200);
      expect((await admin.post(`/api/defences/${d.id}/run-tests`)).body.passed).toBe(true);
    }
    let chains = (await admin.get(`/api/attack-chains?merchantId=${merchantId}`)).body.items;
    expect(chains.find((c: any) => c.signature.startsWith('DISC')).status).toBe('mitigated');
    await admin.post(`/api/defences/${defs[0].id}/rollback`).expect(200);
    chains = (await admin.get(`/api/attack-chains?merchantId=${merchantId}`)).body.items;
    expect(chains.find((c: any) => c.signature.startsWith('DISC')).status).toBe('verified');
    const vulnId = (await prisma.defence.findUnique({ where: { id: defs[0].id } }))!.vulnerabilityId;
    const again = (await admin.post(`/api/vulnerabilities/${vulnId}/generate-fix`)).body;
    await admin.post(`/api/defences/${again.id}/approve`).expect(200);
    await admin.post(`/api/defences/${again.id}/apply`).send({ confirm: true }).expect(200);
    expect((await admin.post(`/api/defences/${again.id}/run-tests`)).body.passed).toBe(true);
  });
  it('re-scan marks fixed issues resolved; a config change reintroduces one and memory flags the regression', async () => {
    const a = (await admin.post('/api/assessments').send({ merchantId, mode: 'demo', start: true })).body;
    const s = await waitDone(a.id);
    expect(s.summary.classification.resolved).toBeGreaterThanOrEqual(3);
    let vulns = (await admin.get(`/api/vulnerabilities?merchantId=${merchantId}&limit=50`)).body.items;
    expect(vulns.find((v: any) => v.testCaseId === 'REFUND-001').status).toBe('resolved');
    await admin.patch(`/api/merchants/${merchantId}/config`).send({ stackableCoupons: true }).expect(200);
    const rr = (await admin.post(`/api/merchants/${merchantId}/rerun`)).body;
    const rs = await waitDone(rr.assessmentId);
    expect(rs.summary.classification.reintroduced).toBe(1);
    vulns = (await admin.get(`/api/vulnerabilities?merchantId=${merchantId}&limit=50`)).body.items;
    expect(vulns.find((v: any) => v.testCaseId === 'DISC-001').status).toBe('reintroduced');
    const mem = (await admin.get(`/api/memory?merchantId=${merchantId}`)).body;
    expect(mem.memories.some((m: any) => m.result === 'reproduced' && m.vulnerability?.testCaseId === 'DISC-001')).toBe(true);
    const dash = (await admin.get(`/api/dashboard?merchantId=${merchantId}`)).body;
    expect(dash.counts.reintroduced).toBe(1);
    expect(dash.exposure.label).toMatch(/SIMULATED/);
    const defs = (await admin.get(`/api/defences?merchantId=${merchantId}`)).body.filter((d: any) => d.fixId === 'coupon-stacking');
    expect(defs.some((d: any) => d.status === 'failed')).toBe(true);
    await admin.patch(`/api/merchants/${merchantId}/config`).send({ stackableCoupons: false }).expect(200);
  });
  it('rejects unknown config keys and viewer role cannot start assessments', async () => {
    expect((await admin.patch(`/api/merchants/${merchantId}/config`).send({ evil: true })).status).toBe(400);
    await prisma.user.update({ where: { email: 'eve@example.com' }, data: { role: 'viewer' } });
    const own = (await other.post('/api/merchants').send({ name: 'Eve Shop' })).body;
    expect((await other.post('/api/assessments').send({ merchantId: own.id, mode: 'demo' })).status).toBe(403);
  });
});

describe('PayPal integration (demo mode, local simulation)', () => {
  let orderId = '';
  let captureId = '';
  it('reports demo mode honestly', async () => {
    const s = (await admin.get('/api/paypal/status')).body;
    expect(s.mode).toBe('demo'); expect(s.label).toMatch(/DEMO MODE/); expect(s.oauth).toBe('not_configured');
  });
  it('create, cannot capture unapproved, approve, capture, partial refund, over-refund blocked', async () => {
    const o = (await admin.post('/api/paypal/orders').set('Idempotency-Key', 'k-1').send({ merchantId, amount: 50 })).body;
    expect(o.environment).toBe('local-simulation'); expect(o.paypalOrderId).toMatch(/^SIM-/);
    const o2 = (await admin.post('/api/paypal/orders').set('Idempotency-Key', 'k-1').send({ merchantId, amount: 50 })).body;
    expect(o2.paypalOrderId).toBe(o.paypalOrderId); expect(o2.idempotentReplay).toBe(true);
    orderId = o.paypalOrderId;
    expect((await admin.post(`/api/paypal/orders/${orderId}/capture`)).status).toBe(422);
    await admin.post(`/api/paypal/orders/${orderId}/approve-simulated`).expect(200);
    const c = (await admin.post(`/api/paypal/orders/${orderId}/capture`)).body;
    expect(c.status).toBe('COMPLETED'); captureId = c.captureId;
    const rf = (await admin.post(`/api/paypal/captures/${captureId}/refund`).send({ amount: 20 })).body;
    expect(rf.status).toBe('PARTIALLY_REFUNDED'); expect(rf.refundedAmount).toBe(20);
    expect((await admin.post(`/api/paypal/captures/${captureId}/refund`).send({ amount: 40 })).status).toBe(422);
  });
  it('webhooks: forged is rejected, signed is verified, duplicate is not processed twice', async () => {
    const forged = (await admin.post('/api/paypal/webhooks/simulate').send({ eventType: 'PAYMENT.CAPTURE.DENIED', orderId, forged: true })).body;
    expect(forged.verification).toBe('failed'); expect(forged.processingStatus).toBe('rejected_unverified'); expect(forged.httpStatus).toBe(401);
    const tx = (await admin.get(`/api/paypal/orders/${orderId}`)).body;
    expect(tx.status).toBe('PARTIALLY_REFUNDED');
    const ok = (await admin.post('/api/paypal/webhooks/simulate').send({ eventType: 'PAYMENT.CAPTURE.REFUNDED', orderId, eventId: 'WH-1' })).body;
    expect(ok.verification).toBe('verified_local_simulation'); expect(ok.processingStatus).toBe('processed');
    const dup = (await admin.post('/api/paypal/webhooks/simulate').send({ eventType: 'PAYMENT.CAPTURE.REFUNDED', orderId, eventId: 'WH-1' })).body;
    expect(dup.duplicate).toBe(true);
    expect(await prisma.webhookEvent.count({ where: { eventId: 'WH-1' } })).toBe(1);
  });
  it('REVERSED capture events are processed when verified (local HMAC simulation, NOT a real PayPal delivery)', async () => {
    const tx = (await admin.get('/api/paypal/transactions')).body.items.find((t: any) => t.captureId);
    const r = (await admin.post('/api/paypal/webhooks/simulate').send({ eventType: 'PAYMENT.CAPTURE.REVERSED', orderId: tx.paypalOrderId, eventId: 'WH-REV-1' })).body;
    expect(r.verification).toBe('verified_local_simulation'); expect(r.processingStatus).toBe('processed');
    expect((await admin.get(`/api/paypal/orders/${tx.paypalOrderId}`)).body.status).toBe('REVERSED');
  });
  it('rejects webhooks with missing id/event_type or non-JSON bodies, and missing PayPal headers', async () => {
    expect((await request(app).post('/api/paypal/webhooks').set('content-type', 'application/json').send(JSON.stringify({ foo: 1 }))).status).toBe(400);
    expect((await request(app).post('/api/paypal/webhooks').set('content-type', 'application/json').send('[1,2')).status).toBe(400);
  });
  it('the real webhook endpoint never trusts a PayPal-looking payload without verification', async () => {
    const payload = { id: 'WH-FAKE-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: captureId } };
    const r = await request(app).post('/api/paypal/webhooks').set('content-type', 'application/json').send(JSON.stringify(payload));
    expect(r.status).toBe(401); expect(r.body.verification).toBe('unverifiable'); expect(r.body.processingStatus).toBe('rejected_unverified');
    const hdr = await request(app).post('/api/paypal/webhooks').set({ 'content-type': 'application/json', 'paypal-transmission-id': 'x' }).send(JSON.stringify({ ...payload, id: 'WH-FAKE-2' }));
    expect(hdr.status).toBe(401);
    expect((await request(app).post('/api/paypal/webhooks').set('content-type', 'application/json').send('not json')).status).toBe(400);
  });
});

describe('uploads, website mode and reports', () => {
  it('stores text, rejects dangerous uploads', async () => {
    const ok = await admin.post(`/api/merchants/${merchantId}/documents`).attach('file', Buffer.from('Refunds within 30 days.'), 'refund-policy.txt');
    expect(ok.status).toBe(201); expect(ok.body.note).toMatch(/never executed/);
    expect((await admin.post(`/api/merchants/${merchantId}/documents`).attach('file', Buffer.from('MZ'), 'run.exe')).status).toBe(400);
    expect((await admin.post(`/api/merchants/${merchantId}/documents`).attach('file', Buffer.alloc(1_100_000, 65), 'big.txt')).status).toBe(400);
  });
  it('refuses internal or SSRF website URLs', async () => {
    for (const u of ['http://169.254.169.254/', 'http://localhost:4000', 'file:///etc/passwd']) expect((await admin.post('/api/merchants').send({ name: 'x', websiteUrl: u })).status).toBe(400);
  });
  it('generates JSON and PDF reports', async () => {
    const r = (await admin.post('/api/reports').send({ merchantId })).body;
    const j = await admin.get(`/api/reports/${r.id}/download`);
    expect(j.status).toBe(200); expect(JSON.parse(j.text).disclaimer).toMatch(/not actual merchant losses/);
    expect(JSON.parse(j.text).vulnerabilities.length).toBeGreaterThan(0);
    const p = await admin.get(`/api/reports/${r.id}/download?format=pdf`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(p.status).toBe(200); expect((p.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((await other.get(`/api/reports/${r.id}`)).status).toBe(404);
  });
});
