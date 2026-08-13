import type { AppManagers } from '@/app/create-app-managers';
import {
  initDB,
  cleanOldSnapshots,
  isAisConfigured,
  initAisStream,
  isOutagesConfigured,
  disconnectAisStream,
  startFlightHistoryCleanup,
  stopFlightHistoryCleanup,
} from '@/services';
import { enableVesselRuntime, stopLoadedVesselHistoryCleanup } from '@/services/military-vessels-lazy';
import { BreakingNewsBanner } from '@/components/BreakingNewsBanner';
import { initBreakingNewsAlerts, destroyBreakingNewsAlerts } from '@/services/breaking-news-alerts';
import { markLcpDebug } from '@/utils/lcp-debug';
import { isDesktopRuntime, waitForSidecarReady } from '@/services/runtime';
import { trackEvent, initAuthAnalytics } from '@/services/analytics';
import { isCountryGeometryLoaded } from '@/services/country-geometry';
import { initI18n, t } from '@/services/i18n';
import { initDeferredDashboardFonts } from '@/bootstrap/secondary-startup';
import {
  cancelBootstrapSlowTier,
  fetchBootstrapData,
  markBootstrapAsLive,
} from '@/services/bootstrap';
import { ensureWmSession, installWmSessionFetchInterceptor, WM_SESSION_DEGRADED_EVENT } from '@/services/wm-session';
import { registerWebMcpTools } from '@/services/webmcp';
import { initAuthState } from '@/services/auth-state';
import {
  installFollowedCountriesAuthListener,
} from '@/services/followed-countries';
import {
  capturePendingCheckoutIntentFromUrl,
  initCheckoutWatchers,
  resumePendingCheckout,
} from '@/services/checkout';
import { captureReferralFromUrl } from '@/services/referral-capture';
import { publishAppContext, clearAppContextBridge } from '@/services/app-context-bridge';
import { clearAppActionsBridge } from '@/services/app-actions-bridge';
import { waitForUiReady } from '@/app/search-launcher';
import {
  waitForSlowBootstrapCheckpoint,
  preloadCountryGeometryForPostLcpWork,
  startPostLcpIntelligence,
} from '@/app/post-lcp';
import { primeVisiblePanelData } from '@/app/panel-primer';
import { enforceFreeTierLimits } from '@/app/enforce-free-tier';
import { parseMapUrlState } from '@/utils';
import { mlWorker } from '@/services/ml-worker';
import { resolveUserRegion, resolvePreciseUserCoordinates, type PreciseCoordinates } from '@/utils/user-location';
import { showProBanner } from '@/components/ProBanner';
import { install as installCloudPrefsSync } from '@/utils/cloud-prefs-sync';
import { SITE_VARIANT } from '@/config';
import { CountryIntelManager as CountryIntelManagerClass } from '@/app/country-intel';

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';

