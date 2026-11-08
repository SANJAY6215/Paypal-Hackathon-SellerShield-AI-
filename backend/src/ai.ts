import { z } from 'zod';
import { LlmProvider, llmProviders } from './config';
import { chatCall, ProviderError, CallInfo } from './discovery';

import { redact } from './redact';
export { redact };

export interface AIProvider {
  name: string;
  model: string;
  available(): boolean;
  complete(system: string, user: string, maxTokens?: number): Promise<string>;
}

/** Gemini → Groq failover for the general-purpose AI helpers (hypothesis ordering, defence explanations). */
/** Circuit breaker: a provider whose key is rejected (401/403) is skipped for 10 minutes, a rate-limited one for 60 s. */
const deadUntil = new Map<string, number>();
export function resetProviderHealth() { deadUntil.clear(); }

class FailoverProvider implements AIProvider {
  last: { provider: string; model: string } | null = null;
  constructor(private providers: LlmProvider[], private onCall?: (c: CallInfo) => void) {}
  get name() { return this.providers.map((p) => p.name).join(' → '); }
  get model() { return this.providers[0]?.model ?? ''; }
  available() { return this.providers.length > 0; }
  async complete(system: string, user: string, maxTokens = 700) {
    let lastErr: unknown;
    for (const p of this.providers) {
      if ((deadUntil.get(p.name) ?? 0) > Date.now()) continue;
      try {
        const j = await chatCall(p, '/chat/completions', { model: p.model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, { f: fetch, timeoutMs: 25000, onCall: this.onCall });
        this.last = { provider: p.name, model: p.model };
        return String(j.choices?.[0]?.message?.content ?? '');
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        lastErr = e;
        if (e.status === 401 || e.status === 403) deadUntil.set(p.name, Date.now() + 10 * 60_000);
        else if (e.status === 429) deadUntil.set(p.name, Date.now() + 60_000);
      }
    }
    throw lastErr ?? new Error('no provider');
  }
}

export function getProvider(): AIProvider | null {
  const p = new FailoverProvider(llmProviders());
  return p.available() ? p : null;
}

export function aiStatus() {
  const providers = llmProviders();
  return { configured: providers.length > 0, provider: providers.length ? providers.map((p) => p.name).join(' → ') : null, model: providers[0]?.model ?? null, mode: providers.length ? 'ai-assisted' : 'deterministic' };
}

/** Per-assessment call budget to bound token spend. */
export class AIBudget {
  calls = 0;
  constructor(public maxCalls = 12) {}
  take() { if (this.calls >= this.maxCalls) return false; this.calls++; return true; }
}

/** Ask the model for JSON and validate it with Zod. Returns null on any failure (caller falls back). */
export async function askJson<T>(schema: z.ZodType<T>, system: string, user: string, budget: AIBudget): Promise<T | null> {
  const p = getProvider();
  if (!p || !budget.take()) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await p.complete(system + '\nRespond with a single JSON object only, no prose.', redact(user), 600);
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) continue;
      const parsed = schema.safeParse(JSON.parse(m[0]));
      if (parsed.success) return parsed.data;
    } catch { /* retry once */ }
  }
  return null;
}

export async function askText(system: string, user: string, budget: AIBudget): Promise<string | null> {
  const p = getProvider();
  if (!p || !budget.take()) return null;
  try { return (await p.complete(system, redact(user), 500)).trim() || null; } catch { return null; }
}
