import { z } from 'zod';
import { SCENARIOS, Scenario, scenarioById, AgentType, RunResult } from './simulator/scenarios';
import { auditLedger, FixId } from './simulator/shop';
import { AIBudget, askJson } from './ai';

export const AGENT_DEFS: Record<AgentType, { name: string; responsibility: string; tools: string[]; forbidden: string[] }> = {
  opportunist: {
    name: 'Opportunist Agent', responsibility: 'Finds weaknesses in discounts, promotions, pricing and coupon rules.',
    tools: ['simulator.createOrder', 'simulator.applyCoupons', 'scenario.reproduce'], forbidden: ['shell execution', 'network access', 'live PayPal calls', 'modifying application code'],
  },
  'refund-abuse': {
    name: 'Refund Abuse Agent', responsibility: 'Probes refund, cancellation and return workflows for over-payment and replay.',
    tools: ['simulator.refund', 'simulator.cancel', 'scenario.reproduce'], forbidden: ['shell execution', 'network access', 'real refunds', 'modifying application code'],
  },
  'payment-manipulation': {
    name: 'Payment Manipulation Agent', responsibility: 'Tests payment state, idempotency, webhook replay and concurrent checkout consistency.',
    tools: ['simulator.applyPayment', 'simulator.createOrdersConcurrently', 'scenario.reproduce'], forbidden: ['shell execution', 'live payment manipulation', 'modifying application code'],
  },
  'insider-threat': {
    name: 'Insider Threat Agent', responsibility: 'Checks staff role separation, approval workflows and audit records in the local role model.',
    tools: ['simulator.refund(actor)', 'simulator.updateCouponRule(actor)', 'scenario.reproduce'], forbidden: ['shell execution', 'real credentials', 'modifying application code'],
  },
  'defence-architect': {
    name: 'Defence Architect Agent', responsibility: 'Develops a root-cause remediation, code patch, regression tests and trade-off analysis for each verified vulnerability.',
    tools: ['fixes.buildPatch', 'fixes.verifyFix (dry-run)'], forbidden: ['applying patches without human approval', 'shell execution', 'touching production systems'],
  },
  auditor: {
    name: 'Independent Auditor Agent', responsibility: 'Independently reproduces every claim, validates evidence and exposure, rejects unsupported findings and tests proposed defences.',
    tools: ['scenario.reproduce', 'ledger.audit', 'fixes.verifyFix'], forbidden: ['trusting agent claims without reproduction', 'shell execution'],
  },
};

export const INVESTIGATORS: AgentType[] = ['opportunist', 'refund-abuse', 'payment-manipulation', 'insider-threat'];
export const ALL_AGENTS: AgentType[] = [...INVESTIGATORS, 'defence-architect', 'auditor'];

