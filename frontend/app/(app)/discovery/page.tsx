'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Sparkles, Telescope, Brain, Play, CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
import { api, useQuery, usd } from '../../../lib/api';
import { useApp } from '../../../components/app-context';
import { Card, Button, PageHeader, Notice, ErrorBox, StatusBadge, Spinner, SimTag } from '../../../components/ui';

const ENGINES = [
  { id: 'search', icon: Telescope, name: 'Guided search', tag: 'No AI needed', desc: 'Exhaustively tries every action sequence up to 5 steps (≈155,000) on the shop, replaying each on a secure baseline.' },
  { id: 'llm', icon: Brain, name: 'LLM attacker', tag: 'Groq LLM (Gemini optional, off)', desc: 'A free-tier or paid LLM drives the shop through function calls and improvises attack sequences. If the provider is rate-limited the app waits and retries; the deterministic search is always available. Its claims are never trusted: they are replayed and verified.' },
] as const;

export default function Discovery() {
  const { merchant, canWrite } = useApp();
  const cfg = useQuery<any>('/discovery/config');
  const runs = useQuery<any[]>(`/discovery?merchantId=${merchant.id}`);
  const [engine, setEngine] = useState<'search' | 'llm'>('search');
  const [rid, setRid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = useQuery<any>(rid ? `/discovery/${rid}` : null, 700);
  const logRef = useRef<HTMLDivElement>(null);
  const running = run.data?.status === 'running';
  useEffect(() => { if (run.data && run.data.status !== 'running') runs.refresh(); }, [run.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [run.data?.trace?.length]);
  useEffect(() => { if (!rid && runs.data?.length) setRid(runs.data[0].id); }, [runs.data, rid]);

  const start = async () => {
    setBusy(true); setErr('');
    try { const r = await api('/discovery/run', { body: { merchantId: merchant.id, engine, attempts: 2 } }); setRid(r.id); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const d = run.data;
  const llmOk = cfg.data?.llmConfigured;
  const novel = (d?.findings ?? []).filter((f: any) => f.novelty === 'novel');
  const known = (d?.findings ?? []).filter((f: any) => f.novelty === 'known');

  return (
    <div>
      <PageHeader title="Attack Discovery Lab" subtitle="Beyond the scripted scenarios: an attacker invents action sequences against the shop. Every sequence is replayed by deterministic code against a secure baseline before it counts." />
      <div className="mb-4"><Notice>Verification is independent of the attacker: replay on the vulnerable shop and on a fully-secure baseline, compare the money, check ledger invariants, replay twice for determinism. <b>Hallucinated attacks are rejected.</b> Runs only against the simulated NovaCart shop.</Notice></div>
      <div className="grid gap-4 md:grid-cols-2">
        {ENGINES.map((e) => {
          const disabled = e.id === 'llm' && !llmOk;
          return (
            <button key={e.id} disabled={disabled} onClick={() => setEngine(e.id)} className={clsx('rounded-xl border p-4 text-left transition', engine === e.id ? 'border-info bg-info/10' : 'border-line bg-panel hover:bg-panel2', disabled && 'cursor-not-allowed opacity-55')}>
              <div className="flex items-center gap-2"><e.icon className="h-5 w-5 text-info" /><span className="font-semibold">{e.name}</span><span className="ml-auto rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">{e.tag}</span></div>
              <p className="mt-2 text-sm text-muted">{e.desc}</p>
              {disabled && <p className="mt-2 text-xs text-warn">Unavailable: set GROQ_API_KEY in backend/.env (Gemini is disabled by default: its project needs billing). The tool-calling loop and failover have only been tested against local mock servers, not the live services.</p>}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={start} busy={busy || running} disabled={!canWrite || !merchant.isDemo || (engine === 'llm' && !llmOk)}><Play className="h-4 w-4" />{running ? 'Attacker running…' : 'Run discovery'}</Button>
        {d && <span className="text-xs text-muted">Last run: {d.engine} · <StatusBadge s={d.status === 'completed' ? 'completed' : d.status === 'failed' ? 'failed' : 'running'} />{d.stats?.appliedFixes?.length ? ` · against app with fixes: ${d.stats.appliedFixes.join(', ')}` : ' · against the unpatched app'}</span>}
      </div>
      {err && <div className="mt-3"><ErrorBox msg={err} /></div>}
      {!merchant.isDemo && <div className="mt-3"><Notice tone="warn">Discovery runs only against the controlled demo application.</Notice></div>}

      {d && (
        <div className="mt-6 space-y-4">
          <Card title="Attacker trace" action={d.stats?.evaluated ? <span className="text-xs text-muted">{d.stats.evaluated.toLocaleString()} sequences · {d.stats.ms} ms · {d.stats.distinctPatterns} loss patterns</span> : d.stats?.turns ? <span className="text-xs text-muted">{d.stats.turns} model turns · {(d.stats.providersUsed ?? []).join(', ') || 'no provider answered'}{d.stats.failovers?.length ? ` · failed over: ${d.stats.failovers.map((f: any) => f.provider + ' ' + f.reason).join('; ')}` : ''}</span> : undefined}>
            <div ref={logRef} className="max-h-60 overflow-auto rounded-lg border border-line bg-[#060a14] p-3 font-mono text-[11.5px] leading-5">
              {d.trace.map((t: any, i: number) => <div key={i} className={clsx(t.kind === 'verdict' && /REJECTED/.test(t.text) ? 'text-bad' : t.kind === 'verdict' ? 'text-ok' : t.kind === 'assistant' ? 'text-info' : t.kind === 'tool_call' ? 'text-warn' : 'text-muted')}><span className="text-line">{new Date(t.at).toLocaleTimeString()} </span>{t.kind === 'tool_call' ? '→ ' : t.kind === 'tool_result' ? '← ' : ''}{t.text}</div>)}
              {running && <div className="pulse-dot text-muted">…</div>}
            </div>
          </Card>
          {d.stats?.rejected?.length > 0 && <Notice tone="warn"><b>{d.stats.rejected.length} attacker claim(s) rejected by verification:</b> {d.stats.rejected.map((r: any) => `"${r.title}" (${r.reason})`).join('; ')}</Notice>}
          {d.status === 'completed' && d.findings.length === 0 && <Notice tone="ok">No verified loss found. {d.stats?.appliedFixes?.length ? 'The applied fixes hold against this attacker.' : ''}</Notice>}
          {novel.length > 0 && <Section title="Not in the scripted library" icon={<Sparkles className="h-4 w-4 text-info" />} findings={novel} />}
          {known.length > 0 && <Section title="Re-found known weaknesses" icon={<ShieldCheck className="h-4 w-4 text-muted" />} findings={known} />}
        </div>
      )}
      {!d && !runs.loading && <p className="mt-6 text-sm text-muted">Pick an engine and run discovery. Try the guided search first - it needs no credentials.</p>}
      {runs.loading && !runs.data && <Spinner />}
    </div>
  );
}

function Section({ title, icon, findings }: { title: string; icon: React.ReactNode; findings: any[] }) {
  return (
    <div>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">{icon}{title} <span className="text-xs font-normal text-muted">({findings.length})</span></h2>
      <div className="grid gap-3 lg:grid-cols-2">{findings.map((f, i) => <Finding key={i} f={f} />)}</div>
    </div>
  );
}

function Finding({ f }: { f: any }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={clsx('rounded-xl border bg-panel p-4', f.novelty === 'novel' ? 'border-info/40' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <div><div className="flex flex-wrap items-center gap-2"><span className={clsx('rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', f.novelty === 'novel' ? 'border-info/40 bg-info/10 text-info' : 'border-line text-muted')}>{f.novelty === 'novel' ? 'Novel' : 'Known'}</span><span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">{f.engine === 'llm' ? 'LLM' : 'search'}</span></div><div className="mt-1 text-sm font-semibold leading-snug">{f.title}</div></div>
        <div className="text-right"><div className="text-lg font-semibold tabular-nums text-warn">{usd(f.leakage)}</div><SimTag /></div>
      </div>
      <ol className="mt-3 space-y-1 text-xs">
        {f.steps.map((s: any, i: number) => <li key={i} className="flex gap-2"><span className="text-muted">{i + 1}.</span><span className="font-mono">{s.action.tool}{s.action.event ? ` ${s.action.event}` : ''}{s.action.actor ? ` (${s.action.actor})` : ''}</span><span className={s.ok ? 'text-muted' : 'text-bad'}>→ {s.ok ? Object.entries(s.info).filter(([k]) => ['total', 'status', 'refunded', 'refundedOnCancel', 'fulfilled', 'accepted', 'stockAfter'].includes(k)).map(([k, v]) => `${k} ${v}`).join(', ') || 'ok' : String((s.info as any).error)}</span></li>)}
      </ol>
      {f.blockedBy.length > 0 && <div className="mt-3 text-xs text-muted">Blocked by: {f.blockedBy.map((b: string[]) => <span key={b.join()} className="mr-1 rounded border border-ok/30 bg-ok/10 px-1.5 py-0.5 font-mono text-ok">{b.join(' + ')}</span>)} <Link href="/defence" className="text-info">Defence Center</Link></div>}
      <button className="mt-2 text-xs text-info" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} independent verification</button>
      {open && (
        <div className="mt-2 space-y-1 text-xs">
          {f.rationale && <p className="text-muted">{f.rationale}</p>}
          {f.verification.checks.map((c: any) => <div key={c.name} className="flex gap-1.5">{c.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad" />}<span>{c.name}<span className="block text-muted">{c.detail}</span></span></div>)}
        </div>
      )}
    </div>
  );
}
