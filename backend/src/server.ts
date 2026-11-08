import { createApp } from './app';
import { env } from './config';
import { markInterruptedAssessments } from './orchestrator';
import { aiStatus } from './ai';
import * as paypal from './paypal';

async function main() {
  if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /change-me|dev-only/.test(process.env.JWT_SECRET))) {
    throw new Error('Refusing to start in production without a strong JWT_SECRET (>= 32 random characters).');
  }
  await markInterruptedAssessments();
  createApp().listen(env.port, () => {
    console.log(`SellerShield API on http://localhost:${env.port}`);
    console.log(`  demo mode: ${env.demoMode} | AI: ${JSON.stringify(aiStatus())} | PayPal: ${paypal.ppMode() === 'sandbox' ? 'Sandbox' : 'DEMO (local simulation)'}`);
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
