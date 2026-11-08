import { round2 } from './simulator/shop';

export const ASSUMPTIONS = {
  monthlyOrders: 1200,
  horizonMonths: 12,
  // share of orders in which the weakness is successfully exploited (low / expected / high)
  abuseRates: {
    discount: [0.002, 0.01, 0.03],
    refund: [0.0005, 0.002, 0.006],
    payment: [0.0005, 0.0015, 0.005],
    inventory: [0.0002, 0.001, 0.003],
    'access-control': [0.0002, 0.001, 0.003],
    'business-logic': [0.0005, 0.002, 0.006],
  } as Record<string, number[]>,
};

export interface Exposure {
  label: string;
  perAttack: number;
  category: string;
  attacks: { low: number; expected: number; high: number };
  exposure: { low: number; expected: number; high: number };
  formula: string;
  assumptions: string[];
  confidence: { level: 'low' | 'medium' | 'high'; score: number; reason: string };
  currentLeakage?: number;
}

export const SIM_LABEL = 'SIMULATED PROJECTION - not an actual merchant loss';

/**
 * Exposure = unique exploited transactions x excess amount per attack.
 * One exploited order counts once: replayed requests on the same order are inside the per-attack figure
 * (they pay out on that single order) and are never multiplied again.
 */
export function computeExposure(perAttack: number, category: string, extra: { rates?: number[]; note?: string } = {}): Exposure {
  const rates = extra.rates || ASSUMPTIONS.abuseRates[category] || ASSUMPTIONS.abuseRates.refund;
  const base = ASSUMPTIONS.monthlyOrders * ASSUMPTIONS.horizonMonths;
  const attacks = { low: Math.round(base * rates[0]), expected: Math.round(base * rates[1]), high: Math.round(base * rates[2]) };
  const mul = (n: number) => round2(n * perAttack);
  return {
    label: SIM_LABEL,
    perAttack: round2(perAttack),
    category,
    attacks,
    exposure: { low: mul(attacks.low), expected: mul(attacks.expected), high: mul(attacks.high) },
    formula: 'exposure = (monthly orders x months x exploitation rate) x excess amount per simulated attack',
    assumptions: [
      `${ASSUMPTIONS.monthlyOrders} orders/month over ${ASSUMPTIONS.horizonMonths} months (demo profile - replace with merchant data)`,
      `Exploitation rate of orders: low ${(rates[0] * 100).toFixed(2)}%, expected ${(rates[1] * 100).toFixed(2)}%, high ${(rates[2] * 100).toFixed(2)}%`,
      'Each exploited order is counted once; replayed events on the same order are not multiplied',
      ...(extra.note ? [extra.note] : []),
    ],
    confidence: {
      level: 'medium', score: 0.6,
      reason: 'Per-attack amount is deterministic (reproduced in the simulator). Attack frequency is an assumption, so the total is a projection.',
    },
  };
}

export const SEVERITY_WEIGHT: Record<string, number> = { critical: 20, high: 12, medium: 6, low: 3 };
export const postureScore = (open: { severity: string }[]) => Math.max(0, 100 - open.reduce((s, v) => s + (SEVERITY_WEIGHT[v.severity] || 0), 0));
