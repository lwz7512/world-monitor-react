import type { Monitor, MapLayers } from '@/types';
import { normalizeExclusiveChoropleths } from '@/components/resilience-choropleth-utils';
import type { AppContext } from '@/app/app-context';
import {
  STORAGE_KEYS,
  SITE_VARIANT,
} from '@/config';
import { sanitizeLayersForVariant } from '@/config/map-layer-definitions';
import type { MapVariant } from '@/config/map-layer-definitions';
import { loadFromStorage, parseMapUrlState, isMobileDevice, showToast, debounce } from '@/utils';
import type { ParsedMapUrlState } from '@/utils';
import { isDesktopRuntime } from '@/services/runtime';
import { track } from '@/services/analytics';
import { CountryIntelManager } from '@/app/country-intel';
import { SearchLauncher } from '@/app/search-launcher';
import { RefreshScheduler } from '@/app/refresh-scheduler';
import { PanelLayoutManager } from '@/app/panel-layout';
import { DataLoaderManager } from '@/app/data-loader';
import type { EventHandlerCallbacks } from '@/app/event-handlers';
import { MobilePrimaryNav } from '@/app/mobile-primary-nav';
import { overlayHistory } from '@/utils/overlay-history';
import { FreeTierGate } from '@/app/free-tier-gate';
import { enforceFreeTierLimits } from '@/app/enforce-free-tier';
import { primeVisiblePanelData } from '@/app/panel-primer';
import { initializePanelAndMapSettings, runSourceMigrations } from '@/app/panel-settings-init';
import { publishAppActions } from '@/services/app-actions-bridge';
import { enablePanelById, applyMapLayerChange, getShareUrl } from '@/app/panel-actions';

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';

export type { CountryBriefSignals } from '@/app/app-context';

export interface AppManagers {
  state: AppContext;
  panelLayout: PanelLayoutManager;
  dataLoader: DataLoaderManager;
  countryIntel: CountryIntelManager;
  refreshScheduler: RefreshScheduler;
  mobilePrimaryNav: MobilePrimaryNav;
  searchLauncher: SearchLauncher;
  modules: { destroy(): void }[];
  syncUrlState: () => void;
  handleWmSessionDegraded: () => void;
}

