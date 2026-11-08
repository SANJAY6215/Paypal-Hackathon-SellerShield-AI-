import * as R from './rules';
import type { Coupon, PayStatus, Role } from './rules';
export { round2 } from './rules';
export type { Role, PayStatus };

export type FixId = 'coupon-stacking' | 'refund-calc' | 'refund-idempotency' | 'inventory-race' | 'payment-state' | 'refund-permission';
export const ALL_FIXES: FixId[] = ['coupon-stacking', 'refund-calc', 'refund-idempotency', 'inventory-race', 'payment-state', 'refund-permission'];

export const CATALOG: Record<string, { name: string; price: number; stock: number }> = {
  'NC-USB': { name: 'USB-C Hub 7-in-1', price: 50, stock: 100 },
  'NC-CHG': { name: 'GaN Charger 65W', price: 30, stock: 100 },
  'NC-CASE': { name: 'Rugged Phone Case', price: 20, stock: 100 },
  'NC-HEADSET': { name: 'Limited Edition Headset', price: 120, stock: 3 },
};

export const COUPONS: Record<string, Coupon> = {
  SAVE20: { code: 'SAVE20', type: 'percent', value: 20, expired: false },
  VIP15: { code: 'VIP15', type: 'percent', value: 15, expired: false },
  WELCOME10: { code: 'WELCOME10', type: 'fixed', value: 10, expired: false },
  EXPIRED5: { code: 'EXPIRED5', type: 'percent', value: 5, expired: true },
};

/** Documented business policy of the sample merchant (used by oracles, not by the vulnerable code). */
export const POLICY = {
  maxCouponsPerOrder: 1,
  refundApprovalThreshold: 100,
  refundRoles: ['admin', 'manager'] as Role[],
};

export interface Order {
  id: string;
  lines: { sku: string; qty: number; unitPrice: number }[];
  subtotal: number;
  discount: number;
  total: number;
  coupons: string[];
  status: PayStatus;
  settled: number; // real cash received for this order (only COMPLETED payments settle)
  refunded: number;
  refundedQty: Record<string, number>;
  fulfilled: boolean;
}
export interface Refund { id: string; orderId: string; amount: number; actor: Role; idemKey?: string; sku: string; qty: number }
export interface Step { n: number; action: string; expected: string; actual: string; evidence: Record<string, unknown> }

export class Shop {
  stock: Record<string, number> = {};
  initialStock: Record<string, number> = {};
  orders = new Map<string, Order>();
  refunds: Refund[] = [];
  audit: { actor: Role; action: string; orderId: string; amount: number }[] = [];
  couponRules: Record<string, Coupon> = JSON.parse(JSON.stringify(COUPONS));
  private seq = 0;
  private orderIdem = new Map<string, string>();
  private refundSeen = new Map<string, unknown>();
  private events = new Set<string>();
  cashIn = 0;
  cashOut = 0;

  constructor(public fixes: Set<FixId>) {
    for (const [sku, p] of Object.entries(CATALOG)) {
      this.stock[sku] = p.stock;
      this.initialStock[sku] = p.stock;
    }
  }
  fixed(f: FixId) { return this.fixes.has(f); }
  private id(prefix: string) { return `${prefix}-${String(++this.seq).padStart(4, '0')}`; }

  createOrder(lines: { sku: string; qty: number }[], couponCodes: string[] = [], idemKey?: string) {
    if (idemKey && this.orderIdem.has(idemKey)) return { ok: true as const, order: this.orders.get(this.orderIdem.get(idemKey)!)!, replay: true, rejectedCoupons: [] as string[] };
    const priced: Order['lines'] = [];
    for (const l of lines) {
      const p = CATALOG[l.sku];
      if (!p) return { ok: false as const, error: 'unknown_product' };
      if (!Number.isInteger(l.qty) || l.qty <= 0) return { ok: false as const, error: 'invalid_quantity' };
      priced.push({ sku: l.sku, qty: l.qty, unitPrice: p.price });
    }
    const reserve = this.fixed('inventory-race') ? R.reserveBatchSecure : R.reserveBatchVulnerable;
    const ok = reserve(this.stock, priced.map((l) => ({ sku: l.sku, qty: l.qty })));
    if (ok.some((x) => !x)) {
      // roll back lines that did reserve
      priced.forEach((l, i) => { if (ok[i]) this.stock[l.sku] += l.qty; });
      return { ok: false as const, error: 'out_of_stock' };
    }
    const subtotal = R.round2(priced.reduce((s, l) => s + l.qty * l.unitPrice, 0));
    // coupon validation shared by both variants: unknown / expired / exact duplicates are rejected
    const rejected: string[] = [];
    const valid: Coupon[] = [];
    for (const code of couponCodes) {
      const c = this.couponRules[code];
      if (!c || c.expired || valid.some((v) => v.code === code)) rejected.push(code);
      else valid.push(c);
    }
    const apply = this.fixed('coupon-stacking') ? R.applyCouponsSecure : R.applyCouponsVulnerable;
    const { total, applied } = apply(subtotal, valid);
    if (this.fixed('coupon-stacking')) rejected.push(...valid.slice(1).map((c) => c.code));
    const order: Order = {
      id: this.id('ORD'), lines: priced, subtotal, total: R.round2(total), discount: R.round2(subtotal - total),
      coupons: applied, status: 'created', settled: 0, refunded: 0, refundedQty: {}, fulfilled: false,
    };
    this.orders.set(order.id, order);
    if (idemKey) this.orderIdem.set(idemKey, order.id);
    return { ok: true as const, order, rejectedCoupons: rejected };
  }

