'use client';
import { useState } from 'react';
import { CheckCircle2, XCircle, ShieldCheck, Undo2, Download, FlaskConical, Stamp, Rocket, GitPullRequest, ExternalLink } from 'lucide-react';
import { api, useQuery, usd } from '../lib/api';
import { Card, StatusBadge, Button, DiffView, Notice, ErrorBox, Spinner, SevBadge } from './ui';
import { useApp } from './app-context';

export function DefencePanel({ id, onChange }: { id: string; onChange?: () => void }) {
  const { canWrite } = useApp();
  const { data: d, error, reload } = useQuery<any>(`/defences/${id}`);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<any>(null);
  if (error) return <ErrorBox msg={error} retry={reload} />;
  if (!d) return <Spinner />;
  const act = async (k: string, fn: () => Promise<any>) => { setBusy(k); setErr(''); try { const r = await fn(); if (k === 'test') setResult(r); await reload(); onChange?.(); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } };
  const dry = d.dryRun;
  const ver = result?.verification;
  const before = ver?.originalAttack ?? dry?.originalAttack;
  const legit = ver?.legit ?? dry?.legit ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="flex items-center gap-2"><StatusBadge s={d.status} /><span className="font-mono text-xs text-muted">{d.fixId}</span>{d.aiGenerated && <span className="rounded border border-line px-1.5 text-[10px] text-muted">AI-written explanation</span>}</div><h2 className="mt-1 text-lg font-semibold">{d.fix?.title}</h2><p className="text-sm text-muted">{d.proposedFix}</p></div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <a href={`/api/defences/${id}/patch`} className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3.5 py-2 text-sm hover:bg-line"><Download className="h-4 w-4" />Patch file</a>
            {d.status === 'proposed' && <Button variant="ghost" busy={busy === 'ap'} onClick={() => act('ap', () => api(`/defences/${id}/approve`, { body: {} }))}><Stamp className="h-4 w-4" />Approve patch</Button>}
            {d.status === 'approved' && <Button busy={busy === 'apply'} disabled={!confirm} onClick={() => act('apply', () => api(`/defences/${id}/apply`, { body: { confirm: true } }))}><Rocket className="h-4 w-4" />Apply to Demo App</Button>}
            {['applied', 'verified', 'failed'].includes(d.status) && <Button busy={busy === 'test'} onClick={() => act('test', () => api(`/defences/${id}/run-tests`, { body: {} }))}><FlaskConical className="h-4 w-4" />Run Regression Tests</Button>}
            {['applied', 'verified'].includes(d.status) && <Button variant="danger" busy={busy === 'rb'} onClick={() => act('rb', () => api(`/defences/${id}/rollback`, { body: {} }))}><Undo2 className="h-4 w-4" />Roll Back</Button>}
          </div>
        )}
      </div>
      {err && <ErrorBox msg={err} />}
      {d.status === 'approved' && (
        <label className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs text-warn"><input type="checkbox" className="mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I reviewed the diff below and approve applying it to the controlled demo application (rollback stays available). Nothing is ever deployed to a live production system.</label>
      )}
      {d.status === 'failed' && <Notice tone="warn">Verification failed or the fix was disabled by a business-rule change. Re-enable the rule or generate a fresh defence.</Notice>}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Code diff - vulnerable to protected"><DiffView patch={d.patch} /><p className="mt-2 text-xs text-muted">Generated deterministically from the vulnerable and secure rule implementations in <span className="font-mono">{d.fix?.file}</span>. Models explain; they do not write the patch.</p></Card>
        <div className="space-y-4">
          <Card title="Why the correction works"><p className="text-sm">{d.explanation}</p></Card>
          <Card title="Remediation plan"><ol className="list-decimal space-y-1 pl-5 text-sm">{(d.remediationPlan as string[]).map((s) => <li key={s}>{s}</li>)}</ol></Card>
          <Card title="Trade-offs and side effects"><ul className="list-disc space-y-1 pl-5 text-sm text-muted">{(d.tradeoffs as string[]).map((s) => <li key={s}>{s}</li>)}</ul></Card>
        </div>
      </div>

      {d.status === 'verified' && canWrite && <PullRequestSection id={id} prUrl={d.prUrl} onDone={reload} />}

      <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-ok" />Before and after verification {!result && <span className="text-xs font-normal text-muted">(Auditor sandbox dry-run until the fix is applied and tested)</span>}</span>}>
        {before && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-bad/30 bg-bad/5 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-bad">Before</div><div className="mt-1 text-sm">Original attack <b>{before.exploitedBefore ? 'SUCCEEDS' : 'fails'}</b></div><div className="text-xs text-muted">Excess per attack {usd(before.leakageBefore)}</div></div>
            <div className="rounded-xl border border-ok/30 bg-ok/5 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-ok">After fix</div><div className="mt-1 text-sm">Original attack <b>{before.exploitedAfter ? 'STILL SUCCEEDS' : 'BLOCKED'}</b></div><div className="text-xs text-muted">Excess per attack {usd(before.leakageAfter)}</div></div>
          </div>
        )}
        <ul className="mt-3 space-y-1.5 text-sm">
          {legit.map((l: any) => <li key={l.name} className="flex items-start gap-2">{l.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />}<span>{l.name}<span className="block text-xs text-muted">{l.detail}</span></span></li>)}
          {(ver?.regression ?? dry?.regression ?? []).filter((r: any) => !r.ok).map((r: any) => <li key={r.scenarioId} className="flex gap-2 text-bad"><XCircle className="h-4 w-4" />New exploit introduced in {r.scenarioId}</li>)}
        </ul>
        {(ver?.regression ?? dry?.regression) && <p className="mt-2 text-xs text-muted">Regression suite: {(ver?.regression ?? dry.regression).length} other scenarios checked - {(ver?.regression ?? dry.regression).every((r: any) => r.ok) ? 'no new exploit introduced' : 'regressions found'}.</p>}
        {(ver?.chainChecks ?? dry?.chainChecks)?.length > 0 && <div className="mt-2 text-xs text-muted">Chains: {(ver?.chainChecks ?? dry.chainChecks).map((c: any) => `${c.signature} ${c.blocked ? 'blocked' : 'still exploitable via another unfixed link'}`).join(' · ')}</div>}
      </Card>

      {d.tests?.length > 0 && (
        <Card title={`Persisted regression tests (${d.tests.length})`} pad={false}>
          <table className="w-full text-sm"><tbody>{d.tests.map((t: any) => <tr key={t.id} className="border-t border-line/60 first:border-0"><td className="px-4 py-2"><div>{t.testName}</div><div className="text-xs text-muted">{t.actualResult}</div></td><td className="pr-4 text-right text-xs capitalize text-muted">{t.kind}</td><td className="pr-4 text-right"><StatusBadge s={t.status} /></td></tr>)}</tbody></table>
        </Card>
      )}
    </div>
  );
}

