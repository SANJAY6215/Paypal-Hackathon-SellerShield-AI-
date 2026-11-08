import crypto from 'node:crypto';
import { prisma } from './db';
import { env } from './config';

/**
 * PayPal REST integration (Orders v2, Payments v2, Webhook verification).
 * With sandbox credentials every call goes to PayPal Sandbox. Without them the service runs in a clearly
 * labelled LOCAL SIMULATION mode: those transactions never touch PayPal and are stored with environment=local-simulation.
 */
export const ppMode = () => (env.ppClientId && env.ppSecret ? 'sandbox' : 'demo');

let tokenCache: { token: string; expiresAt: number } | null = null; // server-side only; never sent to the browser

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  const basic = Buffer.from(`${env.ppClientId}:${env.ppSecret}`).toString('base64');
  const res = await fetch(`${env.ppBase}/v1/oauth2/token`, { method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  if (!res.ok) { tokenCache = null; throw new Error(`PayPal OAuth failed (HTTP ${res.status})`); }
  const j: any = await res.json();
  tokenCache = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 300) * 1000 };
  return tokenCache.token;
}

async function pp(method: string, path: string, body?: unknown, requestId?: string) {
  if (!env.ppBase.includes('sandbox')) throw new Error('Refusing to call a non-sandbox PayPal endpoint');
  const token = await getToken();
  const res = await fetch(env.ppBase + path, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j?.message || j?.details?.[0]?.description || `PayPal HTTP ${res.status}`), { status: res.status === 404 ? 404 : 502, paypal: { name: j?.name, debug_id: j?.debug_id } });
  return j;
}

export async function status() {
  const mode = ppMode();
  const base = { mode, baseUrl: env.ppBase, webhookConfigured: !!env.ppWebhookId, label: mode === 'sandbox' ? 'PayPal Sandbox' : 'DEMO MODE - local simulation (no PayPal credentials)' };
  if (mode === 'demo') return { ...base, oauth: 'not_configured', message: 'Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to enable real Sandbox calls. Orders created now are local simulations.' };
  try { await getToken(); return { ...base, oauth: 'ok', message: 'OAuth client-credentials token obtained (cached server-side).' }; }
  catch (e: any) { return { ...base, oauth: 'failed', message: e.message }; }
}

const dec = (n: number) => n.toFixed(2);

export async function createOrder(merchantId: string, amount: number, currency = 'USD', description = 'SellerShield sandbox test order') {
  if (ppMode() === 'sandbox') {
    const j = await pp('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE', purchase_units: [{ description, amount: { currency_code: currency, value: dec(amount) } }],
      payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW', return_url: `${env.appUrl}/paypal?return=1`, cancel_url: `${env.appUrl}/paypal?cancel=1` } } },
    }, crypto.randomUUID());
    const link = (j.links || []).find((l: any) => l.rel === 'payer-action' || l.rel === 'approve');
    return prisma.sandboxTransaction.create({ data: { merchantId, paypalOrderId: j.id, amount, currency, status: j.status, environment: 'sandbox', approvalUrl: link?.href ?? null } });
  }
  return prisma.sandboxTransaction.create({ data: { merchantId, paypalOrderId: 'SIM-' + crypto.randomBytes(6).toString('hex').toUpperCase(), amount, currency, status: 'CREATED', environment: 'local-simulation' } });
}

