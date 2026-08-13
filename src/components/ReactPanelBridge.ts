import { Panel } from './Panel';

/**
 * Full-React mounting class for panels that own their entire chrome via PanelShell.
 * Unlike ReactPanelBridge (Panel owns chrome, React owns content), this class creates
 * a display:contents container and stores the panelId so PanelLayout.tsx can portal
 * the React component into it — keeping PanelLayoutManager's ordering/deferred-mount
 * system intact while centralising React rendering in a single React tree.
 *
 * Implements the subset of Panel's interface that PanelLayoutManager calls so it can
 * be returned from a lazyPanel factory without touching panel-layout.ts types.
 */
export class ReactFullPanel {
  private readonly el: HTMLDivElement;
  private _viewportObserverRegistered = false;
  private _viewportObserver: IntersectionObserver | null = null;

  constructor() {
    this.el = document.createElement('div');
    // Transparent to CSS grid layout: the inner div.panel from PanelShell
    // becomes a direct grid participant without a visible wrapper box.
    this.el.style.display = 'contents';
    // Rendering is handled by PanelLayout.tsx via createPortal(component, el).
  }

  getElement(): HTMLDivElement { return this.el; }

  notifyConnected(): void {}

  toggle(visible: boolean): void {
    this.el.style.display = visible ? 'contents' : 'none';
  }

  observeNearViewport(callback: () => void, marginPx = 200): void {
    if (this._viewportObserverRegistered) return;
    this._viewportObserverRegistered = true;
    // Self-fetching React panels don't rely on viewport-triggered hydration, but
    // the callback still triggers the shared hydration scheduler for other panels.
    // Defer past React's initial render so firstElementChild is available.
    setTimeout(() => {
      const target = (this.el.firstElementChild as HTMLElement | null) ?? this.el;
      if (typeof IntersectionObserver === 'undefined' || !target.isConnected) {
        callback();
        return;
      }
      this._viewportObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some(e => e.isIntersecting)) {
            this._viewportObserver?.disconnect();
            callback();
          }
        },
        { rootMargin: `${marginPx}px` },
      );
      this._viewportObserver.observe(target);
    }, 0);
  }

  // No-ops: panel-layout calls these on every panel in ctx.panels via updatePanelGating().
  // React full panels manage their own state; imperative gating calls are silently ignored.
  unlockPanel(): void {}
  showLocked(_features?: string[]): void {}
  showGatedCta(_reason: unknown, _onAction?: unknown): void {}
  showError(_msg?: string, _onRetry?: () => void, _autoRetrySeconds?: number): void {}
  setCount(_n: number | null): void {}

  destroy(): void {
    this._viewportObserver?.disconnect();
    this._viewportObserver = null;
    // The React portal is managed by PanelLayout.tsx. It unmounts automatically
    // when ctx.panels[panelId] is removed (PanelLayout.tsx stops rendering the portal).
    this.el.remove();
  }
}

/**
 * Factory for full-React panels that own their chrome via <PanelShell>.
 *
 * Creates a hollow ReactFullPanel container for PanelLayoutManager to insert into
 * #panelsGrid (preserving ordering and deferred-mount). The React component is
 * rendered by PanelLayout.tsx via createPortal, not here.
 *
 * The `importer` and `exportName` parameters are kept for call-site compatibility
 * but are unused — the component lookup now lives in src/app/panel-registry.ts.
 */
export function createFullReactPanelLoader(
  _importer: () => Promise<Record<string, unknown>>,
  _panelId: string,
): () => Promise<Panel | null> {
  return async () =>
    // Cast is safe: PanelLayoutManager only calls getElement/toggle/notifyConnected/
    // observeNearViewport/destroy — all implemented by ReactFullPanel.
    new ReactFullPanel() as unknown as Panel;
}
