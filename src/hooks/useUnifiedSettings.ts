import { useEffect } from 'react';
import type { UnifiedSettingsController, UnifiedSettingsTabId } from '@/app/app-context';
import type { UnifiedSettingsConfig } from '@/components/UnifiedSettings';
import type { PanelConfig } from '@/types';
import { useAppContextMaybe } from '@/context/AppContext';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { saveToStorage, showToast } from '@/utils';
import { clearPanelColSpans, clearPanelSpans } from '@/utils/panel-storage';
import { STORAGE_KEYS, FEEDS, CANONICAL_FEEDS, INTEL_SOURCES } from '@/config';
import { resolveNewsCategories, enabledNewsCategoryKeys } from '@/config/feed-resolution';
import { isProUser } from '@/services/widget-store';
import { FREE_MAX_SOURCES } from '@/config/panels';
import { trackPanelToggled } from '@/services/analytics';
import { t } from '@/services/i18n';
import { createSettingsButton } from '@/components/settings-button';
import { overlayHistory, type OverlayId } from '@/utils/overlay-history';
import { WM_OPEN_NOTIFICATIONS_FOR_COUNTRY } from '@/utils/notify-country-link';

function removeStorageValue(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ok */ }
}

type RealUnifiedSettings = import('@/components/UnifiedSettings').UnifiedSettings;

class LazyUnifiedSettings implements UnifiedSettingsController {
  private readonly button: HTMLButtonElement;
  private instance: RealUnifiedSettings | null = null;
  private loadPromise: Promise<RealUnifiedSettings> | null = null;
  private destroyed = false;
  private openEpoch = 0;

  constructor(private readonly config: UnifiedSettingsConfig) {
    this.button = createSettingsButton(() => this.open());
  }

  getButton(): HTMLButtonElement { return this.button; }

  open(tab?: UnifiedSettingsTabId, replaceOverlayId?: OverlayId, historyPending = false): void {
    const epoch = ++this.openEpoch;
    const pendingId: OverlayId = 'settings-pending';
    const pendingGate = historyPending
      ? overlayHistory.beginPending(pendingId, replaceOverlayId, () => { this.openEpoch += 1; })
      : null;
    void this.load().then((settings) => {
      if (this.destroyed || this.openEpoch !== epoch) return;
      if (pendingGate && !pendingGate.isCurrent()) return;
      settings.open(tab, pendingGate ? pendingId : replaceOverlayId);
    }).catch((error) => {
      const actionWasCancelled = pendingGate !== null && !pendingGate.isCurrent();
      if (this.destroyed || actionWasCancelled) return;
      console.warn('[settings] Failed to load settings window:', error);
      pendingGate?.cancel();
      showToast(t('common.error'));
    });
  }

  refreshPanelToggles(): void { this.instance?.refreshPanelToggles(); }
  close(): void { this.instance?.close(); }
  hasPendingChanges(): boolean { return this.instance?.hasPendingChanges() ?? false; }

  destroy(): void {
    this.destroyed = true;
    this.instance?.destroy();
    this.instance = null;
  }

  private load(): Promise<RealUnifiedSettings> {
    if (this.destroyed) return Promise.reject(new Error('Settings controller destroyed'));
    if (this.instance) return Promise.resolve(this.instance);
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = import('@/components/UnifiedSettings')
      .then(({ UnifiedSettings }) => {
        const settings = new UnifiedSettings(this.config);
        if (this.destroyed) {
          settings.destroy();
          throw new Error('Settings controller destroyed during load');
        }
        this.instance = settings;
        return settings;
      })
      .finally(() => { this.loadPromise = null; });

    return this.loadPromise;
  }
}

