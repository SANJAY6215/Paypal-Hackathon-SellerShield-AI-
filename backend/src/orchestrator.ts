import { prisma, getState, effectiveFixes, audit } from './db';
import { env } from './config';
import { AIBudget, aiStatus } from './ai';
import { SCENARIOS, scenarioById, AgentType } from './simulator/scenarios';
import { FixId } from './simulator/shop';
import { fixForScenario } from './simulator/fixes';
import { generateCandidates, runChain, isolatedLeakage, buildGraph, chainMeta } from './simulator/chains';
import { AGENT_DEFS, ALL_AGENTS, INVESTIGATORS, planProbes, buildFinding, auditFinding, AgentOutputSchema, Finding, AgentOutput, AuditVerdict } from './agents';
import { computeExposure, postureScore } from './finance';
import { generateDefence } from './defence';
import { crawlPublicSite } from './security';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Persists real agent progress (the UI polls this; nothing is simulated client-side). */
class Tracker {
  log: { at: string; msg: string }[] = [];
  constructor(public id: string) {}
  async set(p: { status?: string; task?: string; done?: number; total?: number; output?: unknown; started?: boolean; completed?: boolean }, msg?: string) {
    if (msg) this.log.push({ at: new Date().toISOString(), msg });
    await prisma.agentRun.update({
      where: { id: this.id },
      data: {
        ...(p.status && { status: p.status }), ...(p.task !== undefined && { task: p.task }),
        ...(p.done !== undefined && { progressDone: p.done }), ...(p.total !== undefined && { progressTotal: p.total }),
        ...(p.output !== undefined && { output: p.output as any }), log: this.log as any,
        ...(p.started && { startedAt: new Date() }), ...(p.completed && { completedAt: new Date() }),
      },
    });
  }
}

export async function createAssessment(merchantId: string, mode: 'demo' | 'website' | 'regression', isDemoData = false) {
  const a = await prisma.assessment.create({ data: { merchantId, assessmentMode: mode, isDemoData, status: 'queued', summary: { stage: 'queued' } } });
  if (mode !== 'regression') {
    await prisma.agentRun.createMany({ data: ALL_AGENTS.map((agentType) => ({ assessmentId: a.id, agentType, status: 'idle', task: 'Waiting for assignment' })) });
  }
  return a;
}

async function setStage(id: string, stage: string, extra: Record<string, unknown> = {}) {
  const a = await prisma.assessment.findUnique({ where: { id } });
  await prisma.assessment.update({ where: { id }, data: { summary: { ...((a?.summary as any) || {}), stage, ...extra } as any } });
}

export function startAssessment(id: string): Promise<void> {
  return (async () => {
    const a = await prisma.assessment.findUnique({ where: { id } });
    if (!a || a.status !== 'queued') return;
    await prisma.assessment.update({ where: { id }, data: { status: 'running', startedAt: new Date() } });
    try {
      if (a.assessmentMode === 'regression') await runRegression(id);
      else if (a.assessmentMode === 'website') await runWebsite(id);
      else await runFullAssessment(id);
    } catch (e: any) {
      // the assessment may have been deleted underneath us (e.g. a demo reset): record the failure only if the row still exists
      const stillThere = await prisma.assessment.updateMany({ where: { id }, data: { status: 'failed', completedAt: new Date() } }).catch(() => ({ count: 0 }));
      if (stillThere.count > 0) {
        await setStage(id, 'failed', { error: String(e?.message || e) }).catch(() => undefined);
        await prisma.agentRun.updateMany({ where: { assessmentId: id, status: { notIn: ['completed', 'failed'] } }, data: { status: 'failed' } }).catch(() => undefined);
      }
      console.error('assessment failed', e);
    }
  })();
}

export async function markInterruptedAssessments() {
  await prisma.assessment.updateMany({ where: { status: 'running' }, data: { status: 'failed' } });
}

