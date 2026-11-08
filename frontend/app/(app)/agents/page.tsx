'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Bot, Play, ChevronDown, ChevronRight, CheckCircle2, XCircle, Search } from 'lucide-react';
import { useApp } from '../../../components/app-context';
import { api, useQuery, when } from '../../../lib/api';
import { Card, StatusBadge, Progress, Button, PageHeader, Spinner, ErrorBox, Notice, SevBadge, DemoTag } from '../../../components/ui';

const META: Record<string, { name: string; resp: string; accent: string }> = {
  opportunist: { name: 'Opportunist', resp: 'Discounts, promotions, pricing and coupon rules', accent: 'text-warn' },
  'refund-abuse': { name: 'Refund Abuse', resp: 'Refund, cancellation and return workflows', accent: 'text-orange-300' },
  'payment-manipulation': { name: 'Payment Manipulation', resp: 'Payment state, idempotency, webhooks, concurrent checkout', accent: 'text-info' },
  'insider-threat': { name: 'Insider Threat', resp: 'Role separation, approvals, audit records', accent: 'text-bad' },
  'defence-architect': { name: 'Defence Architect', resp: 'Root cause, patch, regression tests, trade-offs', accent: 'text-ok' },
  auditor: { name: 'Independent Auditor', resp: 'Reproduces every claim; may reject; tests defences', accent: 'text-violet-300' },
};
const ORDER = ['opportunist', 'refund-abuse', 'payment-manipulation', 'insider-threat', 'defence-architect', 'auditor'];
const STAGES = ['queued', 'investigating', 'correlating', 'verifying', 'defending', 'auditing', 'completed'];

