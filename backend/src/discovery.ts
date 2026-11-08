import { z } from 'zod';
import { Shop, FixId, ALL_FIXES, CATALOG, auditLedger, round2 } from './simulator/shop';
import { SCENARIOS } from './simulator/scenarios';
import { runChain } from './simulator/chains';
import { LlmProvider, llmProviders } from './config';
import { redact } from './redact';

/**
 * Attack Discovery Lab.
 * An attacker (LLM tool-use agent OR deterministic guided search) proposes a SEQUENCE OF ACTIONS against the
 * simulated NovaCart shop. Nothing the attacker says is trusted: deterministic code replays the actions on the
 * vulnerable shop and on a fully-secure baseline, measures the money difference, checks ledger invariants and
 * replays twice for determinism. Only then is it a verified finding.
 */

const SKUS = Object.keys(CATALOG) as [string, ...string[]];
const ROLES = ['admin', 'manager', 'support', 'intern'] as const;
const Id = z.string().regex(/^(o\d{1,2}|ORD-\d{4})$/);

export const ActionSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('create_order'), lines: z.array(z.object({ sku: z.enum(SKUS), qty: z.number().int().min(-5).max(10) })).min(1).max(3), coupons: z.array(z.string().max(20)).max(3).optional(), idemKey: z.string().max(40).optional() }),
  z.object({ tool: z.literal('payment_event'), order: Id, event: z.enum(['PENDING', 'COMPLETED', 'DENIED']), eventId: z.string().max(40).optional() }),
  z.object({ tool: z.literal('fulfill'), order: Id }),
  z.object({ tool: z.literal('refund'), order: Id, sku: z.string().max(20), qty: z.number().int().min(1).max(10), actor: z.enum(ROLES), idemKey: z.string().max(40).optional(), approvedBy: z.string().max(20).optional() }),
  z.object({ tool: z.literal('cancel'), order: Id, actor: z.enum(ROLES).optional() }),
  z.object({ tool: z.literal('update_coupon'), actor: z.enum(ROLES), code: z.string().max(20), value: z.number().min(0).max(100) }),
  z.object({ tool: z.literal('concurrent_checkout'), sku: z.enum(SKUS), buyers: z.number().int().min(2).max(8) }),
]);
export type Action = z.infer<typeof ActionSchema>;
export const MAX_ACTIONS = 12;

const position = (s: Shop) => {
  const unsettled = [...s.orders.values()].filter((o) => o.fulfilled).reduce((a, o) => a + Math.max(0, o.total - o.settled), 0);
  const oversold = Object.entries(s.stock).reduce((a, [sku, n]) => a + (n < 0 ? -n * CATALOG[sku].price : 0), 0);
  return round2(s.cashIn - s.cashOut - unsettled - oversold);
};

/** Execute one action on a shop. `refs` maps o1,o2,... to real order ids in creation order. */
export function execute(shop: Shop, a: Action, refs: string[]): { ok: boolean; info: Record<string, unknown> } {
  const ord = (id: string) => (/^o\d+$/.test(id) ? refs[Number(id.slice(1)) - 1] : id) ?? '__missing__';
  switch (a.tool) {
    case 'create_order': {
      const r = shop.createOrder(a.lines, a.coupons ?? [], a.idemKey);
      if (!r.ok) return { ok: false, info: { error: r.error } };
      if (!refs.includes(r.order.id)) refs.push(r.order.id);
      return { ok: true, info: { order: `o${refs.indexOf(r.order.id) + 1}`, id: r.order.id, subtotal: r.order.subtotal, total: r.order.total, couponsApplied: r.order.coupons, rejectedCoupons: r.rejectedCoupons } };
    }
    case 'payment_event': { const r = shop.applyPayment(ord(a.order), a.event, a.eventId); return r.ok ? { ok: true, info: { status: r.status } } : { ok: false, info: { error: r.error } }; }
    case 'fulfill': { const r = shop.fulfill(ord(a.order)); return r.ok ? { ok: true, info: { fulfilled: true } } : { ok: false, info: { error: r.error } }; }
    case 'refund': {
      const id = ord(a.order);
      const sku = a.sku === '$first' ? shop.orders.get(id)?.lines[0]?.sku ?? a.sku : a.sku;
      const r = shop.refund(id, sku, a.qty, a.actor, a.idemKey, a.approvedBy);
      return r.ok ? { ok: true, info: { refunded: r.refund.amount, replay: 'replay' in r && !!r.replay } } : { ok: false, info: { error: r.error } };
    }
    case 'cancel': { const r = shop.cancel(ord(a.order), a.actor ?? 'support'); return r.ok ? { ok: true, info: { refundedOnCancel: r.refunded } } : { ok: false, info: { error: r.error } }; }
    case 'update_coupon': { const r = shop.updateCouponRule(a.actor, a.code, { value: a.value }); return r.ok ? { ok: true, info: { updated: true } } : { ok: false, info: { error: r.error } }; }
    case 'concurrent_checkout': {
      const r = shop.createOrdersConcurrently(Array.from({ length: a.buyers }, () => ({ sku: a.sku, qty: 1 })));
      for (const o of r.orders) refs.push(o.id);
      return { ok: true, info: { accepted: r.accepted, stockAfter: shop.stock[a.sku] } };
    }
  }
}