  /** Concurrent checkout of several buyers (models parallel requests deterministically). */
  createOrdersConcurrently(reqs: { sku: string; qty: number }[]) {
    const reserve = this.fixed('inventory-race') ? R.reserveBatchSecure : R.reserveBatchVulnerable;
    const ok = reserve(this.stock, reqs);
    const orders: Order[] = [];
    reqs.forEach((r, i) => {
      if (!ok[i]) return;
      const unit = CATALOG[r.sku].price;
      const o: Order = { id: this.id('ORD'), lines: [{ sku: r.sku, qty: r.qty, unitPrice: unit }], subtotal: unit * r.qty, discount: 0, total: unit * r.qty, coupons: [], status: 'created', settled: 0, refunded: 0, refundedQty: {}, fulfilled: false };
      this.orders.set(o.id, o);
      orders.push(o);
    });
    return { accepted: orders.length, orders };
  }

  applyPayment(orderId: string, event: 'PENDING' | 'COMPLETED' | 'DENIED', eventId?: string) {
    const o = this.orders.get(orderId);
    if (!o) return { ok: false as const, error: 'unknown_order' };
    if (eventId) {
      if (this.events.has(eventId)) return { ok: true as const, duplicate: true, status: o.status };
      this.events.add(eventId);
    }
    const t = (this.fixed('payment-state') ? R.transitionSecure : R.transitionVulnerable)(o.status, event) as { next: PayStatus; settled: boolean; error?: string };
    if (t.error) return { ok: false as const, error: t.error };
    o.status = t.next;
    if (t.settled && o.settled === 0) { o.settled = o.total; this.cashIn += o.total; }
    return { ok: true as const, status: o.status, settled: o.settled };
  }

  fulfill(orderId: string) {
    const o = this.orders.get(orderId);
    if (!o) return { ok: false as const, error: 'unknown_order' };
    if (o.status !== 'paid') return { ok: false as const, error: 'not_paid' };
    o.status = 'fulfilled';
    o.fulfilled = true;
    return { ok: true as const };
  }

  refund(orderId: string, sku: string, qty: number, actor: Role, idemKey?: string, approvedBy?: string) {
    const o = this.orders.get(orderId);
    if (!o) return { ok: false as const, error: 'unknown_order' };
    if (o.status === 'cancelled') return { ok: false as const, error: 'order_cancelled' };
    if (o.status !== 'paid' && o.status !== 'fulfilled') return { ok: false as const, error: 'invalid_payment_state' };
    if (!Number.isInteger(qty) || qty <= 0) return { ok: false as const, error: 'invalid_quantity' };

    const guard = (this.fixed('refund-idempotency') ? R.guardRefundSecure : R.guardRefundVulnerable)(o, sku, qty, this.refundSeen, idemKey) as { error?: string; replay?: unknown };
    if (guard.error) return { ok: false as const, error: guard.error };
    if (guard.replay) return { ok: true as const, replay: true, refund: guard.replay as Refund };

    const calc = (this.fixed('refund-calc') ? R.calcRefundSecure : R.calcRefundVulnerable)(o, sku, qty) as { amount?: number; error?: string };
    if (calc.error || calc.amount === undefined) return { ok: false as const, error: calc.error || 'calc_failed' };

    const auth = (this.fixed('refund-permission') ? R.authorizeRefundSecure : R.authorizeRefundVulnerable)(actor, calc.amount, approvedBy) as { allowed: boolean; audited: boolean; error?: string };
    if (auth.audited) this.audit.push({ actor, action: auth.allowed ? 'refund.issued' : 'refund.denied', orderId, amount: calc.amount });
    if (!auth.allowed) return { ok: false as const, error: auth.error || 'forbidden' };

    const refund: Refund = { id: this.id('RF'), orderId, amount: calc.amount, actor, idemKey, sku, qty };
    this.refunds.push(refund);
    o.refunded = R.round2(o.refunded + calc.amount);
    o.refundedQty[sku] = (o.refundedQty[sku] || 0) + qty;
    this.cashOut = R.round2(this.cashOut + calc.amount);
    if (idemKey) this.refundSeen.set(orderId + ':' + idemKey, refund);
    return { ok: true as const, refund };
  }

