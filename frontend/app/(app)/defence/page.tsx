'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useApp } from '../../../components/app-context';
import { useQuery } from '../../../lib/api';
import { DefencePanel } from '../../../components/defence-panel';
import { StatusBadge, SevBadge, Spinner, ErrorBox, Empty, PageHeader, Notice } from '../../../components/ui';

export default function Defence() {
  const { merchant } = useApp();
  const { data, error, loading, reload } = useQuery<any[]>(`/defences?merchantId=${merchant.id}`);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { if (data?.length && !data.some((d) => d.id === sel)) setSel(data[0].id); }, [data, sel]);
  return (
    <div>
      <PageHeader title="Defence Center" subtitle="Review the diff, approve, apply to the demo app, then prove the fix: the original attack must fail, legitimate operations must still work, and no regressions may appear." />
      <div className="mb-4"><Notice>Safety: patches are never applied automatically, never to production, and always need human approval plus an explicit confirmation. Rollback is one click.</Notice></div>
      {loading && !data && <Spinner />}
      {error && <ErrorBox msg={error} retry={reload} />}
      {data && data.length === 0 && <Empty title="No defences yet" hint="Defence proposals are generated after an assessment verifies vulnerabilities. You can also generate one from a vulnerability page." />}
      {data && data.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-2">
            {data.map((d) => (
              <button key={d.id} onClick={() => setSel(d.id)} className={clsx('w-full rounded-lg border p-3 text-left text-sm', sel === d.id ? 'border-info bg-info/10' : 'border-line bg-panel hover:bg-panel2')}>
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-muted">{d.vulnerability.testCaseId}</span><SevBadge s={d.vulnerability.severity} /></div>
                <div className="mt-1 font-medium leading-snug">{d.vulnerability.title}</div>
                <div className="mt-2 flex items-center gap-2"><StatusBadge s={d.status} /><span className="text-xs text-muted">{d.tests.length ? `${d.tests.filter((t: any) => t.status === 'passed').length}/${d.tests.length} tests` : ''}</span></div>
              </button>
            ))}
          </div>
          <div className="min-w-0">{sel && <DefencePanel key={sel} id={sel} onChange={reload} />}</div>
        </div>
      )}
    </div>
  );
}
