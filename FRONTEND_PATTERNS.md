# Frontend Architecture, Design Patterns & Best Practices

> This document covers the React-based frontend of World Monitor after the full migration
> (Phases 0–8 + cleanup). Source of truth for new feature work and onboarding.

---

## 1. Architecture Overview

World Monitor's frontend is a **TypeScript SPA built with Vite + Preact-compatible React** (`react-jsx` transform). It renders a grid of 110+ specialized intelligence panels alongside a dual WebGL map. The architecture deliberately avoids a framework-owned router or global state library — React is the rendering engine and lifecycle owner, while imperative managers handle DOM-heavy concerns that do not fit the React model.

```
src/main.tsx
  └─ createRoot(<AppRoot />)
       ├─ createAppManagers('app')       src/app/create-app-managers.ts
       │    └─ AppManagers {
       │         state: AppContext       src/app/app-context.ts
       │         panelLayout             src/app/panel-layout.ts
       │         dataLoader              src/app/data-loader.ts
       │         countryIntel, markets-
       │         Loader, newsLoader, … }
       ├─ initApp(managers)              src/app/app-lifecycle.ts
       ├─ destroyApp(managers)           src/app/app-lifecycle.ts
       └─ <AppContextProvider>           src/context/AppContext.tsx
            ├─ <AppSetupHooks />         43 focused event-setup hooks
            ├─ <PanelLayout />           React portal bridge
            └─ <MissionPresetControl />
```

### Layer map

```
src/types/          zero internal imports — pure type definitions
src/config/         variant, panel catalogue, layer definitions
src/services/       domain business logic, stores, API clients
src/components/     map classes, PanelShell, class panels, React panels
  └─ panels/        110 React function components (one per panel)
src/app/            orchestration: managers, loaders, registry, lifecycle
src/hooks/          43 event-setup hooks consumed by AppSetupHooks
src/context/        React context providing AppContext to the tree
src/AppRoot.tsx     sole top-level orchestrator
```

Dependency direction (enforced by `npm run lint:boundaries`):

```
types → config → services → components → app → AppRoot.tsx
```

No layer may import from a layer to its right. Violations fail CI.

---

## 2. Design Patterns

### 2.1 Registry Pattern — `PANEL_REGISTRY`

All React panels are registered in a central map (`src/app/panel-registry.ts`):

```ts
const PANEL_REGISTRY: Record<string, { load: () => Promise<unknown>; name: string }> = {
  'cii':    { load: () => import('@/components/panels/CIIPanel'),    name: 'CIIPanel' },
  'markets':{ load: () => import('@/components/panels/MarketPanel'), name: 'MarketPanel' },
  // 134 more entries …
};
```

`PanelLayoutManager.createPanels()` iterates the registry and calls `this.lazyPanel(id, async () => new ReactFullPanel())` for every key — one universal loop instead of 136 individual registrations. Adding a new panel requires exactly two files: the component and one registry entry.

**Why it matters:** the registry is the authoritative list of panel IDs. `REGISTRY_NEWS_PANEL_IDS` is derived from it (`Object.keys(PANEL_REGISTRY).filter(id => id in CANONICAL_FEEDS)`) so the data layer stays in sync automatically when panels are added or removed.

---

### 2.2 Portal Bridge Pattern — `ReactFullPanel` + `PanelLayout.tsx`

The panel grid is owned by `PanelLayoutManager` (imperative DOM manager). React panels live inside it via portals:

```
PanelLayoutManager
  → lazyPanel('cii', () => new ReactFullPanel())
      → inserts <div data-panel-id="cii" style="display:contents"> into #panelsGrid

PanelLayout.tsx
  → for each ReactFullPanel in ctx.panels:
      createPortal(<CIIPanel />, containerDiv)
```

This lets the legacy layout manager handle panel ordering, resizing, deferred mounting, and ultrawide zone management while React owns the component lifecycle inside each container. The two systems never fight over the DOM because `display:contents` makes the container invisible to the layout engine.

---

### 2.3 Controller-Class Pattern (imperative lifecycle isolation)

Panels with irreducibly imperative lifecycle (YouTube IFrame API, HLS.js, IntersectionObserver chains, drag-reorder, idle timers) use a **sibling controller class** instead of hooks with suppressed `exhaustive-deps`:

