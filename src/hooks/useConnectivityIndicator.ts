import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { getBootstrapHydrationState, type BootstrapHydrationState } from '@/services/bootstrap';
import { describeFreshness } from '@/services/persistent-cache';
import { t } from '@/services/i18n';

export function useConnectivityIndicator() {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx) return;
    const c = ctx;
    let bannerEl: HTMLElement | null = null;

    function getCachedUpdatedAt(state: BootstrapHydrationState): number | null {
      const cachedTierTimestamps = Object.values(state.tiers)
        .filter((tier) => tier.source === 'cached')
        .map((tier) => tier.updatedAt)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      if (cachedTierTimestamps.length === 0) return null;
      return Math.min(...cachedTierTimestamps);
    }

    function update() {
      const state = getBootstrapHydrationState();
      const statusIndicator = c.container.querySelector('.status-indicator');
      const statusLabel = statusIndicator?.querySelector('span:last-child');
      const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
      const usingCachedBootstrap = state.source === 'cached';
      const cachedUpdatedAt = getCachedUpdatedAt(state);

      let statusMode: 'live' | 'cached' | 'unavailable' = 'live';
      let bannerMessage: string | null = null;

      if (!online) {
        const hasAnyCached = state.source === 'cached' || state.source === 'mixed';
        if (hasAnyCached) {
          statusMode = 'cached';
          const offlineCachedAt = state.tiers
            ? Math.min(...Object.values(state.tiers)
                .filter((tier) => tier.source === 'cached' || tier.source === 'mixed')
                .map((tier) => tier.updatedAt)
                .filter((v): v is number => typeof v === 'number' && Number.isFinite(v)))
            : NaN;
          const freshness = Number.isFinite(offlineCachedAt) ? describeFreshness(offlineCachedAt) : t('common.cached').toLowerCase();
          bannerMessage = t('connectivity.offlineCached', { freshness });
        } else {
          statusMode = 'unavailable';
          bannerMessage = t('connectivity.offlineUnavailable');
        }
      } else if (usingCachedBootstrap) {
        statusMode = 'cached';
        const freshness = cachedUpdatedAt ? describeFreshness(cachedUpdatedAt) : t('common.cached').toLowerCase();
        bannerMessage = t('connectivity.cachedFallback', { freshness });
      }

      if (statusIndicator && statusLabel) {
        statusIndicator.classList.toggle('status-indicator--cached', statusMode === 'cached');
        statusIndicator.classList.toggle('status-indicator--unavailable', statusMode === 'unavailable');
        statusLabel.textContent = statusMode === 'live'
          ? t('header.live')
          : statusMode === 'cached'
            ? t('header.cached')
            : t('header.unavailable');
      }

      if (bannerMessage) {
        if (!bannerEl) {
          bannerEl = document.createElement('div');
          // CSS disables pointer events on this status-only container. Keep its descendants
          // non-interactive unless the banner interaction model is updated with it.
          bannerEl.className = 'cached-mode-banner';
          bannerEl.setAttribute('role', 'status');
          bannerEl.setAttribute('aria-live', 'polite');

          const badge = document.createElement('span');
          badge.className = 'cached-mode-banner__badge';
          const text = document.createElement('span');
          text.className = 'cached-mode-banner__text';
          bannerEl.append(badge, text);

          const header = c.container.querySelector('.header');
          if (header?.parentElement) {
            header.insertAdjacentElement('afterend', bannerEl);
          } else {
            c.container.prepend(bannerEl);
          }
        }

        bannerEl.classList.toggle('cached-mode-banner--unavailable', statusMode === 'unavailable');
        const badge = bannerEl.querySelector('.cached-mode-banner__badge')!;
        const text = bannerEl.querySelector('.cached-mode-banner__text')!;
        badge.textContent = statusMode === 'cached' ? t('header.cached') : t('header.unavailable');
        text.textContent = bannerMessage;
        return;
      }

      bannerEl?.remove();
      bannerEl = null;
    }

    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    document.addEventListener('wm:bootstrap-state-changed', update);

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      document.removeEventListener('wm:bootstrap-state-changed', update);
      bannerEl?.remove();
    };
  }, [ctx]);
}