export async function initApp(
  managers: AppManagers,
): Promise<AbortController | null> {
  const { state: ctx, panelLayout, dataLoader, countryIntel, mobilePrimaryNav, syncUrlState, searchLauncher, handleWmSessionDegraded } = managers;
  const eventHandlers = { init: () => mobilePrimaryNav.init(), syncUrlState };
  const initStart = performance.now();
  markLcpDebug('wm:boot:app-init-start');

  // WebMCP — register synchronously before any init awaits so agent
  // scanners (isitagentready.com, in-browser agents) find the tools on
  // their first probe. No-op in browsers without navigator.modelContext.
  // Bindings await `this.uiReady` (resolves after Phase-4 UI init) so
  // a tool invoked during the startup window waits for the target
  // panel to exist instead of throwing. A 10s timeout keeps a genuinely
  // broken state from hanging the caller. Store the returned controller
  // so destroy() can unregister every tool on teardown.
  const webMcpController = registerWebMcpTools({
    openCountryBriefByCode: async (code, country) => {
      await waitForUiReady(ctx);
      if (!ctx.countryBriefPage) {
        throw new Error('Country brief panel is not initialised');
      }
      await countryIntel.openCountryBriefByCode(code, country);
    },
    resolveCountryName: (code) => CountryIntelManagerClass.resolveCountryName(code),
    openSearch: async () => {
      // openSearch() awaits UI readiness internally and throws on failure when
      // throwOnFailure is set, so the agent receives a real success/failure.
      // (Re-checking searchModal here would spuriously throw if a concurrent
      // Cmd+K closed it between open and the check — #4403 review ADV-4.)
      await searchLauncher.openSearch({ throwOnFailure: true });
    },
  });

  await initDB();
  startFlightHistoryCleanup();
  // Re-arm the lazy vessel runtime (a no-op on first boot; matters on a
  // same-document re-init after a prior App.destroy() disarmed it). The
  // history-cleanup interval itself still starts lazily on first vessel use.
  enableVesselRuntime();
  await initI18n();
  markLcpDebug('wm:boot:i18n-ready');
  initDeferredDashboardFonts();
  // Localize the static index.html shell — <title>, meta description, and
  // the accessible <h1> are baked in English before the app boots; once i18n
  // is ready we swap them to the user's locale.
  document.title = t('shell.documentTitle');
  const setMeta = (sel: string, val: string) => {
    const el = document.querySelector(sel);
    if (el) el.setAttribute('content', val);
  };
  setMeta('meta[name="description"]', t('shell.metaDescription'));
  setMeta('meta[property="og:title"]', t('shell.documentTitle'));
  setMeta('meta[property="og:description"]', t('shell.metaDescription'));
  setMeta('meta[name="twitter:title"]', t('shell.documentTitle'));
  setMeta('meta[name="twitter:description"]', t('shell.metaDescription'));
  // Mirror of OG_LOCALE in pro-test/src/i18n.ts. The two packages have
  // separate Vite roots and bundlers and can't share an import — keep the
  // tables aligned by hand when adding a locale here OR there.
  const ogLocaleMap: Record<string, string> = {
    en: 'en_US', bg: 'bg_BG', cs: 'cs_CZ', fr: 'fr_FR', de: 'de_DE', el: 'el_GR',
    es: 'es_ES', hr: 'hr_HR', hu: 'hu_HU', it: 'it_IT', pl: 'pl_PL', pt: 'pt_BR',
    nl: 'nl_NL', sv: 'sv_SE', ru: 'ru_RU', ar: 'ar_SA', fa: 'fa_IR', zh: 'zh_CN',
    ja: 'ja_JP', ko: 'ko_KR', ro: 'ro_RO', tr: 'tr_TR', th: 'th_TH', vi: 'vi_VN',
    hi: 'hi_IN',
  };
  const baseLang = (document.documentElement.lang || 'en').split('-')[0] || 'en';
  setMeta('meta[property="og:locale"]', ogLocaleMap[baseLang] || `${baseLang}_${baseLang.toUpperCase()}`);
  const srH1 = document.querySelector('body > h1');
  if (srH1) srH1.textContent = t('shell.documentTitle');

  // Check AIS configuration before init
  if (!isAisConfigured()) {
    ctx.mapLayers.ais = false;
  } else if (ctx.mapLayers.ais) {
    initAisStream();
  }

  // Wait for sidecar readiness on desktop so bootstrap hits a live server
  if (isDesktopRuntime()) {
    await waitForSidecarReady(3000);
    markLcpDebug('wm:boot:sidecar-ready');
  }

  // Anonymous browser session token (issue #3541). Server's validateApiKey
  // no longer trusts header-only signals (Origin / Referer / Sec-Fetch-Site
  // are all forgeable). Install a fetch interceptor ONCE, then mint a
  // wms_-prefixed HMAC token before the first API call. Desktop has its own
  // API key path and doesn't need this; Clerk-authenticated users will pass
  // their JWT in a Bearer header and the interceptor steps aside.
  if (!isDesktopRuntime()) {
    window.addEventListener(WM_SESSION_DEGRADED_EVENT, handleWmSessionDegraded);
    installWmSessionFetchInterceptor();
    await ensureWmSession();
    markLcpDebug('wm:boot:session-ready');
  }

  // Hydrate in-memory cache from bootstrap endpoint. Awaits only the fast tier; the slow
  // tier loads in the background (off the first-paint critical path, #4488) and calls back
  // when it lands so the connectivity indicator re-snapshots (no reactive emitter exists).
  await fetchBootstrapData(() => {
    if (ctx.isDestroyed) return;
    document.dispatchEvent(new CustomEvent('wm:bootstrap-state-changed'));
  });
  markLcpDebug('wm:boot:fast-bootstrap-ready');

  // Verify OAuth OTT and hydrate auth session BEFORE any UI subscribes to auth state
  await initAuthState();
  initAuthAnalytics();
  installCloudPrefsSync(SITE_VARIANT);
  // Cloud prefs listener wired by useCloudPrefsSync hook in AppRoot.tsx.
  // Install the followed-countries auth listener once. Drives the
  // anon→signed-in handoff (mergeAnonymousLocal mutation) and sign-out
  // cleanup. Idempotent.
  installFollowedCountriesAuthListener();
  enforceFreeTierLimits(ctx, () => panelLayout.applyPanelSettings());
  // Auth subscriptions (firePremiumLoaders, subscribeAuthState, onEntitlementChange)
  // are handled by useAuthLifecycle hook in AppRoot.tsx.

  const geoCoordsPromise: Promise<PreciseCoordinates | null> =
    ctx.isMobile && ctx.initialUrlState?.lat === undefined && ctx.initialUrlState?.lon === undefined
      ? resolvePreciseUserCoordinates(5000)
      : Promise.resolve(null);

  const resolvedRegion = await resolveUserRegion();
  ctx.resolvedLocation = resolvedRegion;

  // Phase 1: Layout (creates map + panels — they'll find hydrated data).
  // init() is async so the dynamic MapContainer import can resolve before
  // downstream code (e.g. mobileGeoCoords→state.map.setCenter) reads ctx.map.
  markLcpDebug('wm:layout:init-start');
  await panelLayout.init();
  markLcpDebug('wm:layout:init-complete');
  showProBanner(ctx.container);

  const mobileGeoCoords = await geoCoordsPromise;
  if (mobileGeoCoords && ctx.map) {
    ctx.map.setCenter(mobileGeoCoords.lat, mobileGeoCoords.lon, 6);
  }

  // Happy variant: pre-populate panels from persistent cache for instant render
  if (SITE_VARIANT === 'happy') {
    await dataLoader.hydrateHappyPanelsFromCache();
  }

  // Phase 2: Shared UI components
  initBreakingNewsAlerts();
  ctx.breakingBanner = new BreakingNewsBanner();

  // Correlation engine is constructed lazily at its post-loadAllData run site
  // (Phase 6 below) so its bytes + adapters stay off the eager boot graph (#4486).
  // Capture any ?ref= / ?wm_referral= from the URL into localStorage
  // and strip from the visible URL. Runs BEFORE the pending-checkout
  // capture so a /dashboard?ref=X&checkoutProduct=Y landing preserves both
  // signals. Pure read of current URL — no-op when neither param is
  // present.
  captureReferralFromUrl();
  // Wire checkout-attempt lifecycle watchers (sign-out clear) before
  // any capture/resume path runs, so a stale session from a prior
  // user can't bleed into the current one.
  initCheckoutWatchers();
  // Stale attempt records are ignored by loadCheckoutAttempt() via
  // the 24h TTL — no separate sweep needed. The attempt record's
  // only consumer (the failure-retry banner) runs handleCheckoutReturn
  // synchronously during panel-layout mount, which is after the
  // captureePendingCheckoutIntentFromUrl repopulates it for any /pro
  // handoff — so no race exists that would want to sweep pre-capture.
  const pendingCheckout = capturePendingCheckoutIntentFromUrl();
  if (pendingCheckout) {
    // Checkout intent from /pro page redirect. Resume immediately if
    // already authenticated, otherwise the auth callback handles it.
    void resumePendingCheckout({
      openAuth: () => ctx.authModal?.open(),
    });
  }

  // Phase 4: CountryIntel. SearchManager is lazy-loaded
  // on first CMD+K/search-button open so its modal catalog stays off startup.
  await countryIntel.init();
  // Unblock any WebMCP tool invocations that arrived during startup.
  ctx.resolveUiReady();
  // Publish the AppContext to the React tree so useAppContext() starts returning it.
  publishAppContext(ctx);

  // Phase 5: Event listeners + URL sync
  eventHandlers.init();
  // Capture deep link params BEFORE URL sync overwrites them; consumed by useDeepLinks hook.
  const initState = parseMapUrlState(window.location.search, ctx.mapLayers);
  const earlyParams = new URLSearchParams(window.location.search);
  ctx.pendingDeepLinks = {
    country: initState.country ?? null,
    expanded: initState.expanded === true,
    chokepoint: initState.chokepoint ?? null,
    storyCode: earlyParams.get('c') ?? null,
  };
  if (import.meta.env.VITE_E2E === '1') {
    document.documentElement.dataset.wmEventHandlersReady = 'true';
  }

  ctx.countryBriefPage?.onStateChange?.(() => {
    eventHandlers.syncUrlState();
  });

  // Phase 6: Data loading
  dataLoader.syncDataFreshnessWithLayers();
  const slowTierReady = waitForSlowBootstrapCheckpoint(ctx);
  if (ctx.isDestroyed) return webMcpController;
  // Prime panel-specific data concurrently with bulk loading.
  // primeVisiblePanelData owns ETF, Stablecoins, Gulf Economies, etc. that
  // are NOT part of loadAllData. Running them in parallel prevents those
  // panels from being blocked when a loadAllData batch is slow.
  // Ongoing scroll/resize repriming is handled by useViewportDataPrime hook.
  // Slow-tier hydration keys are consume-once (getHydratedData deletes on
  // read) and the visible-data consumers in loadAllData read them at task
  // start. If the fan-out runs before the slow tier settles, those reads miss
  // and fall back to per-panel RPCs that never re-read the late payload —
  // wasting the ~500 KB slow-tier bootstrap. The shell LCP element already
  // painted back in panelLayout.init() (Phase 1), so awaiting here is OFF the
  // LCP critical path; it stays bounded by waitForBootstrapSlowTier's timeout
  // (3.5 s browser / 8.5 s desktop). (#4512)
  await slowTierReady;
  if (ctx.isDestroyed) return webMcpController;
  // Snapshot whether precision geometry was already loaded BEFORE the fan-out
  // (the map renderer triggers the memoized fetch early). If so, the fan-out's
  // geometry-dependent CII ingests already attributed correctly and the
  // post-LCP replay would just be a redundant second CII compute + choropleth
  // repaint, so we skip it below. (#4512)
  const geometryReadyBeforeFanout = isCountryGeometryLoaded();
  markLcpDebug('wm:data:initial-fanout-start');
  await Promise.all([
    dataLoader.loadAllData(),
    primeVisiblePanelData(ctx),
  ]);
  markLcpDebug('wm:data:initial-fanout-complete');
  const countryGeometryReady = preloadCountryGeometryForPostLcpWork();

  // If bootstrap was served from cache but live data just loaded, promote the status indicator
  markBootstrapAsLive();
  document.dispatchEvent(new CustomEvent('wm:bootstrap-state-changed'));

  // Initial correlation engine run is post-LCP background work. Wait for
  // precision country geometry there instead of before visible data fan-out.
  startPostLcpIntelligence(ctx, dataLoader, countryGeometryReady, geometryReadyBeforeFanout);

  // Hide unconfigured layers after first data load
  if (!isAisConfigured()) {
    ctx.map?.hideLayerToggle('ais');
  }
  if (isOutagesConfigured() === false) {
    ctx.map?.hideLayerToggle('outages');
  }
  if (!CYBER_LAYER_ENABLED) {
    ctx.map?.hideLayerToggle('cyberThreats');
  }

  // Phase 7: Refresh scheduling (useRefreshIntervals hook in AppRoot.tsx)
  cleanOldSnapshots().catch((e) => console.warn('[Storage] Snapshot cleanup failed:', e));

  // Analytics
  trackEvent('wm_app_loaded', {
    load_time_ms: Math.round(performance.now() - initStart),
    panel_count: Object.keys(ctx.panels).length,
  });

  return webMcpController;
}

