import type { AppContext } from '@/app/app-context';
import { normalizeExclusiveChoropleths } from '@/components/resilience-choropleth-utils';
import { saveToStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';

export function applyInitialUrlState(ctx: AppContext): void {
  if (!ctx.initialUrlState || !ctx.map) return;

  const { view, zoom, lat, lon, timeRange, layers } = ctx.initialUrlState;

  if (view) {
    ctx.map.setView(view, zoom);
  }

  if (timeRange) {
    ctx.map.setTimeRange(timeRange);
  }

  if (layers) {
    let normalized = normalizeExclusiveChoropleths(layers, ctx.mapLayers);
    if (normalized.resilienceScore && !ctx.map.isDeckGLActive?.()) {
      normalized = { ...normalized, resilienceScore: false };
    }
    ctx.mapLayers = normalized;
    saveToStorage(STORAGE_KEYS.mapLayers, normalized);
    ctx.map.setLayers(normalized);
  }

  if (lat !== undefined && lon !== undefined) {
    ctx.map.setCenter(lat, lon, zoom);
  } else if (!view && zoom !== undefined) {
    ctx.map.setZoom(zoom);
  }

  const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
  const currentView = ctx.map.getState().view;
  if (regionSelect && currentView) {
    regionSelect.value = currentView;
  }
}
