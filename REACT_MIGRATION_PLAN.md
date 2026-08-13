# Plan: Migrate WorldMonitor Frontend to React

## Context

Started as a vanilla TypeScript SPA with ~179 class-based panel components building DOM via `document.createElement()` and `innerHTML`. Goal: full migration to React function components + hooks, keeping WebGL map instances wrapped imperatively, leaving all backend/API/service code untouched.

**Current state (2026-08-12):** All 8 phases + cleanup complete. `src/App.ts` deleted. `main.tsx` uses `createRoot(<AppRoot />)` directly. All React panels live in `src/components/panels/` (moved from `src/react-components/panels/`). PanelLayoutManager dead code removed: `LATE_REGISTERED_PANEL_KEYS` deleted, `REGISTRY_NEWS_PANEL_IDS` derived from PANEL_REGISTRY ∩ CANONICAL_FEEDS, `computeEventRisk` extracted to `src/app/news-panel-utils.ts`. Remaining class files intentionally kept: `NewsPanel.ts` (CANONICAL_FEEDS dynamic panels), `CustomWidgetPanel.ts`, `McpDataPanel.ts`, `StatusPanel.ts`, `Panel.ts`, `ReactPanelBridge.ts`.

## Status

| Phase                                        | Status                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — Install & Configure                | ✅ Complete           | React + Vite plugin installed, JSX transform enabled                                                                                                                                                                                                                                                                                                                                                                              |
| Phase 1 — React Infrastructure               | ✅ Complete           | PanelShell, usePanelData, AppContextProvider, AppRoot skeleton all exist                                                                                                                                                                                                                                                                                                                                                          |
| Phase 2 — Panel Migration                    | ✅ Complete           | ~87 panels in `src/react-components/panels/`; 13 class files deleted; LiveNewsPanel converted to React                                                                                                                                                                                                                                                                                                                            |
| Phase 3 — Map Integration                    | ✅ Complete           | MapContainer React wrapper exists                                                                                                                                                                                                                                                                                                                                                                                                 |
| Phase 4 — App Orchestration (infrastructure) | ✅ Complete           | AppRoot.tsx + AppContextProvider wired; managers still coexist                                                                                                                                                                                                                                                                                                                                                                    |
| Phase 5 — Data Loading Migration             | ✅ Complete           | Panels self-fetch via `usePanelData`; push calls removed for all migrated panels. data-loader.ts decomposition: 4053 → **1813 lines** (55% reduction); `NewsLoader` (1165 lines), `MarketsLoader` (1231 lines), `IntelligenceLoader` (801 lines) all extracted to own files                                                                                                                                                        |
| Phase 6 — Event Handler Migration            | ✅ Complete           | `EventHandlerManager` fully dissolved; `event-handlers.ts` reduced to 46-line interface stub; 46+ hooks extracted to `AppRoot.tsx` / `src/hooks/`; `App.ts` 2374 → 321 lines (88% reduction)                                                                                                                                                                                                                                      |
| Phase 7 — Panel Layout Migration             | ✅ Complete           | LiveWebcamsPanel + LiveNewsPanel converted to React (controller-class pattern). All 27 static news categories in PANEL_REGISTRY via `news-panel-registry.ts` + `NewsPanelById`. `ctx.newsPanels` removed. `createNewsPanel()` calls removed from panel-layout.ts. |
| Phase 8 — App Entry Replacement              | ✅ Complete           | `App.ts` deleted. `create-app-managers.ts` (322 lines) holds constructor wiring. `AppRoot.tsx` calls `createAppManagers()` + `initApp()`/`destroyApp()` directly. TypeScript: 0 errors. |
| Cleanup                                      | ✅ Complete           | `src/react-components/panels/` → `src/components/panels/` consolidated. `LATE_REGISTERED_PANEL_KEYS` dead code deleted. `computeEventRisk` extracted to `news-panel-utils.ts`. `Panel.ts`, `ReactPanelBridge.ts`, `NewsPanel.ts` intentionally kept (load-bearing for CustomWidget/MCP/Status/CANONICAL_FEEDS). |

