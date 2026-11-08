'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldHalf } from 'lucide-react';
import { api } from '../../lib/api';
import { Button, Card, ErrorBox } from '../../components/ui';

export default function Login() {
  const r = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api(`/auth/${mode}`, { body: f }); r.push('/dashboard'); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  const demo = async () => { setBusy(true); setErr(''); try { await api('/auth/demo', { body: {} }); r.push('/demo'); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } };
  const inp = 'w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-info';
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2 text-lg font-semibold"><ShieldHalf className="h-6 w-6 text-info" />SellerShield AI</Link>
        <Card>
          <form onSubmit={submit} className="space-y-3">
            <h1 className="text-base font-semibold">{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
            {mode === 'register' && <input required className={inp} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
            <input required type="email" className={inp} placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <input required type="password" minLength={8} className={inp} placeholder="Password (min 8 characters)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            {err && <ErrorBox msg={err} />}
            <Button type="submit" busy={busy} className="w-full">{mode === 'login' ? 'Sign in' : 'Create account'}</Button>
            <button type="button" className="w-full text-center text-xs text-muted hover:text-ink" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'No account? Register' : 'Have an account? Sign in'}</button>
          </form>
          <div className="my-4 border-t border-line" />
          <Button variant="ghost" className="w-full" onClick={demo} busy={busy}>Explore Live Demo (no sign-up)</Button>
          <p className="mt-2 text-center text-[11px] text-muted">Demo mode uses a controlled sample merchant and a local simulator.</p>
        </Card>
      </div>
    </div>
  );
}
