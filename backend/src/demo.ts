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

export async function ensureDemoMerchant(userId: string) {
  const m = await findOrCreate(userId);
  if ((await prisma.assessment.count({ where: { merchantId: m.id } })) === 0) await seedAssessment(m.id);
  return m;
}

export async function resetDemoMerchant(userId: string, opts: { seed?: boolean } = {}) {
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
