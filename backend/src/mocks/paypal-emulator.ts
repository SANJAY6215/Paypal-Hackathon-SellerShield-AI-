import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';

/**
 * LOCAL PAYPAL API EMULATOR - NOT PAYPAL.
 * Models the documented behaviours the red team probes (OAuth, Orders v2, capture, refunds, PayPal-Request-Id idempotency,
 * webhook-verification response shape) so the real HTTP client code path can be exercised without credentials.
 * It must never be presented as evidence about PayPal's real behaviour; real Sandbox runs are separate and labelled.
 */
export function createPayPalEmulator(publicBase: () => string) {
  const r = Router();
  const orders = new Map<string, any>();
  const captures = new Map<string, any>();
  const refunds = new Map<string, any>();
  const memo = new Map<string, { status: number; body: any }>(); // PayPal-Request-Id replay cache
  const id = (p: string) => p + '-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const err = (res: Response, status: number, name: string, issue: string, message: string) => res.status(status).json({ name, message, debug_id: id('EMU'), details: [{ issue, description: message }] });
  const remembered = (req: Request, res: Response, scope: string) => {
    const k = req.header('paypal-request-id');
    if (!k) return false;
    const hit = memo.get(scope + ':' + k);
    if (!hit) return false;
    res.status(hit.status).json(hit.body);
    return true;
  };
  const remember = (req: Request, scope: string, status: number, body: any) => { const k = req.header('paypal-request-id'); if (k) memo.set(scope + ':' + k, { status, body }); };

  r.post('/v1/oauth2/token', (req, res) => {
    if (!req.header('authorization')?.startsWith('Basic ')) return err(res, 401, 'invalid_client', 'AUTH', 'Client Authentication failed');
    res.json({ access_token: 'EMU-' + crypto.randomBytes(8).toString('hex'), token_type: 'Bearer', expires_in: 3000 });
  });
  r.use('/v2', (req, res, next) => (req.header('authorization')?.startsWith('Bearer EMU-') ? next() : err(res, 401, 'AUTHENTICATION_FAILURE', 'AUTH', 'Authentication failed due to invalid authentication credentials')));

  r.post('/v2/checkout/orders', (req, res) => {
    if (remembered(req, res, 'create')) return;
    const amt = req.body?.purchase_units?.[0]?.amount;
    if (!amt?.value || isNaN(Number(amt.value))) return err(res, 422, 'UNPROCESSABLE_ENTITY', 'INVALID_PARAMETER_VALUE', 'Invalid amount');
    const o = { id: id('EMUORD'), intent: 'CAPTURE', status: 'CREATED', purchase_units: [{ amount: { currency_code: amt.currency_code || 'USD', value: Number(amt.value).toFixed(2) }, payments: { captures: [] as any[] } }], links: [] as any[] };
    o.links.push({ rel: 'approve', href: `${publicBase()}/_buyer-approve/${o.id}` });
    orders.set(o.id, o);
    remember(req, 'create', 201, o);
    res.status(201).json(o);
  });
  r.get('/v2/checkout/orders/:id', (req, res) => { const o = orders.get(req.params.id); return o ? res.json(o) : err(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource does not exist'); });
  r.post('/v2/checkout/orders/:id/capture', (req, res) => {
    if (remembered(req, res, 'capture:' + req.params.id)) return;
    const o = orders.get(req.params.id);
    if (!o) return err(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource does not exist');
    if (o.status === 'COMPLETED') return err(res, 422, 'UNPROCESSABLE_ENTITY', 'ORDER_ALREADY_CAPTURED', 'Order already captured.');
    if (o.status !== 'APPROVED') return err(res, 422, 'UNPROCESSABLE_ENTITY', 'ORDER_NOT_APPROVED', 'Payer has not yet approved the Order for payment.');
    const cap = { id: id('EMUCAP'), status: 'COMPLETED', amount: o.purchase_units[0].amount, refunded: 0 };
    captures.set(cap.id, cap);
    o.status = 'COMPLETED';
    o.purchase_units[0].payments.captures.push({ id: cap.id, status: cap.status, amount: cap.amount });
    remember(req, 'capture:' + req.params.id, 201, o);
    res.status(201).json(o);
  });
  r.post('/v2/payments/captures/:id/refund', (req, res) => {
    if (remembered(req, res, 'refund:' + req.params.id)) return;
    const c = captures.get(req.params.id);
    if (!c) return err(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource does not exist');
    const total = Number(c.amount.value);
    const amount = req.body?.amount?.value !== undefined ? Number(req.body.amount.value) : Math.round((total - c.refunded) * 100) / 100;
    if (c.refunded >= total - 0.001) return err(res, 422, 'UNPROCESSABLE_ENTITY', 'CAPTURE_FULLY_REFUNDED', 'The capture has already been fully refunded.');
    if (!(amount > 0) || amount > Math.round((total - c.refunded) * 100) / 100 + 0.001) return err(res, 422, 'UNPROCESSABLE_ENTITY', 'REFUND_AMOUNT_EXCEEDED', 'The refund amount must be less than or equal to the capture amount that has not yet been refunded.');
    c.refunded = Math.round((c.refunded + amount) * 100) / 100;
    const rf = { id: id('EMURF'), status: 'COMPLETED', amount: { currency_code: c.amount.currency_code, value: amount.toFixed(2) } };
    refunds.set(rf.id, rf);
    refunds.set(rf.id, rf);
    const created = { id: rf.id, status: rf.status, links: [] }; // real PayPal's create-refund response omits `amount`
    remember(req, 'refund:' + req.params.id, 201, created);
    res.status(201).json(created);
  });
  r.get('/v2/payments/refunds/:id', (req, res) => { const x = refunds.get(req.params.id); return x ? res.json(x) : err(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource does not exist'); });
  r.post('/v1/notifications/verify-webhook-signature', (req, res) => res.json({ verification_status: req.body?.transmission_sig === 'EMU-VALID-SIGNATURE' ? 'SUCCESS' : 'FAILURE' }));

  // emulator-only: stands in for the buyer clicking "Approve" on PayPal
  r.post('/_buyer-approve/:id', (req, res) => { const o = orders.get(req.params.id); if (!o) return err(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'no such order'); o.status = 'APPROVED'; res.json({ id: o.id, status: o.status }); });
  return r;
}