---

## Phase 0 — Install & Configure

**Packages to add:**

```
react react-dom @types/react @types/react-dom @vitejs/plugin-react
```

**`tsconfig.json` changes:**

- Add `"jsx": "react-jsx"` (enables automatic JSX transform — no `import React` needed)
- Keep all existing strict settings

**`vite.config.ts` changes:**

- Import and add `react()` from `@vitejs/plugin-react` as the first plugin
- Change entry from `src/main.ts` → `src/main.tsx`
- Existing chunking, PWA, HTML plugins stay unchanged

---

## Phase 1 — React Infrastructure

### A. App entry point

`src/main.tsx` (rename from `main.ts`):

- Keep all existing pre-init logic (Sentry queue, deferred stylesheet activation, Web Vitals)
- Replace `new App('app').init()` with `ReactDOM.createRoot(document.getElementById('app')).render(<AppRoot />)`

### B. AppContext → React Context

Create `src/context/AppContext.tsx`:

- Define `AppContextState` matching the existing `AppContext` interface shape
- **Reactive pieces** (trigger re-renders) become `useState` / `useReducer`:
  - Data caches: `allNews`, `latestMarkets`, `latestPredictions`, `latestTechEvents`, `latestClusters`, `cyberThreatsCache`, `intelligenceCache`
  - UI state: `currentTimeRange`, `mapLayers`, `resolvedLocation`, `isIdle`, `initialLoadComplete`
- **Imperative refs** (no re-render needed) kept as `useRef`:
  - Controller instances: `signalModal`, `authModal`, `unifiedSettings`, `correlationEngine`, `map`
  - Runtime sets: `inFlight`, `seenGeoAlerts`, `disabledSources`
  - Panel registry: `panels`, `newsPanels`
- Export `useAppContext()` hook and `AppContextProvider` component
- Export typed `dispatch` for data updates

### C. Core panel hooks

`src/hooks/usePanelResize.ts` — extracted from `Panel.ts` lines covering drag-resize:

- Vertical (row span 1–4) and horizontal (col span 1–3) drag handlers
- Touch support
- Persists to localStorage with existing keys

`src/hooks/usePanelState.ts`:

- Manages `loading | error | locked | content` states
- Provides `showLoading()`, `showError(msg, onRetry, autoRetrySecs)`, `showLocked(features)` equivalents as state setters
- Returns `dataBadge` state (live/cached/unavailable)

`src/hooks/useAbortSignal.ts`:

- Creates an `AbortController`, returns its `signal`
- Aborts on component unmount (`useEffect` cleanup)

`src/hooks/usePanelData.ts` — the universal panel data hook:

```ts
usePanelData<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>, opts?: {
  hydrationKey?: string;   // bootstrap cache key
  ttlMs?: number;          // refresh interval
  premium?: boolean;
}): { data: T | null; loading: boolean; error: string | null; refetch: () => void }
```

- Tries `getHydratedData(hydrationKey)` first (one-shot bootstrap cache)
- Falls back to `fetcher(signal)`
- Integrates with `RefreshScheduler` via the provided `ttlMs`
- Abort on unmount via `useAbortSignal`

### D. PanelShell component

`src/react-components/PanelShell.tsx` — replaces the Panel base class DOM scaffold:

```tsx
<PanelShell
  id="my-panel"
  title="My Panel"
  loading={loading}
  error={error}
  onRetry={refetch}
  locked={locked}
  lockedFeatures={features}
  count={count}
  dataBadge={dataBadge}
  rowSpan={rowSpan}
  colSpan={colSpan}
  collapsible
  closable
  infoTooltip="..."
  premium
>
  {children}
</PanelShell>
```

- Renders header (title, count badge, freshness badge, info tooltip, collapse/close buttons)
- Renders severity dot, new-items badge
- Conditionally renders loading radar, error state with countdown, or locked CTA
- Applies `usePanelResize` internally
- Fires `wm:panel-close` custom event on close button (same as current class)
- Applies `data-panel-id` attribute for layout manager

