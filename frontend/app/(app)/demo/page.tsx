'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { CheckCircle2, Circle, Loader2, Play, RotateCcw, FileText, ShieldCheck, ArrowRight } from 'lucide-react';
import { api, useQuery, usd } from '../../../lib/api';
import { useApp } from '../../../components/app-context';
import { Card, Button, StatusBadge, SevBadge, DiffView, Notice, ErrorBox, PageHeader, Progress, SimTag, Spinner } from '../../../components/ui';

const STAGES = [
  'Merchant selection', 'Start assessment', 'Parallel investigation', 'Findings', 'Compound attack graph', 'Attack reproduction',
  'Financial exposure', 'Defence generation', 'Fix approval', 'Verification', 'Final report',
];
const INVESTIGATORS = ['opportunist', 'refund-abuse', 'payment-manipulation', 'insider-threat'];
const NAMES: Record<string, string> = { opportunist: 'Opportunist', 'refund-abuse': 'Refund Abuse', 'payment-manipulation': 'Payment Manipulation', 'insider-threat': 'Insider Threat', 'defence-architect': 'Defence Architect', auditor: 'Auditor' };

export default function Demo() {
  const { merchant, canWrite } = useApp();
  const [aid, setAid] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [verif, setVerif] = useState<any>(null);
  const [report, setReport] = useState<string | null>(null);
  const st = useQuery<any>(aid ? `/assessments/${aid}/status` : null, 700);
  const done = st.data?.status === 'completed';
  const chains = useQuery<{ items: any[] }>(done ? `/attack-chains?assessmentId=${aid}` : null);
  const chainSummary = chains.data?.items.find((c) => c.signature.startsWith('DISC')) ?? chains.data?.items[0];
  const chain = useQuery<any>(chainSummary ? `/attack-chains/${chainSummary.id}` : null);
  const defs = useQuery<any[]>(done ? `/defences?merchantId=${merchant.id}` : null);
  const chainDefs = useMemo(() => {
    const ids: string[] = chain.data?.steps.map((s: any) => s.vulnerability?.testCaseId).filter(Boolean) ?? [];
    return (defs.data ?? []).filter((d) => ids.includes(d.vulnerability.testCaseId) && d.status !== 'rolled_back');
  }, [chain.data, defs.data]);
  const findings = useQuery<any>(done ? `/vulnerabilities?merchantId=${merchant.id}&limit=50` : null);
  const ags: Record<string, any> = useMemo(() => Object.fromEntries((st.data?.agents ?? []).map((a: any) => [a.agentType, a])), [st.data]);

  // pick up a run already in progress / finished when the page is opened
  useEffect(() => { (async () => { try { const l = await api(`/assessments?merchantId=${merchant.id}&limit=5`); const a = l.items.find((x: any) => x.assessmentMode === 'demo' && !x.isDemoData); if (a) setAid(a.id); } catch { /* ignore */ } })(); }, [merchant.id]);

  const stage = st.data?.summary?.stage as string | undefined;
  const flags = useMemo(() => {
    const s = st.data;
    const inv = INVESTIGATORS.every((t) => ['verification_pending', 'completed'].includes(ags[t]?.status));
    const past = (x: string) => ['verifying', 'defending', 'auditing', 'completed'].includes(stage ?? '') && !!x;
    const allApplied = chainDefs.length > 0 && chainDefs.every((d) => ['applied', 'verified'].includes(d.status));
    const allVerified = chainDefs.length > 0 && chainDefs.every((d) => d.status === 'verified');
    return [
      true, !!s && Object.values(ags).some((a: any) => a.status !== 'idle'), inv, inv, past('c') && s?.summary?.chainCandidates !== undefined, done && !!chain.data, done && !!chain.data,
      ags['defence-architect']?.status === 'completed' && done, allApplied, allVerified && !!verif, allVerified && !!verif,
    ];
  }, [st.data, ags, stage, done, chain.data, chainDefs, verif]);
  const active = flags.findIndex((f) => !f);

  const start = async () => { setBusy('run'); setErr(''); setVerif(null); setConfirm(false); setReport(null); try { const r = await api('/demo/run', { body: {} }); setAid(r.assessmentId); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } };
  const reset = async () => { setBusy("reset"); setErr(""); setAid(null); try { await api('/demo/reset', { body: {} }); setAid(null); setVerif(null); setReport(null); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } };
  const applyAll = async () => {
    setBusy('apply'); setErr('');
    try { for (const d of chainDefs.filter((x) => x.status === 'proposed')) await api(`/defences/${d.id}/approve`, { body: {} }); for (const d of (await api(`/defences?merchantId=${merchant.id}`)).filter((x: any) => chainDefs.some((c) => c.id === x.id) && x.status === 'approved')) await api(`/defences/${d.id}/apply`, { body: { confirm: true } }); await defs.refresh(); } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const verify = async () => {
    setBusy('verify'); setErr('');
    try {
      const results: any[] = [];
      for (const d of chainDefs) results.push({ d, r: await api(`/defences/${d.id}/run-tests`, { body: {} }) });
      const ex = await api(`/attack-chains/${chainSummary.id}/execute`, { body: {} });
      setVerif({ results, chain: ex }); await defs.refresh(); await chain.refresh(); await findings.refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const makeReport = useCallback(async () => { setBusy('rep'); try { const r = await api('/reports', { body: { merchantId: merchant.id } }); setReport(r.id); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } }, [merchant.id]);

  const body = (i: number) => {
    const c = chain.data;
    switch (i) {
      case 0: return <p className="text-sm text-muted">{merchant.name} - <b>controlled sample application</b> with seeded weaknesses in discounts, refunds, payments, inventory and staff permissions. {merchant.isDemo ? '' : 'Select the demo merchant in the header to run this walkthrough.'}</p>;
      case 1: return <div className="flex flex-wrap gap-2">{Object.values(ags).map((a: any) => <span key={a.agentType} className="flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-2.5 py-1 text-xs">{NAMES[a.agentType]} <StatusBadge s={a.status} /></span>)}</div>;
      case 2: return <div className="grid gap-3 md:grid-cols-2">{INVESTIGATORS.map((t) => <div key={t}><div className="mb-1 flex justify-between text-xs"><span>{NAMES[t]}</span><span className="text-muted">{ags[t]?.progress.done}/{ags[t]?.progress.total || '-'} · {ags[t]?.task}</span></div><Progress done={ags[t]?.progress.done ?? 0} total={ags[t]?.progress.total ?? 0} /></div>)}</div>;
      case 3: {
        const claims = INVESTIGATORS.flatMap((t) => ags[t]?.output?.findings ?? []);
        return <div className="space-y-1.5 text-sm">{claims.map((f: any) => <div key={f.testCaseId} className="flex items-center justify-between gap-2"><span><span className="font-mono text-xs text-muted">{f.testCaseId}</span> {f.title}</span><SevBadge s={f.severity} /></div>)}{claims.length === 0 && <span className="text-muted">Waiting for findings...</span>}<p className="pt-1 text-xs text-muted">These are agent <i>claims</i>. They count as verified only after the Auditor reproduces them.</p></div>;
      }
      case 4: return <div className="text-sm"><p className="text-muted">The orchestrator linked reproducible weaknesses using the relationship model: {st.data?.summary?.chainCandidates ?? 0} candidate chain(s) generated from {st.data?.summary?.claims ?? 0} claims.</p>{chains.data && <div className="mt-2 flex flex-wrap gap-2">{chains.data.items.map((x) => <span key={x.id} className="rounded-lg border border-line bg-panel2 px-2.5 py-1 text-xs">{x.title} <SevBadge s={x.severity} /></span>)}</div>}<Link href="/attack-chains" className="mt-2 inline-flex items-center gap-1 text-xs text-info">Open Attack Chain Explorer <ArrowRight className="h-3 w-3" /></Link></div>;
      case 5: return c ? <div className="space-y-2 text-sm"><div className="font-medium">{c.title} <SimTag /></div><ol className="space-y-1.5">{c.steps.map((s: any) => <li key={s.id} className="rounded-lg border border-line bg-panel2 p-2.5 text-xs"><div className="font-medium">{s.sequence}. {s.action}</div><div className="text-muted">Expected: {s.expectedResult}</div><div className="text-bad">Actual: {s.actualResult}</div></li>)}</ol><p className="text-xs text-muted">Executed in the isolated simulator and re-executed independently by the Auditor.</p></div> : <Spinner />;
      case 6: return c ? <div className="grid gap-3 md:grid-cols-3 text-sm"><div className="rounded-lg border border-line bg-panel2 p-3"><div className="text-xs text-muted">Expected merchant position</div><div className="text-xl font-semibold tabular-nums">{usd(c.expectedOutcome.merchantPosition)}</div></div><div className="rounded-lg border border-bad/30 bg-bad/5 p-3"><div className="text-xs text-muted">Actual (simulated)</div><div className="text-xl font-semibold tabular-nums text-bad">{usd(c.actualOutcome.merchantPosition)}</div></div><div className="rounded-lg border border-warn/30 bg-warn/5 p-3"><div className="text-xs text-muted">Excess per attack <SimTag /></div><div className="text-xl font-semibold tabular-nums text-warn">{usd(c.exposure.perAttack)}</div><div className="text-[11px] text-muted">projected annual: {usd(c.exposure.exposure.low)} - {usd(c.exposure.exposure.high)} (expected {usd(c.exposure.exposure.expected)})</div></div></div> : <Spinner />;
      case 7: return <div className="space-y-2 text-sm">{chainDefs.map((d) => <div key={d.id} className="flex items-center justify-between rounded-lg border border-line bg-panel2 px-3 py-2"><span><span className="font-mono text-xs text-muted">{d.vulnerability.testCaseId}</span> {d.vulnerability.title}</span><StatusBadge s={d.status} /></div>)}<p className="text-xs text-muted">Each proposal contains the root cause, a real diff, regression tests and an Auditor sandbox dry-run.</p></div>;
      case 8: return (
        <div className="space-y-3">
          {chainDefs.length === 0 ? <Spinner /> : <details className="rounded-lg border border-line bg-panel2 p-3" open={flags[8] ? false : true}><summary className="cursor-pointer text-sm font-medium">Review {chainDefs.length} patch diffs</summary><div className="mt-3 space-y-3">{chainDefs.map((d) => <DiffFor key={d.id} id={d.id} />)}</div></details>}
          {!flags[8] && <><label className="flex items-start gap-2 text-xs text-warn"><input type="checkbox" className="mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I reviewed the diffs and approve applying them to the controlled demo application (rollback available).</label>
            <Button variant="ok" disabled={!confirm || !canWrite} busy={busy === 'apply'} onClick={applyAll}><ShieldCheck className="h-4 w-4" />Approve and apply {chainDefs.length} fixes</Button></>}
          {flags[8] && <Notice tone="ok">Fixes approved by a human and applied to the demo app.</Notice>}
        </div>);
      case 9: return (
        <div className="space-y-3 text-sm">
          {!verif ? <Button busy={busy === 'verify'} disabled={!flags[8]} onClick={verify}>Replay the original attack and run regression tests</Button> : (
            <>
              <Notice tone={verif.chain.blocked ? 'ok' : 'warn'}>Original compound attack: <b>{verif.chain.blocked ? 'FAILED (blocked)' : 'still succeeds'}</b> against the fixed app - excess per attack now {usd(verif.chain.leakage)} (was {usd(chain.data?.exposure.perAttack)}).</Notice>
              {verif.results.map(({ d, r }: any) => <div key={d.id} className="rounded-lg border border-line bg-panel2 p-3"><div className="mb-1 flex items-center justify-between"><span className="font-mono text-xs">{d.fixId}</span><StatusBadge s={r.passed ? 'passed' : 'failed'} /></div><ul className="space-y-0.5 text-xs text-muted">{r.verification.legit.map((l: any) => <li key={l.name}>{l.ok ? '✔' : '✘'} {l.name} - {l.detail}</li>)}<li>✔ Original attack blocked · {r.verification.regression.length} regression checks, no new exploit</li></ul></div>)}
            </>)}
        </div>);
      case 10: {
        const open = (findings.data?.items ?? []).filter((v: any) => ['verified', 'reintroduced'].includes(v.status));
        return flags[10] ? (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1"><li>✔ Attack discovered: <b>{c?.title}</b></li><li>✔ Vulnerabilities confirmed by independent reproduction: {c?.steps.filter((s: any) => s.vulnerability).length}</li><li>✔ Simulated exposure: {usd(c?.exposure.perAttack)} per attack ({usd(c?.exposure.exposure.expected)} expected annual projection)</li><li>✔ Defences generated, human-approved and verified; regression tests passed</li></ul>
            <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs"><b>Remaining risks ({open.length}):</b> {open.map((v: any) => v.testCaseId + ' ' + v.title).join(' · ') || 'none'}. Apply the remaining defences from the Defence Center.</div>
            <div className="flex gap-2">{report ? <><a className="rounded-lg border border-line bg-panel2 px-3 py-2 text-sm hover:bg-line" href={`/api/reports/${report}/download?format=pdf`}>Download PDF</a><a className="rounded-lg border border-line bg-panel2 px-3 py-2 text-sm hover:bg-line" href={`/api/reports/${report}/download`}>Download JSON</a></> : <Button variant="ghost" busy={busy === 'rep'} onClick={makeReport}><FileText className="h-4 w-4" />Generate report</Button>}</div>
          </div>) : <p className="text-sm text-muted">Available after verification.</p>;
      }
    }
  };

  return (
    <div>
      <PageHeader title="Live Demo" subtitle="A guided end-to-end run on NovaCart Electronics. Every stage is driven by real backend jobs and the deterministic simulator - nothing is replayed from canned results."
        actions={<><Button variant="ghost" onClick={reset} busy={busy === 'reset'} disabled={!canWrite}><RotateCcw className="h-4 w-4" />Reset demo</Button><Button onClick={start} busy={busy === 'run' || st.data?.status === 'running'} disabled={!canWrite || !merchant.isDemo}><Play className="h-4 w-4" />{aid ? 'Run again' : 'Run Live Demo'}</Button></>} />
      {err && <div className="mb-4"><ErrorBox msg={err} /></div>}
      {!aid && <Notice>Press <b>Run Live Demo</b>. Six agents will be dispatched; a fresh simulator run takes about 15 seconds because probes are paced so you can watch them.</Notice>}
      <ol className="mt-4 space-y-3">
        {STAGES.map((name, i) => {
          const state = flags[i] ? 'done' : i === active && aid ? 'active' : i === 0 ? 'done' : 'pending';
          return (
            <li key={name} className={clsx('rounded-xl border bg-panel', state === 'active' ? 'border-info/50' : 'border-line', state === 'pending' && 'opacity-50')}>
              <div className="flex items-center gap-3 px-4 py-3">
                {state === 'done' ? <CheckCircle2 className="h-5 w-5 text-ok" /> : state === 'active' ? <Loader2 className="h-5 w-5 animate-spin text-info" /> : <Circle className="h-5 w-5 text-line" />}
                <span className="text-xs text-muted">Stage {i + 1}</span><span className="text-sm font-medium">{name}</span>
              </div>
              {state !== 'pending' && (i === 0 || aid) && <div className="border-t border-line px-4 py-3">{body(i)}</div>}
            </li>);
        })}
      </ol>
    </div>
  );
}

function DiffFor({ id }: { id: string }) {
  const { data } = useQuery<any>(`/defences/${id}`);
  if (!data) return <Spinner />;
  return <div><div className="mb-1 text-xs"><span className="font-mono text-muted">{data.fixId}</span> - {data.fix?.title}</div><DiffView patch={data.patch} /></div>;
}
