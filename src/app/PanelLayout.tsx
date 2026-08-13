/**
 * PanelLayout — declarative React panel renderer (Phase 7).
 *
 * PanelLayoutManager still owns ordering, deferred-mount, and placeholder logic.
 * When it mounts a ReactFullPanel, it inserts an empty div[display:contents]
 * into #panelsGrid in the correct position and calls refreshAppContext() so this
 * component re-renders and portals the React component into that container.
 *
 * This approach preserves the existing DOM ordering system without touching the
 * 107+ lazyPanel() registrations in panel-layout.ts.
 *
 * Panels NOT handled here (still rendered by PanelLayoutManager itself):
 *   - News-category panels (class-based NewsPanel, not in PANEL_REGISTRY)
 *   - 'live-news', 'live-webcams' (class-based, not in PANEL_REGISTRY)
 *   - Custom widget / MCP panels (dynamic IDs, not in PANEL_REGISTRY)
 */

import { Suspense, lazy } from 'react';
import type { ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { useAppContextMaybe } from '@/context/AppContext';
import { PANEL_REGISTRY } from './panel-registry';

// Module-level cache: React.lazy() must be called once per component identity.
// Re-calling it on every render creates a new component type, remounting on
// every state change. This cache pins each panel ID to a stable lazy wrapper.
const lazyComponentCache = new Map<string, ComponentType>();

function getLazyComponent(panelId: string): ComponentType | null {
  const entry = PANEL_REGISTRY[panelId];
  if (!entry) return null;

  if (!lazyComponentCache.has(panelId)) {
    const Comp = lazy(() =>
      entry.load().then((m) => ({ default: m[entry.name] as ComponentType }))
    );
    lazyComponentCache.set(panelId, Comp);
  }
  return lazyComponentCache.get(panelId)!;
}

export function PanelLayout() {
  const ctx = useAppContextMaybe();
  if (!ctx) return null;

  // For each panel in ctx.panels whose ID is registered in PANEL_REGISTRY,
  // portal the lazy React component into the ReactFullPanel container element.
  // The container was inserted into #panelsGrid by PanelLayoutManager (correct
  // ordering), and React renders the component inside it transparently (display:contents).
  return Object.entries(ctx.panels).map(([panelId, panel]) => {
    const Comp = getLazyComponent(panelId);
    if (!Comp) return null; // not in registry (news / live / custom panel)

    const container = panel.getElement();
    return createPortal(
      <Suspense key={panelId} fallback={null}>
        <Comp />
      </Suspense>,
      container,
      panelId, // stable portal key prevents remount on ctx refresh
    );
  });
}
