'use client';
import { useState } from 'react';
import { Globe, Upload, SlidersHorizontal, Store, Search } from 'lucide-react';
import { api, useQuery } from '../../../lib/api';
import { useApp } from '../../../components/app-context';
import { Card, Button, Notice, ErrorBox, PageHeader, Spinner, StatusBadge } from '../../../components/ui';

const RULES = [
  { key: 'stackableCoupons', label: 'Allow coupon stacking', hint: 'Marketing campaign: let customers combine coupons.', risky: (v: any) => v === true, fix: 'coupon-stacking' },
  { key: 'refundAllocation', label: 'Refund at list price', hint: "Simplify refunds to the item's list price.", risky: (v: any) => v === 'list', fix: 'refund-calc' },
  { key: 'enforceRefundIdempotency', label: 'Enforce refund idempotency keys', hint: 'Turn off to support legacy clients without keys.', risky: (v: any) => v === false, fix: 'refund-idempotency' },
  { key: 'atomicInventory', label: 'Atomic inventory reservation', hint: 'Turn off to use the legacy read-then-write path.', risky: (v: any) => v === false, fix: 'inventory-race' },
  { key: 'strictPaymentStates', label: 'Strict payment state machine', hint: 'Turn off to mark pending e-check payments as paid.', risky: (v: any) => v === false, fix: 'payment-state' },
  { key: 'refundRbac', label: 'Refund role checks and approval', hint: 'Turn off to let any staff member refund.', risky: (v: any) => v === false, fix: 'refund-permission' },
] as const;

