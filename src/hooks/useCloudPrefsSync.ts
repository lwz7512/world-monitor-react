import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { CLOUD_PREFS_APPLIED_EVENT, type CloudPrefsAppliedDetail } from '@/utils/cloud-prefs-sync';
import { invalidatePanelStorageCacheForKeys } from '@/utils/panel-storage';
import { loadFromStorage } from '@/utils';
import { STORAGE_KEYS, SITE_VARIANT } from '@/config';
import type { MapLayers, Monitor, PanelConfig } from '@/types';
import { normalizeExclusiveChoropleths } from '@/components/resilience-choropleth-utils';
import { sanitizeLayersForVariant, type MapVariant } from '@/config/map-layer-definitions';
import { getStoredMapModePreference } from '@/services/map-mode-preference';
import { setMonitorItems } from '@/services/monitors-store';

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';

export function useCloudPrefsSync(): void {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx) return;
    const c = ctx;
    const actions = getPublishedAppActions();
    if (!actions) return;
    const a = actions;

    function applyCloudSyncedPrefsToRuntime(
      keys: readonly string[],
      cloudSyncVersion?: number,
    ): void {
      if (keys.length === 0) return;

      const keySet = new Set(keys);
      invalidatePanelStorageCacheForKeys(keys);

      if (keySet.has(STORAGE_KEYS.panels)) {
        // Cloud can reconcile before Clerk/Convex finishes settling. Preserve
        // the first panel-bearing cloud generation so a later Pro callback can
        // still run the bounded legacy recovery pass.
        if (cloudSyncVersion !== undefined) {
          a.setPendingCloudRecoverySyncVersionIfUnset?.(cloudSyncVersion);
        }
        c.panelSettings = loadFromStorage<Record<string, PanelConfig>>(
          STORAGE_KEYS.panels,
          c.panelSettings,
        );
        // Reconcile the freshly applied snapshot against the current
        // entitlement: a cloud blob written while the tier was unknown can carry
        // a stale free-tier clamp, and `proGated` markers travel with it, so the
        // targeted restore inside enforceFreeTierLimits puts those panels back.
        // Returns false while the tier is still unresolved — the fallback below
        // then just re-renders the snapshot, which is all this handler did
        // before reconciliation moved here.
        const reconciledPanelSettings = a.enforceFreeTierLimits?.(cloudSyncVersion);
        if (!reconciledPanelSettings) {
          a.applyPanelSettings();
          c.unifiedSettings?.refreshPanelToggles();
        }
      }

      const panelOrderKey = c.PANEL_ORDER_KEY;
      if (keySet.has(panelOrderKey) || keySet.has(`${panelOrderKey}-bottom-set`)) {
        a.applySavedPanelOrder?.();
      }

      if (keySet.has(STORAGE_KEYS.mapLayers) && !c.initialUrlState?.layers) {
        const nextLayers = normalizeExclusiveChoropleths(
          sanitizeLayersForVariant(
            loadFromStorage<MapLayers>(STORAGE_KEYS.mapLayers, c.mapLayers),
            SITE_VARIANT as MapVariant,
          ),
          c.mapLayers,
        );
        if (!CYBER_LAYER_ENABLED) nextLayers.cyberThreats = false;
        c.mapLayers = nextLayers;
        c.map?.setLayers(nextLayers);
        a.syncDataFreshnessWithLayers();
      }

      if (keySet.has(STORAGE_KEYS.mapMode)) {
        const mode = getStoredMapModePreference();
        if (mode === 'globe') c.map?.switchToGlobe();
        else c.map?.switchToFlat();
      }

      if (keySet.has(STORAGE_KEYS.disabledFeeds)) {
        c.disabledSources = new Set(loadFromStorage<string[]>(STORAGE_KEYS.disabledFeeds, []));
      }

      if (keySet.has(STORAGE_KEYS.monitors)) {
        c.monitors = loadFromStorage<Monitor[]>(STORAGE_KEYS.monitors, []);
        setMonitorItems(c.monitors);
        a.updateMonitorResults();
      }
    }

    function onCloudPrefsApplied(ev: Event): void {
      const detail = (ev as CustomEvent<CloudPrefsAppliedDetail>).detail;
      applyCloudSyncedPrefsToRuntime(detail?.keys ?? [], detail?.syncVersion);
    }

    window.addEventListener(CLOUD_PREFS_APPLIED_EVENT, onCloudPrefsApplied);
    return () => {
      window.removeEventListener(CLOUD_PREFS_APPLIED_EVENT, onCloudPrefsApplied);
    };
  }, [ctx]);
}