export const FindingSchema = z.object({
  title: z.string().min(3).max(200),
  category: z.enum(['discount', 'refund', 'payment', 'inventory', 'access-control', 'business-logic']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  businessRule: z.string().min(1).max(80),
  rootCause: z.string().min(3).max(500),
  evidence: z.array(z.any()),
  reproductionSteps: z.array(z.string()).min(1),
  testCaseId: z.string().min(3).max(40),
  leakage: z.number().min(0),
});
export type Finding = z.infer<typeof FindingSchema>;

export const AgentOutputSchema = z.object({
  agentType: z.enum(['opportunist', 'refund-abuse', 'payment-manipulation', 'insider-threat', 'defence-architect', 'auditor']),
  status: z.enum(['completed', 'failed']),
  mode: z.enum(['ai-assisted', 'deterministic']),
  findings: z.array(FindingSchema),
  cleared: z.array(z.object({ testCaseId: z.string(), title: z.string(), result: z.string() })),
  rejectedHypotheses: z.array(z.object({ testCaseId: z.string(), reason: z.string() })),
});
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

const HypothesisSchema = z.object({ hypotheses: z.array(z.object({ testCaseId: z.string().max(40), rationale: z.string().max(300) })).max(12) });

/** Optional AI planning step: the model proposes what to probe first. Deterministic code executes everything. */
export async function planProbes(agent: AgentType, merchantSummary: string, budget: AIBudget) {
  const own = SCENARIOS.filter((s) => s.agent === agent);
  const plan = await askJson(HypothesisSchema,
    `You are the ${AGENT_DEFS[agent].name} of a merchant security-testing platform. ${AGENT_DEFS[agent].responsibility} You may only propose scenario IDs; you cannot run code.`,
    `Merchant (sandbox profile): ${merchantSummary}\nAvailable scenarios:\n${own.map((s) => `${s.id}: ${s.title}`).join('\n')}\nReturn {"hypotheses":[{"testCaseId":"...","rationale":"..."}]} ordered by how likely each is to reveal a financial weakness. You may also add IDs you suspect exist.`, budget);
  const order: string[] = [];
  const rejected: { testCaseId: string; reason: string }[] = [];
  const mode: 'ai-assisted' | 'deterministic' = plan ? 'ai-assisted' : 'deterministic';
  for (const h of plan?.hypotheses ?? []) {
    const sc = scenarioById(h.testCaseId);
    if (sc && sc.agent === agent && !order.includes(sc.id)) order.push(sc.id);
    else if (!sc) rejected.push({ testCaseId: h.testCaseId, reason: 'Not in the scenario library: cannot be reproduced deterministically, so it is not accepted as a finding.' });
  }
  for (const s of own) if (!order.includes(s.id)) order.push(s.id);
  return { order, rejected, mode };
}

export function buildFinding(sc: Scenario, run: RunResult): Finding {
  return {
    title: sc.title, category: sc.category, severity: sc.severity, confidence: 0.95, businessRule: sc.businessRule, rootCause: sc.rootCause,
    evidence: run.steps, reproductionSteps: sc.attackSteps, testCaseId: sc.id, leakage: run.leakage,
  };
}

export interface AuditCheck { name: string; ok: boolean; detail: string }
export interface AuditVerdict { verdict: 'verified' | 'rejected'; checks: AuditCheck[]; note: string; severity: string }

/** Independent verification: re-run from scratch, compare, check ledger invariants and recompute exposure. */
export function auditFinding(finding: Finding, fixes: Set<FixId>): AuditVerdict {
  const checks: AuditCheck[] = [];
  const sc = scenarioById(finding.testCaseId);
  if (!sc) {
    return { verdict: 'rejected', severity: finding.severity, checks: [{ name: 'Scenario exists in library', ok: false, detail: 'Unknown test case; unsupported claim' }], note: 'Rejected: no deterministic reproduction exists for this claim.' };
  }
  const r1 = sc.reproduce(fixes);
  const r2 = sc.reproduce(fixes);
  checks.push({ name: 'Independent reproduction #1', ok: r1.exploited, detail: r1.exploited ? 'Attack succeeded in a fresh simulator' : 'Attack did not succeed' });
  checks.push({ name: 'Independent reproduction #2 (determinism)', ok: r2.exploited && JSON.stringify(r1.actual) === JSON.stringify(r2.actual), detail: `actual outcome ${JSON.stringify(r2.actual)}` });
  const violations = auditLedger(r1.shop);
  checks.push({ name: 'Ledger invariants violated', ok: violations.length > 0, detail: violations.join(' | ') || 'No invariant violation observed' });
  const oracle = sc.oracleLeakage(r1.shop);
  checks.push({ name: 'Exposure recomputed from ledger', ok: Math.abs(oracle - finding.leakage) <= 0.01 && finding.leakage > 0, detail: `claimed $${finding.leakage} vs ledger $${oracle}` });
  checks.push({ name: 'Claim matches library severity', ok: finding.severity === sc.severity, detail: `claimed ${finding.severity}, library ${sc.severity}` });
  const hard = checks.slice(0, 4).every((c) => c.ok);
  return {
    verdict: hard ? 'verified' : 'rejected',
    severity: sc.severity,
    checks,
    note: hard ? (finding.severity === sc.severity ? 'Verified by independent deterministic reproduction.' : `Verified; severity corrected to ${sc.severity} (auditor disagreed with agent).`) : 'Rejected: independent reproduction or ledger check failed.',
  };
}
