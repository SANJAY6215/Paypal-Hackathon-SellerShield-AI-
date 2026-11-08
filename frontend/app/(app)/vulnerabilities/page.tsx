'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '../../../components/app-context';
import { useQuery, usd } from '../../../lib/api';
import { Card, SevBadge, StatusBadge, Spinner, ErrorBox, Empty, PageHeader } from '../../../components/ui';

function List() {
  const { merchant } = useApp();
  const router = useRouter();
  const focus = useSearchParams().get('focus');
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(1);
  const q = `/vulnerabilities?merchantId=${merchant.id}&limit=20&page=${page}${status ? `&status=${status}` : ''}${severity ? `&severity=${severity}` : ''}`;
  const { data, error, loading, reload } = useQuery<{ items: any[]; total: number }>(q);
  useEffect(() => { if (focus && data) { const v = data.items.find((x) => x.testCaseId === focus); if (v) router.replace(`/vulnerabilities/${v.id}`); } }, [focus, data, router]);
  const sel = 'rounded-lg border border-line bg-panel px-3 py-1.5 text-sm';
  return (
    <div>
      <PageHeader title="Vulnerabilities" subtitle="Only findings that passed independent deterministic reproduction are shown as verified. Rejected claims stay visible for transparency." />
      <div className="mb-4 flex gap-2">
        <select className={sel} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status filter"><option value="">All statuses</option>{['verified', 'fixed', 'resolved', 'reintroduced', 'rejected'].map((s) => <option key={s}>{s}</option>)}</select>
        <select className={sel} value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} aria-label="Severity filter"><option value="">All severities</option>{['critical', 'high', 'medium', 'low'].map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      {loading && !data && <Spinner />}
      {error && <ErrorBox msg={error} retry={reload} />}
      {data && data.items.length === 0 && <Empty title="No vulnerabilities match" hint="Run an assessment from the Agent Control Center." />}
      {data && data.items.length > 0 && (
        <Card pad={false}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">Vulnerability</th><th>Category</th><th>Severity</th><th>Status</th><th>Confidence</th><th className="text-right">Exp. exposure (sim.)</th><th className="px-4">Defence</th></tr></thead>
            <tbody>{data.items.map((v) => (
              <tr key={v.id} className="border-t border-line/70 hover:bg-panel2/60">
                <td className="px-4 py-3"><Link href={`/vulnerabilities/${v.id}`} className="font-medium hover:text-info">{v.title}</Link><div className="font-mono text-xs text-muted">{v.testCaseId}{v.lifecycle === 'reintroduced' && <span className="ml-2 text-bad">reintroduced</span>}</div></td>
                <td className="capitalize text-muted">{v.category}</td><td><SevBadge s={v.severity} /></td><td><StatusBadge s={v.status} /></td>
                <td className="tabular-nums">{Math.round(v.confidence * 100)}%</td><td className="text-right tabular-nums">{usd(v.exposure?.exposure?.expected)}</td>
                <td className="px-4">{v.defences[0] ? <StatusBadge s={v.defences[0].status} /> : <span className="text-xs text-muted">none</span>}</td>
              </tr>))}</tbody>
          </table></div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted"><span>{data.total} total</span><span className="flex gap-3"><button disabled={page === 1} onClick={() => setPage(page - 1)} className="disabled:opacity-40">Prev</button><span>Page {page}</span><button disabled={page * 20 >= data.total} onClick={() => setPage(page + 1)} className="disabled:opacity-40">Next</button></span></div>
        </Card>
      )}
    </div>
  );
}
export default function Vulns() { return <Suspense fallback={<Spinner />}><List /></Suspense>; }
