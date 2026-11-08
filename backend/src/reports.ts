import PDFDocument from 'pdfkit';
import { Writable } from 'node:stream';
import { prisma, getState, effectiveFixes } from './db';
import { aiStatus } from './ai';
import { ASSUMPTIONS, SIM_LABEL, postureScore } from './finance';
import * as paypal from './paypal';

export async function buildReport(merchantId: string) {
  const m = (await prisma.merchant.findUnique({ where: { id: merchantId } }))!;
  const st = await getState(merchantId);
  const vulns = await prisma.vulnerability.findMany({ where: { merchantId }, include: { defences: { include: { tests: true } } }, orderBy: { createdAt: 'asc' } });
  const allChains = await prisma.attackChain.findMany({ where: { assessment: { merchantId } }, orderBy: { createdAt: 'desc' }, include: { steps: { orderBy: { sequence: 'asc' } } } });
  const chains = [...new Map(allChains.map((c) => [c.signature, c])).values()];
  const last = await prisma.assessment.findFirst({ where: { merchantId }, orderBy: { createdAt: 'desc' } });
  const tx = await prisma.sandboxTransaction.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' }, take: 20 });
  const wh = await prisma.webhookEvent.findMany({ orderBy: { receivedAt: 'desc' }, take: 20 });
  const open = vulns.filter((v) => v.status === 'verified' || v.status === 'reintroduced');
  const pp = await paypal.status();
  return {
    generatedAt: new Date().toISOString(),
    disclaimer: `${SIM_LABEL}. All attack scenarios ran in an isolated local simulator against a controlled sample application. Figures are modelled projections, not actual merchant losses. SellerShield AI is a merchant-side security testing tool; it is not endorsed or certified by PayPal.`,
    merchant: { id: m.id, name: m.name, websiteUrl: m.websiteUrl, businessType: m.businessType, description: m.description, isDemoMerchant: m.isDemo },
    scope: {
      mode: last?.assessmentMode ?? null, assessmentId: last?.id ?? null, completedAt: last?.completedAt ?? null, isDemoData: last?.isDemoData ?? false,
      analysisMode: aiStatus().mode, aiModel: aiStatus().model,
      statement: m.isDemo ? 'Controlled NovaCart sample application (business logic under test). Agents, simulator and verification are deterministic.' : 'Publicly observable configuration only; internal checkout, refund and payment logic was not tested.',
      appliedFixes: [...effectiveFixes(st)],
    },
    summary: { postureScore: postureScore(open), totalFindings: vulns.filter((v) => v.status !== 'rejected').length, open: open.length, fixedOrResolved: vulns.filter((v) => v.status === 'fixed' || v.status === 'resolved').length, reintroduced: vulns.filter((v) => v.status === 'reintroduced').length, rejectedClaims: vulns.filter((v) => v.status === 'rejected').length, compoundChains: chains.length },
    vulnerabilities: vulns.map((v) => ({
      testCaseId: v.testCaseId, title: v.title, category: v.category, severity: v.severity, status: v.status, lifecycle: v.lifecycle, confidence: v.confidence, rootCause: v.rootCause,
      businessRule: v.businessRule, reproductionSteps: v.reproductionSteps, evidence: v.evidence, exposure: v.exposure, auditorNote: v.auditorNote,
      defence: v.defences[0] ? { fixId: v.defences[0].fixId, status: v.defences[0].status, proposedFix: v.defences[0].proposedFix, explanation: v.defences[0].explanation, tradeoffs: v.defences[0].tradeoffs, patch: v.defences[0].patch, tests: v.defences[0].tests.map((t) => ({ name: t.testName, kind: t.kind, status: t.status, actual: t.actualResult })) } : null,
    })),
    attackChains: chains.map((c) => ({ title: c.title, signature: c.signature, severity: c.severity, status: c.status, lifecycle: c.lifecycle, description: c.description, expectedOutcome: c.expectedOutcome, actualOutcome: c.actualOutcome, exposure: c.exposure, steps: c.steps.map((s) => ({ n: s.sequence, action: s.action, expected: s.expectedResult, actual: s.actualResult })) })),
    financial: { assumptions: ASSUMPTIONS, totalExpectedOpenExposure: Math.round(open.reduce((s, v) => s + ((v.exposure as any)?.exposure?.expected ?? 0), 0) * 100) / 100 },
    paypalIntegration: { mode: pp.mode, oauth: pp.oauth, label: pp.label, transactions: tx.map((t) => ({ orderId: t.paypalOrderId, captureId: t.captureId, refundId: t.refundId, amount: t.amount, status: t.status, environment: t.environment })), webhookEvents: wh.map((w) => ({ eventId: w.eventId, type: w.eventType, verification: w.verificationStatus, processing: w.processingStatus })) },
    safety: ['No patch is applied without human approval and a displayed diff.', 'Patches apply only to the controlled demo application; rollback is available.', 'Uploaded files are stored as inert text and never executed.'],
  };
}

