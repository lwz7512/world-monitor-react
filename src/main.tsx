import './styles/base-layer.css';
import './bootstrap/zod-csp';
import { SITE_VARIANT } from '@/config/variant';
import { installLcpAttributionDebug } from '@/bootstrap/lcp-attribution';
import { markLcpDebug } from '@/utils/lcp-debug';
import { installPreInitErrorQueue, scheduleSentryInit } from '@/bootstrap/sentry-defer';
import { installCspViolationReporting } from '@/bootstrap/csp-violation-filter';
import { registerClsReporting } from '@/bootstrap/cls-report';
import { registerInpReporting } from '@/bootstrap/inp-report';
import { registerLcpReporting } from '@/bootstrap/lcp-report';
import { initVercelAnalytics } from '@/bootstrap/secondary-startup';
import { loadVariantThemeStylesheet } from '@/bootstrap/variant-theme';
import { createRoot } from 'react-dom/client';
import { AppRoot } from './AppRoot';
import { installUtmInterceptor } from './utils/utm';
import { captureContentAttributionFromUrl } from '../shared/content-attribution';

if (SITE_VARIANT === 'happy') {
  // Keeps happy-theme.css off other variants' eager CSS graph. On happy, the
  // stylesheet applies asynchronously, so a brief base-theme flash is possible.
  // The import is fire-and-forget, so its rejection must be consumed: Vite's
  // preload helper rejects with `Unable to preload CSS for <url>` when the
  // injected <link> errors, and a bare `void import(...)` let that escape to
  // onunhandledrejection (WORLDMONITOR-XT). See bootstrap/variant-theme.ts.
  void loadVariantThemeStylesheet('happy', () => import('./styles/happy-theme.css'));
}

// Activate the deferred dashboard app stylesheet. The build
// (deferDashboardStylesheetLinks in vite.config.ts) emits the large dashboard
// CSS as <link media="print" data-wm-deferred-style="dashboard"> + a <noscript>
// blocking copy, so it does not block first paint; flipping media to "all" here
// applies it once main.js runs. The selector below MUST stay in lockstep with
// the attribute/value the build writes (data-wm-deferred-style="dashboard" +
// media="print"). No-JS users get the <noscript> fallback; if main.js fails to
// execute (e.g. an /assets 404 after a redeploy) the wm-sw-nuke handler in
// index.html reloads. Kept as the first body statement so it runs before the
// rest of startup.
function activateDeferredDashboardStyles(): void {
  document
    .querySelectorAll<HTMLLinkElement>('link[data-wm-deferred-style="dashboard"][media="print"]')
    .forEach((link) => {
      link.media = 'all';
    });
}

activateDeferredDashboardStyles();
installLcpAttributionDebug();

// perf G — defer @sentry/browser off the critical path (#3994).
// The eager `Sentry.init({...})` previously ran here cost ~1.96 s of pre-LCP
// CPU. Install a lightweight error-buffering queue synchronously so any error
// thrown before the SDK lands is captured + flushed on init, then schedule
// the actual SDK load via requestIdleCallback. The init options + SDK ship in
// the deferred sentry-*.js chunk, not the main entry.
installPreInitErrorQueue();
scheduleSentryInit();

// Report field INP attribution to Sentry (through the deferred-Sentry queue) so
// we can see which real interaction is slow and whether the cost is input delay,
// processing, or presentation (#4537). web-vitals loads in its own post-paint chunk.
registerInpReporting();

// Report field CLS attribution to Sentry so field-only layout shifts can name
// their largest shifting element before we scope the layout fix (#4580).
registerClsReporting();

// Report field LCP attribution to Sentry so the last-mile render-delay work can
// see the real LCP element plus TTFB / load-delay / load-time / render-delay parts (#5079).
registerLcpReporting();

// Suppress NotAllowedError from YouTube IFrame API's internal play() — browser autoplay policy,
// not actionable. The YT IFrame API doesn't expose the play() promise so it leaks as unhandled.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'NotAllowedError') e.preventDefault();
});

installCspViolationReporting();

import { debugGetCells, getCellCount } from '@/services/geo-convergence';
import { initMetaTags } from '@/services/meta-tags';
import { installRuntimeFetchPatch, installWebApiRedirect } from '@/services/runtime';
import { loadDesktopSecrets } from '@/services/runtime-config';
import { applyStoredTheme } from '@/utils/theme-manager';
import { applyFont } from '@/services/font-settings';
import { initAnalytics, trackContentHandoff } from '@/services/analytics';
import { installChunkReloadGuard } from '@/bootstrap/chunk-reload';
import { initDebugBearRum } from '@/bootstrap/debugbear-rum';
import { installStaleBundleCheck } from '@/bootstrap/stale-bundle-check';
import { installServiceWorkerRegistration } from '@/bootstrap/sw-register';

// Auto-reload on stale chunk 404s after deployment (Vite fires this for modulepreload failures).
// The guard is also installed in AppRoot.tsx so the key is cleared after App.init() succeeds.
installChunkReloadGuard(__APP_VERSION__);