// --------------------------------------------------------------------------
async function runFullAssessment(assessmentId: string) {
  const a = (await prisma.assessment.findUnique({ where: { id: assessmentId }, include: { merchant: true, agentRuns: true } }))!;
  const merchantId = a.merchantId;
  const state = await getState(merchantId);
  const fixes = effectiveFixes(state);
  const budget = new AIBudget();
  const runs = Object.fromEntries(a.agentRuns.map((r) => [r.agentType, new Tracker(r.id)])) as Record<AgentType, Tracker>;
  const runId = Object.fromEntries(a.agentRuns.map((r) => [r.agentType, r.id])) as Record<AgentType, string>;
  const ai = aiStatus();
  const STEP = a.isDemoData ? 0 : env.stepDelayMs; // seeded fixtures run instantly; live runs are paced so progress is observable
  const profile = `${a.merchant.name} - ${a.merchant.businessType}; sample app with discounts, partial refunds, staff roles and simulated PayPal checkout. Applied fixes: ${[...fixes].join(', ') || 'none'}`;
  await setStage(assessmentId, 'investigating', { aiMode: ai.mode, aiProvider: ai.provider, aiModel: ai.model, appliedFixes: [...fixes] });

  // ---- Phase 1: four investigators in parallel
  const outputs: Partial<Record<AgentType, AgentOutput>> = {};
  await Promise.all(INVESTIGATORS.map(async (agent) => {
    const t = runs[agent];
    try {
      await t.set({ status: 'analysing', task: 'Planning probes from merchant profile', started: true, done: 0 }, `Started ${AGENT_DEFS[agent].name}`);
      const plan = await planProbes(agent, profile, budget);
      await t.set({ total: plan.order.length, task: `Planned ${plan.order.length} probes (${plan.mode === 'ai-assisted' ? 'AI-assisted ordering' : 'deterministic planner'})` }, `Plan: ${plan.order.join(', ')}`);
      const findings: Finding[] = [];
      const cleared: AgentOutput['cleared'] = [];
      let done = 0;
      for (const id of plan.order) {
        const sc = scenarioById(id)!;
        await sleep(STEP);
        await t.set({ status: 'testing', task: `Probing ${id}: ${sc.title}` }, `Running ${id} against the sample application`);
        const run = sc.reproduce(fixes);
        done++;
        if (run.exploited) {
          findings.push(buildFinding(sc, run));
          await t.set({ status: 'finding_discovered', task: `Finding: ${sc.title}`, done }, `Weakness reproduced: ${id} (simulated excess $${run.leakage})`);
          await sleep(Math.min(STEP, 250));
        } else {
          cleared.push({ testCaseId: id, title: sc.title, result: 'Not exploitable' });
          await t.set({ done }, `${id} not exploitable - control holds`);
        }
      }
      const out = AgentOutputSchema.parse({ agentType: agent, status: 'completed', mode: plan.mode, findings, cleared, rejectedHypotheses: plan.rejected });
      outputs[agent] = out;
      await t.set({ status: 'verification_pending', task: `${findings.length} claim(s) awaiting independent audit`, output: out }, 'Investigation complete; handing claims to the Auditor');
    } catch (e: any) {
      await t.set({ status: 'failed', task: 'Failed', completed: true }, `Error: ${String(e?.message || e)}`);
      throw e;
    }
  }));

  // ---- Phase 2: orchestrator correlates (dedupe + chain candidates executed in the simulator)
  await setStage(assessmentId, 'correlating');
  const claims = new Map<string, Finding>();
  for (const agent of INVESTIGATORS) for (const f of outputs[agent]!.findings) if (!claims.has(f.testCaseId)) claims.set(f.testCaseId, f);
  const candidates = generateCandidates([...claims.keys()]);
  const chainRuns = candidates.map((c) => ({ c, run: runChain(c.path, fixes) }));
  await setStage(assessmentId, 'verifying', { claims: claims.size, chainCandidates: candidates.length });

  // ---- Phase 3: Auditor independently verifies claims
  const auditor = runs['auditor'];
  await auditor.set({ status: 'analysing', task: `Independently reproducing ${claims.size} claim(s)`, started: true, done: 0, total: claims.size + chainRuns.length }, 'Auditor started');
  const verdicts = new Map<string, AuditVerdict>();
  let adone = 0;
  for (const [id, f] of claims) {
    await sleep(STEP);
    await auditor.set({ status: 'testing', task: `Reproducing ${id} from scratch` }, `Re-running ${id} in a fresh simulator`);
    const v = auditFinding(f, fixes);
    verdicts.set(id, v);
    adone++;
    await auditor.set({ done: adone }, `${id}: ${v.verdict.toUpperCase()} - ${v.note}`);
  }

  // persist vulnerabilities with lifecycle classification
  const cls = { new: 0, known: 0, resolved: 0, reintroduced: 0, newChains: 0 };
  const dbVuln: Record<string, string> = {};
  for (const [id, f] of claims) {
    const v = verdicts.get(id)!;
    const sc = scenarioById(id)!;
    const prior = await prisma.vulnerability.findUnique({ where: { merchantId_testCaseId: { merchantId, testCaseId: id } } });
    const verified = v.verdict === 'verified';
    let status = verified ? 'verified' : 'rejected';
    let lifecycle = 'new';
    if (prior && verified) {
      if (prior.status === 'fixed' || prior.status === 'resolved') { status = 'reintroduced'; lifecycle = 'reintroduced'; cls.reintroduced++; }
      else { lifecycle = 'known'; cls.known++; if (prior.status === 'reintroduced') status = 'reintroduced'; }
    } else if (verified) cls.new++;
    const exposure = computeExposure(f.leakage, sc.category);
    const data = {
      assessmentId, title: f.title, category: f.category, severity: v.severity, confidence: verified ? Math.min(f.confidence, 0.99) : 0.2,
      description: sc.description, businessRule: f.businessRule, rootCause: f.rootCause, evidence: f.evidence as any, reproductionSteps: f.reproductionSteps as any,
      exposure: exposure as any, agentType: sc.agent, status, lifecycle, auditorNote: v.note, verifiedAt: verified ? new Date() : null,
    };
    const row = prior
      ? await prisma.vulnerability.update({ where: { id: prior.id }, data })
      : await prisma.vulnerability.create({ data: { merchantId, testCaseId: id, ...data } });
    dbVuln[id] = row.id;
    if (status === 'reintroduced') await prisma.defence.updateMany({ where: { vulnerabilityId: row.id, status: { in: ['applied', 'verified'] } }, data: { status: 'failed' } });
    await prisma.attackMemory.create({ data: { merchantId, vulnerabilityId: row.id, kind: 'finding', testCase: { scenario: id, steps: sc.attackSteps }, result: status, note: v.note } });
  }
  // previously-known vulnerabilities that no longer reproduce
  const prior = await prisma.vulnerability.findMany({ where: { merchantId, NOT: { testCaseId: { in: [...claims.keys()] } }, status: { in: ['verified', 'fixed', 'reintroduced', 'detected'] } } });
  for (const p of prior) {
    await prisma.vulnerability.update({ where: { id: p.id }, data: { status: 'resolved', assessmentId, lifecycle: 'known' } });
    cls.resolved++;
    await prisma.attackMemory.create({ data: { merchantId, vulnerabilityId: p.id, kind: 'rerun', testCase: { scenario: p.testCaseId }, result: 'resolved', note: 'No longer reproduces in this assessment' } });
  }

  // chains: verify, then persist
  const fixIdByVuln: Record<string, string | undefined> = {};
  for (const s of SCENARIOS) fixIdByVuln[s.id] = s.fixId;
  for (const { c, run } of chainRuns) {
    await sleep(STEP);
    await auditor.set({ status: 'testing', task: `Verifying chain ${c.signature}` }, `Re-executing chain ${c.signature}`);
    const again = runChain(c.path, fixes);
    const iso = isolatedLeakage(c.path, fixes);
    const maxIso = Math.max(...Object.values(iso));
    const nodesVerified = c.path.every((id) => verdicts.get(id)?.verdict === 'verified');
    const ok = nodesVerified && run.exploited && again.leakage === run.leakage && run.leakage >= maxIso;
    adone++;
    await auditor.set({ done: adone }, `Chain ${c.signature}: ${ok ? 'VERIFIED' : 'REJECTED'} (compound leakage $${run.leakage} vs isolated max $${maxIso})`);
    if (!ok) continue;
    const meta = chainMeta(c.signature);
    const prevChain = await prisma.attackChain.findFirst({ where: { signature: c.signature, assessment: { merchantId } }, orderBy: { createdAt: 'desc' } });
    const lifecycle = !prevChain ? 'new' : prevChain.status === 'mitigated' ? 'reintroduced' : 'known';
    if (lifecycle !== 'known') cls.newChains++;
    const exposure = { ...computeExposure(run.leakage, 'refund', { rates: undefined, note: `Compound chain: isolated weaknesses leak $${Object.values(iso).reduce((a, b) => a + b, 0)} separately; together $${run.leakage} per attack` }), isolated: iso, isolatedSum: Object.values(iso).reduce((a, b) => a + b, 0) };
    const chain = await prisma.attackChain.create({
      data: {
        assessmentId, signature: c.signature, title: meta.title, severity: meta.severity, description: meta.description, estimatedExposure: exposure.exposure.expected,
        exposure: { ...exposure, currentLeakage: run.leakage, rationale: c.rationale } as any, graph: buildGraph(run, c.path, fixIdByVuln) as any,
        expectedOutcome: run.expected as any, actualOutcome: run.actual as any, status: 'verified', lifecycle,
      },
    });
    for (const st of run.steps) {
      await prisma.attackStep.create({ data: { attackChainId: chain.id, vulnerabilityId: st.vulnId ? dbVuln[st.vulnId] : null, sequence: st.n, action: st.action, expectedResult: st.expected, actualResult: st.actual, evidence: st.evidence as any } });
    }
    await prisma.attackMemory.create({ data: { merchantId, attackChainId: chain.id, kind: 'chain', testCase: { path: c.path }, result: 'verified', note: `${meta.title} reproduced (leakage $${run.leakage})` } });
  }
  await auditor.set({ status: 'verification_pending', task: 'Waiting to validate proposed defences' }, 'Claims and chains verified');

  // ---- Phase 4: Defence Architect
  await setStage(assessmentId, 'defending');
  const dt = runs['defence-architect'];
  const verifiedIds = [...claims.keys()].filter((id) => verdicts.get(id)!.verdict === 'verified');
  await dt.set({ status: 'analysing', task: `Designing defences for ${verifiedIds.length} verified vulnerabilit${verifiedIds.length === 1 ? 'y' : 'ies'}`, started: true, done: 0, total: verifiedIds.length }, 'Defence Architect started');
  const defences: { vulnId: string; defenceId: string; dryRunPassed: boolean }[] = [];
  let ddone = 0;
  for (const id of verifiedIds) {
    await sleep(STEP);
    await dt.set({ status: 'testing', task: `Generating correction for ${id}` }, `Root-cause analysis and patch for ${id}`);
    if (!fixForScenario(id)) { ddone++; await dt.set({ done: ddone }, `${id}: no automated patch available`); continue; }
    const d = await generateDefence(dbVuln[id], budget);
    defences.push({ vulnId: id, defenceId: d.id, dryRunPassed: !!(d.dryRun as any)?.passed });
    ddone++;
    await dt.set({ done: ddone }, `${id}: patch + regression plan generated (${(d.dryRun as any)?.passed ? 'sandbox dry-run passed' : 'dry-run failed'})`);
  }
  await dt.set({ status: 'completed', task: 'Defence proposals ready for human review', completed: true, output: { defences } }, 'All defences proposed - awaiting human approval');

  // ---- Phase 5: Auditor validates the proposed defences (dry run)
  await setStage(assessmentId, 'auditing');
  await auditor.set({ status: 'testing', task: 'Dry-running proposed defences in an isolated copy' }, 'Testing every proposed defence against the original attack');
  await sleep(STEP);
  const failedDry = defences.filter((d) => !d.dryRunPassed).length;
  await auditor.set({
    status: 'completed', task: failedDry ? `${failedDry} defence(s) failed dry-run` : 'All proposed defences passed independent dry-run', completed: true,
    output: { verdicts: Object.fromEntries([...verdicts].map(([k, v]) => [k, v])), rejected: [...verdicts].filter(([, v]) => v.verdict === 'rejected').map(([k]) => k), rejectedHypotheses: INVESTIGATORS.flatMap((ag) => outputs[ag]!.rejectedHypotheses) },
  }, 'Auditor finished');
  for (const agent of INVESTIGATORS) await runs[agent].set({ status: 'completed', task: `${outputs[agent]!.findings.length} finding(s) submitted; audit complete`, completed: true });

  await finalize(assessmentId, merchantId, cls, a.isDemoData);
}

