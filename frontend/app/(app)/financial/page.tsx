'use client';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../../../components/app-context';
import { useQuery, usd, when } from '../../../lib/api';
import { Card, Spinner, ErrorBox, PageHeader, SimTag, Notice, SevBadge, StatusBadge, Empty } from '../../../components/ui';

const axis = { stroke: '#8a97b5', fontSize: 11 };
const tip = { contentStyle: { background: '#0e1626', border: '1px solid #1d2943', borderRadius: 8, fontSize: 12 }, cursor: { fill: '#121c31' } };

export default function Financial() {
  const { merchant } = useApp();
  const { data: d, error, loading, reload } = useQuery<any>(`/financial?merchantId=${merchant.id}`);
  if (loading && !d) return <Spinner />;
  if (error) return <ErrorBox msg={error} retry={reload} />;
  if (!d) return null;
  const rows = d.rows.filter((r: any) => r.exposure);
  const ranges = rows.map((r: any) => ({ name: r.testCaseId, low: r.exposure.exposure.low, expected: r.exposure.exposure.expected - r.exposure.exposure.low, high: r.exposure.exposure.high - r.exposure.exposure.expected, open: r.open }));
  const cats = d.byCategory.map((c: any) => ({ name: c.category, Open: Math.round(c.open), 'Avoided (fixed)': Math.round(c.avoided) }));
  return (
    <div>
      <PageHeader title="Financial Impact Center" subtitle={<>Exposure = unique exploited orders x excess amount per simulated attack. <SimTag /> Never present these figures as actual merchant losses.</>} />
      <div className="mb-4"><Notice tone="warn">{d.label}. Attack frequency is an assumption (see below); the per-attack excess is measured in the deterministic simulator.</Notice></div>
      {rows.length === 0 ? <Empty title="No exposure data yet" hint="Run an assessment first." /> : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Annual exposure by category (expected)">
              <div className="h-64"><ResponsiveContainer><BarChart data={cats}><CartesianGrid stroke="#1d2943" vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis {...axis} tickFormatter={(v) => '$' + v} /><Tooltip {...tip} formatter={(v: number) => usd(v)} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="Open" stackId="a" fill="#f87171" radius={[0, 0, 0, 0]} /><Bar dataKey="Avoided (fixed)" stackId="a" fill="#34d399" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
            </Card>
            <Card title="Loss range per vulnerability (low / expected / high)">
              <div className="h-64"><ResponsiveContainer><BarChart data={ranges} layout="vertical" margin={{ left: 20 }}><CartesianGrid stroke="#1d2943" horizontal={false} /><XAxis type="number" {...axis} tickFormatter={(v) => '$' + v} /><YAxis type="category" dataKey="name" {...axis} width={90} /><Tooltip {...tip} formatter={(v: number) => usd(v)} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="low" stackId="a" name="Low" fill="#60a5fa" /><Bar dataKey="expected" stackId="a" name="to Expected" fill="#fbbf24" /><Bar dataKey="high" stackId="a" name="to High" fill="#f87171" /></BarChart></ResponsiveContainer></div>
            </Card>
          </div>
          <Card className="mt-4" title="Historical exposure (per completed scan)">
            {d.trend.length < 2 ? <p className="text-sm text-muted">Trend appears after two or more completed scans (e.g. scan, apply fixes, re-scan). {d.trend.length} so far.</p> : (
              <div className="h-60"><ResponsiveContainer><LineChart data={d.trend.map((t: any, i: number) => ({ scan: `#${i + 1}`, exposure: t.exposure, open: t.open }))}><CartesianGrid stroke="#1d2943" vertical={false} /><XAxis dataKey="scan" {...axis} /><YAxis {...axis} tickFormatter={(v) => '$' + v} /><Tooltip {...tip} /><Line type="monotone" dataKey="exposure" name="Expected exposure ($)" stroke="#fbbf24" strokeWidth={2} dot /></LineChart></ResponsiveContainer></div>
            )}
          </Card>
          <Card className="mt-4" title="Vulnerability impact" pad={false}>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">Vulnerability</th><th>Severity</th><th>Status</th><th className="text-right">Per attack</th><th className="text-right">Low</th><th className="text-right">Expected</th><th className="text-right">High</th><th className="px-4 text-right">Confidence</th></tr></thead><tbody>
              {rows.map((r: any) => <tr key={r.id} className="border-t border-line/60"><td className="px-4 py-2.5">{r.title}<div className="font-mono text-xs text-muted">{r.testCaseId}</div></td><td><SevBadge s={r.severity} /></td><td><StatusBadge s={r.status} /></td><td className="text-right tabular-nums">{usd(r.exposure.perAttack)}</td><td className="text-right tabular-nums">{usd(r.exposure.exposure.low)}</td><td className="text-right tabular-nums">{usd(r.exposure.exposure.expected)}</td><td className="text-right tabular-nums">{usd(r.exposure.exposure.high)}</td><td className="px-4 text-right capitalize">{r.exposure.confidence.level}</td></tr>)}
            </tbody></table></div>
          </Card>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Compound chains">
              {d.chains.map((c: any) => <div key={c.id} className="flex items-center justify-between border-b border-line/60 py-2 text-sm last:border-0"><div>{c.title}<div className="text-xs text-muted">{usd(c.exposure?.perAttack)} per attack · isolated sum {usd(c.exposure?.isolatedSum)}</div></div><div className="text-right"><div className="tabular-nums">{usd(c.estimated)}</div><StatusBadge s={c.status} /></div></div>)}
              <p className="mt-2 text-xs text-muted">Chain exposure overlaps individual vulnerabilities; the dashboard total does not double count.</p>
            </Card>
            <Card title="Simulation assumptions">
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted"><li>{d.assumptions.monthlyOrders} orders per month over {d.assumptions.horizonMonths} months (demo profile).</li>
                {Object.entries(d.assumptions.abuseRates).map(([k, v]: any) => <li key={k}>{k}: exploitation of {(v[0] * 100).toFixed(2)}% / {(v[1] * 100).toFixed(2)}% / {(v[2] * 100).toFixed(2)}% of orders (low/expected/high)</li>)}
                <li>Each exploited order counts once; replayed requests on the same order are not multiplied.</li><li>Formula: {d.formula}</li></ul>
            </Card>
          </div>
          <p className="mt-4 text-xs text-muted">Updated {when(new Date().toISOString())}</p>
        </>
      )}
    </div>
  );
}
