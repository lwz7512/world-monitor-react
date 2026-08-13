import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { AppContext as AppContextShape } from '@/app/app-context';
import { subscribeAppContext } from '@/services/app-context-bridge';

interface AppContextValue {
  /** The mutable App context object (imperative core). May be null before App.init() completes. */
  ctx: AppContextShape | null;
  /**
   * Force React components to re-read from ctx when imperative code mutates it.
   * Call this after any significant mutation to trigger panel re-renders.
   */
  refresh: () => void;
}

const AppCtx = createContext<AppContextValue | null>(null);

export function AppContextProvider({ children }: { children?: ReactNode }) {
  const ctxRef = useRef<AppContextShape | null>(null);
  const [, setTick] = useState(0);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  // Wire to the imperative bridge: when App.init() publishes the context,
  // store it and trigger a re-render so useAppContext() starts returning it.
  useEffect(() => {
    return subscribeAppContext((ctx) => {
      ctxRef.current = ctx;
      setTick(t => t + 1);
    });
  }, []);

  return (
    <AppCtx.Provider value={{ ctx: ctxRef.current, refresh }}>
      {children}
    </AppCtx.Provider>
  );
}

/**
 * Access the imperative AppContext. Returns null until App.init() completes.
 * Prefer domain-specific hooks (usePanelData, etc.) for panel-level data fetching.
 */
export function useAppContext(): AppContextShape {
  const value = useContext(AppCtx);
  if (!value) throw new Error('useAppContext must be used within AppContextProvider');
  if (!value.ctx) throw new Error('AppContext not yet initialized — App.init() has not completed');
  return value.ctx;
}

/** Returns null if App.init() has not completed yet (safe for conditional use). */
export function useAppContextMaybe(): AppContextShape | null {
  return useContext(AppCtx)?.ctx ?? null;
}

/**
 * Force React panel re-renders after imperative AppContext mutations.
 * Call this after any direct mutation of ctx fields (e.g. ctx.allNews = [...]).
 */
export function useRefreshAppContext(): () => void {
  const value = useContext(AppCtx);
  if (!value) throw new Error('useRefreshAppContext must be used within AppContextProvider');
  return value.refresh;
}
