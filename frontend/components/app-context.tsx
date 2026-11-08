'use client';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { Spinner } from './ui';

export interface Merchant { id: string; name: string; isDemo: boolean; websiteUrl: string | null; businessType: string; description: string | null }
interface Ctx {
  user: { id: string; name: string; email: string; role: string };
  merchants: Merchant[];
  merchant: Merchant;
  setMerchantId: (id: string) => void;
  reloadMerchants: () => Promise<void>;
  health: { demoMode: boolean; ai: { configured: boolean; mode: string; provider: string | null; model: string | null }; paypalMode: string } | null;
  canWrite: boolean;
}
const C = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(C); if (!c) throw new Error('no app context'); return c; };

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<Ctx['user'] | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [mid, setMid] = useState<string | null>(null);
  const [health, setHealth] = useState<Ctx['health']>(null);

  const reloadMerchants = useCallback(async () => {
    const ms = await api<Merchant[]>('/merchants');
    setMerchants(ms);
    setMid((cur) => cur && ms.some((m) => m.id === cur) ? cur : (ms.find((m) => m.isDemo) || ms[0])?.id ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ user: Ctx['user'] }>('/auth/me');
        setUser(me.user);
        setHealth(await api('/health'));
        await reloadMerchants();
        const saved = typeof window !== 'undefined' ? window.localStorage.getItem('ss_merchant') : null;
        if (saved) setMid((cur) => saved || cur);
      } catch { router.replace('/login'); }
    })();
  }, [router, reloadMerchants]);

  if (!user) return <div className="grid min-h-screen place-items-center"><Spinner label="Loading workspace" /></div>;
  const merchant = merchants.find((m) => m.id === mid) || merchants[0];
  if (!merchant) return <div className="grid min-h-screen place-items-center"><Spinner label="Preparing demo merchant" /></div>;
  return (
    <C.Provider value={{
      user, merchants, merchant, health, reloadMerchants, canWrite: user.role !== 'viewer',
      setMerchantId: (id) => { setMid(id); try { window.localStorage.setItem('ss_merchant', id); } catch { /* storage unavailable */ } },
    }}>{children}</C.Provider>
  );
}