export function destroyApp(
  managers: AppManagers,
  webMcpController: AbortController | null,
): void {
  const { state: ctx, modules, handleWmSessionDegraded } = managers;
  ctx.isDestroyed = true;
  cancelBootstrapSlowTier();

  // Destroy all modules in reverse order
  for (let i = modules.length - 1; i >= 0; i--) {
    modules[i]!.destroy();
  }

  // Clean up subscriptions, map, AIS, and breaking news
  // (auth subscriptions cleaned up by useAuthLifecycle hook)
  ctx.freeTierGate?.cancelFallback();
  mlWorker.terminate();
  ctx.findingsBadge?.destroy();
  ctx.findingsBadge = null;
  ctx.breakingBanner?.destroy();
  destroyBreakingNewsAlerts();
  window.removeEventListener(WM_SESSION_DEGRADED_EVENT, handleWmSessionDegraded);
  ctx.map?.destroy();
  disconnectAisStream();
  stopFlightHistoryCleanup();
  stopLoadedVesselHistoryCleanup();
  // Unregister every WebMCP tool so a same-document re-init (tests,
  // HMR, SPA harness) doesn't leave the browser with stale bindings
  // pointing at a disposed App.
  webMcpController?.abort();
  // Clear the bridges so a same-document re-init starts with a clean slate.
  clearAppContextBridge();
  clearAppActionsBridge();
}