  cancel(orderId: string, actor: Role = 'support') {
    const o = this.orders.get(orderId);
    if (!o) return { ok: false as const, error: 'unknown_order' };
    if (o.status === 'cancelled') return { ok: false as const, error: 'already_cancelled' };
    if (o.fulfilled) return { ok: false as const, error: 'already_fulfilled' };
    let refunded = 0;
    if (o.status === 'paid') {
      refunded = R.round2(o.total - o.refunded);
      if (refunded > 0) {
        this.refunds.push({ id: this.id('RF'), orderId, amount: refunded, actor, sku: '*', qty: 0 });
        o.refunded = o.total;
        this.cashOut = R.round2(this.cashOut + refunded);
      }
    }
    for (const l of o.lines) this.stock[l.sku] += l.qty - (o.refundedQty[l.sku] || 0);
    o.status = 'cancelled';
    return { ok: true as const, refunded };
  }

  updateCouponRule(actor: Role, code: string, patch: Partial<Coupon>) {
    if (actor !== 'admin') return { ok: false as const, error: 'forbidden_role' };
    this.couponRules[code] = { ...this.couponRules[code], ...patch };
    return { ok: true as const };
  }

  /** Pay an order fully (helper used by scenarios). */
  pay(orderId: string, eventId?: string) { return this.applyPayment(orderId, 'COMPLETED', eventId); }
}

/** Independent ledger invariants used by the Independent Auditor (separate from scenario logic). */
export function auditLedger(shop: Shop): string[] {
  const v: string[] = [];
  for (const o of shop.orders.values()) {
    if (o.refunded > o.total + 0.005) v.push(`over-refund: order ${o.id} refunded ${o.refunded} > paid total ${o.total}`);
    if (o.fulfilled && o.settled + 0.005 < o.total && o.status !== 'cancelled') v.push(`unsettled-fulfilment: order ${o.id} shipped with ${o.settled} settled of ${o.total}`);
    if (o.refunded > o.settled + 0.005) v.push(`refund-without-settlement: order ${o.id} refunded ${o.refunded} but only ${o.settled} was ever settled`);
    if (o.coupons.length > POLICY.maxCouponsPerOrder) v.push(`discount-policy: order ${o.id} stacked ${o.coupons.length} coupons (max ${POLICY.maxCouponsPerOrder})`);
    for (const l of o.lines) {
      const r = o.refundedQty[l.sku] || 0;
      if (r > l.qty) v.push(`refund-quantity: order ${o.id} refunded ${r}x ${l.sku} of ${l.qty} purchased`);
    }
  }
  const keys = new Map<string, number>();
  for (const r of shop.refunds) {
    if (r.sku === '*') continue;
    const o = shop.orders.get(r.orderId);
    if (o) {
      const line = o.lines.find((l) => l.sku === r.sku);
      const entitled = line ? o.total * ((line.unitPrice * r.qty) / o.subtotal) : 0;
      if (r.amount > entitled + 0.01) v.push(`refund-allocation: ${r.id} paid ${r.amount} for ${r.qty}x ${r.sku}, entitlement is ${Math.round(entitled * 100) / 100}`);
    }
    if (r.idemKey) keys.set(r.orderId + ':' + r.idemKey, (keys.get(r.orderId + ':' + r.idemKey) || 0) + 1);
  }
  for (const [k, n] of keys) if (n > 1) v.push(`duplicate-refund: request ${k} paid out ${n} times`);
  for (const [sku, n] of Object.entries(shop.stock)) if (n < 0) v.push(`oversold: ${sku} stock is ${n}`);
  for (const r of shop.refunds) if (!POLICY.refundRoles.includes(r.actor) && r.sku !== '*') v.push(`unauthorized-refund: ${r.actor} issued ${r.id} (${r.amount})`);
  const manual = shop.refunds.filter((r) => r.sku !== '*').length;
  const audited = shop.audit.filter((a) => a.action === 'refund.issued').length;
  if (manual > audited) v.push(`missing-audit: ${manual} refunds issued, ${audited} audit records`);
  return v;
}
