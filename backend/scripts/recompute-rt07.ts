/** Repairs RT-07 of a recorded run using PayPal's real refund record. Usage: npx tsx scripts/recompute-rt07.ts <runId> */
import { recomputeRt07 } from '../src/redteam';
import { prisma, getState, effectiveFixes } from '../src/db';
(async () => {
  const id = process.argv[2];
  const run = await prisma.redTeamRun.findUnique({ where: { id } });
  if (!run) throw new Error('run not found');
  const r = await recomputeRt07(id, effectiveFixes(await getState(run.merchantId)));
  console.log(JSON.stringify({ id: r.id, verdict: r.verdict, actual: r.actual, evidence: { ...(r.evidence as any), insight: undefined } }, null, 1));
  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
