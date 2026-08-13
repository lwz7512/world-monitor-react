import type { AppContext } from '@/app/app-context';
import { enqueuePanelCall } from '@/app/pending-panel-data';
import { markLcpDebug } from '@/utils/lcp-debug';
import type { NewsItem } from '@/types';
import type { TimeRange } from '@/components/MapContainer';
import { FEEDS, CANONICAL_FEEDS, INTEL_SOURCES, SITE_VARIANT, STORAGE_KEYS } from '@/config';
import {
  resolveNewsCategories,
  enabledNewsCategoryKeys,
  type ResolvedCategory,
} from '@/config/feed-resolution';
import {
  countRepresentedSources,
  mergeRotatedNewsItems,
  nextRotationCycle,
  selectRotatingFeedWindow,
} from '@/app/news-feed-rotation';
import {
  runNewsLoadPass,
  newsWorkListSignature,
  type NewsCategoryLoadOptions,
  type NewsIntelLoadOptions,
} from '@/app/news-loader-sequencing';
import {
  countDigestCategories,
  DigestPersistenceQueue,
  digestCacheKey as digestCacheKeyFn,
  getScopedDigest,
  retainRicherScopedDigest,
  type ScopedDigest,
} from '@/app/news-digest-acceptance';
import { INTEL_HOTSPOTS, CONFLICT_ZONES } from '@/config/geo';
import { tokenizeForMatch, matchKeyword } from '@/utils/keyword-match';
import { updateBaseline, calculateDeviation, analysisWorker } from '@/services';
import { checkBatchForBreakingAlerts } from '@/services/breaking-news-alerts';
import { effectivePubDateMs } from '@/services/feed-date';
import { mlWorker } from '@/services/ml-worker';
import { clusterNewsHybrid } from '@/services/clustering';
import { getTopActiveGeoHubs } from '@/services/geo-activity';
import { filterFeedsByLanguage } from '@/services/feed-language';
import { getAiFlowSettings } from '@/services/ai-flow-settings';
import { t, getCurrentLanguage } from '@/services/i18n';
import { publicRpcFetch } from '@/services/public-rpc-fetch';
import type { ListFeedDigestResponse } from '@/generated/client/worldmonitor/news/v1/service_client';
import type { NewsItem as ProtoNewsItem } from '@/generated/client/worldmonitor/news/v1/service_client';
import type { ThreatLevel as ClientThreatLevel } from '@/types';
import { mountCommunityWidget } from '@/components/CommunityWidget';
import { getNewsStore } from '@/services/news-panel-registry';
import { setAllNews } from '@/services/all-news-store';
import { setInsightsClusters } from '@/services/insights-store';
import { setMonitorNews } from '@/services/monitor-news-store';
import { setGeoHubActivities } from '@/services/geo-hubs-store';
import { setTechHubActivities } from '@/services/tech-hubs-store';
import { classifyNewsItem } from '@/services/positive-classifier';
import { debounce, loadFromStorage, saveToStorage } from '@/utils';
import { isFeatureEnabled } from '@/services/runtime-config';
import { isDesktopRuntime, toApiUrl } from '@/services/runtime';
import { getPersistentCache, setPersistentCache } from '@/services/persistent-cache';

// The proto-level -> label map lives in shared/news-clustering-core.js so the
// client digest loader and the server-side MCP tools cannot drift (#5697).
import { protoThreatLevelToLabel } from '../../shared/news-clustering-core.js';

type RssModule = Pick<typeof import('@/services/rss'), 'fetchCategoryFeeds' | 'getFeedFailures'>;
type TrendingHeadlineInput = import('@/services/trending-keywords').TrendingHeadlineInput;
type DrainTrendingSignals = typeof import('@/services/trending-keywords').drainTrendingSignals;

let rssModulePromise: Promise<RssModule> | null = null;
let ingestHeadlinesPromise: Promise<(headlines: TrendingHeadlineInput[]) => void> | null = null;
let drainTrendingSignalsPromise: Promise<DrainTrendingSignals> | null = null;

function getRssModule(): Promise<RssModule> {
  rssModulePromise ??= import('@/services/rss').catch((err) => {
    rssModulePromise = null;
    throw err;
  });
  return rssModulePromise;
}

async function ingestTrendingHeadlines(headlines: TrendingHeadlineInput[]): Promise<void> {
  ingestHeadlinesPromise ??= import('@/services/trending-keywords')
    .then((module) => module.ingestHeadlines)
    .catch((err) => {
      ingestHeadlinesPromise = null;
      throw err;
    });
  const ingestHeadlines = await ingestHeadlinesPromise;
  ingestHeadlines(headlines);
}

export async function drainTrendingSignalQueue(): Promise<ReturnType<DrainTrendingSignals>> {
  try {
    drainTrendingSignalsPromise ??= import('@/services/trending-keywords')
      .then((module) => module.drainTrendingSignals)
      .catch((err) => {
        drainTrendingSignalsPromise = null;
        throw err;
      });
    const drainTrendingSignals = await drainTrendingSignalsPromise;
    return drainTrendingSignals();
  } catch (err) {
    console.warn('[News] drainTrendingSignals failed (chunk load?):', err);
    return [];
  }
}

const PROTO_TO_CLIENT_PHASE: Record<string, import('@/types').StoryPhase> = {
  STORY_PHASE_BREAKING: 'breaking',
  STORY_PHASE_DEVELOPING: 'developing',
  STORY_PHASE_SUSTAINED: 'sustained',
  STORY_PHASE_FADING: 'fading',
};

