'use client';
import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import ReactFlow, { Background, Controls, Handle, Position, MarkerType, type Node, type Edge, type NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import clsx from 'clsx';
import { Bug, Footprints, Skull, Wrench, Play } from 'lucide-react';
import { useApp } from '../../../components/app-context';
import { api, useQuery, usd } from '../../../lib/api';
import { Card, SevBadge, StatusBadge, Button, PageHeader, Spinner, ErrorBox, Empty, Notice, SimTag, Json } from '../../../components/ui';

const tone: Record<string, string> = { vuln: 'border-bad/50 bg-bad/10', step: 'border-line bg-panel2', impact: 'border-warn/60 bg-warn/10', remediation: 'border-ok/40 bg-ok/10' };
const icon: Record<string, any> = { vuln: Bug, step: Footprints, impact: Skull, remediation: Wrench };

function GNode({ data, selected }: NodeProps) {
  const Icon = icon[data.type] || Footprints;
  return (
    <div className={clsx('w-[190px] rounded-xl border p-3 text-left shadow-lg transition', tone[data.type], selected && 'ring-2 ring-info')}>
      <Handle type="target" position={Position.Left} className="!bg-line" /><Handle type="target" position={Position.Top} id="t" className="!bg-line" />
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted"><Icon className="h-3 w-3" />{data.kind}{data.severity && <span className="ml-auto"><SevBadge s={data.severity} /></span>}</div>
      <div className="text-xs font-semibold">{data.label}</div>
      <div className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-muted">{data.detail}</div>
      <Handle type="source" position={Position.Right} className="!bg-line" /><Handle type="source" position={Position.Bottom} id="b" className="!bg-line" />
    </div>
  );
}
const nodeTypes = { vuln: GNode, step: GNode, impact: GNode, remediation: GNode };

export default function Chains() {
  const { merchant } = useApp();
  const list = useQuery<{ items: any[] }>(`/attack-chains?merchantId=${merchant.id}&limit=50`);
  const chains = useMemo(() => { const seen = new Set<string>(); return [...(list.data?.items ?? [])].sort((a, b) => b.estimatedExposure - a.estimatedExposure).filter((c) => !seen.has(c.signature) && seen.add(c.signature)); }, [list.data]);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { if (!sel && chains[0]) setSel(chains[0].id); }, [chains, sel]);
  const detail = useQuery<any>(sel ? `/attack-chains/${sel}` : null);
  const [node, setNode] = useState<any>(null);
  const [exec, setExec] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNode(null); setExec(null); }, [sel]);

  const { nodes, edges } = useMemo(() => {
    const g = detail.data?.graph;
    if (!g) return { nodes: [] as Node[], edges: [] as Edge[] };
    const ns: Node[] = g.nodes.map((n: any) => ({ id: n.id, type: n.type, position: { x: n.x, y: n.y }, data: { ...n.data, type: n.type } }));
    const color: Record<string, string> = { sequence: '#60a5fa', enables: '#f87171', amplifies: '#fbbf24', consequence: '#fbbf24', mitigates: '#34d399' };
    const es: Edge[] = g.edges.map((e: any) => ({
      id: e.id, source: e.source, target: e.target, animated: e.kind === 'amplifies' || e.kind === 'consequence', label: e.kind === 'amplifies' ? 'amplifies' : e.kind === 'mitigates' ? 'mitigates' : undefined,
      style: { stroke: color[e.kind], strokeDasharray: e.kind === 'mitigates' ? '5 4' : undefined }, labelStyle: { fill: '#8a97b5', fontSize: 10 }, labelBgStyle: { fill: '#080d19' },
      markerEnd: { type: MarkerType.ArrowClosed, color: color[e.kind] },
      ...(e.kind === 'enables' ? { sourceHandle: 'b', targetHandle: 't' } : {}),
      ...(e.kind === 'mitigates' ? { sourceHandle: undefined } : {}),
    }));
    return { nodes: ns, edges: es };
  }, [detail.data]);

  const c = detail.data;
  const run = async () => { setBusy(true); try { setExec(await api(`/attack-chains/${sel}/execute`, { body: {} })); } finally { setBusy(false); } };
  const stepVuln = (nid: string) => c?.steps.find((s: any) => `s${s.sequence}` === nid);

  return (
    <div>
      <PageHeader title="Attack Chain Explorer" subtitle="Weaknesses are only chained when a reproducible simulation proves the sequence works. Click any node to inspect evidence." />
      {list.loading && !list.data && <Spinner />}
      {list.error && <ErrorBox msg={list.error} />}
      {list.data && chains.length === 0 && <Empty title="No compound attack chains yet" hint="Run an assessment. Chains appear only after the Auditor verifies each linked weakness and the chain reproduces." />}
      {chains.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {chains.map((x) => <button key={x.id} onClick={() => setSel(x.id)} className={clsx('rounded-lg border px-3 py-2 text-left text-sm', sel === x.id ? 'border-info bg-info/10' : 'border-line bg-panel hover:bg-panel2')}><div className="flex items-center gap-2 font-medium">{x.title}<SevBadge s={x.severity} /></div><div className="mt-0.5 flex items-center gap-2 text-xs text-muted"><StatusBadge s={x.status} />{x.lifecycle !== 'known' && <span>{x.lifecycle}</span>}</div></button>)}
          </div>
          {detail.loading && !c && <Spinner />}
          {c && (
            <div className="grid gap-4">
              <div>
                <Card pad={false}>
                  <div className="h-[500px]">
                    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.1, maxZoom: 1.1 }} nodesConnectable={false} onNodeClick={(_, n) => setNode(n)} onPaneClick={() => setNode(null)} proOptions={{ hideAttribution: true }} minZoom={0.3}>
                      <Background color="#1d2943" gap={22} /><Controls showInteractive={false} />
                    </ReactFlow>
                  </div>
                  <div className="flex flex-wrap gap-4 border-t border-line px-4 py-2 text-[11px] text-muted">
                    <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-bad" />vulnerability</span><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-line" />attack step</span><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-warn" />financial consequence</span><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-ok" />remediation (dashed = mitigates)</span>
                  </div>
                </Card>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <Card title="Expected (secure)"><div className="text-2xl font-semibold tabular-nums">{usd(c.expectedOutcome.merchantPosition)}</div><div className="text-xs text-muted">merchant position · refunds paid {usd(c.expectedOutcome.refundsPaid)}</div></Card>
                  <Card title="Actual (simulated)"><div className="text-2xl font-semibold tabular-nums text-bad">{usd(c.actualOutcome.merchantPosition)}</div><div className="text-xs text-muted">merchant position · refunds paid {usd(c.actualOutcome.refundsPaid)}</div></Card>
                  <Card title={<span className="flex items-center gap-2">Excess per attack <SimTag /></span>}><div className="text-2xl font-semibold tabular-nums text-warn">{usd(c.exposure?.perAttack)}</div><div className="text-xs text-muted">vs {usd(c.exposure?.isolatedSum)} if weaknesses were exploited in isolation</div></Card>
                </div>
              </div>
              <aside className="grid items-start gap-4 md:grid-cols-2">
                <Card title={node ? node.data.label : c.title}>
                  {!node ? (
                    <div className="space-y-3 text-sm"><p className="text-muted">{c.description}</p>
                      <div className="flex items-center gap-2"><SevBadge s={c.severity} /><StatusBadge s={c.status} /></div>
                      <Button onClick={run} busy={busy} variant="ghost" className="w-full"><Play className="h-4 w-4" />Re-execute in simulator</Button>
                      {exec && <Notice tone={exec.blocked ? 'ok' : 'warn'}>{exec.label}: {exec.blocked ? 'chain is BLOCKED by the currently applied fixes' : `chain still succeeds (excess ${usd(exec.leakage)} per attack)`}.</Notice>}
                      {c.exposure?.rationale && <div><div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Why these weaknesses connect</div><ul className="list-disc space-y-1 pl-4 text-xs text-muted">{c.exposure.rationale.map((r: string) => <li key={r}>{r}</li>)}</ul></div>}
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm">
                      <div className="text-xs uppercase tracking-wide text-muted">{node.data.kind}</div>
                      <p>{node.data.detail}</p>
                      {node.data.rootCause && <div><div className="text-xs font-medium text-muted">Root cause</div><p className="text-xs">{node.data.rootCause}</p></div>}
                      {node.data.expected && typeof node.data.expected === 'string' && <div className="grid gap-2 text-xs"><div><span className="text-muted">Expected: </span>{node.data.expected}</div><div><span className="text-muted">Actual: </span><span className="text-bad">{node.data.actual}</span></div></div>}
                      {node.data.evidence && Object.keys(node.data.evidence).length > 0 && <Json v={node.data.evidence} />}
                      {node.data.kind === 'consequence' && <div className="space-y-1 text-xs"><div>Expected position: {usd(node.data.expected.merchantPosition)}</div><div>Actual position: <span className="text-bad">{usd(node.data.actual.merchantPosition)}</span></div></div>}
                      {node.data.vulnId && <Link className="text-xs text-info" href={`/vulnerabilities?focus=${node.data.vulnId}`}>Open vulnerability {node.data.vulnId}</Link>}
                      {node.data.kind === 'remediation' && <Link className="text-xs text-info" href="/defence">Open in Defence Center</Link>}
                      {stepVuln(node.id)?.vulnerability && <div className="text-xs"><span className="text-muted">Linked weakness: </span><Link className="text-info" href={`/vulnerabilities/${stepVuln(node.id).vulnerability.id}`}>{stepVuln(node.id).vulnerability.testCaseId}</Link> ({stepVuln(node.id).vulnerability.status})</div>}
                      <div className="text-[11px] text-muted">Verification: reproduced by the deterministic simulator and re-executed by the Auditor.</div>
                    </div>
                  )}
                </Card>
                <Card title="Attack sequence">
                  <ol className="space-y-3 text-xs">{c.steps.map((s: any) => <li key={s.id}><div className="font-medium">{s.sequence}. {s.action}</div><div className="text-muted">Expected: {s.expectedResult}</div><div className="text-bad">Actual: {s.actualResult}</div></li>)}</ol>
                </Card>
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}