export function useUnifiedSettings(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    const actions = getPublishedAppActions();
    if (!actions) return;

    const getAllSourceNames = (): string[] => {
      const sources = new Set<string>();
      const categories = resolveNewsCategories(FEEDS, CANONICAL_FEEDS, enabledNewsCategoryKeys(ctx.newsCategoryPanelKeys, ctx.panelSettings));
      categories.forEach(({ feeds }) => feeds.forEach(f => sources.add(f.name)));
      INTEL_SOURCES.forEach(f => sources.add(f.name));
      return Array.from(sources).sort((a, b) => a.localeCompare(b));
    };

    const getLocalizedPanelName = (panelKey: string, fallback: string): string => {
      if (panelKey === 'runtime-config') return t('modals.runtimeConfig.title');
      const key = panelKey.replace(/-([a-z])/g, (_match, group: string) => group.toUpperCase());
      const lookup = `panels.${key}`;
      const localized = t(lookup);
      return localized === lookup ? fallback : localized;
    };

    const applyPanelSettings = (): void => {
      Object.entries(ctx.panelSettings).forEach(([key, config]) => {
        if (key === 'map') {
          const mapSection = document.getElementById('mapSection');
          if (mapSection) {
            mapSection.classList.toggle('hidden', !config.enabled);
            document.querySelector('.main-content')?.classList.toggle('map-hidden', !config.enabled);
            actions.ensureCorrectZones();
          }
          return;
        }
        const panel = ctx.panels[key];
        const liveMedia = panel as { stopLiveMediaForClose?: () => void; resumeLiveMediaForShow?: () => void } | undefined;
        if (!config.enabled) {
          if (key === 'live-news') window.dispatchEvent(new CustomEvent('wm:live-news-stop'));
          liveMedia?.stopLiveMediaForClose?.();
        }
        panel?.toggle(config.enabled);
        if (config.enabled) {
          if (key === 'live-news') window.dispatchEvent(new CustomEvent('wm:live-news-resume'));
          liveMedia?.resumeLiveMediaForShow?.();
        }
      });
    };

    ctx.unifiedSettings = new LazyUnifiedSettings({
      getPanelSettings: () => ctx.panelSettings,
      savePanelSettings: (panels: Record<string, PanelConfig>) => {
        Object.entries(panels).forEach(([key, nextConfig]) => {
          const current = ctx.panelSettings[key];
          if (!current) {
            ctx.panelSettings[key] = { ...nextConfig };
            trackPanelToggled(key, nextConfig.enabled);
            return;
          }
          if (current.enabled !== nextConfig.enabled) {
            trackPanelToggled(key, nextConfig.enabled);
          }
          Object.assign(current, nextConfig);
        });
        saveToStorage(STORAGE_KEYS.panels, ctx.panelSettings);
        applyPanelSettings();
        actions.updateSearchIndex();
      },
      getDisabledSources: () => ctx.disabledSources,
      toggleSource: (name: string) => {
        const reenabling = ctx.disabledSources.has(name);
        if (reenabling && !isProUser()) {
          const allSources = getAllSourceNames();
          const currentlyEnabled = allSources.filter(n => !ctx.disabledSources.has(n)).length;
          if (currentlyEnabled + 1 > FREE_MAX_SOURCES) {
            showToast(t('modals.settingsWindow.freeSourceLimit', { max: String(FREE_MAX_SOURCES) }));
            return;
          }
        }
        if (reenabling) ctx.disabledSources.delete(name);
        else ctx.disabledSources.add(name);
        saveToStorage(STORAGE_KEYS.disabledFeeds, Array.from(ctx.disabledSources));
      },
      setSourcesEnabled: (names: string[], enabled: boolean) => {
        if (enabled && !isProUser()) {
          const allSources = getAllSourceNames();
          const currentlyEnabled = allSources.filter(n => !ctx.disabledSources.has(n)).length;
          const wouldEnable = names.filter(n => ctx.disabledSources.has(n) && allSources.includes(n)).length;
          if (currentlyEnabled + wouldEnable > FREE_MAX_SOURCES) {
            showToast(t('modals.settingsWindow.freeSourceLimit', { max: String(FREE_MAX_SOURCES) }));
            return;
          }
        }
        for (const name of names) {
          if (enabled) ctx.disabledSources.delete(name);
          else ctx.disabledSources.add(name);
        }
        saveToStorage(STORAGE_KEYS.disabledFeeds, Array.from(ctx.disabledSources));
      },
      getAllSourceNames,
      getLocalizedPanelName,
      resetLayout: () => {
        clearPanelSpans();
        clearPanelColSpans();
        removeStorageValue(ctx.PANEL_ORDER_KEY);
        removeStorageValue(ctx.PANEL_ORDER_KEY + '-bottom');
        removeStorageValue(ctx.PANEL_ORDER_KEY + '-bottom-set');
        removeStorageValue('map-height');
        window.location.reload();
      },
      isDesktopApp: ctx.isDesktopApp,
      onMapProviderChange: () => { ctx.map?.reloadBasemap(); },
    });

    const mount = document.getElementById('unifiedSettingsMount');
    if (mount) mount.appendChild(ctx.unifiedSettings.getButton());

    const ac = new AbortController();
    document.getElementById('mobileSettingsBtn')?.addEventListener(
      'click', () => ctx.unifiedSettings?.open(), { signal: ac.signal },
    );

    // U8 (degraded path) — open notifications tab when a country deep-dive triggers it.
    // AbortController signal handles cleanup, preventing stale-closure accumulation on
    // same-document reinit (HMR, test harnesses, multiple App instances).
    window.addEventListener(
      WM_OPEN_NOTIFICATIONS_FOR_COUNTRY,
      () => { ctx.unifiedSettings?.open('notifications'); },
      { signal: ac.signal },
    );

    return () => {
      ac.abort();
      ctx.unifiedSettings?.destroy();
      ctx.unifiedSettings = null;
    };
  }, [ctx]);
}