```
src/components/panels/
  LiveNewsPanel.tsx          160 lines — React shell, JSX, state bridge only
  LiveNewsController.ts    1 419 lines — all player logic as class methods

  LiveWebcamsPanel.tsx       168 lines — React shell
  LiveWebcamsController.ts 1 022 lines — iframe/observer/idle logic
```

**Pattern:**

```tsx
// 1. State-bridge interface — controller drives React state without using hooks
interface LiveNewsControllerState {
  setIsPlaying: (v: boolean) => void;
  setChannels:  (v: LiveChannel[]) => void;
  getContentEl: () => HTMLElement | null;
  // …
}

// 2. Component holds controller in useRef, lazy-initializes in render body
export function LiveNewsPanel() {
  const [isPlaying, setIsPlaying] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<LiveNewsController | null>(null);

  if (!ctrlRef.current) {
    ctrlRef.current = new LiveNewsController({
      setIsPlaying,
      getContentEl: () => contentRef.current,
      // …
    });
  }

  // 3. Single empty-dep effect — mount once, destroy on unmount
  useEffect(() => {
    ctrlRef.current!.mount();
    return () => ctrlRef.current!.destroy();
  }, []);
}
```

**Why this beats `useCallback` chains:** class methods call `this.*` freely — no dependency arrays, no stale-closure bugs, no `eslint-disable` suppressions. The component stays thin and testable; the controller stays pure imperative TypeScript.

---

### 2.4 Pub/Sub Store Pattern — `news-panel-registry`

Static React news panels and class-based `NewsPanel` instances (for CANONICAL_FEEDS dynamic categories) share a single data path through a registry of stores:

```
news-loader.ts
  → getNewsStore('politics')   ←  src/services/news-panel-registry.ts
      → NewsPanelStore instance
           ↑ registered by NewsPanelById.tsx on mount
           ↑ registered by NewsPanel.ts constructor (class path)
```

`NewsPanelStore` exposes the same API (`renderNews()`, `setDeviation()`, `showError()`, …) regardless of whether the consumer is a React component or a class instance. The data loader calls `getNewsStore(category)` and never touches the DOM directly.

**Why it matters:** it decouples data loading from rendering implementation. Adding a React replacement for a class panel requires only registering the store — the loader calls the same method.

---

### 2.5 Manager / Facade Pattern — `AppManagers`

All orchestration objects are created once in `createAppManagers()` and passed as a typed bundle:

```ts
export interface AppManagers {
  state:             AppContext;        // mutable central state
  panelLayout:       PanelLayoutManager;
  dataLoader:        DataLoaderManager;
  countryIntel:      CountryIntelManager;
  refreshScheduler:  RefreshScheduler;
  mobilePrimaryNav:  MobilePrimaryNav;
  searchLauncher:    SearchLauncher;
  modules:           { destroy(): void }[];
  syncUrlState:      () => void;
  handleWmSessionDegraded: () => void;
}
```

`AppRoot.tsx` holds this bundle in a `useRef` (created once, never recreated on re-render) and passes it to `initApp()` / `destroyApp()`. No manager is a singleton — the bundle is the unit of construction and teardown, which makes the lifecycle explicit and testable.

---

### 2.6 Self-Fetching Panel Pattern — `usePanelData`

Every React panel owns its data fetching. The universal hook handles bootstrap hydration, fetching, refresh scheduling, and abort-on-unmount:

```ts
const { data, loading, error, dataBadge, refetch } = usePanelData(
  (signal) => getCiiScores({ signal }),
  { hydrationKey: 'cii-scores', ttlMs: 5 * 60_000 },
);
```

Execution order:
1. Check `getHydratedData(hydrationKey)` — one-shot bootstrap cache, zero network cost
2. If miss, call `fetcher(signal)` and set `dataBadge = 'live'`
3. Auto-refresh every `ttlMs` ms
4. Abort in-flight request on unmount via `useAbortSignal()`

This replaced a push-based model where `DataLoaderManager` called `panel.renderXxx(data)` on every panel. Panels now pull their own data, making each panel independently restartable and independently testable.

---

### 2.7 Scaffold Component Pattern — `PanelShell`

`PanelShell` (`src/components/PanelShell.tsx`) is the single source of truth for panel chrome — header, count badge, freshness badge, info tooltip, collapse/close buttons, loading radar, error state with countdown, locked CTA, and drag-resize handles. Every React panel renders it:

