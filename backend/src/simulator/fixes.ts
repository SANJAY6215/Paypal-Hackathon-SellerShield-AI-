import { createTwoFilesPatch } from 'diff';
import fs from 'node:fs';
import path from 'node:path';
import * as R from './rules';
import { Shop, FixId, ALL_FIXES, round2 } from './shop';
import { SCENARIOS, scenarioById } from './scenarios';

export interface LegitCheck { name: string; ok: boolean; detail: string }

export interface FixDef {
  id: FixId;
  scenarioId: string;
  title: string;
  file: string;
  vulnerable: (...a: any[]) => any;
  secure: (...a: any[]) => any;
  summary: string;
  plan: string[];
  explanation: string;
  tradeoffs: string[];
  sideEffects: string[];
  legit: (fixes: Set<FixId>) => LegitCheck[];
}

const chk = (name: string, ok: boolean, detail: string): LegitCheck => ({ name, ok, detail });
const mk = (fixes: Set<FixId>) => new Shop(fixes);

export const FIXES: Record<FixId, FixDef> = {
  'coupon-stacking': {
    id: 'coupon-stacking', scenarioId: 'DISC-001', title: 'Enforce one coupon per order', file: 'src/simulator/rules.ts',
    vulnerable: R.applyCouponsVulnerable, secure: R.applyCouponsSecure,
    summary: 'Apply at most one coupon per order and report the others as rejected.',
    plan: ['Add maxCouponsPerOrder to the discount policy', 'Apply only the first valid coupon', 'Return rejected coupons to the storefront for messaging', 'Add regression test: three stacked coupons -> one applied'],
    explanation: 'The coupon engine looped over every submitted coupon and compounded the discounts. The fix enforces the documented policy in the single place discounts are calculated, so no client can combine promotions regardless of how many codes it submits.',
    tradeoffs: ['Marketing can no longer run intentionally stackable campaigns without an explicit allow-list rule.'], sideEffects: ['Customers who previously stacked codes will see only one applied; storefront copy should explain this.'],
    legit: (f) => {
      const s = mk(f);
      const one = s.createOrder([{ sku: 'NC-USB', qty: 4 }], ['SAVE20']);
      const none = mk(f).createOrder([{ sku: 'NC-CHG', qty: 1 }]);
      return [
        chk('Single valid coupon still applies', one.ok && one.order.total === 160, `4x NC-USB with SAVE20 -> $${one.ok ? one.order.total : 'error'} (expected $160)`),
        chk('Order without coupon is priced at list', none.ok && none.order.total === 30, `1x NC-CHG -> $${none.ok ? none.order.total : 'error'} (expected $30)`),
      ];
    },
  },
  'refund-calc': {
    id: 'refund-calc', scenarioId: 'REFUND-001', title: 'Allocate discounts proportionally when refunding', file: 'src/simulator/rules.ts',
    vulnerable: R.calcRefundVulnerable, secure: R.calcRefundSecure,
    summary: 'Recalculate the refundable amount from the order\'s actual discount allocation and the remaining refundable balance.',
    plan: ['Compute each line\'s share of the amount actually paid', 'Cap every refund at (paid total - already refunded)', 'Reject refunds when nothing is refundable', 'Add regression test: partial refund of a discounted order'],
    explanation: 'Refunds were calculated from the list price, so a customer who bought at a discount was refunded more than they paid. The fix allocates the paid total across lines proportionally and caps every refund at the remaining refundable balance.',
    tradeoffs: ['Refunds on discounted orders are smaller than list price; support must explain the allocation.'], sideEffects: ['Historic orders refunded at list price are not corrected automatically.'],
    legit: (f) => {
      const s = mk(f);
      const o = (s.createOrder([{ sku: 'NC-USB', qty: 4 }], ['SAVE20']) as any).order;
      s.pay(o.id);
      const a = s.refund(o.id, 'NC-USB', 2, 'manager', 'k1', 'admin');
      const s2 = mk(f);
      const o2 = (s2.createOrder([{ sku: 'NC-CASE', qty: 2 }]) as any).order;
      s2.pay(o2.id);
      const b = s2.refund(o2.id, 'NC-CASE', 2, 'manager', 'k2', 'admin');
      return [
        chk('Legitimate partial refund returns the proportional amount', a.ok && a.refund.amount === 80, `refund 2 of 4 (paid $160) -> $${a.ok ? a.refund.amount : a.error} (expected $80)`),
        chk('Full refund of undiscounted order returns the full total', b.ok && b.refund.amount === 40, `refund 2x NC-CASE -> $${b.ok ? b.refund.amount : b.error} (expected $40)`),
      ];
    },
  },
  'refund-idempotency': {
    id: 'refund-idempotency', scenarioId: 'REFUND-002', title: 'Require idempotency keys and track refunded quantity', file: 'src/simulator/rules.ts',
    vulnerable: R.guardRefundVulnerable, secure: R.guardRefundSecure,
    summary: 'Replays of the same request return the original refund; refunds cannot exceed the purchased quantity.',
    plan: ['Require an Idempotency-Key on refund requests', 'Persist key -> refund per order and replay the stored result', 'Track refunded quantity per line and reject over-refunds', 'Add regression test: identical request twice -> one payout'],
    explanation: 'Retried refund requests were treated as brand-new refunds. The guard now stores each request by idempotency key and returns the stored result on replay, and independently tracks refunded quantity per order line.',
    tradeoffs: ['API clients must send a unique key per refund attempt.'], sideEffects: ['Older clients that omit the key receive idempotency_key_required until updated.'],
    legit: (f) => {
      const s = mk(f);
      const o = (s.createOrder([{ sku: 'NC-CHG', qty: 2 }]) as any).order;
      s.pay(o.id);
      const a = s.refund(o.id, 'NC-CHG', 1, 'manager', 'A', 'admin');
      const b = s.refund(o.id, 'NC-CHG', 1, 'manager', 'B', 'admin');
      const c = s.refund(o.id, 'NC-CHG', 1, 'manager', 'C', 'admin');
      return [
        chk('First refund succeeds', a.ok && !('replay' in a && a.replay), `first request -> ${a.ok ? '$' + a.refund.amount : a.error}`),
        chk('A second, different refund for the remaining unit succeeds', b.ok, `distinct request for remaining unit -> ${b.ok ? '$' + b.refund.amount : b.error}`),
        chk('Refunding beyond purchased quantity is blocked', !c.ok, `third unit -> ${c.ok ? 'PAID (bad)' : c.error}`),
      ];
    },
  },
  'inventory-race': {
    id: 'inventory-race', scenarioId: 'INV-001', title: 'Atomic check-and-decrement of stock', file: 'src/simulator/rules.ts',
    vulnerable: R.reserveBatchVulnerable, secure: R.reserveBatchSecure,
    summary: 'Reserve stock with a conditional atomic update so parallel checkouts cannot oversell.',
    plan: ['Replace read-then-write with UPDATE ... WHERE stock >= qty', 'Reject the order when the update affects 0 rows', 'Add regression test: N parallel buyers for M units -> exactly M orders'],
    explanation: 'Every concurrent checkout read the same stock number before any of them decremented it. The reservation is now a single atomic conditional decrement, so only as many orders succeed as units exist.',
    tradeoffs: ['Slightly higher contention on hot SKUs.'], sideEffects: ['Buyers who lose the race see out_of_stock instead of a later cancellation email.'],
    legit: (f) => {
      const s = mk(f);
      const r = [1, 2, 3].map(() => s.createOrder([{ sku: 'NC-HEADSET', qty: 1 }]));
      const over = s.createOrder([{ sku: 'NC-HEADSET', qty: 1 }]);
      return [
        chk('Sequential purchases up to available stock succeed', r.every((x) => x.ok), `3 of 3 purchases accepted: ${r.filter((x) => x.ok).length}`),
        chk('Purchase beyond stock is rejected', !over.ok, `4th purchase -> ${over.ok ? 'ACCEPTED (bad)' : (over as any).error}`),
      ];
    },
  },
  'payment-state': {
    id: 'payment-state', scenarioId: 'PAY-001', title: 'Strict payment state machine', file: 'src/simulator/rules.ts',
    vulnerable: R.transitionVulnerable, secure: R.transitionSecure,
    summary: 'Only a COMPLETED capture marks an order paid; PENDING keeps it in payment_pending and DENIED fails it.',
    plan: ['Map PENDING -> payment_pending (no fulfilment)', 'Allow paid only on COMPLETED', 'Allow DENIED to fail any non-cancelled order', 'Add regression test: PENDING -> fulfil blocked -> DENIED'],
    explanation: 'The handler treated a pending capture as settled money. The state machine now releases goods only after a COMPLETED capture, and failure events always move the order to payment_failed.',
    tradeoffs: ['Asynchronous payment methods delay fulfilment until settlement.'], sideEffects: ['Orders paid by e-check ship later than before.'],
    legit: (f) => {
      const s = mk(f);
      const o = (s.createOrder([{ sku: 'NC-USB', qty: 1 }]) as any).order;
      s.applyPayment(o.id, 'PENDING', 'e1');
      const early = s.fulfill(o.id);
      s.applyPayment(o.id, 'COMPLETED', 'e2');
      const late = s.fulfill(o.id);
      return [
        chk('Fulfilment is blocked while payment is pending', !early.ok, `fulfil during PENDING -> ${early.ok ? 'RELEASED (bad)' : (early as any).error}`),
        chk('Completed payment can be fulfilled', late.ok, `fulfil after COMPLETED -> ${late.ok ? 'ok' : (late as any).error}`),
      ];
    },
  },
  'refund-permission': {
    id: 'refund-permission', scenarioId: 'ACL-001', title: 'Role check, approval threshold and audit trail for refunds', file: 'src/simulator/rules.ts',
    vulnerable: R.authorizeRefundVulnerable, secure: R.authorizeRefundSecure,
    summary: 'Only admin/manager may refund; refunds above $100 need a second approver; every attempt is audited.',
    plan: ['Define refund:issue for admin and manager only', 'Require approvedBy for refunds above $100', 'Write an audit record for each allowed and denied attempt', 'Add regression test: intern refund denied and logged'],
    explanation: 'The authorization function allowed every actor. It now enforces role separation and a four-eyes approval above the threshold, and records every decision for audit.',
    tradeoffs: ['Support staff must escalate refunds to a manager.'], sideEffects: ['Refund turnaround time for support-led cases increases.'],
    legit: (f) => {
      const s = mk(f);
      const o = (s.createOrder([{ sku: 'NC-CASE', qty: 2 }]) as any).order;
      s.pay(o.id);
      const small = s.refund(o.id, 'NC-CASE', 1, 'manager', 'm1');
      const s2 = mk(f);
      const o2 = (s2.createOrder([{ sku: 'NC-HEADSET', qty: 1 }]) as any).order;
      s2.pay(o2.id);
      const big = s2.refund(o2.id, 'NC-HEADSET', 1, 'manager', 'm2', 'admin');
      return [
        chk('Manager can refund small amounts', small.ok, `manager refund $20 -> ${small.ok ? 'ok' : (small as any).error}`),
        chk('Manager refund above $100 with approval succeeds and is audited', big.ok && s2.audit.length === 1, `manager refund $120 with approval -> ${big.ok ? 'ok' : (big as any).error}; audit records ${s2.audit.length}`),
      ];
    },
  },
};

