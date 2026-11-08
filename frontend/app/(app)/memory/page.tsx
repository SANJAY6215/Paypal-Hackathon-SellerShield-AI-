'use client';
import { useState } from 'react';
import Link from 'next/link';
import { RefreshCw, AlertOctagon } from 'lucide-react';
import { api, useQuery, when } from '../../../lib/api';
import { useApp } from '../../../components/app-context';
import { Card, Button, StatusBadge, SevBadge, Spinner, ErrorBox, PageHeader, Notice, Empty, DemoTag } from '../../../components/ui';

export default function Memory() {
  const { merchant, canWrite } = useApp();
  const { data: d, error, loading, reload, refresh } = useQuery<any>(`/memory?merchantId=${merchant.id}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (loading && !d) return <Spinner />;
  if (error) return <ErrorBox msg={error} retry={reload} />;
  if (!d) return null;
  const rerun = async () => {
    setBusy(true); setMsg('');
    try {
      const { assessmentId } = await api(`/merchants/${merchant.id}/rerun`, { body: {} });
      for (let i = 0; i < 100; i++) { const s = await api(`/assessments/${assessmentId}/status`); if (s.status !== 'running' && s.status !== 'queued') { const c = s.summary?.classification; setMsg(`Regression run finished: ${c?.reintroduced ?? 0} reintroduced, ${c?.resolved ?? 0} newly resolved, ${c?.known ?? 0} still open, ${c?.newChains ?? 0} chain(s) reopened.`); break; } await new Promise((r) => setTimeout(r, 400)); }
      await refresh();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  const regress = d.vulnerabilities.filter((v: any) => v.status === 'reintroduced');
  const cnt = (s: string[]) => d.vulnerabilities.filter((v: any) => s.includes(v.status)).length;
  return (
    <div>
      <PageHeader title="Attack Memory" subtitle="A per-merchant knowledge base of every finding, attack sequence, fix and regression test. When a business-rule change re-opens a fixed weakness, it is flagged here."
        actions={canWrite && <Button onClick={rerun} busy={busy}><RefreshCw className="h-4 w-4" />Rerun previous tests</Button>} />
      {msg && <div className="mb-4"><Notice tone="ok">{msg}</Notice></div>}
      {regress.length > 0 && (
        <div className="mb-4 rounded-xl border border-bad/40 bg-bad/10 p-4"><div className="flex items-center gap-2 font-medium text-bad"><AlertOctagon className="h-4 w-4" />{regress.length} reintroduced vulnerabilit{regress.length > 1 ? 'ies' : 'y'}</div>
          <ul className="mt-2 text-sm">{regress.map((v: any) => <li key={v.id}><Link className="underline" href={`/vulnerabilities/${v.id}`}>{v.testCaseId} - {v.title}</Link> <span className="text-muted">- previously fixed, reproduces again. Check Merchant Setup business rules.</span></li>)}</ul></div>
      )}
      <div className="mb-6 grid gap-3 md:grid-cols-5 text-center">
        {[['Open / known', cnt(['verified']), 'text-warn'], ['Previously fixed', cnt(['fixed']), 'text-ok'], ['Resolved', cnt(['resolved']), 'text-ok'], ['Reintroduced', cnt(['reintroduced']), 'text-bad'], ['Chains stored', d.chains.length, 'text-info']].map(([l, n, c]: any) => <div key={l} className="rounded-xl border border-line bg-panel p-3"><div className={`text-2xl font-semibold tabular-nums ${c}`}>{n}</div><div className="text-xs text-muted">{l}</div></div>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Stored vulnerabilities and test cases" pad={false}>
          {d.vulnerabilities.length === 0 ? <div className="p-4"><Empty title="Nothing stored yet" /></div> : <table className="w-full text-sm"><tbody>{d.vulnerabilities.map((v: any) => <tr key={v.id} className="border-t border-line/60 first:border-0"><td className="px-4 py-2.5"><Link className="hover:text-info" href={`/vulnerabilities/${v.id}`}>{v.title}</Link><div className="font-mono text-xs text-muted">{v.testCaseId}</div></td><td><SevBadge s={v.severity} /></td><td className="pr-4 text-right"><StatusBadge s={v.status} /></td></tr>)}</tbody></table>}
        </Card>
        <Card title="Scan history (new / known / resolved / reintroduced)">
          {d.history.length === 0 ? <p className="text-sm text-muted">No completed scans.</p> : <ul className="space-y-2 text-sm">{d.history.map((h: any) => <li key={h.id} className="flex items-center justify-between gap-2 border-b border-line/60 pb-2 last:border-0"><div><span className="capitalize">{h.mode}</span> scan {h.isDemoData && <DemoTag />}<div className="text-xs text-muted">{when(h.at)}</div></div><div className="flex gap-2 text-xs tabular-nums">{h.classification && <><span className="text-info">{h.classification.new} new</span><span className="text-warn">{h.classification.known} known</span><span className="text-ok">{h.classification.resolved} resolved</span><span className="text-bad">{h.classification.reintroduced} reintro.</span><span>{h.classification.newChains} chains</span></>}</div></li>)}</ul>}
        </Card>
        <Card title="Attack chains" pad={false}>
          {d.chains.map((c: any) => <div key={c.id} className="flex items-center justify-between border-t border-line/60 px-4 py-2.5 text-sm first:border-0"><div>{c.title}<div className="font-mono text-xs text-muted">{c.signature}</div></div><StatusBadge s={c.status} /></div>)}
          {d.chains.length === 0 && <div className="p-4 text-sm text-muted">None stored.</div>}
        </Card>
        <Card title="Remediation history and regression tests" pad={false}>
          {d.defences.length === 0 ? <div className="p-4 text-sm text-muted">No defences yet.</div> : d.defences.map((x: any) => <div key={x.id} className="border-t border-line/60 px-4 py-2.5 text-sm first:border-0"><div className="flex items-center justify-between"><span>{x.vulnerability.testCaseId} · <span className="font-mono text-xs">{x.fixId}</span></span><StatusBadge s={x.status} /></div><div className="text-xs text-muted">{x.tests.length ? `${x.tests.filter((t: any) => t.status === 'passed').length}/${x.tests.length} regression tests passed` : 'no tests run'}{x.appliedAt && ` · applied ${when(x.appliedAt)}`}{x.rolledBackAt && ` · rolled back ${when(x.rolledBackAt)}`}</div></div>)}
        </Card>
      </div>
      <Card className="mt-4" title="Event timeline (latest 100)" pad={false}>
        <div className="max-h-80 overflow-auto"><table className="w-full text-xs"><tbody>{d.memories.map((m: any) => <tr key={m.id} className="border-t border-line/50 first:border-0"><td className="whitespace-nowrap px-4 py-1.5 text-muted">{when(m.createdAt)}</td><td className="capitalize">{m.kind}</td><td className="font-mono">{m.vulnerability?.testCaseId ?? m.attackChain?.signature ?? ''}</td><td className={m.result === 'reproduced' || m.result === 'reintroduced' ? 'text-bad' : m.result === 'blocked' || m.result === 'passed' || m.result === 'resolved' ? 'text-ok' : ''}>{m.result}</td><td className="pr-4 text-muted">{m.note}</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
}