export function streamReportPdf(r: any, out: Writable) {
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  doc.pipe(out);
  const h1 = (t: string) => doc.moveDown(0.8).fontSize(15).fillColor('#0b2545').text(t).moveDown(0.3);
  const p = (t: string, o: any = {}) => doc.fontSize(9.5).fillColor('#222').text(t, o);
  doc.fontSize(22).fillColor('#0b2545').text('SellerShield AI');
  doc.fontSize(12).fillColor('#444').text('Security Assessment Report - Attack. Discover. Defend. Verify.');
  doc.moveDown(0.5); p(`Merchant: ${r.merchant.name}${r.merchant.isDemoMerchant ? ' (DEMO MERCHANT)' : ''}`); p(`Generated: ${r.generatedAt}`);
  doc.moveDown(0.4).fontSize(9).fillColor('#a33').text(r.disclaimer);
  h1('Assessment scope'); p(r.scope.statement); p(`Analysis mode: ${r.scope.analysisMode}; applied fixes: ${r.scope.appliedFixes.join(', ') || 'none'}${r.scope.isDemoData ? ' (latest scan is a demo fixture)' : ''}`);
  h1('Summary'); p(`Posture score ${r.summary.postureScore}/100 - ${r.summary.open} open, ${r.summary.fixedOrResolved} fixed/resolved, ${r.summary.reintroduced} reintroduced, ${r.summary.rejectedClaims} rejected claims, ${r.summary.compoundChains} compound chains.`);
  p(`Modelled expected exposure of open vulnerabilities: $${r.financial.totalExpectedOpenExposure} (simulated projection).`);
  h1('Vulnerabilities');
  for (const v of r.vulnerabilities) {
    doc.moveDown(0.4).fontSize(11).fillColor('#111').text(`${v.testCaseId} - ${v.title}  [${v.severity.toUpperCase()}] (${v.status})`);
    p(`Root cause: ${v.rootCause}`);
    if (v.exposure) p(`Exposure (simulated): $${v.exposure.perAttack}/attack; annual low $${v.exposure.exposure.low} / expected $${v.exposure.exposure.expected} / high $${v.exposure.exposure.high}. Confidence: ${v.exposure.confidence.level}.`);
    p(`Auditor: ${v.auditorNote ?? '-'}`);
    for (const e of (v.evidence as any[]).slice(0, 4)) p(`  Step ${e.n}: ${e.action} -> expected "${e.expected}", actual "${e.actual}"`);
    if (v.defence) { p(`Defence (${v.defence.status}): ${v.defence.proposedFix}`); for (const t of v.defence.tests) p(`  [${t.status}] ${t.name}`); }
  }
  h1('Compound attack chains');
  for (const c of r.attackChains) {
    doc.moveDown(0.3).fontSize(11).fillColor('#111').text(`${c.title} [${c.severity.toUpperCase()}] (${c.status})`); p(c.description);
    for (const s of c.steps) p(`  ${s.n}. ${s.action}\n      expected: ${s.expected}\n      actual:   ${s.actual}`);
    p(`Expected merchant position $${c.expectedOutcome.merchantPosition} vs actual $${c.actualOutcome.merchantPosition}.`);
  }
  h1('PayPal integration'); p(`${r.paypalIntegration.label}; OAuth: ${r.paypalIntegration.oauth}`);
  for (const t of r.paypalIntegration.transactions) p(`  ${t.orderId} ${t.status} $${t.amount} [${t.environment}]`);
  for (const w of r.paypalIntegration.webhookEvents) p(`  webhook ${w.type} verification=${w.verification} processing=${w.processing}`);
  doc.end();
}
