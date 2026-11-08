import { Shop, FixId, Step, COUPONS, CATALOG, round2 } from './shop';

export type AgentType = 'opportunist' | 'refund-abuse' | 'payment-manipulation' | 'insider-threat' | 'defence-architect' | 'auditor';
export type Category = 'discount' | 'refund' | 'payment' | 'inventory' | 'access-control' | 'business-logic';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface RunResult {
  exploited: boolean;
  steps: Step[];
  expected: Record<string, number | string | boolean>;
  actual: Record<string, number | string | boolean>;
  leakage: number; // simulated excess money per successful attack (USD)
  shop: Shop;
}

export interface Scenario {
  id: string;
  category: Category;
  agent: AgentType;
  title: string;
  severity: Severity;
  fixId?: FixId; // the fix that removes the weakness (undefined => secure baseline probe)
  businessRule: string;
  description: string;
  rootCause: string;
  preconditions: string[];
  attackSteps: string[];
  expectedSecure: string;
  vulnerableBehaviour: string;
  testData: Record<string, unknown>;
  provides: string[];
  requires: string[];
  /** Reproduction function: executes the attack against a fresh simulated shop. */
  reproduce: (fixes: Set<FixId>) => RunResult;
  /** Ledger-based leakage computed independently of the reproduction (used by the Auditor). */
  oracleLeakage: (shop: Shop) => number;
}

const step = (n: number, action: string, expected: string, actual: string, evidence: Record<string, unknown> = {}): Step => ({ n, action, expected, actual, evidence });

// ------------------------------------------------------------ ledger oracles
export function refundLeakage(shop: Shop): number {
  const groups = new Map<string, { paid: number; entitled: number }>();
  for (const r of shop.refunds) {
    if (r.sku === '*') continue;
    const o = shop.orders.get(r.orderId)!;
    const line = o.lines.find((l) => l.sku === r.sku)!;
    const entitled = o.total * ((line.unitPrice * r.qty) / o.subtotal);
    const key = r.idemKey ? r.orderId + ':' + r.idemKey : r.id;
    const g = groups.get(key) || { paid: 0, entitled };
    g.paid += r.amount;
    groups.set(key, g);
  }
  let leak = 0;
  for (const g of groups.values()) leak += Math.max(0, g.paid - g.entitled);
  return round2(leak);
}

const discountLeakage = (shop: Shop) => {
  let leak = 0;
  for (const o of shop.orders.values()) {
    const singles = o.coupons.map((c) => {
      const cp = COUPONS[c];
      return cp.type === 'percent' ? o.subtotal * (cp.value / 100) : cp.value;
    });
    const best = singles.length ? Math.max(...singles) : 0;
    leak += Math.max(0, o.discount - best);
  }
  return round2(leak);
};

const unsettledLeakage = (shop: Shop) => round2([...shop.orders.values()].filter((o) => o.fulfilled).reduce((s, o) => s + Math.max(0, o.total - o.settled), 0));
const oversoldLeakage = (shop: Shop) => round2(Object.entries(shop.stock).reduce((s, [sku, n]) => s + (n < 0 ? -n * CATALOG[sku].price : 0), 0));
const unauthorizedLeakage = (shop: Shop) => round2(shop.refunds.filter((r) => r.sku !== '*' && r.actor !== 'admin' && r.actor !== 'manager').reduce((s, r) => s + r.amount, 0));

