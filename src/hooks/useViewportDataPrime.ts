import { useEffect, useRef } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';

export function useViewportDataPrime(): void {
  const ctx = useAppContextMaybe();
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ctx?.dataLoader) return;
    const loader = ctx.dataLoader;

    const c = ctx;
    function onViewportChange(): void {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        void c.primeVisiblePanelData?.();
        // loadAllData covers panels primeVisiblePanelData does not (news,
        // markets, intelligence, fred, …). Both are viewport-gated and
        // inflight-guarded — repeat invocations are cheap.
        void loader.loadAllData();
      });
    }

    window.addEventListener('scroll', onViewportChange, { passive: true });
    window.addEventListener('resize', onViewportChange);

    return () => {
      window.removeEventListener('scroll', onViewportChange);
      window.removeEventListener('resize', onViewportChange);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [ctx]);
}
