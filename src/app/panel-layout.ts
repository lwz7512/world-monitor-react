import type { AppContext, AppModule } from '@/app/app-context';
import { makeDraggable } from '@/app/panel-drag';
import { refreshAppContext } from '@/services/app-context-bridge';
import { replayPendingCalls, clearAllPendingCalls } from '@/app/pending-panel-data';
import { createAddPanelBlocks } from '@/app/add-panel-blocks';
import { attachRelatedAssetHandlers } from '@/app/related-asset-click';
import { applyInitialUrlState } from '@/app/initial-url-state';
import {
  hasPanelSettingEntry,
  newsPanelKeyForCategory,
  newsPanelKeyLookupsFor,
} from '@/app/news-panel-keys';
import {
  createDeferredPanelShell,
  getDeferredPanelShellFootprint as resolveDeferredPanelShellFootprint,
  reconcileDeferredPanelShellColSpan,
  shouldDeferInitialPanelMount,
  type DeferredPanelShellFootprint,
} from '@/app/panel-mount-deferral';
import { PanelOrderManager } from '@/app/panel-order-manager';
import type { MapLayers } from '@/types';
import type { TheaterPostureSummary } from '@/services/military-surge';
import type { AviationCommandBar } from '@/components/AviationCommandBar';
import { debounce, saveToStorage } from '@/utils';
import {
  CANONICAL_FEEDS,
  STORAGE_KEYS,
  SITE_VARIANT,
  ALL_PANELS,
  VARIANT_DEFAULTS,
} from '@/config';
import { t } from '@/services/i18n';
import {
  filterItemsByTimeRange,
  getTimeRangeLabel,
  applyTimeRangeFilterToNewsPanels,
} from '@/app/news-time-filter';
import { renderCriticalBanner, type CriticalBannerState } from '@/app/critical-banner';
import { getStoredMapModePreference } from '@/services/map-mode-preference';
import { loadWidgets, saveWidget } from '@/services/widget-store';
import type { CustomWidgetSpec } from '@/services/widget-store';
import { hasTier, getEntitlementState } from '@/services/entitlements';
import { initCheckoutAndBilling, type CheckoutLifecycle } from '@/app/checkout-lifecycle';
import { PanelTabManager } from '@/app/panel-tab-manager';
import type { PanelTabManagerCallbacks } from '@/app/panel-tab-manager';
import { loadMcpPanels, saveMcpPanel } from '@/services/mcp-store';
import type { McpPanelSpec } from '@/services/mcp-store';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import type { AuthSession } from '@/services/auth-state';
import {
  PanelGateReason,
  getPanelGateReason,
  resolveBillingAwareGateReason,
  resolveGateAction,
} from '@/services/panel-gating';
import { markLcpDebug } from '@/utils/lcp-debug';
import { Panel } from '@/components/Panel';
import { ReactFullPanel } from '@/components/ReactPanelBridge';
import { PANEL_REGISTRY } from '@/app/panel-registry';
import { computeEventRisk } from '@/app/news-panel-utils';
import { loadPanelCollapsed, loadPanelColSpans, loadPanelSpans } from '@/utils/panel-storage';

// News-category panel IDs that are in PANEL_REGISTRY (category key === panel key).
// Derived from PANEL_REGISTRY ∩ CANONICAL_FEEDS so it stays in sync automatically.
const REGISTRY_NEWS_PANEL_IDS = new Set(
  Object.keys(PANEL_REGISTRY).filter((id) => id in CANONICAL_FEEDS),
);
import { measure, mutate } from '@/utils/layout-batch';

/**
 * Panels that require premium access on web. Auth-based gating applies to
 * these — `updatePanelGating()` calls `Panel.showGatedCta()` to render
 * "Sign In to Unlock" / "Upgrade to Pro" for non-premium users.
 *
 * INVARIANT: every panel listed in `apiKeyPanels` (src/config/panels.ts
 * `isPanelEntitled`) MUST appear here. If it's API-key-entitled but missing
 * from this set, anonymous/free-Clerk users see the panel mount and run
 * its loader (which writes empty/loading/error UI directly into the body)
 * instead of the lock CTA. The PRO badge in the title still renders, so
 * the symptom is "PRO badge + panel-internal loading or empty copy"
 * which looks broken (e.g. Regional Intelligence rendering its empty-state
 * "is being refreshed" message to anonymous users — see todo #257 item 8).
 *
 * The static test in tests/panel-config-guardrails.test.mjs enforces
 * `apiKeyPanels ⊆ WEB_PREMIUM_PANELS` so this drift can't recur silently.
 */
const WEB_PREMIUM_PANELS = new Set([
  'stock-analysis',
  'stock-backtest',
  'daily-market-brief',
  'market-implications',
  'deduction',
  'chat-analyst',
  'wsb-ticker-scanner',
  'latest-brief',
  'regional-intelligence',
  'trade-policy',
  'global-procurement',
]);

/**
 * Panels that require a Clerk-authenticated PRO account specifically.
 * Desktop API key / browser tester keys do NOT satisfy the gate because
 * these panels are bound to a Clerk userId server-side (e.g. the Brief
 * is stored at brief:{clerkUserId}:{date} in Redis — no Clerk user, no
 * brief to fetch).
 *
 * Without this extra gate, API-key + free-Clerk users would see the
 * panel "unlocked" by hasPremiumAccess() and then hit a 403 when the
 * server re-checks entitlement from the JWT. This set promotes the
 * inconsistency to the layout gating layer so the user sees the
 * correct "Upgrade to Pro" CTA instead of a doomed fetch.
 */
const WEB_CLERK_PRO_ONLY_PANELS = new Set(['latest-brief']);


// TEMPORARY MIRROR of each panel constructor's footprint (`defaultRowSpan` /
// `className: 'panel-wide'`, declared in src/components/*Panel.ts). A deferred
// shell never instantiates its component, so it cannot read that footprint
// directly and must reproduce it here to reserve the right grid space.
//
// This duplicates the authoritative per-component declaration. Two guards keep
// it honest: `tests/panel-config-guardrails.test.mjs` fails CI on drift, and
// `warnOnDeferredFootprintDrift` (below) logs in dev if a hydrated panel ends
// up wider/taller than its reserved shell. The intended long-term fix is to
// lift these defaults into one shared table imported by both the `Panel`
// constructor and this map, removing the duplication entirely (see #4490).
export const DEFERRED_PANEL_NATURAL_FOOTPRINTS: Readonly<
  Record<string, DeferredPanelShellFootprint>
> = {
  cii: { rowSpan: 2 },
  'chat-analyst': { rowSpan: 2 },
  'china-corridors': { rowSpan: 2, className: 'panel-wide' },
  'china-activity-nowcast': { rowSpan: 2, className: 'panel-wide' },
  'consumer-prices': { rowSpan: 2 },
  displacement: { rowSpan: 2 },
  economic: { rowSpan: 2 },
  'global-procurement': { rowSpan: 2 },
  'energy-complex': { rowSpan: 2 },
  'energy-crisis': { rowSpan: 2 },
  'energy-disruptions': { rowSpan: 2 },
  'fuel-shortages': { rowSpan: 2 },
  'gdelt-intel': { rowSpan: 2 },
  'internet-disruptions': { rowSpan: 2 },
  'live-news': { className: 'panel-wide' },
  'live-webcams': { className: 'panel-wide' },
  'oil-inventories': { rowSpan: 2 },
  'pipeline-status': { rowSpan: 2 },
  'sanctions-pressure': { rowSpan: 2 },
  'security-advisories': { rowSpan: 2 },
  'storage-facility-map': { rowSpan: 2 },
  'strategic-posture': { rowSpan: 2 },
  'supply-chain': { rowSpan: 2 },
  'telegram-intel': { rowSpan: 2 },
  'threat-timeline': { rowSpan: 2 },
  'trade-policy': { rowSpan: 2 },
  'ucdp-events': { rowSpan: 2 },
  'windy-webcams': { className: 'panel-wide' },
};