function protoItemToNewsItem(p: ProtoNewsItem): NewsItem {
  const level: ClientThreatLevel = protoThreatLevelToLabel(p.threat?.level);
  return {
    source: p.source,
    title: p.title,
    link: p.link,
    pubDate: new Date(p.publishedAt),
    isAlert: p.isAlert,
    importanceScore: p.importanceScore || undefined,
    corroborationCount: p.corroborationCount || undefined,
    storyMeta:
      p.storyMeta && p.storyMeta.phase !== 'STORY_PHASE_UNSPECIFIED'
        ? {
            firstSeen: p.storyMeta.firstSeen,
            mentionCount: p.storyMeta.mentionCount,
            sourceCount: p.storyMeta.sourceCount,
            phase: PROTO_TO_CLIENT_PHASE[p.storyMeta.phase] ?? 'breaking',
          }
        : undefined,
    threat: p.threat
      ? {
          level,
          category: p.threat.category as import('@/services/threat-classifier').EventCategory,
          confidence: p.threat.confidence,
          source: (p.threat.source || 'keyword') as 'keyword' | 'ml' | 'llm',
        }
      : undefined,
    ...(p.locationName && { locationName: p.locationName }),
    ...(p.location && { lat: p.location.latitude, lon: p.location.longitude }),
    ...(p.importanceScore ? { importanceScore: p.importanceScore } : {}),
    ...(p.corroborationCount ? { corroborationCount: p.corroborationCount } : {}),
    // Cleaned RSS description (U3 proto field 12). Only populated when the
    // upstream feed carried a usable <description>/<content:encoded>/<summary>;
    // empty string otherwise. Consumers render the headline and fall back to
    // snippet as a secondary line when non-empty.
    ...(p.snippet ? { snippet: p.snippet } : {}),
    // Ingest-extracted tickers (#4922a, proto field 13). Runtime guard on
    // top of the generated type: persisted last-good digests from before
    // the rollout carry items without the field.
    ...(p.tickers && p.tickers.length ? { tickers: p.tickers } : {}),
  };
}

export interface NewsLoaderCallbacks {
  loadHappySupplementaryAndRender(): Promise<void>;
  loadPositiveEvents(): Promise<void>;
  loadKindnessData(): void;
}

export class NewsLoader {
  private readonly ctx: AppContext;
  private readonly callbacks: NewsLoaderCallbacks;

  private mapFlashCache: Map<string, number> = new Map();
  private readonly MAP_FLASH_COOLDOWN_MS = 10 * 60 * 1000;
  private readonly applyTimeRangeFilterToNewsPanelsDebounced = debounce(() => {
    this.applyTimeRangeFilterToNewsPanels();
  }, 120);

  private digestBreaker = {
    state: 'closed' as 'closed' | 'open' | 'half-open',
    failures: 0,
    cooldownUntil: 0,
  };
  private readonly digestRequestTimeoutMs = 8000;
  private readonly digestFirstPaintGraceMs = 1500;
  private readonly digestBreakerCooldownMs = 5 * 60 * 1000;
  private readonly persistedDigestMaxAgeMs = 6 * 60 * 60 * 1000;
  private readonly perFeedFallbackCategoryFeedLimit = 3;
  private readonly perFeedFallbackIntelFeedLimit = 6;
  private readonly perFeedFallbackBatchSize = 2;
  /**
   * Ceiling on a custom category's ACCUMULATED item set (#5873).
   *
   * A custom category rotates through its sources `perFeedFallbackCategoryFeedLimit`
   * at a time and merges each cycle into what the panel already shows, so unlike
   * every other path its item set is not one snapshot. 40 is twice the server
   * digest's `MAX_ITEMS_PER_CATEGORY` (20) — enough headroom for a full rotation
   * lap of a ten-source category to stay represented at once, while keeping the
   * panel, `ctx.allNews` and the clustering input the same order of magnitude as
   * a digest-backed category.
   */
  private readonly customCategoryMergedItemLimit = 40;
  /**
   * Reachable source count for custom categories.
   *
   * Coverage is derived when the category is rendered, after the active time
   * range has filtered its items. Keeping only the denominator here prevents a
   * stale pre-filter count from surviving time-range changes.
   */
  private readonly customNewsSourceTotals = new Map<string, number>();
  private lastGoodDigest: ScopedDigest<ListFeedDigestResponse> | null = null;
  private readonly digestPersistenceQueue = new DigestPersistenceQueue<ListFeedDigestResponse>({
    cacheMaxAgeMs: this.persistedDigestMaxAgeMs,
    read: (key) => getPersistentCache<ListFeedDigestResponse>(key),
    write: (key, data) => setPersistentCache(key, data),
    onSkipPersist: (fetchedCategoryCount, cachedCategoryCount) => {
      console.warn(
        `[News] Digest covers ${fetchedCategoryCount} categories, fewer than the ` +
          `${cachedCategoryCount} already cached — keeping the cached last-good digest`,
      );
    },
  });
  /**
   * Work-list signature of the last news load that actually landed data, or
   * `null` if none has. Gates loadAllData()'s `news` task — see
   * `shouldHydrateNews`. Left unset when a load throws or comes back empty with
   * no usable digest, so a failed load stays retryable.
   */
  private loadedNewsSignature: string | null = null;

  constructor(ctx: AppContext, callbacks: NewsLoaderCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
  }

  private callPanel(key: string, method: string, ...args: unknown[]): void {
    // First try the news-panel-registry (covers panels now in PANEL_REGISTRY
    // that expose methods on their NewsPanelStore rather than ctx.panels).
    const store = getNewsStore(key);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeObj = store as any;
    if (storeObj && typeof storeObj[method] === 'function') {
      storeObj[method](...args);
      return;
    }
    const panel = this.ctx.panels[key];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = panel as any;
    if (obj && typeof obj[method] === 'function') {
      obj[method](...args);
      return;
    }
    enqueuePanelCall(key, method, args);
  }

