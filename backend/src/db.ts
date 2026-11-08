import { PrismaClient } from '@prisma/client';
import { FixId, ALL_FIXES } from './simulator/shop';

export const prisma = new PrismaClient();

export interface AppConfig {
  stackableCoupons?: boolean; // true  => coupon stacking allowed (re-opens DISC-001)
  refundAllocation?: 'list' | 'proportional'; // 'list' => refunds at list price (re-opens REFUND-001)
  enforceRefundIdempotency?: boolean; // false => re-opens REFUND-002
  atomicInventory?: boolean; // false => re-opens INV-001
  strictPaymentStates?: boolean; // false => re-opens PAY-001
  refundRbac?: boolean; // false => re-opens ACL-001
}

const OVERRIDES: { fix: FixId; off: (c: AppConfig) => boolean }[] = [
  { fix: 'coupon-stacking', off: (c) => c.stackableCoupons === true },
  { fix: 'refund-calc', off: (c) => c.refundAllocation === 'list' },
  { fix: 'refund-idempotency', off: (c) => c.enforceRefundIdempotency === false },
  { fix: 'inventory-race', off: (c) => c.atomicInventory === false },
  { fix: 'payment-state', off: (c) => c.strictPaymentStates === false },
  { fix: 'refund-permission', off: (c) => c.refundRbac === false },
];

export async function getState(merchantId: string) {
  let s = await prisma.demoAppState.findUnique({ where: { merchantId } });
  if (!s) s = await prisma.demoAppState.create({ data: { merchantId, fixes: [], config: {}, history: [] } });
  return { id: s.id, applied: (s.fixes as unknown as FixId[]).filter((f) => ALL_FIXES.includes(f)), config: s.config as AppConfig, history: s.history as any[] };
}

/** Fixes that are actually in force: applied fixes minus those switched off by a business-rule config change. */
export function effectiveFixes(state: { applied: FixId[]; config: AppConfig }): Set<FixId> {
  const off = new Set(OVERRIDES.filter((o) => o.off(state.config)).map((o) => o.fix));
  return new Set(state.applied.filter((f) => !off.has(f)));
}

export async function saveState(merchantId: string, applied: FixId[], config: AppConfig, historyEntry?: { action: string }) {
  const cur = await getState(merchantId);
  const history = historyEntry ? [...cur.history, { at: new Date().toISOString(), action: historyEntry.action, fixes: cur.applied, config: cur.config }].slice(-50) : cur.history;
  await prisma.demoAppState.update({ where: { merchantId }, data: { fixes: applied, config: config as any, history: history as any } });
}

export async function audit(userId: string | null, merchantId: string | null, action: string, resourceType: string, resourceId?: string, metadata?: Record<string, unknown>) {
  await prisma.auditLog.create({ data: { userId, merchantId, action, resourceType, resourceId, metadata: (metadata ?? {}) as any } });
}
