'use client';
import { useState } from 'react';
import { FileText, FileJson, Download } from 'lucide-react';
import { api, useQuery, when } from '../../../lib/api';
import { useApp } from '../../../components/app-context';
import { Card, Button, Spinner, ErrorBox, PageHeader, Empty, Notice } from '../../../components/ui';

export default function Reports() {
  const { merchant } = useApp();
  const list = useQuery<any[]>('/reports');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [view, setView] = useState<any>(null);
  const gen = async () => { setBusy(true); setErr(''); try { const r = await api('/reports', { body: { merchantId: merchant.id } }); await list.refresh(); setView((await api(`/reports/${r.id}`)).content); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const open = async (id: string) => setView((await api(`/reports/${id}`)).content);
  const mine = (list.data ?? []).filter((r) => r.merchantId === merchant.id);
  return (
    <div>
      <PageHeader title="Reports" subtitle="Downloadable security assessment: scope, vulnerabilities, compound chains, evidence, exposure, fixes, regression results and PayPal integration results." actions={<Button onClick={gen} busy={busy}><FileText className="h-4 w-4" />Generate report</Button>} />
      {err && <ErrorBox msg={err} />}
      {list.loading && !list.data && <Spinner />}
      {list.data && mine.length === 0 && <Empty title="No reports yet" hint="Generate one after running an assessment." />}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2">
          {mine.map((r) => (
            <Card key={r.id}><div className="text-sm font-medium">{r.title}</div><div className="mb-3 text-xs text-muted">{when(r.createdAt)}</div>
              <div className="flex flex-wrap gap-2"><Button variant="ghost" className="!px-2.5 !py-1.5 text-xs" onClick={() => open(r.id)}>Preview</Button>
                <a className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs hover:bg-line" href={`/api/reports/${r.id}/download?format=pdf`}><Download className="h-3.5 w-3.5" />PDF</a>
                <a className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs hover:bg-line" href={`/api/reports/${r.id}/download`}><FileJson className="h-3.5 w-3.5" />JSON</a></div></Card>
          ))}
        </div>
        {view && (
          <Card title={`Report preview - ${view.merchant.name}`}>
            <div className="space-y-4 text-sm">
              <Notice tone="warn">{view.disclaimer}</Notice>
              <div><div className="text-xs font-medium uppercase tracking-wide text-muted">Scope</div><p>{view.scope.statement}</p></div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5 text-center">{[['Posture', view.summary.postureScore], ['Open', view.summary.open], ['Fixed/Resolved', view.summary.fixedOrResolved], ['Reintroduced', view.summary.reintroduced], ['Chains', view.summary.compoundChains]].map(([l, n]) => <div key={l as string} className="rounded-lg border border-line bg-panel2 p-3"><div className="text-xl font-semibold tabular-nums">{n}</div><div className="text-xs text-muted">{l}</div></div>)}</div>
              <div><div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Vulnerabilities</div>{view.vulnerabilities.map((v: any) => <div key={v.testCaseId} className="border-t border-line/60 py-2"><div className="font-medium">{v.testCaseId} - {v.title} <span className="text-xs text-muted">[{v.severity}, {v.status}]</span></div><div className="text-xs text-muted">{v.rootCause}</div></div>)}</div>
              <div><div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Attack chains</div>{view.attackChains.map((c: any) => <div key={c.signature} className="border-t border-line/60 py-2"><div className="font-medium">{c.title} <span className="text-xs text-muted">[{c.severity}, {c.status}]</span></div><div className="text-xs text-muted">{c.description}</div></div>)}</div>
              <div className="text-xs text-muted">PayPal: {view.paypalIntegration.label} · {view.paypalIntegration.transactions.length} transaction(s), {view.paypalIntegration.webhookEvents.length} webhook event(s).</div>
            </div>
          </Card>)}
      </div>
    </div>
  );
}
