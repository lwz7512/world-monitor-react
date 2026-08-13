import type { AppContext } from '@/app/app-context';
import { withTimeout } from '@/utils/with-timeout';
import { getCircuitBreakerCooldownInfo } from '@/utils';
import { isFeatureAvailable } from '@/services/runtime-config';
import { COMMODITIES, MARKET_SYMBOLS, SITE_VARIANT } from '@/config';
import {
  fetchPredictions,
  fetchPizzIntStatus,
  fetchGdeltTensions,
  fetchRecentAwards,
} from '@/services';
import { getMarketWatchlistEntries } from '@/services/market-watchlist';
import {
  fetchStockAnalysesForTargets,
  getStockAnalysisTargets,
  type StockAnalysisResult,
} from '@/services/stock-analysis';
import { fetchInsiderTransactions } from '@/services/insider-transactions';
import {
  fetchStockBacktestsForTargets,
  fetchStoredStockBacktests,
  getMissingOrStaleStoredStockBacktests,
  hasFreshStoredStockBacktests,
  type StockBacktestResult,
} from '@/services/stock-backtest';
import {
  fetchStockAnalysisHistory,
  getMissingOrStaleStockAnalysisSymbols,
  hasFreshStockAnalysisHistory,
  getLatestStockAnalysisSnapshots,
  mergeStockAnalysisHistory,
  type StockAnalysisHistory,
} from '@/services/stock-analysis-history';
import type { MarketData } from '@/types';
import type {
  GetSectorSummaryResponse,
  ListMarketQuotesResponse,
  ListCommodityQuotesResponse,
} from '@/generated/client/worldmonitor/market/v1/service_client';
import type { ChinaCorporateDisclosureSnapshot } from '@/components/market-disclosures';
import {
  setMarketsData,
  setMarketsDisclosures,
  setMarketsRetrying,
  setMarketsConfigError,
} from '@/services/market-panel-store';
import {
  setStockAnalysisItems,
  setStockAnalysisInsider,
  setStockAnalysisState,
} from '@/services/stock-analysis-store';
import { setStockBacktestItems, setStockBacktestState } from '@/services/stock-backtest-store';
import {
  setSupplyChainShipping,
  setSupplyChainChokepoints,
  setSupplyChainMinerals,
  setSupplyChainStress,
} from '@/services/supply-chain-data-store';
import {
  setEconomicFredData,
  setEconomicFredLoading,
  setEconomicFredError,
  setEconomicFredRetrying,
  setEconomicBis,
  setEconomicBls,
  setEconomicSpending,
  setEconomicStress,
} from '@/services/economic-panel-store';
import {
  registerGlobalProcurementHandler,
  setGlobalProcurementLoading,
  updateGlobalProcurement,
  clearGlobalProcurement,
  showGlobalProcurementUnavailable,
} from '@/services/global-procurement-store';
import type { GlobalTenderFilters } from '@/services/global-tenders';
import {
  setEnergyAnalytics,
  setEnergyTape,
  setEnergyCrudeWeeks,
  setEnergyNatGas,
  setEnergyEuGas,
  setEnergyOilStocks,
  setEnergyLngVulnerability,
  setEnergyRetrying,
} from '@/services/energy-complex-store';
import {
  setTradePolicyRestrictions,
  setTradePolicyTariffs,
  setTradePolicyFlows,
  setTradePolicyBarriers,
  setTradePolicyRevenue,
  setTradePolicyComtrade,
} from '@/services/trade-policy-store';
import {
  setDailyBriefData,
  setDailyBriefLoading,
  setDailyBriefError,
  setDailyBriefUnavailable,
} from '@/services/daily-market-brief-store';
import { setForecastData, setForecastSimulation } from '@/services/forecast-panel-store';
import {
  getActiveFrameworkForPanel,
  subscribeFrameworkChange,
} from '@/services/analysis-framework-store';
import type {
  RegimeMacroContext,
  YieldCurveContext,
  SectorBriefContext,
} from '@/services/daily-market-brief';
import { fetchMarketImplications } from '@/services/market-implications';
import { setMarketImplicationsData } from '@/services/market-implications-store';
import { hasPremiumAccess } from '@/services/panel-gating';
import { t } from '@/services/i18n';
import { dataFreshness } from '@/services/data-freshness';
import { getHydratedData } from '@/services/bootstrap';
import { getRpcBaseUrl } from '@/services/rpc-client';

type DailyMarketBriefModule = typeof import('@/services/daily-market-brief');

let dailyMarketBriefModulePromise: Promise<DailyMarketBriefModule> | null = null;

function getDailyMarketBriefModule(): Promise<DailyMarketBriefModule> {
  dailyMarketBriefModulePromise ??= import('@/services/daily-market-brief').catch((err) => {
    dailyMarketBriefModulePromise = null;
    throw err;
  });
  return dailyMarketBriefModulePromise;
}

export interface MarketsLoaderCallbacks {
  runCorrelationAnalysis: () => Promise<void>;
}

export class MarketsLoader {
  private ctx: AppContext;
  private callbacks: MarketsLoaderCallbacks;

  private boundMarketWatchlistHandler: (() => void) | null = null;
  private dailyBriefGeneration = 0;
  private _stockAnalysisGeneration = 0;
  private globalTenderGeneration = 0;
  private globalTenderFilters: GlobalTenderFilters = {};
  private dailyBriefFrameworkUnsubscribe: (() => void) | null = null;
  private marketImplicationsFrameworkUnsubscribe: (() => void) | null = null;

  constructor(ctx: AppContext, callbacks: MarketsLoaderCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
  }

  init(): void {
    this.boundMarketWatchlistHandler = () => {
      void this.loadMarkets().then(async () => {
        if (hasPremiumAccess()) {
          await this.loadStockAnalysis();
          await this.loadStockBacktest();
          await this.loadDailyMarketBrief(true);
        }
      });
    };
    window.addEventListener(
      'wm-market-watchlist-changed',
      this.boundMarketWatchlistHandler as EventListener,
    );

    this.dailyBriefFrameworkUnsubscribe = subscribeFrameworkChange('daily-market-brief', () => {
      void this.loadDailyMarketBrief(true);
    });
    this.marketImplicationsFrameworkUnsubscribe = subscribeFrameworkChange(
      'market-implications',
      () => {
        void this.loadMarketImplications();
      },
    );
  }