```tsx
export function CIIPanel() {
  const { data, loading, error, refetch } = usePanelData(fetchCii, { hydrationKey: 'cii' });
  return (
    <PanelShell id="cii" title="Country Instability Index"
      loading={loading} error={error} onRetry={refetch}
      defaultRowSpan={2} collapsible closable premium infoTooltip={t('...')}>
      {data && <CIIContent scores={data} />}
    </PanelShell>
  );
}
```

`PanelShell` internally calls `usePanelResize` (drag-resize with touch support, persisted to localStorage) and `dataFreshness.getPanelFreshness(id)` (live freshness display, refreshed every 60 s).

---

### 2.8 Hook Composition Pattern — `AppSetupHooks`

`EventHandlerManager` (2 306 lines, single class) was dissolved into 43 focused hooks, each owning one concern, composed in a single component:

```tsx
function AppSetupHooks() {
  useHeaderClock();        // clock display in the header
  useMapControls();        // map zoom/pan keyboard shortcuts
  useMapLayerHandlers();   // layer toggle checkboxes → ctx.map.setLayers()
  useUrlStateSync();       // bidirectional map state ↔ URL
  useAuthLifecycle();      // Clerk session events
  useRefreshIntervals();   // variant-specific poll loops
  // … 37 more
  return null;
}
```

Each hook wires its listeners in a `useEffect` and tears them down in the cleanup function. Hooks have no shared mutable state between them — they all read from `AppContext` via `useAppContext()`.

**Why single-concern hooks beat one big class:** each hook is independently readable, independently testable, and independently removable. Adding a new event handler means adding a new hook and one line in `AppSetupHooks` — no risk of breaking unrelated handlers.

---

### 2.9 Two-Tier Bootstrap Hydration

The app fetches `/api/bootstrap` in two concurrent tiers before any panel renders:

```
Fast tier (3 s timeout) — high-priority keys served from Redis in-memory cache
Slow tier (5 s timeout) — lower-priority keys, may hit upstream
```

Both tiers run concurrently via `Promise.allSettled`. Data lands in a one-shot map; `getHydratedData(key)` consumes it exactly once (first call returns data, subsequent calls return null). `usePanelData` uses this as its initial-state seed, so panels that have bootstrap data skip the first fetch entirely and render immediately.

---

### 2.10 Deferred / Viewport-Gated Panel Loading

`PanelLayoutManager` defers below-fold panels to avoid blocking the LCP path:

1. Above-fold panels (first N by variant order) mount immediately
2. All others get a `DeferredPanelShell` placeholder that reserves grid space with the correct row/col span from `DEFERRED_PANEL_NATURAL_FOOTPRINTS`
3. An `IntersectionObserver` fires `loadAllData()` when a panel scrolls within 200px of the viewport