export interface Evaluation { leakage: number; violations: string[]; kinds: string[]; steps: { action: Action; ok: boolean; info: Record<string, unknown> }[]; vulnPosition: number; securePosition: number }

/**
 * Procedural normalisation before replay: a refund without an idempotency key is given a unique one.
 * Otherwise the strict secure baseline would reject the refund for a missing key, inflating the measured loss.
 * (Approval and role rules are NOT normalised: bypassing them is a real policy violation.)
 */
export function normalizeActions(actions: Action[]): Action[] {
  return actions.map((a, i) => (a.tool === 'refund' && !a.idemKey ? { ...a, idemKey: `auto-${i + 1}` } : a));
}

export function evaluate(rawActions: Action[], fixes: Set<FixId>): Evaluation {
  const actions = normalizeActions(rawActions);
  const vuln = new Shop(fixes);
  const sec = new Shop(new Set(ALL_FIXES));
  const rv: string[] = [], rs: string[] = [];
  const steps: Evaluation['steps'] = [];
  for (const a of actions) {
    const x = execute(vuln, a, rv);
    steps.push({ action: a, ok: x.ok, info: x.info });
    execute(sec, a, rs);
  }
  const violations = auditLedger(vuln);
  const kinds = [...new Set(violations.map((v) => v.split(':')[0]))].sort();
  const vp = position(vuln), sp = position(sec);
  return { leakage: round2(Math.max(0, sp - vp)), violations, kinds, steps, vulnPosition: vp, securePosition: sp };
}

// ---------------------------------------------------------------- knowledge of the scripted library
let libraryKinds: { scenarios: string[][]; chains: string[][] } | null = null;
function knownKindSets() {
  if (libraryKinds) return libraryKinds;
  const kinds = (shop: Shop) => [...new Set(auditLedger(shop).map((v) => v.split(':')[0]))].sort();
  const none = new Set<FixId>();
  libraryKinds = {
    scenarios: SCENARIOS.map((s) => kinds(s.reproduce(none).shop)).filter((k) => k.length),
    chains: [['DISC-001', 'REFUND-001', 'REFUND-002'], ['PAY-001', 'ACL-001']].map((p) => kinds(runChain(p, none).shop)),
  };
  return libraryKinds;
}
export function classifyNovelty(rawKinds: string[]): 'known' | 'novel' {
  const strip = (a: string[]) => a.filter((x) => x !== 'missing-audit'); // audit-trail gaps accompany any staff refund; they do not make a mechanism new
  const kinds = strip(rawKinds);
  const k0 = knownKindSets();
  const k = { scenarios: k0.scenarios.map(strip), chains: k0.chains.map(strip) };
  const sub = (a: string[], b: string[]) => a.every((x) => b.includes(x));
  if (k.scenarios.some((s) => sub(kinds, s))) return 'known';
  if (k.chains.some((c) => JSON.stringify(c) === JSON.stringify(kinds))) return 'known';
  return 'novel';
}

