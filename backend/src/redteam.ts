import crypto from 'node:crypto';
import { prisma } from './db';
import { env } from './config';
import { runChain } from './simulator/chains';
import { FixId } from './simulator/shop';
import { processWebhook, signSimulated } from './paypal';

/**
 * PayPal Red Team: an automated attacker that probes the PayPal Orders/Payments protocol and NovaCart's own money
 * logic, then reconciles NovaCart's ledger against PayPal's state.
 *  - target "sandbox": real calls to PayPal Sandbox (needs credentials; buyer approval is a human step).
 *  - target "emulator": calls a LOCAL EMULATOR of the documented PayPal behaviours (not PayPal). Every result carries its source.
 */
export type Target = 'sandbox' | 'emulator';
export interface Probe {
  id: string; title: string; source: 'paypal-sandbox' | 'paypal-emulator' | 'sellershield';
  request?: string; expected: string; actual: string; verdict: 'secure' | 'weakness' | 'info' | 'error'; evidence?: Record<string, unknown>;
}

class Client {
  private token: { v: string; exp: number } | null = null;
  constructor(public baseUrl: string, private id: string, private secret: string) {}
  async tok() {
    if (this.token && this.token.exp > Date.now() + 30000) return this.token.v;
    const res = await fetch(this.baseUrl + '/v1/oauth2/token', { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(`${this.id}:${this.secret}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    if (!res.ok) throw new Error(`OAuth failed (HTTP ${res.status})`);
    const j: any = await res.json();
    this.token = { v: j.access_token, exp: Date.now() + (j.expires_in ?? 300) * 1000 };
    return this.token.v;
  }
  async call(method: string, path: string, body?: unknown, requestId?: string): Promise<{ status: number; body: any }> {
    const res = await fetch(this.baseUrl + path, { method, headers: { authorization: 'Bearer ' + (await this.tok()), 'content-type': 'application/json', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
}

/** The create-refund response has no amount on real PayPal; read the refund record (GET) for the true amount. */
export async function refundedAmount(c: Client, created: { status: number; body: any }): Promise<number> {
  if (created.status >= 300 || !created.body?.id) return 0;
  const got = await c.call('GET', `/v2/payments/refunds/${encodeURIComponent(created.body.id)}`);
  const status = String(got.body?.status ?? created.body.status ?? '');
  if (got.status >= 300 || !['COMPLETED', 'PENDING'].includes(status)) return 0;
  return Number(got.body?.amount?.value ?? 0);
}

/** Pure reconciliation of NovaCart's ledger against PayPal's recorded refunds for the Siphon chain. */
export function reconcile(applied: Set<FixId>, paypalRefunded: number) {
  const chain = runChain(['DISC-001', 'REFUND-001', 'REFUND-002'], applied);
  const novacartRefunds = chain.actual.refundsPaid;
  const divergence = Math.round((novacartRefunds - paypalRefunded) * 100) / 100;
  return { novacartRefunds, paypalRefunded, divergence };
}

const issue = (r: { body: any }) => r.body?.details?.[0]?.issue ?? r.body?.name ?? '';

export function targetConfig(target: Target) {
  if (target === 'sandbox') {
    if (!env.ppClientId || !env.ppSecret) throw Object.assign(new Error('PayPal Sandbox credentials are not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)'), { status: 422 });
    if (!env.ppBase.includes('sandbox')) throw Object.assign(new Error('Refusing to run the red team against a non-sandbox PayPal URL'), { status: 422 });
    return { baseUrl: env.ppBase, id: env.ppClientId, secret: env.ppSecret, source: 'paypal-sandbox' as const };
  }
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_PAYPAL_EMULATOR !== 'true') throw Object.assign(new Error('Emulator disabled in production'), { status: 422 });
  const self = process.env.SELF_URL || `http://127.0.0.1:${env.port}`;
  return { baseUrl: self + '/mock-paypal', id: 'emulator-client', secret: 'emulator-secret', source: 'paypal-emulator' as const };
}

const CAPTURE_TOTAL = 126; // NovaCart "Discount-Stack Refund Siphon": customer pays $126 after stacked coupons

/** Phase A: create + protocol probes that need no buyer. Returns the order awaiting buyer approval. */
async function phaseA(c: Client, source: Probe['source'], applied: Set<FixId>) {
  const probes: Probe[] = [];
  const reqId = 'rt-create-' + crypto.randomUUID();
  const body = { intent: 'CAPTURE', purchase_units: [{ description: 'SellerShield red-team order', amount: { currency_code: 'USD', value: CAPTURE_TOTAL.toFixed(2) } }] };
  const a = await c.call('POST', '/v2/checkout/orders', body, reqId);
  const b = await c.call('POST', '/v2/checkout/orders', body, reqId);
  if (a.status >= 300) throw new Error(`Order creation failed: HTTP ${a.status} ${issue(a)}`);
  probes.push({ id: 'RT-01', title: 'Order creation is idempotent under PayPal-Request-Id', source, request: 'POST /v2/checkout/orders ×2 (same Request-Id)', expected: 'both calls return the same order id', actual: `${a.body.id} / ${b.body.id}`, verdict: a.body.id === b.body.id ? 'secure' : 'weakness', evidence: { statuses: [a.status, b.status] } });
  const orderId: string = a.body.id;
  const early = await c.call('POST', `/v2/checkout/orders/${orderId}/capture`, undefined, 'rt-early-' + crypto.randomUUID());
  probes.push({ id: 'RT-02', title: 'Unapproved order cannot be captured ("created ≠ paid")', source, request: `POST /v2/checkout/orders/${orderId}/capture`, expected: 'HTTP 422 ORDER_NOT_APPROVED', actual: `HTTP ${early.status} ${issue(early)}`, verdict: early.status === 422 ? 'secure' : 'weakness', evidence: { issue: issue(early) } });
  const link = (a.body.links ?? []).find((l: any) => l.rel === 'approve' || l.rel === 'payer-action')?.href as string | undefined;
  void applied;
  return { probes, orderId, approvalUrl: link ?? null };
}

/** Phase B: after buyer approval - capture, replay, refund replay, over-refund, reconciliation. */
async function phaseB(c: Client, source: Probe['source'], orderId: string, applied: Set<FixId>) {
  const probes: Probe[] = [];
  const o = await c.call('GET', `/v2/checkout/orders/${orderId}`);
  if (o.body.status !== 'APPROVED') throw Object.assign(new Error(`Order is ${o.body.status}, not APPROVED yet - approve it as the buyer first`), { status: 409 });
  const capReq = 'rt-cap-' + crypto.randomUUID();
  const cap1 = await c.call('POST', `/v2/checkout/orders/${orderId}/capture`, undefined, capReq);
  const cap2 = await c.call('POST', `/v2/checkout/orders/${orderId}/capture`, undefined, capReq);
  const cap3 = await c.call('POST', `/v2/checkout/orders/${orderId}/capture`, undefined, 'rt-cap2-' + crypto.randomUUID());
  const capture = cap1.body.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture?.id || capture.status !== 'COMPLETED') throw new Error(`Capture did not complete: ${capture?.status ?? 'no capture'} (HTTP ${cap1.status})`);
  const captureId: string = capture.id;
  probes.push({ id: 'RT-03', title: 'Capture replay returns the original capture (no double charge)', source, request: 'POST …/capture ×2 (same Request-Id)', expected: 'same capture id', actual: `${captureId} / ${cap2.body.purchase_units?.[0]?.payments?.captures?.[0]?.id}`, verdict: cap2.body.purchase_units?.[0]?.payments?.captures?.[0]?.id === captureId ? 'secure' : 'weakness' });
  probes.push({ id: 'RT-04', title: 'A fresh capture of an already-captured order is rejected', source, request: 'POST …/capture (new Request-Id)', expected: 'HTTP 422 ORDER_ALREADY_CAPTURED', actual: `HTTP ${cap3.status} ${issue(cap3)}`, verdict: cap3.status === 422 ? 'secure' : 'weakness' });

  // replay of the "Discount-Stack Refund Siphon" money movements against the real payment state
  const r1Id = 'rt-rf1-' + crypto.randomUUID();
  const rf1 = await c.call('POST', `/v2/payments/captures/${captureId}/refund`, { amount: { value: '100.00', currency_code: 'USD' } }, r1Id);
  const rf1b = await c.call('POST', `/v2/payments/captures/${captureId}/refund`, { amount: { value: '100.00', currency_code: 'USD' } }, r1Id);
  const rf2 = await c.call('POST', `/v2/payments/captures/${captureId}/refund`, { amount: { value: '100.00', currency_code: 'USD' } }, 'rt-rf2-' + crypto.randomUUID());
  probes.push({ id: 'RT-05', title: 'Refund replay with the same Request-Id does not pay twice', source, request: 'POST …/refund ×2 (same Request-Id, $100)', expected: 'same refund id', actual: `${rf1.body.id} / ${rf1b.body.id}`, verdict: rf1.body.id && rf1.body.id === rf1b.body.id ? 'secure' : 'weakness', evidence: { statuses: [rf1.status, rf1b.status] } });
  probes.push({ id: 'RT-06', title: 'A second $100 refund (new Request-Id) beyond the $126 capture is rejected', source, request: 'POST …/refund ($100, new Request-Id)', expected: 'HTTP 422 REFUND_AMOUNT_EXCEEDED (only $26 left)', actual: `HTTP ${rf2.status} ${issue(rf2)}`, verdict: rf2.status === 422 ? 'secure' : 'weakness' });

  // reconciliation: what NovaCart's own ledger believes vs what PayPal actually paid out
  const paypalRefunded = Math.round(((await refundedAmount(c, rf1)) + (await refundedAmount(c, rf2))) * 100) / 100;
  const { novacartRefunds, divergence: diverge } = reconcile(applied, paypalRefunded);
  probes.push({
    id: 'RT-07', title: 'Ledger reconciliation: NovaCart books vs PayPal payouts for the Siphon chain', source: 'sellershield',
    request: 'NovaCart simulator chain vs PayPal refund records', expected: 'NovaCart refunds == PayPal refunds',
    actual: `NovaCart ledger refunds $${novacartRefunds} vs PayPal refunded $${paypalRefunded}${diverge > 0 ? ` → divergence $${diverge}` : ''}`,
    verdict: diverge > 0.005 ? 'weakness' : 'secure',
    evidence: { novacartRefunds, paypalRefunded, divergence: diverge, insight: diverge > 0 ? "PayPal's capture cap stops the platform payout, but NovaCart's own refund logic would still approve and book the extra amount. The defence must live in NovaCart's refund code (refund-calc / refund-idempotency), not only at PayPal." : 'No divergence: NovaCart refund logic matches the platform limits.' },
  });
  return { probes, captureId };
}

/** SellerShield-side webhook probes: forged and replayed deliveries against OUR endpoint logic. */
async function webhookProbes(captureId: string | null): Promise<Probe[]> {
  const out: Probe[] = [];
  const ev = { id: 'WH-RT-' + crypto.randomBytes(4).toString('hex'), event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: captureId ?? 'RT-UNKNOWN' } };
  const raw = JSON.stringify(ev);
  const forged = await processWebhook({ 'x-sellershield-sim-signature': 'f'.repeat(64) }, raw);
  out.push({ id: 'RT-08', title: 'Forged webhook is rejected and not processed', source: 'sellershield', request: 'webhook with invalid signature', expected: 'verification failed, rejected_unverified', actual: `${(forged.body as any).verification} / ${(forged.body as any).processingStatus}`, verdict: (forged.body as any).processingStatus === 'rejected_unverified' ? 'secure' : 'weakness' });
  const ev2 = { ...ev, id: ev.id + '-B' };
  const raw2 = JSON.stringify(ev2);
  const h = { 'x-sellershield-sim-signature': signSimulated(raw2) };
  await processWebhook(h, raw2);
  const replay = await processWebhook(h, raw2);
  out.push({ id: 'RT-09', title: 'Replayed webhook is detected as a duplicate', source: 'sellershield', request: 'same signed event delivered twice', expected: 'second delivery flagged duplicate', actual: JSON.stringify(replay.body), verdict: (replay.body as any).duplicate ? 'secure' : 'weakness' });
  return out;
}

/** One-off repair for runs recorded before the amount fix: recompute RT-07 from PayPal's real refund record. */
export async function recomputeRt07(runId: string, applied: Set<FixId>) {
  const run = await prisma.redTeamRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error('run not found');
  const cfg = targetConfig(run.mode as Target);
  const c = new Client(cfg.baseUrl, cfg.id, cfg.secret);
  const results = run.results as any as Probe[];
  const rf = String(results.find((p) => p.id === 'RT-05')?.actual ?? '').split(' / ')[0];
  const paypalRefunded = await refundedAmount(c, { status: 201, body: { id: rf } });
  const r = reconcile(applied, paypalRefunded);
  const idx = results.findIndex((p) => p.id === 'RT-07');
  const prior = results[idx].actual;
  results[idx] = { ...results[idx], actual: `NovaCart ledger refunds $${r.novacartRefunds} vs PayPal refunded $${r.paypalRefunded}${r.divergence > 0 ? ` → divergence $${r.divergence}` : ''}`, verdict: r.divergence > 0.005 ? 'weakness' : 'secure', evidence: { ...r, correctedFrom: `earlier value "${prior}" was wrong: real PayPal omits the amount in the create-refund response; recomputed from GET /v2/payments/refunds/${rf}`, insight: results[idx].evidence?.insight } };
  await prisma.redTeamRun.update({ where: { id: runId }, data: { results: results as any } });
  return results[idx];
}

export async function startRedTeam(merchantId: string, target: Target, applied: Set<FixId>) {
  const cfg = targetConfig(target);
  const client = new Client(cfg.baseUrl, cfg.id, cfg.secret);
  const run = await prisma.redTeamRun.create({ data: { merchantId, mode: target, status: 'running', state: {}, results: [], baseUrl: cfg.baseUrl } });
  try {
    const a = await phaseA(client, cfg.source, applied);
    let results: Probe[] = a.probes;
    let state: Record<string, unknown> = { orderId: a.orderId };
    let status = 'awaiting_approval';
    if (target === 'emulator') {
      await fetch(`${cfg.baseUrl}/_buyer-approve/${a.orderId}`, { method: 'POST' }); // emulator-only stand-in for the buyer
      const b = await phaseB(client, cfg.source, a.orderId, applied);
      results = [...results, ...b.probes, ...(await webhookProbes(b.captureId))];
      state = { ...state, captureId: b.captureId };
      status = 'completed';
    }
    return prisma.redTeamRun.update({ where: { id: run.id }, data: { status, state: state as any, results: results as any, approvalUrl: status === 'completed' ? null : a.approvalUrl } });
  } catch (e: any) {
    await prisma.redTeamRun.update({ where: { id: run.id }, data: { status: 'failed', results: [{ id: 'ERR', title: 'Run failed', source: 'sellershield', expected: 'completed', actual: e.message, verdict: 'error' }] as any } });
    throw e;
  }
}

/** Sandbox only: continue after the human buyer approved the order on PayPal. */
export async function continueRedTeam(runId: string, applied: Set<FixId>) {
  const run = await prisma.redTeamRun.findUnique({ where: { id: runId } });
  if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
  if (run.status !== 'awaiting_approval') throw Object.assign(new Error(`Run is ${run.status}`), { status: 409 });
  const cfg = targetConfig(run.mode as Target);
  const client = new Client(cfg.baseUrl, cfg.id, cfg.secret);
  const st = run.state as any;
  const b = await phaseB(client, cfg.source, st.orderId, applied);
  const results = [...(run.results as any[]), ...b.probes, ...(await webhookProbes(b.captureId))];
  return prisma.redTeamRun.update({ where: { id: runId }, data: { status: 'completed', results: results as any, state: { ...st, captureId: b.captureId } as any, approvalUrl: null } });
}
