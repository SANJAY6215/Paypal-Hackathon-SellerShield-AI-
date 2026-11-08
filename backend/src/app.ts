import express, { Request, Response, NextFunction, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z, ZodError, ZodType } from 'zod';
import crypto from 'node:crypto';
import { prisma, getState, effectiveFixes, saveState, audit, AppConfig } from './db';
import { env } from './config';
import { aiStatus } from './ai';
import { createAssessment, startAssessment } from './orchestrator';
import { SCENARIOS, scenarioById } from './simulator/scenarios';
import { runChain } from './simulator/chains';
import { FIXES } from './simulator/fixes';
import { generateDefence, approveDefence, applyDefence, rollbackDefence, runDefenceTests } from './defence';
import * as paypal from './paypal';
import { validateUpload, MAX_UPLOAD_BYTES, validateUrlShape, crawlPublicSite } from './security';
import { ASSUMPTIONS, postureScore, SIM_LABEL } from './finance';
import { buildReport, streamReportPdf } from './reports';
import { ensureDemoMerchant, resetDemoMerchant } from './demo';
import { startRedTeam, continueRedTeam, targetConfig } from './redteam';
import { guidedSearch, llmAttacker, TraceEvent } from './discovery';
import { llmProviders } from './config';
import { createPayPalEmulator } from './mocks/paypal-emulator';
import { buildPrPackage, openPullRequest, verifyPullRequest, githubPreflight, githubConfigured } from './github';

