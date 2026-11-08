import { describe, it, expect } from 'vitest';
import { SCENARIOS } from '../src/simulator/scenarios';
import { ALL_FIXES, FixId, auditLedger } from '../src/simulator/shop';
import { FIXES, verifyFix, buildPatch } from '../src/simulator/fixes';
import { generateCandidates, runChain } from '../src/simulator/chains';
import { auditFinding, buildFinding } from '../src/agents';

const none = new Set<FixId>();
const all = new Set<FixId>(ALL_FIXES);
const vulnerableIds = ['DISC-001', 'REFUND-001', 'REFUND-002', 'PAY-001', 'INV-001', 'ACL-001'];

describe('scenario library', () => {
  for (const sc of SCENARIOS) {
    const vulnerable = vulnerableIds.includes(sc.id);
    it(`${sc.id} ${vulnerable ? 'reproduces on the vulnerable app' : 'is already secure'}`, () => {
      expect(sc.reproduce(none).exploited).toBe(vulnerable);
    });
    it(`${sc.id} is blocked by the secure baseline`, () => {
      expect(sc.reproduce(all).exploited).toBe(false);
    });
  }
  it('is deterministic', () => {
    for (const sc of SCENARIOS) expect(JSON.stringify(sc.reproduce(none).actual)).toBe(JSON.stringify(sc.reproduce(none).actual));
  });
  it('expected leakage numbers', () => {
    const l = (id: string) => SCENARIOS.find((s) => s.id === id)!.reproduce(none).leakage;
    expect(l('DISC-001')).toBe(34); expect(l('REFUND-001')).toBe(20); expect(l('REFUND-002')).toBe(30);
    expect(l('PAY-001')).toBe(90); expect(l('INV-001')).toBe(360); expect(l('ACL-001')).toBe(120);
  });
});

describe('fixes', () => {
  for (const f of Object.values(FIXES)) {
    it(`${f.id}: blocks attack, keeps legit flows, adds no regressions`, () => {
      const v = verifyFix(f.id, new Set(), undefined);
      expect(v.originalAttack.exploitedBefore).toBe(true);
      expect(v.originalAttackBlocked).toBe(true);
      expect(v.legit.filter((x) => !x.ok)).toEqual([]);
      expect(v.regression.filter((x) => !x.ok)).toEqual([]);
      expect(v.passed).toBe(true);
      expect(buildPatch(f.id)).toMatch(/^[-+]/m);
    });
  }
});

describe('compound chains', () => {
  it('generates candidates only between verified vulnerabilities', () => {
    expect(generateCandidates(vulnerableIds).map((c) => c.signature).sort()).toEqual(['DISC-001>REFUND-001>REFUND-002', 'PAY-001>ACL-001']);
    expect(generateCandidates(['DISC-001', 'ACL-001'])).toEqual([]);
    expect(generateCandidates(['DISC-001', 'REFUND-001']).map((c) => c.signature)).toEqual(['DISC-001>REFUND-001']);
  });
  it('chain A exceeds the sum of isolated leakage and is blocked by any fixed link', () => {
    const run = runChain(['DISC-001', 'REFUND-001', 'REFUND-002'], none);
    expect(run.exploited).toBe(true);
    expect(run.leakage).toBe(154);
    expect(run.leakage).toBeGreaterThan(34 + 20 + 30);
    expect(runChain(['DISC-001', 'REFUND-001', 'REFUND-002'], all).leakage).toBe(0);
    expect(runChain(['DISC-001', 'REFUND-001', 'REFUND-002'], new Set<FixId>(['refund-idempotency', 'refund-calc', 'coupon-stacking'])).exploited).toBe(false);
  });
  it('chain B', () => {
    expect(runChain(['PAY-001', 'ACL-001'], none).leakage).toBe(240);
    expect(runChain(['PAY-001', 'ACL-001'], new Set<FixId>(['payment-state'])).exploited).toBe(false);
  });
});

describe('independent auditor', () => {
  it('verifies real findings and rejects fabricated ones', () => {
    const sc = SCENARIOS.find((s) => s.id === 'REFUND-002')!;
    const f = buildFinding(sc, sc.reproduce(none));
    expect(auditFinding(f, none).verdict).toBe('verified');
    expect(auditFinding({ ...f, leakage: 999 }, none).verdict).toBe('rejected');
    expect(auditFinding({ ...f, testCaseId: 'MADE-UP-9' }, none).verdict).toBe('rejected');
    expect(auditFinding(f, all).verdict).toBe('rejected'); // attack no longer reproduces once fixed
    expect(auditFinding({ ...f, severity: 'low' }, none).note).toMatch(/disagreed/);
  });
  it('ledger audit is clean on the secure app', () => {
    for (const sc of SCENARIOS) expect(auditLedger(sc.reproduce(all).shop)).toEqual([]);
  });
});
