'use client';
import { useEffect, useState } from 'react';
import { Crosshair, ExternalLink, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { api, useQuery } from '../lib/api';
import { useApp } from './app-context';
import { Card, Button, Notice, ErrorBox } from './ui';

const SRC: Record<string, { label: string; cls: string }> = {
  'paypal-sandbox': { label: 'PAYPAL SANDBOX', cls: 'border-ok/30 bg-ok/10 text-ok' },
  'paypal-emulator': { label: 'EMULATOR - NOT PAYPAL', cls: 'border-warn/30 bg-warn/10 text-warn' },
  sellershield: { label: 'SELLERSHIELD', cls: 'border-info/30 bg-info/10 text-info' },
};

export function RedTeamCard() {
  const { merchant, canWrite } = useApp();
  const cfg = useQuery<any>('/redteam/config');
  const [target, setTarget] = useState<'emulator' | 'sandbox'>('emulator');
  const [run, setRun] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { (async () => { try { const l = await api(`/redteam?merchantId=${merchant.id}`); setHistory(l); const pending = l.find((x: any) => x.status === 'awaiting_approval'); if (pending || l[0]) setRun(pending ?? l[0]); } catch { /* none yet */ } })(); }, [merchant.id]);
  useEffect(() => { if (cfg.data?.sandboxConfigured) setTarget('sandbox'); }, [cfg.data]);

  const go = async (k: string, fn: () => Promise<any>) => { setBusy(k); setErr(''); try { setRun(await fn()); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } };
  const results: any[] = run?.results ?? [];
  const weak = results.filter((r) => r.verdict === 'weakness');
  return (
    <Card className="mt-4" title={<span className="flex items-center gap-2"><Crosshair className="h-4 w-4 text-bad" />PayPal Red Team - automated attacker vs the payment protocol</span>}>
      <p className="mb-3 text-sm text-muted">Probes idempotency, capture-before-approval, refund replay and over-refund, replays the <b>Discount-Stack Refund Siphon</b> money flow, then reconciles NovaCart&apos;s ledger against PayPal&apos;s own refund records. Every result is tagged with where it came from.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Target" value={target} onChange={(e) => setTarget(e.target.value as any)} className="rounded-lg border border-line bg-panel2 px-3 py-2 text-sm">
          <option value="emulator">Local PayPal emulator (not PayPal)</option>
          <option value="sandbox" disabled={!cfg.data?.sandboxConfigured}>PayPal Sandbox{cfg.data?.sandboxConfigured ? '' : ' (credentials not configured)'}</option>
        </select>
        <Button busy={busy === 'run'} disabled={!canWrite} onClick={() => go('run', () => api('/redteam/run', { body: { merchantId: merchant.id, target } }))}>Run red team</Button>
        {run?.status === 'awaiting_approval' && <Button variant="ok" busy={busy === 'cont'} onClick={() => go('cont', () => api(`/redteam/${run.id}/continue`, { body: {} }))}>Continue after buyer approval</Button>}
      </div>
      {history.length > 1 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted">
          <label htmlFor="rt-run">Recent runs:</label>
          <select id="rt-run" aria-label="Recent runs" value={run?.id ?? ''} onChange={(e) => setRun(history.find((h) => h.id === e.target.value) ?? run)} className="rounded-lg border border-line bg-panel2 px-2 py-1">
            {history.map((h) => <option key={h.id} value={h.id}>{h.mode === 'sandbox' ? 'PayPal Sandbox' : 'Emulator'} · {h.status.replace('_', ' ')} · {new Date(h.createdAt).toLocaleString()}</option>)}
          </select>
        </div>
      )}
      {target === 'emulator' && <div className="mt-3"><Notice tone="warn">Emulator mode exercises the real HTTP client against a local model of PayPal&apos;s <i>documented</i> behaviour. It is <b>not evidence about PayPal</b>. Add Sandbox credentials to test the real platform.</Notice></div>}
      {err && <div className="mt-3"><ErrorBox msg={err} /></div>}
      {run?.status === 'awaiting_approval' && (
        <div className="mt-3"><Notice>Order created on PayPal Sandbox. A human buyer must approve it: <a className="inline-flex items-center gap-1 underline" href={run.approvalUrl} target="_blank" rel="noreferrer">open approval page <ExternalLink className="h-3 w-3" /></a>, then press &ldquo;Continue after buyer approval&rdquo;.</Notice></div>
      )}
      {results.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <div className="mb-2 flex gap-3 text-xs"><span className="text-ok">{results.filter((r) => r.verdict === 'secure').length} secure</span><span className={weak.length ? 'text-bad' : 'text-muted'}>{weak.length} weakness{weak.length === 1 ? '' : 'es'}</span><span className="text-muted">mode: {run.mode}</span></div>
          <table className="w-full text-sm"><tbody>
            {results.map((r) => (
              <tr key={r.id} className="border-t border-line/60 align-top">
                <td className="py-2 pr-2">{r.verdict === 'secure' ? <CheckCircle2 className="h-4 w-4 text-ok" /> : r.verdict === 'weakness' ? <AlertTriangle className="h-4 w-4 text-bad" /> : <XCircle className="h-4 w-4 text-muted" />}</td>
                <td className="py-2 pr-3"><div className="font-medium">{r.id} · {r.title}</div><div className="text-xs text-muted">{r.request}</div><div className="text-xs">Expected: {r.expected}</div><div className={`text-xs ${r.verdict === 'weakness' ? 'text-bad' : 'text-muted'}`}>Actual: {r.actual}</div>{r.evidence?.insight && <div className="mt-1 rounded border border-warn/30 bg-warn/5 p-2 text-xs text-warn">{r.evidence.insight}</div>}</td>
                <td className="w-44 py-2 text-right"><span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold ${SRC[r.source]?.cls}`}>{SRC[r.source]?.label}</span></td>
              </tr>))}
          </tbody></table>
        </div>
      )}
    </Card>
  );
}
