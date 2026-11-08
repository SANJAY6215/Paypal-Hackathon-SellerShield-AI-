/**
 * LIVE validation of the Gemini → Groq LLM chain. Makes REAL API calls using keys from backend/.env.
 * Run: cd backend && npx tsx scripts/validate-llm.ts
 * Output: docs/llm-live-validation.json (+ prints a summary). API keys are never printed or written.
 * Everything recorded here is a live result unless explicitly labelled MOCK.
 */
import fs from 'node:fs';
import path from 'node:path';
import { llmProviders, LlmProvider } from '../src/config';
import { chatCall, ProviderError, CallInfo, llmAttacker, evaluate, verifySequence, TraceEvent } from '../src/discovery';
import { redact } from '../src/redact';
import { askJson, askText, AIBudget, aiStatus } from '../src/ai';
import { z } from 'zod';
import { ALL_FIXES, FixId } from '../src/simulator/shop';

const none = new Set<FixId>();
const report: Record<string, any> = { startedAt: new Date().toISOString(), live: true };
const calls: (CallInfo & { step: string })[] = [];
let step = 'init';
const onCall = (c: CallInfo) => calls.push({ ...c, step });
const ctx = (timeoutMs = 45000) => ({ f: fetch, timeoutMs, onCall });
const safe = (e: unknown) => redact(String((e as any)?.message ?? e));
const log = (...a: unknown[]) => console.log(...a);

