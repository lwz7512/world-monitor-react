# React Migration — Code Metrics Comparison

Before: commit `353e24ed7` (pre-migration baseline)
After:  commit `2aaf346c3` (React migration complete + cleanup)

---

## Total `src/` Size

| | Before | After | Delta |
|--|-------:|------:|------:|
| Lines | 228,386 | 229,846 | **+1,460** |
| Files (`.ts` / `.tsx`) | 766 | 876 | **+110** |
| Files changed in migration commit | — | 419 | — |
| Gross insertions | — | +46,383 | — |
| Gross deletions | — | −43,245 | — |

Net lines grew by only **+1,460** despite adding 110 React panel components, 43 hooks, 26 new stores, and an entire `src/hooks/` and `src/context/` layer — because the deleted class files, drained orchestrators, and removed `App.ts` offset almost all of the additions.

---

## By Directory

| Directory | Before (lines) | Before (files) | After (lines) | After (files) | Delta (lines) |
|-----------|---------------:|---------------:|--------------:|--------------:|--------------:|
| `src/components/` (root) | 78,258 | 200 | 45,304 | 81 | **−32,954** |
| `src/components/panels/` | — | 0 | 28,552 | 110 | **+28,552** |
| `src/react-components/` | — | — | — | — | *(merged into panels/)* |
| `src/services/` | 53,448 | 238 | 54,689 | 268 | +1,241 |
| `src/generated/` | 32,855 | 71 | 32,855 | 71 | 0 |
| `src/config/` | 22,984 | 58 | 22,981 | 58 | −3 |
| `src/app/` | 16,100 | 24 | 16,665 | 48 | +565 |
| `src/utils/` | 9,614 | 65 | 9,614 | 65 | 0 |
| `src/hooks/` | — | 0 | 3,636 | 43 | **+3,636** |
| `src/types/` | 1,766 | 4 | 1,803 | 4 | +37 |
| `src/workers/` | 917 | 4 | 917 | 4 | 0 |
| `src/context/` | — | 0 | 63 | 1 | +63 |

---

## Key File Changes

### Files deleted

| File | Lines removed | Replaced by |
|------|-------------:|-------------|
| `src/App.ts` | 2,766 | `create-app-managers.ts` + `app-lifecycle.ts` + `AppRoot.tsx` |
| `src/app/event-handlers.ts` | 2,321 → 46 | 43 hooks in `src/hooks/` (−2,275 lines) |
| `src/app/data-loader.ts` | 4,440 → 1,813 | domain loaders: `news-loader.ts`, `markets-loader.ts`, `intelligence-loader.ts` (−2,627 lines) |
| 108 class panel files in `src/components/` | ~54,000 est. | 110 React panels in `src/components/panels/` |

### Files created

| File | Lines | Purpose |
|------|------:|---------|
| `src/app/create-app-managers.ts` | 322 | App constructor body |
| `src/app/app-lifecycle.ts` | 358 | `initApp()` / `destroyApp()` |
| `src/AppRoot.tsx` | 115 | Top-level React orchestrator |
| `src/app/panel-registry.ts` | ~500 | PANEL_REGISTRY — 136 entries |
| `src/app/PanelLayout.tsx` | 63 | React portal bridge |
| `src/components/panels/LiveNewsController.ts` | 1,419 | YouTube/HLS player logic |
| `src/components/panels/LiveWebcamsController.ts` | 1,022 | Iframe/observer/idle logic |
| `src/components/panels/NewsPanelContent.tsx` | 767 | NewsPanelStore + React renderer |
| `src/services/news-panel-registry.ts` | ~80 | `panelId → NewsPanelStore` bridge |
| 43 hooks in `src/hooks/` | 3,636 total | Event-setup hooks (avg 85 lines each) |
| 110 React panels in `src/components/panels/` | 28,552 total | Function components (avg 260 lines each) |

---

## Component Model Shift

| Metric | Before | After |
|--------|-------:|------:|
| Class-based panel files in `src/components/` (root) | 108 | 7 *(intentional keeps)* |
| React panel components in `src/components/panels/` | 0 | 110 |
| Panels in PANEL_REGISTRY | 0 | 136 |
| Hooks in `src/hooks/` | 0 | 43 |
| Domain stores in `src/services/` | 5 | 31 |
| `eslint-disable exhaustive-deps` suppressions | 13 *(LiveNewsPanel alone)* | 0 |

### Intentionally kept class panels (7 files)

| File | Reason |
|------|--------|
| `NewsPanel.ts` | CANONICAL_FEEDS dynamic panels — panel key computed at runtime |
| `CustomWidgetPanel.ts` | Dynamic ID, user-defined spec |
| `McpDataPanel.ts` | Dynamic ID, MCP-sourced spec |
| `StatusPanel.ts` | API health singleton |
| `Panel.ts` | Base class for the above four |
| `ReactPanelBridge.ts` | `ReactFullPanel` portal mount mechanism |
| `MapContainerReact.tsx` | React wrapper for class-based `MapContainer` |

---

## Orchestration Reduction

| Module | Before | After | Reduction |
|--------|-------:|------:|----------:|
| `App.ts` | 2,766 lines | deleted | −100% |
| `event-handlers.ts` | 2,321 lines | 46 lines (interface stub) | −98% |
| `data-loader.ts` | 4,440 lines | 1,813 lines | −59% |
| `panel-layout.ts` | ~3,975 lines (est.) | 1,446 lines | −64% |
| `src/app/` total | 16,100 lines / 24 files | 16,665 lines / 48 files | +3.5% lines, +100% files |

`src/app/` grew in file count (+24) but barely moved in line count (+565) — the constructor and event-handler mass dissolved into purpose-built modules that are individually much shorter.

---

## Average Panel Size

| Panel type | Count | Total lines | Avg lines/panel |
|-----------|------:|------------:|----------------:|
| React panels (`src/components/panels/*.tsx`) | 110 | 28,552 | **260** |
| Former class panels (`src/components/*Panel.ts`) | 108 | ~54,000 est. | ~500 |

React panels average **roughly half** the line count of their class predecessors, primarily because `PanelShell` absorbs the header/loading/error/resize scaffold that each class panel implemented individually.