  destroy(): void {
    if (this.boundMarketWatchlistHandler) {
      window.removeEventListener(
        'wm-market-watchlist-changed',
        this.boundMarketWatchlistHandler as EventListener,
      );
      this.boundMarketWatchlistHandler = null;
    }
    this.dailyBriefFrameworkUnsubscribe?.();
    this.dailyBriefFrameworkUnsubscribe = null;
    this.marketImplicationsFrameworkUnsubscribe?.();
    this.marketImplicationsFrameworkUnsubscribe = null;
  }

  async loadStockAnalysis(): Promise<void> {
    // Bump generation so any in-flight insider fetch from a prior invocation
    // of loadStockAnalysis no-ops instead of pushing stale data.
    const generation = ++this._stockAnalysisGeneration;

    try {
      const targets = getStockAnalysisTargets();
      const targetSymbols = targets.map((target) => target.symbol);
      const storedHistory = await fetchStockAnalysisHistory(targets.length);
      const cachedSnapshots = getLatestStockAnalysisSnapshots(storedHistory, targets.length);
      const historyIsFresh = hasFreshStockAnalysisHistory(storedHistory, targetSymbols);

      if (cachedSnapshots.length > 0) {
        setStockAnalysisItems(cachedSnapshots, storedHistory, 'cached');
      }

      if (historyIsFresh) {
        if (cachedSnapshots.length > 0) {
          void this.loadInsiderDataForPanel(
            targetSymbols,
            cachedSnapshots,
            storedHistory,
            'cached',
            generation,
          ).catch((error) => console.error('[StockAnalysis] insider fetch failed:', error));
        }
        return;
      }

      const staleSymbols = getMissingOrStaleStockAnalysisSymbols(storedHistory, targetSymbols);
      const staleTargets = targets.filter((target) => staleSymbols.includes(target.symbol));
      const results = await fetchStockAnalysesForTargets(staleTargets);
      if (results.length === 0) {
        if (cachedSnapshots.length === 0) {
          setStockAnalysisState(
            'retrying',
            'Stock analysis is waiting for eligible watchlist symbols.',
          );
          return;
        }
        void this.loadInsiderDataForPanel(
          targetSymbols,
          cachedSnapshots,
          storedHistory,
          'cached',
          generation,
        ).catch((error) => console.error('[StockAnalysis] insider fetch failed:', error));
        return;
      }
      const nextHistory = mergeStockAnalysisHistory(storedHistory, results);
      const resultBySymbol = new Map(results.map((r) => [r.symbol, r]));
      const combined: StockAnalysisResult[] = [];
      for (const target of targets) {
        const live = resultBySymbol.get(target.symbol);
        if (live) {
          combined.push(live);
          continue;
        }
        const cached = storedHistory[target.symbol]?.[0];
        if (cached?.available) combined.push(cached);
      }
      const snapshotsToRender = combined.length > 0 ? combined : results;
      setStockAnalysisItems(snapshotsToRender, nextHistory, 'live');
      void this.loadInsiderDataForPanel(
        targetSymbols,
        snapshotsToRender,
        nextHistory,
        'live',
        generation,
      ).catch((error) => console.error('[StockAnalysis] insider fetch failed:', error));
    } catch (error) {
      console.error('[StockAnalysis] failed:', error);
      const cachedHistory = await fetchStockAnalysisHistory().catch(() => ({}));
      const cachedSnapshots = getLatestStockAnalysisSnapshots(cachedHistory);
      if (cachedSnapshots.length > 0) {
        setStockAnalysisItems(cachedSnapshots, cachedHistory, 'cached');
        return;
      }
      setStockAnalysisState('error', 'Premium stock analysis is temporarily unavailable.');
    }
  }

  private async loadInsiderDataForPanel(
    symbols: string[],
    snapshotsToReRender: StockAnalysisResult[],
    historyForReRender: StockAnalysisHistory,
    source: 'live' | 'cached',
    generation: number,
  ): Promise<void> {
    const results = await Promise.allSettled(symbols.map((s) => fetchInsiderTransactions(s)));
    if (generation !== this._stockAnalysisGeneration) return;
    for (let i = 0; i < symbols.length; i++) {
      const r = results[i];
      if (r && r.status === 'fulfilled') {
        setStockAnalysisInsider(symbols[i]!, r.value);
      } else {
        setStockAnalysisInsider(symbols[i]!, {
          unavailable: true,
          symbol: symbols[i]!,
          totalBuys: 0,
          totalSells: 0,
          netValue: 0,
          transactions: [],
          fetchedAt: '',
        });
      }
    }
    // Re-render with the same items + history so the insider section fills in.
    if (generation !== this._stockAnalysisGeneration) return;
    setStockAnalysisItems(snapshotsToReRender, historyForReRender, source);
  }

  async loadStockBacktest(): Promise<void> {
    try {
      const targets = getStockAnalysisTargets();
      const targetSymbols = targets.map((target) => target.symbol);
      const stored = await fetchStoredStockBacktests(targets.length);
      if (stored.length > 0) {
        setStockBacktestItems(stored, 'cached');
      }
      if (hasFreshStoredStockBacktests(stored, targetSymbols)) {
        return;
      }

      const staleSymbols = getMissingOrStaleStoredStockBacktests(stored, targetSymbols);
      const staleTargets = targets.filter((target) => staleSymbols.includes(target.symbol));
      const results = await fetchStockBacktestsForTargets(staleTargets);
      if (results.length === 0) {
        if (stored.length === 0) {
          setStockBacktestState(
            'retrying',
            'Backtesting is waiting for eligible watchlist symbols.',
          );
        }
        return;
      }
      // Build a combined view so a partial refetch does not shrink the panel:
      // keep still-fresh cached backtests for symbols we did NOT refetch, swap
      // in live results for the ones we did. Watchlist order is preserved.
      const resultBySymbol = new Map(results.map((r) => [r.symbol, r]));
      const storedBySymbol = new Map(stored.map((s) => [s.symbol, s]));
      const combined: StockBacktestResult[] = [];
      for (const target of targets) {
        const live = resultBySymbol.get(target.symbol);
        if (live) {
          combined.push(live);
          continue;
        }
        const cached = storedBySymbol.get(target.symbol);
        if (cached) combined.push(cached);
      }
      setStockBacktestItems(combined.length > 0 ? combined : results);
    } catch (error) {
      console.error('[StockBacktest] failed:', error);
      const stored = await fetchStoredStockBacktests().catch(() => []);
      if (stored.length > 0) {
        setStockBacktestItems(stored, 'cached');
        return;
      }
      setStockBacktestState('error', 'Premium stock backtesting is temporarily unavailable.');
    }
  }