---

## Phase 2 — Panel Migration (all 179 panels)

**Conversion pattern** (same for every panel):

```tsx
// BEFORE — class-based (src/components/WeatherPanel.ts)
export class WeatherPanel extends Panel {
  constructor() { super({ id: 'weather', title: 'Weather', ... }); }
  async fetchData() {
    const data = await fetchWeather({ signal: this.signal });
    this.setContent(renderWeatherHtml(data));
  }
}

// AFTER — React function component (src/components/WeatherPanel.tsx)
export function WeatherPanel() {
  const { data, loading, error, refetch } = usePanelData('weather', fetchWeather, {
    hydrationKey: 'weather',
    ttlMs: 5 * 60 * 1000,
  });
  return (
    <PanelShell id="weather" title="Weather" loading={loading} error={error} onRetry={refetch}>
      {data && <WeatherContent data={data} />}
    </PanelShell>
  );
}
```

**Key sub-patterns:**

- **HTML template strings** (`renderXxxHtml()`) → extracted as child components or kept as `dangerouslySetInnerHTML` temporarily (safe because they already pass through `DOMPurify` in the original)
- **Event delegation on `this.content`** → React `onClick`/`onMouseEnter` on the relevant JSX elements
- **`this.signal`** → `useAbortSignal()` hook
- **Related-asset handlers wired by App** → passed as props or consumed via `useAppContext()`
- **`setCount(n)` / `setSeverity(level)` / `setNewBadge(n)`** → local `useState` inside `PanelShell`

**Migration batches (by complexity):**

1. **~60 simple panels** — single fetch, static render (e.g. `AaiiSentimentPanel`, `StablecoinPanel`) ✅
2. **~90 medium panels** — RPC clients, periodic refresh, D3 sparklines (e.g. `MacroSignalsPanel`, `EarthquakePanel`) ✅
3. **~29 complex panels** — virtual scroll, ML enrichment, multi-source (e.g. `NewsPanel`, `MonitorPanel`) 🟡 (LiveWebcamsPanel remains)

**Special case — `LiveNewsPanel`:** ✅ Converted to React (`src/react-components/panels/LiveNewsPanel.tsx`, 1384 lines). Channel data extracted to `src/services/live-news-channels.ts`. Note: 13 `eslint-disable exhaustive-deps` suppressions present due to circular `useCallback` graph — planned fix is to extract `LiveNewsController` class (see Phase 7 notes).

**Special case — `NewsPanel`:**

- `WindowedList` (custom virtual scroller) → replace with `@tanstack/react-virtual`
- ML enrichment hooks (velocity, risk score getters) → `useEffect` subscriptions from analysis worker
- Related-asset click handlers → `useAppContext()` dispatch

---

## Phase 3 — Map Integration

`src/components/MapContainer.tsx`:

```tsx
export function MapContainer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapContainerClass | null>(null);
  const { mapLayers, currentTimeRange, dispatch } = useAppContext();

  useEffect(() => {
    mapRef.current = new MapContainerClass(containerRef.current!);
    mapRef.current.init();
    return () => mapRef.current?.destroy();
  }, []);

  // Sync React state → imperative map instance
  useEffect(() => {
    mapRef.current?.setLayers(mapLayers);
  }, [mapLayers]);
  useEffect(() => {
    mapRef.current?.setTimeRange(currentTimeRange);
  }, [currentTimeRange]);

  return <div ref={containerRef} className="map-container" />;
}
```

The existing `MapContainer` class (and the `DeckGLMap`/`GlobeMap` it owns) stays unchanged.

---

## Phase 4 — App Orchestration → Hooks/Components

| Current               | React equivalent                                                                |
| --------------------- | ------------------------------------------------------------------------------- |
| `App.ts` (2000 lines) | `src/AppRoot.tsx` — renders `<AppContextProvider>` + `<Layout>`                 |
| `PanelLayoutManager`  | `src/app/PanelLayout.tsx` — renders variant panel grid                          |
| `DataLoaderManager`   | `src/hooks/useDataLoader.ts` — `useEffect` per domain, dispatches to context    |
| `RefreshScheduler`    | `src/hooks/useRefreshScheduler.ts` — `useInterval` per registered refresh entry |
| `EventHandlerManager` | Event handlers inline in map/panel components                                   |
| `App.init()` 8 phases | `useEffect` chain in `AppRoot.tsx`, same ordering preserved                     |