  private async tryFetchDigest(): Promise<ListFeedDigestResponse | null> {
    const now = Date.now();
    // Capture request and persistence scope together. Sampling the language again
    // after the response would let an old-language request populate the new
    // language's cache when the user switches languages in flight.
    const requestLanguage = getCurrentLanguage();
    const requestKey = this.digestCacheKey(requestLanguage);

    if (this.digestBreaker.state === 'open') {
      if (now < this.digestBreaker.cooldownUntil) {
        return this.getRetainedDigest(requestKey) ?? (await this.loadPersistedDigest(requestKey));
      }
      this.digestBreaker.state = 'half-open';
    }

    try {
      markLcpDebug('wm:data:feed-digest-start');
      const resp = await publicRpcFetch(
        toApiUrl(`/api/news/v1/list-feed-digest?variant=${SITE_VARIANT}&lang=${requestLanguage}`),
        { signal: AbortSignal.timeout(this.digestRequestTimeoutMs) },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as ListFeedDigestResponse;
      const catCount = countDigestCategories(data);
      // A 200 carrying no categories is an outage wearing a success status: every
      // preset category renders empty behind it, because per-feed fallback is off
      // on web. Throwing routes it into the catch below, which is the whole point
      // — the breaker counts it, `lastGoodDigest` keeps the real digest it had, and
      // `digest:last-good` is left alone instead of being poisoned for 6 hours with
      // the empty body the fallback exists to survive (#5877).
      if (catCount === 0) throw new Error('digest returned 0 categories');
      markLcpDebug('wm:data:feed-digest-ready', { categories: catCount });
      console.info(`[News] Digest fetched: ${catCount} categories`);
      this.persistDigest(requestKey, data);
      this.digestBreaker = { state: 'closed', failures: 0, cooldownUntil: 0 };

      const currentKey = this.digestCacheKey();
      if (currentKey !== requestKey) {
        // The response is valid for the scope it requested and may refresh that
        // scope's persistent cache, but it must not become live data or an
        // in-memory fallback for the language now active.
        return this.getRetainedDigest(currentKey) ?? (await this.loadPersistedDigest(currentKey));
      }
      this.lastGoodDigest = retainRicherScopedDigest(this.lastGoodDigest, requestKey, data);
      return data;
    } catch (e) {
      markLcpDebug('wm:data:feed-digest-error');
      console.warn('[News] Digest fetch failed, using fallback:', e);
      this.digestBreaker.failures++;
      if (this.digestBreaker.failures >= 2) {
        this.digestBreaker.state = 'open';
        this.digestBreaker.cooldownUntil = now + this.digestBreakerCooldownMs;
      }
      const currentKey = this.digestCacheKey();
      return this.getRetainedDigest(currentKey) ?? (await this.loadPersistedDigest(currentKey));
    }
  }

  /**
   * Write the fresh digest to `digest:last-good`, unless that would shrink it.
   *
   * A PARTIAL digest is the second degraded shape (#5877): a 200 that covers
   * some categories but fewer than the entry already cached. The response is
   * real data, so the caller uses it for this load — but overwriting a richer
   * `digest:last-good` with it is a strict loss for the NEXT page load, which is
   * the one that falls back to this entry when the digest is unreachable.
   *
   * Deliberately fire-and-forget and off the fetch path: the comparison needs a
   * persistent-cache READ, and `tryFetchDigest` sits on the news first-paint
   * path, so awaiting an IndexedDB round trip there would buy correctness for
   * the fallback at the cost of the load it is protecting. A read failure is
   * treated as "nothing cached" and the write proceeds — the previous behaviour.
   */
  private persistDigest(key: string, data: ListFeedDigestResponse): void {
    this.digestPersistenceQueue.enqueue(key, data);
  }

  /**
   * Cache key for the last-good digest, scoped exactly like the request that
   * produced it.
   *
   * The digest is fetched per `variant` and `lang`, but the entry used to be
   * stored under one global key — so a variant or language switch compared, and
   * fell back to, a digest built for a different category set entirely. That was
   * survivable while every successful fetch overwrote the entry unconditionally;
   * it is not survivable now that coverage decides whether to overwrite, because
   * a wider digest from the OTHER variant would veto persisting the current
   * one's for up to 6 hours (#5877).
   *
   * Scoping also retires every entry written under the old key, which is the
   * migration path for a cache already poisoned by a degraded digest: those
   * entries simply become unreachable rather than needing to be detected.
   */
  private digestCacheKey(language = getCurrentLanguage()): string {
    return digestCacheKeyFn(SITE_VARIANT, language);
  }

  private getRetainedDigest(key = this.digestCacheKey()): ListFeedDigestResponse | null {
    return getScopedDigest(this.lastGoodDigest, key);
  }

  private async loadPersistedDigest(
    key = this.digestCacheKey(),
  ): Promise<ListFeedDigestResponse | null> {
    try {
      const envelope = await getPersistentCache<ListFeedDigestResponse>(key);
      if (!envelope) return null;
      if (Date.now() - envelope.updatedAt > this.persistedDigestMaxAgeMs) return null;
      // Do not let an IndexedDB read started for a previous language complete
      // into the new language's in-memory fallback.
      if (key !== this.digestCacheKey()) return null;
      this.lastGoodDigest = retainRicherScopedDigest(this.lastGoodDigest, key, envelope.data);
      return envelope.data;
    } catch {
      return null;
    }
  }

  private isPerFeedFallbackEnabled(): boolean {
    // Desktop: server digest has fewer categories than client FEEDS config.
    // Enable per-feed RSS fallback so missing categories fetch directly.
    if (isDesktopRuntime()) return true;
    return isFeatureEnabled('newsPerFeedFallback');
  }

  private getStaleNewsItems(category: string): NewsItem[] {
    const staleItems = this.ctx.newsByCategory[category];
    if (!Array.isArray(staleItems) || staleItems.length === 0) return [];
    return [...staleItems].sort((a, b) => effectivePubDateMs(b) - effectivePubDateMs(a));
  }

  private selectLimitedFeeds<T>(feeds: T[], maxFeeds: number): T[] {
    if (feeds.length <= maxFeeds) return feeds;
    return feeds.slice(0, maxFeeds);
  }

  /**
   * Rotation cycle of a custom category's capped per-feed window, persisted so
   * it survives a reload (#5873).
   *
   * In-memory-only state would restart every custom category at window 0 on
   * every page load, which for the common short session is indistinguishable
   * from the fixed prefix this replaced: sources 4..N would still never be
   * fetched. Reads are defensive — a hand-edited or older-schema value must not
   * reach `selectRotatingFeedWindow` as a NaN start.
   */
  private readNewsRotationCycles(): Record<string, number> {
    const stored = loadFromStorage<Record<string, number>>(STORAGE_KEYS.newsFeedRotation, {});
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  }

  private newsRotationCycle(category: string): number {
    const cycle = this.readNewsRotationCycles()[category];
    return typeof cycle === 'number' && Number.isFinite(cycle) && cycle >= 0
      ? Math.trunc(cycle)
      : 0;
  }

  /**
   * Advance and persist a custom category's rotation cycle.
   *
   * Written AFTER the window for this cycle has been selected, and pruned to
   * the custom categories still in the work-list so a panel the user has since
   * removed can't leave its entry behind forever.
   */
  private advanceNewsRotationCycle(category: string, feedCount: number): void {
    const keep = new Set(
      this.resolveEnabledNewsCategories()
        .filter(({ isCustom }) => isCustom)
        .map(({ key }) => key),
    );
    keep.add(category);

    const next: Record<string, number> = {};
    for (const [key, value] of Object.entries(this.readNewsRotationCycles())) {
      if (keep.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        next[key] = Math.trunc(value);
      }
    }
    next[category] = nextRotationCycle(this.newsRotationCycle(category), feedCount);
    saveToStorage(STORAGE_KEYS.newsFeedRotation, next);
  }

  private findFlashLocation(title: string): { lat: number; lon: number } | null {
    const tokens = tokenizeForMatch(title);
    let bestMatch: { lat: number; lon: number; matches: number } | null = null;

    const countKeywordMatches = (keywords: string[] | undefined): number => {
      if (!keywords) return 0;
      let matches = 0;
      for (const keyword of keywords) {
        const cleaned = keyword.trim().toLowerCase();
        if (cleaned.length >= 3 && matchKeyword(tokens, cleaned)) {
          matches++;
        }
      }
      return matches;
    };

    for (const hotspot of INTEL_HOTSPOTS) {
      const matches = countKeywordMatches(hotspot.keywords);
      if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
        bestMatch = { lat: hotspot.lat, lon: hotspot.lon, matches };
      }
    }

    for (const conflict of CONFLICT_ZONES) {
      const matches = countKeywordMatches(conflict.keywords);
      if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
        bestMatch = { lat: conflict.center[1], lon: conflict.center[0], matches };
      }
    }