async function main() {
  // ---- 1. environment loading (presence only)
  const providers = llmProviders();
  const present = (v: string) => !!process.env[v] && process.env[v]!.length > 0;
  report.env = { GEMINI_API_KEY: present('GEMINI_API_KEY'), GROQ_API_KEY: present('GROQ_API_KEY'), GEMINI_ENABLED: process.env.GEMINI_ENABLED === 'true', providerOrder: providers.map((p) => `${p.name}:${p.model}`) };
  log('1. env:', JSON.stringify(report.env));
  if (!providers.length) { report.blocked = 'No GEMINI_API_KEY / GROQ_API_KEY configured'; return; }

  // ---- 2. model ids against each provider's live /models list
  step = 'models';
  report.models = {};
  for (const p of providers) {
    try {
      const res = await fetch(p.baseUrl.replace(/\/$/, '') + '/models', { headers: { authorization: `Bearer ${p.key}` } });
      if (!res.ok) { report.models[p.name] = { configured: p.model, listStatus: res.status, error: redact((await res.text()).replaceAll(p.key, '[key]')).slice(0, 160) }; continue; }
      const j: any = await res.json();
      const ids: string[] = (j.data ?? j.models ?? []).map((m: any) => String(m.id ?? m.name).replace(/^models\//, ''));
      const found = ids.includes(p.model);
      report.models[p.name] = { configured: p.model, listedModels: ids.length, configuredModelExists: found, suggestions: found ? [] : ids.filter((id) => (p.name === 'gemini' ? /flash/.test(id) : /llama|gpt-oss|qwen/.test(id))).slice(0, 8) };
    } catch (e) { report.models[p.name] = { configured: p.model, error: safe(e) }; }
    log(`2. model ${p.name}:`, JSON.stringify(report.models[p.name]));
  }

  // ---- 3 + 4. live completion, tool calling, structured output
  report.providers = {};
  for (const p of providers) {
    const r: Record<string, any> = {};
    report.providers[p.name] = r;
    step = `${p.name}:basic`;
    try {
      const j = await chatCall(p, '/chat/completions', { model: p.model, max_tokens: 20, messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }] }, ctx());
      r.basic = { ok: true, reply: String(j.choices?.[0]?.message?.content ?? '').slice(0, 40) };
    } catch (e) { r.basic = { ok: false, error: safe(e) }; }
    log(`3. ${p.name} basic:`, JSON.stringify(r.basic));

    step = `${p.name}:tools`;
    const tools = [{ type: 'function', function: { name: 'add_numbers', description: 'Add two integers', parameters: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'] } } }];
    try {
      const msgs: any[] = [{ role: 'user', content: 'Use the add_numbers tool to compute 2 + 3, then tell me the result.' }];
      const j1 = await chatCall(p, '/chat/completions', { model: p.model, max_tokens: 200, messages: msgs, tools, tool_choice: 'auto' }, ctx());
      const m1 = j1.choices?.[0]?.message;
      const tc = m1?.tool_calls?.[0];
      let args: any = null; try { args = JSON.parse(tc?.function?.arguments ?? 'null'); } catch { /* */ }
      r.toolCall = { requested: !!tc, name: tc?.function?.name, argsParsed: args, argsCorrect: args && Number(args.a) + Number(args.b) === 5 };
      if (tc) {
        msgs.push({ role: 'assistant', content: m1.content ?? null, tool_calls: m1.tool_calls }, { role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ result: 5 }) });
        const j2 = await chatCall(p, '/chat/completions', { model: p.model, max_tokens: 100, messages: msgs, tools }, ctx());
        r.toolCall.finalAnswerMentions5 = /5/.test(String(j2.choices?.[0]?.message?.content ?? ''));
      }
    } catch (e) { r.toolCall = { ok: false, error: safe(e) }; }
    log(`4. ${p.name} tool calling:`, JSON.stringify(r.toolCall));

    step = `${p.name}:json`;
    try {
      const j = await chatCall(p, '/chat/completions', { model: p.model, max_tokens: 60, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: 'Return a JSON object with keys "provider_test" (string "ok") and "n" (number 7).' }] }, ctx());
      let parsed: any = null; try { parsed = JSON.parse(String(j.choices?.[0]?.message?.content ?? '')); } catch { /* */ }
      r.structuredJson = { ok: !!parsed && parsed.n === 7, parsed };
    } catch (e) { r.structuredJson = { ok: false, error: safe(e) }; }
    log(`   ${p.name} JSON mode:`, JSON.stringify(r.structuredJson));
  }

  // ---- 4b. structured output through the app's own helpers (prompt + Zod validation, as used by agent planning)
  step = 'structured';
  try {
    const t0 = Date.now();
    const out = await askJson(z.object({ hypotheses: z.array(z.object({ testCaseId: z.string(), rationale: z.string() })).min(1) }), 'You are a security planner. Reply with JSON only.', 'Return {"hypotheses":[{"testCaseId":"REFUND-001","rationale":"short reason"}]}', new AIBudget());
    report.structuredViaApp = { ok: !!out, parsed: out, latencyMs: Date.now() - t0, aiStatus: aiStatus() };
  } catch (e) { report.structuredViaApp = { ok: false, error: safe(e) }; }
  log('4b. askJson (prompt+Zod) via app helper:', JSON.stringify(report.structuredViaApp));
  step = 'explain';
  try { const txt = await askText('Explain in one sentence.', 'Why must refunds be capped at the amount paid?', new AIBudget()); report.explainViaApp = { ok: !!txt, chars: txt?.length ?? 0 }; } catch (e) { report.explainViaApp = { ok: false, error: safe(e) }; }
  log('   askText via app helper:', JSON.stringify(report.explainViaApp));

  // ---- 5. live failover: real Gemini rejects an invalid key, real Groq answers
  step = 'failover';
  const gem = providers.find((p) => p.name === 'gemini');
  const groq = providers.find((p) => p.name === 'groq');
  if (gem && groq) {
    const bogus: LlmProvider = { ...gem, key: 'invalid-key-for-failover-test' };
    const ev: string[] = [];
    try {
      const r = await llmAttacker({ fixes: none, attempts: 1, maxTurns: 2, providers: [bogus, groq], onCall, onTrace: (e) => ev.push(e.text) });
      report.failover = { gemini: r.failovers.find((f) => f.provider === 'gemini') ?? null, groqAnswered: r.providersUsed.includes('groq'), failovers: r.failovers, note: 'Gemini was called LIVE with a deliberately invalid key (real rejection); Groq answered LIVE.' };
    } catch (e) { report.failover = { error: safe(e) }; }
    log('5. failover:', JSON.stringify(report.failover));
  } else report.failover = { skipped: 'needs both Gemini and Groq keys' };

  // ---- 6. timeout handling (real endpoint, client-side abort) ; rate limit is NOT forced live
  step = 'timeout';
  if (providers[0]) {
    try { await chatCall(providers[0], '/chat/completions', { model: providers[0].model, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }, { f: fetch, timeoutMs: 1, onCall }); report.timeout = { triggered: false }; }
    catch (e) { report.timeout = { provider: providers[0].name, triggered: e instanceof ProviderError && e.message === 'timeout', reason: safe(e), note: 'client-side abort against the live endpoint (1 ms limit)' }; }
    log('6. timeout:', JSON.stringify(report.timeout));
  }
  report.rateLimit = { liveTested: false, note: 'HTTP 429 handling is covered by MOCK tests only (backend/tests/failover.test.ts). Rate limits were not provoked on the live free tiers.' };

  // ---- 7. one real LLM discovery session
  step = 'discovery';
  const trace: TraceEvent[] = [];
  const t0 = Date.now();
  let session: Awaited<ReturnType<typeof llmAttacker>> | null = null;
  try { session = await llmAttacker({ fixes: none, attempts: 2, maxTurns: 14, providers, onCall, onTrace: (e) => trace.push(e) }); }
  catch (e) { report.discovery = { error: safe(e) }; }
  if (session) {
    report.discovery = {
      wallMs: Date.now() - t0, turns: session.turns, providersUsed: session.providersUsed, failovers: session.failovers,
      verified: session.findings.length, rejected: session.rejected,
      trace: trace.filter((t) => t.kind !== 'tool_result').map((t) => `${t.kind}: ${t.text}`.slice(0, 260)),
    };
    // ---- 8. independent re-verification of every proposed attack on vulnerable vs secure shop
    report.verification = session.findings.map((f) => {
      const vuln = evaluate(f.sequence, none);
      const secure = evaluate(f.sequence, new Set(ALL_FIXES));
      const again = verifySequence(f.sequence, none, { title: f.title, engine: 'llm' });
      return { title: f.title, novelty: f.novelty, rationale: f.rationale, sequence: f.sequence, actions: f.sequence.map((a) => a.tool), vulnerableShop: { excess: vuln.leakage, position: vuln.vulnPosition, violations: vuln.kinds }, secureShop: { excess: secure.leakage, position: secure.vulnPosition }, reverified: again.verified, blockedBy: f.blockedBy };
    });
    log('7. discovery:', JSON.stringify({ ...report.discovery, trace: undefined }));
    log('8. verification:', JSON.stringify(report.verification));
  }
}

main().catch((e) => { report.fatal = safe(e); }).finally(() => {
  report.finishedAt = new Date().toISOString();
  report.calls = calls.map((c) => ({ ...c, error: c.error ? redact(c.error) : undefined }));
  const tot = calls.reduce((a, c) => ({ n: a.n + 1, tokens: a.tokens + (c.usage?.total ?? 0), ok: a.ok + (c.status === 200 ? 1 : 0) }), { n: 0, tokens: 0, ok: 0 });
  report.totals = { calls: tot.n, successful: tot.ok, totalTokens: tot.tokens };
  const out = path.resolve(__dirname, '../../docs/llm-live-validation.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  log(`\nCalls: ${tot.n} (${tot.ok} HTTP 200), tokens: ${tot.tokens}. Report: ${out}`);
});