const DEFERRED_DYNAMIC_PANEL_FOOTPRINTS: Readonly<Record<string, DeferredPanelShellFootprint>> = {
  'cw-': { rowSpan: 2 },
  'mcp-': { rowSpan: 2 },
};

const DEFERRED_PANEL_RETRY_DELAY_MS = 1_000;
const DEFERRED_PANEL_MAX_RETRY_ATTEMPTS = 3;

function readRowSpanClass(element: HTMLElement): number {
  if (element.classList.contains('span-4')) return 4;
  if (element.classList.contains('span-3')) return 3;
  if (element.classList.contains('span-2')) return 2;
  return 1;
}

function readColSpanFootprint(element: HTMLElement): number {
  if (element.classList.contains('col-span-3')) return 3;
  if (element.classList.contains('col-span-2')) return 2;
  if (element.classList.contains('col-span-1')) return 1;
  return element.classList.contains('panel-wide') ? 2 : 1;
}

// Dev-only guard: if a hydrated panel ends up taller/wider than the shell we
// reserved for it, the registry above drifted from the panel constructor and
// the deferred shell just caused the layout shift it exists to prevent. Surface
// it in the app (CI also catches drift via panel-config-guardrails).
function warnOnDeferredFootprintDrift(
  key: string,
  placeholder: HTMLElement,
  real: HTMLElement,
): void {
  const reservedRows = readRowSpanClass(placeholder);
  const reservedCols = readColSpanFootprint(placeholder);
  const realRows = readRowSpanClass(real);
  const realCols = readColSpanFootprint(real);
  if (realRows > reservedRows || realCols > reservedCols) {
    console.warn(
      `[PanelLayoutManager] Deferred shell footprint drift for "${key}": reserved ` +
        `${reservedCols}x${reservedRows} (col x row) but panel hydrated to ${realCols}x${realRows}. ` +
        'Update DEFERRED_PANEL_NATURAL_FOOTPRINTS to match the panel constructor.',
    );
  }
}

export interface PanelLayoutManagerCallbacks {
  openSearch: () => void;
  loadAllData: (forceAll?: boolean) => Promise<void>;
  loadSecurityAdvisories?: () => Promise<void>;
  applyMapLayerChange?: (layer: keyof MapLayers, enabled: boolean, source: 'programmatic') => void;
  isFreeTierFallbackActive?: () => boolean;
}

interface DeferredPanelMount {
  panel: Panel | null;
  placeholder: HTMLElement | null;
  observer: IntersectionObserver | null;
  mounted: boolean;
  loading: Promise<void> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempts: number;
  failed: boolean;
}

interface LazyPanelRegistration {
  load: () => Promise<Panel | null>;
  loading: Promise<Panel | null> | null;
}

type AnyPanelConstructor = new (...args: any[]) => Panel;
type PanelExport<M, K extends keyof M> = M[K] extends AnyPanelConstructor ? M[K] : never;
type ImportedPanel<M, K extends keyof M> = InstanceType<PanelExport<M, K>>;

type HydrationSchedulePhase = 'visible' | 'near';

export class PanelLayoutManager implements AppModule {
  private ctx: AppContext;
  private callbacks: PanelLayoutManagerCallbacks;
  private panelDragCleanupHandlers: Array<() => void> = [];
  private deferredPanelMounts: Map<string, DeferredPanelMount> = new Map();
  private lazyPanelRegistrations: Map<string, LazyPanelRegistration> = new Map();
  private observedHydrationPanels = new WeakSet<Panel>();
  private initiallyMountedEnabledPanelCount = 0;
  readonly panelOrderManager: PanelOrderManager;
  private readonly criticalBannerState: CriticalBannerState = { el: null };

  private panelTabManager: PanelTabManager | null = null;
  private aviationCommandBar: AviationCommandBar | null = null;
  private readonly applyTimeRangeFilterDebounced: (() => void) & { cancel(): void };
  private unsubscribeAuth: (() => void) | null = null;
  private unsubscribeProBlocks: (() => void) | null = null;
  private scheduledLoadAllRaf: number | null = null;
  private scheduledLoadAllIdle: number | null = null;
  private readonly checkoutLifecycle: CheckoutLifecycle;

  constructor(ctx: AppContext, callbacks: PanelLayoutManagerCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
    this.panelOrderManager = new PanelOrderManager(ctx);
    this.applyTimeRangeFilterDebounced = debounce(() => {
      applyTimeRangeFilterToNewsPanels(
        this.ctx.newsByCategory,
        this.ctx.currentTimeRange,
      );
    }, 120);

    this.checkoutLifecycle = initCheckoutAndBilling(
      ctx,
      () => this.updatePanelGating(getAuthState()),
      () => this.revealAnalystPanel(),
      callbacks.openSearch,
    );
  }

  async init(): Promise<void> {
    await this.renderLayout();
    if (this.ctx.isDestroyed) return;

    // Subscribe to auth state for reactive panel gating on web
    this.unsubscribeAuth = subscribeAuthState((state) => {
      this.updatePanelGating(state);
    });

    // Pro Activation Onboarding: after the dashboard settles, evaluate whether
    // a pending-onboarding marker should open the interstitial (or surface the
    // finish-setup chip). Deferred off the boot critical path like the panel
    // hydration scheduler above.
    this.checkoutLifecycle.init();
  }

