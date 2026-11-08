import { prisma, getState } from './db';
import { createAssessment, startAssessment } from './orchestrator';

export const DEMO_NAME = 'NovaCart Electronics';

async function findOrCreate(userId: string) {
  let m = await prisma.merchant.findFirst({ where: { ownerId: userId, isDemo: true } });
  if (!m) {
    m = await prisma.merchant.create({
      data: {
        ownerId: userId, name: DEMO_NAME, isDemo: true, businessType: 'ecommerce - electronics accessories', websiteUrl: null,
        description: 'DEMO MERCHANT (controlled sample application). Sells electronic accessories, runs promotions, supports partial refunds and a simulated PayPal checkout. Contains intentionally seeded weaknesses.',
      },
    });
  }
  await getState(m.id);
  return m;
}

/** Seed = a real simulator run flagged as demo fixture data (not a replay of hardcoded results). */
export async function seedAssessment(merchantId: string) {
  const a = await createAssessment(merchantId, 'demo', true);
  await startAssessment(a.id);
  return a;
}

/** Serialises demo seed/reset per user. Without it, a reset arriving while the first-visit seed is still running deletes the
 *  seed's assessment mid-run and the request fails with a 500. */
const demoLocks = new Map<string, Promise<unknown>>();
function withDemoLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const run = (demoLocks.get(userId) ?? Promise.resolve()).catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  demoLocks.set(userId, tail);
  tail.then(() => { if (demoLocks.get(userId) === tail) demoLocks.delete(userId); });
  return run;
}

export function ensureDemoMerchant(userId: string) {
  return withDemoLock(userId, async () => {
    const m = await findOrCreate(userId);
    if ((await prisma.assessment.count({ where: { merchantId: m.id } })) === 0) await seedAssessment(m.id);
    return m;
  });
}

export function resetDemoMerchant(userId: string, opts: { seed?: boolean } = {}) {
  return withDemoLock(userId, () => resetDemoMerchantUnlocked(userId, opts));
}

async function resetDemoMerchantUnlocked(userId: string, opts: { seed?: boolean } = {}) {
  const m = await findOrCreate(userId);
  await prisma.attackMemory.deleteMany({ where: { merchantId: m.id } });
  await prisma.assessment.deleteMany({ where: { merchantId: m.id } }); // cascades runs, vulnerabilities, defences, tests, chains
  await prisma.vulnerability.deleteMany({ where: { merchantId: m.id } });
  await prisma.report.deleteMany({ where: { merchantId: m.id } });
  await prisma.discoveryRun.deleteMany({ where: { merchantId: m.id } });
  await prisma.redTeamRun.deleteMany({ where: { merchantId: m.id, mode: { not: 'sandbox' } } }); // real PayPal Sandbox runs are evidence (and may await a human buyer): never wiped by a demo reset
  await prisma.sandboxTransaction.deleteMany({ where: { merchantId: m.id, environment: 'local-simulation' } });
  await prisma.demoAppState.update({ where: { merchantId: m.id }, data: { fixes: [], config: {}, history: [] } });
  if (opts.seed !== false) await seedAssessment(m.id);
  return m;
}
