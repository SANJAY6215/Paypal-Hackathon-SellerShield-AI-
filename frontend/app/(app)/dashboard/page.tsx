'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Activity, ArrowRight, ShieldAlert } from 'lucide-react';
import { useApp } from '../../../components/app-context';
import { useQuery, usd, when } from '../../../lib/api';
import { Card, Stat, SevBadge, StatusBadge, Spinner, ErrorBox, PageHeader, Button, SimTag, DemoTag, Empty } from '../../../components/ui';

export default function Dashboard() {
  const { merchant } = useApp();
  const router = useRouter();
  const { data: d, error, loading, reload } = useQuery<any>(`/dashboard?merchantId=${merchant.id}`, 5000);
  if (loading && !d) return <Spinner />;
  if (error && !d) return <ErrorBox msg={error} retry={reload} />;
  if (!d) return null;
  const score = d.posture.score as number;
  const tone = score >= 80 ? 'text-ok' : score >= 50 ? 'text-warn' : 'text-bad';
  const la = d.latestAssessment;
  return (
    <div>
      <PageHeader title="Security posture" subtitle={<>{merchant.name} · all figures come from stored assessment records{la?.isDemoData && <> · latest scan is <DemoTag /> produced by the simulator</>}.</>}
        actions={<Button onClick={() => router.push('/agents')}>Run assessment</Button>} />
      {!la && <Empty title="No assessment has been run yet" hint="Start one from the Agent Control Center." action={<Link href="/agents" className="text-sm text-info">Open Agent Control Center</Link>} />}
      {la && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-line bg-panel p-4 xl:row-span-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">Overall posture</div>
              <div className={`mt-3 text-6xl font-semibold tabular-nums ${tone}`}>{score}<span className="text-xl text-muted">/100</span></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-line"><div className={`h-full ${score >= 80 ? 'bg-ok' : score >= 50 ? 'bg-warn' : 'bg-bad'}`} style={{ width: `${score}%` }} /></div>
              <p className="mt-3 text-xs text-muted">{d.posture.method}</p>
            </div>
            <Stat label="Verified vulnerabilities" value={d.counts.verified} sub={`${d.counts.open} open · ${d.counts.rejected} claims rejected by Auditor`} />
            <Stat label="Critical (open)" value={d.counts.critical} tone={d.counts.critical ? 'bad' : 'ok'} />
            <Stat label="Resolved" value={d.counts.resolved} tone="ok" sub="fixed with verified defence" />
            <Stat label="Reintroduced" value={d.counts.reintroduced} tone={d.counts.reintroduced ? 'bad' : undefined} sub="regressions found by Attack Memory" />
            <Stat label="Compound attack chains" value={d.counts.chains} sub={`${d.counts.openChains} still exploitable`} tone={d.counts.openChains ? 'warn' : 'ok'} />
            <Stat label="Modelled exposure (expected, annual)" value={usd(d.exposure.expected)} sub={<span className="inline-flex items-center gap-1"><SimTag /> projection</span>} tone="warn" />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <Card title="Top open exposures" className="lg:col-span-2" action={<Link href="/vulnerabilities" className="text-xs text-info">All vulnerabilities</Link>}>
              {d.topOpen.length === 0 ? <p className="text-sm text-muted">No open vulnerabilities.</p> : (
                <table className="w-full text-sm"><tbody>
                  {d.topOpen.map((v: any) => (
                    <tr key={v.id} className="border-b border-line/60 last:border-0"><td className="py-2.5 pr-2"><Link href={`/vulnerabilities/${v.id}`} className="font-medium hover:text-info">{v.title}</Link><div className="text-xs text-muted">{v.testCaseId}</div></td><td><SevBadge s={v.severity} /></td><td className="text-right tabular-nums">{usd(v.expected)}</td></tr>
                  ))}
                </tbody></table>
              )}
              <p className="mt-3 text-xs text-muted">Chains overlap these weaknesses and are not added again. {d.exposure.note}</p>
            </Card>
            <Card title="Latest scan activity">
              <div className="space-y-2 text-sm">
                {d.recentAssessments.slice(0, 5).map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="truncate">{a.assessmentMode} scan {a.isDemoData && <DemoTag />}</div><div className="text-xs text-muted">{when(a.createdAt)}</div></div><StatusBadge s={a.status} /></div>
                ))}
              </div>
            </Card>
          </div>
          <Card className="mt-4" title={<span className="flex items-center gap-2"><Activity className="h-4 w-4 text-info" />Recent security events</span>}>
            {d.recentEvents.length === 0 ? <p className="text-sm text-muted">No events yet. Actions such as approving a patch or changing a business rule are audit-logged here.</p> : (
              <ul className="divide-y divide-line/60 text-sm">{d.recentEvents.map((e: any) => <li key={e.id} className="flex justify-between py-2"><span><ShieldAlert className="mr-2 inline h-3.5 w-3.5 text-muted" />{e.action} <span className="text-muted">· {e.resourceType}</span></span><span className="text-xs text-muted">{when(e.createdAt)}</span></li>)}</ul>
            )}
          </Card>
          <div className="mt-6 text-right"><Link href="/demo" className="inline-flex items-center gap-1 text-sm text-info">Run the guided live demo <ArrowRight className="h-4 w-4" /></Link></div>
        </>
      )}
    </div>
  );
}
