import { useState, useCallback, useRef, useEffect } from 'react';
import { getHydratedData } from '@/services/bootstrap';
import { useAbortSignal } from './useAbortSignal';
import type { DataBadgeState } from './usePanelState';

export interface PanelDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  dataBadge: DataBadgeState;
  refetch: () => void;
}

export interface PanelDataOptions {
  /** Key for one-shot bootstrap hydration cache */
  hydrationKey?: string;
  /** Auto-refresh interval in ms; omit to disable */
  ttlMs?: number;
}

/**
 * Universal hook for panel data fetching.
 *
 * Tries bootstrap hydration first (one-shot), then falls back to `fetcher`.
 * Automatically aborts in-flight requests on unmount.
 */
export function usePanelData<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  opts: PanelDataOptions = {},
): PanelDataResult<T> {
  const { hydrationKey, ttlMs } = opts;
  const signal = useAbortSignal();

  const [data, setData] = useState<T | null>(() => {
    if (!hydrationKey) return null;
    const hydrated = getHydratedData(hydrationKey);
    return hydrated != null ? (hydrated as T) : null;
  });
  const [loading, setLoading] = useState(() => {
    if (!hydrationKey) return true;
    return getHydratedData(hydrationKey) == null;
  });
  const [error, setError] = useState<string | null>(null);
  const [dataBadge, setDataBadge] = useState<DataBadgeState>(() => {
    if (!hydrationKey) return null;
    return getHydratedData(hydrationKey) != null ? 'cached' : null;
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current(signal);
      if (signal.aborted) return;
      setData(result);
      setDataBadge('live');
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load data');
      setDataBadge('unavailable');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [signal]);

  // Initial fetch (skip if hydration already populated data)
  const hasMounted = useRef(false);
  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    if (data == null) {
      void doFetch();
    }
  }, [data, doFetch]);

  // Periodic refresh
  useEffect(() => {
    if (!ttlMs) return;
    const id = setInterval(() => { void doFetch(); }, ttlMs);
    return () => clearInterval(id);
  }, [ttlMs, doFetch]);

  return { data, loading, error, dataBadge, refetch: doFetch };
}
