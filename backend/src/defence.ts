import { prisma, getState, effectiveFixes, saveState, audit } from './db';
import { FIXES, buildPatch, verifyFix, fixForScenario, DefenceVerification } from './simulator/fixes';
import { runChain } from './simulator/chains';
import { FixId } from './simulator/shop';
import { AIBudget, askText } from './ai';

/** Chain re-runner used inside verification: reports leakage of each stored chain under a fix set. */
async function chainRunnerFor(merchantId: string) {
  const chains = await prisma.attackChain.findMany({ where: { assessment: { merchantId } }, orderBy: { createdAt: 'desc' } });
  const seen = new Map<string, string[]>();
  for (const c of chains) if (!seen.has(c.signature)) seen.set(c.signature, c.signature.split('>'));
  return (fixes: Set<FixId>) => [...seen.entries()].map(([signature, path]) => ({ signature, leakage: runChain(path, fixes).leakage }));
}

export async function generateDefence(vulnerabilityId: string, budget = new AIBudget(), userId: string | null = null) {
  const v = await prisma.vulnerability.findUnique({ where: { id: vulnerabilityId } });
  if (!v) throw Object.assign(new Error('Vulnerability not found'), { status: 404 });
  if (v.status === 'rejected') throw Object.assign(new Error('Cannot generate a defence for a rejected finding'), { status: 409 });
  const fix = fixForScenario(v.testCaseId);
  if (!fix) throw Object.assign(new Error('No automated patch exists for this finding; follow the remediation guidance instead'), { status: 422 });

  const existing = await prisma.defence.findFirst({ where: { vulnerabilityId, status: { in: ['proposed', 'approved', 'applied', 'verified'] } } });
  if (existing) return existing;

  const patch = buildPatch(fix.id);
  let explanation = fix.explanation;
  let aiGenerated = false;
  const ai = await askText(
    'You are the Defence Architect of a merchant security platform. Explain in at most 4 sentences why the proposed correction removes the root cause, in plain business language. Do not invent code.',
    `Vulnerability: ${v.title}\nRoot cause: ${v.rootCause}\nProposed correction: ${fix.summary}\nDiff:\n${patch.slice(0, 2500)}`, budget);
  if (ai) { explanation = ai; aiGenerated = true; }

  const state = await getState(v.merchantId);
  const dry = verifyFix(fix.id, effectiveFixes(state), await chainRunnerFor(v.merchantId));
  const d = await prisma.defence.create({
    data: {
      vulnerabilityId, fixId: fix.id, proposedFix: `${fix.title}: ${fix.summary}`, patch, explanation, aiGenerated,
      tradeoffs: [...fix.tradeoffs, ...fix.sideEffects.map((s) => 'Side effect: ' + s)] as any, remediationPlan: fix.plan as any, dryRun: dry as any, status: 'proposed',
    },
  });
  await audit(userId, v.merchantId, 'defence.generated', 'Defence', d.id, { fixId: fix.id, dryRunPassed: dry.passed });
  return d;
}

export async function approveDefence(id: string, userId: string) {
  const d = await prisma.defence.findUnique({ where: { id }, include: { vulnerability: true } });
  if (!d) throw Object.assign(new Error('Defence not found'), { status: 404 });
  if (d.status !== 'proposed') throw Object.assign(new Error(`Defence is ${d.status}; only proposed defences can be approved`), { status: 409 });
  const u = await prisma.defence.update({ where: { id }, data: { status: 'approved', approvedAt: new Date(), approvedBy: userId } });
  await audit(userId, d.vulnerability.merchantId, 'defence.approved', 'Defence', id);
  return u;
}

/** Applies the fix to the controlled sample application only. Never touches production. */
export async function applyDefence(id: string, userId: string) {
  const d = await prisma.defence.findUnique({ where: { id }, include: { vulnerability: true } });
  if (!d) throw Object.assign(new Error('Defence not found'), { status: 404 });
  if (d.status !== 'approved') throw Object.assign(new Error('Human approval is required before a patch can be applied'), { status: 409 });
  const m = await prisma.merchant.findUnique({ where: { id: d.vulnerability.merchantId } });
  if (!m?.isDemo) throw Object.assign(new Error('Patches can only be applied to the controlled demo application. Download the patch instead.'), { status: 422 });
  const st = await getState(m.id);
  const applied = [...new Set([...st.applied, d.fixId as FixId])];
  await saveState(m.id, applied, st.config, { action: `apply ${d.fixId}` });
  const u = await prisma.defence.update({ where: { id }, data: { status: 'applied', appliedAt: new Date(), rolledBackAt: null } });
  await audit(userId, m.id, 'defence.applied', 'Defence', id, { fixId: d.fixId });
  return u;
}