`src/app/PanelLayout.tsx`:

- Reads `DEFAULT_PANELS` from variant config
- Renders each panel component from a `PANEL_REGISTRY` map (`id → Component`)
- Handles `wm:panel-close` events to remove from visible list
- Persists order/visibility to localStorage (same keys as today)

---

## Phase 5 — Data Loading Migration

**Goal:** Convert `DataLoaderManager` (was 4053 lines, now **1813 lines**, `src/app/data-loader.ts`) from a pushed-data model to a pulled-data model. Panels that currently receive data via `panel.renderXxx(items)` calls become self-fetching components using `useAppContext()` + `useScheduledRefresh()`.

**Push→pull migration: ✅ Complete** — migrated panels self-fetch via `usePanelData` with `ttlMs` + `hydrationKey`; the corresponding push calls have been removed for all migrated panels.

**data-loader.ts decomposition (complete for 3 domains):** Domain loaders extracted to own the logic for their domain:

- `news-loader.ts` (1165 lines) — full news domain: digest/fallback pipeline, `loadNews()`, `loadNewsCategory()`, `loadIntelNews()`, time-range filtering, flash-map, rotation cycles.
- `markets-loader.ts` (1231 lines) — markets, stocks, daily brief, predictions, FRED, BIS, BLS, trade policy, supply chain, global tenders, oil analytics, forecasts, PizzInt.
- `intelligence-loader.ts` (801 lines) — `loadIntelligenceSignals()`, cyber, protests, cables, sanctions, resilience, radiation, thermal escalations, cross-source signals.

All three loaders follow the callback pattern:
- `MarketsLoaderCallbacks`: `{ runCorrelationAnalysis: () => Promise<void> }`
- `IntelligenceLoaderCallbacks`: `{ refreshCiiAndBrief: () => void; runMilitarySurgeAnalysis: (flights) => Promise<void> }`
- `NewsLoaderCallbacks`: `{ loadHappySupplementaryAndRender, loadPositiveEvents, loadKindnessData }`

`DataLoaderManager` keeps 1-line delegates for all public API of each moved domain.

**What remains in data-loader.ts (1813 lines):** CII computation, intelligence notify helpers, AIS/military/satellite, transport, happy domain, orchestration core.

**Key constraint:** `ctx.newsPanels: Record<string, NewsPanel>` and the push API (`panel.renderNews`, `panel.setDeviation`, etc.) must remain working until the last news domain panel is converted — `DataLoaderManager` still calls these for any unconverted panel.

**Files touched:**

- `src/app/data-loader.ts` — delete push calls one domain at a time
- `src/context/AppContext.tsx` — add reactive slices as domains migrate
- `src/react-components/panels/*.tsx` — panels consume context instead of receiving pushes
- `src/app/app-context.ts` — `AppContext` interface gains `dispatch` / reactive field types

---

## Phase 6 — Event Handler Migration

**Goal:** Dissolve `EventHandlerManager` (2306 lines, `src/app/event-handlers.ts`) into its call sites. **✅ Complete.**

`EventHandlerManager` is gone. `event-handlers.ts` retains only the 46-line `EventHandlerCallbacks` interface (imported by `app-actions-bridge.ts`). All logic moved to:

- **46+ hooks** in `src/hooks/` — one hook per responsibility: `useHeaderClock`, `useUrlStateSync`, `useMapLayerHandlers`, `usePanelEventBridge`, `useAuthLifecycle`, `useDeepLinks`, `useCloudPrefsSync`, `useChatAnalystBridge`, `useWidgetCreator`, `useMobileLayout`, `useViewportDataPrime`, `useRefreshIntervals`, and many more.
- **`src/AppRoot.tsx`** — renders all hooks via the `AppSetupHooks` component.
- **`src/app/panel-actions.ts`** — `enablePanelById`, `applyMapLayerChange`, `getShareUrl` as standalone functions (from dissolved EventHandlerManager).
- **`App.ts`** — reduced from ~2374 → 321 lines; `MobilePrimaryNav` instantiated directly, `debouncedUrlSync` as a closure, `publishAppActions` wired inline.