  async loadMarkets(): Promise<void> {
    // Method-scoped so all of loadMarkets' try blocks (stocks/sectors/commodities +
    // crypto/defi/ai/other) see these; market is dynamic-imported off eager main.js (#4571).
    // Guarded: loadMarkets must not reject (the init() watchlist handler calls it
    // unguarded), so a chunk-load failure skips this cycle like the per-block catches do.
    let marketMod: typeof import('@/services/market');
    try {
      marketMod = await import('@/services/market');
    } catch (e) {
      // Persistent failure mode: a stale-deploy chunk 404 would otherwise skip the
      // whole markets/crypto/commodities cycle with no signal. Log so it's traceable,
      // and mirror the downstream failure states before returning.
      console.warn('[DataLoader] market chunk load failed', e);
      this.ctx.statusPanel?.updateApi('Finnhub', { status: 'error' });
      this.ctx.statusPanel?.updateApi('CoinGecko', { status: 'error' });
      setMarketsRetrying(t('common.failedMarketData'));
      setEnergyRetrying(t('common.failedCommodities'));
      return;
    }
    const { fetchMultipleStocks, fetchCommodityQuotes, warmCommodityCache } = marketMod;
    try {
      const customEntries = getMarketWatchlistEntries();
      const effectiveSymbols = (() => {
        if (customEntries.length === 0) return MARKET_SYMBOLS;
        const base = MARKET_SYMBOLS.slice();
        const seen = new Set(base.map((s) => s.symbol));
        for (const entry of customEntries) {
          const sym = entry.symbol;
          if (!sym || seen.has(sym)) continue;
          seen.add(sym);
          base.push({ symbol: sym, name: entry.name || sym, display: entry.display || sym });
          if (base.length >= 50) break;
        }
        return base;
      })();

      // Hydrate markets from bootstrap (same pattern as sectors) — instant data on page load
      const hydratedMarkets = getHydratedData('marketQuotes') as
        ListMarketQuotesResponse | undefined;
      let stocksResult: Awaited<ReturnType<typeof fetchMultipleStocks>>;
      const hydratedDisclosures = getHydratedData('chinaCorporateDisclosures') as
        ChinaCorporateDisclosureSnapshot | undefined;
      if (hydratedDisclosures !== undefined) {
        setMarketsDisclosures(hydratedDisclosures);
      }

      if (customEntries.length === 0 && hydratedMarkets?.quotes?.length) {
        const symbolMetaMap = new Map(effectiveSymbols.map((s) => [s.symbol, s]));
        const data = hydratedMarkets.quotes.map((q) => ({
          symbol: q.symbol,
          name: symbolMetaMap.get(q.symbol)?.name || q.name,
          display: symbolMetaMap.get(q.symbol)?.display || q.display || q.symbol,
          price: q.price != null ? q.price : null,
          change: q.change ?? null,
          sparkline: q.sparkline?.length > 0 ? q.sparkline : undefined,
        }));
        this.ctx.latestMarkets = data;
        setMarketsData(data);
        stocksResult = {
          data,
          skipped: hydratedMarkets.finnhubSkipped || undefined,
          rateLimited: hydratedMarkets.rateLimited || undefined,
        };
      } else {
        stocksResult = await fetchMultipleStocks(effectiveSymbols, {
          onBatch: (partialStocks) => {
            this.ctx.latestMarkets = partialStocks;
            setMarketsData(partialStocks);
          },
        });
        this.ctx.latestMarkets = stocksResult.data;
        setMarketsData(stocksResult.data, stocksResult.rateLimited);
      }

      const finnhubConfigMsg = 'FINNHUB_API_KEY not configured — add in Settings';

      if (stocksResult.rateLimited && stocksResult.data.length === 0) {
        // CommoditiesPanel is self-fetching; no push needed.
      } else if (stocksResult.skipped) {
        this.ctx.statusPanel?.updateApi('Finnhub', { status: 'error' });
        if (stocksResult.data.length === 0) {
          setMarketsConfigError(finnhubConfigMsg);
        }
      } else {
        this.ctx.statusPanel?.updateApi('Finnhub', { status: 'ok' });
      }

      const energySymbols = new Set(['CL=F', 'BZ=F', 'NG=F']);
      const filterEnergyTape = (data: MarketData[]) =>
        data.filter((item) => energySymbols.has(item.symbol));
      const hydratedCommodities = getHydratedData('commodityQuotes') as
        ListCommodityQuotesResponse | undefined;
      const skipFetch = stocksResult.rateLimited && stocksResult.data.length === 0;
      let energyLoaded = skipFetch;

      if (!energyLoaded && hydratedCommodities?.quotes?.length) {
        warmCommodityCache(hydratedCommodities);
        const symbolMetaMap = new Map(COMMODITIES.map((s) => [s.symbol, s]));
        const data = hydratedCommodities.quotes.map((q) => ({
          symbol: q.symbol,
          name: symbolMetaMap.get(q.symbol)?.name || q.name,
          display: symbolMetaMap.get(q.symbol)?.display || q.display || q.symbol,
          price: q.price != null ? q.price : null,
          change: q.change ?? null,
          sparkline: q.sparkline?.length > 0 ? q.sparkline : undefined,
        }));
        const energyMapped = filterEnergyTape(data);
        if (energyMapped.some((d) => d.price !== null)) {
          setEnergyTape(energyMapped);
          energyLoaded = true;
        }
      }

      if (!energyLoaded) {
        const commoditiesResult = await fetchCommodityQuotes(COMMODITIES, {
          onBatch: (partial) => {
            setEnergyTape(filterEnergyTape(partial));
          },
        });
        const energyMapped = filterEnergyTape(commoditiesResult.data);
        if (energyMapped.some((d) => d.price !== null)) {
          setEnergyTape(energyMapped);
          energyLoaded = true;
        }
      }
      if (!energyLoaded) setEnergyTape([]);
    } catch {
      this.ctx.statusPanel?.updateApi('Finnhub', { status: 'error' });
    }
  }

