import 'dotenv/config';

export const env = {
  get demoMode() { return (process.env.DEMO_MODE ?? 'true') === 'true'; },
  get jwtSecret() { return process.env.JWT_SECRET || 'dev-only-secret-change-me'; },
  get appUrl() { return process.env.APP_URL || 'http://localhost:3000'; },
  get port() { return Number(process.env.PORT || 4000); },
  get ppClientId() { return process.env.PAYPAL_CLIENT_ID || ''; },
  get ppSecret() { return process.env.PAYPAL_CLIENT_SECRET || ''; },
  get ppBase() { return process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com'; },
  get ppWebhookId() { return process.env.PAYPAL_WEBHOOK_ID || ''; },
  get githubToken() { return process.env.GITHUB_TOKEN || ''; },
  get githubApi() { return process.env.GITHUB_API_URL || 'https://api.github.com'; },
  get githubRepo() { return process.env.GITHUB_REPO || ''; },
  get githubBase() { return process.env.GITHUB_BASE_BRANCH || 'main'; },
  get stepDelayMs() { return Number(process.env.AGENT_STEP_DELAY_MS ?? 450); },
  get simWebhookSecret() { return process.env.LOCAL_WEBHOOK_SECRET || (process.env.JWT_SECRET || 'dev-only-secret-change-me') + ':sim-webhook'; },
};

export interface LlmProvider { name: string; kind: 'openai'; baseUrl: string; key: string; model: string }

/**
 * Ordered LLM providers for the Discovery Lab attacker, with automatic failover.
 * Gemini is DISABLED unless GEMINI_ENABLED=true (its free tier returned HTTP 403 / billing required for the current project). Default order: gemini, groq (override with LLM_PROVIDER_ORDER=groq,gemini). Only providers with a key are used.
 * Model names are configurable because free-tier model names change; defaults are NOT verified against the live services.
 */
export function llmProviders(): LlmProvider[] {
  const all: Record<string, LlmProvider | null> = {
    gemini: process.env.GEMINI_ENABLED === 'true' && process.env.GEMINI_API_KEY ? { name: 'gemini', kind: 'openai', baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai', key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' } : null,
    groq: process.env.GROQ_API_KEY ? { name: 'groq', kind: 'openai', baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1', key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b' } : null,
  };
  const order = (process.env.LLM_PROVIDER_ORDER || 'gemini,groq').split(',').map((x) => x.trim()).filter(Boolean);
  return order.map((n) => all[n]).filter((x): x is LlmProvider => !!x);
}
