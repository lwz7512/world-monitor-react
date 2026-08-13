import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { PanelShell } from '@/components/PanelShell';
import type { NewsItem, ClusteredEvent, DeviationLevel, RelatedAsset, RelatedAssetContext } from '@/types';
import { THREAT_PRIORITY } from '@/services/threat-classifier';
import { formatTime, getCSSColor } from '@/utils';
import { sanitizeUrl } from '@/utils/sanitize';
import { computeNewSinceVisit } from '@/utils/new-since-visit';
import {
  analysisWorker,
  enrichWithVelocityML,
  getClusterAssetContext,
  MAX_DISTANCE_KM,
  activityTracker,
  generateSummary,
  translateText,
  preloadRelatedAssetTables,
} from '@/services';
import { SITE_VARIANT } from '@/config';
import { t, getCurrentLanguage } from '@/services/i18n';
import { track } from '@/services/analytics';
import {
  renderPrimarySourceProvenance,
  renderCorroboratingSourceRisk,
} from '@/components/news/source-provenance';
import {
  coverageBadgeString,
  type SourceCoverage,
} from '@/components/news/source-coverage';
import type { DataBadgeState } from '@/hooks/usePanelState';
import type { PanelSeverity } from '@/components/Panel';

const SUMMARY_CACHE_TTL = 10 * 60 * 1000;

// ── Store ─────────────────────────────────────────────────────────────────────

export class NewsPanelStore {
  readonly panelId: string;
  readonly title: string;
  readonly infoTooltip: string | undefined;

  mode: 'idle' | 'flat' | 'clusters' | 'error' | 'filteredEmpty' = 'idle';
  flatItems: NewsItem[] | null = null;
  clusters: ClusteredEvent[] | null = null;
  errorMessage: string | null = null;
  errorOnRetry: (() => void) | null = null;
  errorAutoRetrySeconds: number | undefined = undefined;
  filteredEmptyMessage: string | null = null;

  loading = false;
  count = 0;
  newBadgeCount = 0;
  dataBadge: DataBadgeState = null;
  dataBadgeCoverageText: string | undefined = undefined;
  dataBadgeCoverageHint: string | undefined = undefined;

  deviation: { zScore: number; percentChange: number; level: DeviationLevel } | null = null;

  sourceCoverage: SourceCoverage | null = null;
  refreshDegraded = false;
  riskScoreGetter: ((c: ClusteredEvent) => number | null) | null = null;
  onRelatedAssetClick?: (asset: RelatedAsset) => void;
  onRelatedAssetsFocus?: (assets: RelatedAsset[], originLabel: string) => void;
  onRelatedAssetsClear?: () => void;

  contentEl: HTMLElement | null = null;

  private listeners = new Set<() => void>();