export function createAppManagers(containerId: string): AppManagers {
  const el = document.getElementById(containerId);
  if (!el) throw new Error(`Container ${containerId} not found`);

  let resolveUiReadyFn!: () => void;
  const uiReadyPromise = new Promise<void>((resolve) => { resolveUiReadyFn = resolve; });

  const PANEL_ORDER_KEY = 'panel-order';
  const PANEL_SPANS_KEY = 'worldmonitor-panel-spans';

  const isMobile = isMobileDevice();
  const isDesktopApp = isDesktopRuntime();
  const monitors = loadFromStorage<Monitor[]>(STORAGE_KEYS.monitors, []);
  const currentVariant = SITE_VARIANT;

  const { mapLayers: initMapLayers, panelSettings, storageAvailable } = initializePanelAndMapSettings({
    isMobile,
    isDesktopApp,
    currentVariant,
    PANEL_ORDER_KEY,
    PANEL_SPANS_KEY,
  });
  let mapLayers = initMapLayers;

  const initialUrlState: ParsedMapUrlState | null = parseMapUrlState(window.location.search, mapLayers);
  if (initialUrlState.layers) {
    mapLayers = normalizeExclusiveChoropleths(
      sanitizeLayersForVariant(initialUrlState.layers, currentVariant as MapVariant), null,
    );
    initialUrlState.layers = mapLayers;
  }
  if (!CYBER_LAYER_ENABLED) {
    mapLayers.cyberThreats = false;
  }

  runSourceMigrations(currentVariant, storageAvailable);

  const disabledSources = new Set(loadFromStorage<string[]>(STORAGE_KEYS.disabledFeeds, []));

  // Use `let` for managers that are forward-referenced in each other's
  // callbacks. All callbacks are lambdas, so the references are only resolved
  // at call time — not at the time the closures are created — which is safe as
  // long as the manager is assigned before any callback is invoked.
  // eslint-disable-next-line prefer-const
  let searchLauncher!: SearchLauncher;
  // eslint-disable-next-line prefer-const
  let panelLayout!: PanelLayoutManager;
  // eslint-disable-next-line prefer-const
  let mobilePrimaryNav!: MobilePrimaryNav;

  // Build shared state object
  const state: AppContext = {
    map: null,
    isMobile,
    isDesktopApp,
    container: el,
    panels: {},
    newsCategoryPanelKeys: new Map(),
    panelSettings,
    mapLayers,
    allNews: [],
    newsByCategory: {},
    latestMarkets: [],
    latestPredictions: [],
    latestTechEvents: [],
    latestClusters: [],
    intelligenceCache: {},
    cyberThreatsCache: null,
    disabledSources,
    currentTimeRange: '7d',
    inFlight: new Set(),
    visiblePanelPrimed: new Set(),
    seenGeoAlerts: new Set(),
    monitors,
    signalModal: null,
    ensureSignalModal: () => searchLauncher.ensureSignalModal(),
    statusPanel: null,
    searchModal: null,
    findingsBadge: null,
    breakingBanner: null,
    playbackControl: null,
    exportPanel: null,
    unifiedSettings: null,
    pizzintIndicator: null,
    correlationEngine: null,
    llmStatusIndicator: null,
    countryBriefPage: null,
    countryTimeline: null,
    positivePanel: null,
    countersPanel: null,
    progressPanel: null,
    breakthroughsPanel: null,
    heroPanel: null,
    digestPanel: null,
    speciesPanel: null,
    renewablePanel: null,
    authModal: null,
    authHeaderWidget: null,
    tvMode: null,
    mobilePanelNav: null,
    happyAllItems: [],
    isDestroyed: false,
    uiReady: uiReadyPromise,
    resolveUiReady: resolveUiReadyFn,
    isPlaybackMode: false,
    isIdle: false,
    initialLoadComplete: false,
    resolvedLocation: 'global',
    activeChokepoint: initialUrlState.chokepoint ?? null,
    initialUrlState,
    PANEL_ORDER_KEY,
    PANEL_SPANS_KEY,
    refreshScheduler: null,
    dataLoader: null,
    primeVisiblePanelData: undefined,
    freeTierGate: null,
    pendingCloudRecoverySyncVersion: undefined,
  };

  // Instantiate modules (callbacks wired after all modules exist)
  const refreshScheduler = new RefreshScheduler(state);
  state.refreshScheduler = refreshScheduler;
  const countryIntel = new CountryIntelManager(state);

  const dataLoader = new DataLoaderManager(state, {
    renderCriticalBanner: (postures) => panelLayout.renderCriticalBanner(postures),
    refreshOpenCountryBrief: () => countryIntel.refreshOpenBrief(),
  });
  state.dataLoader = dataLoader;
  state.primeVisiblePanelData = (forceAll = false) => primeVisiblePanelData(state, forceAll);

  // Debounced URL sync (replaces EventHandlerManager.syncUrlState)
  const debouncedUrlSync = debounce(() => {
    const shareUrl = getShareUrl(state);
    if (!shareUrl) return;
    try { history.replaceState(history.state, '', shareUrl); } catch { }
  }, 250);
  const syncUrlState = () => debouncedUrlSync();

  const applyMapLayerChangeFn = (layer: keyof MapLayers, enabled: boolean, source: 'user' | 'programmatic') =>
    applyMapLayerChange(state, {
      waitForAisData: () => dataLoader.waitForAisData(),
      loadDataForLayer: (l) => { void dataLoader.loadDataForLayer(l as keyof MapLayers); },
      stopLayerActivity: (l) => dataLoader.stopLayerActivity(l),
      syncUrlState: () => syncUrlState(),
    }, layer, enabled, source);

  panelLayout = new PanelLayoutManager(state, {
    openSearch: () => {
      track('search-open', { source: 'pro-onboarding' });
      void searchLauncher.openSearch();
    },
    loadAllData: () => dataLoader.loadAllData(),
    loadSecurityAdvisories: () => dataLoader.loadSecurityAdvisories(),
    applyMapLayerChange: applyMapLayerChangeFn,
    isFreeTierFallbackActive: () => state.freeTierGate?.authSettleDeadlineExceeded ?? false,
  });

  state.freeTierGate = new FreeTierGate(() => {
    enforceFreeTierLimits(state, () => panelLayout.applyPanelSettings());
    panelLayout.healStoredTabSnapshots();
  });

  mobilePrimaryNav = new MobilePrimaryNav(state, {
    openSearch: (options) => { void searchLauncher.openSearch(options); },
    navigateToVariant: (variant, options) => {
      document.dispatchEvent(new CustomEvent('wm:navigate-to-variant', { detail: { variant, options } }));
      return Promise.resolve();
    },
    openMission: (anchor) => {
      document.dispatchEvent(new CustomEvent('wm:open-mission-preset', { detail: { anchor, mobile: true } }));
    },
  });

  const eventHandlerCallbacks = {
    openSearch: (options) => { void searchLauncher.openSearch(options); },
    updateSearchIndex: () => searchLauncher.updateSearchIndex(),
    loadAllData: () => dataLoader.loadAllData(),
    invalidateNewsHydration: () => dataLoader.invalidateNewsHydration(),
    flushStaleRefreshes: () => refreshScheduler.flushStaleRefreshes(),
    setHiddenSince: (ts) => refreshScheduler.setHiddenSince(ts),
    loadDataForLayer: (layer) => { void dataLoader.loadDataForLayer(layer as keyof MapLayers); },
    waitForAisData: () => dataLoader.waitForAisData(),
    syncDataFreshnessWithLayers: () => dataLoader.syncDataFreshnessWithLayers(),
    ensureCorrectZones: () => panelLayout.ensureCorrectZones(),
    applySavedPanelOrder: (panelOrder?: string[]) => panelLayout.applySavedPanelOrder(panelOrder),
    refreshCiiAfterFocalPointsReady: () => dataLoader.refreshCiiAfterFocalPointsReady(),
    stopLayerActivity: (layer) => dataLoader.stopLayerActivity(layer),
    mountLiveNewsIfReady: () => panelLayout.mountLiveNewsIfReady(),
    updateFlightSource: (adsb, military) => searchLauncher.updateFlightSource(adsb, military),
    applyMapLayerChange: applyMapLayerChangeFn,
    syncUrlState: () => syncUrlState(),
    setupMobileAuth: (modal) => mobilePrimaryNav.setupAuth(modal),
    openCountryStory: (code, name) => {
      void countryIntel.openCountryStory(code, name).catch((err) => {
        console.error('[CountryStory] Failed to open story:', err);
        showToast('Country story failed to open. Please try again.');
      });
    },
    openCountryBrief: (code) => {
      const name = CountryIntelManager.resolveCountryName(code);
      void countryIntel.openCountryBriefByCode(code, name).catch((err) => {
        console.error('[CountryBrief] Failed to open country brief:', err);
        state.map?.setRenderPaused(false);
        showToast('Country brief failed to open. Please try again.');
      });
    },
    openCountryBriefByCode: (code, name, opts) => {
      void countryIntel.openCountryBriefByCode(code, name, opts).catch((err) => {
        console.error('[CountryBrief] Failed to open country brief:', err);
        state.map?.setRenderPaused(false);
        showToast('Country brief failed to open. Please try again.');
      });
    },
    updateMonitorResults: () => dataLoader.updateMonitorResults(),
    addCustomWidget: (spec) => panelLayout.addCustomWidget(spec),
    addMcpPanel: (spec) => panelLayout.addMcpPanel(spec),
    resetIdleTimer: () => document.dispatchEvent(new CustomEvent('wm:reset-idle-timer')),
    applyPanelSettings: () => panelLayout.applyPanelSettings(),
    enablePanelById: (panelId) => enablePanelById(
      state,
      () => panelLayout.applyPanelSettings(),
      panelId,
    ),
    enforceFreeTierLimits: (cloudSyncVersion?) => enforceFreeTierLimits(state, () => panelLayout.applyPanelSettings(), cloudSyncVersion),
    setPendingCloudRecoverySyncVersionIfUnset: (version) => {
      if (state.pendingCloudRecoverySyncVersion === undefined) state.pendingCloudRecoverySyncVersion = version;
    },
    healStoredTabSnapshots: () => panelLayout.healStoredTabSnapshots(),
    freeTierGateResetForAuthTransition: () => state.freeTierGate?.resetForAuthTransition(),
    clearPendingCloudRecoverySyncVersion: () => { state.pendingCloudRecoverySyncVersion = undefined; },
  } satisfies EventHandlerCallbacks;
  publishAppActions(eventHandlerCallbacks);

  searchLauncher = new SearchLauncher(
    state,
    countryIntel,
    (panelId) => enablePanelById(state, () => panelLayout.applyPanelSettings(), panelId),
  );

  // Wire cross-module callback: DataLoader → SearchManager
  dataLoader.updateSearchIndex = () => searchLauncher.updateSearchIndex();

  const handleWmSessionDegraded = (): void => {
    if (!state.isDestroyed) {
      showToast('Anonymous data is temporarily unavailable. Check your cookie settings, then reload.');
    }
  };

  // Track destroy order (reverse of init)
  const modules = [
    panelLayout,
    countryIntel,
    dataLoader,
    refreshScheduler,
    {
      destroy: () => {
        debouncedUrlSync.cancel();
        mobilePrimaryNav.destroy();
        overlayHistory.reset();
      },
    },
  ];

  return {
    state,
    panelLayout,
    dataLoader,
    countryIntel,
    refreshScheduler,
    mobilePrimaryNav,
    searchLauncher,
    modules,
    syncUrlState,
    handleWmSessionDegraded,
  };
}
