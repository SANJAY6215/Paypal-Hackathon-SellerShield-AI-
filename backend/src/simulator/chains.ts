import { Shop, FixId, ALL_FIXES, Step, round2 } from './shop';
import { scenarioById, Severity } from './scenarios';

/** Relationship model: how one weakness feeds the next. Only edges between VERIFIED vulnerabilities are used. */
export const EDGES: { from: string; to: string; why: string }[] = [
  { from: 'DISC-001', to: 'REFUND-001', why: 'The stacked discount widens the gap between list price and amount paid; the refund calculation then pays back list price.' },
  { from: 'REFUND-001', to: 'REFUND-002', why: 'The over-sized refund request can be replayed because refund retries are not de-duplicated.' },
  { from: 'PAY-001', to: 'ACL-001', why: 'The order looks paid without settled funds, and any staff role can refund it without approval.' },
];

export interface ChainCandidate { path: string[]; signature: string; rationale: string[] }

/** Generate maximal attack paths over the verified vulnerability set. */
export function generateCandidates(verifiedIds: string[]): ChainCandidate[] {
  const set = new Set(verifiedIds);
  const edges = EDGES.filter((e) => set.has(e.from) && set.has(e.to));
  const hasIn = new Set(edges.map((e) => e.to));
  const out: ChainCandidate[] = [];
  const dfs = (node: string, path: string[], why: string[]) => {
    const next = edges.filter((e) => e.from === node && !path.includes(e.to));
    if (!next.length) {
      if (path.length >= 2) out.push({ path, signature: path.join('>'), rationale: why });
      return;
    }
    for (const e of next) dfs(e.to, [...path, e.to], [...why, e.why]);
  };
  for (const start of new Set(edges.map((e) => e.from))) if (!hasIn.has(start)) dfs(start, [start], []);
  return out;
}

export interface ChainStep extends Step { vulnId: string | null }
export interface ChainRun {
  signature: string;
  steps: ChainStep[];
  expected: { merchantPosition: number; refundsPaid: number };
  actual: { merchantPosition: number; refundsPaid: number };
  leakage: number;
  exploited: boolean;
  shop: Shop;
}

const position = (s: Shop) => round2(s.cashIn - s.cashOut - [...s.orders.values()].filter((o) => o.fulfilled).reduce((a, o) => a + Math.max(0, o.total - o.settled), 0));

/** Execute an attack path against a fresh simulated shop (deterministic). */
function play(path: string[], fixes: Set<FixId>, steps?: ChainStep[]) {
  const s = new Shop(fixes);
  const has = (id: string) => path.includes(id);
  const log = (action: string, expected: string, actual: string, vulnId: string | null, evidence: Record<string, unknown> = {}) => steps?.push({ n: steps.length + 1, action, expected, actual, evidence, vulnId });

  if (has('DISC-001')) {
    const lines = [{ sku: 'NC-USB', qty: 4 }];
    const r = s.createOrder(lines, ['SAVE20', 'VIP15', 'WELCOME10']);
    if (!r.ok) throw new Error(r.error);
    const o = r.order;
    log('Create order 4x NC-USB and submit SAVE20 + VIP15 + WELCOME10', 'One coupon applied (-$40) -> total $160', `Coupons applied: ${o.coupons.join(', ')}; total $${o.total}`, 'DISC-001', { subtotal: o.subtotal, discount: o.discount });
    s.pay(o.id, 'evt-c1');
    log('Pay order through the test environment', 'Cash received equals order total', `Settled $${o.settled}`, null);
    const key = 'req-chain-1';
    const a = s.refund(o.id, 'NC-USB', 2, 'manager', key, 'admin');
    log('Request partial refund of 2 units', 'Refund = 2/4 of amount paid', a.ok ? `Refunded $${a.refund.amount} (paid $${o.total} for 4 units)` : `Rejected: ${a.error}`, 'REFUND-001', { refundId: a.ok ? a.refund.id : null });
    if (has('REFUND-002')) {
      const b = s.refund(o.id, 'NC-USB', 2, 'manager', key, 'admin');
      log('Replay the identical refund request', 'Replay returns original refund, no new payout', b.ok ? (b.replay ? 'Replay detected, no new payout' : `Second payout of $${b.refund.amount}`) : `Rejected: ${b.error}`, 'REFUND-002');
    }
  } else if (has('PAY-001')) {
    const r = s.createOrder([{ sku: 'NC-HEADSET', qty: 1 }]);
    if (!r.ok) throw new Error(r.error);
    const o = r.order;
    const p = s.applyPayment(o.id, 'PENDING', 'evt-c-p1');
    log('Create $120 order; capture event PENDING arrives (e-check)', 'Order stays payment_pending', p.ok ? `Order status: ${p.status}` : `Rejected: ${p.error}`, 'PAY-001');
    const f = s.fulfill(o.id);
    log('Release goods for fulfilment', 'Blocked: payment not completed', f.ok ? 'Goods shipped' : `Blocked: ${f.error}`, 'PAY-001');
    s.applyPayment(o.id, 'DENIED', 'evt-c-p2');
    log('Capture event DENIED arrives', 'Order payment_failed, nothing shipped', `Shipped: ${s.orders.get(o.id)!.fulfilled}; settled $${s.orders.get(o.id)!.settled}`, null);
    const rf = s.refund(o.id, 'NC-HEADSET', 1, 'intern', 'req-chain-2');
    log('Intern issues a refund on the unsettled order', 'Denied: invalid payment state / forbidden role', rf.ok ? `Refund of $${rf.refund.amount} paid out with no settled funds; audit records: ${s.audit.length}` : `Denied: ${rf.error}`, 'ACL-001');
  }
  return s;
}

