import type { AppContext } from '@/app/app-context';
import type { MapLayers } from '@/types';
import { isProUser } from '@/services/widget-store';
import {
  FREE_MAX_PANELS,
  countFreePanelCapUsage,
  isFreePanelCapCounted,
} from '@/config/panels';
import {
  buildMapUrl,
  saveToStorage,
  showToast,
} from '@/utils';
import {
  STORAGE_KEYS,
  LAYER_TO_SOURCE,
} from '@/config';
import {
  initAisStream,
  disconnectAisStream,
} from '@/services';
import {
  trackMapLayerToggle,
  trackPanelToggled,
} from '@/services/analytics';
import { dataFreshness } from '@/services/data-freshness';
import { t } from '@/services/i18n';

export function enablePanelById(
  ctx: AppContext,
  applyPanelSettingsFn: () => void,
  panelId: string,
): boolean {
  const config = ctx.panelSettings[panelId];
  if (!config) return false;
  if (config.enabled) return true;
  if (!isProUser() && isFreePanelCapCounted(panelId)) {
    const enabledCount = countFreePanelCapUsage(ctx.panelSettings);
    if (enabledCount >= FREE_MAX_PANELS) {
      showToast(t('modals.settingsWindow.freePanelLimit', { max: String(FREE_MAX_PANELS) }));
      return false;
    }
  }
  config.enabled = true;
  trackPanelToggled(panelId, true);
  saveToStorage(STORAGE_KEYS.panels, ctx.panelSettings);
  applyPanelSettingsFn();
  ctx.unifiedSettings?.refreshPanelToggles();

  const panel = ctx.panels[panelId];
  if (panel && 'fetchData' in panel && typeof (panel as { fetchData: unknown }).fetchData === 'function') {
    (panel as { fetchData: () => void }).fetchData();
  }
  return true;
}

export interface MapLayerChangeCallbacks {
  waitForAisData: () => void;
  loadDataForLayer: (layer: string) => void;
  stopLayerActivity?: (layer: keyof MapLayers) => void;
  syncUrlState: () => void;
}

export function applyMapLayerChange(
  ctx: AppContext,
  callbacks: MapLayerChangeCallbacks,
  layer: keyof MapLayers,
  enabled: boolean,
  source: 'user' | 'programmatic',
): void {
  console.log(`[App.onLayerChange] ${layer}: ${enabled} (${source})`);
  trackMapLayerToggle(layer, enabled, source);
  ctx.mapLayers[layer] = enabled;
  saveToStorage(STORAGE_KEYS.mapLayers, ctx.mapLayers);
  callbacks.syncUrlState();

  const sourceIds = LAYER_TO_SOURCE[layer];
  if (sourceIds) {
    for (const sourceId of sourceIds) {
      dataFreshness.setEnabled(sourceId, enabled);
    }
  }

  if (layer === 'ais') {
    if (enabled) {
      ctx.map?.setLayerLoading('ais', true);
      initAisStream();
      callbacks.waitForAisData();
    } else {
      disconnectAisStream();
    }
    return;
  }

  if (enabled) {
    callbacks.loadDataForLayer(layer);
  } else {
    callbacks.stopLayerActivity?.(layer);
  }
}

export function getShareUrl(ctx: AppContext): string | null {
  if (!ctx.map) return null;
  const state = ctx.map.getState();
  const center = ctx.map.getCenter();
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const briefPage = ctx.countryBriefPage;
  const isCountryVisible = briefPage?.isVisible() ?? false;
  return buildMapUrl(baseUrl, {
    view: state.view,
    zoom: state.zoom,
    center,
    timeRange: state.timeRange,
    layers: state.layers,
    country: isCountryVisible ? (briefPage?.getCode() ?? undefined) : undefined,
    expanded: isCountryVisible && briefPage?.getIsMaximized?.() ? true : undefined,
    chokepoint: !isCountryVisible ? (ctx.activeChokepoint ?? undefined) : undefined,
  });
}
