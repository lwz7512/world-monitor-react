import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NewsPanelContent, NewsPanelStore } from '@/components/panels/NewsPanelContent';
import type { NewsItem, ClusteredEvent, DeviationLevel, RelatedAsset } from '@/types';
import type { SourceCoverage } from './news/source-coverage';
import { t } from '@/services/i18n';
import { registerNewsStore, unregisterNewsStore } from '@/services/news-panel-registry';

export class NewsPanel {
  private readonly store: NewsPanelStore;
  private readonly el: HTMLDivElement;
  private readonly root: Root;
  private _viewportObserverRegistered = false;
  private _viewportObserver: IntersectionObserver | null = null;

  constructor(id: string, title: string, infoTooltip?: string) {
    this.store = new NewsPanelStore(id, title, infoTooltip);
    this.el = document.createElement('div');
    this.el.style.display = 'contents';
    this.root = createRoot(this.el);
    this.root.render(createElement(NewsPanelContent, { store: this.store }));
    registerNewsStore(id, this.store);
  }

  // Panel duck-typed interface — called by PanelLayoutManager
  getElement(): HTMLDivElement { return this.el; }
  notifyConnected(): void {}
  toggle(visible: boolean): void { this.el.style.display = visible ? 'contents' : 'none'; }
  unlockPanel(): void {}
  showLocked(_features?: string[]): void {}
  showGatedCta(_reason: unknown, _onAction?: unknown): void {}
  setCount(_n: number | null): void {}

  showLoading(_message?: string): void {
    this.store.loading = true;
    this.store.flatItems = null;
    this.store.clusters = null;
    this.store.mode = 'idle';
    this.store.errorMessage = null;
    this.store.dataBadge = null;
    this.store.notify();
  }

  observeNearViewport(callback: () => void, marginPx = 200): void {
    if (this._viewportObserverRegistered) return;
    this._viewportObserverRegistered = true;
    setTimeout(() => {
      const target = (this.el.firstElementChild as HTMLElement | null) ?? this.el;
      if (typeof IntersectionObserver === 'undefined' || !target.isConnected) {
        callback();
        return;
      }
      this._viewportObserver = new IntersectionObserver(
        entries => {
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

  // ── NewsPanel public API ──────────────────────────────────────────────────

  renderNews(items: NewsItem[]): void {
    this.store.loading = false;
    if (items.length === 0) {
      this.store.mode = 'error';
      this.store.errorMessage = t('common.noNewsAvailable') ?? null;
      this.store.errorOnRetry = null;
      this.store.errorAutoRetrySeconds = undefined;
      this.store.flatItems = null;
      this.store.clusters = null;
      this.store.dataBadge = 'unavailable';
      this.store.notify();
      return;
    }
    this.store.flatItems = items;
    this.store.clusters = null;
    this.store.mode = 'flat';
    this.store.dataBadge = this.store.refreshDegraded ? 'cached' : 'live';
    this.store.dataBadgeCoverageText = this.store.coverageString('sourceCoverage');
    this.store.dataBadgeCoverageHint = this.store.coverageString('sourceCoverageHint');
    this.store.notify();
  }

  renderFilteredEmpty(message: string): void {
    this.store.loading = false;
    this.store.flatItems = null;
    this.store.clusters = null;
    this.store.mode = 'filteredEmpty';
    this.store.filteredEmptyMessage = message;
    this.store.dataBadge = this.store.refreshDegraded ? 'cached' : 'live';
    this.store.dataBadgeCoverageText = this.store.coverageString('sourceCoverage');
    this.store.dataBadgeCoverageHint = this.store.coverageString('sourceCoverageHint');
    this.store.notify();
  }

  showError(message?: string, onRetry?: () => void, autoRetrySeconds?: number): void {
    this.store.loading = false;
    this.store.mode = 'error';
    this.store.errorMessage = message ?? null;
    this.store.errorOnRetry = onRetry ?? null;
    this.store.errorAutoRetrySeconds = autoRetrySeconds;
    this.store.flatItems = null;
    this.store.clusters = null;
    this.store.dataBadge = 'unavailable';
    this.store.notify();
  }

  setDeviation(zScore: number, percentChange: number, level: DeviationLevel): void {
    this.store.deviation = level === 'normal' ? null : { zScore, percentChange, level };
    this.store.notify();
  }

  setSourceCoverage(coverage: SourceCoverage | null): void {
    this.store.sourceCoverage = coverage;
    if (this.store.dataBadge === 'live' || this.store.dataBadge === 'cached') {
      this.store.dataBadgeCoverageText = this.store.coverageString('sourceCoverage');
      this.store.dataBadgeCoverageHint = this.store.coverageString('sourceCoverageHint');
      this.store.notify();
    }
  }

  setRefreshDegraded(degraded: boolean): void {
    this.store.refreshDegraded = degraded;
    if (this.store.dataBadge === 'live' || this.store.dataBadge === 'cached') {
      this.store.dataBadge = degraded ? 'cached' : 'live';
      this.store.notify();
    }
  }

  setRiskScoreGetter(fn: (cluster: ClusteredEvent) => number | null): void {
    this.store.riskScoreGetter = fn;
  }

  setRelatedAssetHandlers(options: {
    onRelatedAssetClick?: (asset: RelatedAsset) => void;
    onRelatedAssetsFocus?: (assets: RelatedAsset[], originLabel: string) => void;
    onRelatedAssetsClear?: () => void;
  }): void {
    this.store.onRelatedAssetClick = options.onRelatedAssetClick;
    this.store.onRelatedAssetsFocus = options.onRelatedAssetsFocus;
    this.store.onRelatedAssetsClear = options.onRelatedAssetsClear;
  }

  hasNewsItem(link: string): boolean {
    if (this.store.clusters) {
      return this.store.clusters.some(
        c => c.primaryLink === link || c.allItems.some(i => i.link === link),
      );
    }
    if (this.store.flatItems) {
      return this.store.flatItems.some(i => i.link === link);
    }
    return false;
  }

  scrollToNewsItem(link: string): void {
    const el = this.store.contentEl;
    if (!el) return;
    const target =
      el.querySelector(`[data-news-id="${CSS.escape(link)}"]`) ??
      el.querySelector(`a[href="${CSS.escape(link)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('search-highlight');
    void (target as HTMLElement).offsetWidth;
    target.classList.add('search-highlight');
    setTimeout(() => target.classList.remove('search-highlight'), 3100);
  }

  destroy(): void {
    unregisterNewsStore(this.store.panelId);
    this._viewportObserver?.disconnect();
    this._viewportObserver = null;
    this.root.unmount();
  }
}