/** Smallest set of fixes (size ≤ 2) that removes the leakage, i.e. the root cause(s). */
export function blockingFixes(actions: Action[]): FixId[][] {
  const singles = ALL_FIXES.filter((f) => evaluate(actions, new Set([f])).leakage <= 0.005);
  if (singles.length) return singles.map((f) => [f]);
  const pairs: FixId[][] = [];
  for (let i = 0; i < ALL_FIXES.length; i++) for (let j = i + 1; j < ALL_FIXES.length; j++) if (evaluate(actions, new Set([ALL_FIXES[i], ALL_FIXES[j]])).leakage <= 0.005) pairs.push([ALL_FIXES[i], ALL_FIXES[j]]);
  return pairs;
}

export interface DiscoveryFinding {
  title: string; engine: 'llm' | 'search'; rationale?: string;
  sequence: Action[]; steps: Evaluation['steps']; leakage: number; violations: string[]; kinds: string[];
  novelty: 'known' | 'novel'; blockedBy: FixId[][]; verified: boolean; verification: { checks: { name: string; ok: boolean; detail: string }[] };
}

/** Deterministic verification of an attacker-proposed sequence. The attacker's own claims are never used. */
export function verifySequence(actions: Action[], fixes: Set<FixId>, meta: { title: string; engine: 'llm' | 'search'; rationale?: string }): DiscoveryFinding {
  const e1 = evaluate(actions, fixes);
  const e2 = evaluate(actions, fixes);
  const checks = [
    { name: 'Sequence is valid (≤12 actions, schema-checked)', ok: actions.length > 0 && actions.length <= MAX_ACTIONS, detail: `${actions.length} actions` },
    { name: 'At least one action succeeded', ok: e1.steps.some((s) => s.ok), detail: `${e1.steps.filter((s) => s.ok).length} succeeded` },
    { name: 'Replay on vulnerable shop loses more money than secure baseline', ok: e1.leakage > 0.005, detail: `secure position $${e1.securePosition} vs vulnerable $${e1.vulnPosition} → excess $${e1.leakage}` },
    { name: 'Ledger invariant violated', ok: e1.violations.length > 0, detail: e1.violations.slice(0, 3).join(' | ') || 'none' },
    { name: 'Deterministic (second replay identical)', ok: e1.leakage === e2.leakage && JSON.stringify(e1.violations) === JSON.stringify(e2.violations), detail: `replay excess $${e2.leakage}` },
  ];
  const verified = checks.every((c) => c.ok);
  return {
    title: meta.title, engine: meta.engine, rationale: meta.rationale, sequence: actions, steps: e1.steps, leakage: e1.leakage, violations: e1.violations, kinds: e1.kinds,
    novelty: verified ? classifyNovelty(e1.kinds) : 'known', blockedBy: verified ? blockingFixes(actions) : [], verified, verification: { checks },
  };
}

// ------------------------------------------------------------------------- guided search (no LLM)
const U = 'NC-USB';
const CREATES: Action[] = [
  { tool: 'create_order', lines: [{ sku: U, qty: 4 }], coupons: ['SAVE20', 'VIP15', 'WELCOME10'] },
  { tool: 'create_order', lines: [{ sku: U, qty: 4 }], coupons: ['SAVE20'] },
  { tool: 'create_order', lines: [{ sku: 'NC-CHG', qty: 2 }] },
  { tool: 'create_order', lines: [{ sku: 'NC-HEADSET', qty: 1 }] },
  { tool: 'concurrent_checkout', sku: 'NC-HEADSET', buyers: 6 },
];
const FOLLOWS: Action[] = [
  { tool: 'payment_event', order: 'o1', event: 'PENDING', eventId: 'e1' }, { tool: 'payment_event', order: 'o1', event: 'COMPLETED', eventId: 'e2' }, { tool: 'payment_event', order: 'o1', event: 'DENIED', eventId: 'e3' },
  { tool: 'fulfill', order: 'o1' }, { tool: 'cancel', order: 'o1' },
  ...(['manager', 'intern'] as const).flatMap((actor) => [1, 2].flatMap((qty) => ['kA', 'kB'].map((k): Action => ({ tool: 'refund', order: 'o1', sku: '$first', qty, actor, idemKey: k, approvedBy: 'admin' })))),
];

