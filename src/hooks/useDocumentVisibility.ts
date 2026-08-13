import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { isDesktopRuntime } from '@/services/runtime';
import { mlWorker } from '@/services/ml-worker';
import { getPublishedAppActions } from '@/services/app-actions-bridge';

export function useDocumentVisibility(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    const handler = () => {
      document.body?.classList.toggle('animations-paused', document.hidden);
      if (isDesktopRuntime()) {
        ctx.map?.setRenderPaused(document.hidden);
      }
      const actions = getPublishedAppActions();
      if (document.hidden) {
        actions?.setHiddenSince(Date.now());
        mlWorker.unloadOptionalModels();
      } else {
        actions?.resetIdleTimer();
        actions?.flushStaleRefreshes();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [ctx]);
}