function PullRequestSection({ id, prUrl, onDone }: { id: string; prUrl?: string | null; onDone: () => void }) {
  const [prev, setPrev] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const [file, setFile] = useState(0);
  const load = async () => { setBusy('prev'); setErr(''); try { setPrev(await api(`/defences/${id}/pull-request/preview`)); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } };
  const open = async () => { setBusy('open'); setErr(''); try { await api(`/defences/${id}/pull-request`, { body: { confirm: true } }); await onDone(); setPrev(null); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } };
  return (
    <Card title={<span className="flex items-center gap-2"><GitPullRequest className="h-4 w-4 text-info" />Ship the fix as a pull request</span>}>
      {prUrl ? <Notice tone="ok">Draft pull request opened: <a className="inline-flex items-center gap-1 underline" href={prUrl} target="_blank" rel="noreferrer">{prUrl}<ExternalLink className="h-3 w-3" /></a></Notice> : (
        <div className="space-y-3">
          <p className="text-sm text-muted">Verified and human-approved. SellerShield can open a <b>draft</b> PR carrying the patch, a runnable regression test and the before/after proof. It never merges or touches the base branch.</p>
          {!prev && <Button variant="ghost" busy={busy === 'prev'} onClick={load}>Preview pull request</Button>}
          {err && <ErrorBox msg={err} />}
          {prev && (
            <div className="space-y-3">
              <div className="rounded-lg border border-line bg-panel2 p-3 text-sm"><div className="text-xs text-muted">{prev.repo} ← {prev.branch} → {prev.base}</div><div className="font-medium">{prev.title}</div></div>
              <div className="flex flex-wrap gap-2">{prev.files.map((f: any, i: number) => <button key={f.path} onClick={() => setFile(i)} className={`rounded-md border px-2 py-1 font-mono text-[11px] ${file === i ? 'border-info bg-info/10' : 'border-line text-muted'}`}>{f.path}</button>)}</div>
              <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-[#060a14] p-3 font-mono text-[11.5px] leading-5 text-muted">{prev.files[file].content}</pre>
              <details className="text-xs text-muted"><summary className="cursor-pointer">PR description</summary><pre className="mt-2 whitespace-pre-wrap">{prev.body}</pre></details>
              {!prev.configured && <Notice tone="warn">GitHub is not configured (set GITHUB_TOKEN and GITHUB_REPO in backend/.env), so a PR cannot be opened. The preview above is exactly what would be created. Not tested against real GitHub in this build.</Notice>}
              <label className="flex items-start gap-2 text-xs text-warn"><input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} />I reviewed these files and want a draft PR opened in {prev.repo}.</label>
              <Button variant="ok" disabled={!ok || !prev.configured} busy={busy === 'open'} onClick={open}><GitPullRequest className="h-4 w-4" />Open draft pull request</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
export { SevBadge };