export function guidedSearch(fixes: Set<FixId>, opts: { maxDepth?: number; maxMs?: number; onProgress?: (msg: string) => void } = {}): { findings: DiscoveryFinding[]; evaluated: number; ms: number; distinctPatterns: number } {
  const { maxDepth = 5, maxMs = 25000 } = opts;
  const t0 = Date.now();
  let evaluated = 0;
  const best = new Map<string, { seq: Action[]; leak: number }>(); // shortest sequence per violation-kind signature
  const consider = (seq: Action[]) => {
    evaluated++;
    const e = evaluate(seq, fixes);
    if (e.leakage <= 0.005 || !e.violations.length) return;
    const sig = e.kinds.join('+');
    const cur = best.get(sig);
    if (!cur || seq.length < cur.seq.length || (seq.length === cur.seq.length && e.leakage > cur.leak)) best.set(sig, { seq: [...seq], leak: e.leakage });
  };
  const rec = (seq: Action[], depth: number) => {
    if (Date.now() - t0 > maxMs) return;
    consider(seq);
    if (depth >= maxDepth) return;
    for (const f of FOLLOWS) rec([...seq, f], depth + 1);
  };
  for (const c of CREATES) { rec([c], 1); opts.onProgress?.(`explored sequences starting with ${c.tool}; ${evaluated} evaluated, ${best.size} distinct loss patterns`); }
  const all = [...best.entries()].map(([sig, { seq }]) => verifySequence(seq, fixes, { title: titleFor(sig.split('+')), engine: 'search', rationale: `Shortest ${seq.length}-action sequence found by exhaustive search that produces: ${sig.replace(/\+/g, ', ')}` })).filter((f) => f.verified);
  // Present the simplest novel patterns first (fewest violated rules, then largest loss); cap noise.
  const novel = all.filter((f) => f.novelty === 'novel').sort((a, b) => a.kinds.length - b.kinds.length || b.leakage - a.leakage).slice(0, 8);
  const known = all.filter((f) => f.novelty === 'known').sort((a, b) => b.leakage - a.leakage).slice(0, 9);
  const findings = [...novel, ...known];
  opts.onProgress?.(`${all.length} distinct verified loss patterns; showing ${novel.length} novel + ${known.length} known`);
  return { findings, evaluated, ms: Date.now() - t0, distinctPatterns: all.length };
}

const KIND_LABEL: Record<string, string> = {
  'refund-without-settlement': 'Refund of unsettled payment', oversold: 'Oversold stock', 'discount-policy': 'Coupon stacking', 'duplicate-refund': 'Replayed refund',
  'refund-allocation': 'List-price refund', 'unauthorized-refund': 'Unauthorised refund', 'unsettled-fulfilment': 'Shipped before payment settled', 'missing-audit': 'No audit trail',
  'over-refund': 'Refund above order total', 'refund-quantity': 'Refund beyond purchased quantity',
};
function titleFor(kinds: string[]): string {
  if (kinds.length === 1 && kinds[0] === 'refund-without-settlement') return 'Cancel-for-Cash: refund of a payment that never settled';
  const main = kinds.filter((k) => k !== 'missing-audit');
  return (main.length ? main : kinds).map((k) => KIND_LABEL[k] ?? k).join(' + ');
}