  constructor(panelId: string, title: string, infoTooltip?: string) {
    this.panelId = panelId;
    this.title = title;
    this.infoTooltip = infoTooltip;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  notify(): void { for (const fn of this.listeners) fn(); }

  coverageString(key: 'sourceCoverage' | 'sourceCoverageHint'): string | undefined {
    return coverageBadgeString(this.sourceCoverage, key, (path, vars) => t(path, vars));
  }

  // ── Imperative API (mirrored from NewsPanel.ts wrapper) ───────────────────

  showLoading(_message?: string): void {
    this.loading = true;
    this.flatItems = null;
    this.clusters = null;
    this.mode = 'idle';
    this.errorMessage = null;
    this.dataBadge = null;
    this.notify();
  }

  renderNews(items: NewsItem[]): void {
    this.loading = false;
    if (items.length === 0) {
      this.mode = 'error';
      this.errorMessage = t('common.noNewsAvailable') ?? null;
      this.errorOnRetry = null;
      this.errorAutoRetrySeconds = undefined;
      this.flatItems = null;
      this.clusters = null;
      this.dataBadge = 'unavailable';
      this.notify();
      return;
    }
    this.flatItems = items;
    this.clusters = null;
    this.mode = 'flat';
    this.dataBadge = this.refreshDegraded ? 'cached' : 'live';
    this.dataBadgeCoverageText = this.coverageString('sourceCoverage');
    this.dataBadgeCoverageHint = this.coverageString('sourceCoverageHint');
    this.notify();
  }

  renderFilteredEmpty(message: string): void {
    this.loading = false;
    this.flatItems = null;
    this.clusters = null;
    this.mode = 'filteredEmpty';
    this.filteredEmptyMessage = message;
    this.dataBadge = this.refreshDegraded ? 'cached' : 'live';
    this.dataBadgeCoverageText = this.coverageString('sourceCoverage');
    this.dataBadgeCoverageHint = this.coverageString('sourceCoverageHint');
    this.notify();
  }

  showError(message?: string, onRetry?: () => void, autoRetrySeconds?: number): void {
    this.loading = false;
    this.mode = 'error';
    this.errorMessage = message ?? null;
    this.errorOnRetry = onRetry ?? null;
    this.errorAutoRetrySeconds = autoRetrySeconds;
    this.flatItems = null;
    this.clusters = null;
    this.dataBadge = 'unavailable';
    this.notify();
  }

  setDeviation(zScore: number, percentChange: number, level: DeviationLevel): void {
    this.deviation = level === 'normal' ? null : { zScore, percentChange, level };
    this.notify();
  }

  setSourceCoverage(coverage: SourceCoverage | null): void {
    this.sourceCoverage = coverage;
    if (this.dataBadge === 'live' || this.dataBadge === 'cached') {
      this.dataBadgeCoverageText = this.coverageString('sourceCoverage');
      this.dataBadgeCoverageHint = this.coverageString('sourceCoverageHint');
      this.notify();
    }
  }

  setRefreshDegraded(degraded: boolean): void {
    this.refreshDegraded = degraded;
    if (this.dataBadge === 'live' || this.dataBadge === 'cached') {
      this.dataBadge = degraded ? 'cached' : 'live';
      this.notify();
    }
  }

  setRiskScoreGetter(fn: (cluster: ClusteredEvent) => number | null): void {
    this.riskScoreGetter = fn;
  }

  setRelatedAssetHandlers(options: {
    onRelatedAssetClick?: (asset: RelatedAsset) => void;
    onRelatedAssetsFocus?: (assets: RelatedAsset[], originLabel: string) => void;
    onRelatedAssetsClear?: () => void;
  }): void {
    this.onRelatedAssetClick = options.onRelatedAssetClick;
    this.onRelatedAssetsFocus = options.onRelatedAssetsFocus;
    this.onRelatedAssetsClear = options.onRelatedAssetsClear;
  }

  hasNewsItem(link: string): boolean {
    if (this.clusters) {
      return this.clusters.some(
        c => c.primaryLink === link || c.allItems.some(i => i.link === link),
      );
    }
    if (this.flatItems) {
      return this.flatItems.some(i => i.link === link);
    }
    return false;
  }

  scrollToNewsItem(link: string): void {
    const el = this.contentEl;
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadSortMode(panelId: string): 'relevance' | 'newest' {
  try {
    const v = localStorage.getItem(`wm_sort_${SITE_VARIANT}_${panelId}`);
    return v === 'newest' ? 'newest' : 'relevance';
  } catch { return 'relevance'; }
}

function saveSortMode(panelId: string, mode: 'relevance' | 'newest'): void {
  try { localStorage.setItem(`wm_sort_${SITE_VARIANT}_${panelId}`, mode); } catch {}
}

function headlineSignature(headlines: string[], bodies: string[]): string {
  return JSON.stringify([headlines.slice(0, 5).sort(), bodies.slice(0, 5)]);
}

function getCachedSummary(key: string, sig: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { headlineSignature?: string; summary?: string; timestamp?: number };
    if (parsed.headlineSignature !== sig) return null;
    if (Date.now() - (parsed.timestamp ?? 0) > SUMMARY_CACHE_TTL) { localStorage.removeItem(key); return null; }
    return parsed.summary ?? null;
  } catch { return null; }
}

function setCachedSummary(key: string, sig: string, summary: string): void {
  try {
    localStorage.setItem(key, JSON.stringify({ headlineSignature: sig, summary, timestamp: Date.now() }));
  } catch {}
}

function computeSeverity(clusters: ClusteredEvent[] | null): PanelSeverity {
  if (!clusters?.length) return 'none';
  for (const level of ['critical', 'high', 'medium', 'low'] as const) {
    if (clusters.some(c => c.threat?.level === level)) return level;
  }
  return 'none';
}

function getLocalizedAssetLabel(type: RelatedAsset['type']): string {
  const keyMap: Record<RelatedAsset['type'], string> = {
    pipeline: 'modals.countryBrief.infra.pipeline',
    cable: 'modals.countryBrief.infra.cable',
    datacenter: 'modals.countryBrief.infra.datacenter',
    base: 'modals.countryBrief.infra.base',
    nuclear: 'modals.countryBrief.infra.nuclear',
  };
  return t(keyMap[type]);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryBar({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="panel-summary">
      <div className="panel-summary-content">
        <span className="panel-summary-text">{text}</span>
        <button
          type="button"
          className="panel-summary-close"
          title={t('components.newsPanel.close')}
          aria-label={t('components.newsPanel.close')}
          onClick={onClose}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function DeviationIndicator({ deviation }: { deviation: NewsPanelStore['deviation'] }) {
  if (!deviation || deviation.level === 'normal') return null;
  const arrow = deviation.zScore > 0 ? '↑' : '↓';
  const sign = deviation.percentChange > 0 ? '+' : '';
  return (
    <span
      className={`deviation-indicator ${deviation.level}`}
      title={`z-score: ${deviation.zScore} (vs 7-day avg)`}
    >
      {arrow}{sign}{deviation.percentChange}%
    </span>
  );
}

interface ClusterCardProps {
  cluster: ClusteredEvent;
  isNew: boolean;
  shouldHighlight: boolean;
  showNewTag: boolean;
  riskScoreGetter: ((c: ClusteredEvent) => number | null) | null;
  translatedTitle: string | undefined;
  isTranslating: boolean;
  onTranslate: (id: string, text: string) => void;
  onRelatedAssetClick: ((asset: RelatedAsset) => void) | undefined;
  onRelatedAssetsFocus: ((assets: RelatedAsset[], originLabel: string) => void) | undefined;
  onRelatedAssetsClear: (() => void) | undefined;
  assetContext: RelatedAssetContext | null;
}

function ClusterCard({
  cluster,
  isNew,
  shouldHighlight,
  showNewTag,
  riskScoreGetter,
  translatedTitle,
  isTranslating,
  onTranslate,
  onRelatedAssetClick,
  onRelatedAssetsFocus,
  onRelatedAssetsClear,
  assetContext,
}: ClusterCardProps) {
  const { riskBadge: primaryPropBadge, tierBadge } = renderPrimarySourceProvenance(cluster.primarySource);

  const velocity = cluster.velocity;
  const velocityBadge =
    velocity && velocity.level !== 'normal' && cluster.sourceCount > 1 ? (
      <span className={`velocity-badge ${velocity.level}`}>
        {velocity.trend === 'rising' ? '↑' : ''}+{velocity.sourcesPerHour}/hr
      </span>
    ) : null;

  const sentimentIcon =
    velocity?.sentiment === 'negative' ? '⚠' : velocity?.sentiment === 'positive' ? '✓' : '';
  const sentimentBadge =
    sentimentIcon && Math.abs(velocity?.sentimentScore ?? 0) > 2 ? (
      <span className={`sentiment-badge ${velocity?.sentiment}`}>{sentimentIcon}</span>
    ) : null;

  const otherSources = cluster.topSources.filter(s => s.name !== cluster.primarySource);

  const cat = cluster.threat?.category;
  const catLabel = cat && cat !== 'general' ? cat.charAt(0).toUpperCase() + cat.slice(1) : '';
  const threatVarMap: Record<string, string> = {
    critical: '--threat-critical',
    high: '--threat-high',
    medium: '--threat-medium',
    low: '--threat-low',
    info: '--threat-info',
  };
  const catColor = cluster.threat ? getCSSColor(threatVarMap[cluster.threat.level] ?? '--text-dim') : '';

  const riskScore = riskScoreGetter
    ? riskScoreGetter(cluster)
    : (() => {
        if (!cluster.threat) return null;
        const levelScore: Record<string, number> = { critical: 95, high: 75, medium: 50, low: 25, info: 10 };
        const base = levelScore[cluster.threat.level] ?? 10;
        return Math.round(base * (cluster.threat.confidence ?? 1));
      })();

  const itemClasses = [
    'item',
    'clustered',
    cluster.isAlert ? 'alert' : '',
    shouldHighlight ? 'item-new-highlight' : '',
    isNew ? 'item-new' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const displayTitle = translatedTitle ?? cluster.primaryTitle;
  const showTranslateBtn = getCurrentLanguage() !== 'en';

  return (
    <div
      className={itemClasses}
      style={cluster.monitorColor ? { borderInlineStartColor: cluster.monitorColor } : undefined}
      data-cluster-id={cluster.id}
      data-news-id={cluster.primaryLink}
    >
      <div className="item-source">
        {tierBadge && <span dangerouslySetInnerHTML={{ __html: tierBadge }} />}
        {cluster.primarySource}
        {primaryPropBadge && <span dangerouslySetInnerHTML={{ __html: primaryPropBadge }} />}
        {cluster.lang && cluster.lang !== getCurrentLanguage() && (
          <span className="lang-badge">{cluster.lang.toUpperCase()}</span>
        )}
        {showNewTag && <span className="new-tag">{t('common.new')}</span>}
        {cluster.sourceCount > 1 && (
          <span className="source-count">
            {t('components.newsPanel.sources', { count: String(cluster.sourceCount) })}
          </span>
        )}
        {velocityBadge}
        {sentimentBadge}
        {cluster.isAlert && <span className="alert-tag">ALERT</span>}
        {catLabel && (
          <span
            className="category-tag"
            style={
              {
                '--category-color': catColor,
                '--category-background': catColor + '20',
              } as React.CSSProperties
            }
          >
            {catLabel}
          </span>
        )}
        {riskScore !== null && riskScore >= 50 && (
          <span
            className="risk-score-badge"
            style={{
              color: catColor || 'var(--text-dim)',
              borderColor: catColor ? catColor + '40' : 'var(--border)',
              background: catColor ? catColor + '15' : 'transparent',
            }}
            title="Event risk score"
          >
            {riskScore}
          </span>
        )}
      </div>
      <a className="item-title" href={sanitizeUrl(cluster.primaryLink)} target="_blank" rel="noopener">
        {displayTitle}
      </a>
      <div className="cluster-meta">
        <span className="top-sources">
          {otherSources.length > 0 && (
            <>
              <span className="also-reported">Also:</span>
              {otherSources.map(s => {
                const propBadge = renderCorroboratingSourceRisk(s.name);
                return (
                  <span key={s.name} className={`top-source tier-${s.tier}`}>
                    {s.name}
                    {propBadge && <span dangerouslySetInnerHTML={{ __html: propBadge }} />}
                  </span>
                );
              })}
            </>
          )}
        </span>
        <span className="item-time">{formatTime(cluster.lastUpdated)}</span>
        {showTranslateBtn && (
          <button
            type="button"
            className="item-translate-btn"
            title="Translate"
            disabled={isTranslating}
            onClick={() => onTranslate(cluster.id, cluster.primaryTitle)}
          >
            {translatedTitle ? '✓' : '文'}
          </button>
        )}
      </div>
      {assetContext && assetContext.assets.length > 0 && (
        <div
          className="related-assets"
          data-cluster-id={cluster.id}
          onMouseEnter={() => onRelatedAssetsFocus?.(assetContext.assets, assetContext.origin.label)}
          onMouseLeave={() => onRelatedAssetsClear?.()}
        >
          <div className="related-assets-header">
            {t('components.newsPanel.relatedAssetsNear', { location: assetContext.origin.label })}
            <span className="related-assets-range">({MAX_DISTANCE_KM}km)</span>
          </div>
          <div className="related-assets-list">
            {assetContext.assets.map(asset => (
              <button
                key={`${asset.id}-${asset.type}`}
                type="button"
                className="related-asset"
                data-cluster-id={cluster.id}
                data-asset-id={asset.id}
                data-asset-type={asset.type}
                onClick={e => {
                  e.stopPropagation();
                  onRelatedAssetClick?.(asset);
                }}
              >
                <span className="related-asset-type">{getLocalizedAssetLabel(asset.type)}</span>
                <span className="related-asset-name">{asset.name}</span>
                <span className="related-asset-distance">{Math.round(asset.distanceKm)}km</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FlatItem({
  item,
  translatedTitle,
  isTranslating,
  onTranslate,
}: {
  item: NewsItem;
  translatedTitle: string | undefined;
  isTranslating: boolean;
  onTranslate: (id: string, text: string) => void;
}) {
  const snippet = item.snippet as string | undefined;
  const snippetTruncated = snippet
    ? snippet.length > 200
      ? snippet.slice(0, 200).replace(/\s+\S*$/, '') + '…'
      : snippet
    : null;
  const displayTitle = translatedTitle ?? item.title;
  const showTranslateBtn = getCurrentLanguage() !== 'en';

  return (
    <div
      className={`item${item.isAlert ? ' alert' : ''}`}
      style={item.monitorColor ? { borderInlineStartColor: item.monitorColor } : undefined}
      data-news-id={item.link}
    >
      <div className="item-source">
        {item.source}
        {item.lang && item.lang !== getCurrentLanguage() && (
          <span className="lang-badge">{item.lang.toUpperCase()}</span>
        )}
        {item.storyMeta?.phase === 'breaking' && (
          <span className="phase-badge breaking">BREAKING</span>
        )}
        {item.storyMeta?.phase === 'developing' && (
          <span className="phase-badge developing">
            DEVELOPING
            {item.storyMeta.mentionCount > 1 ? ` ×${item.storyMeta.mentionCount}` : ''}
          </span>
        )}
        {item.storyMeta?.phase === 'sustained' && (
          <span className="phase-badge sustained">ONGOING</span>
        )}
        {item.isAlert && <span className="alert-tag">ALERT</span>}
      </div>
      <a className="item-title" href={sanitizeUrl(item.link)} target="_blank" rel="noopener">
        {displayTitle}
      </a>
      {snippetTruncated && <div className="item-snippet">{snippetTruncated}</div>}
      <div className="item-time">
        {formatTime(item.pubDate)}
        {showTranslateBtn && (
          <button
            type="button"
            className="item-translate-btn"
            title="Translate"
            disabled={isTranslating}
            onClick={() => onTranslate(item.link, item.title)}
          >
            {translatedTitle ? '✓' : '文'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function NewsPanelContent({ store }: { store: NewsPanelStore }) {
  const [, forceUpdate] = useState(0);
  useEffect(() => store.subscribe(() => forceUpdate(n => n + 1)), [store]);

  const [sortMode, setSortMode] = useState<'relevance' | 'newest'>(() =>
    loadSortMode(store.panelId),
  );
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [translatedTitles, setTranslatedTitles] = useState<Map<string, string>>(() => new Map());
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(() => new Set());
  const [activityState, setActivityState] = useState<{ newItemIds: Set<string> }>({
    newItemIds: new Set(),
  });

  const isFirstRenderRef = useRef(true);
  const newSinceAwayIdsRef = useRef(new Set<string>());
  const clusterCancelRef = useRef(0);
  const headlineSigRef = useRef('');
  const headlinesRef = useRef<string[]>([]);
  const bodiesRef = useRef<string[]>([]);

  // Set store.contentEl via ref callback for scrollToNewsItem
  const innerRef = useCallback(
    (el: HTMLDivElement | null) => {
      store.contentEl = el;
    },
    [store],
  );

  // Activity tracking registration
  useEffect(() => {
    activityTracker.register(store.panelId);
    activityTracker.onChange(store.panelId, count => {
      store.newBadgeCount = count;
      store.notify();
    });
    return () => {
      activityTracker.unregister(store.panelId);
    };
  }, [store]);

  // Scroll/click on panel content → mark as seen
  useEffect(() => {
    const el = store.contentEl;
    if (!el) return;
    const panelContent = el.closest('.panel-content');
    if (!panelContent) return;
    const handler = () => activityTracker.markAsSeen(store.panelId);
    panelContent.addEventListener('scroll', handler);
    panelContent.addEventListener('click', handler);
    return () => {
      panelContent.removeEventListener('scroll', handler);
      panelContent.removeEventListener('click', handler);
    };
  });

  // Async clustering: flat items → clusters
  useEffect(() => {
    if (!store.flatItems?.length) return;
    const token = ++clusterCancelRef.current;
    const items = store.flatItems;
    void (async () => {
      try {
        const clustered = await analysisWorker.clusterNews(items);
        if (token !== clusterCancelRef.current) return;
        const enriched = await enrichWithVelocityML(clustered);
        if (token !== clusterCancelRef.current) return;
        store.clusters = enriched;
        store.mode = 'clusters';
        store.notify();
      } catch {
        // keep flat view on clustering failure
      }
    })();
  }, [store, store.flatItems]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sorted clusters (memoized on clusters + sortMode)
  const sortedClusters = useMemo(() => {
    if (!store.clusters?.length) return null;
    return [...store.clusters].sort((a, b) => {
      if (sortMode === 'newest') return b.lastUpdated.getTime() - a.lastUpdated.getTime();
      const pa = THREAT_PRIORITY[a.threat?.level ?? 'info'];
      const pb = THREAT_PRIORITY[b.threat?.level ?? 'info'];
      if (pb !== pa) return pb - pa;
      return b.lastUpdated.getTime() - a.lastUpdated.getTime();
    });
  }, [store.clusters, sortMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sorted flat items (memoized on flatItems + sortMode)
  const sortedItems = useMemo(() => {
    if (!store.flatItems?.length) return null;
    if (sortMode === 'newest') {
      return [...store.flatItems].sort(
        (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime(),
      );
    }
    return [...store.flatItems].sort((a, b) => {
      const sa = a.importanceScore ?? 0;
      const sb = b.importanceScore ?? 0;
      if (sb !== sa) return sb - sa;
      return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
    });
  }, [store.flatItems, sortMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Activity state update + related asset preload when clusters change
  useEffect(() => {
    if (!sortedClusters?.length) return;
    const clusterIds = sortedClusters.map(c => c.id);
    let newItemIds: Set<string>;
    if (isFirstRenderRef.current) {
      activityTracker.updateItems(store.panelId, clusterIds);
      const { newIds, seenIds } = computeNewSinceVisit(
        sortedClusters,
        activityTracker.getPreviousVisitTime(),
      );
      newItemIds = new Set(newIds);
      for (const id of newIds) newSinceAwayIdsRef.current.add(id);
      activityTracker.markItemsSeen(store.panelId, seenIds);
      isFirstRenderRef.current = false;
    } else {
      const newIds = activityTracker.updateItems(store.panelId, clusterIds);
      newItemIds = new Set(newIds);
    }
    setActivityState({ newItemIds });

    // Preload related asset lookup tables; re-render if new data arrived
    let cancelled = false;
    const titles = sortedClusters.flatMap(c => c.allItems.map(i => i.title));
    void preloadRelatedAssetTables(titles)
      .then(shouldRefresh => { if (!cancelled && shouldRefresh) store.notify(); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [store, sortedClusters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear translations when data changes
  useEffect(() => {
    setTranslatedTitles(new Map());
  }, [store.flatItems, store.clusters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update headlines/bodies for summary (derived from sorted data)
  if (sortedClusters) {
    headlinesRef.current = sortedClusters.slice(0, 5).map(c => c.primaryTitle);
    bodiesRef.current = sortedClusters.slice(0, 5).map(() => '');
  } else if (sortedItems) {
    const topItems = sortedItems
      .slice(0, 5)
      .filter(i => typeof i.title === 'string' && i.title.trim().length > 0);
    headlinesRef.current = topItems.map(i => i.title);
    bodiesRef.current = topItems.map(i =>
      typeof (i as NewsItem & { snippet?: string }).snippet === 'string'
        ? ((i as NewsItem & { snippet?: string }).snippet ?? '')
        : '',
    );
  }
  const newSig = headlineSignature(headlinesRef.current, bodiesRef.current);
  if (newSig !== headlineSigRef.current) {
    headlineSigRef.current = newSig;
    if (summaryText !== null) setSummaryText(null);
  }

  // Update count on store (for consistency with imperative API)
  if (sortedClusters) {
    store.count = sortedClusters.reduce((s, c) => s + c.sourceCount, 0);
  } else if (sortedItems) {
    store.count = sortedItems.length;
  }

  const handleTranslate = useCallback(
    async (id: string, text: string) => {
      const currentLang = getCurrentLanguage();
      if (currentLang === 'en' || translatedTitles.has(id) || translatingIds.has(id)) return;
      setTranslatingIds(prev => new Set([...prev, id]));
      try {
        const translated = await translateText(text, currentLang);
        if (translated) {
          setTranslatedTitles(prev => new Map([...prev, [id, translated]]));
        }
      } catch {
        // ignore
      } finally {
        setTranslatingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
      }
    },
    [translatedTitles, translatingIds],
  );

  const handleSortToggle = useCallback(() => {
    const next = sortMode === 'relevance' ? 'newest' : 'relevance';
    track('news-sort-toggle', { mode: next });
    saveSortMode(store.panelId, next);
    setSortMode(next);
  }, [sortMode, store.panelId]);

  const handleSummarize = useCallback(async () => {
    if (isSummarizing || !headlinesRef.current.length) return;
    const currentLang = getCurrentLanguage();
    const cacheKey = `panel_summary_v3_${SITE_VARIANT}_${store.panelId}_${currentLang}`;
    const sig = headlineSigRef.current;
    const cached = getCachedSummary(cacheKey, sig);
    if (cached) { setSummaryText(cached); return; }
    setIsSummarizing(true);
    try {
      const result = await generateSummary(
        headlinesRef.current.slice(0, 8),
        undefined,
        store.panelId,
        currentLang,
        { bodies: bodiesRef.current.slice(0, 8) },
      );
      if (result?.summary) {
        setCachedSummary(cacheKey, sig, result.summary);
        setSummaryText(result.summary);
      }
    } catch {
      // ignore
    } finally {
      setIsSummarizing(false);
    }
  }, [isSummarizing, store.panelId]);

  const sortIcon =
    sortMode === 'newest'
      ? '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><polyline points="8,4 8,8 11,10"/></svg>'
      : '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M4 7l4 4 4-4"/><line x1="3" y1="14" x2="13" y2="14"/></svg>';
  const sortLabel =
    sortMode === 'newest'
      ? t('components.newsPanel.sortNewest') || 'Newest'
      : t('components.newsPanel.sortRelevance') || 'Relevance';
  const sortTooltip = `${t('components.newsPanel.sortBy') || 'Sort by'}: ${sortLabel}`;

  const headerActions = (
    <>
      <DeviationIndicator deviation={store.deviation} />
      {/* eslint-disable-next-line react/no-danger */}
      <button
        type="button"
        className="panel-sort-btn"
        title={sortTooltip}
        aria-label={sortTooltip}
        onClick={handleSortToggle}
        dangerouslySetInnerHTML={{ __html: sortIcon }}
      />
      <button
        type="button"
        className="panel-summarize-btn"
        title={t('components.newsPanel.summarize')}
        disabled={isSummarizing}
        onClick={() => {
          track('news-summarize', { panelId: store.panelId });
          void handleSummarize();
        }}
      >
        {isSummarizing ? <span className="panel-summarize-spinner" /> : '✨'}
      </button>
    </>
  );

  // Build body content
  let bodyContent: React.ReactNode = null;
  if (store.mode === 'filteredEmpty') {
    bodyContent = <div className="panel-empty">{store.filteredEmptyMessage ?? ''}</div>;
  } else if (store.mode === 'clusters' && sortedClusters) {
    bodyContent = sortedClusters.map(cluster => (
      <ClusterCard
        key={cluster.id}
        cluster={cluster}
        isNew={activityState.newItemIds.has(cluster.id)}
        shouldHighlight={activityTracker.shouldHighlight(store.panelId, cluster.id)}
        showNewTag={
          activityState.newItemIds.has(cluster.id) &&
          (activityTracker.isNewItem(store.panelId, cluster.id) ||
            newSinceAwayIdsRef.current.has(cluster.id))
        }
        riskScoreGetter={store.riskScoreGetter}
        translatedTitle={translatedTitles.get(cluster.id)}
        isTranslating={translatingIds.has(cluster.id)}
        onTranslate={handleTranslate}
        onRelatedAssetClick={store.onRelatedAssetClick}
        onRelatedAssetsFocus={store.onRelatedAssetsFocus}
        onRelatedAssetsClear={store.onRelatedAssetsClear}
        assetContext={getClusterAssetContext(cluster)}
      />
    ));
  } else if (store.mode === 'flat' && sortedItems) {
    bodyContent = sortedItems.map(item => (
      <FlatItem
        key={item.link}
        item={item}
        translatedTitle={translatedTitles.get(item.link)}
        isTranslating={translatingIds.has(item.link)}
        onTranslate={handleTranslate}
      />
    ));
  }

  const errorMessage =
    store.mode === 'error'
      ? (store.errorMessage || t('common.failedToLoad') || 'Error')
      : null;

  return (
    <PanelShell
      id={store.panelId}
      title={store.title}
      infoTooltip={store.infoTooltip}
      showCount
      count={store.count}
      newItemCount={store.newBadgeCount}
      dataBadge={store.dataBadge}
      loading={store.loading}
      error={errorMessage}
      onRetry={store.errorOnRetry ?? undefined}
      autoRetrySeconds={store.errorAutoRetrySeconds}
      severity={computeSeverity(store.clusters)}
      headerActions={headerActions}
      trackActivity
    >
      {summaryText && <SummaryBar text={summaryText} onClose={() => setSummaryText(null)} />}
      <div ref={innerRef}>{bodyContent}</div>
    </PanelShell>
  );
}
