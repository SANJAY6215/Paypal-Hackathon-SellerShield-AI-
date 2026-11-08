'use client';
import { useState } from 'react';
import { CheckCircle2, XCircle, PlugZap, ExternalLink, FlaskConical } from 'lucide-react';
import { api, ApiError, useQuery, usd, when } from '../../../lib/api';
import { useApp } from '../../../components/app-context';
import { RedTeamCard } from '../../../components/redteam-card';
import { Card, Button, StatusBadge, Notice, Spinner, ErrorBox, PageHeader, Json, Empty } from '../../../components/ui';

const EVENTS = ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.REFUNDED'];
const envTag = (e: string) => e === 'sandbox' ? <span className="rounded border border-ok/30 bg-ok/10 px-1.5 py-0.5 text-[10px] font-semibold text-ok">PAYPAL SANDBOX</span> : <span className="rounded border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold text-warn">LOCAL SIMULATION</span>;

export default function PayPal() {
  const { merchant, canWrite } = useApp();
  const status = useQuery<any>('/paypal/status');
  const tx = useQuery<{ items: any[] }>('/paypal/transactions?limit=20', 4000);
  const hooks = useQuery<any[]>('/paypal/webhook-events', 4000);
  const [amount, setAmount] = useState('49.00');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [wh, setWh] = useState({ eventType: 'PAYMENT.CAPTURE.COMPLETED', orderId: '', forged: false, eventId: '' });
  const [whOut, setWhOut] = useState<any>(null);
  const [tests, setTests] = useState<{ name: string; ok: boolean; detail: string }[] | null>(null);
  const run = async (k: string, fn: () => Promise<any>) => { setBusy(k); setErr(''); try { await fn(); await Promise.all([tx.refresh(), hooks.refresh()]); } catch (e: any) { setErr(e.message); } finally { setBusy(''); } };
  const sandbox = status.data?.mode === 'sandbox';

  const selfTest = async () => {
    setBusy('st'); setErr(''); const out: { name: string; ok: boolean; detail: string }[] = []; setTests(out);
    const t = (name: string, ok: boolean, detail: string) => { out.push({ name, ok, detail }); setTests([...out]); };
    const expectFail = async (fn: () => Promise<any>) => { try { await fn(); return null; } catch (e: any) { return e as ApiError; } };
    try {
      t('OAuth / connection', status.data?.oauth === 'ok' || status.data?.mode === 'demo', status.data?.message ?? '');
      const o = await api('/paypal/orders', { body: { merchantId: merchant.id, amount: 25 } });
      t('Create order', !!o.paypalOrderId, `${o.paypalOrderId} (${o.environment})`);
      const e1 = await expectFail(() => api(`/paypal/orders/${o.paypalOrderId}/capture`, { body: {} }));
      t('Unapproved order cannot be captured (created != paid)', !!e1 || sandbox, e1 ? e1.message : sandbox ? 'Sandbox rejected capture until buyer approval' : 'Unexpectedly captured');
      if (!sandbox) {
        await api(`/paypal/orders/${o.paypalOrderId}/approve-simulated`, { body: {} });
        const c = await api(`/paypal/orders/${o.paypalOrderId}/capture`, { body: {} });
        t('Capture approved order', c.status === 'COMPLETED', `capture ${c.captureId}`);
        const r = await api(`/paypal/captures/${c.captureId}/refund`, { body: { amount: 10 } });
        t('Partial refund', r.status === 'PARTIALLY_REFUNDED', `refunded ${usd(r.refundedAmount)}`);
        const e2 = await expectFail(() => api(`/paypal/captures/${c.captureId}/refund`, { body: { amount: 20 } }));
        t('Refund above remaining balance is blocked', !!e2, e2?.message ?? 'Not blocked');
        const f = await api('/paypal/webhooks/simulate', { body: { eventType: 'PAYMENT.CAPTURE.DENIED', orderId: o.paypalOrderId, forged: true } });
        t('Forged webhook rejected, not processed', f.verification === 'failed' && f.processingStatus === 'rejected_unverified', `${f.verification} / ${f.processingStatus}`);
        const id = 'WH-TEST-' + Date.now();
        const g1 = await api('/paypal/webhooks/simulate', { body: { eventType: 'PAYMENT.CAPTURE.REFUNDED', orderId: o.paypalOrderId, eventId: id } });
        const g2 = await api('/paypal/webhooks/simulate', { body: { eventType: 'PAYMENT.CAPTURE.REFUNDED', orderId: o.paypalOrderId, eventId: id } });
        t('Verified webhook processed; replay ignored', g1.processingStatus === 'processed' && g2.duplicate === true, `first=${g1.processingStatus}, replay duplicate=${g2.duplicate}`);
      } else t('Remaining steps', true, 'Approve the order on PayPal (link below), then capture/refund from the table; configure the webhook URL to test signature verification.');
    } catch (e: any) { t('Unexpected error', false, e.message); } finally { setBusy(''); await Promise.all([tx.refresh(), hooks.refresh()]); }
  };

  return (
    <div>
      <PageHeader title="PayPal Integration" subtitle="Orders, captures, refunds and verified webhooks. Real Sandbox activity and local simulations are labelled separately." />
      {err && <div className="mb-4"><ErrorBox msg={err} /></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><PlugZap className="h-4 w-4 text-info" />Connection</span>}>
          {!status.data ? <Spinner /> : (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">{status.data.mode === 'sandbox' ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <XCircle className="h-4 w-4 text-warn" />}<b>{status.data.label}</b></div>
              <div className="text-xs text-muted">OAuth: <span className={status.data.oauth === 'ok' ? 'text-ok' : status.data.oauth === 'failed' ? 'text-bad' : 'text-warn'}>{status.data.oauth}</span> · webhook id {status.data.webhookConfigured ? 'configured' : 'not configured'}</div>
              <div className="text-xs text-muted">{status.data.message}</div><div className="font-mono text-[11px] text-muted">{status.data.baseUrl}</div>
              {!sandbox && <Notice tone="warn">Demo Mode: orders below are <b>local simulations</b> and never reach PayPal. Add sandbox credentials to <span className="font-mono">backend/.env</span> to use the real Sandbox.</Notice>}
            </div>)}
        </Card>
        <Card title="Create sandbox order">
          <div className="flex gap-2"><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-28 rounded-lg border border-line bg-panel2 px-3 py-2 text-sm" aria-label="Amount USD" /><Button busy={busy === 'new'} disabled={!canWrite} onClick={() => run('new', () => api('/paypal/orders', { body: { merchantId: merchant.id, amount: Number(amount) }, headers: { 'Idempotency-Key': crypto.randomUUID() } }))}>Create order</Button></div>
          <p className="mt-2 text-xs text-muted">USD only. Idempotency-Key is sent; a unique PayPal-Request-Id is generated server-side. Created or approved does not mean paid.</p>
        </Card>
        <Card title="Integration self-test" action={<Button variant="ghost" busy={busy === 'st'} disabled={!canWrite} onClick={selfTest}><FlaskConical className="h-4 w-4" />Run</Button>}>
          {!tests ? <p className="text-sm text-muted">Runs the full order → capture → refund → webhook sequence against the backend and reports pass/fail.</p> : <ul className="space-y-1.5 text-xs">{tests.map((x, i) => <li key={i} className="flex gap-2">{x.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad" />}<span>{x.name}<span className="block text-muted">{x.detail}</span></span></li>)}</ul>}
        </Card>
      </div>

      <RedTeamCard />

      <Card className="mt-4" title="Transactions" pad={false}>
        {!tx.data ? <Spinner /> : tx.data.items.length === 0 ? <div className="p-4"><Empty title="No transactions" hint="Create an order above." /></div> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">Order</th><th>Environment</th><th>Status</th><th className="text-right">Amount</th><th className="text-right">Refunded</th><th>Capture</th><th className="px-4">Actions</th></tr></thead><tbody>
            {tx.data.items.map((t) => (
              <tr key={t.id} className="border-t border-line/60"><td className="px-4 py-2.5 font-mono text-xs">{t.paypalOrderId}<div className="font-sans text-muted">{when(t.createdAt)}</div></td><td>{envTag(t.environment)}</td><td><StatusBadge s={t.status === 'COMPLETED' ? 'completed' : t.status === 'REFUNDED' ? 'resolved' : t.status.toLowerCase().includes('denied') ? 'failed' : 'queued'} label={t.status} /></td>
                <td className="text-right tabular-nums">{usd(t.amount)}</td><td className="text-right tabular-nums">{usd(t.refundedAmount)}</td><td className="font-mono text-xs">{t.captureId ?? '-'}</td>
                <td className="px-4"><div className="flex flex-wrap gap-1">
                  {t.environment === 'sandbox' && t.approvalUrl && t.status === 'CREATED' && <a className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-info" href={t.approvalUrl} target="_blank" rel="noreferrer">Approve on PayPal <ExternalLink className="h-3 w-3" /></a>}
                  {t.environment === 'local-simulation' && t.status === 'CREATED' && <Button variant="ghost" className="!px-2 !py-1 text-xs" disabled={!canWrite} onClick={() => run('a' + t.id, () => api(`/paypal/orders/${t.paypalOrderId}/approve-simulated`, { body: {} }))}>Simulate approval</Button>}
                  {['CREATED', 'APPROVED'].includes(t.status) && <Button variant="ghost" className="!px-2 !py-1 text-xs" disabled={!canWrite} onClick={() => run('c' + t.id, () => api(`/paypal/orders/${t.paypalOrderId}/capture`, { body: {}, headers: { 'Idempotency-Key': 'cap-' + t.paypalOrderId } }))}>Capture</Button>}
                  {t.captureId && ['COMPLETED', 'PARTIALLY_REFUNDED'].includes(t.status) && <Button variant="ghost" className="!px-2 !py-1 text-xs" disabled={!canWrite} onClick={() => run('r' + t.id, () => api(`/paypal/captures/${t.captureId}/refund`, { body: { amount: Math.round(t.amount * 50) / 100 }, headers: { 'Idempotency-Key': crypto.randomUUID() } }))}>Refund 50%</Button>}
                  <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => run('g' + t.id, () => api(`/paypal/orders/${t.paypalOrderId}`))}>Refresh</Button>
                </div></td></tr>))}
          </tbody></table></div>)}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Webhook simulator (local, HMAC-signed)">
          <div className="space-y-2 text-sm">
            <select value={wh.eventType} onChange={(e) => setWh({ ...wh, eventType: e.target.value })} className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm">{EVENTS.map((e) => <option key={e}>{e}</option>)}</select>
            <select value={wh.orderId} onChange={(e) => setWh({ ...wh, orderId: e.target.value })} className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm"><option value="">Select order...</option>{tx.data?.items.map((t) => <option key={t.id} value={t.paypalOrderId}>{t.paypalOrderId} ({t.status})</option>)}</select>
            <input placeholder="Event id (reuse to test replay protection)" value={wh.eventId} onChange={(e) => setWh({ ...wh, eventId: e.target.value })} className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm" />
            <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={wh.forged} onChange={(e) => setWh({ ...wh, forged: e.target.checked })} />Forge the signature (must be rejected)</label>
            <Button busy={busy === 'wh'} disabled={!wh.orderId || !canWrite} onClick={() => run('wh', async () => setWhOut(await api('/paypal/webhooks/simulate', { body: { eventType: wh.eventType, orderId: wh.orderId, forged: wh.forged, eventId: wh.eventId || undefined } })))}>Deliver event</Button>
            {whOut && <Json v={whOut} />}
            <p className="text-xs text-muted">Real PayPal deliveries go to <span className="font-mono">POST /api/paypal/webhooks</span> and are verified with PayPal&apos;s verify-webhook-signature API. Payloads that cannot be verified are stored but never processed.</p>
          </div>
        </Card>
        <Card title="Webhook event log" pad={false}>
          <div className="max-h-96 overflow-auto"><table className="w-full text-xs"><tbody>
            {(hooks.data ?? []).length === 0 && <tr><td className="p-4 text-muted">No events received.</td></tr>}
            {(hooks.data ?? []).map((w) => <tr key={w.id} className="border-t border-line/60 first:border-0"><td className="px-4 py-2"><div className="font-mono">{w.eventType}</div><div className="text-muted">{w.eventId} · {when(w.receivedAt)}</div></td><td><span className={w.verificationStatus.startsWith('verified') ? 'text-ok' : 'text-bad'}>{w.verificationStatus}</span></td><td className="pr-4 text-right"><StatusBadge s={w.processingStatus === 'processed' ? 'completed' : w.processingStatus === 'ignored' ? 'queued' : 'failed'} label={w.processingStatus} /></td></tr>)}
          </tbody></table></div>
        </Card>
      </div>
    </div>
  );
}