  /**
   * Open + scroll the WM Analyst (chat-analyst) panel into view. The panel is a
   * lazy/deferred premium panel, so it may not be in `ctx.panels` yet at click
   * time; scrolling to its reserved grid slot trips the mount observer, and we
   * retry briefly until the element appears (mirrors search-manager's
   * scrollToPanelWhenReady contract).
   */
  private revealAnalystPanel(attemptsLeft = 12): void {
    if (this.ctx.isDestroyed || typeof document === 'undefined') return;
    const key = 'chat-analyst';
    this.ctx.panels[key]?.show();
    const el = document.querySelector(`[data-panel="${key}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (attemptsLeft <= 0) return;
    window.setTimeout(() => this.revealAnalystPanel(attemptsLeft - 1), 80);
  }

  destroy(): void {
    clearAllPendingCalls();
    this.applyTimeRangeFilterDebounced.cancel();
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = null;
    this.unsubscribeProBlocks?.();
    this.unsubscribeProBlocks = null;

    const destroyedTargets = new Set<{ destroy?: () => void }>();
    const destroyOnce = (target: { destroy?: () => void } | null | undefined): void => {
      if (!target || destroyedTargets.has(target)) return;
      destroyedTargets.add(target);
      // Isolate each destroy(): teardown runs over every registered panel, so a
      // single panel throwing must not abort the remaining panel/subscription/
      // overlay cleanup below (nor the rest of App.destroy(), which iterates
      // modules without its own try/catch).
      try {
        target.destroy?.();
      } catch (err) {
        console.error('[panel] destroy() threw during teardown', err);
      }
    };
    this.panelDragCleanupHandlers.forEach((cleanup) => cleanup());
    this.panelDragCleanupHandlers = [];
    for (const deferred of this.deferredPanelMounts.values()) {
      deferred.observer?.disconnect();
      if (deferred.retryTimer !== null) {
        clearTimeout(deferred.retryTimer);
      }
    }
    this.deferredPanelMounts.clear();
    this.lazyPanelRegistrations.clear();
    this.initiallyMountedEnabledPanelCount = 0;
    this.cancelScheduledLoadAllIdle();
    if (this.scheduledLoadAllRaf !== null) {
      cancelAnimationFrame(this.scheduledLoadAllRaf);
      this.scheduledLoadAllRaf = null;
    }
    if (this.criticalBannerState.el) {
      this.criticalBannerState.el.remove();
      this.criticalBannerState.el = null;
    }
    this.panelTabManager?.destroy();
    this.panelTabManager = null;
    // Clean up happy variant panels
    destroyOnce(this.ctx.tvMode);
    this.ctx.tvMode = null;

    // Clean up aviation components
    destroyOnce(this.aviationCommandBar);
    this.aviationCommandBar = null;

    // Destroy every registered panel exactly once, including lazy-created
    // and self-fetching panels that own subscriptions, intervals, or aborts.
    for (const panel of Object.values(this.ctx.panels)) {
      destroyOnce(panel);
    }
    for (const key of Object.keys(this.ctx.panels)) {
      delete this.ctx.panels[key];
    }
    // News stores are unregistered from news-panel-registry by each NewsPanel's
    // destroy() call (invoked above). No secondary cleanup needed here.
    // lazyPanelRegistrations was cleared above, so the category→panel-key registry
    // must reset too: a re-init re-registers from scratch and would otherwise skip
    // recording keys it believes are already mapped.
    this.ctx.newsCategoryPanelKeys.clear();

    this.checkoutLifecycle.destroy();

    this.panelOrderManager.destroyResponsiveZoneListener();
  }

  /** Reactively update premium panel gating based on auth state. */
  private updatePanelGating(state: AuthSession): void {
    // #4771: resolve the billing-aware refinement of FREE_TIER once per pass
    // — the inputs (subscription/entitlement snapshots, now) are invariant
    // across the panel loop, and a single Date.now() keeps every panel on
    // the same verdict at a period-end boundary.
    const billingAwareFreeTier = resolveBillingAwareGateReason(PanelGateReason.FREE_TIER);
    for (const [key, panel] of Object.entries(this.ctx.panels)) {
      if (!(panel instanceof Panel)) continue; // ReactFullPanel manages its own auth gating
      const isPremium = WEB_PREMIUM_PANELS.has(key);
      let reason = getPanelGateReason(state, isPremium);

      // Clerk-pro-only panels: even when hasPremiumAccess() returns
      // true via API/tester key, these panels need a Clerk userId
      // bound to a PRO entitlement. We DO NOT trust client-side
      // entitlement state as an authoritative gate — the server-side
      // /api/latest-brief check is authoritative. We only downgrade
      // the gate reason here as AFFIRMATIVE DENIAL: when we KNOW
      // (snapshot loaded AND tier < 1) the user is free. In every
      // other case — snapshot not yet loaded, Convex subscription
      // skipped, transient failure — we leave the panel unlocked
      // and let the server 403 path drive the upgrade CTA inside
      // the panel's refresh() catch block.
      //
      // Prior iterations of this code tried the opposite — gating
      // positively on hasTier(1) — and locked legitimate Pro users
      // out whenever the Convex snapshot was late, skipped, or
      // failed. Affirmative-denial-only is the right shape: never
      // over-gate, accept the one-doomed-fetch-per-session cost
      // for API-key-only + free-Clerk users as the lesser harm.
      if (
        reason === PanelGateReason.NONE &&
        WEB_CLERK_PRO_ONLY_PANELS.has(key) &&
        getEntitlementState() !== null &&
        !hasTier(1)
      ) {
        reason = state.user ? PanelGateReason.FREE_TIER : PanelGateReason.ANONYMOUS;
      }

      // #4771: a FREE_TIER verdict for a customer with stale paid evidence
      // becomes a billing-state reason (verifying renewal / update payment /
      // resubscribe) so we never push a paying user toward duplicate checkout.
      if (reason === PanelGateReason.FREE_TIER) reason = billingAwareFreeTier;

      if (reason === PanelGateReason.NONE) {
        // User has access -- unlock if previously locked
        (panel as Panel).unlockPanel();
      } else {
        // User does NOT have access -- show appropriate CTA
        const onAction = resolveGateAction(reason, {
          openAuthModal: () => this.ctx.authModal?.open(),
        });
        (panel as Panel).showGatedCta(reason, onAction);
      }
    }

    // KTD8: the tab cap rides the SAME pass, so it re-evaluates on both
    // subscribeAuthState and onEntitlementChange (plus onSubscriptionChange).
    // An auth-only subscription would miss the post-checkout snapshot — the
    // bug documented at the proBlock wiring below.
    this.panelTabManager?.updateTabCapLock();
  }

  async renderLayout(): Promise<void> {
    // AppShell.tsx (rendered synchronously via flushSync in main.tsx)
    // has already written the full shell DOM before this method runs.
    if (!document.getElementById('panelsGrid')) {
      throw new Error('[PanelLayoutManager] #panelsGrid not found — AppShell did not render');
    }

    markLcpDebug('wm:layout:render-start');
    document.documentElement.classList.add('wm-layout-hydrated');
    markLcpDebug('wm:layout:shell-replaced');

    // Skip link: explicitly move focus to <main> on activation. Native
    // fragment focus on a tabindex="-1" target is inconsistent across
    // browsers, so drive it directly to guarantee keyboard users land in the
    // main content (WCAG 2.4.1).
    this.ctx.container.querySelector('.skip-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      const main = document.getElementById('main');
      if (main) {
        main.focus();
        main.scrollIntoView({ block: 'start' });
      }
    });

    await this.createPanels();
    this.initPanelTabs();
  }

  // ============================================
  // Dashboard tabs — named, persistent panel workspaces
  // ============================================

  private initPanelTabs(): void {
    const mount = document.getElementById('panelTabsMount');
    if (!mount) return;

    const tabCallbacks: PanelTabManagerCallbacks = {
      savePanelOrder: () => this.panelOrderManager.savePanelOrder(),
      getResolvedPanelOrder: () => this.panelOrderManager.resolvedPanelOrder,
      getBottomSetMemory: () => this.panelOrderManager.bottomSetMemory,
      isFreeTierFallbackActive: () => this.callbacks.isFreeTierFallbackActive?.() ?? false,
      applyPanelSettings: () => this.applyPanelSettings(),
      applySavedPanelOrder: () => this.applySavedPanelOrder(),
      mountLiveNewsIfReady: () => this.mountLiveNewsIfReady(),
      scheduleLoadAllData: () => this.scheduleLoadAllData(),
    };
    this.panelTabManager = new PanelTabManager(this.ctx, tabCallbacks);
    this.panelTabManager.init(mount);
  }

  /**
   * Reconcile every stored tab snapshot against the current entitlement.
   *
   * Persisting a free-tier clamp while the tier is still unknown is the same
   * bug App.enforceFreeTierLimits defers around: a Pro user's custom widgets
   * would be written out of their saved workspaces on every load. Bail out
   * until the answer is real or the bounded free fallback fires; App calls
   * this again from the auth and entitlement callbacks, and
   * applyTabPanelState re-clamps on switch.
   */
  public healStoredTabSnapshots(): void {
    this.panelTabManager?.healStoredTabSnapshots();
  }

  renderCriticalBanner(postures: TheaterPostureSummary[]): void {
    renderCriticalBanner(postures, this.criticalBannerState, this.ctx.isMobile, (lat, lon, zoom) =>
      this.ctx.map?.setCenter(lat, lon, zoom),
    );
  }

  applyPanelSettings(): void {
    Object.entries(this.ctx.panelSettings).forEach(([key, config]) => {
      if (key === 'map') {
        const mapSection = document.getElementById('mapSection');
        if (mapSection) {
          mapSection.classList.toggle('hidden', !config.enabled);
          const mainContent = document.querySelector('.main-content');
          if (mainContent) {
            mainContent.classList.toggle('map-hidden', !config.enabled);
          }
          this.ensureCorrectZones();
        }
        return;
      }
      const deferred = this.deferredPanelMounts.get(key);
      const placeholderWasHidden = deferred?.placeholder?.classList.contains('hidden') ?? false;
      let mountedFromDeferred = false;
      if (
        config.enabled &&
        deferred &&
        !deferred.mounted &&
        (!deferred.placeholder || placeholderWasHidden)
      ) {
        mountedFromDeferred = this.mountDeferredPanel(key);
      }
      // Reconcile placeholder visibility even when the mount attempt no-ops
      // (an in-flight load sets deferred.loading, so mountDeferredPanel
      // returns false): a re-enable during that window must unhide the shell
      // or the panel vanishes until the chunk resolves — and forever if the
      // load then fails, since a hidden shell can never intersect the retry
      // observer.
      if (!mountedFromDeferred && deferred?.placeholder) {
        deferred.placeholder.classList.toggle('hidden', !config.enabled);
      }
      const panel = this.ctx.panels[key];
      const liveMediaPanel = panel as
        { stopLiveMediaForClose?: () => void; resumeLiveMediaForShow?: () => void } | undefined;
      if (!config.enabled) {
        // Dispatch event so React live-news/live-webcams components can tear down media.
        if (key === 'live-news') window.dispatchEvent(new CustomEvent('wm:live-news-stop'));
        if (key === 'live-webcams') window.dispatchEvent(new CustomEvent('wm:live-webcams-stop'));
        liveMediaPanel?.stopLiveMediaForClose?.();
      }
      if (!mountedFromDeferred) {
        panel?.toggle(config.enabled);
      }
      if (config.enabled) {
        if (key === 'live-news') window.dispatchEvent(new CustomEvent('wm:live-news-resume'));
        if (key === 'live-webcams') window.dispatchEvent(new CustomEvent('wm:live-webcams-resume'));
        liveMediaPanel?.resumeLiveMediaForShow?.();
      }
    });
    this.ctx.mobilePanelNav?.refresh();
    // Notify PanelLayout.tsx so it re-evaluates which ReactFullPanel containers
    // are visible (enabled) and updates the portal renders accordingly.
    refreshAppContext();
  }

  mountLiveNewsIfReady(): void {
    // live-news is now a React panel in PANEL_REGISTRY — no imperative mounting needed.
    // Dispatch refresh so if the component is mounted it reloads channels from storage.
    window.dispatchEvent(new CustomEvent('wm:live-news-refresh-channels'));
  }

  private shouldCreatePanel(key: string): boolean {
    return hasPanelSettingEntry(this.ctx.panelSettings, key);
  }

  private static readonly NEWS_PANEL_TOOLTIPS: Record<string, string> = {
    centralbanks: t('components.centralBankWatch.infoTooltip'),
  };

  private createNewsPanelWithLabel(
    panelKey: string,
    label: string,
    tooltip?: string,
    categoryKey = panelKey,
  ): void {
    if (!this.shouldCreatePanel(panelKey)) return;
    // Record the category→panel-key mapping ONLY when the lazy registration
    // actually took `panelKey`. A key already claimed by a non-news panel
    // (CommoditiesPanel, SupplyChainPanel, LiveNewsPanel …) makes lazyPanel a
    // no-op, and the category must then stay out of the registry so the data
    // layer never resolves it as a news category — there is no NewsPanel to
    // render into and every feed it fetches is waste (#5376).
    const registered = this.lazyPanel(panelKey, async () => {
      const { NewsPanel } = await import('@/components/NewsPanel');
      const panel = new NewsPanel(panelKey, label, tooltip);
      attachRelatedAssetHandlers(panel, this.ctx);
      panel.setRiskScoreGetter(computeEventRisk);
      // Store is registered in the news-panel-registry by the NewsPanel constructor.
      // Backfill on PRESENCE, not length. A category that resolved to `[]` is a
      // routine outcome — the digest simply carried no bucket for it — and this is
      // the only chance a late-mounting panel gets to clear the skeleton its
      // constructor installed. Skipping a cached `[]` used to be harmless because
      // the second news load re-rendered every category; now that the load runs
      // once per work-list that second chance is gone and the panel spins until the
      // 20-minute refresh (#5376). `renderNews([])` is what shows the empty state.
      const existingItems = this.ctx.newsByCategory[categoryKey];
      if (existingItems) {
        const filteredItems = filterItemsByTimeRange(existingItems, this.ctx.currentTimeRange);
        if (filteredItems.length === 0 && existingItems.length > 0) {
          panel.renderFilteredEmpty(`No items in ${getTimeRangeLabel(this.ctx.currentTimeRange)}`);
        } else {
          panel.renderNews(filteredItems);
        }
      }
      return panel as unknown as import('@/components').Panel;
    });
    if (registered) this.ctx.newsCategoryPanelKeys.set(categoryKey, panelKey);
  }

  private shouldMountPanelImmediately(key: string): boolean {
    const config = this.ctx.panelSettings[key];
    if (!config?.enabled) return false;
    if (
      shouldDeferInitialPanelMount({
        enabled: config.enabled,
        mountedEnabledCount: this.initiallyMountedEnabledPanelCount,
        isMobile: this.ctx.isMobile,
      })
    ) {
      return false;
    }
    this.initiallyMountedEnabledPanelCount += 1;
    return true;
  }

  private insertInitialPanel(grid: HTMLElement, key: string, panel: Panel): void {
    if (this.shouldMountPanelImmediately(key)) {
      if (this.mountPanelElement(grid, key, panel)) {
        this.afterPanelMounted(key, panel);
      }
      return;
    }

    this.deferPanelMount(key, panel, grid, this.ctx.panelSettings[key]?.enabled === true);
  }

  private insertInitialPanelByKey(grid: HTMLElement, key: string): void {
    const panel = this.ctx.panels[key];
    if (panel && !panel.getElement().parentElement) {
      this.insertInitialPanel(grid, key, panel);
      return;
    }
    if (panel || !this.lazyPanelRegistrations.has(key)) return;
    // Immediate-tier lazy panels go through the same slot-reserving shell
    // contract as deferred ones (#5332): the shell occupies the panel's grid
    // slot during this synchronous boot pass and the async chunk arrival
    // replaces it in place. The previous placeholder-less mountLazyPanel path
    // inserted a brand-new grid item whenever the import resolved — field
    // mover data named those insertions as the dominant desktop CLS source.
    this.deferPanelMount(key, null, grid, this.ctx.panelSettings[key]?.enabled === true);
    if (this.shouldMountPanelImmediately(key)) {
      this.mountDeferredPanel(key);
    }
  }

  private mountPanelElement(
    grid: HTMLElement,
    key: string,
    panel: Panel,
    placeholder?: HTMLElement | null,
  ): boolean {
    const el = panel.getElement();
    if (el.parentElement) return false;
    makeDraggable(
      el,
      key,
      this.panelOrderManager.bottomSetMemory,
      () => this.panelOrderManager.savePanelOrder(),
      (cleanup) => this.panelDragCleanupHandlers.push(cleanup),
    );
    if (placeholder?.parentNode) {
      if (import.meta.env.DEV) warnOnDeferredFootprintDrift(key, placeholder, el);
      placeholder.parentNode.replaceChild(el, placeholder);
    } else {
      this.insertByOrder(grid, el, key);
    }
    this.ctx.mobilePanelNav?.applyToNewPanel(el);
    panel.notifyConnected();
    return true;
  }

  private getDeferredPanelShellFootprint(key: string): DeferredPanelShellFootprint {
    return resolveDeferredPanelShellFootprint({
      panelId: key,
      naturalFootprints: DEFERRED_PANEL_NATURAL_FOOTPRINTS,
      dynamicFootprints: DEFERRED_DYNAMIC_PANEL_FOOTPRINTS,
      savedRowSpans: loadPanelSpans(),
      savedColSpans: loadPanelColSpans(),
      savedCollapsed: loadPanelCollapsed(),
    });
  }

  private deferPanelMount(
    key: string,
    panel: Panel | null,
    grid: HTMLElement | null,
    withShell: boolean,
  ): void {
    const placeholder =
      withShell && grid
        ? createDeferredPanelShell(
            key,
            this.ctx.panelSettings[key]?.name ?? key,
            this.getDeferredPanelShellFootprint(key),
          )
        : null;
    if (placeholder && grid) {
      this.insertByOrder(grid, placeholder, key);
      reconcileDeferredPanelShellColSpan(placeholder);
      this.ctx.mobilePanelNav?.applyToNewPanel(placeholder);
    }
    const existing = this.deferredPanelMounts.get(key);
    existing?.observer?.disconnect();
    if (existing?.retryTimer !== null && existing?.retryTimer !== undefined) {
      clearTimeout(existing.retryTimer);
    }
    if (existing?.placeholder && existing.placeholder !== placeholder) {
      existing.placeholder.remove();
    }
    const deferred: DeferredPanelMount = {
      panel,
      placeholder,
      observer: null,
      mounted: false,
      loading: null,
      retryTimer: null,
      retryAttempts: 0,
      failed: false,
    };
    this.deferredPanelMounts.set(key, deferred);
    if (placeholder) {
      this.observeDeferredPanelShell(key, deferred);
    }
  }

  private observeDeferredPanelShell(key: string, deferred: DeferredPanelMount): void {
    const { placeholder } = deferred;
    if (!placeholder) return;
    if (deferred.retryTimer !== null) {
      clearTimeout(deferred.retryTimer);
      deferred.retryTimer = null;
    }
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      const ric =
        typeof window !== 'undefined'
          ? (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
              .requestIdleCallback
          : undefined;
      if (typeof ric === 'function') ric(() => this.mountDeferredPanel(key));
      else setTimeout(() => this.mountDeferredPanel(key), 0);
      return;
    }

    const rootMargin = this.ctx.isMobile ? '700px 0px' : '900px 0px';
    deferred.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.mountDeferredPanel(key);
        }
      },
      { rootMargin },
    );
    deferred.observer.observe(placeholder);
  }

  private getPanelMountGrid(key: string): HTMLElement | null {
    const bottomGrid = document.getElementById('mapBottomGrid');
    if (
      bottomGrid &&
      this.panelOrderManager.getEffectiveUltraWide() &&
      this.panelOrderManager.bottomSetMemory.has(key)
    ) {
      return bottomGrid;
    }
    return document.getElementById('panelsGrid');
  }

  private scheduleDeferredPanelRetry(key: string, deferred: DeferredPanelMount): void {
    if (this.ctx.isDestroyed || deferred.mounted || deferred.failed || deferred.retryTimer !== null)
      return;
    if (!deferred.placeholder?.parentNode) return;
    if (!deferred.panel && !this.lazyPanelRegistrations.has(key)) return;
    if (deferred.retryAttempts >= DEFERRED_PANEL_MAX_RETRY_ATTEMPTS) {
      // Give up after a bounded number of attempts so a permanently failing
      // dynamic import (offline, stale chunk) cannot spin a 1s retry loop forever.
      // The shell stays in place as a quiet fallback, and a one-shot 'online'
      // listener re-arms the retry budget so a connectivity blip during boot
      // doesn't strand the skeleton until a manual reload — a genuinely broken
      // chunk fails its retries again and lands back here.
      deferred.failed = true;
      if (typeof window !== 'undefined') {
        window.addEventListener(
          'online',
          () => {
            if (
              this.deferredPanelMounts.get(key) !== deferred ||
              deferred.mounted ||
              this.ctx.isDestroyed
            )
              return;
            deferred.failed = false;
            deferred.retryAttempts = 0;
            this.observeDeferredPanelShell(key, deferred);
          },
          { once: true },
        );
      }
      return;
    }
    deferred.retryAttempts += 1;
    deferred.retryTimer = setTimeout(() => {
      deferred.retryTimer = null;
      if (
        this.deferredPanelMounts.get(key) !== deferred ||
        deferred.mounted ||
        this.ctx.isDestroyed
      )
        return;
      this.observeDeferredPanelShell(key, deferred);
    }, DEFERRED_PANEL_RETRY_DELAY_MS);
  }

  private mountDeferredPanel(key: string): boolean {
    const deferred = this.deferredPanelMounts.get(key);
    if (!deferred || deferred.mounted || deferred.loading || deferred.failed) return false;
    const grid = this.getPanelMountGrid(key);
    if (!grid && !deferred.placeholder?.parentNode) return false;

    markLcpDebug('wm:panel:deferred-mount-start', { panel: key });

    deferred.observer?.disconnect();
    deferred.observer = null;
    if (deferred.retryTimer !== null) {
      clearTimeout(deferred.retryTimer);
      deferred.retryTimer = null;
    }
    const targetGrid = grid ?? (deferred.placeholder!.parentNode as HTMLElement);
    const finish = (panel: Panel | null): void => {
      const current = this.deferredPanelMounts.get(key);
      if (current !== deferred || deferred.mounted) return;
      deferred.loading = null;
      if (!panel || this.ctx.isDestroyed) {
        markLcpDebug('wm:panel:deferred-mount-unavailable', { panel: key });
        this.scheduleDeferredPanelRetry(key, deferred);
        return;
      }
      const placeholder = deferred.placeholder;
      const mounted = this.mountPanelElement(targetGrid, key, panel, placeholder);
      if (mounted) {
        this.afterPanelMounted(key, panel);
      }
      deferred.mounted = true;
      deferred.placeholder = null;
      this.deferredPanelMounts.delete(key);
      markLcpDebug('wm:panel:deferred-mount-ready', { mounted, panel: key });
    };

    if (deferred.panel) {
      finish(deferred.panel);
      return true;
    }
    deferred.loading = this.loadRegisteredPanel(key).then(finish, () => finish(null));
    return true;
  }

  private scheduleHydrationForPanelElement(
    element: HTMLElement,
    fallbackPhase: HydrationSchedulePhase = 'near',
  ): void {
    if (typeof window === 'undefined') {
      this.scheduleLoadAllData(fallbackPhase);
      return;
    }

    measure(() => {
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const phase: HydrationSchedulePhase =
        rect.top < viewportHeight && rect.bottom > 0 ? 'visible' : 'near';
      mutate(() => {
        if (this.ctx.isDestroyed) return;
        this.scheduleLoadAllData(phase);
      });
    });
  }

  private observePanelForHydration(panel: Panel): void {
    if (this.observedHydrationPanels.has(panel)) return;
    this.observedHydrationPanels.add(panel);
    panel.observeNearViewport(() => {
      this.scheduleHydrationForPanelElement(panel.getElement(), 'near');
    }, 200);
  }

  private afterPanelMounted(key: string, panel: Panel): void {
    const config = this.ctx.panelSettings[key];
    if (config) panel.toggle(config.enabled);
    this.observePanelForHydration(panel);
    if (config?.enabled) {
      this.scheduleHydrationForPanelElement(panel.getElement(), 'near');
    }
    // Notify PanelLayout.tsx so it portals the React component into the new container.
    refreshAppContext();
  }

  private getPanelElementForOrdering(key: string): HTMLElement | null {
    const deferred = this.deferredPanelMounts.get(key);
    if (deferred && !deferred.mounted) {
      if (deferred.placeholder) return deferred.placeholder;
      if (!this.ctx.panelSettings[key]?.enabled) return null;
      this.mountDeferredPanel(key);
    }
    return this.ctx.panels[key]?.getElement() ?? null;
  }

  private async createPanels(): Promise<void> {
    const panelsGrid = document.getElementById('panelsGrid')!;
    this.initiallyMountedEnabledPanelCount = 0;

    const mapReactMount = document.getElementById('mapReactMount') as HTMLElement;
    const preferGlobe = getStoredMapModePreference() === 'globe';
    // Dynamic import: keeps maplibre-gl + @deck.gl/* + @loaders.gl + @luma.gl out of
    // the entry chunk.
    //
    // U3 (#4459): kick off the map chunk fetch HERE but await it only after the ~730
    // lines of panel registration below, so registration runs concurrently with the
    // fetch instead of serialized behind it. This is the restructure the prior canary
    // comment called for: panel setup is map-tolerant: callback uses are `?.`-guarded,
    // ctx.currentTimeRange already defaults to '7d' (App.ts:899). The map's direct
    // uses — construction, the resilienceScore tweak, initEscalationGetters/getTimeRange
    // and onTimeRangeChanged — are grouped together after the registration block.
    // Failed-fetch reload guard: src/main.ts:285-290 (installChunkReloadGuard).
    const mapModulePromise = import('@/components/MapContainer');

    // Register all React panels from PANEL_REGISTRY as ReactFullPanel containers.
    // createFullReactPanelLoader's importer/name params were already unused (see
    // ReactPanelBridge.ts); every call just returned new ReactFullPanel(). The loop
    // is equivalent and ~500 lines shorter. shouldCreatePanel() filters by
    // panelSettings, making the former variant/desktop guards redundant.
    // News-category panels (politics, tech, finance, gov, intel, etc.) are now in
    // PANEL_REGISTRY and handled by this loop — no more static createNewsPanel() calls.
    for (const panelId of Object.keys(PANEL_REGISTRY)) {
      if (panelId === 'airline-intel') continue; // handled below: side-loads AviationCommandBar
      this.lazyPanel(panelId, async () => new ReactFullPanel() as unknown as Panel);
    }

    // airline-intel: same ReactFullPanel but also side-loads AviationCommandBar
    this.lazyPanel('airline-intel', async () => {
      void import('@/components/AviationCommandBar')
        .then(({ AviationCommandBar }) => {
          if (!this.ctx.isDestroyed) this.aviationCommandBar = new AviationCommandBar();
        })
        .catch((err) => {
          console.error('[panel] failed to lazy-load "airline-intel" command bar', err);
        });
      return new ReactFullPanel() as unknown as Panel;
    });

    // 'live-news' and 'live-webcams' are now in PANEL_REGISTRY — registered in the loop above.

    // Seed newsCategoryPanelKeys for the 27 news panels now in PANEL_REGISTRY.
    // Their category key equals their panel key; shouldCreatePanel() guards enablement.
    for (const panelId of REGISTRY_NEWS_PANEL_IDS) {
      if (this.shouldCreatePanel(panelId)) {
        this.ctx.newsCategoryPanelKeys.set(panelId, panelId);
      }
    }

    // Iterate CANONICAL_FEEDS (union of all variants), not just the active
    // variant's FEEDS preset — so a news panel the user customized in from
    // another variant (e.g. Finance `forex` added to a `full` session) still
    // gets a NewsPanel created. The panelSettings gate inside
    // newsPanelKeyForCategory ensures only panels the user actually has an entry
    // for are instantiated.
    //
    // Every registration above has already run, so `isPanelKeyClaimed` is the
    // live answer to "does a data panel already own this feed-category key?" —
    // the fact the collision remap is derived from, instead of the hardcoded
    // `markets`/`crypto`/`economic` set that silently omitted `commodities`
    // (#5871). See src/app/news-panel-keys.ts.
    const newsPanelKeyLookups = newsPanelKeyLookupsFor({
      canonicalFeeds: CANONICAL_FEEDS,
      panels: this.ctx.panels,
      lazyPanelRegistrations: this.lazyPanelRegistrations,
      newsCategoryPanelKeys: this.ctx.newsCategoryPanelKeys,
      panelSettings: this.ctx.panelSettings,
      lateRegisteredPanelKeys: new Set(),
    });
    for (const key of Object.keys(CANONICAL_FEEDS)) {
      const panelKey = newsPanelKeyForCategory(key, newsPanelKeyLookups);
      if (!panelKey) continue;
      const panelConfig = this.ctx.panelSettings[panelKey];
      const label = panelConfig?.name ?? key.charAt(0).toUpperCase() + key.slice(1);
      const tooltip =
        PanelLayoutManager.NEWS_PANEL_TOOLTIPS[panelKey] ??
        PanelLayoutManager.NEWS_PANEL_TOOLTIPS[key];
      this.createNewsPanelWithLabel(panelKey, label, tooltip, key);
    }

    // Always load custom widgets — Pro gating is handled reactively by auth state.
    for (const spec of loadWidgets()) {
      if (!this.ctx.panelSettings[spec.id]) {
        this.ctx.panelSettings[spec.id] = { name: spec.title, enabled: true, priority: 3 };
      }
      const capturedSpec = spec;
      this.lazyPanel(spec.id, () =>
        this.importPanel(
          spec.id,
          () => import('@/components/CustomWidgetPanel'),
          'CustomWidgetPanel',
          (CustomWidgetPanel) => new CustomWidgetPanel(capturedSpec),
        ),
      );
    }

    for (const spec of loadMcpPanels()) {
      if (!this.ctx.panelSettings[spec.id]) {
        this.ctx.panelSettings[spec.id] = { name: spec.title, enabled: true, priority: 3 };
      }
      const capturedSpec = spec;
      this.lazyPanel(spec.id, () =>
        this.importPanel(
          spec.id,
          () => import('@/components/McpDataPanel'),
          'McpDataPanel',
          (McpDataPanel) => new McpDataPanel(capturedSpec),
        ),
      );
    }

    const variantOrder = (VARIANT_DEFAULTS[SITE_VARIANT] ?? VARIANT_DEFAULTS['full'] ?? []).filter(
      (k) => k !== 'map',
    );
    const activePanelSet = new Set(Object.keys(this.ctx.panelSettings));
    const crossVariantKeys = Object.keys(this.ctx.panelSettings).filter(
      (k) => !variantOrder.includes(k) && k !== 'map',
    );
    const defaultOrder = [
      ...variantOrder.filter((k) => activePanelSet.has(k)),
      ...crossVariantKeys,
    ];
    const activePanelKeys = Object.keys(this.ctx.panelSettings).filter((k) => k !== 'map');
    const bottomSet = this.panelOrderManager.getSavedBottomSet();
    const savedOrder = this.panelOrderManager.getSavedPanelOrder();
    this.panelOrderManager.bottomSetMemory = bottomSet;
    const effectiveUltraWide = this.panelOrderManager.getEffectiveUltraWide();
    this.panelOrderManager.initZoneState(effectiveUltraWide);

    const hasSavedOrder = savedOrder.length > 0;
    let allOrder: string[];

    if (hasSavedOrder) {
      const valid = savedOrder.filter((k) => activePanelKeys.includes(k));
      const missing = activePanelKeys.filter((k) => !valid.includes(k));

      missing.forEach((k) => {
        if (k === 'monitors') return;
        const defaultIdx = defaultOrder.indexOf(k);
        if (defaultIdx === -1) {
          valid.push(k);
          return;
        }
        let inserted = false;
        for (let i = defaultIdx + 1; i < defaultOrder.length; i++) {
          const afterIdx = valid.indexOf(defaultOrder[i]!);
          if (afterIdx !== -1) {
            valid.splice(afterIdx, 0, k);
            inserted = true;
            break;
          }
        }
        if (!inserted) valid.push(k);
      });

      const monitorsIdx = valid.indexOf('monitors');
      if (monitorsIdx !== -1) valid.splice(monitorsIdx, 1);
      if (SITE_VARIANT !== 'happy') valid.push('monitors');
      allOrder = valid;
    } else {
      allOrder = [...defaultOrder];

      if (SITE_VARIANT !== 'happy') {
        const liveNewsIdx = allOrder.indexOf('live-news');
        if (liveNewsIdx > 0) {
          allOrder.splice(liveNewsIdx, 1);
          allOrder.unshift('live-news');
        }

        const webcamsIdx = allOrder.indexOf('live-webcams');
        if (webcamsIdx !== -1 && webcamsIdx !== allOrder.indexOf('live-news') + 1) {
          allOrder.splice(webcamsIdx, 1);
          const afterNews = allOrder.indexOf('live-news') + 1;
          allOrder.splice(afterNews, 0, 'live-webcams');
        }
      }

      if (this.ctx.isDesktopApp) {
        const runtimeIdx = allOrder.indexOf('runtime-config');
        if (runtimeIdx > 1) {
          allOrder.splice(runtimeIdx, 1);
          allOrder.splice(1, 0, 'runtime-config');
        } else if (runtimeIdx === -1) {
          allOrder.splice(1, 0, 'runtime-config');
        }
      }
    }

    this.panelOrderManager.resolvedPanelOrder = allOrder;

    const sidebarOrder = effectiveUltraWide
      ? allOrder.filter((k) => !this.panelOrderManager.bottomSetMemory.has(k))
      : allOrder;
    const bottomOrder = effectiveUltraWide
      ? allOrder.filter((k) => this.panelOrderManager.bottomSetMemory.has(k))
      : [];

    sidebarOrder.forEach((key: string) => {
      this.insertInitialPanelByKey(panelsGrid, key);
    });

    this.unsubscribeProBlocks = createAddPanelBlocks(
      panelsGrid,
      () => this.ctx.unifiedSettings?.open('panels'),
      (spec) => this.addCustomWidget(spec),
      (spec) => this.addMcpPanel(spec),
    );

    const bottomGrid = document.getElementById('mapBottomGrid');
    if (bottomGrid) {
      bottomOrder.forEach((key) => {
        this.insertInitialPanelByKey(bottomGrid, key);
      });
    }

    this.panelOrderManager.initResponsiveZoneListener();

    // Map's direct-deref block (kept here, after panel registration, by U3 #4459):
    // awaited only after registration so the chunk fetch overlaps it. Everything above
    // that touches the map does so via `?.` at mount/click time, so the map can be
    // constructed here without breaking registration. The responsive zone listener is
    // wired above (before this await) so a destroy() during the fetch tears it down;
    // the isDestroyed guard below also stops a destroyed manager from building a map.
    const [{ MapContainer: MapContainerClass }, { mountMapContainer }] = await Promise.all([
      mapModulePromise,
      import('@/components/MapContainerReact'),
    ]);
    if (this.ctx.isDestroyed) return;
    markLcpDebug('wm:map:container-construct');
    this.ctx.map = mountMapContainer(mapReactMount, {
      MapContainerClass,
      initialState: {
        zoom: this.ctx.isMobile ? 2.5 : 1.0,
        pan: { x: 0, y: 0 },
        view: this.ctx.isMobile ? this.ctx.resolvedLocation : 'global',
        layers: this.ctx.mapLayers,
        timeRange: '7d',
      },
      preferGlobe,
    });

    if (this.ctx.mapLayers.resilienceScore && !this.ctx.map.isDeckGLActive?.()) {
      this.ctx.mapLayers = { ...this.ctx.mapLayers, resilienceScore: false };
      saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
    }

    this.ctx.map.initEscalationGetters();
    this.ctx.currentTimeRange = this.ctx.map.getTimeRange();
    markLcpDebug('wm:map:container-ready');

    this.ctx.map.onTimeRangeChanged((range) => {
      this.ctx.currentTimeRange = range;
      this.applyTimeRangeFilterDebounced();
    });

    this.applyPanelSettings();
    applyInitialUrlState(this.ctx);

    // Observe each panel for viewport entry. As soon as a panel scrolls
    // within ~200px of the viewport it fires loadAllData() once
    // (debounced via rAF to coalesce above-the-fold panels that all
    // intersect on the first tick), so below-fold panels get their
    // viewport-gated data without waiting on the scroll listener.
    // Bootstrap already ran loadAllData() with forceAll=false, so this
    // is purely the lazy-scroll trigger. (#3990)
    this.observePanelsForViewport();

    if (import.meta.env.DEV) {
      const configured = new Set(Object.keys(ALL_PANELS).filter((k) => k !== 'map'));
      const created = new Set(Object.keys(this.ctx.panels));
      const extra = [...created].filter(
        (k) =>
          !configured.has(k) &&
          k !== 'runtime-config' &&
          !k.startsWith('cw-') &&
          !k.startsWith('mcp-'),
      );
      if (extra.length)
        console.warn('[PanelLayoutManager] Panels created but not in ALL_PANELS:', extra);
    }
  }

  private cancelScheduledLoadAllIdle(): void {
    if (this.scheduledLoadAllIdle === null || typeof window === 'undefined') return;
    const cancelIdle = window.cancelIdleCallback as ((handle: number) => void) | undefined;
    cancelIdle?.(this.scheduledLoadAllIdle);
    this.scheduledLoadAllIdle = null;
  }

  private scheduleLoadAllData(phase: HydrationSchedulePhase = 'near'): void {
    if (typeof window === 'undefined') {
      void this.callbacks.loadAllData();
      return;
    }
    const mark = (label: string) => {
      if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
        performance.mark(label);
      }
    };
    if (phase === 'near') {
      if (this.scheduledLoadAllIdle !== null || this.scheduledLoadAllRaf !== null) return;
      const idle = window.requestIdleCallback as
        ((cb: IdleRequestCallback, opts?: IdleRequestOptions) => number) | undefined;
      if (idle) {
        this.scheduledLoadAllIdle = idle(
          () => {
            this.scheduledLoadAllIdle = null;
            mark('wm:hydration:near-trigger');
            void this.callbacks.loadAllData();
          },
          { timeout: 300 },
        );
        return;
      }
    } else {
      this.cancelScheduledLoadAllIdle();
      if (this.scheduledLoadAllRaf !== null) return;
    }
    if (this.scheduledLoadAllRaf !== null) {
      return;
    }
    this.scheduledLoadAllRaf = window.requestAnimationFrame(() => {
      this.scheduledLoadAllRaf = null;
      mark(`wm:hydration:${phase}-trigger`);
      void this.callbacks.loadAllData();
    });
  }

  private observePanelsForViewport(): void {
    for (const panel of Object.values(this.ctx.panels)) {
      this.observePanelForHydration(panel);
    }
  }

  private addDynamicPanel(key: string, panel: Panel): void {
    this.ctx.panels[key] = panel;
    const el = panel.getElement();
    makeDraggable(
      el,
      key,
      this.panelOrderManager.bottomSetMemory,
      () => this.panelOrderManager.savePanelOrder(),
      (cleanup) => this.panelDragCleanupHandlers.push(cleanup),
    );
    const grid = document.getElementById('panelsGrid');
    if (grid) {
      const addBlock = grid.querySelector('.add-panel-block');
      if (addBlock) {
        grid.insertBefore(el, addBlock);
      } else {
        grid.appendChild(el);
      }
      this.ctx.mobilePanelNav?.applyToNewPanel(el);
      panel.notifyConnected();
      this.afterPanelMounted(key, panel);
    }
    this.savePanelOrder();
    this.applyPanelSettings();
  }

  async addCustomWidget(spec: CustomWidgetSpec): Promise<void> {
    await saveWidget(spec);
    this.ctx.panelSettings[spec.id] = { name: spec.title, enabled: true, priority: 3 };
    saveToStorage(STORAGE_KEYS.panels, this.ctx.panelSettings);
    void this.importPanel(
      spec.id,
      () => import('@/components/CustomWidgetPanel'),
      'CustomWidgetPanel',
      (CustomWidgetPanel) => new CustomWidgetPanel(spec),
    ).then((panel) => {
      if (panel) this.addDynamicPanel(spec.id, panel);
    });
  }

  addMcpPanel(spec: McpPanelSpec): void {
    saveMcpPanel(spec);
    this.ctx.panelSettings[spec.id] = { name: spec.title, enabled: true, priority: 3 };
    saveToStorage(STORAGE_KEYS.panels, this.ctx.panelSettings);
    void this.importPanel(
      spec.id,
      () => import('@/components/McpDataPanel'),
      'McpDataPanel',
      (McpDataPanel) => new McpDataPanel(spec),
    ).then((panel) => {
      if (panel) this.addDynamicPanel(spec.id, panel);
    });
  }

  public applySavedPanelOrder(panelOrder?: string[]): void {
    this.panelOrderManager.applySavedPanelOrder(panelOrder, (key) =>
      this.getPanelElementForOrdering(key),
    );
  }

  savePanelOrder(): void {
    this.panelOrderManager.savePanelOrder();
  }

  private insertByOrder(grid: HTMLElement, el: HTMLElement, key: string): void {
    this.panelOrderManager.insertByOrder(grid, el, key);
  }

  public ensureCorrectZones(): void {
    this.panelOrderManager.ensureCorrectZones();
  }

  private importPanel<M extends object, K extends keyof M & string>(
    key: string,
    importer: () => Promise<M>,
    exportName: K,
    createPanel: (PanelClass: PanelExport<M, K>, module: M) => ImportedPanel<M, K> | null,
  ): Promise<ImportedPanel<M, K> | null> {
    return importer().then(
      (module) => {
        const PanelClass = module[exportName];
        if (typeof PanelClass !== 'function') {
          console.error(`[panel] ${exportName} export unavailable for "${key}"`);
          return null;
        }
        return createPanel(PanelClass as PanelExport<M, K>, module);
      },
      (err) => {
        console.error(`[panel] failed to lazy-load "${key}"`, err);
        return null;
      },
    );
  }

  /**
   * Register a lazily-loaded panel under `key`.
   *
   * Returns whether THIS call claimed the key: `false` means the key is unknown
   * to `panelSettings`, or some earlier registration (often a non-news data
   * panel) already owns it and this registration is a no-op. Callers that index
   * a panel by something other than its panel key rely on that signal — see
   * `createNewsPanelWithLabel`.
   */
  private lazyPanel<T extends Panel>(
    key: string,
    loader: () => Promise<T | null>,
    setup?: (panel: T) => void,
    lockedFeatures?: string[],
  ): boolean {
    if (!this.shouldCreatePanel(key)) return false;
    if (this.ctx.panels[key] || this.lazyPanelRegistrations.has(key)) return false;
    this.lazyPanelRegistrations.set(key, {
      loading: null,
      load: async () => {
        if (this.ctx.isDestroyed) return null;
        const panel = await loader();
        if (!panel) return null;
        const basePanel = panel;
        if (this.ctx.isDestroyed) {
          basePanel.destroy?.();
          return null;
        }
        this.ctx.panels[key] = basePanel;
        if (lockedFeatures) {
          basePanel.showLocked(lockedFeatures);
        } else {
          // Re-apply auth gating for panels that load after the initial auth state fire.
          this.updatePanelGating(getAuthState());
          await replayPendingCalls(key, panel);
          if (this.ctx.isDestroyed) {
            basePanel.destroy?.();
            return null;
          }
          if (setup) setup(panel);
        }
        return basePanel;
      },
    });
    return true;
  }

  private async loadRegisteredPanel(key: string): Promise<Panel | null> {
    const existing = this.ctx.panels[key];
    if (existing) return existing;
    const registration = this.lazyPanelRegistrations.get(key);
    if (!registration) return null;
    if (!registration.loading) {
      registration.loading = registration
        .load()
        .then((panel) => {
          if (panel) {
            this.lazyPanelRegistrations.delete(key);
          } else {
            registration.loading = null;
          }
          return panel;
        })
        .catch((err) => {
          registration.loading = null;
          console.error(`[panel] failed to lazy-load "${key}"`, err);
          return null;
        });
    }
    return registration.loading;
  }

  getLocalizedPanelName(panelKey: string, fallback: string): string {
    if (panelKey === 'runtime-config') {
      return t('modals.runtimeConfig.title');
    }
    const key = panelKey.replace(/-([a-z])/g, (_match, group: string) => group.toUpperCase());
    const lookup = `panels.${key}`;
    const localized = t(lookup);
    return localized === lookup ? fallback : localized;
  }
}