// Product analytics are secondary startup work; RUM starts once the trusted
// dashboard entry executes so it can observe page-load vitals.
const capturedContentAttribution = captureContentAttributionFromUrl();
if (capturedContentAttribution) {
  // The event is queued safely if the deferred Umami tracker is not ready.
  // `captureContentAttributionFromUrl` returns only fresh URL captures, so a
  // reload does not duplicate the landing handoff.
  trackContentHandoff();
}
void initAnalytics();
initVercelAnalytics();
initDebugBearRum();

// Initialize dynamic meta tags for sharing
initMetaTags();

// In desktop mode, route /api/* calls to the local Tauri sidecar backend.
installRuntimeFetchPatch();
// In web production, route RPC calls through api.worldmonitor.app (Cloudflare edge).
installWebApiRedirect();
// Force-reload tabs running a stale bundle (catches the class of bug where
// users keep a tab open across a wire-shape change). Skips when build-hash
// is the 'dev' marker.
installStaleBundleCheck();
loadDesktopSecrets().catch(() => {});

// Apply stored theme preference before app initialization (safety net for inline script)
applyStoredTheme();
applyFont();

// Set data-variant on <html> so CSS theme overrides activate
if (SITE_VARIANT && SITE_VARIANT !== 'full') {
  document.documentElement.dataset.variant = SITE_VARIANT;

  // Swap favicons to variant-specific versions before browser finishes fetching defaults
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(link => {
    link.href = link.href
      .replace(/\/favico\/favicon/g, `/favico/${SITE_VARIANT}/favicon`)
      .replace(/\/favico\/apple-touch-icon/g, `/favico/${SITE_VARIANT}/apple-touch-icon`);
  });
}

// Remove no-transition class after first paint to enable smooth theme transitions
requestAnimationFrame(() => {
  document.documentElement.classList.remove('no-transition');
});

// Clear stale settings-open flag (survives ungraceful shutdown)
try {
  localStorage.removeItem('wm-settings-open');
} catch {
  // Storage may be unavailable (blocked cookies, sandboxed iframe). The flag is
  // only a convenience hint, so boot must continue with the in-memory default.
}

// Standalone windows: ?settings=1 = panel display settings, ?live-channels=1 = channel management
// Both need i18n initialized so t() does not return undefined.
const urlParams = new URL(location.href).searchParams;
if (urlParams.get('settings') === '1') {
  void Promise.all([import('./services/i18n'), import('./settings-window')]).then(
    async ([i18n, m]) => {
      await i18n.initI18n();
      m.initSettingsWindow();
    }
  );
} else if (urlParams.get('live-channels') === '1') {
  void Promise.all([import('./services/i18n'), import('./live-channels-window')]).then(
    async ([i18n, m]) => {
      await i18n.initI18n();
      m.initLiveChannelsWindow();
    }
  );
} else {
  installUtmInterceptor();
  markLcpDebug('wm:boot:app-construct');
  /**
   * =======================================
   *     ### INIT APP ROOT HERE ###
   * =======================================
   */
  createRoot(document.getElementById('app')!).render(<AppRoot />);
}

// Debug helpers for geo-convergence testing (remove in production)
(window as unknown as Record<string, unknown>).geoDebug = {
  cells: debugGetCells,
  count: getCellCount,
};

// Beta mode toggle: type `beta=true` / `beta=false` in console
Object.defineProperty(window, 'beta', {
  get() {
    const on = localStorage.getItem('worldmonitor-beta-mode') === 'true';
    console.log(`[Beta] ${on ? 'ON' : 'OFF'}`);
    return on;
  },
  set(v: boolean) {
    if (v) localStorage.setItem('worldmonitor-beta-mode', 'true');
    else localStorage.removeItem('worldmonitor-beta-mode');
    location.reload();
  },
});

// Suppress native WKWebView context menu in Tauri — allows custom JS context menus
if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) {
  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement;
    // Allow native menu on text inputs/textareas for copy/paste
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    e.preventDefault();
  });
}

installServiceWorkerRegistration(__APP_VERSION__);

// --- SW/Cache Nuke Template ---
// If stale service workers or caches cause issues after a major deploy, re-enable this block.
// It runs once per user (guarded by a localStorage key), nukes all SWs and caches, then reloads.
// IMPORTANT: This causes a visible double-load for every new/unkeyed user. Remove once rollout is complete.
//
// const nukeKey = 'wm-sw-nuked-v3';
// let alreadyNuked = false;
// try { alreadyNuked = !!localStorage.getItem(nukeKey); } catch {}
// if (!alreadyNuked) {
//   try { localStorage.setItem(nukeKey, '1'); } catch {}
//   navigator.serviceWorker.getRegistrations().then(async (regs) => {
//     await Promise.all(regs.map(r => r.unregister()));
//     const keys = await caches.keys();
//     await Promise.all(keys.map(k => caches.delete(k)));
//     console.log('[PWA] Nuked stale service workers and caches');
//     window.location.reload();
//   });
// }