const TITLES: Record<string, { title: string; description: string; severity: Severity }> = {
  'DISC-001>REFUND-001>REFUND-002': {
    title: 'Discount-Stack Refund Siphon',
    description: 'Stacked coupons shrink the amount paid, the refund engine pays back list price, and a replayed request pays it twice: the merchant refunds far more than it ever collected.',
    severity: 'critical',
  },
  'PAY-001>ACL-001': {
    title: 'Phantom Payment Insider Payout',
    description: 'A pending (later denied) payment releases goods and marks the order paid; a low-privilege staff account then refunds money that was never received.',
    severity: 'critical',
  },
};

export function chainMeta(signature: string) {
  return TITLES[signature] || { title: 'Compound attack chain ' + signature, description: 'Verified sequence of linked weaknesses.', severity: 'high' as Severity };
}

export function runChain(path: string[], fixes: Set<FixId>): ChainRun {
  const steps: ChainStep[] = [];
  const shop = play(path, fixes, steps);
  const baselineShop = play(path, new Set(ALL_FIXES)); // secure baseline = what a correct implementation produces
  const actual = { merchantPosition: position(shop), refundsPaid: round2(shop.cashOut) };
  const expected = { merchantPosition: position(baselineShop), refundsPaid: round2(baselineShop.cashOut) };
  const leakage = round2(Math.max(0, expected.merchantPosition - actual.merchantPosition));
  return { signature: path.join('>'), steps, expected, actual, leakage, exploited: leakage > 0.005, shop };
}

/** Isolated per-vulnerability leakage sum for the same path (to quantify the compound amplification). */
export function isolatedLeakage(path: string[], fixes: Set<FixId>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of path) out[id] = scenarioById(id)!.reproduce(fixes).leakage;
  return out;
}

export function buildGraph(run: ChainRun, path: string[], fixIdByVuln: Record<string, string | undefined>) {
  const nodes: any[] = [];
  const edges: any[] = [];
  const colX = 215;
  run.steps.forEach((st, i) => {
    nodes.push({ id: `s${st.n}`, type: 'step', x: i * colX, y: 190, data: { kind: 'step', label: `Step ${st.n}`, detail: st.action, expected: st.expected, actual: st.actual, evidence: st.evidence } });
    if (i > 0) edges.push({ id: `e-s${i}-s${st.n}`, source: `s${i}`, target: `s${st.n}`, kind: 'sequence' });
  });
  path.forEach((vid, i) => {
    const sc = scenarioById(vid)!;
    const stepIdx = run.steps.findIndex((s) => s.vulnId === vid);
    const x = Math.max(0, stepIdx) * colX;
    nodes.push({ id: `v:${vid}`, type: 'vuln', x, y: 20, data: { kind: 'vulnerability', vulnId: vid, label: sc.id, detail: sc.title, severity: sc.severity, rootCause: sc.rootCause } });
    if (stepIdx >= 0) edges.push({ id: `e-v${vid}-s`, source: `v:${vid}`, target: `s${run.steps[stepIdx].n}`, kind: 'enables' });
    if (i > 0) edges.push({ id: `e-v${path[i - 1]}-${vid}`, source: `v:${path[i - 1]}`, target: `v:${vid}`, kind: 'amplifies' });
    const fid = fixIdByVuln[vid];
    if (fid) {
      nodes.push({ id: `r:${fid}`, type: 'remediation', x, y: 350, data: { kind: 'remediation', label: 'Fix', detail: fid } });
      edges.push({ id: `e-r${fid}`, source: `r:${fid}`, target: `v:${vid}`, kind: 'mitigates' });
    }
  });
  nodes.push({ id: 'impact', type: 'impact', x: run.steps.length * colX, y: 190, data: { kind: 'consequence', label: 'Simulated financial impact', detail: `$${run.leakage.toFixed(2)} excess per attack`, expected: run.expected, actual: run.actual } });
  edges.push({ id: 'e-impact', source: `s${run.steps.length}`, target: 'impact', kind: 'consequence' });
  return { nodes, edges };
}