export async function rollbackDefence(id: string, userId: string) {
  const d = await prisma.defence.findUnique({ where: { id }, include: { vulnerability: true } });
  if (!d) throw Object.assign(new Error('Defence not found'), { status: 404 });
  if (d.status !== 'applied' && d.status !== 'verified') throw Object.assign(new Error('Only applied defences can be rolled back'), { status: 409 });
  const st = await getState(d.vulnerability.merchantId);
  await saveState(d.vulnerability.merchantId, st.applied.filter((f) => f !== d.fixId), st.config, { action: `rollback ${d.fixId}` });
  await prisma.defence.update({ where: { id }, data: { status: 'rolled_back', rolledBackAt: new Date() } });
  await prisma.vulnerability.update({ where: { id: d.vulnerabilityId }, data: { status: 'verified' } });
  await refreshChains(d.vulnerability.merchantId);
  await prisma.attackMemory.create({ data: { merchantId: d.vulnerability.merchantId, vulnerabilityId: d.vulnerabilityId, kind: 'defence', testCase: { fixId: d.fixId }, result: 'rolled_back', note: 'Fix rolled back; vulnerability reopened' } });
  await audit(userId, d.vulnerability.merchantId, 'defence.rolled_back', 'Defence', id);
  return prisma.defence.findUnique({ where: { id } });
}

/** Run the regression + verification suite against the live (effective) app state. */
export async function runDefenceTests(id: string, userId: string | null = null) {
  const d = await prisma.defence.findUnique({ where: { id }, include: { vulnerability: true } });
  if (!d) throw Object.assign(new Error('Defence not found'), { status: 404 });
  if (d.status !== 'applied' && d.status !== 'verified' && d.status !== 'failed') throw Object.assign(new Error('Apply the patch to the demo app before running verification'), { status: 409 });
  const merchantId = d.vulnerability.merchantId;
  const st = await getState(merchantId);
  const fix = FIXES[d.fixId as FixId];
  const eff = effectiveFixes(st);
  if (!eff.has(fix.id)) throw Object.assign(new Error('Fix is not in force (a business-rule configuration disables it)'), { status: 409 });
  const ver: DefenceVerification = verifyFix(fix.id, eff, await chainRunnerFor(merchantId));

  await prisma.regressionTest.deleteMany({ where: { defenceId: id } });
  const rows: any[] = [];
  const sc = fix.scenarioId;
  rows.push({ testName: `Original attack ${sc} is blocked`, kind: 'original-attack', testInput: { scenario: sc }, expectedResult: 'attack fails', actualResult: `before: exploited=${ver.originalAttack.exploitedBefore} (leak $${ver.originalAttack.leakageBefore}); after: exploited=${ver.originalAttack.exploitedAfter}`, status: ver.originalAttack.exploitedBefore && !ver.originalAttack.exploitedAfter ? 'passed' : 'failed' });
  for (const l of ver.legit) rows.push({ testName: l.name, kind: 'legitimate', testInput: {}, expectedResult: 'legitimate operation works', actualResult: l.detail, status: l.ok ? 'passed' : 'failed' });
  for (const r of ver.regression) rows.push({ testName: `No new exploit in ${r.scenarioId}`, kind: 'regression', testInput: { scenario: r.scenarioId }, expectedResult: 'not newly exploitable', actualResult: `exploited before=${r.wasExploited}, after=${r.exploited}`, status: r.ok ? 'passed' : 'failed' });
  for (const c of ver.chainChecks) rows.push({ testName: `Chain ${c.signature}`, kind: 'regression', testInput: { chain: c.signature }, expectedResult: 'chain blocked (informational if other links remain)', actualResult: c.blocked ? 'blocked' : 'still exploitable via another unfixed link', status: 'passed' });
  await prisma.regressionTest.createMany({ data: rows.map((r) => ({ ...r, defenceId: id })) });

  const passed = ver.passed;
  await prisma.defence.update({ where: { id }, data: { status: passed ? 'verified' : 'failed' } });
  if (passed) await prisma.vulnerability.update({ where: { id: d.vulnerabilityId }, data: { status: 'fixed' } });
  await refreshChains(merchantId);
  await prisma.attackMemory.create({ data: { merchantId, vulnerabilityId: d.vulnerabilityId, kind: 'regression', testCase: { fixId: d.fixId, scenario: sc }, result: passed ? 'passed' : 'failed', note: passed ? 'Fix verified: attack blocked, legitimate flows intact' : 'Verification failed' } });
  await audit(userId, merchantId, 'defence.tested', 'Defence', id, { passed });
  return { passed, verification: ver, tests: await prisma.regressionTest.findMany({ where: { defenceId: id } }) };
}

/** Re-evaluate every stored chain against the current effective fixes. */
export async function refreshChains(merchantId: string) {
  const st = await getState(merchantId);
  const eff = effectiveFixes(st);
  const chains = await prisma.attackChain.findMany({ where: { assessment: { merchantId } } });
  for (const c of chains) {
    const run = runChain(c.signature.split('>'), eff);
    const exposure = { ...((c.exposure as any) || {}), currentLeakage: run.leakage };
    await prisma.attackChain.update({ where: { id: c.id }, data: { status: run.exploited ? 'verified' : 'mitigated', exposure: exposure as any } });
  }
}
