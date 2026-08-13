import type { AppContext } from '@/app/app-context';
import type { PanelConfig } from '@/types';
import {
  STORAGE_KEYS,
  enforceFreePanelLimit,
  restoreFreeMapPanelAccess,
  restoreProGatedPanels,
  shouldDeferFreeTierEnforcement,
  FREE_MAX_SOURCES,
  FREE_MAX_PANELS,
} from '@/config';
import {
  FEEDS,
  FRONTLINE_EUROPE_PROTECTED_SOURCES,
  getLocaleBoostedSources,
  INTEL_SOURCES,
} from '@/config/feeds';
import {
  findFullyDisabledCategories,
  selectSourcesUnderCap,
} from '@/services/source-cap';
import {
  panelGateStateChanged,
  shouldRunCloudLegacyRecovery,
  sweepLegacyDisabledCustomWidgets,
} from '@/app/free-tier-gate';
import { isProUser, loadWidgets } from '@/services/widget-store';
import { loadFromStorage, saveToStorage } from '@/utils';
import { getAuthState } from '@/services/auth-state';
import { getEntitlementState } from '@/services/entitlements';
import { getSyncVersion } from '@/utils/cloud-prefs-sync';

export const FREE_MAP_PANEL_ACCESS_KEY = 'worldmonitor-free-map-panel-access-v1';
export const CW_PRO_GATE_RECOVERY_KEY = 'worldmonitor-cw-pro-gate-recovery-v1';
export const CW_PRO_GATE_CLOUD_RECOVERY_BASELINE_KEY = 'worldmonitor-cw-pro-gate-cloud-recovery-baseline-v1';
export const CW_PRO_GATE_CLOUD_RECOVERY_APPLIED_KEY = 'worldmonitor-cw-pro-gate-cloud-recovery-applied-v1';

/**
 * Put back the custom widgets the free-tier gate hid, now that we know the
 * user is Pro. Covers the free→pro upgrade, and heals users whose widgets
 * were disabled by a pre-fix build (see the one-time recovery below —
 * those entries pre-date the `proGated` marker, so they need the sweep).
 */