type Authed = Request & { user: { id: string; email: string; name: string; role: string } };
const httpErr = (status: number, message: string) => Object.assign(new Error(message), { status });
const wrap = (fn: (req: Authed, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req as Authed, res).catch(next);
const parse = <T>(schema: ZodType<T, any, any>, data: unknown): T => schema.parse(data);

function signToken(u: { id: string; role: string }) { return jwt.sign({ sub: u.id, role: u.role }, env.jwtSecret, { expiresIn: '8h' }); }
function setCookie(res: Response, token: string) { res.cookie('ss_token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 3600 * 1000 }); }

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const h = req.headers.authorization;
    const token = req.cookies?.ss_token || (h?.startsWith('Bearer ') ? h.slice(7) : '');
    if (!token) throw httpErr(401, 'Authentication required');
    const p = jwt.verify(token, env.jwtSecret) as { sub: string };
    const u = await prisma.user.findUnique({ where: { id: p.sub } });
    if (!u) throw httpErr(401, 'Invalid session');
    (req as Authed).user = { id: u.id, email: u.email, name: u.name, role: u.role };
    next();
  } catch (e: any) { next(e.status ? e : httpErr(401, 'Invalid or expired session')); }
}
const requireRole = (...roles: string[]) => (req: Request, _res: Response, next: NextFunction) =>
  roles.includes((req as Authed).user.role) ? next() : next(httpErr(403, `Role ${(req as Authed).user.role} is not permitted to do this`));

async function ownMerchant(req: Authed, id: string) {
  const m = await prisma.merchant.findUnique({ where: { id } });
  if (!m || m.ownerId !== req.user.id) throw httpErr(404, 'Merchant not found');
  return m;
}
const ownedIds = async (req: Authed) => (await prisma.merchant.findMany({ where: { ownerId: req.user.id }, select: { id: true } })).map((m) => m.id);
async function ownVuln(req: Authed, id: string) {
  const v = await prisma.vulnerability.findUnique({ where: { id }, include: { defences: { include: { tests: true }, orderBy: { createdAt: 'desc' } } } });
  if (!v) throw httpErr(404, 'Vulnerability not found');
  await ownMerchant(req, v.merchantId);
  return v;
}
async function ownDefence(req: Authed, id: string) {
  const d = await prisma.defence.findUnique({ where: { id }, include: { vulnerability: true, tests: true } });
  if (!d) throw httpErr(404, 'Defence not found');
  await ownMerchant(req, d.vulnerability.merchantId);
  return d;
}
async function ownAssessment(req: Authed, id: string) {
  const a = await prisma.assessment.findUnique({ where: { id } });
  if (!a) throw httpErr(404, 'Assessment not found');
  await ownMerchant(req, a.merchantId);
  return a;
}
const page = (req: Request) => { const l = Math.min(100, Math.max(1, Number(req.query.limit) || 25)); const p = Math.max(1, Number(req.query.page) || 1); return { take: l, skip: (p - 1) * l, page: p, limit: l }; };
const strip = (run: any) => { const { shop, ...rest } = run; return rest; };

/** Local idempotency for state-changing PayPal operations (Idempotency-Key header). */
async function idempotent(req: Authed, scope: string, fn: () => Promise<unknown>) {
  const k = req.headers['idempotency-key'];
  if (!k) return fn();
  const key = `${req.user.id}:${scope}:${String(k).slice(0, 100)}`;
  const hit = await prisma.idempotencyKey.findUnique({ where: { key } });
  if (hit) return { ...(hit.response as object), idempotentReplay: true };
  const out = JSON.parse(JSON.stringify(await fn()));
  await prisma.idempotencyKey.create({ data: { key, scope, response: out } }).catch(() => null);
  return out;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.appUrl, credentials: true }));
  app.use(cookieParser());
  const limiter = rateLimit({ windowMs: 60_000, limit: process.env.NODE_ENV === 'test' ? 100000 : 600, standardHeaders: true, legacyHeaders: false });
  const strict = rateLimit({ windowMs: 60_000, limit: process.env.NODE_ENV === 'test' ? 100000 : 30, standardHeaders: true, legacyHeaders: false });
  app.use('/api', limiter);

  // PayPal webhook needs the RAW body for signature verification.
  app.post('/api/paypal/webhooks', express.raw({ type: '*/*', limit: '256kb' }), wrap(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const out = await paypal.processWebhook(req.headers as any, raw);
    res.status(out.code).json(out.body);
  }));

  app.use(express.json({ limit: '256kb' }));
  const api = Router();

  // ---------------------------------------------------------------- health
  api.get('/health', (_req, res) => res.json({ ok: true, demoMode: env.demoMode, ai: aiStatus(), paypalMode: paypal.ppMode(), time: new Date().toISOString() }));

  // ------------------------------------------------------------------ auth
  const creds = z.object({ email: z.string().email().max(200), password: z.string().min(8).max(200) });
  api.post('/auth/register', strict, wrap(async (req, res) => {
    const b = parse(creds.extend({ name: z.string().min(1).max(100) }), req.body);
    if (await prisma.user.findUnique({ where: { email: b.email.toLowerCase() } })) throw httpErr(409, 'Email already registered');
    const u = await prisma.user.create({ data: { name: b.name, email: b.email.toLowerCase(), passwordHash: await bcrypt.hash(b.password, 10), role: 'analyst' } });
    setCookie(res, signToken(u));
    res.status(201).json({ user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  }));
  api.post('/auth/login', strict, wrap(async (req, res) => {
    const b = parse(creds, req.body);
    const u = await prisma.user.findUnique({ where: { email: b.email.toLowerCase() } });
    if (!u || !(await bcrypt.compare(b.password, u.passwordHash))) throw httpErr(401, 'Invalid email or password');
    setCookie(res, signToken(u));
    res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  }));
  api.post('/auth/demo', strict, wrap(async (_req, res) => {
    if (!env.demoMode) throw httpErr(403, 'Demo mode is disabled');
    const email = 'demo@sellershield.ai';
    const u = (await prisma.user.findUnique({ where: { email } })) ?? (await prisma.user.create({ data: { name: 'Demo Analyst', email, passwordHash: await bcrypt.hash(crypto.randomUUID(), 10), role: 'admin' } }));
    const m = await ensureDemoMerchant(u.id);
    setCookie(res, signToken(u));
    res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role }, merchantId: m.id });
  }));
  api.post('/auth/logout', (_req, res) => { res.clearCookie('ss_token'); res.json({ ok: true }); });
  api.get('/auth/me', requireAuth, (req, res) => res.json({ user: (req as Authed).user }));

  // everything below requires a session
  api.use(requireAuth);
  const A = (r: Request) => r as Authed;

  // -------------------------------------------------------------- merchants
  const merchantBody = z.object({ name: z.string().min(1).max(120), websiteUrl: z.string().max(300).optional().nullable(), businessType: z.string().max(60).optional(), description: z.string().max(1000).optional().nullable() });
  api.post('/merchants', wrap(async (req, res) => {
    const b = parse(merchantBody, req.body);
    if (b.websiteUrl) validateUrlShape(b.websiteUrl);
    const m = await prisma.merchant.create({ data: { ownerId: req.user.id, name: b.name, websiteUrl: b.websiteUrl || null, businessType: b.businessType || 'ecommerce', description: b.description || null } });
    await audit(req.user.id, m.id, 'merchant.created', 'Merchant', m.id);
    res.status(201).json(m);
  }));
  api.get('/merchants', wrap(async (req, res) => res.json(await prisma.merchant.findMany({ where: { ownerId: req.user.id }, orderBy: { createdAt: 'asc' } }))));
  api.get('/merchants/:id', wrap(async (req, res) => {
    const m = await ownMerchant(req, req.params.id);
    const st = await getState(m.id);
    res.json({ ...m, appliedFixes: st.applied, effectiveFixes: [...effectiveFixes(st)], config: st.config, history: st.history, documents: await prisma.uploadedDocument.findMany({ where: { merchantId: m.id }, select: { id: true, filename: true, kind: true, sizeBytes: true, sha256: true, createdAt: true } }) });
  }));
  api.patch('/merchants/:id', wrap(async (req, res) => {
    const m = await ownMerchant(req, req.params.id);
    const b = parse(merchantBody.partial(), req.body);
    if (b.websiteUrl) validateUrlShape(b.websiteUrl);
    res.json(await prisma.merchant.update({ where: { id: m.id }, data: b }));
  }));
  const configBody = z.object({
    stackableCoupons: z.boolean().optional(), refundAllocation: z.enum(['list', 'proportional']).optional(), enforceRefundIdempotency: z.boolean().optional(),
    atomicInventory: z.boolean().optional(), strictPaymentStates: z.boolean().optional(), refundRbac: z.boolean().optional(),
  }).strict();
  api.patch('/merchants/:id/config', requireRole('admin', 'analyst'), wrap(async (req, res) => {
    const m = await ownMerchant(req, req.params.id);
    if (!m.isDemo) throw httpErr(422, 'Business-rule configuration applies to the controlled demo application only');
    const st = await getState(m.id);
    const config = { ...st.config, ...parse(configBody, req.body) } as AppConfig;
    await saveState(m.id, st.applied, config, { action: 'config change' });
    await audit(req.user.id, m.id, 'config.changed', 'Merchant', m.id, req.body);
    res.json({ config, effectiveFixes: [...effectiveFixes({ applied: st.applied, config })] });
  }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  api.post('/merchants/:id/documents', requireRole('admin', 'analyst'), upload.single('file'), wrap(async (req, res) => {
    const m = await ownMerchant(req, req.params.id);
    if (!req.file) throw httpErr(400, 'No file uploaded (field name: file)');
    let v;
    try { v = validateUpload(req.file.originalname, req.file.buffer); } catch (e: any) { throw httpErr(400, e.message); }
    const doc = await prisma.uploadedDocument.create({ data: { merchantId: m.id, filename: req.file.originalname, kind: v.kind, sizeBytes: req.file.size, sha256: v.sha256, content: v.text } });
    await audit(req.user.id, m.id, 'document.uploaded', 'UploadedDocument', doc.id, { kind: v.kind, sha256: v.sha256 });
    res.status(201).json({ id: doc.id, filename: doc.filename, kind: doc.kind, sizeBytes: doc.sizeBytes, note: 'Stored as inert text. Uploaded files are never executed.' });
  }));
  api.post('/merchants/:id/crawl-preview', strict, wrap(async (req, res) => {
    const m = await ownMerchant(req, req.params.id);
    if (!m.websiteUrl) throw httpErr(422, 'Merchant has no website URL');
    res.json(await crawlPublicSite(m.websiteUrl));
  }));
  api.post('/merchants/:id/rerun', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => {
    const m = await ownMerchant(req, req.params.id);
    const a = await createAssessment(m.id, 'regression');
    void startAssessment(a.id);
    res.status(202).json({ assessmentId: a.id });
  }));

  // ------------------------------------------------------------ assessments
  api.post('/assessments', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => {
    const b = parse(z.object({ merchantId: z.string(), mode: z.enum(['demo', 'website', 'regression']).default('demo'), start: z.boolean().optional() }), req.body);
    const m = await ownMerchant(req, b.merchantId);
    if (b.mode === 'demo' && !m.isDemo) throw httpErr(422, 'Agent attack simulation runs only against the controlled sample application. Use website analysis for other merchants.');
    if (b.mode === 'website' && !m.websiteUrl) throw httpErr(422, 'Merchant has no website URL');
    const a = await createAssessment(m.id, b.mode);
    await audit(req.user.id, m.id, 'assessment.created', 'Assessment', a.id, { mode: b.mode });
    if (b.start) void startAssessment(a.id);
    res.status(201).json(a);
  }));
  api.get('/assessments', wrap(async (req, res) => {
    const p = page(req);
    const where = { merchantId: req.query.merchantId ? String(req.query.merchantId) : { in: await ownedIds(req) } };
    if (req.query.merchantId) await ownMerchant(req, String(req.query.merchantId));
    const [items, total] = await Promise.all([prisma.assessment.findMany({ where, orderBy: { createdAt: 'desc' }, take: p.take, skip: p.skip }), prisma.assessment.count({ where })]);
    res.json({ items, total, page: p.page, limit: p.limit });
  }));
  api.get('/assessments/:id', wrap(async (req, res) => {
    await ownAssessment(req, req.params.id);
    res.json(await prisma.assessment.findUnique({ where: { id: req.params.id }, include: { agentRuns: true, vulnerabilities: true, chains: { select: { id: true, title: true, severity: true, status: true, estimatedExposure: true } } } }));
  }));
  api.post('/assessments/:id/start', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => {
    const a = await ownAssessment(req, req.params.id);
    if (a.status !== 'queued') throw httpErr(409, `Assessment is already ${a.status}`);
    void startAssessment(a.id);
    res.status(202).json({ id: a.id, status: 'running' });
  }));
  api.get('/assessments/:id/status', wrap(async (req, res) => {
    await ownAssessment(req, req.params.id);
    const a = (await prisma.assessment.findUnique({ where: { id: req.params.id }, include: { agentRuns: true } }))!;
    res.json({ id: a.id, status: a.status, mode: a.assessmentMode, isDemoData: a.isDemoData, summary: a.summary, startedAt: a.startedAt, completedAt: a.completedAt, agents: a.agentRuns.map((r) => agentView(r)) });
  }));
  api.get('/assessments/:id/agents', wrap(async (req, res) => {
    await ownAssessment(req, req.params.id);
    res.json((await prisma.agentRun.findMany({ where: { assessmentId: req.params.id } })).map((r) => agentView(r)));
  }));
  api.get('/agents/:id', wrap(async (req, res) => {
    const r = await prisma.agentRun.findUnique({ where: { id: req.params.id } });
    if (!r) throw httpErr(404, 'Agent run not found');
    await ownAssessment(req, r.assessmentId);
    res.json(agentView(r, true));
  }));

  // ---------------------------------------------------------- vulnerabilities
  api.get('/scenarios', (_req, res) => res.json(SCENARIOS.map(({ reproduce, oracleLeakage, ...s }) => s)));
  api.get('/vulnerabilities', wrap(async (req, res) => {
    const p = page(req);
    if (req.query.merchantId) await ownMerchant(req, String(req.query.merchantId));
    const where: any = { merchantId: req.query.merchantId ? String(req.query.merchantId) : { in: await ownedIds(req) } };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.severity) where.severity = String(req.query.severity);
    const [items, total] = await Promise.all([prisma.vulnerability.findMany({ where, orderBy: [{ updatedAt: 'desc' }], take: p.take, skip: p.skip, include: { defences: { select: { id: true, status: true, fixId: true } } } }), prisma.vulnerability.count({ where })]);
    res.json({ items, total, page: p.page, limit: p.limit });
  }));
  api.get('/vulnerabilities/:id', wrap(async (req, res) => {
    const v = await ownVuln(req, req.params.id);
    const steps = await prisma.attackStep.findMany({ where: { vulnerabilityId: v.id }, include: { attackChain: { select: { id: true, title: true, severity: true, status: true } } } });
    const chains = [...new Map(steps.map((s) => [s.attackChain.id, s.attackChain])).values()];
    const sc = scenarioById(v.testCaseId);
    res.json({ ...v, chains, scenario: sc && { id: sc.id, preconditions: sc.preconditions, attackSteps: sc.attackSteps, expectedSecure: sc.expectedSecure, vulnerableBehaviour: sc.vulnerableBehaviour, testData: sc.testData }, hasAutomatedFix: !!sc?.fixId });
  }));
  api.post('/vulnerabilities/:id/reproduce', strict, wrap(async (req, res) => {
    const v = await ownVuln(req, req.params.id);
    const sc = scenarioById(v.testCaseId);
    if (!sc) throw httpErr(422, 'No reproduction function for this finding');
    const eff = effectiveFixes(await getState(v.merchantId));
    const run = sc.reproduce(eff);
    await prisma.attackMemory.create({ data: { merchantId: v.merchantId, vulnerabilityId: v.id, kind: 'rerun', testCase: { scenario: sc.id }, result: run.exploited ? 'reproduced' : 'blocked', note: 'Manual reproduction' } });
    res.json({ label: 'LOCAL SIMULATION - not a real-world attack', appliedFixes: [...eff], ...strip(run) });
  }));
  api.post('/vulnerabilities/:id/generate-fix', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => {
    await ownVuln(req, req.params.id);
    res.status(201).json(await generateDefence(req.params.id, undefined, req.user.id));
  }));
  api.post('/vulnerabilities/:id/resolve', requireRole('admin', 'analyst'), wrap(async (req, res) => {
    const v = await ownVuln(req, req.params.id);
    if (v.status !== 'fixed') throw httpErr(409, 'Only vulnerabilities with a verified fix can be marked resolved');
    await audit(req.user.id, v.merchantId, 'vulnerability.resolved', 'Vulnerability', v.id);
    res.json(await prisma.vulnerability.update({ where: { id: v.id }, data: { status: 'resolved' } }));
  }));

  // ------------------------------------------------------------ attack chains
  api.get('/attack-chains', wrap(async (req, res) => {
    const p = page(req);
    if (req.query.merchantId) await ownMerchant(req, String(req.query.merchantId));
    const ids = req.query.merchantId ? [String(req.query.merchantId)] : await ownedIds(req);
    const where: any = { assessment: { merchantId: { in: ids } } };
    if (req.query.assessmentId) where.assessmentId = String(req.query.assessmentId);
    const [items, total] = await Promise.all([prisma.attackChain.findMany({ where, orderBy: { createdAt: 'desc' }, take: p.take, skip: p.skip }), prisma.attackChain.count({ where })]);
    res.json({ items, total, page: p.page, limit: p.limit });
  }));
  api.get('/attack-chains/:id', wrap(async (req, res) => {
    const c = await prisma.attackChain.findUnique({ where: { id: req.params.id }, include: { steps: { orderBy: { sequence: 'asc' }, include: { vulnerability: { select: { id: true, testCaseId: true, title: true, severity: true, status: true, rootCause: true } } } }, assessment: true } });
    if (!c) throw httpErr(404, 'Attack chain not found');
    await ownMerchant(req, c.assessment.merchantId);
    res.json(c);
  }));
  api.post('/attack-chains/:id/execute', strict, wrap(async (req, res) => {
    const c = await prisma.attackChain.findUnique({ where: { id: req.params.id }, include: { assessment: true } });
    if (!c) throw httpErr(404, 'Attack chain not found');
    await ownMerchant(req, c.assessment.merchantId);
    const eff = effectiveFixes(await getState(c.assessment.merchantId));
    const run = runChain(c.signature.split('>'), eff);
    res.json({ label: 'LOCAL SIMULATION - not a real-world attack', appliedFixes: [...eff], blocked: !run.exploited, ...strip(run) });
  }));

  // ---------------------------------------------------------------- defences
  api.get('/defences', wrap(async (req, res) => {
    if (req.query.merchantId) await ownMerchant(req, String(req.query.merchantId));
    const ids = req.query.merchantId ? [String(req.query.merchantId)] : await ownedIds(req);
    res.json(await prisma.defence.findMany({ where: { vulnerability: { merchantId: { in: ids } } }, orderBy: { createdAt: 'desc' }, include: { vulnerability: { select: { id: true, testCaseId: true, title: true, severity: true, status: true } }, tests: true } }));
  }));
  api.get('/defences/:id', wrap(async (req, res) => { const d = await ownDefence(req, req.params.id); res.json({ ...d, fix: { title: FIXES[d.fixId as keyof typeof FIXES]?.title, file: FIXES[d.fixId as keyof typeof FIXES]?.file } }); }));
  api.get('/defences/:id/patch', wrap(async (req, res) => { const d = await ownDefence(req, req.params.id); res.type('text/x-diff').attachment(`${d.fixId}.patch`).send(d.patch); }));
  api.post('/defences/:id/approve', requireRole('admin', 'analyst'), wrap(async (req, res) => { await ownDefence(req, req.params.id); res.json(await approveDefence(req.params.id, req.user.id)); }));
  api.post('/defences/:id/apply', requireRole('admin', 'analyst'), wrap(async (req, res) => {
    await ownDefence(req, req.params.id);
    if (req.body?.confirm !== true) throw httpErr(400, 'Explicit confirmation required: send {"confirm": true} after reviewing the diff');
    res.json(await applyDefence(req.params.id, req.user.id));
  }));
  api.post('/defences/:id/rollback', requireRole('admin', 'analyst'), wrap(async (req, res) => { await ownDefence(req, req.params.id); res.json(await rollbackDefence(req.params.id, req.user.id)); }));
  api.post('/defences/:id/run-tests', strict, wrap(async (req, res) => { await ownDefence(req, req.params.id); res.json(await runDefenceTests(req.params.id, req.user.id)); }));
  api.get('/defences/:id/test-results', wrap(async (req, res) => { const d = await ownDefence(req, req.params.id); res.json({ status: d.status, dryRun: d.dryRun, tests: d.tests }); }));

  // ------------------------------------------------------- dashboard / finance / memory
  api.get('/dashboard', wrap(async (req, res) => {
    const m = await ownMerchant(req, String(req.query.merchantId));
    const vulns = await prisma.vulnerability.findMany({ where: { merchantId: m.id } });
    const open = vulns.filter((v) => v.status === 'verified' || v.status === 'reintroduced');
    const chains = await latestChains(m.id);
    const assessments = await prisma.assessment.findMany({ where: { merchantId: m.id }, orderBy: { createdAt: 'desc' }, take: 8 });
    const exposure = open.reduce((s, v) => s + ((v.exposure as any)?.exposure?.expected ?? 0), 0);
    const events = await prisma.auditLog.findMany({ where: { merchantId: m.id }, orderBy: { createdAt: 'desc' }, take: 10 });
    const st = await getState(m.id);
    res.json({
      merchant: { id: m.id, name: m.name, isDemo: m.isDemo },
      posture: { score: postureScore(open), method: '100 minus weighted open vulnerabilities (critical 20, high 12, medium 6, low 3)' },
      counts: {
        verified: vulns.filter((v) => v.status !== 'rejected').length, open: open.length, critical: open.filter((v) => v.severity === 'critical').length,
        resolved: vulns.filter((v) => v.status === 'fixed' || v.status === 'resolved').length, reintroduced: vulns.filter((v) => v.status === 'reintroduced').length,
        rejected: vulns.filter((v) => v.status === 'rejected').length, chains: chains.length, openChains: chains.filter((c) => c.status === 'verified').length,
      },
      exposure: { expected: Math.round(exposure * 100) / 100, label: SIM_LABEL, note: 'Sum of open vulnerabilities. Chains overlap these and are not added again.' },
      latestAssessment: assessments[0] ?? null,
      recentAssessments: assessments, recentEvents: events, appliedFixes: [...effectiveFixes(st)],
      topOpen: open.sort((a, b) => ((b.exposure as any)?.exposure?.expected ?? 0) - ((a.exposure as any)?.exposure?.expected ?? 0)).slice(0, 5).map((v) => ({ id: v.id, title: v.title, severity: v.severity, expected: (v.exposure as any)?.exposure?.expected ?? 0, testCaseId: v.testCaseId })),
    });
  }));
  async function latestChains(merchantId: string) {
    const all = await prisma.attackChain.findMany({ where: { assessment: { merchantId } }, orderBy: { createdAt: 'desc' } });
    return [...new Map(all.map((c) => [c.signature, c])).values()];
  }
  api.get('/financial', wrap(async (req, res) => {
    const m = await ownMerchant(req, String(req.query.merchantId));
    const vulns = await prisma.vulnerability.findMany({ where: { merchantId: m.id, status: { not: 'rejected' } } });
    const rows = vulns.map((v) => ({ id: v.id, testCaseId: v.testCaseId, title: v.title, category: v.category, severity: v.severity, status: v.status, open: v.status === 'verified' || v.status === 'reintroduced', exposure: v.exposure as any }));
    const byCategory: Record<string, { open: number; avoided: number }> = {};
    for (const r of rows) {
      const c = (byCategory[r.category] ||= { open: 0, avoided: 0 });
      const e = r.exposure?.exposure?.expected ?? 0;
      if (r.open) c.open += e; else c.avoided += e;
    }
    const assessments = await prisma.assessment.findMany({ where: { merchantId: m.id, status: 'completed' }, orderBy: { createdAt: 'asc' } });
    const trend = assessments.filter((a) => (a.summary as any)?.metrics).map((a) => ({ at: a.completedAt, assessmentId: a.id, mode: a.assessmentMode, exposure: (a.summary as any).metrics.expectedExposure, open: (a.summary as any).metrics.openVulnerabilities, posture: (a.summary as any).metrics.posture }));
    const chains = (await latestChains(m.id)).map((c) => ({ id: c.id, title: c.title, status: c.status, severity: c.severity, exposure: c.exposure as any, estimated: c.estimatedExposure }));
    res.json({ label: SIM_LABEL, assumptions: ASSUMPTIONS, formula: 'exposure = unique exploited orders x excess amount per simulated attack', rows, byCategory: Object.entries(byCategory).map(([category, v]) => ({ category, ...v })), trend, chains });
  }));
  api.get('/memory', wrap(async (req, res) => {
    const m = await ownMerchant(req, String(req.query.merchantId));
    const [memories, vulns, chains, defences] = await Promise.all([
      prisma.attackMemory.findMany({ where: { merchantId: m.id }, orderBy: { createdAt: 'desc' }, take: 100, include: { vulnerability: { select: { testCaseId: true, title: true } }, attackChain: { select: { title: true, signature: true } } } }),
      prisma.vulnerability.findMany({ where: { merchantId: m.id } }),
      latestChains(m.id),
      prisma.defence.findMany({ where: { vulnerability: { merchantId: m.id } }, include: { tests: true, vulnerability: { select: { testCaseId: true, title: true } } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const assessments = await prisma.assessment.findMany({ where: { merchantId: m.id, status: 'completed' }, orderBy: { createdAt: 'desc' }, take: 10 });
    res.json({ memories, vulnerabilities: vulns, chains, defences, history: assessments.map((a) => ({ id: a.id, mode: a.assessmentMode, at: a.completedAt, classification: (a.summary as any)?.classification, metrics: (a.summary as any)?.metrics, isDemoData: a.isDemoData })) });
  }));

  // ------------------------------------------------------------------ PayPal
  const resolveMerchant = async (req: Authed) => {
    const id = String(req.body?.merchantId || req.query.merchantId || '');
    if (id) return ownMerchant(req, id);
    const m = await prisma.merchant.findFirst({ where: { ownerId: req.user.id }, orderBy: { createdAt: 'asc' } });
    if (!m) throw httpErr(404, 'No merchant');
    return m;
  };
  api.get('/paypal/status', wrap(async (_req, res) => res.json(await paypal.status())));
  api.post('/paypal/orders', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => {
    const b = parse(z.object({ amount: z.number().positive().max(1000), currency: z.literal('USD').default('USD'), description: z.string().max(120).optional() }), req.body);
    const m = await resolveMerchant(req);
    res.status(201).json(await idempotent(req, 'order', () => paypal.createOrder(m.id, b.amount, b.currency, b.description)));
  }));
  const ownTx = async (req: Authed, id: string, by: 'order' | 'capture' = 'order') => {
    const tx = await prisma.sandboxTransaction.findFirst({ where: by === 'order' ? { paypalOrderId: id } : { captureId: id } });
    if (!tx) throw httpErr(404, 'Transaction not found');
    await ownMerchant(req, tx.merchantId);
    return tx;
  };
  api.get('/paypal/orders/:id', wrap(async (req, res) => { await ownTx(req, req.params.id); res.json(await paypal.getOrder(req.params.id)); }));
  api.post('/paypal/orders/:id/approve-simulated', requireRole('admin', 'analyst'), wrap(async (req, res) => { await ownTx(req, req.params.id); res.json(await paypal.simulateApproval(req.params.id)); }));
  api.post('/paypal/orders/:id/capture', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => { await ownTx(req, req.params.id); res.json(await idempotent(req, 'capture:' + req.params.id, () => paypal.captureOrder(req.params.id))); }));
  api.post('/paypal/captures/:id/refund', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => {
    await ownTx(req, req.params.id, 'capture');
    const b = parse(z.object({ amount: z.number().positive().max(1000).optional() }), req.body ?? {});
    res.json(await idempotent(req, 'refund:' + req.params.id, () => paypal.refundCapture(req.params.id, b.amount)));
  }));
  api.get('/paypal/transactions', wrap(async (req, res) => {
    const p = page(req);
    const where = { merchantId: { in: await ownedIds(req) } };
    const [items, total] = await Promise.all([prisma.sandboxTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, take: p.take, skip: p.skip }), prisma.sandboxTransaction.count({ where })]);
    res.json({ items, total, page: p.page, limit: p.limit });
  }));
  api.get('/paypal/webhook-events', wrap(async (_req, res) => res.json(await prisma.webhookEvent.findMany({ orderBy: { receivedAt: 'desc' }, take: 50 }))));
  api.post('/paypal/webhooks/simulate', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => {
    const b = parse(z.object({ eventType: z.enum(['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED']), orderId: z.string().max(80), eventId: z.string().max(80).optional(), forged: z.boolean().optional() }), req.body);
    const tx = await ownTx(req, b.orderId);
    const isCapture = b.eventType.startsWith('PAYMENT.CAPTURE');
    const event = { id: b.eventId || 'WH-SIM-' + crypto.randomBytes(5).toString('hex'), event_type: b.eventType, sellershield_simulation: true, resource: isCapture ? { id: tx.captureId || 'SIMCAP-UNKNOWN', supplementary_data: { related_ids: { order_id: tx.paypalOrderId } } } : { id: tx.paypalOrderId } };
    const raw = JSON.stringify(event);
    const sig = b.forged ? 'f'.repeat(64) : paypal.signSimulated(raw);
    const out = await paypal.processWebhook({ 'x-sellershield-sim-signature': sig }, raw);
    res.json({ label: 'LOCAL SIMULATION of a PayPal webhook (HMAC-signed locally; not sent by PayPal)', forged: !!b.forged, eventId: event.id, httpStatus: out.code, ...out.body });
  }));

  // ----------------------------------------------------------------- reports
  api.post('/reports', strict, wrap(async (req, res) => {
    const b = parse(z.object({ merchantId: z.string() }), req.body);
    const m = await ownMerchant(req, b.merchantId);
    const content = await buildReport(m.id);
    const r = await prisma.report.create({ data: { merchantId: m.id, title: `Security Assessment - ${m.name}`, content: content as any } });
    await audit(req.user.id, m.id, 'report.generated', 'Report', r.id);
    res.status(201).json({ id: r.id, title: r.title, createdAt: r.createdAt });
  }));
  api.get('/reports', wrap(async (req, res) => res.json(await prisma.report.findMany({ where: { merchantId: { in: await ownedIds(req) } }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, createdAt: true, merchantId: true } }))));
  const ownReport = async (req: Authed) => {
    const r = await prisma.report.findUnique({ where: { id: req.params.id } });
    if (!r) throw httpErr(404, 'Report not found');
    await ownMerchant(req, r.merchantId);
    return r;
  };
  api.get('/reports/:id', wrap(async (req, res) => { const r = await ownReport(req); res.json({ id: r.id, title: r.title, createdAt: r.createdAt, content: r.content }); }));
  api.get('/reports/:id/download', wrap(async (req, res) => {
    const r = await ownReport(req);
    if (req.query.format === 'pdf') { res.type('application/pdf').attachment(`sellershield-report-${r.id}.pdf`); return streamReportPdf(r.content as any, res); }
    res.type('application/json').attachment(`sellershield-report-${r.id}.json`).send(JSON.stringify(r.content, null, 2));
  }));

  // ---------------------------------------------------------- PayPal red team
  api.get('/redteam/config', (_req, res) => res.json({
    sandboxConfigured: paypal.ppMode() === 'sandbox',
    emulatorEnabled: process.env.NODE_ENV !== 'production' || process.env.ENABLE_PAYPAL_EMULATOR === 'true',
    notes: ['sandbox = real PayPal Sandbox calls (needs credentials; a human buyer must approve the order)', 'emulator = local emulator of documented PayPal behaviours, NOT PayPal'],
  }));
  api.post('/redteam/run', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => {
    const b = parse(z.object({ merchantId: z.string(), target: z.enum(['sandbox', 'emulator']) }), req.body);
    const m = await ownMerchant(req, b.merchantId);
    try { targetConfig(b.target); } catch (e: any) { throw httpErr(e.status || 422, e.message); }
    const eff = effectiveFixes(await getState(m.id));
    await audit(req.user.id, m.id, 'redteam.run', 'RedTeamRun', undefined, { target: b.target });
    try { res.status(201).json(await startRedTeam(m.id, b.target, eff)); } catch (e: any) { throw httpErr(e.status || 502, 'Red-team run failed: ' + e.message); }
  }));
  api.post('/redteam/:id/continue', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => {
    const r = await prisma.redTeamRun.findUnique({ where: { id: req.params.id } });
    if (!r) throw httpErr(404, 'Run not found');
    await ownMerchant(req, r.merchantId);
    try { res.json(await continueRedTeam(r.id, effectiveFixes(await getState(r.merchantId)))); } catch (e: any) { throw httpErr(e.status || 502, e.message); }
  }));
  api.get('/redteam', wrap(async (req, res) => {
    const m = await ownMerchant(req, String(req.query.merchantId));
    res.json(await prisma.redTeamRun.findMany({ where: { merchantId: m.id }, orderBy: { createdAt: 'desc' }, take: 10 }));
  }));
  api.get('/redteam/:id', wrap(async (req, res) => {
    const r = await prisma.redTeamRun.findUnique({ where: { id: req.params.id } });
    if (!r) throw httpErr(404, 'Run not found');
    await ownMerchant(req, r.merchantId);
    res.json(r);
  }));

  // -------------------------------------------------------- Attack Discovery Lab
  const llmReady = () => llmProviders().length > 0;
  api.get('/discovery/config', (_req, res) => res.json({ llmConfigured: llmReady(), providers: llmProviders().map((p) => ({ name: p.name, model: p.model })), engines: { search: 'deterministic guided search (no AI)', llm: 'LLM tool-use attacker with provider failover (GEMINI_API_KEY and/or GROQ_API_KEY)' } }));
  api.post('/discovery/run', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => {
    const b = parse(z.object({ merchantId: z.string(), engine: z.enum(['search', 'llm']), attempts: z.number().int().min(1).max(3).optional() }), req.body);
    const m = await ownMerchant(req, b.merchantId);
    if (!m.isDemo) throw httpErr(422, 'Discovery runs against the controlled sample application only');
    if (b.engine === 'llm' && !llmReady()) throw httpErr(422, 'LLM engine needs a key: GROQ_API_KEY (or GEMINI_API_KEY with GEMINI_ENABLED=true). Use the deterministic search engine, or configure a key.');
    const fixes = effectiveFixes(await getState(m.id));
    const run = await prisma.discoveryRun.create({ data: { merchantId: m.id, engine: b.engine, status: 'running', findings: [], trace: [], stats: { appliedFixes: [...fixes] } } });
    await audit(req.user.id, m.id, 'discovery.run', 'DiscoveryRun', run.id, { engine: b.engine });
    void (async () => {
      const trace: TraceEvent[] = [];
      const now = () => new Date().toISOString();
      let chain: Promise<unknown> = Promise.resolve(); // serialise trace writes so an old snapshot can never overwrite a newer one
      const flush = () => (chain = chain.then(() => prisma.discoveryRun.update({ where: { id: run.id }, data: { trace: [...trace] as any } }).catch(() => null)));
      try {
        if (b.engine === 'search') {
          trace.push({ at: now(), kind: 'info', text: 'Exhaustive search over action sequences (up to 5 actions) against the vulnerable shop, each replayed on a secure baseline. No AI involved.' });
          await flush();
          const r = guidedSearch(fixes, { onProgress: (t) => { trace.push({ at: now(), kind: 'info', text: t }); } });
          trace.push({ at: now(), kind: 'info', text: `Evaluated ${r.evaluated.toLocaleString()} sequences in ${r.ms} ms; ${r.distinctPatterns} distinct verified loss patterns.` });
          await prisma.discoveryRun.update({ where: { id: run.id }, data: { status: 'completed', completedAt: new Date(), trace: trace as any, findings: r.findings as any, stats: { appliedFixes: [...fixes], evaluated: r.evaluated, ms: r.ms, distinctPatterns: r.distinctPatterns } as any } });
        } else {
          const r = await llmAttacker({ fixes, attempts: b.attempts ?? 2, onTrace: (e) => { trace.push(e); void flush(); } });
          await chain;
          await prisma.discoveryRun.update({ where: { id: run.id }, data: { status: 'completed', completedAt: new Date(), trace: trace as any, findings: r.findings as any, stats: { appliedFixes: [...fixes], turns: r.turns, rejected: r.rejected, providersUsed: r.providersUsed, failovers: r.failovers } as any } });
        }
      } catch (e: any) {
        trace.push({ at: now(), kind: 'info', text: 'Run failed: ' + String(e.message).slice(0, 300) });
        await prisma.discoveryRun.update({ where: { id: run.id }, data: { status: 'failed', completedAt: new Date(), trace: trace as any } }).catch(() => null);
      }
    })();
    res.status(202).json({ id: run.id });
  }));
  api.get('/discovery', wrap(async (req, res) => {
    const m = await ownMerchant(req, String(req.query.merchantId));
    res.json(await prisma.discoveryRun.findMany({ where: { merchantId: m.id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, engine: true, status: true, createdAt: true, stats: true } }));
  }));
  api.get('/discovery/:id', wrap(async (req, res) => {
    const r = await prisma.discoveryRun.findUnique({ where: { id: req.params.id } });
    if (!r) throw httpErr(404, 'Run not found');
    await ownMerchant(req, r.merchantId);
    res.json(r);
  }));

  // ------------------------------------------------------ Defence as pull request
  const prInput = async (req: Authed) => {
    const d = await ownDefence(req, req.params.id);
    if (d.status !== 'verified') throw httpErr(409, 'A pull request can only be opened for a defence whose regression tests passed (status verified)');
    if (!d.approvedAt) throw httpErr(409, 'Human approval is required before a pull request can be opened');
    const m = await prisma.merchant.findUnique({ where: { id: d.vulnerability.merchantId } });
    const approver = d.approvedBy ? (await prisma.user.findUnique({ where: { id: d.approvedBy } }))?.name ?? 'an authorised reviewer' : 'an authorised reviewer';
    return buildPrPackage({ defence: d, vulnerability: d.vulnerability, tests: d.tests, approver, merchantName: m?.name ?? '' }, env.githubRepo || 'owner/repo', env.githubBase);
  };
  api.get('/defences/:id/pull-request/preview', wrap(async (req, res) => {
    const pkg = await prInput(req);
    res.json({ configured: githubConfigured(), repo: pkg.repo, base: pkg.base, branch: pkg.branch, title: pkg.title, body: pkg.body, files: pkg.files.map((f) => ({ path: f.path, bytes: f.content.length, content: f.content })), existing: await prisma.defence.findUnique({ where: { id: req.params.id }, select: { prUrl: true, prNumber: true } }) });
  }));
  api.post('/defences/:id/pull-request', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => {
    if (req.body?.confirm !== true) throw httpErr(400, 'Explicit confirmation required: send {"confirm": true} after reviewing the preview');
    if (!githubConfigured()) throw httpErr(422, 'GitHub is not configured (set GITHUB_TOKEN and GITHUB_REPO). Use the preview to see exactly what would be opened.');
    const d = await ownDefence(req, req.params.id);
    if (d.prUrl) throw httpErr(409, 'A pull request already exists for this defence: ' + d.prUrl);
    const pkg = await prInput(req);
    const pr = await openPullRequest(pkg);
    await prisma.defence.update({ where: { id: d.id }, data: { prUrl: pr.url, prNumber: pr.number, prBranch: pr.branch } });
    const verification = await verifyPullRequest(pkg, pr.number).catch((e: any) => ({ ok: false, error: e.message }));
    await audit(req.user.id, d.vulnerability.merchantId, 'defence.pull_request', 'Defence', d.id, { repo: pkg.repo, number: pr.number });
    res.status(201).json({ ...pr, verification });
  }));
  api.get('/github/status', wrap(async (_req, res) => res.json(await githubPreflight())));

  // -------------------------------------------------------------------- demo
  api.post('/demo/seed', wrap(async (req, res) => { const m = await ensureDemoMerchant(req.user.id); res.json({ merchantId: m.id }); }));
  api.post('/demo/reset', wrap(async (req, res) => {
    const m = await resetDemoMerchant(req.user.id);
    await audit(req.user.id, m.id, 'demo.reset', 'Merchant', m.id);
    res.json({ merchantId: m.id });
  }));
  api.post('/demo/run', strict, requireRole('admin', 'analyst'), wrap(async (req, res) => {
    const m = await resetDemoMerchant(req.user.id, { seed: false });
    const a = await createAssessment(m.id, 'demo', false);
    await audit(req.user.id, m.id, 'demo.run', 'Assessment', a.id);
    void startAssessment(a.id);
    res.status(202).json({ merchantId: m.id, assessmentId: a.id });
  }));

  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_PAYPAL_EMULATOR === 'true') {
    app.use('/mock-paypal', createPayPalEmulator(() => (process.env.SELF_URL || `http://127.0.0.1:${env.port}`) + '/mock-paypal'));
    // second mount whose URL contains "sandbox" lets tests exercise the real-Sandbox code path (approval pause + continue) against the emulator
    app.use('/mock-paypal-sandbox', createPayPalEmulator(() => (process.env.SELF_URL || `http://127.0.0.1:${env.port}`) + '/mock-paypal-sandbox'));
  }
  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(httpErr(404, 'Not found')));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File exceeds the 1 MB limit' });
    if (err?.name === 'MulterError') return res.status(400).json({ error: err.message });
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message, ...(err?.paypal ? { paypal: err.paypal } : {}) });
  });
  return app;
}

function agentView(r: any, full = false) {
  return {
    id: r.id, agentType: r.agentType, status: r.status, task: r.task, progress: { done: r.progressDone, total: r.progressTotal },
    findings: (r.output as any)?.findings?.length ?? (r.output as any)?.defences?.length ?? null,
    startedAt: r.startedAt, completedAt: r.completedAt, history: r.log ?? [], ...(full ? { output: r.output } : { output: summarizeOutput(r.output) }),
  };
}
function summarizeOutput(o: any) {
  if (!o) return null;
  if (o.findings) return { mode: o.mode, findings: o.findings.map((f: any) => ({ testCaseId: f.testCaseId, title: f.title, severity: f.severity, leakage: f.leakage })), cleared: o.cleared, rejectedHypotheses: o.rejectedHypotheses };
  if (o.defences) return { defences: o.defences };
  if (o.verdicts) return { rejected: o.rejected, rejectedHypotheses: o.rejectedHypotheses, verdicts: Object.fromEntries(Object.entries(o.verdicts).map(([k, v]: any) => [k, { verdict: v.verdict, note: v.note, checks: v.checks }])) };
  return null;
}
