import type { MapLayers, PanelConfig } from '@/types';
import { normalizeExclusiveChoropleths } from '@/components/resilience-choropleth-utils';
import {
  DEFAULT_PANELS,
  DEFAULT_MAP_LAYERS,
  MOBILE_DEFAULT_MAP_LAYERS,
  STORAGE_KEYS,
  SITE_VARIANT,
  ALL_PANELS,
  VARIANT_DEFAULTS,
  getEffectivePanelConfig,
  FREE_MAX_SOURCES,
} from '@/config';
import { sanitizeLayersForVariant, type MapVariant } from '@/config/map-layer-definitions';
import { loadFromStorage, saveToStorage } from '@/utils';
import { clearPanelSpans } from '@/utils/panel-storage';
import {
  computeDefaultDisabledSources,
  computeLegacyDefaultDisabledSources,
  FEEDS,
  FRONTLINE_EUROPE_PROTECTED_SOURCES,
  getLocaleBoostedSources,
  getTotalFeedCount,
  INTEL_SOURCES,
} from '@/config/feeds';
import { computeCapDisabledSources } from '@/services/source-cap';
import { migrateFrontlineEuropeDefaultsV3 } from '@/utils/cloud-prefs-migrations';

export function initializePanelAndMapSettings(opts: {
  isMobile: boolean;
  isDesktopApp: boolean;
  currentVariant: string;
  PANEL_ORDER_KEY: string;
  PANEL_SPANS_KEY: string;
}): { mapLayers: MapLayers; panelSettings: Record<string, PanelConfig>; storageAvailable: boolean } {
  const { isMobile, isDesktopApp, currentVariant, PANEL_ORDER_KEY, PANEL_SPANS_KEY } = opts;

  // Use mobile-specific defaults on first load (no saved layers)
  const defaultLayers = isMobile ? MOBILE_DEFAULT_MAP_LAYERS : DEFAULT_MAP_LAYERS;

  let mapLayers: MapLayers;
  let panelSettings: Record<string, PanelConfig>;

  // Panels that must survive variant switches: desktop config, user-created widgets, MCP panels.
  const isDynamicPanel = (k: string) => !ALL_PANELS[k] && (k === 'runtime-config' || k.startsWith('cw-') || k.startsWith('mcp-'));

  let storedVariant: string | null = null;
  let storageAvailable = true;
  try {
    storedVariant = localStorage.getItem('worldmonitor-variant');
    const probeKey = 'wm-storage-capability-probe';
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
  } catch {
    storageAvailable = false;
  }

  // Blocked storage is a supported no-persistence mode. Seed the same
  // defaults as a first visit and skip migrations that only mutate storage.
  if (!storageAvailable) {
    mapLayers = normalizeExclusiveChoropleths(
      sanitizeLayersForVariant({ ...defaultLayers }, currentVariant as MapVariant), null,
    );
    panelSettings = { ...DEFAULT_PANELS };
  } else if (storedVariant !== currentVariant) {
    // Variant changed - reset all settings to variant defaults.
    console.log(`[App] Variant check: stored="${storedVariant}", current="${currentVariant}"`);
    // Variant changed — seed new variant's panels, disable panels not in the new variant
    console.log('[App] Variant changed - seeding new defaults, disabling cross-variant panels');
    localStorage.setItem('worldmonitor-variant', currentVariant);
    // Reset map layers for the new variant (map layers are not user-personalized the same way)
    localStorage.removeItem(STORAGE_KEYS.mapLayers);
    mapLayers = normalizeExclusiveChoropleths(
      sanitizeLayersForVariant({ ...defaultLayers }, currentVariant as MapVariant), null,
    );
    // Load existing panel prefs (if any), disable panels not belonging to the new variant
    panelSettings = loadFromStorage<Record<string, PanelConfig>>(STORAGE_KEYS.panels, {});
    const newVariantKeys = new Set(VARIANT_DEFAULTS[currentVariant] ?? []);
    for (const key of Object.keys(panelSettings)) {
      if (!newVariantKeys.has(key) && !isDynamicPanel(key) && panelSettings[key]) {
        panelSettings[key] = { ...panelSettings[key]!, enabled: false };
      }
    }
    for (const key of newVariantKeys) {
      if (!(key in panelSettings)) {
        panelSettings[key] = { ...getEffectivePanelConfig(key, currentVariant) };
      }
    }
  } else {
    mapLayers = normalizeExclusiveChoropleths(
      sanitizeLayersForVariant(
        loadFromStorage<MapLayers>(STORAGE_KEYS.mapLayers, defaultLayers),
        currentVariant as MapVariant,
      ), null,
    );
    panelSettings = loadFromStorage<Record<string, PanelConfig>>(
      STORAGE_KEYS.panels,
      DEFAULT_PANELS
    );

    // One-time migration: preserve user preferences across panel key renames.
    const PANEL_KEY_RENAMES_MIGRATION_KEY = 'worldmonitor-panel-key-renames-v2.6.8';
    if (!localStorage.getItem(PANEL_KEY_RENAMES_MIGRATION_KEY)) {
      let migrated = false;
      const keyRenames: Array<[string, string]> = [
        ['live-youtube', 'live-webcams'],
        ['pinned-webcams', 'windy-webcams'],
        ...(SITE_VARIANT === 'finance' ? [['regulation', 'fin-regulation'] as [string, string]] : []),
      ];
      // In non-finance variants, 'regulation' was dead config (no feeds). Just prune it.
      if (SITE_VARIANT !== 'finance' && panelSettings['regulation']) {
        delete panelSettings['regulation'];
        migrated = true;
      }
      for (const [legacyKey, nextKey] of keyRenames) {
        if (!panelSettings[legacyKey] || panelSettings[nextKey]) continue;
        panelSettings[nextKey] = {
          ...DEFAULT_PANELS[nextKey],
          ...panelSettings[legacyKey],
          name: DEFAULT_PANELS[nextKey]?.name ?? panelSettings[legacyKey].name,
        };
        delete panelSettings[legacyKey];
        migrated = true;
      }
      // Also migrate saved panel order/bottom-set entries for renamed keys
      for (const [legacyKey, nextKey] of keyRenames) {
        for (const orderKey of [PANEL_ORDER_KEY, PANEL_ORDER_KEY + '-bottom-set', PANEL_ORDER_KEY + '-bottom']) {
          try {
            const raw = localStorage.getItem(orderKey);
            if (!raw) continue;
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) continue;
            const idx = arr.indexOf(legacyKey);
            if (idx !== -1) { arr[idx] = nextKey; localStorage.setItem(orderKey, JSON.stringify(arr)); migrated = true; }
          } catch { /* corrupt storage, skip */ }
        }
      }
      if (migrated) saveToStorage(STORAGE_KEYS.panels, panelSettings);
      localStorage.setItem(PANEL_KEY_RENAMES_MIGRATION_KEY, 'done');
    }

    // Merge in any panels from ALL_PANELS that didn't exist when settings were saved
    for (const key of Object.keys(ALL_PANELS)) {
      if (!(key in panelSettings)) {
        const config = getEffectivePanelConfig(key, SITE_VARIANT);
        const isInVariant = (VARIANT_DEFAULTS[SITE_VARIANT] ?? []).includes(key);
        panelSettings[key] = { ...config, enabled: isInVariant && config.enabled };
      }
    }

    // One-time migration: expose all panels to existing users (previously variant-gated)
    const UNIFIED_MIGRATION_KEY = 'worldmonitor-unified-panels-v1';
    if (!localStorage.getItem(UNIFIED_MIGRATION_KEY)) {
      const variantDefaults = new Set(VARIANT_DEFAULTS[SITE_VARIANT] ?? []);
      for (const key of Object.keys(ALL_PANELS)) {
        if (!(key in panelSettings)) {
          const config = getEffectivePanelConfig(key, SITE_VARIANT);
          panelSettings[key] = { ...config, enabled: variantDefaults.has(key) && config.enabled };
        }
      }
      saveToStorage(STORAGE_KEYS.panels, panelSettings);
      localStorage.setItem(UNIFIED_MIGRATION_KEY, 'done');
    }

    // One-time migration: fix happy variant sessions that got cross-variant panels enabled
    // (regression from #1911 unified panel registry which failed to disable non-variant panels on variant switch)
    const HAPPY_PANEL_FIX_KEY = 'worldmonitor-happy-panel-fix-v1';
    if (SITE_VARIANT === 'happy' && !localStorage.getItem(HAPPY_PANEL_FIX_KEY)) {
      const happyKeys = new Set(VARIANT_DEFAULTS['happy'] ?? []);
      let fixed = false;
      for (const key of Object.keys(panelSettings)) {
        if (!happyKeys.has(key) && !isDynamicPanel(key) && panelSettings[key]?.enabled) {
          panelSettings[key] = { ...panelSettings[key]!, enabled: false };
          fixed = true;
        }
      }
      if (fixed) saveToStorage(STORAGE_KEYS.panels, panelSettings);
      localStorage.setItem(HAPPY_PANEL_FIX_KEY, 'done');
    }

    console.log('[App] Loaded panel settings from storage:', Object.entries(panelSettings).filter(([_, v]) => !v.enabled).map(([k]) => k));

    // One-time migration: reorder panels for existing users (v1.9 panel layout)
    const PANEL_ORDER_MIGRATION_KEY = 'worldmonitor-panel-order-v1.9';
    if (!localStorage.getItem(PANEL_ORDER_MIGRATION_KEY)) {
      const savedOrder = localStorage.getItem(PANEL_ORDER_KEY);
      if (savedOrder) {
        try {
          const order: string[] = JSON.parse(savedOrder);
          const priorityPanels = ['insights', 'strategic-posture', 'cii', 'strategic-risk'];
          const filtered = order.filter(k => !priorityPanels.includes(k) && k !== 'live-news');
          const liveNewsIdx = order.indexOf('live-news');
          const newOrder = liveNewsIdx !== -1 ? ['live-news'] : [];
          newOrder.push(...priorityPanels.filter(p => order.includes(p)));
          newOrder.push(...filtered);
          localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(newOrder));
          console.log('[App] Migrated panel order to v1.9 layout');
        } catch {
          // Invalid saved order, will use defaults
        }
      }
      localStorage.setItem(PANEL_ORDER_MIGRATION_KEY, 'done');
    }

    // Tech variant migration: move insights to top (after live-news)
    if (currentVariant === 'tech') {
      const TECH_INSIGHTS_MIGRATION_KEY = 'worldmonitor-tech-insights-top-v1';
      if (!localStorage.getItem(TECH_INSIGHTS_MIGRATION_KEY)) {
        const savedOrder = localStorage.getItem(PANEL_ORDER_KEY);
        if (savedOrder) {
          try {
            const order: string[] = JSON.parse(savedOrder);
            const filtered = order.filter(k => k !== 'insights' && k !== 'live-news');
            const newOrder: string[] = [];
            if (order.includes('live-news')) newOrder.push('live-news');
            if (order.includes('insights')) newOrder.push('insights');
            newOrder.push(...filtered);
            localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(newOrder));
            console.log('[App] Tech variant: Migrated insights panel to top');
          } catch {
            // Invalid saved order, will use defaults
          }
        }
        localStorage.setItem(TECH_INSIGHTS_MIGRATION_KEY, 'done');
      }
    }
  }

  if (storageAvailable) {
    // One-time migration: prune removed panel keys from stored settings and order
    const PANEL_PRUNE_KEY = 'worldmonitor-panel-prune-v1';
    if (!localStorage.getItem(PANEL_PRUNE_KEY)) {
      const validKeys = new Set(Object.keys(ALL_PANELS));
      let pruned = false;
      for (const key of Object.keys(panelSettings)) {
        if (!validKeys.has(key) && key !== 'runtime-config') {
          delete panelSettings[key];
          pruned = true;
        }
      }
      if (pruned) saveToStorage(STORAGE_KEYS.panels, panelSettings);
      for (const orderKey of [PANEL_ORDER_KEY, PANEL_ORDER_KEY + '-bottom-set', PANEL_ORDER_KEY + '-bottom']) {
        try {
          const raw = localStorage.getItem(orderKey);
          if (!raw) continue;
          const arr = JSON.parse(raw);
          if (!Array.isArray(arr)) continue;
          const filtered = arr.filter((k: string) => validKeys.has(k));
          if (filtered.length !== arr.length) localStorage.setItem(orderKey, JSON.stringify(filtered));
        } catch { localStorage.removeItem(orderKey); }
      }
      localStorage.setItem(PANEL_PRUNE_KEY, 'done');
    }

    // One-time migration: clear stale panel ordering and sizing state
    const LAYOUT_RESET_MIGRATION_KEY = 'worldmonitor-layout-reset-v2.5';
    if (!localStorage.getItem(LAYOUT_RESET_MIGRATION_KEY)) {
      const hadSavedOrder = !!localStorage.getItem(PANEL_ORDER_KEY);
      const hadSavedSpans = !!localStorage.getItem(PANEL_SPANS_KEY);
      if (hadSavedOrder || hadSavedSpans) {
        localStorage.removeItem(PANEL_ORDER_KEY);
        localStorage.removeItem(PANEL_ORDER_KEY + '-bottom');
        localStorage.removeItem(PANEL_ORDER_KEY + '-bottom-set');
        clearPanelSpans();
        console.log('[App] Applied layout reset migration (v2.5): cleared panel order/spans');
      }
      localStorage.setItem(LAYOUT_RESET_MIGRATION_KEY, 'done');
    }
  }

  // Desktop key management panel must always remain accessible in Tauri.
  if (isDesktopApp) {
    if (!panelSettings['runtime-config'] || !panelSettings['runtime-config'].enabled) {
      panelSettings['runtime-config'] = {
        ...panelSettings['runtime-config'],
        name: panelSettings['runtime-config']?.name ?? 'Desktop Configuration',
        enabled: true,
        priority: panelSettings['runtime-config']?.priority ?? 2,
      };
      saveToStorage(STORAGE_KEYS.panels, panelSettings);
    }
  }

  return { mapLayers, panelSettings, storageAvailable };
}