export default function Agents() {
  const { merchant, canWrite } = useApp();
  const [aid, setAid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery<{ items: any[] }>(`/assessments?merchantId=${merchant.id}&limit=10`);
  useEffect(() => { const first = list.data?.items.find((a) => a.assessmentMode !== 'regression'); if (first && !aid) setAid(first.id); }, [list.data, aid]);
  const st = useQuery<any>(aid ? `/assessments/${aid}/status` : null, 900);
  const running = st.data?.status === 'running' || st.data?.status === 'queued';

  const start = async () => {
    setBusy(true); setErr('');
    try {
      const a = await api('/assessments', { body: { merchantId: merchant.id, mode: 'demo', start: true } });
      setAid(a.id); list.refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const stage = st.data?.summary?.stage as string | undefined;
  const agents: any[] = st.data ? ORDER.map((t) => st.data.agents.find((a: any) => a.agentType === t)).filter(Boolean) : [];

  return (
    <div>
      <PageHeader title="Agent Control Center" subtitle="Six specialised agents. Status, tasks and progress come from the backend job record (polled once per second) - nothing here is animated client-side."
        actions={<Button onClick={start} busy={busy || running} disabled={!canWrite || !merchant.isDemo}><Play className="h-4 w-4" />{running ? 'Assessment running' : 'Start new scan'}</Button>} />
      {!merchant.isDemo && <Notice tone="warn">Agent attack simulation runs only against the controlled sample application. Select the demo merchant, or use website analysis on Merchant Setup.</Notice>}
      {err && <ErrorBox msg={err} />}
      {list.loading && !list.data && <Spinner />}
      {st.data && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
            <StatusBadge s={st.data.status} />{st.data.isDemoData && <DemoTag />}
            <span>Started {when(st.data.startedAt)}</span>
            {st.data.summary?.aiMode && <span className="rounded border border-line px-2 py-0.5">{st.data.summary.aiMode === 'ai-assisted' ? `AI-assisted (${st.data.summary.aiProvider})` : 'deterministic planner'}</span>}
          </div>
          <ol className="mb-5 flex flex-wrap gap-1.5 text-[11px]">
            {STAGES.map((s) => { const idx = STAGES.indexOf(stage || 'queued'); const me = STAGES.indexOf(s); return <li key={s} className={clsx('rounded-full border px-2.5 py-1 capitalize', me < idx || stage === 'completed' ? 'border-ok/30 bg-ok/10 text-ok' : me === idx ? 'border-info/40 bg-info/10 text-info' : 'border-line text-muted')}>{s}</li>; })}
          </ol>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {agents.map((a) => {
              const m = META[a.agentType];
              const o = a.output;
              const isOpen = open === a.id;
              return (
                <Card key={a.id} pad={false} className={clsx(['analysing', 'testing', 'finding_discovered'].includes(a.status) && 'ring-1 ring-info/40')}>
                  <div className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2"><div className="flex items-center gap-2"><Bot className={clsx('h-5 w-5', m.accent)} /><div><div className="text-sm font-semibold">{m.name} Agent</div><div className="text-xs text-muted">{m.resp}</div></div></div><StatusBadge s={a.status} /></div>
                    <div className="min-h-[2.5rem] text-sm text-muted">{a.task}</div>
                    <div><div className="mb-1 flex justify-between text-[11px] text-muted"><span>Progress</span><span className="tabular-nums">{a.progress.done}/{a.progress.total || '-'}</span></div><Progress done={a.progress.done} total={a.progress.total} /></div>
                    {o?.findings && (
                      <div className="space-y-1.5 border-t border-line pt-3">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Findings ({o.findings.length})</div>
                        {o.findings.map((f: any) => <div key={f.testCaseId} className="flex items-center justify-between gap-2 text-xs"><span className="truncate"><span className="font-mono text-muted">{f.testCaseId}</span> {f.title}</span><SevBadge s={f.severity} /></div>)}
                        {o.cleared?.length > 0 && <div className="flex items-start gap-1.5 text-[11px] text-muted"><CheckCircle2 className="mt-0.5 h-3 w-3 text-ok" />Controls held: {o.cleared.map((c: any) => c.testCaseId).join(', ')}</div>}
                        {o.rejectedHypotheses?.map((h: any) => <div key={h.testCaseId} className="flex items-start gap-1.5 text-[11px] text-bad"><XCircle className="mt-0.5 h-3 w-3" />Hypothesis {h.testCaseId} rejected: {h.reason}</div>)}
                      </div>
                    )}
                    {o?.verdicts && (
                      <div className="space-y-1 border-t border-line pt-3 text-xs">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Audit verdicts</div>
                        {Object.entries(o.verdicts).map(([k, v]: any) => <div key={k} className="flex items-center justify-between"><span className="font-mono text-muted">{k}</span><span className={v.verdict === 'verified' ? 'text-ok' : 'text-bad'}>{v.verdict}</span></div>)}
                      </div>
                    )}
                    {o?.defences && <div className="border-t border-line pt-3 text-xs text-muted">{o.defences.length} defence proposal(s) generated · {o.defences.filter((d: any) => d.dryRunPassed).length} passed sandbox dry-run</div>}
                  </div>
                  <button onClick={() => setOpen(isOpen ? null : a.id)} className="flex w-full items-center gap-1.5 border-t border-line px-4 py-2 text-xs text-muted hover:text-ink">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}Execution history ({a.history.length})</button>
                  {isOpen && <ul className="max-h-56 space-y-1 overflow-auto border-t border-line bg-bg/50 px-4 py-3 font-mono text-[11px] text-muted">{a.history.map((h: any, i: number) => <li key={i}><span className="text-line">{new Date(h.at).toLocaleTimeString()}</span> {h.msg}</li>)}</ul>}
                </Card>
              );
            })}
          </div>
          {st.data.status === 'completed' && <p className="mt-6 flex items-center gap-2 text-sm text-muted"><Search className="h-4 w-4" />Scan complete: {st.data.summary?.classification?.new ?? 0} new, {st.data.summary?.classification?.known ?? 0} known, {st.data.summary?.classification?.resolved ?? 0} resolved, {st.data.summary?.classification?.reintroduced ?? 0} reintroduced, {st.data.summary?.classification?.newChains ?? 0} new chain(s).</p>}
        </>
      )}
      {!st.data && !list.loading && <Notice>No assessment yet. Press &ldquo;Start new scan&rdquo; to dispatch tasks to the six agents.</Notice>}
    </div>
  );
}
