import { useState, useCallback, useRef } from 'react';

export type DataBadgeState = 'live' | 'cached' | 'unavailable' | null;

export interface PanelState {
  loading: boolean;
  error: string | null;
  locked: boolean;
  lockedFeatures: string[];
  dataBadge: DataBadgeState;
  count: number | null;
  hasNewItems: boolean;
  newItemCount: number;
}

export interface PanelStateActions {
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  setLocked: (features?: string[]) => void;
  unlock: () => void;
  setDataBadge: (state: DataBadgeState) => void;
  setCount: (n: number | null) => void;
  setNewItems: (count: number) => void;
  clearNewItems: () => void;
}

export function usePanelState(initialLoading = true): [PanelState, PanelStateActions] {
  const [state, setState] = useState<PanelState>({
    loading: initialLoading,
    error: null,
    locked: false,
    lockedFeatures: [],
    dataBadge: null,
    count: null,
    hasNewItems: false,
    newItemCount: 0,
  });

  // Track pre-lock content to restore on unlock (mirrors Panel.ts behavior)
  const preLockContentRef = useRef<string | null>(null);

  const setLoading = useCallback((v: boolean) => {
    setState(s => ({ ...s, loading: v, error: null }));
  }, []);

  const setError = useCallback((msg: string | null) => {
    setState(s => ({ ...s, loading: false, error: msg }));
  }, []);

  const setLocked = useCallback((features: string[] = []) => {
    setState(s => ({ ...s, loading: false, locked: true, lockedFeatures: features }));
  }, []);

  const unlock = useCallback(() => {
    preLockContentRef.current = null;
    setState(s => ({ ...s, locked: false, lockedFeatures: [] }));
  }, []);

  const setDataBadge = useCallback((badge: DataBadgeState) => {
    setState(s => ({ ...s, dataBadge: badge }));
  }, []);

  const setCount = useCallback((n: number | null) => {
    setState(s => ({ ...s, count: n }));
  }, []);

  const setNewItems = useCallback((count: number) => {
    setState(s => ({ ...s, hasNewItems: count > 0, newItemCount: count }));
  }, []);

  const clearNewItems = useCallback(() => {
    setState(s => ({ ...s, hasNewItems: false, newItemCount: 0 }));
  }, []);

  const actions: PanelStateActions = {
    setLoading,
    setError,
    setLocked,
    unlock,
    setDataBadge,
    setCount,
    setNewItems,
    clearNewItems,
  };

  return [state, actions];
}
