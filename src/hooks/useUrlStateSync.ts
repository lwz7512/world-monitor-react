import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { debounce } from '@/utils';

export function useUrlStateSync(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx?.map) return;
    const actions = getPublishedAppActions();
    if (!actions) return;

    const debouncedWebcamReload = debounce(() => {
      if (ctx.mapLayers?.webcams) {
        actions.loadDataForLayer('webcams');
      }
    }, 350);

    ctx.map.onStateChanged(() => {
      actions.syncUrlState();
      const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
      if (regionSelect) {
        const state = ctx.map!.getState();
        if (regionSelect.value !== state.view) {
          regionSelect.value = state.view;
        }
      }
      debouncedWebcamReload();
    });

    // Skip the immediate sync only when applyInitialUrlState() will start an
    // async flyTo that makes getCenter() return stale intermediate coordinates.
    const { view, lat, lon, zoom, chokepoint } = ctx.initialUrlState ?? {};
    const urlHasAsyncFlyTo =
      (lat !== undefined && lon !== undefined) ||
      (!view && zoom !== undefined) ||
      chokepoint !== undefined;
    if (!urlHasAsyncFlyTo) {
      actions.syncUrlState();
    }

    return () => {
      debouncedWebcamReload.cancel();
    };
  }, [ctx]);
}
