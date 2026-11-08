import { describe, it, expect } from 'vitest';
import { validateUrlShape, isPrivateIp, validateUpload, crawlPublicSite, safeFetch } from '../src/security';
import { AgentOutputSchema, FindingSchema } from '../src/agents';
import { computeExposure } from '../src/finance';
import { redact } from '../src/ai';

describe('URL safety (SSRF)', () => {
  it.each(['http://localhost/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://[::1]/', 'http://metadata.google.internal/', 'ftp://example.com/', 'file:///etc/passwd', 'http://user:pw@example.com/', 'http://100.64.0.1/', 'http://foo.localhost/'])('blocks %s', (u) => {
    expect(() => validateUrlShape(u)).toThrow();
  });
  it('allows public http(s)', () => { expect(validateUrlShape('https://example.com/shop').hostname).toBe('example.com'); });
  it('classifies private ranges', () => { for (const ip of ['10.1.1.1', '172.16.0.1', '172.31.255.1', '192.168.0.1', '127.0.0.1', '169.254.1.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) expect(isPrivateIp(ip)).toBe(true); expect(isPrivateIp('8.8.8.8')).toBe(false); expect(isPrivateIp('172.32.0.1')).toBe(false); });
  it('safeFetch refuses loopback targets at connection time', async () => { await expect(safeFetch('http://127.0.0.1:9/')).rejects.toThrow(); await expect(safeFetch('http://localhost/')).rejects.toThrow(); });
  it('crawler extracts public policy info and states its limits', async () => {
    const pages: Record<string, string> = {
      'https://shop.test/': '<html><title>Shop</title><body><a href="/pages/refund-policy">Refunds</a><p>Use promo code SAVE for 20% off. Prices from $19.99.</p></body></html>',
      'https://shop.test/pages/refund-policy': '<html><body><p>You may return items within 30 days for a refund. Contact help@shop.test.</p></body></html>',
    };
    const fake = async (u: string) => ({ status: pages[u] ? 200 : 404, url: u, contentType: 'text/html', body: pages[u] || '' });
    const r = await crawlPublicSite('https://shop.test/', fake as any);
    expect(r.pagesFetched).toHaveLength(2);
    expect(r.observations.some((o) => o.kind === 'refund-policy')).toBe(true);
    expect(r.observations.some((o) => o.kind === 'discount')).toBe(true);
    expect(r.limitations.join(' ')).toMatch(/NOT tested/);
  });
});

describe('upload safety', () => {
  it('accepts a text policy', () => { expect(validateUpload('refund-policy.md', Buffer.from('30 day refunds')).kind).toBe('refund-policy'); });
  it('rejects executables, binaries, oversize, bad json, odd names', () => {
    expect(() => validateUpload('evil.exe', Buffer.from('MZ'))).toThrow(/not allowed/);
    expect(() => validateUpload('a.txt', Buffer.from([0x41, 0x00, 0x42]))).toThrow(/Binary/);
    expect(() => validateUpload('a.txt', Buffer.alloc(1_000_001, 65))).toThrow(/1 MB/);
    expect(() => validateUpload('a.json', Buffer.from('{bad'))).toThrow(/JSON/);
    expect(() => validateUpload('../../etc/passwd.txt', Buffer.from('x'))).toThrow(/Invalid file name/);
    expect(() => validateUpload('a.txt', Buffer.alloc(0))).toThrow(/empty/);
  });
});

describe('agent output validation', () => {
  const good = { title: 'Dup refund', category: 'refund', severity: 'high', confidence: 0.9, businessRule: 'refund', rootCause: 'Missing idempotency check', evidence: [], reproductionSteps: ['a'], testCaseId: 'REFUND-002', leakage: 30 };
  it('accepts valid output', () => { expect(AgentOutputSchema.safeParse({ agentType: 'refund-abuse', status: 'completed', mode: 'deterministic', findings: [good], cleared: [], rejectedHypotheses: [] }).success).toBe(true); });
  it('rejects malformed / free-form output', () => {
    expect(FindingSchema.safeParse({ ...good, severity: 'catastrophic' }).success).toBe(false);
    expect(FindingSchema.safeParse({ ...good, confidence: 4 }).success).toBe(false);
    expect(AgentOutputSchema.safeParse({ agentType: 'hacker', status: 'completed', findings: [] }).success).toBe(false);
    expect(AgentOutputSchema.safeParse('rm -rf /').success).toBe(false);
  });
});

describe('financial model', () => {
  it('is transparent, ordered and labelled as a projection', () => {
    const e = computeExposure(30, 'refund');
    expect(e.exposure.low).toBeLessThan(e.exposure.expected); expect(e.exposure.expected).toBeLessThan(e.exposure.high);
    expect(e.exposure.expected).toBe(e.attacks.expected * 30);
    expect(e.label).toMatch(/SIMULATED/); expect(e.assumptions.join(' ')).toMatch(/counted once/);
  });
  it('redacts secrets and PII before AI calls', () => {
    const r = redact('key sk-abcdefghijklmnopqrstuv user bob@example.com Bearer abcdefghijklmnop1234');
    expect(r).not.toMatch(/sk-abc|bob@|abcdefghijklmnop1234/);
  });
});

describe('test environment isolation (tests must never reach real external services)', () => {
  it('has no real credentials loaded, even though backend/.env may contain them', async () => {
    const { llmProviders } = await import('../src/config');
    const { ppMode } = await import('../src/paypal');
    const { githubConfigured } = await import('../src/github');
    expect(llmProviders()).toEqual([]);
    expect(ppMode()).toBe('demo');
    expect(githubConfigured()).toBe(false);
    for (const k of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'GITHUB_TOKEN', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']) expect(process.env[k] ?? '').toBe('');
  });
});
