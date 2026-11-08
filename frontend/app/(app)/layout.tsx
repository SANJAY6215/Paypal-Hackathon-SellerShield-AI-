'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { LayoutDashboard, Store, Bot, Network, Bug, ShieldCheck, LineChart, History, CreditCard, FileText, PlayCircle, LogOut, ShieldHalf, FlaskConical, Telescope } from 'lucide-react';
import { AppProvider, useApp } from '../../components/app-context';
import { api } from '../../lib/api';

const NAV = [
  { href: '/demo', label: 'Live Demo', icon: PlayCircle },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/merchant', label: 'Merchant Setup', icon: Store },
  { href: '/agents', label: 'Agent Control Center', icon: Bot },
  { href: '/attack-chains', label: 'Attack Chains', icon: Network },
  { href: '/discovery', label: 'Discovery Lab', icon: Telescope },
  { href: '/vulnerabilities', label: 'Vulnerabilities', icon: Bug },
  { href: '/defence', label: 'Defence Center', icon: ShieldCheck },
  { href: '/financial', label: 'Financial Impact', icon: LineChart },
  { href: '/memory', label: 'Attack Memory', icon: History },
  { href: '/paypal', label: 'PayPal Integration', icon: CreditCard },
  { href: '/reports', label: 'Reports', icon: FileText },
];

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { user, merchants, merchant, setMerchantId, health } = useApp();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-panel/60 md:flex">
        <Link href="/" className="flex items-center gap-2 px-5 py-4"><ShieldHalf className="h-6 w-6 text-info" /><div><div className="text-sm font-semibold leading-tight">SellerShield AI</div><div className="text-[10px] uppercase tracking-widest text-muted">Attack · Defend · Verify</div></div></Link>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = path === href || (href !== '/dashboard' && path.startsWith(href));
            return <Link key={href} href={href} className={clsx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors', active ? 'bg-blue-600/15 text-white ring-1 ring-blue-500/30' : 'text-muted hover:bg-panel2 hover:text-ink')}><Icon className="h-4 w-4" />{label}</Link>;
          })}
        </nav>
        <div className="border-t border-line p-3 text-xs text-muted">
          <div className="truncate font-medium text-ink">{user.name}</div><div className="mb-2 truncate">{user.email} · {user.role}</div>
          <button className="flex items-center gap-2 hover:text-ink" onClick={async () => { await api('/auth/logout', { method: 'POST', body: {} }); router.replace('/'); }}><LogOut className="h-3.5 w-3.5" />Sign out</button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur md:px-8">
          <select aria-label="Merchant" value={merchant.id} onChange={(e) => setMerchantId(e.target.value)} className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm">
            {merchants.map((m) => <option key={m.id} value={m.id}>{m.name}{m.isDemo ? ' (demo)' : ''}</option>)}
          </select>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {merchant.isDemo && <span className="inline-flex items-center gap-1 rounded-md border border-info/30 bg-info/10 px-2 py-1 text-info"><FlaskConical className="h-3 w-3" />Controlled sample application</span>}
            <span className={clsx('rounded-md border px-2 py-1', health?.paypalMode === 'sandbox' ? 'border-ok/30 bg-ok/10 text-ok' : 'border-warn/30 bg-warn/10 text-warn')}>{health?.paypalMode === 'sandbox' ? 'PayPal Sandbox connected' : 'PayPal: DEMO MODE (local simulation)'}</span>
            <span className={clsx('rounded-md border px-2 py-1', health?.ai.configured ? 'border-ok/30 bg-ok/10 text-ok' : 'border-line bg-panel text-muted')}>{health?.ai.configured ? `AI-assisted: ${health.ai.provider}` : 'AI: deterministic mode (no API key)'}</span>
          </div>
          <nav className="flex w-full gap-1 overflow-x-auto md:hidden">{NAV.map(({ href, label }) => <Link key={href} href={href} className={clsx('whitespace-nowrap rounded-md px-2.5 py-1 text-xs', path.startsWith(href) ? 'bg-blue-600/20 text-white' : 'text-muted')}>{label}</Link>)}</nav>
        </header>
        <main className="mx-auto max-w-[1280px] px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppProvider><Shell>{children}</Shell></AppProvider>;
}