export default function MerchantSetup() {
  const { merchant, merchants, reloadMerchants, setMerchantId, canWrite } = useApp();
  const m = useQuery<any>(`/merchants/${merchant.id}`);
  const [form, setForm] = useState({ name: '', websiteUrl: '', description: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [crawl, setCrawl] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const inp = 'w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-info';

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy('create');
    try { const x = await api('/merchants', { body: { name: form.name, websiteUrl: form.websiteUrl || null, description: form.description || null } }); await reloadMerchants(); setMerchantId(x.id); setForm({ name: '', websiteUrl: '', description: '' }); setMsg('Merchant created. Run website analysis below.'); }
    catch (x: any) { setErr(x.message + (x as any).details ? '' : ''); } finally { setBusy(''); }
  };
  const setRule = async (key: string, value: unknown) => { setErr(''); try { await api(`/merchants/${merchant.id}/config`, { method: 'PATCH', body: { [key]: value } }); await m.refresh(); setMsg('Business rule saved. Use Attack Memory to rerun previous tests and detect regressions.'); } catch (x: any) { setErr(x.message); } };
  const upload = async (f: File) => {
    setErr(''); setBusy('up');
    try { const fd = new FormData(); fd.append('file', f); const r = await fetch(`/api/merchants/${merchant.id}/documents`, { method: 'POST', body: fd }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setMsg(`${j.filename} stored (${j.kind}). ${j.note}`); await m.refresh(); } catch (x: any) { setErr(x.message); } finally { setBusy(''); }
  };
  const preview = async () => { setErr(''); setBusy('crawl'); try { setCrawl(await api(`/merchants/${merchant.id}/crawl-preview`, { body: {} })); } catch (x: any) { setErr(x.message); } finally { setBusy(''); } };
  const websiteScan = async () => { setErr(''); setBusy('scan'); try { const a = await api('/assessments', { body: { merchantId: merchant.id, mode: 'website', start: true } }); setMsg('Website analysis started (assessment ' + a.id.slice(0, 8) + ')...'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 700)); const s = await api(`/assessments/${a.id}/status`); if (s.status !== 'running' && s.status !== 'queued') { setCrawl(s.summary?.crawl ?? null); setMsg(s.status === 'completed' ? 'Website analysis complete.' : 'Website analysis failed: ' + (s.summary?.error ?? '')); break; } } } catch (x: any) { setErr(x.message); } finally { setBusy(''); } };

  return (
    <div>
      <PageHeader title="Merchant Setup" subtitle="Choose what to assess and see the scope before starting." />
      {err && <div className="mb-4"><ErrorBox msg={err} /></div>}
      {msg && <div className="mb-4"><Notice tone="ok">{msg}</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Store className="h-4 w-4 text-info" />Application profile and scope</span>}>
          {m.loading && !m.data ? <Spinner /> : m.data && (
            <div className="space-y-3 text-sm">
              <div><div className="text-base font-semibold">{m.data.name}</div><p className="text-muted">{m.data.description}</p></div>
              {m.data.isDemo ? <Notice>Scope: the controlled <b>NovaCart sample application</b> - product catalogue, discount rules, refund policy, cancellation and inventory rules, payment workflow, order management and staff roles. Agents test the vulnerable implementation inside an isolated simulator. Nothing external is contacted.</Notice>
                : <Notice tone="warn">Scope: <b>publicly observable configuration only</b> (homepage, product, pricing, discount, shipping, refund, cancellation and contact pages). Internal payment and refund logic is not visible from a website and is <b>not tested</b>. Logins, CAPTCHAs and paywalls are never bypassed.</Notice>}
              <div className="flex flex-wrap gap-1.5 text-xs">{m.data.effectiveFixes.length ? m.data.effectiveFixes.map((f: string) => <span key={f} className="rounded border border-ok/30 bg-ok/10 px-2 py-0.5 text-ok">{f}</span>) : <span className="text-muted">No verified fixes applied.</span>}</div>
              <div className="text-xs text-muted">{merchants.length} merchant(s) in workspace.</div>
            </div>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><Globe className="h-4 w-4 text-info" />Add merchant / website analysis</span>}>
          <form onSubmit={create} className="space-y-2">
            <input required className={inp} placeholder="Merchant name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={inp} placeholder="https://public-store.example (public pages only)" value={form.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} />
            <input className={inp} placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Button type="submit" busy={busy === 'create'} disabled={!canWrite}>Create merchant</Button>
          </form>
          <p className="mt-2 text-xs text-muted">URLs are checked for SSRF: only http/https, no localhost, private ranges or cloud metadata addresses; redirects are re-validated; 1 MB / 8 s limits.</p>
          {!merchant.isDemo && merchant.websiteUrl && <div className="mt-3 flex gap-2"><Button variant="ghost" busy={busy === 'crawl'} onClick={preview}><Search className="h-4 w-4" />Preview crawl</Button><Button busy={busy === 'scan'} onClick={websiteScan} disabled={!canWrite}>Run website analysis</Button></div>}
        </Card>
      </div>
      {crawl && (
        <Card className="mt-4" title={`Public observations (${crawl.pagesFetched?.length ?? 0} pages)`}>
          <ul className="mb-3 list-disc pl-5 text-xs text-warn">{crawl.limitations.map((l: string) => <li key={l}>{l}</li>)}</ul>
          <div className="max-h-72 overflow-auto"><table className="w-full text-xs"><tbody>{crawl.observations.map((o: any, i: number) => <tr key={i} className="border-t border-line/60"><td className="py-1.5 pr-3 font-mono text-info">{o.kind}</td><td>{o.text}</td></tr>)}</tbody></table></div>
          {crawl.errors?.length > 0 && <p className="mt-2 text-xs text-muted">Skipped: {crawl.errors.join('; ')}</p>}
        </Card>
      )}
      {merchant.isDemo && (
        <Card className="mt-4" title={<span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-info" />Business rule configuration</span>}>
          <p className="mb-3 text-xs text-muted">Changing a rule re-opens the matching weakness in the sample app. Then run &ldquo;Rerun previous tests&rdquo; in Attack Memory to see the regression get caught.</p>
          {m.data && <div className="divide-y divide-line/60">{RULES.map((r) => { const cur = m.data.config[r.key]; const risky = r.risky(cur); const applied = m.data.appliedFixes.includes(r.fix);
            return (
              <div key={r.key} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><div className="text-sm font-medium">{r.label} {risky && applied && <StatusBadge s="failed" label="fix disabled" />}</div><div className="text-xs text-muted">{r.hint} Related fix: <span className="font-mono">{r.fix}</span>{applied ? ' (applied)' : ' (not applied)'}</div></div>
                <div className="flex gap-1">
                  {(r.key === 'stackableCoupons' ? [[false, 'Off'], [true, 'On']] : r.key === 'refundAllocation' ? [['proportional', 'Proportional'], ['list', 'List price']] : [[true, 'On'], [false, 'Off']]).map(([val, lab]: any) => {
                    const active = cur === val || (cur === undefined && (r.key === 'stackableCoupons' ? val === false : r.key === 'refundAllocation' ? val === 'proportional' : val === true));
                    return <button key={String(val)} disabled={!canWrite} onClick={() => setRule(r.key, val)} className={`rounded-md border px-3 py-1 text-xs ${active ? 'border-info bg-info/15 text-white' : 'border-line text-muted hover:text-ink'}`}>{lab}</button>;
                  })}
                </div></div>); })}</div>}
        </Card>
      )}
      <Card className="mt-4" title={<span className="flex items-center gap-2"><Upload className="h-4 w-4 text-info" />Documents</span>}>
        <p className="mb-3 text-xs text-muted">Business rules, refund policy, sample orders, test configs, or demo-app source. Allowed: .json .txt .md .csv .ts .js · max 1 MB · UTF-8 text only. Files are stored as inert text and <b>never executed</b>.</p>
        <input type="file" accept=".json,.txt,.md,.csv,.ts,.js" disabled={!canWrite || busy === 'up'} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-panel2 file:px-3 file:py-2 file:text-ink" />
        {m.data?.documents?.length > 0 && <table className="mt-3 w-full text-xs"><tbody>{m.data.documents.map((d: any) => <tr key={d.id} className="border-t border-line/60"><td className="py-1.5">{d.filename}</td><td className="text-muted">{d.kind}</td><td className="text-muted">{d.sizeBytes} B</td><td className="font-mono text-muted">{d.sha256.slice(0, 12)}</td></tr>)}</tbody></table>}
      </Card>
    </div>
  );
}