export function restoreProGatedCustomWidgets(
  ctx: AppContext,
  applyPanelSettings: () => void,
  cloudSyncVersion?: number,
): boolean {
  const panelSettings = loadFromStorage<Record<string, PanelConfig>>(STORAGE_KEYS.panels, {});
  let restored = restoreProGatedPanels(panelSettings);

  // ── One-time recovery for pre-`proGated` damage ───────────────────
  // Strictly once per browser. The sweep cannot tell legacy gate damage from
  // a widget the user hid on purpose (both are `enabled: false` with no
  // marker), so re-running it would silently un-hide deliberate hides. It was
  // previously re-armed on every cloud panels snapshot, which fires on
  // effectively every sign-in for a multi-device user — that re-arm is gone.
  //
  // Each device still heals itself on its first post-fix Pro reconcile, and
  // from then on `proGated` travels with the synced blob, so the targeted
  // restore above covers the cross-device case. A panel-bearing cloud
  // generation received before entitlement settles is retained in memory
  // until that Pro reconcile, so the one bounded second chance is not lost.
  //
  // The marker is burned on the first look, not the first repair: widget
  // specs are device-local (`wm-custom-widgets` is not a cloud-sync key), so
  // `loadWidgets()` is fully hydrated here and "found nothing" is a real
  // answer, not a not-yet-loaded one.
  try {
    let ownedWidgetIds: Set<string> | null = null;
    const sweepLegacy = (): void => {
      ownedWidgetIds ??= new Set(loadWidgets().map((w) => w.id));
      restored = sweepLegacyDisabledCustomWidgets(restored, ownedWidgetIds);
    };
    const recoveryMarker = localStorage.getItem(CW_PRO_GATE_RECOVERY_KEY);
    const baselineRaw = localStorage.getItem(CW_PRO_GATE_CLOUD_RECOVERY_BASELINE_KEY);
    const baselineParsed = baselineRaw === null ? Number.NaN : Number.parseInt(baselineRaw, 10);
    const baselineSyncVersion = Number.isFinite(baselineParsed) ? baselineParsed : null;
    const appliedRaw = localStorage.getItem(CW_PRO_GATE_CLOUD_RECOVERY_APPLIED_KEY);
    const appliedParsed = appliedRaw === null ? Number.NaN : Number.parseInt(appliedRaw, 10);
    const appliedSyncVersion = Number.isFinite(appliedParsed) ? appliedParsed : null;
    const effectiveCloudSyncVersion = cloudSyncVersion ?? ctx.pendingCloudRecoverySyncVersion;

    if (!recoveryMarker) {
      sweepLegacy();
      localStorage.setItem(CW_PRO_GATE_RECOVERY_KEY, 'done');
      // The current cloud snapshot was swept as part of the first recovery,
      // so mark it consumed when this call came from cloud reconciliation.
      const baseline = effectiveCloudSyncVersion ?? getSyncVersion();
      localStorage.setItem(CW_PRO_GATE_CLOUD_RECOVERY_BASELINE_KEY, String(baseline));
      if (effectiveCloudSyncVersion !== undefined) {
        localStorage.setItem(CW_PRO_GATE_CLOUD_RECOVERY_APPLIED_KEY, String(effectiveCloudSyncVersion));
      }
    } else if (baselineSyncVersion === null && effectiveCloudSyncVersion !== undefined) {
      // A browser may have burned the original marker before this bounded
      // cloud-generation guard shipped. Give its first observed cloud
      // snapshot one recovery pass, then never re-arm for later versions.
      sweepLegacy();
      localStorage.setItem(CW_PRO_GATE_CLOUD_RECOVERY_BASELINE_KEY, String(effectiveCloudSyncVersion));
      localStorage.setItem(CW_PRO_GATE_CLOUD_RECOVERY_APPLIED_KEY, String(effectiveCloudSyncVersion));
    } else if (baselineSyncVersion === null) {
      localStorage.setItem(CW_PRO_GATE_CLOUD_RECOVERY_BASELINE_KEY, String(getSyncVersion()));
    } else if (shouldRunCloudLegacyRecovery(baselineSyncVersion, appliedSyncVersion, effectiveCloudSyncVersion)) {
      // One bounded second chance covers a pre-fix snapshot arriving after
      // the local migration marker was already consumed. Deliberate hides
      // are protected from future cloud replays by the applied marker.
      sweepLegacy();
      localStorage.setItem(CW_PRO_GATE_CLOUD_RECOVERY_APPLIED_KEY, String(effectiveCloudSyncVersion));
    }
  } catch {
    // Persistence-only migration; blocked storage already uses defaults.
  }

  if (!panelGateStateChanged(panelSettings, restored)) return false;

  saveToStorage(STORAGE_KEYS.panels, restored);
  ctx.panelSettings = restored;
  applyPanelSettings();
  ctx.unifiedSettings?.refreshPanelToggles();
  console.log('[App] Pro: restored custom widget panels hidden by the free-tier gate');
  return true;
}

/**
 * Enforce free-tier panel and source limits.
 * Reads current values from storage, trims if necessary, and saves back.
 * Safe to call multiple times (idempotent) — e.g. on auth state changes.
 */
