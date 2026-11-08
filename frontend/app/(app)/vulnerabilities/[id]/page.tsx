'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Play, Wrench, FileDiff, FlaskConical, CheckCheck, ArrowLeft } from 'lucide-react';
import { api, useQuery, usd } from '../../../../lib/api';
import { useApp } from '../../../../components/app-context';
import { Card, SevBadge, StatusBadge, Button, Spinner, ErrorBox, DiffView, Notice, SimTag, Json } from '../../../../components/ui';

export default function VulnDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { canWrite } = useApp();
  const { data: v, error, loading, reload } = useQuery<any>(`/vulnerabilities/${id}`);
  const [repro, setRepro] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  if (loading && !v) return <Spinner />;
  if (error) return <ErrorBox msg={error} retry={reload} />;
  if (!v) return null;
  const def = v.defences?.[0];
  const act = async (k: string, fn: () => Promise<any>) => { setBusy(k); setErr(''); try { await fn(); await reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } };
  const ex = v.exposure;
  return (
    <div>
      <Link href="/vulnerabilities" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-ink"><ArrowLeft className="h-3 w-3" />All vulnerabilities</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><div className="mb-1 flex flex-wrap items-center gap-2"><SevBadge s={v.severity} /><StatusBadge s={v.status} /><span className="font-mono text-xs text-muted">{v.testCaseId}</span><span className="text-xs capitalize text-muted">· {v.category}</span></div><h1 className="text-xl font-semibold">{v.title}</h1><p className="mt-1 max-w-3xl text-sm text-muted">{v.description}</p></div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" busy={busy === 'rep'} onClick={() => act('rep', async () => setRepro(await api(`/vulnerabilities/${id}/reproduce`, { body: {} })))}><Play className="h-4 w-4" />Reproduce</Button>
            {v.hasAutomatedFix && !def && v.status !== 'rejected' && <Button busy={busy === 'fix'} onClick={() => act('fix', () => api(`/vulnerabilities/${id}/generate-fix`, { body: {} }))}><Wrench className="h-4 w-4" />Generate defence</Button>}
            {def && <Button variant="ghost" onClick={() => setShowDiff(!showDiff)}><FileDiff className="h-4 w-4" />View code diff</Button>}
            {def && <Button variant="ghost" onClick={() => router.push('/defence')}><FlaskConical className="h-4 w-4" />Regression tests</Button>}
            {v.status === 'fixed' && <Button variant="ok" busy={busy === 'res'} onClick={() => act('res', () => api(`/vulnerabilities/${id}/resolve`, { body: {} }))}><CheckCheck className="h-4 w-4" />Mark resolved</Button>}
          </div>
        )}
      </div>
      {err && <div className="mb-4"><ErrorBox msg={err} /></div>}
      {v.status === 'reintroduced' && <div className="mb-4"><Notice tone="warn"><b>Regression:</b> this vulnerability was previously fixed and reproduces again. A business-rule change probably disabled the fix. {v.auditorNote}</Notice></div>}
      {repro && <div className="mb-4"><Notice tone={repro.exploited ? 'warn' : 'ok'}>{repro.label}: attack {repro.exploited ? <b>SUCCEEDED</b> : <b>BLOCKED</b>} against the current app state (applied fixes: {repro.appliedFixes.join(', ') || 'none'}). Excess: {usd(repro.leakage)}.</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Root cause"><p className="text-sm">{v.rootCause}</p><div className="mt-3 text-xs text-muted">Affected business rule: <span className="text-ink">{v.businessRule}</span> · Confidence {Math.round(v.confidence * 100)}% · Agent: {v.agentType}</div></Card>
          <Card title="Reproduction steps">
            <ol className="list-decimal space-y-1 pl-5 text-sm">{(v.reproductionSteps as string[]).map((s) => <li key={s}>{s}</li>)}</ol>
            {v.scenario && <div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-lg border border-ok/20 bg-ok/5 p-3 text-xs"><div className="mb-1 font-medium text-ok">Expected secure behaviour</div>{v.scenario.expectedSecure}</div><div className="rounded-lg border border-bad/20 bg-bad/5 p-3 text-xs"><div className="mb-1 font-medium text-bad">Vulnerable behaviour</div>{v.scenario.vulnerableBehaviour}</div></div>}
          </Card>
          <Card title="Evidence from execution">
            <div className="space-y-3">{(v.evidence as any[]).map((e) => (
              <div key={e.n} className="rounded-lg border border-line bg-panel2 p-3 text-sm"><div className="font-medium">Step {e.n}: {e.action}</div><div className="mt-1 grid gap-1 text-xs md:grid-cols-2"><div><span className="text-muted">Expected: </span>{e.expected}</div><div><span className="text-muted">Actual: </span><span className="text-bad">{e.actual}</span></div></div>{e.evidence && Object.keys(e.evidence).length > 0 && <div className="mt-2"><Json v={e.evidence} /></div>}</div>))}</div>
            <p className="mt-3 text-xs text-muted">Auditor: {v.auditorNote}</p>
          </Card>
          {showDiff && def && <Card title="Proposed patch (diff)"><DiffView patch={def.patch} /></Card>}
        </div>
        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-2">Financial exposure <SimTag /></span>}>
            {ex ? (
              <div className="space-y-3 text-sm"><div className="text-xs text-muted">{ex.label}</div>
                <div className="flex justify-between"><span className="text-muted">Excess per successful attack</span><b>{usd(ex.perAttack)}</b></div>
                <table className="w-full text-xs"><thead className="text-muted"><tr><th className="text-left"></th><th>Attacks/yr</th><th className="text-right">Exposure</th></tr></thead><tbody>
                  {(['low', 'expected', 'high'] as const).map((k) => <tr key={k} className="border-t border-line/60"><td className="py-1.5 capitalize">{k}</td><td className="text-center tabular-nums">{ex.attacks[k]}</td><td className="text-right tabular-nums">{usd(ex.exposure[k])}</td></tr>)}
                </tbody></table>
                <div className="text-[11px] text-muted"><div className="mb-1 font-medium">Formula</div>{ex.formula}</div>
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted">{ex.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul>
                <div className="text-[11px]">Confidence: <b className="capitalize">{ex.confidence.level}</b> - {ex.confidence.reason}</div>
              </div>) : <p className="text-sm text-muted">No exposure computed.</p>}
          </Card>
          <Card title="Related attack chains">
            {v.chains.length === 0 ? <p className="text-sm text-muted">Not part of a verified chain.</p> : <ul className="space-y-2 text-sm">{v.chains.map((c: any) => <li key={c.id}><Link className="hover:text-info" href="/attack-chains">{c.title}</Link> <StatusBadge s={c.status} /></li>)}</ul>}
          </Card>
          <Card title="Recommended defence">
            {def ? <div className="space-y-2 text-sm"><p>{def.proposedFix}</p><StatusBadge s={def.status} /><div><Link href="/defence" className="text-xs text-info">Review in Defence Center</Link></div></div> : <p className="text-sm text-muted">{v.hasAutomatedFix ? 'No defence generated yet.' : 'No automated patch for this finding.'}</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