export const fixForScenario = (scenarioId: string) => Object.values(FIXES).find((f) => f.scenarioId === scenarioId);

const RULES_SRC = fs.readFileSync(path.join(__dirname, 'rules.ts'), 'utf8');

/** Extract the formatted source of one exported rule function from rules.ts (brace-matched), variant suffix removed. */
function sourceOf(fn: (...a: any[]) => any): string {
  const start = RULES_SRC.indexOf(`export function ${fn.name}(`);
  if (start < 0) throw new Error('rule source not found: ' + fn.name);
  let depth = 0;
  let i = RULES_SRC.indexOf('{', RULES_SRC.indexOf(') {', start) >= 0 ? RULES_SRC.indexOf(') {', start) : start);
  for (; i < RULES_SRC.length; i++) {
    if (RULES_SRC[i] === '{') depth++;
    else if (RULES_SRC[i] === '}' && --depth === 0) break;
  }
  return RULES_SRC.slice(start, i + 1).replace(/^export /, '').replace(/(Vulnerable|Secure)\b/g, '');
}
const norm = sourceOf;

/** Real unified diff between the vulnerable and secure implementation sources. */
export function buildPatch(fixId: FixId): string {
  const f = FIXES[fixId];
  return createTwoFilesPatch(`a/${f.file}`, `b/${f.file}`, norm(f.vulnerable) + '\n', norm(f.secure) + '\n', 'vulnerable', 'secure', { context: 3 });
}