The map chunk (`@/components/MapContainer`) is fetched at the top of `createPanels()` but `await`ed only after all `lazyPanel()` registrations complete — so the chunk download overlaps panel registration instead of serializing behind it (U3 #4459).

---

## 3. Best Practices

### Component design

**Keep components thin.** React panels contain JSX, local `useState`, and `usePanelData` calls. Business logic, DOM manipulation, and external API wiring belong in services, stores, or controller classes — not in the component body. A 150-line panel is a good target; a 400-line panel is a signal to extract.

**Use `PanelShell` for every panel.** Never reimplement the header, loading state, error state, or resize handles. `PanelShell` handles all of it and keeps the UX consistent. Pass `headerActions` for extra toolbar items.

**Never suppress `exhaustive-deps`.** If a `useCallback` or `useEffect` dependency graph is too tangled to express cleanly, reach for the controller-class pattern instead. Suppression silently breaks stale-closure invariants and makes hooks impossible to reason about statically.

**Lazy-initialize expensive objects in the render body, not in `useEffect`.** `useRef` combined with a null-check guard in the render body ensures the object is created synchronously on first render, not asynchronously after paint. `LiveNewsPanel` and `LiveWebcamsPanel` both follow this pattern for their controllers.

---

### Data fetching

**Always pass `signal` to fetch calls.** `usePanelData` provides an `AbortSignal` that aborts on unmount. Fetchers that ignore it leak requests and can cause state updates on unmounted components.

**Use `hydrationKey` when the data is in the bootstrap cache.** Prevents a redundant network round-trip on first paint for every above-fold panel.

**Keep the data shape flat and serializable at the service layer.** Services return plain objects or arrays. Components do not receive class instances. This makes stores easy to snapshot and panels easy to test with mock data.

**Stores are the bridge between loaders and panels.** Domain loaders (`news-loader.ts`, `markets-loader.ts`, `intelligence-loader.ts`) write to stores (`news-panel-registry`, `monitors-store`, `cii-store`, …). Panels read from the same stores via `useEffect` subscriptions or `usePanelData`. Loaders never touch the DOM.

---

### State management

**`AppContext` is mutable; React context is just the access mechanism.** Do not treat `AppContext` as a reactive store — it does not trigger re-renders when mutated. It is a shared mutable object for non-reactive orchestration state (map refs, panel instances, in-flight tracking). For data that should drive re-renders, use component-local `useState` or a domain store with a subscription.

**Derive, don't duplicate.** `REGISTRY_NEWS_PANEL_IDS` is derived from `Object.keys(PANEL_REGISTRY).filter(id => id in CANONICAL_FEEDS)`. Any time a constant can be computed from another authoritative source, derive it — hardcoded copies drift silently.

**One `useRef` per manager or controller, initialized lazily in the render body.** This is the React-idiomatic equivalent of a class field. Avoid initializing in `useEffect` — the `useEffect` timing means the ref is null on the first render and the component must handle that case everywhere.

---

### Architecture

**Enforce the dependency direction.** The `types → config → services → components → app → AppRoot.tsx` rule is enforced by `npm run lint:boundaries`. Never import from a higher layer. If a service needs something from `app/`, the dependency is inverted — extract an interface or move the logic down.

**Register in one place.** When adding a panel: one file in `src/components/panels/`, one entry in `src/app/panel-registry.ts`, and (if it has news data) one wrapper in `news-panel-wrappers.tsx`. Nothing else. If you find yourself updating three or more disconnected lists to add a panel, that is a signal to consolidate.

**Keep class-based panels for genuinely imperative cases only.** The four remaining class panels (`NewsPanel.ts`, `CustomWidgetPanel.ts`, `McpDataPanel.ts`, `StatusPanel.ts`) each have a specific reason: dynamic IDs that cannot be known at registry-time, or singleton infrastructure. New panels should always be React function components.

**Separate the controller from the shell.** When a panel needs imperative lifecycle (media APIs, WebSocket subscriptions, complex timers), split it into `XyzPanel.tsx` (React shell, state bridge props) and `XyzController.ts` (class with `mount()`/`destroy()`). The shell stays readable; the controller stays testable as plain TypeScript.

**Lazy-load at the chunk boundary, not the import boundary.** PANEL_REGISTRY uses `() => import('@/components/panels/XyzPanel')` — the dynamic import is the chunk boundary. Do not import panel modules at the top of `panel-registry.ts`. This keeps the entry chunk small and shifts panel code into on-demand chunks fetched only when the panel is first activated.

---

### Testing

**Test stores and loaders in isolation.** The pub/sub store pattern means you can test `news-loader.ts` by providing a mock `getNewsStore()` and asserting on the store's state without mounting any React component.

**Source-text tests for architectural constraints.** Tests like `panel-config-guardrails.test.mjs` and `panel-layout-dynamic-import-guard.test.mts` read source files as strings and assert on structural patterns (import paths, registration patterns, method boundaries). This is the right tool for enforcing conventions that TypeScript cannot express as types.

**Guard derived constants.** `tests/live-news-panel-guard.test.mts` and `tests/news-panel-key-reachability.test.mts` verify that the data-layer key resolution works correctly for every registered panel. When the registry changes, these tests catch mismatches before production.

---

## 4. File Navigation Quick Reference

| Task | Start here |
|------|-----------|
| Add a new panel | `src/components/panels/NewPanel.tsx` + `src/app/panel-registry.ts` |
| Add a new news category panel | `src/components/panels/news-panel-wrappers.tsx` + `src/app/panel-registry.ts` |
| Add a panel with complex imperative lifecycle | `XyzController.ts` + `XyzPanel.tsx` (controller-class pattern) |
| Wire a new event handler | New hook in `src/hooks/` + one line in `AppSetupHooks` in `src/AppRoot.tsx` |
| Add a new domain data store | `src/services/xyz-store.ts` (pub/sub, same shape as `news-panel-registry.ts`) |
| Change app initialization sequence | `src/app/app-lifecycle.ts` (`initApp` / `destroyApp`) |
| Change what managers are created | `src/app/create-app-managers.ts` |
| Change panel default order / variant assignment | `src/config/variants/` |
| Change panel header chrome | `src/components/PanelShell.tsx` |
| Change the data-fetching hook | `src/hooks/usePanelData.ts` |
