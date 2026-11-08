/**
 * Business rules of the NovaCart sample application.
 * Every rule exists as a *Vulnerable and a *Secure variant. The Defence Architect's patches are real
 * diffs between these two implementations, and applying a fix switches the sample app to the secure rule.
 * Keep these functions self-contained (no nested named helpers) so their source reads cleanly in a diff.
 */

export type Role = 'admin' | 'manager' | 'support' | 'intern';

export interface Coupon {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  expired: boolean;
}

export interface OrderLike {
  id: string;
  subtotal: number;
  total: number;
  refunded: number;
  lines: { sku: string; qty: number; unitPrice: number }[];
  refundedQty: Record<string, number>;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------- discounts
export function applyCouponsVulnerable(subtotal: number, coupons: Coupon[]) {
  let running = subtotal;
  const applied: string[] = [];
  for (const c of coupons) {
    running = c.type === 'percent' ? running * (1 - c.value / 100) : running - c.value;
    applied.push(c.code);
  }
  return { total: Math.max(0, Math.round(running * 100) / 100), applied };
}

export function applyCouponsSecure(subtotal: number, coupons: Coupon[]) {
  // Policy: at most ONE coupon per order. The first valid coupon wins; the rest are rejected.
  const first = coupons[0];
  if (!first) return { total: subtotal, applied: [] as string[] };
  const running = first.type === 'percent' ? subtotal * (1 - first.value / 100) : subtotal - first.value;
  return { total: Math.max(0, Math.round(running * 100) / 100), applied: [first.code] };
}

// ------------------------------------------------------------ refund amount
export function calcRefundVulnerable(order: OrderLike, sku: string, qty: number) {
  const line = order.lines.find((l) => l.sku === sku);
  if (!line) return { error: 'unknown_line' as const };
  const amount = Math.round(line.unitPrice * qty * 100) / 100; // BUG: ignores the discount actually paid
  if (order.refunded + amount > order.subtotal + 0.005) return { error: 'exceeds_order_value' as const };
  return { amount };
}

export function calcRefundSecure(order: OrderLike, sku: string, qty: number) {
  const line = order.lines.find((l) => l.sku === sku);
  if (!line) return { error: 'unknown_line' as const };
  // Allocate the discount proportionally, then cap at what is still refundable.
  const share = (line.unitPrice * qty) / order.subtotal;
  const remaining = Math.round((order.total - order.refunded) * 100) / 100;
  const amount = Math.min(Math.round(order.total * share * 100) / 100, remaining);
  if (amount <= 0) return { error: 'nothing_refundable' as const };
  return { amount };
}

// ----------------------------------------------------------- refund replays
export function guardRefundVulnerable(order: OrderLike, sku: string, qty: number, seen: Map<string, unknown>, idemKey?: string) {
  return {}; // BUG: no idempotency key, no remaining-quantity check
}

export function guardRefundSecure(order: OrderLike, sku: string, qty: number, seen: Map<string, unknown>, idemKey?: string) {
  if (!idemKey) return { error: 'idempotency_key_required' as const };
  if (seen.has(order.id + ':' + idemKey)) return { replay: seen.get(order.id + ':' + idemKey) };
  const line = order.lines.find((l) => l.sku === sku);
  const already = order.refundedQty[sku] || 0;
  if (!line || already + qty > line.qty) return { error: 'exceeds_purchased_quantity' as const };
  return {};
}

// --------------------------------------------------------------- inventory
export function reserveBatchVulnerable(stock: Record<string, number>, reqs: { sku: string; qty: number }[]) {
  // BUG: every request reads the stock level first, then writes (check-then-act race).
  const seen = reqs.map((r) => stock[r.sku] || 0);
  const results: boolean[] = [];
  for (let i = 0; i < reqs.length; i++) {
    if (seen[i] >= reqs[i].qty) {
      stock[reqs[i].sku] = (stock[reqs[i].sku] || 0) - reqs[i].qty;
      results.push(true);
    } else results.push(false);
  }
  return results;
}

export function reserveBatchSecure(stock: Record<string, number>, reqs: { sku: string; qty: number }[]) {
  // Atomic check-and-decrement (conditional update), one request at a time.
  const results: boolean[] = [];
  for (const r of reqs) {
    if ((stock[r.sku] || 0) >= r.qty) {
      stock[r.sku] = (stock[r.sku] || 0) - r.qty;
      results.push(true);
    } else results.push(false);
  }
  return results;
}

// ----------------------------------------------------------- payment state
export type PayStatus = 'created' | 'payment_pending' | 'paid' | 'payment_failed' | 'fulfilled' | 'cancelled';

export function transitionVulnerable(current: PayStatus, event: 'PENDING' | 'COMPLETED' | 'DENIED') {
  if (event === 'PENDING') return { next: 'paid' as PayStatus, settled: false }; // BUG: pending treated as paid
  if (event === 'COMPLETED') return { next: 'paid' as PayStatus, settled: true };
  return { next: current === 'paid' || current === 'fulfilled' ? current : ('payment_failed' as PayStatus), settled: false };
}

export function transitionSecure(current: PayStatus, event: 'PENDING' | 'COMPLETED' | 'DENIED') {
  if (current === 'cancelled') return { next: current, settled: false, error: 'invalid_transition' as const };
  if (event === 'PENDING') return { next: current === 'created' ? ('payment_pending' as PayStatus) : current, settled: false };
  if (event === 'COMPLETED') return { next: current === 'fulfilled' ? current : ('paid' as PayStatus), settled: true };
  return { next: 'payment_failed' as PayStatus, settled: false };
}

// ------------------------------------------------------------- permissions
export function authorizeRefundVulnerable(actor: Role, amount: number, approvedBy?: string) {
  return { allowed: true, audited: false }; // BUG: any staff role, any amount, no approval, no audit record
}

export function authorizeRefundSecure(actor: Role, amount: number, approvedBy?: string) {
  if (actor !== 'admin' && actor !== 'manager') return { allowed: false, audited: true, error: 'forbidden_role' as const };
  if (amount > 100 && !approvedBy) return { allowed: false, audited: true, error: 'approval_required' as const };
  return { allowed: true, audited: true };
}