    return bestMatch;
  }

  private flashMapForNews(items: NewsItem[]): void {
    if (!this.ctx.map || !this.ctx.initialLoadComplete) return;
    if (!getAiFlowSettings().mapNewsFlash) return;
    const now = Date.now();

    for (const [key, timestamp] of this.mapFlashCache.entries()) {
      if (now - timestamp > this.MAP_FLASH_COOLDOWN_MS) {
        this.mapFlashCache.delete(key);
      }
    }

    for (const item of items) {
      const cacheKey = `${item.source}|${item.link || item.title}`;
      const lastSeen = this.mapFlashCache.get(cacheKey);
      if (lastSeen && now - lastSeen < this.MAP_FLASH_COOLDOWN_MS) {
        continue;
      }

      const location = this.findFlashLocation(item.title);
      if (!location) continue;

      this.ctx.map.flashLocation(location.lat, location.lon);
      this.mapFlashCache.set(cacheKey, now);
    }
  }

  getTimeRangeWindowMs(range: TimeRange): number {
    const ranges: Record<TimeRange, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '48h': 48 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      all: Infinity,
    };
    return ranges[range];
  }

  filterItemsByTimeRange(
    items: NewsItem[],
    range: TimeRange = this.ctx.currentTimeRange,
  ): NewsItem[] {
    if (range === 'all') return items;
    const cutoff = Date.now() - this.getTimeRangeWindowMs(range);
    return items.filter((item) => {
      // effectivePubDateMs returns 0 for items that cannot claim a real
      // freshness rank: pubDateMissing items (the U3 contract) AND items
      // whose pubDate is NaN/Infinity/Invalid Date (the helper's value-
      // sanitization branch). All such items are EXCLUDED from positive-
      // window ranges. Previous behavior wrapped raw pubDate.getTime() in
      // Number.isFinite() and fell through to `true` on non-finite — that
      // included corrupt-stamp items in time-range views, arguably a bug.
      // The current shape treats untrustworthy timestamps uniformly: they
      // never claim freshness and never appear in a "last 24h" view.
      return effectivePubDateMs(item) >= cutoff;
    });
  }

  getTimeRangeLabel(range: TimeRange = this.ctx.currentTimeRange): string {
    const labels: Record<TimeRange, string> = {
      '1h': 'the last hour',
      '6h': 'the last 6 hours',
      '24h': 'the last 24 hours',
      '48h': 'the last 48 hours',
      '7d': 'the last 7 days',
      all: 'all time',
    };
    return labels[range];
  }

  private newsPanelKey(category: string): string {
    return this.ctx.newsCategoryPanelKeys.get(category) ?? category;
  }

  private clearNewsSourceCoverage(category: string): void {
    this.customNewsSourceTotals.delete(category);
    this.callPanel(this.newsPanelKey(category), 'setSourceCoverage', null);
  }

  private setNewsRefreshDegraded(category: string, degraded: boolean): void {
    this.callPanel(this.newsPanelKey(category), 'setRefreshDegraded', degraded);
  }

  renderNewsForCategory(category: string, items: NewsItem[]): void {
    this.ctx.newsByCategory[category] = items;
    const filteredItems = this.filterItemsByTimeRange(items);
    const sourceTotal = this.customNewsSourceTotals.get(category);
    if (sourceTotal !== undefined) {
      this.callPanel(this.newsPanelKey(category), 'setSourceCoverage', {
        covered: countRepresentedSources(filteredItems),
        total: sourceTotal,
      });
    }

    const panel = getNewsStore(category);
    if (!panel) return;
    if (filteredItems.length === 0 && items.length > 0) {
      panel.renderFilteredEmpty(`No items in ${this.getTimeRangeLabel()}`);
      return;
    }
    panel.renderNews(filteredItems);
  }

  applyTimeRangeFilterToNewsPanels(): void {
    Object.entries(this.ctx.newsByCategory).forEach(([category, items]) => {
      this.renderNewsForCategory(category, items);
    });
  }

  applyTimeRangeFilterDebounced(): void {
    this.applyTimeRangeFilterToNewsPanelsDebounced();
  }

  // `isCustom` marks a category from a user-added panel that isn't in the
  // active variant's preset. The per-variant server digest never carries it, so
  // it skips the digest-availability gate and fetches directly client-side —
  // still capped by perFeedFallbackCategoryFeedLimit like any other per-feed
  // fallback, because nothing bounds how many custom categories a session has
  // (#5376). The cost is borne only by users who customize.
  //
  // That cap is a degraded-mode ceiling for a preset category but the STEADY
  // STATE for a custom one, so the two diverge in how they spend it (#5873):
  // a custom category rotates its window across cycles and merges each cycle
  // into what the panel already shows, and reports the resulting source
  // coverage on the panel badge. A preset category keeps the fixed prefix and
  // whole-set replace — it is digest-backed in the normal case, and its
  // fallback lasts only as long as the outage.
  private async loadNewsCategory(
    category: string,
    feeds: typeof FEEDS.politics,
    digest?: ListFeedDigestResponse | null,
    isCustom = false,
    options: NewsCategoryLoadOptions = {
      allowDigestPendingFallback: false,
      recordBaselineSample: true,
    },
  ): Promise<NewsItem[]> {
    try {
      const panel = getNewsStore(category);

      const enabledFeeds = (feeds ?? []).filter((f) => !this.ctx.disabledSources.has(f.name));
      if (enabledFeeds.length === 0) {
        delete this.ctx.newsByCategory[category];
        this.clearNewsSourceCoverage(category);
        if (panel) {
          panel.showError(t('common.allSourcesDisabled'));
        }
        this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
          status: 'ok',
          itemCount: 0,
        });
        return [];
      }
      const enabledNames = new Set(enabledFeeds.map((f) => f.name));

      // The feeds a direct fetch would actually attempt. `fetchCategoryFeeds`
      // drops feeds whose declared `lang` isn't the current UI language, so for
      // a rotating custom category the enabled set is the wrong denominator on
      // both counts: `europe` declares 47 feeds but only 6 are fetchable for an
      // English user, so rotating over all 47 would spend ~7 of every 8
      // twenty-minute cycles fetching nothing, and the coverage badge would sit
      // at "6/47 sources" permanently — a fresh version of the same lie #5873 is
      // about. Preset categories keep the full enabled set: they are
      // digest-backed, and `enabledNames` (which filters digest items by source)
      // must stay language-blind because the server does not language-filter.
      const reachableFeeds = isCustom
        ? filterFeedsByLanguage(enabledFeeds, getCurrentLanguage())
        : enabledFeeds;
      if (isCustom) {
        this.customNewsSourceTotals.set(category, reachableFeeds.length);
      }

      // Digest branch: server already aggregated feeds — map proto items to client types
      if (digest?.categories && category in digest.categories) {
        // The digest carries every enabled source for the category, so there is
        // no partial coverage to disclose — clear any badge a prior custom-path
        // load left behind.
        this.clearNewsSourceCoverage(category);
        this.setNewsRefreshDegraded(category, false);
        const items = (digest.categories[category]?.items ?? [])
          .map(protoItemToNewsItem)
          .filter((i) => enabledNames.has(i.source));

        void ingestTrendingHeadlines(
          items.map((i) => ({
            title: i.title,
            pubDate: i.pubDate,
            source: i.source,
            link: i.link,
          })),
        ).catch((err) => {
          console.warn('[News] ingestTrendingHeadlines failed (chunk load?):', err);
        });

        // Skip client-side AI reclassification for digest items.
        // The server already ran enrichWithAiCache() which checks the same Redis keys
        // that classifyEvent writes to. Re-firing classifyEvent from every client wastes
        // edge requests even when they're Redis cache hits.

        checkBatchForBreakingAlerts(items);
        this.flashMapForNews(items);
        this.renderNewsForCategory(category, items);

        this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
          status: 'ok',
          itemCount: items.length,
        });

        if (panel && options.recordBaselineSample) {
          try {
            const baseline = await updateBaseline(`news:${category}`, items.length);
            const deviation = calculateDeviation(items.length, baseline);
            panel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
          } catch (e) {
            console.warn(`[Baseline] news:${category} write failed:`, e);
          }
        }

        return items;
      }

      // Preset categories: serve last-known-good while the digest is briefly
      // unavailable. Custom categories are NEVER in the digest, so this branch
      // would fire on every refresh after the first load — getStaleNewsItems
      // reads ctx.newsByCategory, which the prior cycle's direct fetch already
      // populated — and freeze the panel on stale headlines. Skip it for them
      // and fall through to the direct fetch; the panel keeps showing its
      // current batch until fresh data lands (no blank flash).
      const staleItems = this.getStaleNewsItems(category).filter((i) => enabledNames.has(i.source));

      // For a custom category that same set is not "stale headlines to freeze
      // on" but the CARRY-OVER this cycle accumulates onto: the rotation window
      // only ever fetches perFeedFallbackCategoryFeedLimit sources, so the
      // sources it did NOT fetch this time live here (#5873). Snapshotted here,
      // before any render — renderNewsForCategory overwrites
      // ctx.newsByCategory, which is what getStaleNewsItems reads, so reading
      // it later would fold each partial render back into itself.
      const carryOver = isCustom ? staleItems : [];

      /**
       * What to actually paint for a given set of freshly fetched items.
       *
       * Identity for a preset category — its fallback replaces wholesale, as
       * before. For a custom one it merges onto the carry-over. Source coverage
       * is published by renderNewsForCategory after time-range filtering, so
       * the badge describes what is actually visible.
       */
      const mergeForRender = (freshItems: NewsItem[]): NewsItem[] => {
        if (!isCustom) return freshItems;
        return mergeRotatedNewsItems(carryOver, freshItems, {
          maxItems: this.customCategoryMergedItemLimit,
          enabledSources: enabledNames,
        });
      };

      // Per-feed fallback: fetch each feed individually (first load or digest unavailable)
      const renderIntervalMs = 100;
      let lastRenderTime = 0;
      let renderTimeout: ReturnType<typeof setTimeout> | null = null;
      let pendingItems: NewsItem[] | null = null;

      const flushPendingRender = () => {
        if (!pendingItems) return;
        this.renderNewsForCategory(category, pendingItems);
        pendingItems = null;
        lastRenderTime = Date.now();
      };

      const scheduleRender = (partialItems: NewsItem[]) => {
        if (!panel) return;
        // Merge BEFORE queueing, not at flush time: rendering the raw partial
        // would blank the carried-over sources for one frame and then bring
        // them back, which is the churn the merge exists to avoid.
        pendingItems = mergeForRender(partialItems);
        const elapsed = Date.now() - lastRenderTime;
        if (elapsed >= renderIntervalMs) {
          if (renderTimeout) {
            clearTimeout(renderTimeout);
            renderTimeout = null;
          }
          flushPendingRender();
          return;
        }

        if (!renderTimeout) {
          renderTimeout = setTimeout(() => {
            renderTimeout = null;
            flushPendingRender();
          }, renderIntervalMs - elapsed);
        }
      };

      if (!isCustom && staleItems.length > 0) {
        console.warn(
          `[News] Digest missing for "${category}", serving stale headlines (${staleItems.length})`,
        );
        this.renderNewsForCategory(category, staleItems);
        this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
          status: 'ok',
          itemCount: staleItems.length,
        });
        return staleItems;
      }

      // The per-feed-fallback flag is the kill switch for the digest-down
      // thundering herd (every preset category fetching at once), so it does NOT
      // apply to custom categories: those are NEVER in the digest by design and
      // direct fetch is their only path — gating them here would leave a
      // customized panel permanently empty rather than degraded. Their blast
      // radius is bounded by the feed cap below instead.
      if (!isCustom && !this.isPerFeedFallbackEnabled() && !options.allowDigestPendingFallback) {
        console.warn(`[News] Digest missing for "${category}", limited per-feed fallback disabled`);
        this.renderNewsForCategory(category, []);
        this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
          status: 'error',
          errorMessage: 'Digest unavailable',
        });
        return [];
      }

      // Every per-feed fallback is capped, custom categories included. They used
      // to fetch their full feed set on the theory that a handful of customized
      // panels carried "no thundering-herd risk" — three of them firing on every
      // load, uncapped, was 19 direct proxy round-trips (#5376). Nothing bounds
      // how many custom categories a session can have, so the cap has to be
      // unconditional.
      //
      // WHICH feeds the cap buys is where the two diverge. A preset category
      // takes the fixed prefix: its fallback is transient, and re-fetching the
      // same feeds is what makes an outage's repeated attempts idempotent. A
      // custom category is the ONLY consumer of its feeds and is never in the
      // digest, so a fixed prefix made the cap PERMANENT — feeds 4..N were
      // unreachable on every load and every refresh (#5873). It rotates
      // instead: same request budget, advanced by the cap each cycle, so every
      // source is reached within ceil(N / cap) cycles.
      const rotationCycle = isCustom ? this.newsRotationCycle(category) : 0;
      const fallbackFeeds = isCustom
        ? selectRotatingFeedWindow(
            reachableFeeds,
            this.perFeedFallbackCategoryFeedLimit,
            rotationCycle,
          )
        : this.selectLimitedFeeds(enabledFeeds, this.perFeedFallbackCategoryFeedLimit);
      if (isCustom) {
        // Advanced as soon as the window is claimed rather than after the fetch
        // resolves, so a cycle that fails outright still moves on instead of
        // retrying the same failing window forever.
        this.advanceNewsRotationCycle(category, reachableFeeds.length);
        console.warn(
          `[News] Custom category "${category}" (not in variant preset), fetching ${fallbackFeeds.length}/${reachableFeeds.length} feeds directly (rotation cycle ${rotationCycle})`,
        );
      } else if (options.allowDigestPendingFallback) {
        console.warn(
          `[News] Digest still pending for "${category}", using limited per-feed fallback (${fallbackFeeds.length}/${enabledFeeds.length} feeds)`,
        );
      } else if (fallbackFeeds.length < enabledFeeds.length) {
        console.warn(
          `[News] Digest missing for "${category}", using limited per-feed fallback (${fallbackFeeds.length}/${enabledFeeds.length} feeds)`,
        );
      } else {
        console.warn(
          `[News] Digest missing for "${category}", using per-feed fallback (${fallbackFeeds.length} feeds)`,
        );
      }

      const { fetchCategoryFeeds, getFeedFailures } = await getRssModule();
      const fetchedItems = await fetchCategoryFeeds(fallbackFeeds, {
        batchSize: this.perFeedFallbackBatchSize,
        onBatch: (partialItems) => {
          scheduleRender(partialItems);
          // Map flashes and breaking-news alerts fire on the FRESH batch only.
          // Feeding them the merged set would re-flash and re-alert on every
          // rotation cycle for headlines the user has already seen.
          this.flashMapForNews(partialItems);
          checkBatchForBreakingAlerts(partialItems);
        },
      });

      // Everything downstream — render, empty-state, baseline, status count and
      // the value that lands in ctx.allNews — reads the MERGED set, because for
      // a custom category that is what the panel actually shows. Using the raw
      // fetch would report this cycle's three sources as the whole category and
      // hand clustering a set the user isn't looking at.
      const items = mergeForRender(fetchedItems);
      const failures = getFeedFailures();
      const failedFeeds = fallbackFeeds.filter((f) => failures.has(f.name));
      const windowFailed = fallbackFeeds.length > 0 && failedFeeds.length === fallbackFeeds.length;
      this.setNewsRefreshDegraded(category, windowFailed);
      this.renderNewsForCategory(category, items);
      if (panel) {
        if (renderTimeout) {
          clearTimeout(renderTimeout);
          renderTimeout = null;
          pendingItems = null;
        }

        if (items.length === 0 && failedFeeds.length > 0) {
          const names = failedFeeds.map((f) => f.name).join(', ');
          panel.showError(`${t('common.noNewsAvailable')} (${names} failed)`);
        }

        if (options.recordBaselineSample && !windowFailed) {
          try {
            const baseline = await updateBaseline(`news:${category}`, items.length);
            const deviation = calculateDeviation(items.length, baseline);
            panel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
          } catch (e) {
            console.warn(`[Baseline] news:${category} write failed:`, e);
          }
        }
      }

      const feedLabel = category.charAt(0).toUpperCase() + category.slice(1);
      if (windowFailed) {
        const names = failedFeeds.map((f) => f.name).join(', ');
        this.ctx.statusPanel?.updateFeed(feedLabel, {
          status: 'error',
          itemCount: items.length,
          errorMessage: `${names} failed`,
        });
        this.ctx.statusPanel?.updateApi('RSS2JSON', { status: 'error' });
      } else {
        this.ctx.statusPanel?.updateFeed(feedLabel, {
          status: 'ok',
          itemCount: items.length,
        });
        this.ctx.statusPanel?.updateApi('RSS2JSON', { status: 'ok' });
      }

      return items;
    } catch (error) {
      this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
        status: 'error',
        errorMessage: String(error),
      });
      this.ctx.statusPanel?.updateApi('RSS2JSON', { status: 'error' });
      // A preset category drops its items: its next successful load replaces
      // them wholesale from the digest, so holding stale ones only risks
      // presenting them as current.
      //
      // A custom category's stored items are its ACCUMULATED rotation coverage,
      // built one capped window per 20-minute cycle (#5873). Dropping them
      // sends the next cycle back to carry-over-less, so a single transient
      // error — a chunk-load hiccup is enough — silently restarts the hour it
      // takes to cover a ten-source panel. Keep them: the next cycle merges
      // onto them, and the status panel already reports the error.
      if (!isCustom) {
        delete this.ctx.newsByCategory[category];
        return [];
      }

      this.setNewsRefreshDegraded(category, true);
      const enabledNames = new Set(
        (feeds ?? [])
          .filter((feed) => !this.ctx.disabledSources.has(feed.name))
          .map((feed) => feed.name),
      );
      return this.getStaleNewsItems(category).filter((item) => enabledNames.has(item.source));
    }
  }

  private async loadIntelNews(
    digest: ListFeedDigestResponse | null,
    allowDigestPendingFallback: boolean,
    options: NewsIntelLoadOptions = { recordBaselineSample: true },
  ): Promise<NewsItem[]> {
    const enabledIntelSources = INTEL_SOURCES.filter((f) => !this.ctx.disabledSources.has(f.name));
    const enabledIntelNames = new Set(enabledIntelSources.map((f) => f.name));
    const intelPanel = getNewsStore('intel');
    if (enabledIntelSources.length === 0) {
      delete this.ctx.newsByCategory['intel'];
      if (intelPanel) intelPanel.showError(t('common.allIntelSourcesDisabled'));
      this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: 0 });
      return [];
    }

    if (digest?.categories && 'intel' in digest.categories) {
      // Digest branch for intel
      const intel = (digest.categories['intel']?.items ?? [])
        .map(protoItemToNewsItem)
        .filter((i) => enabledIntelNames.has(i.source));
      checkBatchForBreakingAlerts(intel);
      this.renderNewsForCategory('intel', intel);
      if (intelPanel && options.recordBaselineSample) {
        try {
          const baseline = await updateBaseline('news:intel', intel.length);
          const deviation = calculateDeviation(intel.length, baseline);
          intelPanel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
        } catch (e) {
          console.warn('[Baseline] news:intel write failed:', e);
        }
      }
      this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: intel.length });
      this.flashMapForNews(intel);
      return intel;
    }

    const staleIntel = this.getStaleNewsItems('intel').filter((i) =>
      enabledIntelNames.has(i.source),
    );
    if (staleIntel.length > 0) {
      console.warn(`[News] Intel digest missing, serving stale headlines (${staleIntel.length})`);
      this.renderNewsForCategory('intel', staleIntel);
      if (intelPanel && options.recordBaselineSample) {
        try {
          const baseline = await updateBaseline('news:intel', staleIntel.length);
          const deviation = calculateDeviation(staleIntel.length, baseline);
          intelPanel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
        } catch (e) {
          console.warn('[Baseline] news:intel write failed:', e);
        }
      }
      this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: staleIntel.length });
      return staleIntel;
    }

    if (!this.isPerFeedFallbackEnabled() && !allowDigestPendingFallback) {
      console.warn('[News] Intel digest missing, limited per-feed fallback disabled');
      delete this.ctx.newsByCategory['intel'];
      this.ctx.statusPanel?.updateFeed('Intel', {
        status: 'error',
        errorMessage: 'Digest unavailable',
      });
      return [];
    }

    const fallbackIntelFeeds = this.selectLimitedFeeds(
      enabledIntelSources,
      this.perFeedFallbackIntelFeedLimit,
    );
    if (allowDigestPendingFallback) {
      console.warn(
        `[News] Intel digest still pending, using limited per-feed fallback (${fallbackIntelFeeds.length}/${enabledIntelSources.length} feeds)`,
      );
    } else if (fallbackIntelFeeds.length < enabledIntelSources.length) {
      console.warn(
        `[News] Intel digest missing, using limited per-feed fallback (${fallbackIntelFeeds.length}/${enabledIntelSources.length} feeds)`,
      );
    }

    let intel: NewsItem[];
    try {
      const { fetchCategoryFeeds } = await getRssModule();
      intel = await fetchCategoryFeeds(fallbackIntelFeeds, {
        batchSize: this.perFeedFallbackBatchSize,
      });
    } catch (e) {
      delete this.ctx.newsByCategory['intel'];
      console.error('[App] Intel feed failed:', e);
      return [];
    }

    checkBatchForBreakingAlerts(intel);
    this.renderNewsForCategory('intel', intel);
    if (intelPanel && options.recordBaselineSample) {
      try {
        const baseline = await updateBaseline('news:intel', intel.length);
        const deviation = calculateDeviation(intel.length, baseline);
        intelPanel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
      } catch (e) {
        console.warn('[Baseline] news:intel write failed:', e);
      }
    }
    this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: intel.length });
    this.flashMapForNews(intel);
    return intel;
  }

  /**
   * Panel-driven, not variant-driven: the active variant's preset categories
   * PLUS any extra categories required by enabled news panels the user added
   * beyond the preset (e.g. Tech panels customized into `full`). Custom
   * categories aren't in the per-variant server digest, so they're flagged
   * `isCustom` and fetched directly client-side in loadNewsCategory().
   */
  private resolveEnabledNewsCategories(): ResolvedCategory[] {
    return resolveNewsCategories(
      FEEDS,
      CANONICAL_FEEDS,
      enabledNewsCategoryKeys(this.ctx.newsCategoryPanelKeys, this.ctx.panelSettings),
    );
  }

  /**
   * Whether loadAllData() should (re)run the news load.
   *
   * Unlike every other hydration task, the news load is NOT viewport-gated — it
   * always loaded everything — so an unconditional `news` task meant each of
   * loadAllData()'s many triggers re-fetched the digest. Boot alone fires two
   * (panel-layout's hydration trigger, then App.ts's bootstrap fan-out) and the
   * drain loop turns overlapping calls into a second full run: two
   * `list-feed-digest` requests per page load, plus a second round of per-feed
   * fetches (#5376).
   *
   * The category set is what the load actually keys on, so re-run when it has
   * changed (tab switch, mission preset, panel toggle) and skip when it has not
   * (viewport entry, scroll, playback exit). Periodic refresh stays owned by
   * RefreshScheduler's `news` loop at REFRESH_INTERVALS.feeds, which calls
   * loadNews() directly and is unaffected by this gate.
   */
  shouldHydrateNews(forceAll: boolean): boolean {
    if (forceAll || this.loadedNewsSignature === null) return true;
    const current = newsWorkListSignature(
      this.resolveEnabledNewsCategories(),
      this.ctx.disabledSources,
    );
    return current !== this.loadedNewsSignature;
  }

  /**
   * Drop the record of what the last news load covered, so the next
   * loadAllData() reloads news even though the category set is unchanged.
   *
   * Callers are the paths that take the rendered headlines away without
   * changing the work-list — playback replay puts every news panel back into a
   * loading state and relies on the exit calling loadAllData() to refill them.
   */
  invalidateNewsHydration(): void {
    this.loadedNewsSignature = null;
  }

  async loadNews(): Promise<void> {
    // Reset happy variant accumulator for fresh pipeline run
    if (SITE_VARIANT === 'happy') {
      this.ctx.happyAllItems = [];
    }

    // Fire digest fetch early, but do not let a slow digest stall the category
    // first paint. Fast digests still take the optimized digest-backed path.
    const digestPromise = this.tryFetchDigest().catch((error) => {
      console.warn('[News] Digest fetch failed before category load:', error);
      return null;
    });
    const fallbackKey = this.digestCacheKey();
    const fallbackDigest =
      this.getRetainedDigest(fallbackKey) ?? (await this.loadPersistedDigest(fallbackKey));

    const categories = this.resolveEnabledNewsCategories();
    // Snapshot beside the categories: `ctx.disabledSources` is mutated IN PLACE by
    // the settings source toggle, so reading it after the await would record the
    // post-toggle set for a load that used the pre-toggle one.
    const disabledAtLoadStart = new Set(this.ctx.disabledSources);

    const maxCategoryConcurrency = SITE_VARIANT === 'tech' ? 4 : 5;
    const categoryConcurrency = Math.max(1, Math.min(maxCategoryConcurrency, categories.length));
    const newsPass = await runNewsLoadPass({
      categories,
      categoryConcurrency,
      digestPromise,
      fallbackDigest,
      digestGraceMs: this.digestFirstPaintGraceMs,
      allowPendingPerFeedFallback: this.isPerFeedFallbackEnabled(),
      hasDigestCategory: (digest, key) => Boolean(digest.categories && key in digest.categories),
      loadCategory: ({ key, feeds, isCustom }, digest, options) =>
        this.loadNewsCategory(key, feeds, digest, isCustom, options),
      loadIntel:
        SITE_VARIANT === 'full'
          ? (digest, allowDigestPendingFallback, options) =>
              this.loadIntelNews(digest, allowDigestPendingFallback, options)
          : undefined,
      onCategoryError: (key, reason) => {
        console.error(`[App] News category ${key ?? 'unknown'} failed:`, reason);
      },
      onDigestRefreshError: (key, reason) => {
        console.error(`[App] Digest refresh for news category ${key ?? 'unknown'} failed:`, reason);
      },
    });
    const { categoryItemsByKey, intelItems } = newsPass;

    const collectedNews: NewsItem[] = [];
    for (const { key } of categories) {
      const items = categoryItemsByKey.get(key) ?? [];
      // Tag items with content categories for happy variant
      if (SITE_VARIANT === 'happy') {
        for (const item of items) {
          item.happyCategory = classifyNewsItem(item.source, item.title);
        }
        // Accumulate curated items for the positive news pipeline
        this.ctx.happyAllItems = this.ctx.happyAllItems.concat(items);
      }
      collectedNews.push(...items);
    }

    if (SITE_VARIANT === 'full') {
      collectedNews.push(...intelItems);
    }

    this.ctx.allNews = collectedNews;
    setAllNews(collectedNews);
    // Record what this run covered — but only when it actually landed something for
    // the gate to protect. A run counts as landed when the digest COVERED at least
    // one preset category (authoritative even where that bucket came back empty),
    // when items arrived by any path, or when there are no categories to retry.
    //
    // A digest outage lands none of those, and it has two shapes. The obvious one
    // is a failed request. The one that bites is a 200 carrying an empty or partial
    // `categories` map — non-null, so a plain null check would call it landed. Both
    // render every preset category empty on web (`newsPerFeedFallback` is off), and
    // recording either would make the gate treat an empty dashboard as "already
    // loaded" and suppress every retry until RefreshScheduler's 20-minute tick.
    // Leaving the signature unset keeps the next trigger a real retry — the recovery
    // the pre-gate double-load provided by accident, now deliberate.
    //
    // Coverage is measured over PRESET categories only: a custom category succeeds
    // on its own direct-fetch path, so counting it would let one customized panel
    // mask an outage for every other category in the work-list.
    //
    // Set here rather than in a `finally` so a load that threw on the way in stays
    // retryable too, and before the post-load intelligence tail so a failure there
    // doesn't force a re-fetch of news that already arrived. The disabled-source set
    // is the one snapshotted at load start, so a source toggled mid-load compares
    // unequal on the next trigger instead of being swallowed.
    const digestCategories = newsPass.finalDigest?.categories ?? {};
    const digestCovered = categories.some(
      ({ key, isCustom }) => !isCustom && key in digestCategories,
    );
    const anyItemsCollected = collectedNews.length > 0;
    const noCategoriesToLoad = categories.length === 0;
    const landed = digestCovered || anyItemsCollected || noCategoriesToLoad;
    if (landed) this.loadedNewsSignature = newsWorkListSignature(categories, disabledAtLoadStart);
    this.ctx.initialLoadComplete = true;
    mountCommunityWidget();

    this.ctx.map?.updateHotspotActivity(this.ctx.allNews);

    this.updateMonitorResults();

    try {
      this.ctx.latestClusters = mlWorker.isAvailable
        ? await clusterNewsHybrid(this.ctx.allNews)
        : await analysisWorker.clusterNews(this.ctx.allNews);

      setInsightsClusters(this.ctx.latestClusters);
      setGeoHubActivities(getTopActiveGeoHubs(this.ctx.latestClusters));
      this.applyTechHubActivities();

      const geoLocated = this.ctx.latestClusters
        .filter((c): c is typeof c & { lat: number; lon: number } => c.lat != null && c.lon != null)
        .map((c) => ({
          lat: c.lat,
          lon: c.lon,
          title: c.primaryTitle,
          threatLevel: c.threat?.level ?? 'info',
          timestamp: c.lastUpdated,
        }));
      if (geoLocated.length > 0) {
        this.ctx.map?.setNewsLocations(geoLocated);
      }
    } catch (error) {
      console.error('[App] Clustering failed, clusters unchanged:', error);
      setInsightsClusters([]);
    }

    // Happy variant: run multi-stage positive news pipeline + map layers
    if (SITE_VARIANT === 'happy') {
      await this.callbacks.loadHappySupplementaryAndRender();
      await Promise.allSettled([
        this.ctx.mapLayers.positiveEvents ? this.callbacks.loadPositiveEvents() : Promise.resolve(),
        this.ctx.mapLayers.kindness
          ? Promise.resolve(this.callbacks.loadKindnessData())
          : Promise.resolve(),
      ]);
    }
  }

  updateMonitorResults(): void {
    setMonitorNews(this.ctx.allNews);
  }

  applyTechHubActivities(): void {
    const clusters = this.ctx.latestClusters;
    void import('@/services/tech-activity')
      .then(({ getTopActiveHubs }) => setTechHubActivities(getTopActiveHubs(clusters)))
      .catch(() => {
        /* non-critical */
      });
  }

  destroy(): void {
    this.applyTimeRangeFilterToNewsPanelsDebounced.cancel();
  }
}
