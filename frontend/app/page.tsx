'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ShieldHalf, Bot, Network, Wrench, CreditCard, ArrowRight, Swords, Search, ShieldCheck, BadgeCheck, Tag, RotateCcw, Copy } from 'lucide-react';
import { api } from '../lib/api';

const AGENTS = [
  ['Opportunist', 'Discounts, coupons, pricing'], ['Refund Abuse', 'Refunds, cancellations, returns'], ['Payment Manipulation', 'State, idempotency, webhooks, checkout races'],
  ['Insider Threat', 'Roles, approvals, audit trail'], ['Defence Architect', 'Root cause, patch, regression tests'], ['Independent Auditor', 'Reproduces and can reject every claim'],
];
const FLOW = [
  [Search, 'Discover', 'Four investigators probe the merchant in parallel.'], [Swords, 'Attack', 'Weaknesses are chained and executed in an isolated simulator.'],
  [BadgeCheck, 'Verify', 'Nothing is "verified" until a deterministic reproduction passes.'], [ShieldCheck, 'Defend', 'A diff, regression tests and before/after proof - applied only with human approval.'],
];

export default function Landing() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const demo = async () => { setBusy(true); try { await api('/auth/demo', { body: {} }); router.push('/demo'); } catch { router.push('/login'); } };
  return (
    <div>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-semibold"><ShieldHalf className="h-6 w-6 text-info" />SellerShield AI</div>
        <Link href="/login" className="text-sm text-muted hover:text-ink">Sign in</Link>
      </header>
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-12">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-info">Attack. Discover. Defend. Verify.</p>
        <h1 className="max-w-4xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">Your commerce business has vulnerabilities you haven&apos;t discovered yet.</h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">SellerShield AI uses autonomous agents to discover compound financial weaknesses, simulate attacks, and verify defences before they impact your business.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-medium hover:bg-blue-500">Run Security Assessment <ArrowRight className="h-4 w-4" /></Link>
          <button onClick={demo} disabled={busy} className="rounded-lg border border-line bg-panel2 px-5 py-3 text-sm font-medium hover:bg-line disabled:opacity-60">{busy ? 'Opening demo...' : 'Explore Live Demo'}</button>
        </div>
        <p className="mt-4 max-w-2xl text-xs text-muted">A merchant-side security testing platform. It is not a PayPal approval system, does not predict real fraud, and is not endorsed or certified by PayPal. All attacks run in an isolated local simulator.</p>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-16 md:grid-cols-4">
        {FLOW.map(([Icon, t, d]: any, i) => (
          <div key={t} className="rounded-xl border border-line bg-panel p-5"><div className="mb-3 flex items-center justify-between"><Icon className="h-5 w-5 text-info" /><span className="text-xs text-muted">0{i + 1}</span></div><div className="font-medium">{t}</div><p className="mt-1 text-sm text-muted">{d}</p></div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><Bot className="h-5 w-5 text-info" />Multi-agent architecture</h2>
        <p className="mb-5 max-w-2xl text-sm text-muted">Agents propose; deterministic code executes and verifies. The Auditor is allowed to disagree with every other agent.</p>
        <div className="grid gap-3 md:grid-cols-3">
          {AGENTS.map(([n, d]) => <div key={n} className="rounded-xl border border-line bg-panel p-4"><div className="text-sm font-medium">{n} Agent</div><div className="mt-1 text-xs text-muted">{d}</div></div>)}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><Network className="h-5 w-5 text-info" />Compound attack discovery</h2>
        <p className="mb-5 max-w-2xl text-sm text-muted">Individually modest weaknesses combine. Example from the NovaCart demo simulation (reproduced by the simulator, not a real-world attack):</p>
        <div className="overflow-x-auto rounded-xl border border-line bg-panel p-6">
          <div className="flex min-w-[820px] items-stretch gap-3 text-sm">
            {[[Tag, 'Coupon stacking', 'SAVE20 + VIP15 + WELCOME10 applied together', 'text-warn'], [Copy, 'Refund at list price', 'Refund engine ignores the discount that was paid', 'text-orange-300'], [RotateCcw, 'Replayed refund', 'Same request pays out twice', 'text-bad']].map(([Icon, t, d, c]: any, i) => (
              <div key={t} className="flex flex-1 items-center gap-3"><div className="flex-1 rounded-lg border border-line bg-panel2 p-4"><Icon className={`mb-2 h-4 w-4 ${c}`} /><div className="font-medium">{t}</div><div className="mt-1 text-xs text-muted">{d}</div></div>{i < 2 && <ArrowRight className="h-4 w-4 text-muted" />}</div>
            ))}
            <ArrowRight className="mt-9 h-4 w-4 text-muted" />
            <div className="w-52 rounded-lg border border-bad/40 bg-bad/10 p-4"><div className="text-[11px] uppercase tracking-wide text-bad">Simulated outcome</div><div className="mt-1 text-sm">Merchant collects $126, refunds $200.</div><div className="mt-1 text-xs text-muted">Expected: keep $80. Excess: $154 / attack.</div></div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-20 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-panel p-6"><h3 className="mb-2 flex items-center gap-2 font-medium"><Wrench className="h-4 w-4 text-ok" />Automated defence, human approved</h3><p className="text-sm text-muted">Every fix arrives as a real code diff with a regression suite. The original attack is replayed after the fix, legitimate refunds are checked, and nothing is applied without approval - with one-click rollback.</p></div>
        <div className="rounded-xl border border-line bg-panel p-6"><h3 className="mb-2 flex items-center gap-2 font-medium"><CreditCard className="h-4 w-4 text-info" />PayPal Sandbox integration</h3><p className="text-sm text-muted">OAuth, Orders, captures, refunds and signature-verified webhooks with duplicate protection. Without credentials it runs in a clearly labelled local-simulation mode.</p></div>
      </section>
      <footer className="border-t border-line py-6 text-center text-xs text-muted">SellerShield AI · PayPal AI Hackathon 2026 prototype · Simulated figures are projections, not actual losses.</footer>
    </div>
  );
}