// ------------------------------------------------------------------- library
export const SCENARIOS: Scenario[] = [
  {
    id: 'DISC-001', category: 'discount', agent: 'opportunist', title: 'Coupon stacking bypasses single-coupon policy', severity: 'high', fixId: 'coupon-stacking',
    businessRule: 'discount', description: 'The coupon engine applies every submitted coupon in sequence, although policy allows only one coupon per order.',
    rootCause: 'Coupon application loops over all submitted coupons and never enforces maxCouponsPerOrder = 1.',
    preconditions: ['Three valid, individually non-expired coupons exist (SAVE20, VIP15, WELCOME10)'],
    attackSteps: ['Create an order of 4x NC-USB', 'Submit SAVE20, VIP15 and WELCOME10 together'],
    expectedSecure: 'Only one coupon is applied; extra coupons are rejected.', vulnerableBehaviour: 'All three coupons are applied, producing a 37% discount.',
    testData: { lines: [{ sku: 'NC-USB', qty: 4 }], coupons: ['SAVE20', 'VIP15', 'WELCOME10'] },
    provides: ['order:stacked-discount', 'order:discounted'], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const r = s.createOrder([{ sku: 'NC-USB', qty: 4 }], ['SAVE20', 'VIP15', 'WELCOME10']);
      if (!r.ok) throw new Error(r.error);
      const o = r.order;
      const expectedTotal = 160;
      const leakage = round2(Math.max(0, expectedTotal - o.total));
      return {
        shop: s, exploited: o.coupons.length > 1 && leakage > 0, leakage,
        expected: { couponsApplied: 1, orderTotal: expectedTotal }, actual: { couponsApplied: o.coupons.length, orderTotal: o.total },
        steps: [step(1, 'Create order 4x NC-USB ($200 subtotal) with coupons SAVE20+VIP15+WELCOME10', 'Only SAVE20 (best single discount, -$40) applies; total $160', `Applied ${o.coupons.join(', ') || 'none'}; total $${o.total}`, { subtotal: o.subtotal, discount: o.discount, rejectedCoupons: r.rejectedCoupons })],
      };
    },
    oracleLeakage: discountLeakage,
  },
  {
    id: 'DISC-002', category: 'discount', agent: 'opportunist', title: 'Duplicate coupon code applied repeatedly', severity: 'medium',
    businessRule: 'discount', description: 'Submitting the same coupon code twice should not double the discount.', rootCause: 'n/a (control present)',
    preconditions: ['SAVE20 valid'], attackSteps: ['Create order with SAVE20 submitted twice'], expectedSecure: 'Duplicate rejected.', vulnerableBehaviour: 'Discount applied twice.',
    testData: { coupons: ['SAVE20', 'SAVE20'] }, provides: [], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const r = s.createOrder([{ sku: 'NC-USB', qty: 4 }], ['SAVE20', 'SAVE20']);
      if (!r.ok) throw new Error(r.error);
      const bad = r.order.total < 160;
      return { shop: s, exploited: bad, leakage: bad ? round2(160 - r.order.total) : 0, expected: { orderTotal: 160 }, actual: { orderTotal: r.order.total },
        steps: [step(1, 'Submit SAVE20 twice on a $200 order', 'Total $160', `Total $${r.order.total}`, { rejectedCoupons: r.rejectedCoupons })] };
    },
    oracleLeakage: discountLeakage,
  },
  {
    id: 'DISC-003', category: 'discount', agent: 'opportunist', title: 'Expired coupon accepted', severity: 'medium',
    businessRule: 'discount', description: 'Expired coupons must be rejected at checkout.', rootCause: 'n/a (control present)',
    preconditions: ['EXPIRED5 is flagged expired'], attackSteps: ['Create order with EXPIRED5'], expectedSecure: 'Coupon rejected.', vulnerableBehaviour: 'Discount applied.',
    testData: { coupons: ['EXPIRED5'] }, provides: [], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const r = s.createOrder([{ sku: 'NC-CASE', qty: 2 }], ['EXPIRED5']);
      if (!r.ok) throw new Error(r.error);
      const bad = r.order.discount > 0;
      return { shop: s, exploited: bad, leakage: r.order.discount, expected: { discount: 0 }, actual: { discount: r.order.discount },
        steps: [step(1, 'Order 2x NC-CASE with expired coupon EXPIRED5', 'Discount $0', `Discount $${r.order.discount}`, { rejectedCoupons: r.rejectedCoupons })] };
    },
    oracleLeakage: (shop) => round2([...shop.orders.values()].reduce((s, o) => s + o.discount, 0)),
  },
  {
    id: 'BIZ-001', category: 'business-logic', agent: 'opportunist', title: 'Negative or zero quantity manipulation', severity: 'high',
    businessRule: 'pricing', description: 'Negative quantities could create negative totals / credit.', rootCause: 'n/a (control present)',
    preconditions: ['Catalogue prices are server-side'], attackSteps: ['Create order with qty -3'], expectedSecure: 'Order rejected (invalid_quantity).', vulnerableBehaviour: 'Order accepted with negative total.',
    testData: { lines: [{ sku: 'NC-USB', qty: -3 }] }, provides: [], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const r = s.createOrder([{ sku: 'NC-USB', qty: -3 }, { sku: 'NC-CASE', qty: 1 }]);
      return { shop: s, exploited: r.ok, leakage: r.ok ? 150 : 0, expected: { accepted: false }, actual: { accepted: r.ok },
        steps: [step(1, 'Create order with quantity -3', 'Rejected: invalid_quantity', r.ok ? 'Accepted' : `Rejected: ${r.error}`)] };
    },
    oracleLeakage: (shop) => (shop.orders.size > 0 ? 150 : 0),
  },
  {
    id: 'REFUND-001', category: 'refund', agent: 'refund-abuse', title: 'Partial refund ignores discount allocation', severity: 'high', fixId: 'refund-calc',
    businessRule: 'refund', description: 'Partial refunds are computed from the list price instead of the discounted amount actually paid.',
    rootCause: 'calcRefund uses line.unitPrice * qty and caps at the undiscounted subtotal, not the paid total.',
    preconditions: ['A paid order with a discount applied'], attackSteps: ['Buy 4x NC-USB with SAVE20 (paid $160)', 'Request partial refund of 2 units'],
    expectedSecure: 'Refund = $80 (2/4 of the paid amount).', vulnerableBehaviour: 'Refund = $100 (list price).',
    testData: { lines: [{ sku: 'NC-USB', qty: 4 }], coupons: ['SAVE20'], refundQty: 2 }, provides: ['refund:misallocated'], requires: ['order:discounted'],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const o = (s.createOrder([{ sku: 'NC-USB', qty: 4 }], ['SAVE20']) as any).order;
      s.pay(o.id, 'evt-pay-1');
      const rf = s.refund(o.id, 'NC-USB', 2, 'manager', 'rf-1', 'admin');
      const amount = rf.ok ? rf.refund.amount : 0;
      const leakage = round2(Math.max(0, amount - 80));
      return { shop: s, exploited: leakage > 0, leakage, expected: { refundAmount: 80 }, actual: { refundAmount: amount },
        steps: [
          step(1, 'Order 4x NC-USB with SAVE20 and pay', 'Paid $160', `Paid $${o.total}`, { orderId: o.id }),
          step(2, 'Refund 2 of 4 units', 'Refund $80 (proportional to $160 paid)', rf.ok ? `Refunded $${amount}` : `Rejected: ${rf.error}`, { refundId: rf.ok ? rf.refund.id : null }),
        ] };
    },
    oracleLeakage: refundLeakage,
  },
  {
    id: 'REFUND-002', category: 'refund', agent: 'refund-abuse', title: 'Duplicate refund request pays out twice', severity: 'critical', fixId: 'refund-idempotency',
    businessRule: 'refund', description: 'Retrying the same refund request (same client request ID) issues a second payout.',
    rootCause: 'Refund endpoint has no idempotency-key handling and no remaining-quantity check.',
    preconditions: ['A paid order'], attackSteps: ['Buy 2x NC-CHG ($60 paid)', 'Refund 1 unit with request id req-7788', 'Replay the identical request'],
    expectedSecure: 'Second request is a replay of the first; total refunded = $30.', vulnerableBehaviour: 'Both requests pay out; total refunded = $60.',
    testData: { lines: [{ sku: 'NC-CHG', qty: 2 }], refundQty: 1, idemKey: 'req-7788' }, provides: ['refund:replayable'], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const o = (s.createOrder([{ sku: 'NC-CHG', qty: 2 }]) as any).order;
      s.pay(o.id, 'evt-pay-2');
      const a = s.refund(o.id, 'NC-CHG', 1, 'manager', 'req-7788', 'admin');
      const b = s.refund(o.id, 'NC-CHG', 1, 'manager', 'req-7788', 'admin');
      const paidOut = round2(s.cashOut);
      const leakage = round2(Math.max(0, paidOut - 30));
      return { shop: s, exploited: leakage > 0, leakage, expected: { totalRefunded: 30 }, actual: { totalRefunded: paidOut },
        steps: [
          step(1, 'Order 2x NC-CHG ($60) and pay', 'Paid $60', `Paid $${o.total}`, { orderId: o.id }),
          step(2, 'Refund 1 unit (req-7788)', 'Refund $30', a.ok ? `Refunded $${a.refund.amount}` : `Rejected: ${a.error}`),
          step(3, 'Replay identical refund request (req-7788)', 'Replay returns the same refund, no new payout', b.ok ? (b.replay ? 'Replay detected (no new payout)' : `Second payout of $${b.refund.amount}`) : `Rejected: ${b.error}`),
        ] };
    },
    oracleLeakage: refundLeakage,
  },
  {
    id: 'REFUND-003', category: 'refund', agent: 'refund-abuse', title: 'Refund after cancellation', severity: 'high',
    businessRule: 'refund', description: 'A cancelled order is auto-refunded; a later refund must be blocked.', rootCause: 'n/a (control present)',
    preconditions: ['Paid, unfulfilled order'], attackSteps: ['Cancel the order (auto full refund)', 'Request another refund'], expectedSecure: 'Blocked: order_cancelled.', vulnerableBehaviour: 'Second refund paid.',
    testData: { lines: [{ sku: 'NC-USB', qty: 2 }] }, provides: [], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const o = (s.createOrder([{ sku: 'NC-USB', qty: 2 }]) as any).order;
      s.pay(o.id);
      const c = s.cancel(o.id);
      const rf = s.refund(o.id, 'NC-USB', 1, 'manager', 'rf-c', 'admin');
      return { shop: s, exploited: rf.ok, leakage: rf.ok ? rf.refund.amount : 0, expected: { secondRefundAllowed: false }, actual: { secondRefundAllowed: rf.ok },
        steps: [step(1, 'Cancel paid order', 'Auto-refund $100', c.ok ? `Refunded $${c.refunded}` : `Rejected: ${c.error}`), step(2, 'Refund again after cancel', 'Blocked', rf.ok ? 'Paid' : `Blocked: ${rf.error}`)] };
    },
    oracleLeakage: (shop) => round2(shop.refunds.filter((r) => r.sku !== '*').reduce((s, r) => s + r.amount, 0)),
  },
  {
    id: 'PAY-001', category: 'payment', agent: 'payment-manipulation', title: 'Pending payment treated as completed', severity: 'critical', fixId: 'payment-state',
    businessRule: 'payment', description: 'A PAYMENT.CAPTURE.PENDING event marks the order as paid and releases fulfilment; a later DENIED event cannot undo shipped goods.',
    rootCause: 'Payment state machine maps PENDING -> paid and allows no failure path once an order is paid.',
    preconditions: ['Payment method that settles asynchronously (e.g. e-check)'], attackSteps: ['Create $90 order', 'Receive PENDING event', 'Fulfil order', 'Receive DENIED event'],
    expectedSecure: 'Order is not fulfilled until COMPLETED; DENIED moves order to payment_failed.', vulnerableBehaviour: 'Goods ship against a payment that is later denied.',
    testData: { lines: [{ sku: 'NC-CHG', qty: 3 }], events: ['PENDING', 'DENIED'] }, provides: ['order:unsettled-paid'], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const o = (s.createOrder([{ sku: 'NC-CHG', qty: 3 }]) as any).order;
      const p = s.applyPayment(o.id, 'PENDING', 'evt-p1');
      const f = s.fulfill(o.id);
      s.applyPayment(o.id, 'DENIED', 'evt-p2');
      const shipped = s.orders.get(o.id)!.fulfilled;
      const leakage = shipped ? round2(o.total - s.orders.get(o.id)!.settled) : 0;
      return { shop: s, exploited: shipped && leakage > 0, leakage, expected: { shippedWithoutPayment: false }, actual: { shippedWithoutPayment: shipped },
        steps: [
          step(1, 'Create $90 order; capture event PENDING', 'Order stays payment_pending', p.ok ? `Order status: ${p.status}` : `Rejected: ${p.error}`),
          step(2, 'Attempt fulfilment', 'Blocked: not_paid', f.ok ? 'Fulfilled (goods released)' : `Blocked: ${f.error}`),
          step(3, 'Capture event DENIED', 'Order payment_failed, nothing shipped', `Shipped: ${shipped}; settled cash: $${s.orders.get(o.id)!.settled}`),
        ] };
    },
    oracleLeakage: unsettledLeakage,
  },
  {
    id: 'PAY-002', category: 'payment', agent: 'payment-manipulation', title: 'Duplicate order submission', severity: 'medium',
    businessRule: 'payment', description: 'Submitting checkout twice with the same idempotency key must create one order.', rootCause: 'n/a (control present)',
    preconditions: ['Client retries checkout'], attackSteps: ['POST checkout twice with the same key'], expectedSecure: 'One order.', vulnerableBehaviour: 'Two orders.',
    testData: { idemKey: 'chk-1' }, provides: [], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      s.createOrder([{ sku: 'NC-CASE', qty: 1 }], [], 'chk-1');
      s.createOrder([{ sku: 'NC-CASE', qty: 1 }], [], 'chk-1');
      const n = s.orders.size;
      return { shop: s, exploited: n > 1, leakage: n > 1 ? 20 : 0, expected: { orders: 1 }, actual: { orders: n }, steps: [step(1, 'Submit checkout twice with key chk-1', '1 order', `${n} order(s)`)] };
    },
    oracleLeakage: (shop) => (shop.orders.size > 1 ? 20 : 0),
  },
  {
    id: 'PAY-003', category: 'payment', agent: 'payment-manipulation', title: 'Webhook replay double-credits payment', severity: 'high',
    businessRule: 'payment', description: 'Replaying a payment webhook with the same event id must not be processed twice.', rootCause: 'n/a (control present)',
    preconditions: ['Webhook endpoint reachable'], attackSteps: ['Deliver COMPLETED event twice'], expectedSecure: 'Second delivery ignored.', vulnerableBehaviour: 'Cash credited twice.',
    testData: { eventId: 'evt-dup' }, provides: [], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const o = (s.createOrder([{ sku: 'NC-USB', qty: 1 }]) as any).order;
      s.applyPayment(o.id, 'COMPLETED', 'evt-dup');
      const b = s.applyPayment(o.id, 'COMPLETED', 'evt-dup');
      const over = s.cashIn > o.total;
      return { shop: s, exploited: over, leakage: over ? round2(s.cashIn - o.total) : 0, expected: { cashIn: o.total }, actual: { cashIn: s.cashIn },
        steps: [step(1, 'Deliver COMPLETED event evt-dup twice', 'Second delivery flagged duplicate', (b as any).duplicate ? 'Duplicate ignored' : 'Processed again', { cashIn: s.cashIn })] };
    },
    oracleLeakage: (shop) => round2(Math.max(0, shop.cashIn - [...shop.orders.values()].reduce((s, o) => s + o.settled, 0))),
  },
  {
    id: 'INV-001', category: 'inventory', agent: 'payment-manipulation', title: 'Concurrent checkout oversells limited stock', severity: 'high', fixId: 'inventory-race',
    businessRule: 'inventory', description: 'Parallel checkouts each read the stock level before any decrements, so more units are sold than exist.',
    rootCause: 'Check-then-act inventory reservation without an atomic conditional update or lock.',
    preconditions: ['Limited-edition item with 3 units in stock'], attackSteps: ['Submit 6 simultaneous single-unit checkouts for NC-HEADSET'],
    expectedSecure: 'Exactly 3 orders accepted; stock never negative.', vulnerableBehaviour: 'All 6 accepted; stock = -3.',
    testData: { sku: 'NC-HEADSET', stock: 3, concurrentBuyers: 6 }, provides: ['inventory:oversold'], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const r = s.createOrdersConcurrently(Array.from({ length: 6 }, () => ({ sku: 'NC-HEADSET', qty: 1 })));
      const stock = s.stock['NC-HEADSET'];
      const leakage = round2(stock < 0 ? -stock * CATALOG['NC-HEADSET'].price : 0);
      return { shop: s, exploited: stock < 0, leakage, expected: { ordersAccepted: 3, stock: 0 }, actual: { ordersAccepted: r.accepted, stock },
        steps: [step(1, '6 concurrent checkouts for 3 units', '3 accepted, 3 rejected (out_of_stock)', `${r.accepted} accepted; stock ${stock}`, { oversoldUnits: Math.max(0, -stock) })] };
    },
    oracleLeakage: oversoldLeakage,
  },
  {
    id: 'INV-002', category: 'inventory', agent: 'payment-manipulation', title: 'Inventory not restored after cancellation', severity: 'low',
    businessRule: 'inventory', description: 'Cancelled orders must return stock.', rootCause: 'n/a (control present)',
    preconditions: [], attackSteps: ['Buy 2 headsets', 'Cancel'], expectedSecure: 'Stock back to 3.', vulnerableBehaviour: 'Stock stays 1.',
    testData: { sku: 'NC-HEADSET' }, provides: [], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const o = (s.createOrder([{ sku: 'NC-HEADSET', qty: 2 }]) as any).order;
      s.cancel(o.id);
      const st = s.stock['NC-HEADSET'];
      return { shop: s, exploited: st !== 3, leakage: st !== 3 ? 120 : 0, expected: { stock: 3 }, actual: { stock: st }, steps: [step(1, 'Buy 2 headsets then cancel', 'Stock 3', `Stock ${st}`)] };
    },
    oracleLeakage: (shop) => (shop.stock['NC-HEADSET'] !== 3 ? 120 : 0),
  },
  {
    id: 'ACL-001', category: 'access-control', agent: 'insider-threat', title: 'Any staff role can issue refunds without approval', severity: 'critical', fixId: 'refund-permission',
    businessRule: 'access-control', description: 'The refund operation does not check staff role, approval threshold or write an audit record.',
    rootCause: 'authorizeRefund returns allowed=true for every actor; no approval requirement above $100; no audit record.',
    preconditions: ['Staff account with intern role'], attackSteps: ['Intern issues a $120 refund on a paid order without approval'],
    expectedSecure: 'Denied: forbidden_role; attempt is audited.', vulnerableBehaviour: 'Refund paid, no audit record.',
    testData: { actor: 'intern', amount: 120 }, provides: ['actor:unauthorized-refund'], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const o = (s.createOrder([{ sku: 'NC-HEADSET', qty: 1 }]) as any).order;
      s.pay(o.id);
      const rf = s.refund(o.id, 'NC-HEADSET', 1, 'intern', 'acl-1');
      const amount = rf.ok ? rf.refund.amount : 0;
      return { shop: s, exploited: rf.ok, leakage: amount, expected: { refundAllowed: false, auditRecords: 1 }, actual: { refundAllowed: rf.ok, auditRecords: s.audit.length },
        steps: [step(1, 'Intern refunds $120 order, no approval', 'Denied (forbidden_role) and audited', rf.ok ? `Refund of $${amount} issued; audit records: ${s.audit.length}` : `Denied: ${rf.error}; audit records: ${s.audit.length}`)] };
    },
    oracleLeakage: unauthorizedLeakage,
  },
  {
    id: 'ACL-002', category: 'access-control', agent: 'insider-threat', title: 'Unprotected administrative operation (coupon rules)', severity: 'high',
    businessRule: 'access-control', description: 'Only admins may edit coupon rules.', rootCause: 'n/a (control present)',
    preconditions: ['Support account'], attackSteps: ['Support edits SAVE20 to 90%'], expectedSecure: 'Denied.', vulnerableBehaviour: 'Rule changed.',
    testData: { actor: 'support' }, provides: [], requires: [],
    reproduce(fixes) {
      const s = new Shop(fixes);
      const r = s.updateCouponRule('support', 'SAVE20', { value: 90 });
      return { shop: s, exploited: r.ok, leakage: r.ok ? 500 : 0, expected: { allowed: false }, actual: { allowed: r.ok }, steps: [step(1, 'Support edits SAVE20 to 90%', 'Denied', r.ok ? 'Allowed' : `Denied: ${r.error}`)] };
    },
    oracleLeakage: (shop) => (shop.couponRules['SAVE20'].value !== 20 ? 500 : 0),
  },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);