export async function getOrder(id: string) {
  const tx = await prisma.sandboxTransaction.findUnique({ where: { paypalOrderId: id } });
  if (!tx) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (tx.environment !== 'sandbox') return tx;
  const j = await pp('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`);
  const cap = j.purchase_units?.[0]?.payments?.captures?.[0];
  return prisma.sandboxTransaction.update({ where: { id: tx.id }, data: { status: cap?.status ? `CAPTURE_${cap.status}` : j.status, captureId: cap?.id ?? tx.captureId } });
}

/** Local-simulation only: stands in for the buyer approving the order. */
export async function simulateApproval(id: string) {
  const tx = await prisma.sandboxTransaction.findUnique({ where: { paypalOrderId: id } });
  if (!tx) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (tx.environment !== 'local-simulation') throw Object.assign(new Error('Real sandbox orders must be approved by the buyer on PayPal (use the approval link)'), { status: 422 });
  if (tx.status !== 'CREATED') throw Object.assign(new Error(`Order is ${tx.status}`), { status: 409 });
  return prisma.sandboxTransaction.update({ where: { id: tx.id }, data: { status: 'APPROVED' } });
}

export async function captureOrder(id: string) {
  const tx = await prisma.sandboxTransaction.findUnique({ where: { paypalOrderId: id } });
  if (!tx) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (tx.status === 'COMPLETED' || tx.status === 'CAPTURE_COMPLETED') return tx; // idempotent: never capture twice
  if (tx.environment === 'sandbox') {
    const j = await pp('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, undefined, `capture-${id}`);
    const cap = j.purchase_units?.[0]?.payments?.captures?.[0];
    // Only COMPLETED means paid. PENDING / DECLINED are recorded as such.
    return prisma.sandboxTransaction.update({ where: { id: tx.id }, data: { captureId: cap?.id ?? null, status: cap?.status === 'COMPLETED' ? 'COMPLETED' : `CAPTURE_${cap?.status ?? j.status}` } });
  }
  if (tx.status !== 'APPROVED') throw Object.assign(new Error('Order must be approved before capture (status: ' + tx.status + ')'), { status: 422 });
  return prisma.sandboxTransaction.update({ where: { id: tx.id }, data: { captureId: 'SIMCAP-' + crypto.randomBytes(5).toString('hex').toUpperCase(), status: 'COMPLETED' } });
}

export async function refundCapture(captureId: string, amount?: number) {
  const tx = await prisma.sandboxTransaction.findFirst({ where: { captureId } });
  if (!tx) throw Object.assign(new Error('Capture not found'), { status: 404 });
  if (tx.status !== 'COMPLETED' && tx.status !== 'PARTIALLY_REFUNDED') throw Object.assign(new Error('Only completed captures can be refunded (status: ' + tx.status + ')'), { status: 422 });
  const remaining = Math.round((tx.amount - tx.refundedAmount) * 100) / 100;
  const amt = amount ?? remaining;
  if (amt <= 0 || amt > remaining + 0.001) throw Object.assign(new Error(`Refund must be between 0.01 and ${remaining.toFixed(2)}`), { status: 422 });
  let refundId: string;
  if (tx.environment === 'sandbox') {
    const j = await pp('POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, { amount: { value: dec(amt), currency_code: tx.currency } }, crypto.randomUUID());
    refundId = j.id;
    await pp('GET', `/v2/payments/refunds/${encodeURIComponent(refundId)}`).catch(() => null); // retrieve refund details
  } else refundId = 'SIMRF-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const refunded = Math.round((tx.refundedAmount + amt) * 100) / 100;
  return prisma.sandboxTransaction.update({ where: { id: tx.id }, data: { refundId, refundedAmount: refunded, status: refunded >= tx.amount - 0.001 ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
}

// ------------------------------------------------------------ webhooks
export function signSimulated(rawBody: string) {
  return crypto.createHmac('sha256', env.simWebhookSecret).update(rawBody).digest('hex');
}

export async function verifyWebhook(headers: Record<string, any>, rawBody: string): Promise<'verified' | 'verified_local_simulation' | 'failed' | 'unverifiable'> {
  const sim = headers['x-sellershield-sim-signature'];
  if (sim) {
    const expected = signSimulated(rawBody);
    const a = Buffer.from(String(sim)), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'verified_local_simulation' : 'failed';
  }
  if (ppMode() !== 'sandbox' || !env.ppWebhookId) return 'unverifiable'; // cannot verify => never trusted
  const need = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
  if (need.some((h) => !headers[h])) return 'failed';
  try {
    const body = `{"auth_algo":${JSON.stringify(headers['paypal-auth-algo'])},"cert_url":${JSON.stringify(headers['paypal-cert-url'])},"transmission_id":${JSON.stringify(headers['paypal-transmission-id'])},"transmission_sig":${JSON.stringify(headers['paypal-transmission-sig'])},"transmission_time":${JSON.stringify(headers['paypal-transmission-time'])},"webhook_id":${JSON.stringify(env.ppWebhookId)},"webhook_event":${rawBody}}`;
    const token = await getToken();
    const res = await fetch(`${env.ppBase}/v1/notifications/verify-webhook-signature`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body });
    const j: any = await res.json().catch(() => ({}));
    return res.ok && j.verification_status === 'SUCCESS' ? 'verified' : 'failed';
  } catch { return 'failed'; }
}

const EVENT_STATUS: Record<string, string> = {
  'CHECKOUT.ORDER.APPROVED': 'APPROVED',
  'PAYMENT.CAPTURE.PENDING': 'CAPTURE_PENDING',
  'PAYMENT.CAPTURE.COMPLETED': 'COMPLETED',
  'PAYMENT.CAPTURE.DENIED': 'CAPTURE_DENIED',
  'PAYMENT.CAPTURE.REFUNDED': 'REFUNDED',
  'PAYMENT.CAPTURE.REVERSED': 'REVERSED',
};

export async function processWebhook(headers: Record<string, any>, rawBody: string) {
  let event: any;
  try { event = JSON.parse(rawBody); } catch { return { code: 400, body: { error: 'Invalid JSON' } }; }
  if (!event?.id || !event?.event_type) return { code: 400, body: { error: 'Missing id or event_type' } };
  const dup = await prisma.webhookEvent.findUnique({ where: { eventId: String(event.id) } });
  if (dup) return { code: 200, body: { duplicate: true, processingStatus: dup.processingStatus, note: 'Duplicate event ignored; not processed twice' } };

  const verification = await verifyWebhook(headers, rawBody);
  const trusted = verification === 'verified' || verification === 'verified_local_simulation';
  const r = event.resource || {};
  const orderId: string | undefined = r.supplementary_data?.related_ids?.order_id ?? (String(event.event_type).startsWith('CHECKOUT.ORDER') ? r.id : undefined);
  const captureId: string | undefined = String(event.event_type).startsWith('PAYMENT.CAPTURE') ? r.id : undefined;
  let processing = trusted ? 'ignored' : 'rejected_unverified';
  const related = orderId || captureId || null;

  if (trusted && EVENT_STATUS[event.event_type]) {
    const tx = await prisma.sandboxTransaction.findFirst({ where: { OR: [...(orderId ? [{ paypalOrderId: orderId }] : []), ...(captureId ? [{ captureId }] : [])] } });
    if (tx) {
      await prisma.sandboxTransaction.update({ where: { id: tx.id }, data: { status: EVENT_STATUS[event.event_type], ...(captureId && !tx.captureId ? { captureId } : {}) } });
      processing = 'processed';
    }
  }
  try {
    await prisma.webhookEvent.create({ data: { eventId: String(event.id), eventType: String(event.event_type), verificationStatus: verification, processingStatus: processing, relatedId: related, payload: event } });
  } catch { return { code: 200, body: { duplicate: true } }; } // lost a race with a concurrent delivery
  return { code: trusted ? 200 : 401, body: { verification, processingStatus: processing } };
}