**New modules created during Phase 6:**

- `src/app/enforce-free-tier.ts`, `panel-primer.ts`, `post-lcp.ts`, `search-launcher.ts`, `panel-settings-init.ts`, `app-lifecycle.ts`, `panel-actions.ts`
- `src/hooks/useDeepLinks.ts`, `useAuthLifecycle.ts`, `useCloudPrefsSync.ts`

---

## Phase 7 — Panel Layout Migration

**Goal:** Replace `PanelLayoutManager` (was 2825 lines, now **1439 lines**, `src/app/panel-layout.ts`) with a React `PanelLayout` component that renders the panel grid declaratively.

**Actual state:** `PanelLayout.tsx` + `panel-registry.ts` exist as a coexistence bridge via portals. All React panels render through `ReactFullPanel` containers. The remaining 1439 lines are the irreducible core that cannot move until class-based panels are converted:

- `createPanels()` (~380 lines) — panel registration loop
- Deferred mount system (`deferPanelMount`, `observeDeferredPanelShell`, `mountDeferredPanel`, etc.) — ~200 lines
- `applyPanelSettings()` — driven by `deferredPanelMounts` / `ctx.panels`
- `updatePanelGating()` — applies auth gates to class-based panels only
- Public API: `addCustomWidget`, `addMcpPanel`

**Sub-managers extracted so far** (from 2825 lines):

- `checkout-lifecycle.ts` — Dodo checkout / entitlement / billing
- `panel-drag.ts` — `makeDraggable` standalone function
- `news-time-filter.ts` — time-range filter utilities
- `critical-banner.ts` — theater posture banner + sessionStorage helpers
- `panel-tab-manager.ts` — tab bar, tab state, tab lifecycle (354 lines)
- `panel-order-manager.ts` — panel ordering, zone management (276 lines)
- `add-panel-blocks.ts` — "Add Panel", Pro widget, MCP CTA DOM blocks
- `related-asset-click.ts` — related-asset click handlers for NewsPanel
- `initial-url-state.ts` — URL state application at layout init

**What's blocking Phase 7 completion:**

- **LiveWebcamsPanel** (896 lines) — the only remaining heavy class panel. Conversion is the immediate next task.
- **LiveNewsPanel `exhaustive-deps` cleanup** — 13 suppressed circular `useCallback` deps; planned fix is to extract all player methods into a `LiveNewsController` class held in `useRef`. See [memory/project_live_news_refactor.md].
- **NewsPanel** (179 lines + push API from `NewsLoader`) — still class-based; needs DataLoader push→pull for news to complete.
- **Deferred mount system** — needs IntersectionObserver moved inside each React panel component.

**Original model:** `PanelLayoutManager.createPanels()` creates instances imperatively, inserts `div[display:contents]` elements into `#panelsGrid`, and stores references in `ctx.panels`.

**Target model:** `PanelLayout.tsx` reads `panelSettings` from `useAppContext()`, renders the enabled panels from a static registry map, and lets React own the mount/unmount lifecycle.

```tsx
const PANEL_REGISTRY: Record<string, ComponentType> = {
  politics: () => import('@/react-components/panels/NewsPanelContent'),
  markets: () => import('@/react-components/panels/MarketPanel'),
  // ...
};

export function PanelLayout() {
  const { panelSettings } = useAppContext();
  const enabled = Object.entries(panelSettings)
    .filter(([, cfg]) => cfg.enabled)
    .sort(([, a], [, b]) => (b.priority ?? 0) - (a.priority ?? 0));

  return (
    <div id="panelsGrid">
      {enabled.map(([id]) => {
        const Loader = PANEL_REGISTRY[id];
        return Loader ? (
          <Suspense key={id} fallback={null}>
            <Loader />
          </Suspense>
        ) : null;
      })}
    </div>
  );
}
```

