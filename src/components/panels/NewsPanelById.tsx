import { useEffect, useRef } from 'react';
import { NewsPanelContent, NewsPanelStore } from '@/components/panels/NewsPanelContent';
import { registerNewsStore, unregisterNewsStore } from '@/services/news-panel-registry';
import { useAppContextMaybe } from '@/context/AppContext';
import { t } from '@/services/i18n';
import { handleRelatedAssetClick } from '@/app/related-asset-click';
import { filterItemsByTimeRange, getTimeRangeLabel } from '@/app/news-time-filter';
import { computeEventRisk } from '@/app/news-panel-utils';

interface Props { panelId: string; }

export function NewsPanelById({ panelId }: Props) {
  const storeRef = useRef<NewsPanelStore | null>(null);
  if (!storeRef.current) {
    const title = t(`panels.${panelId}`) ?? panelId;
    storeRef.current = new NewsPanelStore(panelId, title, undefined);
    storeRef.current.setRiskScoreGetter(computeEventRisk);
    registerNewsStore(panelId, storeRef.current);
  }

  const ctx = useAppContextMaybe();

  // Wire related-asset handlers and clean up store registration on unmount.
  useEffect(() => {
    const store = storeRef.current!;
    if (ctx) {
      store.setRelatedAssetHandlers({
        onRelatedAssetClick: (asset) => handleRelatedAssetClick(asset, ctx),
        onRelatedAssetsFocus: (assets) => ctx.map?.highlightAssets(assets),
        onRelatedAssetsClear: () => ctx.map?.highlightAssets(null),
      });
    }
    return () => { unregisterNewsStore(panelId); };
  }, [panelId, ctx]);

  // Backfill on PRESENCE: if news data already loaded before this component mounted,
  // render it now. Mirrors the backfill logic from createNewsPanelWithLabel so a
  // late-mounting panel shows data instead of spinning until the 20-min refresh (#5376).
  useEffect(() => {
    if (!ctx) return;
    const store = storeRef.current!;
    // Only backfill if the store is still in its initial idle state (no data yet).
    if (store.mode !== 'idle') return;
    const existingItems = ctx.newsByCategory[panelId];
    if (!existingItems) return;
    const filteredItems = filterItemsByTimeRange(existingItems, ctx.currentTimeRange);
    if (filteredItems.length === 0 && existingItems.length > 0) {
      store.renderFilteredEmpty(`No items in ${getTimeRangeLabel(ctx.currentTimeRange)}`);
    } else {
      store.renderNews(filteredItems);
    }
  }, [panelId, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  return <NewsPanelContent store={storeRef.current} />;
}
