import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { llmAttacker } from '../src/discovery';
import { llmProviders, LlmProvider } from '../src/config';
import { FixId } from '../src/simulator/shop';

const none = new Set<FixId>();
function mock(handler: (body: any, res: http.ServerResponse, headers: http.IncomingHttpHeaders) => void) {
  const calls: { url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { const body = b ? JSON.parse(b) : {}; calls.push({ url: req.url!, headers: req.headers, body }); handler(body, res, req.headers); });
  });
  return new Promise<{ url: string; calls: typeof calls; close: () => void }>((r) => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => server.close() })));
}
const send = (res: http.ServerResponse, status: number, obj: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const toolCall = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const completion = (message: unknown) => ({ choices: [{ message }] });

// scripted OpenAI-format conversation implementing Cancel-for-Cash
const goodScript = [
  completion({ content: 'Pending then cancel.', tool_calls: [toolCall('1', 'create_order', { lines: [{ sku: 'NC-USB', qty: 4 }], coupons: ['SAVE20'] }), toolCall('2', 'payment_event', { order: 'o1', event: 'PENDING' }), toolCall('3', 'cancel', { order: 'o1' })] }),
  completion({ content: null, tool_calls: [toolCall('4', 'report_attack', { title: 'Cancel-for-cash', rationale: 'pending counts as paid' })] }),
];

describe('LLM provider chain with failover (OpenAI-compatible function calling, LOCAL MOCKS - not live)', () => {
  const closers: (() => void)[] = [];
  afterAll(() => closers.forEach((c) => c()));

  it('fails over from a rate-limited provider to the next and still verifies the attack', async () => {
    const gem = await mock((_b, res) => send(res, 429, { error: 'quota' }));
    let i = 0;
    const groq = await mock((_b, res) => send(res, 200, goodScript[i++] ?? completion({ content: 'done' })));
    closers.push(gem.close, groq.close);
    const providers: LlmProvider[] = [
      { name: 'gemini', kind: 'openai', baseUrl: gem.url, key: 'GEM-KEY', model: 'gemini-test' },
      { name: 'groq', kind: 'openai', baseUrl: groq.url, key: 'GROQ-KEY', model: 'groq-test' },
    ];
    const events: string[] = [];
    const r = await llmAttacker({ fixes: none, attempts: 1, sleep: async () => {}, providers, onTrace: (e) => events.push(`${e.kind}:${e.text}`) });
    expect(r.failovers).toEqual([{ provider: 'gemini', reason: 'HTTP 429 (rate limited)' }]); // after exhausting retries
    expect(r.providersUsed).toEqual(['groq']);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ title: 'Cancel-for-cash', leakage: 160, verified: true, novelty: 'novel', engine: 'llm' });
    expect(events.some((e) => /Failing over to groq/.test(e))).toBe(true);
    // wire format: bearer auth, function tools, tool results returned as role:tool
    expect(gem.calls[0].headers.authorization).toBe('Bearer GEM-KEY');
    expect(groq.calls[0].headers.authorization).toBe('Bearer GROQ-KEY');
    expect(groq.calls[0].url).toBe('/chat/completions');
    expect(groq.calls[0].body.tools[0]).toMatchObject({ type: 'function', function: { name: 'create_order' } });
    expect(groq.calls[1].body.messages.filter((m: any) => m.role === 'tool')).toHaveLength(3);
  });

  it('a rejected key (401) also fails over; a failed provider is skipped in later attempts', async () => {
    const bad = await mock((_b, res) => send(res, 401, { error: 'bad key' }));
    let i = 0;
    const good = await mock((_b, res) => send(res, 200, goodScript[i++ % 2]));
    closers.push(bad.close, good.close);
    const r = await llmAttacker({ fixes: none, attempts: 2, sleep: async () => {}, providers: [
      { name: 'gemini', kind: 'openai', baseUrl: bad.url, key: 'k', model: 'm' }, { name: 'groq', kind: 'openai', baseUrl: good.url, key: 'k', model: 'm' },
    ] });
    expect(r.failovers).toHaveLength(1);
    expect(r.failovers[0].reason).toMatch(/401 \(key rejected\)/);
    expect(bad.calls).toHaveLength(1); // not retried for attempt 2
    expect(r.providersUsed).toEqual(['groq']);
  });

  it('when every provider fails it reports that honestly instead of inventing findings', async () => {
    const a = await mock((_b, res) => send(res, 500, {}));
    const b = await mock((_b, res) => send(res, 429, {}));
    closers.push(a.close, b.close);
    const r = await llmAttacker({ fixes: none, attempts: 2, sleep: async () => {}, providers: [{ name: 'gemini', kind: 'openai', baseUrl: a.url, key: 'k', model: 'm' }, { name: 'groq', kind: 'openai', baseUrl: b.url, key: 'k', model: 'm' }] });
    expect(r.findings).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/All LLM providers failed/);
    expect(r.failovers.map((f) => f.provider)).toEqual(['gemini', 'groq']);
  });

  it('malformed tool arguments are reported back as invalid input, not executed', async () => {
    let i = 0;
    const s = [
      completion({ tool_calls: [toolCall('1', 'create_order', '{not json'), toolCall('2', 'rm_rf', { path: '/' })] }),
      completion({ tool_calls: [toolCall('3', 'report_attack', { title: 'nothing' })] }),
    ];
    const m = await mock((_b, res) => send(res, 200, s[i++]));
    closers.push(m.close);
    const events: string[] = [];
    const r = await llmAttacker({ fixes: none, attempts: 1, sleep: async () => {}, providers: [{ name: 'groq', kind: 'openai', baseUrl: m.url, key: 'k', model: 'm' }], onTrace: (e) => events.push(e.text) });
    expect(events.filter((t) => t.startsWith('Invalid tool input'))).toHaveLength(2);
    expect(r.findings).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/No shop actions/);
  });

  it('rejects a hallucinated attack even when the model reports a huge loss', async () => {
    let i = 0;
    const s2 = [
      completion({ tool_calls: [toolCall('1', 'create_order', { lines: [{ sku: 'NC-CHG', qty: 1 }] })] }),
      completion({ tool_calls: [toolCall('2', 'report_attack', { title: 'Infinite money glitch', rationale: 'I made $1,000,000' })] }),
    ];
    const m = await mock((_b, res) => send(res, 200, s2[i++]));
    closers.push(m.close);
    const r = await llmAttacker({ fixes: none, attempts: 1, sleep: async () => {}, providers: [{ name: 'groq', kind: 'openai', baseUrl: m.url, key: 'k', model: 'm' }] });
    expect(r.findings).toHaveLength(0);
    expect(r.rejected[0]).toMatchObject({ title: 'Infinite money glitch' });
  });

  it('records latency and token usage per call, and times out slow providers', async () => {
    let i = 0;
    const m = await mock((_b, res) => send(res, 200, { ...(goodScript[i++] ?? completion({ content: 'x' })), usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
    const slow = await mock(() => { /* never answers */ });
    closers.push(m.close, slow.close);
    const calls: any[] = [];
    const r = await llmAttacker({ fixes: none, attempts: 1, sleep: async () => {}, timeoutMs: 300, onCall: (c) => calls.push(c), providers: [
      { name: 'gemini', kind: 'openai', baseUrl: slow.url, key: 'SECRET-A', model: 'slow' }, { name: 'groq', kind: 'openai', baseUrl: m.url, key: 'SECRET-B', model: 'fast' },
    ] });
    expect(r.failovers).toEqual([{ provider: 'gemini', reason: 'timeout' }]);
    expect(calls[0]).toMatchObject({ provider: 'gemini', status: 'error', error: 'timeout' });
    expect(calls[1]).toMatchObject({ provider: 'groq', status: 200, usage: { prompt: 100, completion: 20, total: 120 } });
    expect(calls[1].latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(calls)).not.toContain('SECRET');
  });

  it('429 with retry-after: waits and retries the SAME provider (no failover) then succeeds', async () => {
    let n = 0;
    const m = await mock((_b, res) => {
      n++;
      if (n <= 2) { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' }); return res.end(JSON.stringify({ error: { message: 'Rate limit reached. Please try again in 1s' } })); }
      send(res, 200, goodScript[n - 3] ?? completion({ content: 'x' }));
    });
    closers.push(m.close);
    const waits: number[] = [];
    const r = await llmAttacker({ fixes: none, attempts: 1, sleep: async (ms) => { waits.push(ms); }, providers: [{ name: 'groq', kind: 'openai', baseUrl: m.url, key: 'k', model: 'm' }] });
    expect(waits).toEqual([1300, 1300]); // retry-after 1s + 300 ms margin, honoured twice
    expect(r.failovers).toEqual([]);
    expect(r.findings).toHaveLength(1);
  });

  it('429 that asks for a very long wait fails over immediately instead of stalling', async () => {
    const a = await mock((_b, res) => { res.writeHead(429, { 'retry-after': '600' }); res.end('{}'); });
    let i = 0;
    const b = await mock((_b, res) => send(res, 200, goodScript[i++] ?? completion({ content: 'x' })));
    closers.push(a.close, b.close);
    const waits: number[] = [];
    const r = await llmAttacker({ fixes: none, attempts: 1, sleep: async (ms) => { waits.push(ms); }, providers: [{ name: 'gemini', kind: 'openai', baseUrl: a.url, key: 'k', model: 'm' }, { name: 'groq', kind: 'openai', baseUrl: b.url, key: 'k', model: 'm' }] });
    expect(waits).toEqual([]);
    expect(r.failovers[0]).toMatchObject({ provider: 'gemini', reason: 'HTTP 429 (rate limited)' });
    expect(r.providersUsed).toEqual(['groq']);
  });

  it('Gemini stays DISABLED by default even when a Gemini key exists (billing-blocked project)', () => {
    const save = { ...process.env };
    process.env.GEMINI_API_KEY = 'm-secret'; process.env.GROQ_API_KEY = 'g-secret'; delete process.env.GEMINI_ENABLED;
    expect(llmProviders().map((p) => p.name)).toEqual(['groq']);
    process.env.GEMINI_ENABLED = 'false';
    expect(llmProviders().map((p) => p.name)).toEqual(['groq']);
    process.env.GEMINI_ENABLED = 'true';
    expect(llmProviders().map((p) => p.name)).toEqual(['gemini', 'groq']);
    delete process.env.GEMINI_API_KEY; delete process.env.GROQ_API_KEY; delete process.env.GEMINI_ENABLED;
    expect(llmProviders()).toEqual([]);
    Object.assign(process.env, save); delete process.env.GEMINI_ENABLED; delete process.env.GROQ_API_KEY; delete process.env.GEMINI_API_KEY;
  });

  it('reads providers from the environment in order, only those with keys, never exposing keys', () => {
    const save = { ...process.env };
    process.env.GROQ_API_KEY = 'g-secret'; process.env.GEMINI_API_KEY = 'm-secret'; process.env.GEMINI_ENABLED = 'true'; 
    expect(llmProviders().map((p) => p.name)).toEqual(['gemini', 'groq']);
    process.env.LLM_PROVIDER_ORDER = 'groq,gemini';
    expect(llmProviders().map((p) => p.name)).toEqual(['groq', 'gemini']);
    delete process.env.GEMINI_API_KEY;
    expect(llmProviders().map((p) => p.name)).toEqual(['groq']);
    Object.assign(process.env, save); delete process.env.LLM_PROVIDER_ORDER; delete process.env.GROQ_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_ENABLED;
  });
});