export interface DefenceVerification {
  originalAttackBlocked: boolean;
  originalAttack: { exploitedBefore: boolean; exploitedAfter: boolean; leakageBefore: number; leakageAfter: number };
  legit: LegitCheck[];
  regression: { scenarioId: string; exploited: boolean; wasExploited: boolean; ok: boolean }[];
  chainChecks: { signature: string; blocked: boolean }[];
  passed: boolean;
}

/** Run before/after verification for one fix applied on top of a baseline fix set. */
export function verifyFix(fixId: FixId, baseline: Set<FixId>, chainRunner?: (fixes: Set<FixId>) => { signature: string; leakage: number }[]): DefenceVerification {
  const f = FIXES[fixId];
  const sc = scenarioById(f.scenarioId)!;
  const before = new Set([...baseline].filter((x) => x !== fixId));
  const after = new Set([...baseline, fixId]);
  const b = sc.reproduce(before);
  const a = sc.reproduce(after);
  const legit = f.legit(after);
  const regression = SCENARIOS.filter((s) => s.id !== sc.id).map((s) => {
    const was = s.reproduce(before).exploited;
    const now = s.reproduce(after).exploited;
    return { scenarioId: s.id, wasExploited: was, exploited: now, ok: !(now && !was) }; // the fix must not introduce new exploits
  });
  const chainChecks = chainRunner ? chainRunner(after).map((c) => ({ signature: c.signature, blocked: c.leakage <= 0.005 })) : [];
  const passed = b.exploited && !a.exploited && legit.every((l) => l.ok) && regression.every((r) => r.ok);
  return {
    originalAttackBlocked: !a.exploited,
    originalAttack: { exploitedBefore: b.exploited, exploitedAfter: a.exploited, leakageBefore: b.leakage, leakageAfter: round2(a.leakage) },
    legit, regression, chainChecks, passed,
  };
}

export { ALL_FIXES };