**Approach:**

1. Implement `PanelLayout.tsx` rendering all panels via the registry
2. Mount it inside `AppRoot.tsx` using `ReactDOM.createPortal` into `#panelsGrid` initially (so the existing layout manager can coexist during transition)
3. Once `PanelLayout.tsx` renders all panels correctly, remove `PanelLayoutManager.createPanels()` and delete the class

**Special cases that need handling:**

- News category panels (N instances of `NewsPanel` with different ids) — pass `panelId` as a prop from registry
- `CustomWidgetPanel` / `McpDataPanel` — runtime specs, keep separate dynamic-render path
- `AviationCommandBar` side-effect — wire into `AirlineIntelPanel` lifecycle
- Deferred panel mounts (`observeNearViewport`) — replace with `IntersectionObserver` inside each panel

**Files touched:**

- `src/app/PanelLayout.tsx` (new)
- `src/AppRoot.tsx` — render `<PanelLayout />`
- `src/app/panel-layout.ts` — `createPanels()` stripped domain-by-domain
- `src/app/app-context.ts` — `ctx.panels` registry eventually replaced by React's own tree

---

## Phase 8 — App Entry Replacement

**Goal:** Replace `App.ts` (321 lines) with `AppRoot.tsx` as the top-level orchestrator. After Phases 5–7 have drained the content from `DataLoaderManager`, `EventHandlerManager`, and `PanelLayoutManager`, `App.ts`'s remaining job is the 8-phase init sequence.

**Migration of the 8 init phases into React:**

| App.ts phase                             | React equivalent                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| Pre-init (storage/i18n/ML worker)        | `useEffect` in `AppRoot` — runs once, sets `initPhase` state               |
| Phase 1: Layout                          | `<PanelLayout />` mounts (Phase 7 prerequisite)                            |
| Phase 2: Shared UI components            | `useEffect` in `AppRoot` — instantiates `SignalModal`, `SearchModal`, etc. |
| Phase 3: UI setup                        | `useEffect` hooks in owning components                                     |
| Phase 4: MapLayerHandlers + CountryIntel | `useMapLayerHandlers()` + `useCountryIntel()` hooks in `AppRoot`           |
| Phase 5: Event listeners + URL sync      | `useEventHandlers()` + `useUrlStateSync()` hooks (Phase 6 prerequisite)    |
| Phase 6: Data loading                    | `useDataLoader()` hook (Phase 5 prerequisite)                              |
| Phase 7: Refresh scheduling              | `useScheduledRefresh()` hooks inside each panel                            |
| Phase 8: Update checks                   | `useDesktopUpdater()` hook                                                 |

**Entry point change:**

```tsx
// src/main.tsx — replaces new App('app').init()
const root = document.getElementById('app')!;
createRoot(root).render(<AppRoot />);
```

`AppRoot.tsx` becomes the single orchestrator — `App.ts` is deleted.

**Prerequisite:** All of Phases 5–7 must be complete before this phase, since `App.ts` currently delegates to the managers that are being retired.

**Files touched:**

- `src/main.tsx` — switch to `createRoot().render(<AppRoot />)`
- `src/AppRoot.tsx` — absorbs all 8 init phases as hooks
- `src/App.ts` — deleted
- `src/react-mount.tsx` — deleted (superseded by `main.tsx` using `createRoot` directly)
- `src/services/app-context-bridge.ts` — deleted (no longer needed once App.ts is gone)

---

## Cleanup

