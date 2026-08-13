import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';

export function useFindingsBadge() {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx || ctx.isMobile) return;

    void (async () => {
      try {
        const { IntelligenceGapBadge } = await import('@/components/IntelligenceGapBadge');
        if (ctx.isDestroyed) return;
        const badge = new IntelligenceGapBadge();
        badge.setOnSignalClick((signal) => {
          if (ctx.countryBriefPage?.isVisible()) return;
          if (localStorage.getItem('wm-settings-open') === '1') return;
          void ctx.ensureSignalModal()
            .then((signalModal) => { if (!ctx.isDestroyed) signalModal.showSignal(signal); })
            .catch((err) => { console.warn('[SignalModal] Failed to show signal:', err); });
        });
        badge.setOnAlertClick((alert) => {
          if (ctx.countryBriefPage?.isVisible()) return;
          if (localStorage.getItem('wm-settings-open') === '1') return;
          void ctx.ensureSignalModal()
            .then((signalModal) => { if (!ctx.isDestroyed) signalModal.showAlert(alert); })
            .catch((err) => { console.warn('[SignalModal] Failed to show alert:', err); });
        });
        ctx.findingsBadge = badge;
      } catch (error) {
        console.warn('[IntelligenceGapBadge] Lazy init failed:', error);
      }
    })();

    return () => {
      ctx.findingsBadge?.destroy();
      ctx.findingsBadge = null;
    };
  }, [ctx]);
}
