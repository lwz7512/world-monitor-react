import { useEffect } from 'react';
import { SITE_VARIANT } from '@/config';
import { isDesktopRuntime } from '@/services/runtime';
import { trackPanelView } from '@/services/analytics';
import { PizzIntIndicator } from '@/components/PizzIntIndicator';
import { LlmStatusIndicator } from '@/components/LlmStatusIndicator';
import { saveSnapshot } from '@/services';
import { useAppContextMaybe } from '@/context/AppContext';

export function useHeaderClock(): void {
  useEffect(() => {
    const el = document.getElementById('headerClock');
    if (!el) return;
    const tick = () => { el.textContent = new Date().toUTCString().replace('GMT', 'UTC'); };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
}

export function usePizzIntIndicator(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx || SITE_VARIANT !== 'full') return;
    const indicator = new PizzIntIndicator();
    ctx.pizzintIndicator = indicator;
    const headerLeft = ctx.container.querySelector('.header-left');
    headerLeft?.appendChild(indicator.getElement());
  }, [ctx]);
}

export function useLlmStatusIndicator(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx || !isDesktopRuntime()) return;
    const indicator = new LlmStatusIndicator();
    ctx.llmStatusIndicator = indicator;
    const headerRight = ctx.container.querySelector('.header-right');
    headerRight?.appendChild(indicator.getElement());
    return () => { indicator.destroy(); };
  }, [ctx]);
}

export function useStatusPanel(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    void import('@/components/StatusPanel')
      .then(({ StatusPanel }) => {
        if (ctx.isDestroyed) return;
        ctx.statusPanel = new StatusPanel();
      })
      .catch((err) => {
        console.error('[status-panel] failed to lazy-load StatusPanel', err);
      });
  }, [ctx]);
}

export function usePanelViewTracking(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    const viewedPanels = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
          const id = (entry.target as HTMLElement).dataset.panel;
          if (id && !viewedPanels.has(id)) {
            viewedPanels.add(id);
            trackPanelView(id);
          }
        }
      }
    }, { threshold: 0.3 });

    const grid = document.getElementById('panelsGrid');
    if (grid) {
      for (const child of Array.from(grid.children)) {
        if ((child as HTMLElement).dataset.panel) {
          observer.observe(child);
        }
      }
    }
    return () => observer.disconnect();
  }, [ctx]);
}

export function useSnapshotSaving(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    const saveCurrentSnapshot = async () => {
      if (ctx.isPlaybackMode || ctx.isDestroyed) return;
      const marketPrices: Record<string, number> = {};
      ctx.latestMarkets.forEach(m => {
        if (m.price !== null) marketPrices[m.symbol] = m.price;
      });
      await saveSnapshot({
        timestamp: Date.now(),
        events: ctx.latestClusters,
        marketPrices,
        predictions: ctx.latestPredictions.map(p => ({ title: p.title, yesPrice: p.yesPrice })),
        hotspotLevels: ctx.map?.getHotspotLevels() ?? {},
      });
    };
    void saveCurrentSnapshot().catch(e => console.warn('[Snapshot] save failed:', e));
    const id = setInterval(
      () => void saveCurrentSnapshot().catch(e => console.warn('[Snapshot] save failed:', e)),
      15 * 60 * 1000,
    );
    return () => clearInterval(id);
  }, [ctx]);
}