export function runSourceMigrations(currentVariant: string, storageAvailable: boolean): void {
  // One-time migration: reduce default-enabled sources (full variant only)
  if (currentVariant === 'full' && storageAvailable) {
    const baseKey = 'worldmonitor-sources-reduction-v3';
    if (!localStorage.getItem(baseKey)) {
      const defaultDisabled = computeDefaultDisabledSources();
      saveToStorage(STORAGE_KEYS.disabledFeeds, defaultDisabled);
      localStorage.setItem(baseKey, 'done');
      const total = getTotalFeedCount();
      console.log(`[App] Sources reduction: ${defaultDisabled.length} disabled, ${total - defaultDisabled.length} enabled`);
    }
    // #5949 — re-enable Ukraine/Poland frontline sources for profiles that
    // still have the untouched pre-#5949 default disabled set. An exact-set
    // guard is important here: a customized disabledFeeds set is user
    // intent, and must not be rewritten by the startup migration.
    const frontlineKey = 'worldmonitor-frontline-europe-enable-v1';
    if (!localStorage.getItem(frontlineKey)) {
      const frontline = new Set<string>(FRONTLINE_EUROPE_PROTECTED_SOURCES);
      const legacyDefaultDisabled = new Set(computeLegacyDefaultDisabledSources());
      const legacyCapDisabled = computeCapDisabledSources(
        FEEDS,
        INTEL_SOURCES,
        new Set(computeDefaultDisabledSources()),
        FREE_MAX_SOURCES,
      );
      const current = loadFromStorage<string[]>(STORAGE_KEYS.disabledFeeds, []);
      const migrated = migrateFrontlineEuropeDefaultsV3(
        { [STORAGE_KEYS.disabledFeeds]: JSON.stringify(current) },
        legacyDefaultDisabled,
        frontline,
        legacyCapDisabled,
      );
      const updated = JSON.parse(migrated[STORAGE_KEYS.disabledFeeds] as string) as string[];
      if (updated.length !== current.length) {
        saveToStorage(STORAGE_KEYS.disabledFeeds, updated);
        console.log(
          `[App] Frontline Europe enable (#5949): re-enabled ${current.length - updated.length} source(s)`,
        );
      }
      localStorage.setItem(frontlineKey, 'done');
    }
    // Locale boost: additively enable locale-matched sources (runs once per locale).
    // Reads the explicit-choice key (`wm-locale-explicit`, written by Settings →
    // Language) before falling back to navigator. Mirrors the i18n.ts:99
    // `wmExplicit` detector — without this, a user whose browser is en-US who
    // picks Magyar in Settings never gets the locale boost (the migration's
    // first run with `userLang='en'` sets `worldmonitor-locale-boost-en` and
    // the `userLang !== 'en'` short-circuit means the boost block never re-fires
    // for any subsequent locale choice). Direct localStorage read because
    // i18next isn't initialized yet here in the constructor — `initI18n()` is
    // called later inside `init()`.
    let explicitLocale = '';
    try { explicitLocale = localStorage.getItem('wm-locale-explicit') || ''; } catch { /* private mode */ }
    const userLang = ((explicitLocale || navigator.language || 'en').split('-')[0] ?? 'en').toLowerCase();
    const localeKey = `worldmonitor-locale-boost-${userLang}`;
    if (userLang !== 'en' && !localStorage.getItem(localeKey)) {
      const boosted = getLocaleBoostedSources(userLang);
      if (boosted.size > 0) {
        const current = loadFromStorage<string[]>(STORAGE_KEYS.disabledFeeds, []);
        const updated = current.filter(name => !boosted.has(name));
        saveToStorage(STORAGE_KEYS.disabledFeeds, updated);
        console.log(`[App] Locale boost (${userLang}): enabled ${current.length - updated.length} sources`);
      }
      localStorage.setItem(localeKey, 'done');
    }
  }
}
