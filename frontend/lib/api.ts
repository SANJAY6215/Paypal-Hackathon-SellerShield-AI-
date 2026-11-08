'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!res.ok) throw new ApiError(res.status, json?.error || `Request failed (${res.status})`, json?.details);
  return json as T;
}

/** Fetch + optional polling. `refresh` re-runs; polling pauses when `intervalMs` is falsy. */
export function useQuery<T>(path: string | null, intervalMs?: number | false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const alive = useRef(true);
  const load = useCallback(async (silent = false) => {
    if (!path) return;
    if (!silent) setLoading(true);
    try { const d = await api<T>(path); if (alive.current) { setData(d); setError(null); } }
    catch (e: any) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setLoading(false); }
  }, [path]);
  useEffect(() => { alive.current = true; setData(null); load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => {
    if (!intervalMs || !path) return;
    const t = setInterval(() => load(true), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, load, path]);
  return { data, error, loading, refresh: () => load(true), reload: () => load(false), setData };
}

export const usd = (n: number | null | undefined) => (n == null ? '-' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }));
export const when = (s?: string | null) => (s ? new Date(s).toLocaleString() : '-');