async function finalize(assessmentId: string, merchantId: string, cls: Record<string, number>, isDemo: boolean) {
  const open = await prisma.vulnerability.findMany({ where: { merchantId, status: { in: ['verified', 'reintroduced'] } } });
  const exposure = open.reduce((s, v) => s + ((v.exposure as any)?.exposure?.expected ?? 0), 0);
  const chains = await prisma.attackChain.count({ where: { assessmentId } });
  const prev = ((await prisma.assessment.findUnique({ where: { id: assessmentId } }))?.summary as any) || {};
  await prisma.assessment.update({
    where: { id: assessmentId },
    data: {
      status: 'completed', completedAt: new Date(),
      summary: { ...prev, stage: 'completed', classification: cls, metrics: { openVulnerabilities: open.length, posture: postureScore(open), expectedExposure: Math.round(exposure * 100) / 100, chains }, demoData: isDemo } as any,
    },
  });
}

// --------------------------------------------------------------------------
/** Regression Attack Memory: rerun every stored test case against the current app state. */
async function runRegression(assessmentId: string) {
  const a = (await prisma.assessment.findUnique({ where: { id: assessmentId } }))!;
  const merchantId = a.merchantId;
  const fixes = effectiveFixes(await getState(merchantId));
  await setStage(assessmentId, 'regression', { appliedFixes: [...fixes] });
  const known = await prisma.vulnerability.findMany({ where: { merchantId, status: { not: 'rejected' } } });
  const cls = { new: 0, known: 0, resolved: 0, reintroduced: 0, newChains: 0 };
  for (const v of known) {
    const sc = scenarioById(v.testCaseId);
    if (!sc) continue;
    await sleep(Math.min(env.stepDelayMs, 150));
    const run = sc.reproduce(fixes);
    let status = v.status;
    let note = '';
    if (run.exploited) {
      if (v.status === 'fixed' || v.status === 'resolved') { status = 'reintroduced'; cls.reintroduced++; note = 'REGRESSION: previously fixed vulnerability reproduces again (a configuration change likely disabled the fix)'; }
      else { cls.known++; note = 'Still reproducible'; }
    } else {
      if (v.status === 'verified' || v.status === 'reintroduced') { status = 'resolved'; cls.resolved++; note = 'No longer reproducible'; }
      else if (v.status === 'fixed') { status = 'resolved'; cls.resolved++; note = 'Fix confirmed on re-run'; }
      else note = 'Still not reproducible';
    }
    await prisma.vulnerability.update({ where: { id: v.id }, data: { status, lifecycle: status === 'reintroduced' ? 'reintroduced' : v.lifecycle, assessmentId, auditorNote: note, ...(status === 'reintroduced' ? { evidence: run.steps as any } : {}) } });
    if (status === 'reintroduced') await prisma.defence.updateMany({ where: { vulnerabilityId: v.id, status: { in: ['applied', 'verified'] } }, data: { status: 'failed' } });
    await prisma.attackMemory.create({ data: { merchantId, vulnerabilityId: v.id, kind: 'rerun', testCase: { scenario: v.testCaseId }, result: run.exploited ? 'reproduced' : 'blocked', note } });
  }
  // chains
  const chains = await prisma.attackChain.findMany({ where: { assessment: { merchantId } }, orderBy: { createdAt: 'desc' } });
  const seen = new Set<string>();
  for (const c of chains) {
    if (seen.has(c.signature)) continue;
    seen.add(c.signature);
    const run = runChain(c.signature.split('>'), fixes);
    const status = run.exploited ? 'verified' : 'mitigated';
    if (run.exploited && c.status === 'mitigated') cls.newChains++;
    await prisma.attackChain.update({ where: { id: c.id }, data: { status, lifecycle: run.exploited && c.status === 'mitigated' ? 'reintroduced' : c.lifecycle, exposure: { ...((c.exposure as any) || {}), currentLeakage: run.leakage } as any } });
    await prisma.attackMemory.create({ data: { merchantId, attackChainId: c.id, kind: 'rerun', testCase: { path: c.signature }, result: run.exploited ? 'reproduced' : 'blocked', note: run.exploited ? `Leakage $${run.leakage}` : 'Chain blocked' } });
  }
  await finalize(assessmentId, merchantId, cls, false);
}

// --------------------------------------------------------------------------
/** Website mode: controlled crawl of publicly observable pages only. No attack simulation is claimed. */
async function runWebsite(assessmentId: string) {
  const a = (await prisma.assessment.findUnique({ where: { id: assessmentId }, include: { merchant: true } }))!;
  if (!a.merchant.websiteUrl) throw new Error('Merchant has no website URL');
  await setStage(assessmentId, 'crawling');
  const crawl = await crawlPublicSite(a.merchant.websiteUrl);
  await setStage(assessmentId, 'completed', { crawl, scope: 'public-observation-only', classification: { new: 0, known: 0, resolved: 0, reintroduced: 0, newChains: 0 }, metrics: { openVulnerabilities: 0, posture: null, expectedExposure: 0, chains: 0 } });
  await prisma.assessment.update({ where: { id: assessmentId }, data: { status: 'completed', completedAt: new Date() } });
  await audit(null, a.merchantId, 'website.crawled', 'Assessment', assessmentId, { pages: crawl.pagesFetched.length });
}