export function enforceFreeTierLimits(
  ctx: AppContext,
  applyPanelSettings: () => void,
  cloudSyncVersion?: number,
): boolean {
  // ── One-time v1 cap-bug recovery ──────────────────────────────────
  // Pre-2026-05-01 the source cap was enforced by Array.sort().slice(),
  // which silently auto-disabled every source past alphabetical position
  // FREE_MAX_SOURCES — catastrophically erasing late-alphabet categories
  // (Layoffs, Semiconductors, IPO, Funding, Product Hunt, …). Storage
  // didn't track auto-disabled vs user-disabled, so a heuristic that runs
  // on every load would silently undo a user who legitimately disabled
  // every source in a category — and re-undo it on every refresh forever.
  //
  // Migration approach: run findFullyDisabledCategories ONCE, gated by
  // disabledFeedsSchema version. After the migration completes, bump
  // schema → 1 so subsequent loads skip recovery entirely. Users who
  // explicitly toggle off every source in a category post-migration
  // keep that preference permanently. Trade-off: a user who BEFORE the
  // migration legitimately disabled every source in a category will lose
  // those preferences once. That's acceptable since v1 victims have been
  // suffering silent breakage and the explicit-full-category-disable
  // pattern is rare (users typically hide the whole panel instead).
  const schemaVersion = loadFromStorage<number>(STORAGE_KEYS.disabledFeedsSchema, 0);
  if (schemaVersion < 1) {
    const disabled = new Set(loadFromStorage<string[]>(STORAGE_KEYS.disabledFeeds, []));
    const recoverable = findFullyDisabledCategories(FEEDS, disabled);
    if (recoverable.length > 0) {
      for (const name of recoverable) disabled.delete(name);
      saveToStorage(STORAGE_KEYS.disabledFeeds, Array.from(disabled));
      console.log(`[App] One-time v1-cap-bug migration: re-enabled ${recoverable.length} source(s) from fully-disabled categories. This will not run again.`);
    }
    saveToStorage(STORAGE_KEYS.disabledFeedsSchema, 1);
  }

  if (isProUser()) {
    ctx.freeTierGate!.cancelFallback();
    return restoreProGatedCustomWidgets(ctx, applyPanelSettings, cloudSyncVersion);
  }

  // Pro/free is NOT knowable yet on a normal page load. initAuthState()
  // deliberately does not await Clerk (2.98 MB, loaded on requestIdleCallback
  // with a 4 s timeout) and the Convex entitlement snapshot lands later
  // still, so getAuthState() is `{ user: null, isPending: true }` here on
  // every boot — a signed-in Pro user is indistinguishable from an anonymous
  // one at this point.
  //
  // That matters because the clamp below is a PERSISTED write and
  // enforceFreePanelLimit disables every cw-* custom widget on the free
  // tier. Running it against an unresolved session wrote `enabled: false`
  // into STORAGE_KEYS.panels for Pro users' widgets on every single refresh:
  // the specs survived in wm-custom-widgets but the panels never mounted
  // again, so custom widgets appeared to vanish the moment the page
  // reloaded. (The widget e2e suite missed it because it seeds the legacy
  // wm-widget-key, which makes isProUser() true synchronously at boot.)
  //
  // Deferring is free: firePremiumLoaders() re-runs this on the Clerk auth
  // event and on every Convex entitlement snapshot. The fallback timer
  // covers the one case where neither ever arrives — Clerk's script fails
  // to load or VITE_CLERK_PUBLISHABLE_KEY is unset, where isPending stays
  // true forever and the free-tier caps would otherwise never be enforced.
  //
  // The same blindness recurs after Clerk settles: the auth callback runs
  // firePremiumLoaders() before initEntitlementSubscription() rebinds, so
  // for a signed-in user getEntitlementState() is still null and
  // isEntitled() is deterministically false at that instant — a Convex-only
  // Pro subscriber would be clamped as free on every load. Defer for that
  // window too; the entitlement snapshot re-runs this and the same fallback
  // timer bounds a snapshot that never arrives.
  const session = getAuthState();
  if (
    shouldDeferFreeTierEnforcement(
      session.isPending,
      session.user !== null,
      getEntitlementState() !== null,
      ctx.freeTierGate!.authSettleDeadlineExceeded,
    )
  ) {
    ctx.freeTierGate!.scheduleFallback();
    return false;
  }
  // Tier is known — drop the backstop instead of letting it fire a redundant
  // enforcement pass 8 s into every session.
  ctx.freeTierGate!.cancelFallback();

  // --- Panel limit ---
  // Delegate to the shared enforceFreePanelLimit helper so this boot path and
  // the dashboard-tab add/switch/load paths stay in lockstep (same cw-* and
  // count rules). isPro is false here — the isProUser() early-return above
  // already short-circuited pro users.
  let panelSettings = loadFromStorage<Record<string, PanelConfig>>(STORAGE_KEYS.panels, {});
  let panelsChanged = false;
  try {
    if (!localStorage.getItem(FREE_MAP_PANEL_ACCESS_KEY)) {
      const restoredPanels = restoreFreeMapPanelAccess(panelSettings);
      if (panelSettings.map?.enabled !== restoredPanels.map?.enabled) {
        panelSettings = restoredPanels;
        panelsChanged = true;
      }
      localStorage.setItem(FREE_MAP_PANEL_ACCESS_KEY, 'done');
    }
  } catch {
    // Persistence-only migration; blocked storage already uses defaults.
  }
  const clampedPanels = enforceFreePanelLimit(panelSettings, false);
  for (const key of Object.keys(panelSettings)) {
    if (panelSettings[key]?.enabled !== clampedPanels[key]?.enabled) {
      panelsChanged = true;
      break;
    }
  }
  if (panelsChanged) {
    saveToStorage(STORAGE_KEYS.panels, clampedPanels);
    ctx.panelSettings = clampedPanels;
    // Auth and entitlement callbacks can reach this path after the layout
    // has mounted. Persisting the clamp is not enough in that case: remove
    // now-ineligible panels from the live dashboard immediately as well.
    applyPanelSettings();
    ctx.unifiedSettings?.refreshPanelToggles();
    console.log(`[App] Free tier: enforced ${FREE_MAX_PANELS}-panel limit (disabled over-cap / cw-* panels)`);
  }

  // --- Source limit ---
  // Free-tier 80-source cap. Pre-2026-05-01 this used `Array.sort().slice()`
  // which silently auto-disabled every source past alphabetical position 80,
  // catastrophically erasing late-alphabet categories (Layoffs, Semiconductors,
  // IPO & SPAC, Funding & VC, Product Hunt, …) and producing the "All sources
  // disabled" red panel state on the homepage with no user explanation.
  // Replaced with round-robin per-category distribution from `selectSourcesUnderCap`.
  // (v1-bug recovery for stuck localStorage state is handled once at the top
  // of this function via the schema-version migration.)
  const disabledSources = new Set(loadFromStorage<string[]>(STORAGE_KEYS.disabledFeeds, []));
  const totalEligible = (() => {
    const s = new Set<string>();
    Object.values(FEEDS).forEach((feeds) => feeds?.forEach((f) => s.add(f.name)));
    INTEL_SOURCES.forEach((f) => s.add(f.name));
    let count = 0;
    for (const name of s) if (!disabledSources.has(name)) count++;
    return count;
  })();
  if (totalEligible > FREE_MAX_SOURCES) {
    // Protect locale-boosted sources from the cap. Without this, locale-
    // tagged feeds that sit late in their category bucket (e.g. Hungarian
    // entries in the Europe bucket, declared AFTER the existing en/de/it/
    // nl/sv defaults) get round-robin'd out — the locale boost re-enables
    // them, then the cap immediately auto-disables them again. Free-tier
    // users on the boosted locale lose their locale's defaults entirely.
    // userLang derivation mirrors the locale-boost migration (earlier in
    // the App constructor) and the i18n.ts:99 `wmExplicit` detector:
    // explicit Settings choice wins, navigator is the fallback. Direct
    // localStorage read because i18next isn't initialized yet at the
    // constructor stage where enforceFreeTierLimits also runs.
    let explicitLocale = '';
    try { explicitLocale = localStorage.getItem('wm-locale-explicit') || ''; } catch { /* private mode */ }
    const userLang = ((explicitLocale || navigator.language || 'en').split('-')[0] ?? 'en').toLowerCase();
    // Locale-boosted sources (non-en) + UA/RU/PL frontline balance set (#5950).
    // Without frontline protection, free EN users lose Kyiv Independent / Meduza /
    // Moscow Times to round-robin late-in-europe-bucket ordering — the #5950
    // balance rule would only hold for Pro (uncapped) profiles.
    const protectedNames = new Set<string>(FRONTLINE_EUROPE_PROTECTED_SOURCES);
    if (userLang !== 'en') {
      for (const name of getLocaleBoostedSources(userLang)) protectedNames.add(name);
    }
    const { keep, autoDisabled } = selectSourcesUnderCap(FEEDS, INTEL_SOURCES, disabledSources, FREE_MAX_SOURCES, protectedNames);
    // Defense in depth: feeds.ts has 35+ source names that appear in
    // multiple category buckets. The helper guarantees keep ∩ autoDisabled
    // = ∅, but a regression there would silently re-disable a kept source
    // here. The keep.has() guard makes the cross-set invariant explicit
    // at the caller too — if it ever fires it's a helper-bug signal.
    for (const name of autoDisabled) {
      if (!keep.has(name)) disabledSources.add(name);
    }
    saveToStorage(STORAGE_KEYS.disabledFeeds, Array.from(disabledSources));
    console.log(`[App] Free tier: round-robin disabled ${autoDisabled.size} source(s) to enforce ${FREE_MAX_SOURCES}-source limit (per-category fairness)`);
  }
  return panelsChanged;
}
