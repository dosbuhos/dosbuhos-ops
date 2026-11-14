// API client. Relative URLs so the app works under the Hub's /growth/ prefix. Writes carry X-Growth-Request.
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`api/${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'X-Growth-Request': '1' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, data?.message ?? `HTTP ${res.status}`);
  return data as T;
}

/** Fetch + refresh every `everyMs` (60–120 s for dashboards). Keeps the last good data on error (shown as stale). */
export function useApi<T = any>(path: string | null, everyMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path) return;
    try { const d = await api<T>(path); if (alive.current) { setData(d); setError(null); setLoadedAt(Date.now()); } }
    catch (e) { if (alive.current) setError((e as Error).message); }
  }, [path]);
  useEffect(() => {
    alive.current = true; void load();
    const t = everyMs ? setInterval(() => { if (document.visibilityState === 'visible') void load(); }, everyMs) : undefined;
    return () => { alive.current = false; if (t) clearInterval(t); };
  }, [load, everyMs]);
  return { data, error, loadedAt, reload: load };
}
