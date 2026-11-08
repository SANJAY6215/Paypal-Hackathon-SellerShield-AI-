import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globalSetup: ['./tests/global-setup.ts'],
    env: { DATABASE_URL: 'file:./test.db', AGENT_STEP_DELAY_MS: '0', NODE_ENV: 'test', DEMO_MODE: 'true', JWT_SECRET: 'test-secret', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', GEMINI_ENABLED: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', GEMINI_BASE_URL: '', GROQ_BASE_URL: '', LLM_PROVIDER_ORDER: '', GITHUB_TOKEN: '', GITHUB_REPO: '', PAYPAL_BASE_URL: '' },
    testTimeout: 60000, hookTimeout: 120000, fileParallelism: false,
  },
});