  async loadDailyMarketBrief(force = false): Promise<void> {
    if (!hasPremiumAccess()) return;
    if (this.ctx.isDestroyed || this.ctx.inFlight.has('dailyMarketBrief')) return;

    this.dailyBriefGeneration++;
    const gen = this.dailyBriefGeneration;
    this.ctx.inFlight.add('dailyMarketBrief');
    let dailyMarketBrief: DailyMarketBriefModule | null = null;
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      dailyMarketBrief = await getDailyMarketBriefModule();
      // Bound the IndexedDB cache read so a hung persistent-cache layer
      // can't keep the panel on its default Loading state forever — fall
      // through to "build from scratch" instead.
      const cached = await withTimeout(
        dailyMarketBrief.getCachedDailyMarketBrief(timezone),
        3_000,
        'daily-brief-cache-read',
      ).catch(() => null);

      if (cached?.available) {
        setDailyBriefData(cached, 'cached');
      }

      if (!force && cached && !dailyMarketBrief.shouldRefreshDailyBrief(cached, timezone)) {
        return;
      }

      if (!cached) {
        setDailyBriefLoading('Building daily market brief...');
      }

      // Each context collector calls a generated RPC client without its
      // own timeout (`getFearGreedIndex`, `getFredSeriesBatch`); the
      // `try { ... } catch` inside each collector only handles rejections
      // — a hung RPC sits forever and `Promise.allSettled` waits with it.
      // That's the same hang-class this PR was opened to fix; an earlier
      // commit missed these three call sites because they were two layers
      // up from the `summaryProvider` await I was hunting. 8s per
      // collector is generous for an RPC and leaves >36s of the outer
      // 60s budget for the actual LLM call.
      // `_collectSectorContext` is sync (reads only hydrated data) so it
      // needs no wrapping; allSettled accepts non-promises directly.
      const [r0, r1, r2, r3] = await Promise.allSettled([
        withTimeout(this._collectRegimeContext(), 8_000, 'daily-brief-regime-context'),
        withTimeout(this._collectYieldCurveContext(), 8_000, 'daily-brief-yield-context'),
        this._collectSectorContext(),
        withTimeout(this._collectEarningsContext(), 8_000, 'daily-brief-earnings-context'),
      ]);
      const regimeContext = r0.status === 'fulfilled' ? r0.value : undefined;
      const yieldCurveContext = r1.status === 'fulfilled' ? r1.value : undefined;
      const sectorContext = r2.status === 'fulfilled' ? r2.value : undefined;
      const earningsContext = r3.status === 'fulfilled' ? r3.value : undefined;

      // Wall-clock budget on the whole build. The inner summarizer has its
      // own 45s cap (SUMMARIZER_TIMEOUT_MS in daily-market-brief.ts) and
      // falls back to rules-based output, so this outer 60s budget only
      // fires if the rules-based path itself hangs (shouldn't, but defensive
      // — covers e.g. a getDefaultSummarizer() dynamic-import that never
      // resolves). On timeout the existing catch below serves the cached
      // version or shows an error, never letting the panel stay stuck.
      const brief = await withTimeout(
        dailyMarketBrief.buildDailyMarketBrief({
          markets: this.ctx.latestMarkets,
          newsByCategory: this.ctx.newsByCategory,
          timezone,
          regimeContext,
          yieldCurveContext,
          sectorContext,
          earningsContext,
          frameworkAppend: getActiveFrameworkForPanel('daily-market-brief')?.systemPromptAppend,
          newsCategories:
            SITE_VARIANT === 'commodity'
              ? ['commodity-news', 'gold-silver', 'mining-news', 'energy', 'critical-minerals']
              : SITE_VARIANT === 'energy'
                ? ['live-news', 'energy', 'supply-chain']
                : undefined,
        }),
        60_000,
        'daily-brief-total-build',
      );

      if (this.dailyBriefGeneration !== gen) return;

      if (!brief.available) {
        if (!cached?.available) {
          setDailyBriefUnavailable();
        }
        return;
      }

      // Render first, persist after. The previous order `await
      // dailyMarketBrief.cacheDailyMarketBrief(brief); render(brief)` meant a hung
      // IndexedDB / Tauri-Store write blocked the panel from ever
      // displaying the finished brief — the build budget proved nothing
      // by itself. Now: user sees the brief immediately; the cache write
      // runs fire-and-forget with its own 5s budget so a hung backend
      // becomes "no warmup for tomorrow's load" instead of "panel stuck
      // on Building forever."
      setDailyBriefData(brief, 'live');
      void withTimeout(
        dailyMarketBrief.cacheDailyMarketBrief(brief),
        5_000,
        'daily-brief-cache-write',
      ).catch((err) => {
        console.warn('[DailyBrief] cache write failed or timed out:', (err as Error).message);
      });
    } catch (error) {
      console.warn('[DailyBrief] Failed to build daily market brief:', error);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      // Same 3s cap as the upfront cache read above — covers the
      // "build hung AND IndexedDB also degraded" double-failure mode
      // (Greptile #3718 P2): without this guard the recovery path can
      // itself hang, leaving the panel stuck on whatever the previous
      // state was. .catch(() => null) absorbs both the TimeoutError and
      // any persistent-cache read failure into the same null-result
      // branch that the existing showError fallback already handles.
      const cached = dailyMarketBrief
        ? await withTimeout(
            dailyMarketBrief.getCachedDailyMarketBrief(timezone),
            3_000,
            'daily-brief-cache-read-recovery',
          ).catch(() => null)
        : null;
      if (cached?.available) {
        setDailyBriefData(cached, 'cached');
        return;
      }
      setDailyBriefError('Failed to build daily market brief. Retrying later.');
    } finally {
      this.ctx.inFlight.delete('dailyMarketBrief');
    }
  }

  private async _collectRegimeContext(): Promise<RegimeMacroContext | undefined> {
    try {
      const hydrated = getHydratedData('fearGreedIndex') as Record<string, unknown> | undefined;
      if (hydrated && !hydrated.unavailable && Number(hydrated.compositeScore) > 0) {
        const comp = hydrated.composite as Record<string, unknown> | undefined;
        const cats = (hydrated.categories ?? {}) as Record<string, Record<string, unknown>>;
        const hdr = (hydrated.headerMetrics ?? {}) as Record<
          string,
          Record<string, unknown> | null
        >;
        return {
          compositeScore: Number(comp?.score ?? hydrated.compositeScore ?? 0),
          compositeLabel: String(comp?.label ?? hydrated.compositeLabel ?? ''),
          fsiValue: Number(hdr?.fsi?.value ?? 0),
          fsiLabel: String(hdr?.fsi?.label ?? ''),
          vix: Number(hdr?.vix?.value ?? 0),
          hySpread: Number(hdr?.hySpread?.value ?? 0),
          cnnFearGreed: Number(hdr?.cnnFearGreed?.value ?? 0),
          cnnLabel: String(hdr?.cnnFearGreed?.label ?? ''),
          momentum: cats.momentum ? { score: Number(cats.momentum.score ?? 0) } : undefined,
          sentiment: cats.sentiment ? { score: Number(cats.sentiment.score ?? 0) } : undefined,
        };
      }
      const { MarketServiceClient } =
        await import('@/generated/client/worldmonitor/market/v1/service_client');
      const { getRpcBaseUrl: rpcBase } = await import('@/services/rpc-client');
      const client = new MarketServiceClient(rpcBase(), {
        fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
      });
      const resp = await client.getFearGreedIndex({});
      if (resp.unavailable || resp.compositeScore <= 0) return undefined;
      return {
        compositeScore: resp.compositeScore,
        compositeLabel: resp.compositeLabel,
        fsiValue: resp.fsiValue ?? 0,
        fsiLabel: resp.fsiLabel ?? '',
        vix: resp.vix ?? 0,
        hySpread: resp.hySpread ?? 0,
        cnnFearGreed: resp.cnnFearGreed ?? 0,
        cnnLabel: resp.cnnLabel ?? '',
        momentum: resp.momentum ? { score: resp.momentum.score } : undefined,
        sentiment: resp.sentiment ? { score: resp.sentiment.score } : undefined,
      };
    } catch {
      return undefined;
    }
  }

  private async _collectYieldCurveContext(): Promise<YieldCurveContext | undefined> {
    try {
      const { EconomicServiceClient } =
        await import('@/generated/client/worldmonitor/economic/v1/service_client');
      const { getRpcBaseUrl: rpcBase } = await import('@/services/rpc-client');
      const client = new EconomicServiceClient(rpcBase(), {
        fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
      });
      const resp = await client.getFredSeriesBatch({
        seriesIds: ['DGS2', 'DGS10', 'DGS30'],
        limit: 1,
      });
      const lastVal = (id: string): number => {
        const obs = resp.results[id]?.observations;
        if (!obs?.length) return 0;
        return obs[obs.length - 1]?.value ?? 0;
      };
      const rate2y = lastVal('DGS2');
      const rate10y = lastVal('DGS10');
      const rate30y = lastVal('DGS30');
      if (!rate10y) return undefined;
      const spread2s10s = rate2y > 0 ? Math.round((rate10y - rate2y) * 100) : 0;
      return { inverted: spread2s10s < 0, spread2s10s, rate2y, rate10y, rate30y };
    } catch {
      return undefined;
    }
  }

  private _collectSectorContext(): SectorBriefContext | undefined {
    try {
      const hydratedSectors = getHydratedData('sectors') as GetSectorSummaryResponse | undefined;
      const sectors = hydratedSectors?.sectors;
      if (!sectors?.length) return undefined;
      const sorted = [...sectors].sort((a, b) => b.change - a.change);
      const countPositive = sorted.filter((s) => s.change > 0).length;
      const top = sorted[0];
      const worst = sorted[sorted.length - 1];
      if (!top || !worst) return undefined;
      return {
        topName: top.name,
        topChange: top.change,
        worstName: worst.name,
        worstChange: worst.change,
        countPositive,
        total: sorted.length,
      };
    } catch {
      return undefined;
    }
  }

  /** #4922 (c): recent earnings surprises + upcoming density for the brief.
   * RPC-backed (earnings are not bootstrap-hydrated); failures degrade to
   * undefined — the brief simply omits the earnings block. */
  private async _collectEarningsContext(): Promise<
    import('@/services/daily-market-brief').EarningsBriefContext | undefined
  > {
    try {
      const { MarketServiceClient } =
        await import('@/generated/client/worldmonitor/market/v1/service_client');
      const { getRpcBaseUrl: rpcBase } = await import('@/services/rpc-client');
      const client = new MarketServiceClient(rpcBase(), {
        fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
      });
      const today = new Date();
      const past = new Date(today.getTime() - 7 * 86400_000);
      const future = new Date(today.getTime() + 14 * 86400_000);
      const resp = await client.listEarningsCalendar({
        fromDate: past.toISOString().slice(0, 10),
        toDate: future.toISOString().slice(0, 10),
      });
      const earnings = resp.earnings ?? [];
      if (resp.unavailable || earnings.length === 0) return undefined;
      const { buildEarningsBriefContext } = await import('@/services/daily-market-brief');
      return buildEarningsBriefContext(earnings, today.toISOString().slice(0, 10));
    } catch {
      return undefined;
    }
  }

  async loadMarketImplications(): Promise<void> {
    if (!hasPremiumAccess()) return;
    if (this.ctx.isDestroyed || this.ctx.inFlight.has('marketImplications')) return;
    this.ctx.inFlight.add('marketImplications');
    try {
      const data = await fetchMarketImplications(
        getActiveFrameworkForPanel('market-implications')?.id ?? '',
      );
      setMarketImplicationsData(data);
    } catch {
      setMarketImplicationsData(null);
    } finally {
      this.ctx.inFlight.delete('marketImplications');
    }
  }

  async loadPredictions(): Promise<void> {
    try {
      const predictions = await fetchPredictions({ region: this.ctx.resolvedLocation });
      this.ctx.latestPredictions = predictions;
      // PredictionPanel is self-fetching via usePanelData; no push needed.

      this.ctx.statusPanel?.updateFeed('Polymarket', {
        status: 'ok',
        itemCount: predictions.length,
      });
      this.ctx.statusPanel?.updateApi('Polymarket', { status: 'ok' });
      dataFreshness.recordUpdate('polymarket', predictions.length);
      dataFreshness.recordUpdate('predictions', predictions.length);

      void this.callbacks.runCorrelationAnalysis();
    } catch (error) {
      this.ctx.statusPanel?.updateFeed('Polymarket', {
        status: 'error',
        errorMessage: String(error),
      });
      this.ctx.statusPanel?.updateApi('Polymarket', { status: 'error' });
      dataFreshness.recordError('polymarket', String(error));
      dataFreshness.recordError('predictions', String(error));
    }
  }

  async loadForecasts(): Promise<void> {
    try {
      const hydrated = getHydratedData('forecasts') as
        | {
            predictions?: import('@/generated/client/worldmonitor/forecast/v1/service_client').Forecast[];
            generatedAt?: number;
          }
        | undefined;
      if (hydrated?.predictions?.length) {
        setForecastData(hydrated.predictions, {
          generatedAt: hydrated.generatedAt || 0,
          degraded: false,
          stale: false,
          error: '',
        });
        return;
      }
      const { fetchForecastFeed } = await import('@/services/forecast');
      const feed = await fetchForecastFeed();
      setForecastData(feed.forecasts, {
        generatedAt: feed.generatedAt,
        degraded: feed.degraded,
        stale: feed.stale,
        error: feed.error,
      });
    } catch {
      setForecastData([], {
        generatedAt: 0,
        degraded: false,
        stale: false,
        error: 'forecast_request_failed',
      });
    }
  }

  async loadSimulationOutcome(): Promise<void> {
    try {
      const { fetchSimulationOutcome } = await import('@/services/forecast');
      const json = await fetchSimulationOutcome();
      if (json) setForecastSimulation(json);
    } catch {
      /* silent fail — simulation data is supplementary */
    }
  }

  async loadFredData(): Promise<void> {
    const cbInfo = getCircuitBreakerCooldownInfo('FRED Batch');
    if (cbInfo.onCooldown) {
      setEconomicFredRetrying(cbInfo.remainingSeconds);
      this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
      return;
    }

    try {
      setEconomicFredLoading();
      const { fetchFredData } = await import('@/services/economic');
      const data = await fetchFredData();

      const postInfo = getCircuitBreakerCooldownInfo('FRED Batch');
      if (postInfo.onCooldown) {
        setEconomicFredRetrying(postInfo.remainingSeconds);
        this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
        return;
      }

      if (data.length === 0) {
        if (!isFeatureAvailable('economicFred')) {
          setEconomicFredError(t('components.economic.fredKeyMissing'));
          this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
          return;
        }
        setEconomicFredError(t('common.upstreamUnavailable'));
        this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
        return;
      }

      setEconomicFredData(data);
      this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
      dataFreshness.recordUpdate('economic', data.length);
    } catch {
      this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
      setEconomicFredError(t('common.failedToLoad'));
    }
  }

  async loadOilAnalytics(): Promise<void> {
    try {
      const {
        fetchOilAnalytics,
        fetchCrudeInventoriesRpc,
        fetchNatGasStorageRpc,
        getEuGasStorageData,
        getOilStocksAnalysisData,
        fetchLngVulnerability,
      } = await import('@/services/economic');
      const [data, crudeResp, natGasResp, euGasResp, oilStocksResp] = await Promise.allSettled([
        fetchOilAnalytics(),
        fetchCrudeInventoriesRpc(),
        fetchNatGasStorageRpc(),
        getEuGasStorageData(),
        getOilStocksAnalysisData(),
      ]);
      if (data.status === 'fulfilled') {
        setEnergyAnalytics(data.value);
        const hasData = !!(
          data.value.wtiPrice ||
          data.value.brentPrice ||
          data.value.usProduction ||
          data.value.usInventory
        );
        this.ctx.statusPanel?.updateApi('EIA', { status: hasData ? 'ok' : 'error' });
        if (hasData) {
          const metricCount = [
            data.value.wtiPrice,
            data.value.brentPrice,
            data.value.usProduction,
            data.value.usInventory,
          ].filter(Boolean).length;
          dataFreshness.recordUpdate('oil', metricCount || 1);
        } else {
          dataFreshness.recordError('oil', 'Oil analytics returned no values');
        }
      } else {
        console.error('[App] Oil analytics failed:', data.reason);
        this.ctx.statusPanel?.updateApi('EIA', { status: 'error' });
        dataFreshness.recordError('oil', String(data.reason));
      }
      if (crudeResp.status === 'fulfilled' && crudeResp.value.weeks.length > 0) {
        setEnergyCrudeWeeks(crudeResp.value.weeks);
      } else if (crudeResp.status === 'rejected') {
        console.warn('[App] Crude inventories fetch failed:', crudeResp.reason);
      }
      if (natGasResp.status === 'fulfilled' && natGasResp.value.weeks.length > 0) {
        setEnergyNatGas(natGasResp.value.weeks);
      }
      if (euGasResp.status === 'fulfilled') {
        setEnergyEuGas(euGasResp.value);
      }
      if (oilStocksResp.status === 'fulfilled') {
        setEnergyOilStocks(oilStocksResp.value);
      }
      // Fire-and-forget: LNG vulnerability is hydration-only today (no network fallback).
      // Decoupled so a future fetch path does not delay core energy panel rendering.
      fetchLngVulnerability()
        .then((lngData) => {
          setEnergyLngVulnerability(lngData);
        })
        .catch(() => {
          setEnergyLngVulnerability(null);
        });
    } catch (e) {
      console.error('[App] Oil analytics failed:', e);
      // EnergyComplexPanel subscribes to store channels; no push needed.
      this.ctx.statusPanel?.updateApi('EIA', { status: 'error' });
      dataFreshness.recordError('oil', String(e));
    }
  }

  async loadGovernmentSpending(): Promise<void> {
    try {
      const data = await fetchRecentAwards();
      setEconomicSpending(data);
      this.ctx.statusPanel?.updateApi('USASpending', {
        status: data.awards?.length > 0 ? 'ok' : 'error',
      });
      if (data.awards?.length > 0) {
        dataFreshness.recordUpdate('spending', data.awards.length);
      } else {
        dataFreshness.recordError('spending', 'No awards returned');
      }
    } catch (e) {
      console.error('[App] Government spending failed:', e);
      this.ctx.statusPanel?.updateApi('USASpending', { status: 'error' });
      dataFreshness.recordError('spending', String(e));
    }
  }

  async loadGlobalTenders(filters?: GlobalTenderFilters, append = false): Promise<void> {
    const requestGeneration = ++this.globalTenderGeneration;
    const requestFilters = filters ?? this.globalTenderFilters;
    this.globalTenderFilters = { ...requestFilters, cursor: '' };
    registerGlobalProcurementHandler((nextFilters, shouldAppend) => {
      void this.loadGlobalTenders(nextFilters, shouldAppend);
    });
    if (!hasPremiumAccess()) {
      clearGlobalProcurement();
      return;
    }
    setGlobalProcurementLoading(true);
    try {
      const { fetchGlobalTenders } = await import('@/services/global-tenders');
      const data = await fetchGlobalTenders(requestFilters);
      if (requestGeneration !== this.globalTenderGeneration) return;
      if (!hasPremiumAccess()) {
        clearGlobalProcurement();
        return;
      }
      updateGlobalProcurement(data, append);
      // GlobalProcurementPanel computes its own count from store data; no push needed.
      this.ctx.statusPanel?.updateApi('Global Procurement', {
        status: !data.dataAvailable
          ? 'error'
          : ['partial', 'stale'].includes(data.availability)
            ? 'warning'
            : 'ok',
      });
    } catch (error) {
      if (requestGeneration !== this.globalTenderGeneration || !hasPremiumAccess()) return;
      console.warn('[App] Global tenders failed:', error);
      showGlobalProcurementUnavailable();
      this.ctx.statusPanel?.updateApi('Global Procurement', { status: 'error' });
    }
  }

  async clearGlobalTenders(): Promise<void> {
    this.globalTenderGeneration += 1;
    this.globalTenderFilters = {};
    clearGlobalProcurement();
    const { clearGlobalTenderCache } = await import('@/services/global-tenders');
    clearGlobalTenderCache();
  }

  async loadBisData(): Promise<void> {
    try {
      const { fetchBisData } = await import('@/services/economic');
      const data = await fetchBisData();
      setEconomicBis(data);
      const hasData = data.policyRates?.length > 0;
      this.ctx.statusPanel?.updateApi('BIS', { status: hasData ? 'ok' : 'error' });
      if (hasData) {
        dataFreshness.recordUpdate('bis', data.policyRates?.length ?? 0);
      }
    } catch (e) {
      console.error('[App] BIS data failed:', e);
      this.ctx.statusPanel?.updateApi('BIS', { status: 'error' });
      dataFreshness.recordError('bis', String(e));
    }
  }

  async loadBlsData(): Promise<void> {
    try {
      const { fetchBlsData } = await import('@/services/economic');
      const data = await fetchBlsData();
      if (data.length > 0) {
        setEconomicBls(data);
        this.ctx.statusPanel?.updateApi('BLS-Series', { status: 'ok' });
        dataFreshness.recordUpdate('bls', data.length);
      } else {
        this.ctx.statusPanel?.updateApi('BLS-Series', { status: 'error' });
      }
    } catch (e) {
      console.error('[App] BLS data failed:', e);
      this.ctx.statusPanel?.updateApi('BLS-Series', { status: 'error' });
      dataFreshness.recordError('bls', String(e));
    }
  }

  async loadTradePolicy(): Promise<void> {
    // Trade-policy is PRO-gated. Short-circuit for anonymous/free users so
    // we don't fire 6 RPCs that all 401 on every page load — fixes the
    // console-noise + Sentry-noise bug from the 2026-04-22 trace.
    if (!hasPremiumAccess()) return;

    try {
      const {
        fetchTradeRestrictions,
        fetchTariffTrends,
        fetchTradeFlows,
        fetchTradeBarriers,
        fetchCustomsRevenue,
        fetchComtradeFlows,
      } = await import('@/services/trade');
      const [restrictions, tariffs, flows, barriers, revenue, comtrade] = await Promise.allSettled([
        fetchTradeRestrictions([], 50),
        fetchTariffTrends('840', '156', '', 10),
        fetchTradeFlows('840', '156', 10),
        fetchTradeBarriers([], '', 50),
        fetchCustomsRevenue(),
        fetchComtradeFlows(),
      ]);

      const r = restrictions.status === 'fulfilled' ? restrictions.value : null;
      const ta = tariffs.status === 'fulfilled' ? tariffs.value : null;
      const fl = flows.status === 'fulfilled' ? flows.value : null;
      const ba = barriers.status === 'fulfilled' ? barriers.value : null;
      const rev = revenue.status === 'fulfilled' ? revenue.value : null;
      const ct = comtrade.status === 'fulfilled' ? comtrade.value : null;

      if (r) setTradePolicyRestrictions(r);
      if (ta) setTradePolicyTariffs(ta);
      if (fl) setTradePolicyFlows(fl);
      if (ba) setTradePolicyBarriers(ba);
      if (rev) setTradePolicyRevenue(rev);
      if (ct) setTradePolicyComtrade(ct);

      const wtoItems =
        (r?.restrictions?.length ?? 0) +
        (ta?.datapoints?.length ?? 0) +
        (fl?.flows?.length ?? 0) +
        (ba?.barriers?.length ?? 0);
      const anyUnavailable =
        r?.upstreamUnavailable ||
        ta?.upstreamUnavailable ||
        fl?.upstreamUnavailable ||
        ba?.upstreamUnavailable;

      this.ctx.statusPanel?.updateApi('WTO', {
        status: anyUnavailable ? 'warning' : wtoItems > 0 ? 'ok' : 'error',
      });

      if (wtoItems > 0) {
        dataFreshness.recordUpdate('wto_trade', wtoItems);
      } else if (anyUnavailable) {
        dataFreshness.recordError('wto_trade', 'WTO upstream temporarily unavailable');
      }
      if (rev?.months?.length) {
        dataFreshness.recordUpdate('treasury_revenue', rev.months.length);
      }
    } catch (e) {
      console.error('[App] Trade policy failed:', e);
      // TradePolicyPanel subscribes to store channels; no push needed.
      this.ctx.statusPanel?.updateApi('WTO', { status: 'error' });
      dataFreshness.recordError('wto_trade', String(e));
    }
  }

  async loadSupplyChain(): Promise<void> {
    try {
      const {
        fetchShippingRates,
        fetchChokepointStatus,
        fetchCriticalMinerals,
        fetchShippingStress,
      } = await import('@/services/supply-chain');
      const [shipping, chokepoints, minerals, stress] = await Promise.allSettled([
        fetchShippingRates(),
        fetchChokepointStatus(),
        fetchCriticalMinerals(),
        fetchShippingStress(),
      ]);

      const shippingData = shipping.status === 'fulfilled' ? shipping.value : null;
      const chokepointData = chokepoints.status === 'fulfilled' ? chokepoints.value : null;
      const mineralsData = minerals.status === 'fulfilled' ? minerals.value : null;
      const stressData = stress.status === 'fulfilled' ? stress.value : null;

      if (shippingData) setSupplyChainShipping(shippingData);
      if (chokepointData) setSupplyChainChokepoints(chokepointData);
      if (chokepointData) this.ctx.map?.setChokepointData(chokepointData);
      if (mineralsData) setSupplyChainMinerals(mineralsData);
      if (stressData) setSupplyChainStress(stressData);

      const totalItems =
        (shippingData?.indices.length || 0) +
        (chokepointData?.chokepoints.length || 0) +
        (mineralsData?.minerals.length || 0);
      const anyUnavailable =
        shippingData?.upstreamUnavailable ||
        chokepointData?.upstreamUnavailable ||
        mineralsData?.upstreamUnavailable;

      this.ctx.statusPanel?.updateApi('SupplyChain', {
        status: anyUnavailable ? 'warning' : totalItems > 0 ? 'ok' : 'error',
      });

      if (totalItems > 0) {
        dataFreshness.recordUpdate('supply_chain', totalItems);
      } else if (anyUnavailable) {
        dataFreshness.recordError('supply_chain', 'Supply chain upstream temporarily unavailable');
      }
    } catch (e) {
      console.error('[App] Supply chain failed:', e);
      // SupplyChainPanel subscribes to store channels; no push needed.
      this.ctx.statusPanel?.updateApi('SupplyChain', { status: 'error' });
      dataFreshness.recordError('supply_chain', String(e));
    }
  }

  async loadChinaCorridors(): Promise<void> {
    // Panel is now self-fetching; data-loader no longer drives this fetch.
  }

  async loadChinaActivityNowcast(): Promise<void> {
    // Panel is now self-fetching via usePanelData; data-loader no longer drives this fetch.
  }

  async loadSocialVelocity(): Promise<void> {
    // Panel self-fetches via usePanelData — no push needed
  }

  async loadWsbTickers(): Promise<void> {
    // Panel self-fetches via usePanelData (bootstrap hydration + API fallback) — no push needed
  }

  async loadEconomicStress(): Promise<void> {
    try {
      const hydrated = getHydratedData('economicStress') as
        | import('@/generated/client/worldmonitor/economic/v1/service_client').GetEconomicStressResponse
        | undefined;
      if (hydrated && !hydrated.unavailable && Number.isFinite(hydrated.compositeScore)) {
        setEconomicStress(hydrated);
        return;
      }

      const { EconomicServiceClient } =
        await import('@/generated/client/worldmonitor/economic/v1/service_client');
      const client = new EconomicServiceClient(getRpcBaseUrl(), {
        fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
      });
      const resp = await client.getEconomicStress({});
      if (!resp.unavailable && Number.isFinite(resp.compositeScore)) {
        setEconomicStress(resp);
      }
    } catch (e) {
      console.error('[App] Economic stress load failed:', e);
    }
  }

  async loadPizzInt(): Promise<void> {
    try {
      const [status, tensions] = await Promise.all([fetchPizzIntStatus(), fetchGdeltTensions()]);

      if (status.locationsMonitored === 0) {
        this.ctx.pizzintIndicator?.hide();
        this.ctx.statusPanel?.updateApi('PizzINT', { status: 'error' });
        dataFreshness.recordError('pizzint', 'No monitored locations returned');
        return;
      }

      this.ctx.pizzintIndicator?.show();
      this.ctx.pizzintIndicator?.updateStatus(status);
      this.ctx.pizzintIndicator?.updateTensions(tensions);
      this.ctx.statusPanel?.updateApi('PizzINT', { status: 'ok' });
      dataFreshness.recordUpdate('pizzint', Math.max(status.locationsMonitored, tensions.length));
    } catch (error) {
      console.error('[App] PizzINT load failed:', error);
      this.ctx.pizzintIndicator?.hide();
      this.ctx.statusPanel?.updateApi('PizzINT', { status: 'error' });
      dataFreshness.recordError('pizzint', String(error));
    }
  }
}