// ------------------------------------------------------------------------- LLM tool-use attacker
const TOOL_DEFS = [
  { name: 'create_order', description: 'Create a shop order. Returns an alias (o1, o2, ...) for later calls.', input_schema: { type: 'object', properties: { lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string', enum: SKUS }, qty: { type: 'integer' } }, required: ['sku', 'qty'] } }, coupons: { type: 'array', items: { type: 'string' } }, idemKey: { type: 'string' } }, required: ['lines'] } },
  { name: 'payment_event', description: 'Deliver a payment event for an order (PENDING, COMPLETED, DENIED).', input_schema: { type: 'object', properties: { order: { type: 'string' }, event: { type: 'string', enum: ['PENDING', 'COMPLETED', 'DENIED'] }, eventId: { type: 'string' } }, required: ['order', 'event'] } },
  { name: 'fulfill', description: 'Ship an order.', input_schema: { type: 'object', properties: { order: { type: 'string' } }, required: ['order'] } },
  { name: 'refund', description: 'Refund qty units of a SKU (use "$first" for the first line) as a staff actor.', input_schema: { type: 'object', properties: { order: { type: 'string' }, sku: { type: 'string' }, qty: { type: 'integer' }, actor: { type: 'string', enum: [...ROLES] }, idemKey: { type: 'string' }, approvedBy: { type: 'string' } }, required: ['order', 'sku', 'qty', 'actor'] } },
  { name: 'cancel', description: 'Cancel an order (auto-refunds if paid).', input_schema: { type: 'object', properties: { order: { type: 'string' }, actor: { type: 'string', enum: [...ROLES] } }, required: ['order'] } },
  { name: 'update_coupon', description: 'Edit a coupon rule value.', input_schema: { type: 'object', properties: { actor: { type: 'string', enum: [...ROLES] }, code: { type: 'string' }, value: { type: 'number' } }, required: ['actor', 'code', 'value'] } },
  { name: 'concurrent_checkout', description: 'N simultaneous single-unit purchases of a SKU.', input_schema: { type: 'object', properties: { sku: { type: 'string', enum: SKUS }, buyers: { type: 'integer' } }, required: ['sku', 'buyers'] } },
  { name: 'report_attack', description: 'Finish: give the attack a short title and rationale. The platform will independently replay and verify your actions.', input_schema: { type: 'object', properties: { title: { type: 'string' }, rationale: { type: 'string' } }, required: ['title'] } },
];

const SYSTEM = `You are a red-team agent inside SellerShield AI, testing an ISOLATED SIMULATION of the NovaCart Electronics shop (no real systems, money or customers).
Catalogue: NC-USB $50, NC-CHG $30, NC-CASE $20, NC-HEADSET $120 (stock 3). Coupons: SAVE20 (20%), VIP15 (15%), WELCOME10 ($10), EXPIRED5. Policy: one coupon per order; refunds only by admin/manager and above $100 need approval; goods ship only after a COMPLETED payment; refunds must never exceed what was paid or settled; stock must not go negative.
Goal: find a short sequence of tool calls that makes the merchant lose money in a way that violates these rules. Be creative: combine weaknesses. Tools return what the shop did. When you have a sequence, call report_attack. Do not stop after trivial single steps; do not claim success without evidence from tool results. Your claims are independently replayed and verified by deterministic code.`;

export interface CallInfo { provider: string; model: string; latencyMs: number; status: number | 'error'; usage?: { prompt: number; completion: number; total: number }; error?: string }
export interface LlmOptions { sleep?: (ms: number) => Promise<void>; maxRateLimitRetries?: number; maxRateLimitWaitMs?: number; fixes: Set<FixId>; attempts?: number; maxTurns?: number; onTrace?: (e: TraceEvent) => void; onCall?: (c: CallInfo) => void; fetchImpl?: typeof fetch; providers?: LlmProvider[]; timeoutMs?: number }
export interface TraceEvent { at: string; kind: 'assistant' | 'tool_call' | 'tool_result' | 'verdict' | 'info'; text: string }

/** A provider failure (bad key, rate limit, outage, timeout). The caller fails over to the next provider. */
export class ProviderError extends Error { constructor(public provider: string, msg: string, public status?: number, public retryAfterMs?: number) { super(msg); } }

type Report = { title: string; rationale?: string };
interface Episode { shop: Shop; refs: string[]; taken: Action[]; report: Report | null }
interface Ctx { f: typeof fetch; timeoutMs: number; onCall?: (c: CallInfo) => void; trace: (k: TraceEvent['kind'], t: string) => void; sleep: (ms: number) => Promise<void>; maxRateLimitRetries: number; maxRateLimitWaitMs: number }

/** Execute one model tool call deterministically. */
function runTool(ep: Episode, name: string, input: any, trace: Ctx['trace']): { content: string; isError: boolean } {
  trace('tool_call', `${name} ${JSON.stringify(input ?? {})}`);
  if (name === 'report_attack') {
    ep.report = { title: String(input?.title ?? 'Untitled attack').slice(0, 120), rationale: String(input?.rationale ?? '').slice(0, 500) };
    return { content: 'Report received. Independent verification follows.', isError: false };
  }
  const parsed = ActionSchema.safeParse({ tool: name, ...(input ?? {}) });
  if (!parsed.success) {
    const msg = 'Invalid tool input: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    trace('tool_result', msg);
    return { content: msg, isError: true };
  }
  if (ep.taken.length >= MAX_ACTIONS) return { content: 'Action budget exhausted. Call report_attack.', isError: true };
  const x = execute(ep.shop, parsed.data, ep.refs);
  ep.taken.push(parsed.data);
  const out = JSON.stringify({ ok: x.ok, ...x.info, cashIn: ep.shop.cashIn, cashOut: ep.shop.cashOut });
  trace('tool_result', out);
  return { content: out, isError: !x.ok };
}

/** One OpenAI-compatible HTTP call with timeout, latency and token-usage accounting. API keys are never logged. */
export async function chatCall(provider: LlmProvider, path: string, body: unknown, ctx: Pick<Ctx, 'f' | 'timeoutMs' | 'onCall'>) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ctx.timeoutMs);
  const t0 = Date.now();
  const info = (status: CallInfo['status'], extra: Partial<CallInfo> = {}) => ctx.onCall?.({ provider: provider.name, model: provider.model, latencyMs: Date.now() - t0, status, ...extra });
  try {
    const res = await ctx.f(provider.baseUrl.replace(/\/$/, '') + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.key}` }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) {
      const text = redact((await res.text().catch(() => '')).replaceAll(provider.key, '[key]')).slice(0, 160);
      const why = res.status === 401 || res.status === 403 ? ' (key rejected)' : res.status === 429 ? ' (rate limited)' : res.status === 404 ? ' (model or endpoint not found)' : res.status === 400 ? ' (bad request)' : '';
      info(res.status, { error: `HTTP ${res.status}${why}: ${text}` });
      let retryAfterMs: number | undefined;
      if (res.status === 429) {
        const h = Number(res.headers.get('retry-after'));
        const m = text.match(/try again in ([\d.]+)\s*(ms|s|m)\b/i);
        retryAfterMs = Number.isFinite(h) && h > 0 ? h * 1000 : m ? Number(m[1]) * (m[2] === 'ms' ? 1 : m[2] === 's' ? 1000 : 60000) : undefined;
      }
      throw new ProviderError(provider.name, `HTTP ${res.status}${why}`, res.status, retryAfterMs);
    }
    const json: any = await res.json();
    const u = json.usage;
    info(res.status, u ? { usage: { prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0, total: u.total_tokens ?? 0 } } : {});
    return json;
  } catch (e: any) {
    if (e instanceof ProviderError) throw e;
    const why = e?.name === 'AbortError' ? 'timeout' : redact(String(e?.message ?? e).replaceAll(provider.key, '[key]')).slice(0, 120);
    info('error', { error: why });
    throw new ProviderError(provider.name, why);
  } finally { clearTimeout(timer); }
}

/** chatCall with backoff for HTTP 429: honour retry-after, wait, retry on the SAME provider; only then fail over. */
async function callWithRetry(p: LlmProvider, path: string, body: unknown, ctx: Ctx) {
  for (let attempt = 0; ; attempt++) {
    try { return await chatCall(p, path, body, ctx); }
    catch (e) {
      if (!(e instanceof ProviderError) || e.status !== 429 || attempt >= ctx.maxRateLimitRetries) throw e;
      const wait = Math.min(e.retryAfterMs ?? 2000 * (attempt + 1), ctx.maxRateLimitWaitMs) + 300;
      if ((e.retryAfterMs ?? 0) > ctx.maxRateLimitWaitMs) throw e; // asked to wait too long: fail over instead
      ctx.trace('info', `${p.name} rate limited (429); waiting ${(wait / 1000).toFixed(1)}s then retrying (${attempt + 1}/${ctx.maxRateLimitRetries})`);
      await ctx.sleep(wait);
    }
  }
}

/** OpenAI-compatible chat completions with function calling (Gemini's OpenAI endpoint, Groq, ...). */
async function openaiEpisode(p: LlmProvider, ep: Episode, hint: string, maxTurns: number, ctx: Ctx): Promise<number> {
  const tools = TOOL_DEFS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const messages: any[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Begin. ${hint} You have at most ${MAX_ACTIONS} shop actions.` }];
  let turns = 0;
  for (let turn = 0; turn < maxTurns && !ep.report; turn++) {
    turns++;
    const json = await callWithRetry(p, '/chat/completions', { model: p.model, max_tokens: 1024, messages, tools, tool_choice: 'auto' }, ctx);
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new ProviderError(p.name, 'empty response');
    messages.push({ role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    if (msg.content) ctx.trace('assistant', String(msg.content));
    const calls: any[] = msg.tool_calls ?? [];
    if (!calls.length) break;
    for (const c of calls) {
      let input: any = {};
      try { input = c.function?.arguments ? JSON.parse(c.function.arguments) : {}; } catch { /* malformed arguments are reported back as invalid input */ }
      const r = runTool(ep, c.function?.name ?? '', input, ctx.trace);
      messages.push({ role: 'tool', tool_call_id: c.id, content: r.content });
    }
  }
  return turns;
}

export async function llmAttacker(opts: LlmOptions): Promise<{ findings: DiscoveryFinding[]; rejected: { title: string; reason: string }[]; turns: number; providersUsed: string[]; failovers: { provider: string; reason: string }[] }> {
  const { fixes, attempts = 2, maxTurns = 14, onTrace } = opts;
  const providers = opts.providers ?? llmProviders();
  const trace: Ctx['trace'] = (kind, text) => onTrace?.({ at: new Date().toISOString(), kind, text: redact(text).slice(0, 600) });
  const ctx: Ctx = { f: opts.fetchImpl ?? fetch, timeoutMs: opts.timeoutMs ?? 30000, onCall: opts.onCall, trace, sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), maxRateLimitRetries: opts.maxRateLimitRetries ?? 5, maxRateLimitWaitMs: opts.maxRateLimitWaitMs ?? 65000 };
  const findings: DiscoveryFinding[] = [];
  const rejected: { title: string; reason: string }[] = [];
  const failovers: { provider: string; reason: string }[] = [];
  const dead = new Set<string>(); // providers that failed in this run are skipped afterwards
  const used = new Set<string>();
  let turns = 0;
  const hints = ['Focus on payment-state and cancellation workflows.', 'Focus on refunds, idempotency keys and staff roles.', 'Focus on discounts and concurrent purchases.'];
  if (!providers.length) throw new Error('No LLM provider configured (set GEMINI_API_KEY and/or GROQ_API_KEY)');

  for (let attempt = 0; attempt < attempts; attempt++) {
    const hint = hints[attempt % hints.length];
    trace('info', `Attempt ${attempt + 1}: ${hint}`);
    let ep: Episode | null = null;
    for (const p of providers) {
      if (dead.has(p.name)) continue;
      const e: Episode = { shop: new Shop(fixes), refs: [], taken: [], report: null };
      try {
        trace('info', `Using provider ${p.name} (${p.model})`);
        turns += await openaiEpisode(p, e, hint, maxTurns, ctx);
        used.add(p.name);
        ep = e;
        break;
      } catch (err: any) {
        if (!(err instanceof ProviderError)) throw err;
        dead.add(p.name);
        failovers.push({ provider: p.name, reason: err.message });
        const next = providers.find((q) => !dead.has(q.name));
        trace('info', `Provider ${p.name} failed: ${err.message}. ${next ? `Failing over to ${next.name}.` : 'No providers left.'}`);
      }
    }
    if (!ep) { rejected.push({ title: `Attempt ${attempt + 1}`, reason: 'All LLM providers failed: ' + failovers.map((x) => `${x.provider} ${x.reason}`).join('; ') }); break; }
    if (!ep.taken.length) { rejected.push({ title: ep.report?.title ?? `Attempt ${attempt + 1}`, reason: 'No shop actions were taken' }); continue; }
    const finding = verifySequence(ep.taken, fixes, { title: ep.report?.title ?? `LLM attack (attempt ${attempt + 1})`, engine: 'llm', rationale: ep.report?.rationale });
    if (finding.verified) { findings.push(finding); trace('verdict', `VERIFIED: ${finding.title} - excess $${finding.leakage} (${finding.novelty})`); }
    else { rejected.push({ title: finding.title, reason: finding.verification.checks.filter((c) => !c.ok).map((c) => c.name).join('; ') }); trace('verdict', `REJECTED: ${finding.title} - ${rejected[rejected.length - 1].reason}`); }
  }
  return { findings, rejected, turns, providersUsed: [...used], failovers };
}
