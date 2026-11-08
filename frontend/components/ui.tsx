'use client';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Loader2, Inbox } from 'lucide-react';
import React from 'react';

export const Card = ({ className, children, title, action, pad = true }: { className?: string; children: React.ReactNode; title?: React.ReactNode; action?: React.ReactNode; pad?: boolean }) => (
  <section className={clsx('min-w-0 rounded-xl border border-line bg-panel', className)}>
    {(title || action) && (
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
        {action}
      </header>
    )}
    <div className={pad ? 'p-4' : ''}>{children}</div>
  </section>
);

const sevStyle: Record<string, string> = {
  critical: 'bg-bad/15 text-bad border-bad/30', high: 'bg-orange-400/15 text-orange-300 border-orange-400/30',
  medium: 'bg-warn/15 text-warn border-warn/30', low: 'bg-info/15 text-info border-info/30',
};
export const SevBadge = ({ s }: { s: string }) => <span className={clsx('rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', sevStyle[s] || 'border-line text-muted')}>{s}</span>;

const statusStyle: Record<string, string> = {
  verified: 'bg-bad/10 text-bad border-bad/30', reintroduced: 'bg-bad/20 text-bad border-bad/50', fixed: 'bg-ok/10 text-ok border-ok/30', resolved: 'bg-ok/10 text-ok border-ok/30',
  rejected: 'bg-muted/10 text-muted border-line', detected: 'bg-warn/10 text-warn border-warn/30', mitigated: 'bg-ok/10 text-ok border-ok/30',
  proposed: 'bg-info/10 text-info border-info/30', approved: 'bg-info/20 text-info border-info/40', applied: 'bg-warn/10 text-warn border-warn/30', failed: 'bg-bad/10 text-bad border-bad/30',
  rolled_back: 'bg-muted/10 text-muted border-line', completed: 'bg-ok/10 text-ok border-ok/30', running: 'bg-info/10 text-info border-info/30', queued: 'bg-muted/10 text-muted border-line',
  passed: 'bg-ok/10 text-ok border-ok/30', idle: 'bg-muted/10 text-muted border-line', analysing: 'bg-info/10 text-info border-info/30', testing: 'bg-info/10 text-info border-info/30',
  finding_discovered: 'bg-warn/10 text-warn border-warn/30', verification_pending: 'bg-warn/10 text-warn border-warn/30',
};
export const StatusBadge = ({ s, label }: { s: string; label?: string }) => (
  <span className={clsx('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium', statusStyle[s] || 'border-line text-muted')}>
    {['analysing', 'testing', 'running'].includes(s) && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" />}
    {(label || s).replace(/_/g, ' ')}
  </span>
);

export const Button = ({ variant = 'primary', className, busy, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'ok'; busy?: boolean }) => (
  <button
    {...p} disabled={p.disabled || busy}
    className={clsx('inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50',
      variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-500', variant === 'ok' && 'bg-emerald-600 text-white hover:bg-emerald-500',
      variant === 'ghost' && 'border border-line bg-panel2 text-ink hover:bg-line', variant === 'danger' && 'bg-red-600/90 text-white hover:bg-red-500', className)}>
    {busy && <Loader2 className="h-4 w-4 animate-spin" />}{children}
  </button>
);

export const Stat = ({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'bad' | 'ok' | 'warn' | 'info' }) => (
  <div className="rounded-xl border border-line bg-panel p-4">
    <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
    <div className={clsx('mt-1.5 text-2xl font-semibold tabular-nums', tone === 'bad' && 'text-bad', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'info' && 'text-info')}>{value}</div>
    {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
  </div>
);

export const Spinner = ({ label = 'Loading' }: { label?: string }) => <div className="flex items-center gap-2 p-6 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{label}...</div>;
export const ErrorBox = ({ msg, retry }: { msg: string; retry?: () => void }) => (
  <div className="flex items-start gap-3 rounded-xl border border-bad/30 bg-bad/10 p-4 text-sm text-bad"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div className="flex-1">{msg}</div>{retry && <button className="underline" onClick={retry}>Retry</button>}</div>
);
export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) => (
  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line p-10 text-center"><Inbox className="h-6 w-6 text-muted" /><div className="text-sm font-medium">{title}</div>{hint && <div className="max-w-md text-xs text-muted">{hint}</div>}{action}</div>
);
export const Notice = ({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok'; children: React.ReactNode }) => (
  <div className={clsx('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs', tone === 'warn' ? 'border-warn/30 bg-warn/10 text-warn' : tone === 'ok' ? 'border-ok/30 bg-ok/10 text-ok' : 'border-info/30 bg-info/10 text-info')}>
    {tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}<div>{children}</div>
  </div>
);
export const Progress = ({ done, total }: { done: number; total: number }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-info transition-all duration-500" style={{ width: total ? `${Math.min(100, (done / total) * 100)}%` : '0%' }} /></div>
);
export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-semibold tracking-tight">{title}</h1>{subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}</div><div className="flex flex-wrap gap-2">{actions}</div></div>
);

export function DiffView({ patch }: { patch: string }) {
  const lines = patch.split('\n').filter((l) => !l.startsWith('Index:') && !l.startsWith('====='));
  return (
    <pre className="max-h-[420px] overflow-auto rounded-lg border border-line bg-[#060a14] p-3 font-mono text-[12px] leading-5">
      {lines.map((l, i) => (
        <div key={i} className={clsx('whitespace-pre', l.startsWith('+') && !l.startsWith('+++') && 'bg-ok/10 text-ok', l.startsWith('-') && !l.startsWith('---') && 'bg-bad/10 text-bad', l.startsWith('@@') && 'text-info', (l.startsWith('---') || l.startsWith('+++')) && 'text-muted')}>{l || ' '}</div>
      ))}
    </pre>
  );
}

export const Json = ({ v }: { v: unknown }) => <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-[#060a14] p-3 font-mono text-[11.5px] leading-5 text-muted">{JSON.stringify(v, null, 2)}</pre>;
export const SimTag = () => <span className="rounded border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn">Simulation</span>;
export const DemoTag = () => <span className="rounded border border-info/30 bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-info">Demo data</span>;