- ~~**Delete `src/react-components/PanelShell.tsx`**~~ ✅ Done — dead duplicate, nothing imported it
- ~~**Delete `src/components/ChatAnalystPanel.ts`**~~ ✅ Done — superseded by React version, no importers
- ~~**Delete 13 simple class panel files**~~ ✅ Done — `MonitorPanel.ts`, `MarketPanel.ts`, `AirlineIntelPanel.ts`, `StrategicPosturePanel.ts`, `StrategicRiskPanel.ts`, `PredictionPanel.ts`, `InternetDisruptionsPanel.ts`, `TechReadinessPanel.ts`, `ChinaActivityNowcastPanel.ts`, `EnergyDisruptionsPanel.ts`, `PipelineStatusPanel.ts`, `StorageFacilityMapPanel.ts`, `FuelShortagePanel.ts`
- ~~**Delete `src/components/LiveNewsPanel.ts`**~~ ✅ Done — converted to React
- ~~**Delete `src/components/Panel.ts` base class**~~ — intentionally kept; base class for `CustomWidgetPanel`, `McpDataPanel`, `StatusPanel`, `NewsPanel`; `instanceof Panel` check in `updatePanelGating()` still needed
- ~~**Delete `src/components/ReactPanelBridge.ts`**~~ — intentionally kept; `ReactFullPanel` is the mount mechanism for all PANEL_REGISTRY entries in `panel-layout.ts`
- ~~**Consolidate `src/react-components/panels/` → `src/components/panels/`**~~ ✅ Done — 110 files moved; all import paths updated across src/ and tests/
- ~~**Extract `computeEventRisk` shared utility**~~ ✅ Done — `src/app/news-panel-utils.ts`; duplicated static method in `panel-layout.ts` and `NewsPanelById.tsx` removed
- ~~**Delete `LATE_REGISTERED_PANEL_KEYS`**~~ ✅ Done — was `new Set([])`, entirely dead code
- ~~**Derive `REGISTRY_NEWS_PANEL_IDS` from PANEL_REGISTRY**~~ ✅ Done — auto-syncs when registry changes

---

## Files Changed / Created

**New files:**

- `src/main.tsx`
- `src/AppRoot.tsx`
- `src/context/AppContext.tsx`
- `src/hooks/usePanelResize.ts`, `usePanelState.ts`, `useAbortSignal.ts`, `usePanelData.ts`
- `src/react-components/PanelShell.tsx`
- `src/app/PanelLayout.tsx`
- `src/components/MapContainer.tsx` (React wrapper)
- `src/react-components/panels/*.tsx` — one per migrated panel
- `src/app/markets-loader.ts`, `intelligence-loader.ts`, `news-loader.ts` — domain loader classes
- `src/services/monitors-store.ts` — pub/sub bridge for MonitorPanel cloud sync
- `src/services/live-news-channels.ts` — channel data extracted from LiveNewsPanel class

**Modified files:**

- `tsconfig.json` — add `jsx`
- `vite.config.ts` — add `react()` plugin, update entry
- `src/app/data-loader.ts` — reduced 4053 → 1813 lines; delegates to domain loaders
- `src/app/panel-layout.ts` — reduced 2825 → 1439 lines; 9 sub-managers extracted
- `src/App.ts` — reduced 2374 → 321 lines; EventHandlerManager dissolved
- `src/hooks/useRefreshIntervals.ts` — removed broken entries for React-converted panels
- `src/app/panel-primer.ts` — removed broken `.fetchData()` primers for React panels
- `src/hooks/useMapLayerHandlers.ts` — removed dead `updateLivePositions()` call
- `src/hooks/useCloudPrefsSync.ts` — replaced `MonitorPanel.setMonitors()` with `setMonitorItems()`

**Unchanged (no React dependency):**

- All of `api/`, `server/`, `scripts/`, `convex/`, `proto/`
- All of `src/services/` — services are pure TS, consumed via hooks
- Existing CSS in `src/styles/` — no changes needed
- `src/workers/` — web workers stay as-is
- `src/components/DeckGLMap.ts`, `GlobeMap.ts`, `MapContainer.ts` (class)

---

## Verification

```bash
npm run typecheck          # Zero TS errors after each phase
npm run dev                # App loads, all panels render data
npm run test:data          # Unit/integration suite passes
npm run test:sidecar       # API handler tests pass
npm run test:e2e:full      # Playwright golden screenshots match
```
