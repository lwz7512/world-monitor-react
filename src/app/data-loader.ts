import type { AppContext, AppModule } from '@/app/app-context';
import { getRpcBaseUrl } from '@/services/rpc-client';
import { markLcpDebug } from '@/utils/lcp-debug';
import { runHydrationTier, type HydrationTask } from '@/app/hydration-scheduler';
import { yieldToMain } from '@/utils/after-paint';
import { getSignalAggregator, type SignalAggregator } from '@/app/lazy-services';
import {
  getMilitaryVesselsModule,
  isVesselRuntimeStoppedError,
} from '@/services/military-vessels-lazy';
import type { NewsItem, MapLayers, MilitaryFlight } from '@/types';
import type { TimeRange } from '@/components/MapContainer';
import { SITE_VARIANT, LAYER_TO_SOURCE } from '@/config';
import { NewsLoader, drainTrendingSignalQueue } from '@/app/news-loader';
import { MarketsLoader } from '@/app/markets-loader';
import { IntelligenceLoader } from '@/app/intelligence-loader';
import {
  fetchEarthquakes,
  fetchWeatherAlerts,
  isOutagesConfigured,
  fetchAisSignals,
  getAisStatus,
  isAisConfigured,
  fetchMilitaryFlights,
  fetchUSNIFleetReport,
  addToSignalHistory,
  analysisWorker,
  fetchNaturalEvents,
} from '@/services';
import { displayPubDateMs, effectivePubDateMs } from '@/services/feed-date';
import { mlWorker } from '@/services/ml-worker';
import { clusterNewsHybrid } from '@/services/clustering';
import {
  ingestFlights,
  ingestVessels,
  ingestEarthquakes,
  detectGeoConvergence,
  geoConvergenceToSignal,
} from '@/services/geo-convergence';
import {
  updateAndCheck,
  consumeServerAnomalies,
  fetchLiveAnomalies,
} from '@/services/temporal-baseline';
import { fetchAllFires, flattenFires, toMapFires } from '@/services/wildfires';
import type { TheaterPostureSummary } from '@/services/military-surge';
import { fetchCachedTheaterPosture } from '@/services/cached-theater-posture';
import {
  ingestProtestsForCII,
  ingestMilitaryForCII,
  ingestNewsForCII,
  ingestOutagesForCII,
  ingestConflictsForCII,
  ingestStrikesForCII,
  ingestOrefForCII,
  ingestAviationForCII,
  ingestAdvisoriesForCII,
  ingestGpsJammingForCII,
  ingestAisDisruptionsForCII,
  ingestSatelliteFiresForCII,
  ingestCyberThreatsForCII,
  ingestTemporalAnomaliesForCII,
  ingestEarthquakesForCII,
  ingestSanctionsForCII,
  isInLearningMode,
  resetHotspotActivity,
  type CountryScore,
} from '@/services/country-instability';
import {
  fetchSatelliteTLEs,
  initSatRecs,
  propagatePositions,
  startPropagationLoop,
} from '@/services/satellites';
import type { SatRecEntry } from '@/services/satellites';
import { dataFreshness, type DataSourceId } from '@/services/data-freshness';
import type { CorrelationSignal } from '@/services/correlation';
import { hasPremiumAccess } from '@/services/panel-gating';
import { isDesktopRuntime } from '@/services/runtime';
import { getHydratedData } from '@/services/bootstrap';
import { setInsightsMilitaryFlights } from '@/services/insights-store';
import { setCiiData, setCiiUnavailable } from '@/services/cii-store';
import { setPostureData } from '@/services/strategic-posture-store';
import type { GlobalTenderFilters } from '@/services/global-tenders';

import { classifyNewsItem } from '@/services/positive-classifier';
import { fetchGivingSummary } from '@/services/giving';
import { fetchConservationWins } from '@/services/conservation-data';
// #4571: renewable-energy-data (+ its transitive economic edge) dynamic-imported
// inside loadRenewableData so it doesn't parse/execute at boot — the renewable
// panel is below-fold and its load is viewport-gated (shouldLoad('renewable')).
import { checkMilestones } from '@/services/celebration';
import { fetchHappinessScores } from '@/services/happiness-data';
import { fetchRenewableInstallations } from '@/services/renewable-installations';
import { filterBySentiment } from '@/services/sentiment-gate';
import { fetchAllPositiveTopicIntelligence } from '@/services/gdelt-intel';
import {
  fetchPositiveGeoEvents,
  geocodePositiveNewsItems,
  type PositiveGeoEvent,
} from '@/services/positive-events-geo';
import type { HappyContentCategory } from '@/services/positive-classifier';
import { fetchKindnessData } from '@/services/kindness-data';
import { getPersistentCache, setPersistentCache } from '@/services/persistent-cache';
import { setHappyPanelData } from '@/services/happy-items-store';
import {
  fetchCachedRiskScores,
  getCachedScores,
  toCountryScore,
  type CachedRiskScores,
} from '@/services/cached-risk-scores';

import { fetchDiseaseOutbreaks } from '@/services/disease-outbreaks';
import { getTopActiveGeoHubs } from '@/services/geo-activity';
import { setGeoHubActivities } from '@/services/geo-hubs-store';
import { ResearchServiceClient } from '@/services/generated-rpc-clients';

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';
// Iran-events domain sunset (war ended 2026-07). Default OFF: no fetch, even the
// CII/risk-scoring path. Set VITE_ENABLE_IRAN_ATTACKS=true to restore. Mirrors CYBER_LAYER_ENABLED.
const IRAN_ATTACKS_ENABLED = import.meta.env.VITE_ENABLE_IRAN_ATTACKS === 'true';

export interface DataLoaderCallbacks {
  renderCriticalBanner: (postures: TheaterPostureSummary[]) => void;
  refreshOpenCountryBrief: () => void;
}

type HydrationTier = 1 | 2 | 3 | 4;

async function runSignalAggregator(
  statusPanel: AppContext['statusPanel'] | undefined,
  context: string,
  ingest: (aggregator: SignalAggregator) => void,
): Promise<void> {
  try {
    ingest(await getSignalAggregator());
    statusPanel?.updateApi('Signal Aggregator', { status: 'ok', errorMessage: undefined });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[SignalAggregator] ${context} skipped:`, err);
    statusPanel?.updateApi('Signal Aggregator', {
      status: 'error',
      errorMessage: `${context}: ${errorMessage}`,
    });
  }
}

const HYDRATION_TIER_ONE = new Set(['news', 'markets', 'intelligence']);
const HYDRATION_TIER_TWO = new Set([
  'natural',
  'firms',
  'weather',
  'ais',
  'flights',
  'cyberThreats',
  'iranAttacks',
  'techEvents',
  'satellites',
  'webcams',
  'cables',
  'cableHealth',
  'diseaseOutbreaks',
  'socialVelocity',
  'economicStress',
  'sanctions',
  'resilienceRanking',
  'radiation',
]);
const HYDRATION_TIER_FOUR = new Set([
  'stockAnalysis',
  'stockBacktest',
  'dailyMarketBrief',
  'predictions',
  'forecasts',
  'simulation-outcome',
  'pizzint',
  'marketImplications',
  'wsbTickers',
  'techReadiness',
  'thermalEscalation',
  'crossSourceSignals',
]);
const HYDRATION_TIERS: HydrationTier[] = [1, 2, 3, 4];

export class DataLoaderManager implements AppModule {
  private ctx: AppContext;
  private callbacks: DataLoaderCallbacks;
  private newsLoader: NewsLoader;
  private marketsLoader: MarketsLoader;
  private intelligenceLoader: IntelligenceLoader;

  public updateSearchIndex: () => void = () => {};

  private satellitePropagationCleanup: (() => void) | null = null;
  private cachedSatRecs: SatRecEntry[] | null = null;
  private loadAllDataPromise: Promise<void> | null = null;
  private loadAllDataRerunRequested = false;
  private loadAllDataQueuedForceAll = false;

  constructor(ctx: AppContext, callbacks: DataLoaderCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
    this.newsLoader = new NewsLoader(ctx, {
      loadHappySupplementaryAndRender: () => this.loadHappySupplementaryAndRender(),
      loadPositiveEvents: () => this.loadPositiveEvents(),
      loadKindnessData: () => this.loadKindnessData(),
    });
    this.marketsLoader = new MarketsLoader(ctx, {
      runCorrelationAnalysis: () => this.runCorrelationAnalysis(),
    });
    this.intelligenceLoader = new IntelligenceLoader(ctx, {
      refreshCiiAndBrief: () => this.refreshCiiAndBrief(),
      runMilitarySurgeAnalysis: (flights) => this.runMilitarySurgeAnalysis(flights),
    });
  }

  private getHydrationTier(name: string): HydrationTier {
    if (HYDRATION_TIER_ONE.has(name)) return 1;
    if (HYDRATION_TIER_TWO.has(name)) return 2;
    if (HYDRATION_TIER_FOUR.has(name)) return 4;
    return 3;
  }

  private markHydration(label: string): void {
    if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
    performance.mark(label);
  }

  private async runHydrationTasks(tasks: HydrationTask[], forceAll: boolean): Promise<void> {
    const prioritized = tasks
      .map((task, order) => ({ ...task, order, tier: this.getHydrationTier(task.name) }))
      .sort((a, b) => a.tier - b.tier || a.order - b.order);

    // On the mobile profile, starting several panel loaders in the same task
    // lets their dynamic-import evaluation and synchronous render work merge
    // into one long task. Keep desktop concurrency, but give the browser a
    // scheduling boundary between every mobile panel in a tier. (#5165)
    const maxConcurrency = this.ctx.isMobile ? 1 : forceAll ? 6 : 3;
    const failures: Array<{ name: string; reason: unknown }> = [];
    this.markHydration(`wm:hydration:${forceAll ? 'force' : 'viewport'}:start`);

    for (const tier of HYDRATION_TIERS) {
      const tierTasks = prioritized.filter((task) => task.tier === tier);
      if (tierTasks.length === 0) continue;

      this.markHydration(`wm:hydration:tier-${tier}:start`);
      await runHydrationTier({
        tasks: tierTasks,
        maxConcurrency,
        yieldToMain,
        onFailure: (name, reason) => failures.push({ name, reason }),
      });
      this.markHydration(`wm:hydration:tier-${tier}:end`);
      if (tier < 4 && prioritized.some((task) => task.tier > tier)) await yieldToMain();
    }

    this.markHydration(`wm:hydration:${forceAll ? 'force' : 'viewport'}:end`);
    failures.forEach(({ name, reason }) => {
      console.error(`[App] ${name} load failed:`, reason);
    });
  }

  init(): void {
    this.marketsLoader.init();
  }

  destroy(): void {
    this.newsLoader.destroy();
    this.marketsLoader.destroy();
    this.stopSatellitePropagation();
    if (this.imageryRetryTimer) {
      clearTimeout(this.imageryRetryTimer);
      this.imageryRetryTimer = null;
    }
    this.intelligenceLoader.destroy();
  }

  private getAuthoritativeCachedRiskScores(): CachedRiskScores | null {
    const cached = getCachedScores();
    return cached?.cii.length ? cached : null;
  }

  private appliedCiiState: CachedRiskScores | null | undefined;

  private applyCiiScoresToMap(scores: CountryScore[]): void {
    this.ctx.map?.setCIIScores(
      scores.map((s) => ({ code: s.code, score: s.score, level: s.level })),
    );
    this.ctx.map?.setLayerReady('ciiChoropleth', scores.length > 0);
  }

  private renderCachedCiiScores(cached: CachedRiskScores): boolean {
    if (this.appliedCiiState === cached) return false;
    this.appliedCiiState = cached;
    setCiiData(cached);
    this.applyCiiScoresToMap(cached.cii.map(toCountryScore));
    return true;
  }

  private refreshCiiAndBrief(): void {
    const cached = this.getAuthoritativeCachedRiskScores();
    if (cached) {
      this.renderCachedCiiScores(cached);
      this.callbacks.refreshOpenCountryBrief();
      return;
    }

    if (this.appliedCiiState === null) return;
    this.appliedCiiState = null;
    setCiiUnavailable();
    this.applyCiiScoresToMap([]);
    this.callbacks.refreshOpenCountryBrief();
  }

  public refreshCiiAfterFocalPointsReady(): void {
    this.refreshCiiAndBrief();
  }

  public refreshGeometryDependentCiiAfterCountryGeometry(): void {
    markLcpDebug('wm:data:country-geometry-replay-start');
    const cache = this.ctx.intelligenceCache;
    let replayed = 0;

    if (cache.protests || cache.conflicts || cache.military || cache.iranEvents) {
      resetHotspotActivity();
    }
    if (cache.protests) {
      ingestProtestsForCII(cache.protests.events);
      replayed += 1;
    }
    if (cache.conflicts) {
      ingestConflictsForCII(cache.conflicts);
      replayed += 1;
    }
    if (cache.military) {
      ingestMilitaryForCII(cache.military.flights, cache.military.vessels);
      replayed += 1;
    }
    if (cache.iranEvents) {
      const coerced = cache.iranEvents.map((e) => ({ ...e, timestamp: Number(e.timestamp) || 0 }));
      ingestStrikesForCII(coerced);
      replayed += 1;
    }
    if (cache.earthquakes) {
      ingestEarthquakesForCII(cache.earthquakes);
      replayed += 1;
    }
    if (cache.flightDelays) {
      const severe = cache.flightDelays.filter(
        (d) => d.severity === 'major' || d.severity === 'severe' || d.delayType === 'closure',
      );
      if (severe.length > 0) {
        ingestAviationForCII(severe);
        replayed += 1;
      }
    }
    if (cache.outages) {
      ingestOutagesForCII(cache.outages);
      replayed += 1;
    }
    if (cache.orefAlerts) {
      ingestOrefForCII(cache.orefAlerts.alertCount, cache.orefAlerts.historyCount24h);
      replayed += 1;
    }
    if (cache.advisories) {
      ingestAdvisoriesForCII(cache.advisories);
      replayed += 1;
    }
    if (cache.sanctions) {
      ingestSanctionsForCII(cache.sanctions.countries);
      replayed += 1;
    }
    if (this.ctx.cyberThreatsCache) {
      ingestCyberThreatsForCII(this.ctx.cyberThreatsCache);
      replayed += 1;
    }
    // Coordinate-only sources (no country hint) that resolve purely via
    // precision geometry. Without this replay their first-pass attribution —
    // computed during the fan-out before geometry was ready — stays empty until
    // the next scheduled refresh (#4512).
    if (cache.gpsJamming?.length) {
      ingestGpsJammingForCII(cache.gpsJamming);
      replayed += 1;
    }
    if (cache.aisDisruptions?.length) {
      ingestAisDisruptionsForCII(cache.aisDisruptions);
      replayed += 1;
    }
    if (cache.satelliteFires?.length) {
      ingestSatelliteFiresForCII(cache.satelliteFires);
      replayed += 1;
    }

    markLcpDebug('wm:data:country-geometry-replay-ready', { replayed });
    if (replayed > 0) this.refreshCiiAndBrief();
  }

  private shouldShowIntelligenceNotifications(): boolean {
    return !this.ctx.isMobile && !!this.ctx.findingsBadge?.isPopupEnabled();
  }

  private showSignalNotification(signals: CorrelationSignal[], context: string): void {
    void this.ctx
      .ensureSignalModal()
      .then((signalModal) => {
        if (!this.ctx.isDestroyed) signalModal.show(signals);
      })
      .catch((err) => {
        console.warn(`[SignalModal] ${context} notification skipped:`, err);
      });
  }

  private isPanelNearViewport(panelId: string, marginPx = 400): boolean {
    const panel = this.ctx.panels[panelId] as
      { isNearViewport?: (marginPx?: number) => boolean } | undefined;
    return panel?.isNearViewport?.(marginPx) ?? false;
  }

  private isAnyPanelNearViewport(panelIds: string[], marginPx = 400): boolean {
    return panelIds.some((panelId) => this.isPanelNearViewport(panelId, marginPx));
  }

  async loadAllData(forceAll = false): Promise<void> {
    if (this.loadAllDataPromise) {
      this.loadAllDataRerunRequested = true;
      this.loadAllDataQueuedForceAll = this.loadAllDataQueuedForceAll || forceAll;
      return this.loadAllDataPromise;
    }

    this.loadAllDataRerunRequested = true;
    this.loadAllDataQueuedForceAll = forceAll;
    this.loadAllDataPromise = this.drainLoadAllDataQueue();
    return this.loadAllDataPromise;
  }

  private async drainLoadAllDataQueue(): Promise<void> {
    try {
      while (this.loadAllDataRerunRequested && !this.ctx.isDestroyed) {
        const forceAll = this.loadAllDataQueuedForceAll;
        this.loadAllDataRerunRequested = false;
        this.loadAllDataQueuedForceAll = false;
        await this.runLoadAllData(forceAll);
      }
    } finally {
      this.loadAllDataPromise = null;
      this.loadAllDataRerunRequested = false;
      this.loadAllDataQueuedForceAll = false;
    }
  }

  private async runLoadAllData(forceAll: boolean): Promise<void> {
    const runGuarded = async (name: string, fn: () => Promise<void>): Promise<void> => {
      if (this.ctx.isDestroyed || this.ctx.inFlight.has(name)) return;
      this.ctx.inFlight.add(name);
      try {
        await fn();
      } catch (e) {
        if (!this.ctx.isDestroyed) console.error(`[App] ${name} failed:`, e);
      } finally {
        this.ctx.inFlight.delete(name);
      }
    };

    const shouldLoad = (id: string): boolean => forceAll || this.isPanelNearViewport(id);
    const shouldLoadAny = (ids: string[]): boolean => forceAll || this.isAnyPanelNearViewport(ids);

    const tasks: HydrationTask[] = [];
    if (this.newsLoader.shouldHydrateNews(forceAll)) {
      tasks.push({
        name: 'news',
        task: () => runGuarded('news', () => this.newsLoader.loadNews()),
      });
    }

    // Happy variant only loads news data -- skip all geopolitical/financial/military data
    if (SITE_VARIANT !== 'happy') {
      if (
        shouldLoadAny([
          'markets',
          'heatmap',
          'commodities',
          'crypto',
          'energy-complex',
          'crypto-heatmap',
          'defi-tokens',
          'ai-tokens',
          'other-tokens',
        ])
      ) {
        tasks.push({
          name: 'markets',
          task: () => runGuarded('markets', () => this.loadMarkets()),
        });
      }
      if (hasPremiumAccess() && shouldLoad('stock-analysis')) {
        tasks.push({
          name: 'stockAnalysis',
          task: () => runGuarded('stockAnalysis', () => this.loadStockAnalysis()),
        });
      }
      if (hasPremiumAccess() && shouldLoad('stock-backtest')) {
        tasks.push({
          name: 'stockBacktest',
          task: () => runGuarded('stockBacktest', () => this.loadStockBacktest()),
        });
      }
      if (hasPremiumAccess() && shouldLoad('daily-market-brief')) {
        tasks.push({
          name: 'dailyMarketBrief',
          task: () => runGuarded('dailyMarketBrief', () => this.loadDailyMarketBrief()),
        });
      }
      if (shouldLoad('polymarket')) {
        tasks.push({
          name: 'predictions',
          task: () => runGuarded('predictions', () => this.loadPredictions()),
        });
      }
      if (shouldLoad('forecast')) {
        tasks.push({
          name: 'forecasts',
          task: () => runGuarded('forecasts', () => this.loadForecasts()),
        });
        tasks.push({
          name: 'simulation-outcome',
          task: () => runGuarded('simulation-outcome', () => this.loadSimulationOutcome()),
        });
      }
      if (SITE_VARIANT === 'full')
        tasks.push({
          name: 'pizzint',
          task: () => runGuarded('pizzint', () => this.loadPizzInt()),
        });
      if (shouldLoad('economic')) {
        tasks.push({ name: 'fred', task: () => runGuarded('fred', () => this.loadFredData()) });
        tasks.push({
          name: 'spending',
          task: () => runGuarded('spending', () => this.loadGovernmentSpending()),
        });
        tasks.push({ name: 'bis', task: () => runGuarded('bis', () => this.loadBisData()) });
        tasks.push({ name: 'bls', task: () => runGuarded('bls', () => this.loadBlsData()) });
      }
      if (hasPremiumAccess() && shouldLoad('global-procurement')) {
        tasks.push({
          name: 'global-tenders',
          task: () => runGuarded('global-tenders', () => this.loadGlobalTenders()),
        });
      }
      if (shouldLoad('energy-complex')) {
        tasks.push({ name: 'oil', task: () => runGuarded('oil', () => this.loadOilAnalytics()) });
      }

      // Trade policy + supply-chain data (FULL, FINANCE, COMMODITY, ENERGY variants use supply-chain surface)
      if (
        SITE_VARIANT === 'full' ||
        SITE_VARIANT === 'finance' ||
        SITE_VARIANT === 'commodity' ||
        SITE_VARIANT === 'energy'
      ) {
        if (shouldLoad('trade-policy')) {
          tasks.push({
            name: 'tradePolicy',
            task: () => runGuarded('tradePolicy', () => this.loadTradePolicy()),
          });
        }
        if (shouldLoad('supply-chain')) {
          tasks.push({
            name: 'supplyChain',
            task: () => runGuarded('supplyChain', () => this.loadSupplyChain()),
          });
        }
        if (shouldLoad('china-corridors')) {
          tasks.push({
            name: 'chinaCorridors',
            task: () => runGuarded('chinaCorridors', () => this.loadChinaCorridors()),
          });
        }
        if (shouldLoad('china-activity-nowcast')) {
          tasks.push({
            name: 'chinaActivityNowcast',
            task: () => runGuarded('chinaActivityNowcast', () => this.loadChinaActivityNowcast()),
          });
        }
      }
    }

    // Conservation data (happy variant only)
    if (SITE_VARIANT === 'happy') {
      if (shouldLoad('species')) {
        tasks.push({
          name: 'species',
          task: () => runGuarded('species', () => this.loadSpeciesData()),
        });
      }
      tasks.push({
        name: 'happinessMap',
        task: () =>
          runGuarded('happinessMap', async () => {
            const data = await fetchHappinessScores();
            this.ctx.map?.setHappinessScores(data);
          }),
      });
      tasks.push({
        name: 'renewableMap',
        task: () =>
          runGuarded('renewableMap', async () => {
            const installations = await fetchRenewableInstallations();
            this.ctx.map?.setRenewableInstallations(installations);
          }),
      });
    }

    // Renewable panel is shared by happy and energy variants.
    if (shouldLoad('renewable')) {
      tasks.push({
        name: 'renewable',
        task: () => runGuarded('renewable', () => this.loadRenewableData()),
      });
    }

    if (shouldLoad('giving')) {
      tasks.push({
        name: 'giving',
        task: () =>
          runGuarded('giving', async () => {
            const givingResult = await fetchGivingSummary();
            if (!givingResult.ok) {
              dataFreshness.recordError('giving', 'Giving data unavailable');
              return;
            }
            const data = givingResult.data;
            if (givingResult.state === 'cached-refresh-unavailable') {
              dataFreshness.recordError(
                'giving',
                `Giving refresh unavailable (${givingResult.refreshFailure ?? 'unknown'})`,
              );
            } else if (data.platforms.length > 0) {
              dataFreshness.recordUpdate('giving', data.platforms.length);
            }
          }),
      });
    }

    if (SITE_VARIANT === 'full') {
      try {
        const cached = await fetchCachedRiskScores().catch(() => null);
        if (cached && cached.cii.length > 0) {
          this.renderCachedCiiScores(cached);
        }
      } catch {
        /* non-fatal */
      }
    }
    // Intelligence signals: run for any variant that shows these panels
    if (
      shouldLoadAny([
        'cii',
        'strategic-risk',
        'strategic-posture',
        'climate',
        'population-exposure',
        'security-advisories',
        'radiation-watch',
        'displacement',
        'ucdp-events',
        'satellite-fires',
        'oref-sirens',
      ])
    ) {
      tasks.push({
        name: 'intelligence',
        task: () => runGuarded('intelligence', () => this.loadIntelligenceSignals()),
      });
    }

    if (SITE_VARIANT === 'full' && (shouldLoad('satellite-fires') || this.ctx.mapLayers.natural)) {
      tasks.push({ name: 'firms', task: () => runGuarded('firms', () => this.loadFirmsData()) });
    }
    if (this.ctx.mapLayers.natural)
      tasks.push({ name: 'natural', task: () => runGuarded('natural', () => this.loadNatural()) });
    if (this.ctx.mapLayers.diseaseOutbreaks || shouldLoad('disease-outbreaks'))
      tasks.push({
        name: 'diseaseOutbreaks',
        task: () => runGuarded('diseaseOutbreaks', () => this.loadDiseaseOutbreaks()),
      });
    if (shouldLoad('social-velocity'))
      tasks.push({
        name: 'socialVelocity',
        task: () => runGuarded('socialVelocity', () => this.loadSocialVelocity()),
      });
    if (hasPremiumAccess() && shouldLoad('wsb-ticker-scanner'))
      tasks.push({
        name: 'wsbTickers',
        task: () => runGuarded('wsbTickers', () => this.loadWsbTickers()),
      });
    if (shouldLoad('economic'))
      tasks.push({
        name: 'economicStress',
        task: () => runGuarded('economicStress', () => this.loadEconomicStress()),
      });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.weather)
      tasks.push({
        name: 'weather',
        task: () => runGuarded('weather', () => this.loadWeatherAlerts()),
      });
    if (SITE_VARIANT !== 'happy' && !isDesktopRuntime() && this.ctx.mapLayers.ais)
      tasks.push({ name: 'ais', task: () => runGuarded('ais', () => this.loadAisSignals()) });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.cables)
      tasks.push({
        name: 'cables',
        task: () => runGuarded('cables', () => this.loadCableActivity()),
      });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.cables)
      tasks.push({
        name: 'cableHealth',
        task: () => runGuarded('cableHealth', () => this.loadCableHealth()),
      });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.flights)
      tasks.push({
        name: 'flights',
        task: () => runGuarded('flights', () => this.loadFlightDelays()),
      });
    if (SITE_VARIANT !== 'happy' && CYBER_LAYER_ENABLED && this.ctx.mapLayers.cyberThreats)
      tasks.push({
        name: 'cyberThreats',
        task: () => runGuarded('cyberThreats', () => this.loadCyberThreats()),
      });
    if (
      IRAN_ATTACKS_ENABLED &&
      SITE_VARIANT !== 'happy' &&
      !isDesktopRuntime() &&
      (this.ctx.mapLayers.iranAttacks ||
        shouldLoadAny(['cii', 'strategic-risk', 'strategic-posture']))
    )
      tasks.push({
        name: 'iranAttacks',
        task: () => runGuarded('iranAttacks', () => this.loadIranEvents()),
      });
    if (SITE_VARIANT !== 'happy' && (this.ctx.mapLayers.techEvents || SITE_VARIANT === 'tech'))
      tasks.push({
        name: 'techEvents',
        task: () => runGuarded('techEvents', () => this.loadTechEvents()),
      });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.satellites && this.ctx.map?.isGlobeMode?.())
      tasks.push({
        name: 'satellites',
        task: () => runGuarded('satellites', () => this.loadSatellites()),
      });
    if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.webcams)
      tasks.push({ name: 'webcams', task: () => runGuarded('webcams', () => this.loadWebcams()) });
    if (
      SITE_VARIANT !== 'happy' &&
      (shouldLoad('sanctions-pressure') || this.ctx.mapLayers.sanctions)
    ) {
      tasks.push({
        name: 'sanctions',
        task: () => runGuarded('sanctions', () => this.loadSanctionsPressure()),
      });
    }
    if (this.ctx.mapLayers.resilienceScore) {
      if (hasPremiumAccess()) {
        tasks.push({
          name: 'resilienceRanking',
          task: () => runGuarded('resilienceRanking', () => this.loadResilienceRanking()),
        });
      } else {
        this.ctx.map?.setResilienceRanking([]);
        this.ctx.map?.setLayerReady('resilienceScore', false);
      }
    }
    if (
      SITE_VARIANT !== 'happy' &&
      (shouldLoad('radiation-watch') || this.ctx.mapLayers.radiationWatch)
    ) {
      tasks.push({
        name: 'radiation',
        task: () => runGuarded('radiation', () => this.loadRadiationWatch()),
      });
    }

    // tech-readiness is only seeded on full + tech variants (api/bootstrap.js +
    // scripts/seed-wb-indicators.mjs); on commodity/finance/energy the 5s fetch
    // at services/economic/index.ts:694 just times out. shouldLoad() alone is
    // not enough — loadAllData(true) on boot (App.ts:1226) bypasses the viewport
    // check via forceAll. Gate on variant defaults so this only fires where the
    // seed actually exists.
    // tech-readiness panel is self-fetching via usePanelData; no task needed here.
    if (SITE_VARIANT !== 'happy' && shouldLoad('thermal-escalation')) {
      tasks.push({
        name: 'thermalEscalation',
        task: () => runGuarded('thermalEscalation', () => this.loadThermalEscalations()),
      });
    }
    if (SITE_VARIANT !== 'happy' && shouldLoad('cross-source-signals')) {
      tasks.push({
        name: 'crossSourceSignals',
        task: () => runGuarded('crossSourceSignals', () => this.loadCrossSourceSignals()),
      });
    }

    await this.runHydrationTasks(tasks, forceAll);

    this.updateSearchIndex();

    if (hasPremiumAccess()) {
      await Promise.allSettled([this.loadDailyMarketBrief(), this.loadMarketImplications()]);
    }

    const bootstrapTemporal = consumeServerAnomalies();
    if (bootstrapTemporal.anomalies.length > 0 || bootstrapTemporal.trackedTypes.length > 0) {
      await runSignalAggregator(
        this.ctx.statusPanel,
        'bootstrap temporal anomalies',
        (aggregator) =>
          aggregator.ingestTemporalAnomalies(
            bootstrapTemporal.anomalies,
            bootstrapTemporal.trackedTypes,
          ),
      );
      ingestTemporalAnomaliesForCII(bootstrapTemporal.anomalies);
      this.refreshCiiAndBrief();
    } else {
      this.refreshTemporalBaseline().catch(() => {});
    }
  }

  async refreshTemporalBaseline(): Promise<void> {
    const { anomalies, trackedTypes } = await fetchLiveAnomalies();
    await runSignalAggregator(this.ctx.statusPanel, 'temporal baseline anomalies', (aggregator) =>
      aggregator.ingestTemporalAnomalies(anomalies, trackedTypes),
    );
    ingestTemporalAnomaliesForCII(anomalies);
    this.refreshCiiAndBrief();
  }

  async loadDataForLayer(layer: keyof MapLayers): Promise<void> {
    if (this.ctx.isDestroyed || this.ctx.inFlight.has(layer)) return;
    this.ctx.inFlight.add(layer);
    this.ctx.map?.setLayerLoading(layer, true);
    try {
      switch (layer) {
        case 'natural':
          await this.loadNatural();
          break;
        case 'fires':
          await this.loadFirmsData();
          break;
        case 'weather':
          await this.loadWeatherAlerts();
          break;
        case 'outages':
          await this.loadOutages();
          break;
        case 'cyberThreats':
          await this.loadCyberThreats();
          break;
        case 'ais':
          await this.loadAisSignals();
          break;
        case 'cables':
          await Promise.all([this.loadCableActivity(), this.loadCableHealth()]);
          break;
        case 'protests':
          await this.loadProtests();
          break;
        case 'flights':
          await this.loadFlightDelays();
          break;
        case 'military':
          await this.loadMilitary();
          break;
        case 'techEvents':
          console.log('[loadDataForLayer] Loading techEvents...');
          await this.loadTechEvents();
          console.log('[loadDataForLayer] techEvents loaded');
          break;
        case 'positiveEvents':
          await this.loadPositiveEvents();
          break;
        case 'kindness':
          this.loadKindnessData();
          break;
        case 'iranAttacks':
          await this.loadIranEvents();
          break;
        case 'satellites': {
          await this.loadSatellites();
          this.loadImageryFootprints();
          break;
        }
        case 'webcams':
          await this.loadWebcams();
          break;
        case 'sanctions':
          await this.loadSanctionsPressure();
          break;
        case 'radiationWatch':
          await this.loadRadiationWatch();
          break;
        case 'ucdpEvents':
        case 'displacement':
        case 'climate':
        case 'gpsJamming':
          await this.loadIntelligenceSignals();
          break;
        case 'diseaseOutbreaks':
          await this.loadDiseaseOutbreaks();
          break;
        case 'resilienceScore':
          await this.loadResilienceRanking();
          break;
      }
    } finally {
      this.ctx.inFlight.delete(layer);
      this.ctx.map?.setLayerLoading(layer, false);
    }
  }

  async loadSatellites(): Promise<void> {
    this.stopSatellitePropagation();
    const data = await fetchSatelliteTLEs();
    if (!data || data.length === 0) return;
    try {
      this.cachedSatRecs = await initSatRecs(data);
    } catch (err) {
      console.error('[satellites] failed to initialize satellite propagation', err);
      this.cachedSatRecs = [];
      this.ctx.map?.setSatellites([]);
      return;
    }
    const positions = propagatePositions(this.cachedSatRecs);
    this.ctx.map?.setSatellites(positions);
    this.satellitePropagationCleanup = startPropagationLoop(
      this.cachedSatRecs,
      (pos) => {
        this.ctx.map?.setSatellites(pos);
      },
      3000,
    );
  }

  private stopSatellitePropagation(): void {
    this.satellitePropagationCleanup?.();
    this.satellitePropagationCleanup = null;
  }

  private imageryRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private loadImageryFootprints(retries = 2): void {
    if (!this.ctx.mapLayers.satellites) return;
    if (this.ctx.map?.isGlobeMode()) return;
    const bbox = this.ctx.map?.getBbox();
    if (!bbox) {
      if (retries > 0) {
        this.imageryRetryTimer = setTimeout(() => this.loadImageryFootprints(retries - 1), 1500);
      }
      return;
    }
    void import('@/services/imagery').then(async ({ fetchImageryScenes }) => {
      try {
        const scenes = await fetchImageryScenes({ bbox, limit: 20 });
        if (!this.ctx.mapLayers.satellites) return;
        if (this.ctx.map?.isGlobeMode()) return;
        this.ctx.map?.setImageryScenes(scenes);
      } catch {
        /* imagery is best-effort */
      }
    });
  }

  stopLayerActivity(layer: keyof MapLayers): void {
    if (layer === 'satellites') {
      this.stopSatellitePropagation();
      if (this.imageryRetryTimer) {
        clearTimeout(this.imageryRetryTimer);
        this.imageryRetryTimer = null;
      }
    }
  }

  // News domain delegates — implementation lives in NewsLoader
  async loadNews(): Promise<void> {
    return this.newsLoader.loadNews();
  }
  invalidateNewsHydration(): void {
    this.newsLoader.invalidateNewsHydration();
  }
  updateMonitorResults(): void {
    this.newsLoader.updateMonitorResults();
  }
  renderNewsForCategory(category: string, items: NewsItem[]): void {
    this.newsLoader.renderNewsForCategory(category, items);
  }
  applyTimeRangeFilterToNewsPanels(): void {
    this.newsLoader.applyTimeRangeFilterToNewsPanels();
  }
  applyTimeRangeFilterDebounced(): void {
    this.newsLoader.applyTimeRangeFilterDebounced();
  }
  filterItemsByTimeRange(items: NewsItem[], range?: TimeRange): NewsItem[] {
    return this.newsLoader.filterItemsByTimeRange(items, range);
  }
  getTimeRangeLabel(range?: TimeRange): string {
    return this.newsLoader.getTimeRangeLabel(range);
  }
  getTimeRangeWindowMs(range: TimeRange): number {
    return this.newsLoader.getTimeRangeWindowMs(range);
  }

  // Markets domain delegates — implementation lives in MarketsLoader
  async loadStockAnalysis(): Promise<void> {
    return this.marketsLoader.loadStockAnalysis();
  }
  async loadStockBacktest(): Promise<void> {
    return this.marketsLoader.loadStockBacktest();
  }
  async loadMarkets(): Promise<void> {
    return this.marketsLoader.loadMarkets();
  }
  async loadDailyMarketBrief(force = false): Promise<void> {
    return this.marketsLoader.loadDailyMarketBrief(force);
  }
  async loadMarketImplications(): Promise<void> {
    return this.marketsLoader.loadMarketImplications();
  }
  async loadPredictions(): Promise<void> {
    return this.marketsLoader.loadPredictions();
  }
  async loadForecasts(): Promise<void> {
    return this.marketsLoader.loadForecasts();
  }
  async loadSimulationOutcome(): Promise<void> {
    return this.marketsLoader.loadSimulationOutcome();
  }
  async loadFredData(): Promise<void> {
    return this.marketsLoader.loadFredData();
  }
  async loadOilAnalytics(): Promise<void> {
    return this.marketsLoader.loadOilAnalytics();
  }
  async loadGovernmentSpending(): Promise<void> {
    return this.marketsLoader.loadGovernmentSpending();
  }
  async loadGlobalTenders(filters?: GlobalTenderFilters, append = false): Promise<void> {
    return this.marketsLoader.loadGlobalTenders(filters, append);
  }
  async clearGlobalTenders(): Promise<void> {
    return this.marketsLoader.clearGlobalTenders();
  }
  async loadBisData(): Promise<void> {
    return this.marketsLoader.loadBisData();
  }
  async loadBlsData(): Promise<void> {
    return this.marketsLoader.loadBlsData();
  }
  async loadTradePolicy(): Promise<void> {
    return this.marketsLoader.loadTradePolicy();
  }
  async loadSupplyChain(): Promise<void> {
    return this.marketsLoader.loadSupplyChain();
  }
  async loadChinaCorridors(): Promise<void> {
    return this.marketsLoader.loadChinaCorridors();
  }
  async loadChinaActivityNowcast(): Promise<void> {
    return this.marketsLoader.loadChinaActivityNowcast();
  }
  async loadSocialVelocity(): Promise<void> {
    return this.marketsLoader.loadSocialVelocity();
  }
  async loadWsbTickers(): Promise<void> {
    return this.marketsLoader.loadWsbTickers();
  }
  async loadEconomicStress(): Promise<void> {
    return this.marketsLoader.loadEconomicStress();
  }
  async loadPizzInt(): Promise<void> {
    return this.marketsLoader.loadPizzInt();
  }

  // Intelligence domain delegates — implementation lives in IntelligenceLoader
  async loadIntelligenceSignals(): Promise<void> {
    return this.intelligenceLoader.loadIntelligenceSignals();
  }
  async loadOutages(): Promise<void> {
    return this.intelligenceLoader.loadOutages();
  }
  async loadCyberThreats(): Promise<void> {
    return this.intelligenceLoader.loadCyberThreats();
  }
  async loadIranEvents(): Promise<void> {
    return this.intelligenceLoader.loadIranEvents();
  }
  async loadCableActivity(): Promise<void> {
    return this.intelligenceLoader.loadCableActivity();
  }
  async loadCableHealth(): Promise<void> {
    return this.intelligenceLoader.loadCableHealth();
  }
  async loadProtests(): Promise<void> {
    return this.intelligenceLoader.loadProtests();
  }
  async loadSecurityAdvisories(): Promise<void> {
    return this.intelligenceLoader.loadSecurityAdvisories();
  }
  async loadSanctionsPressure(): Promise<void> {
    return this.intelligenceLoader.loadSanctionsPressure();
  }
  async loadResilienceRanking(): Promise<void> {
    return this.intelligenceLoader.loadResilienceRanking();
  }
  async loadRadiationWatch(): Promise<void> {
    return this.intelligenceLoader.loadRadiationWatch();
  }
  async loadThermalEscalations(): Promise<void> {
    return this.intelligenceLoader.loadThermalEscalations();
  }
  async loadCrossSourceSignals(): Promise<void> {
    return this.intelligenceLoader.loadCrossSourceSignals();
  }

  async loadNatural(): Promise<void> {
    const [earthquakeResult, eonetResult] = await Promise.allSettled([
      fetchEarthquakes(),
      fetchNaturalEvents(30),
    ]);

    if (earthquakeResult.status === 'fulfilled') {
      this.ctx.intelligenceCache.earthquakes = earthquakeResult.value;
      this.ctx.map?.setEarthquakes(earthquakeResult.value);
      ingestEarthquakes(earthquakeResult.value);
      ingestEarthquakesForCII(earthquakeResult.value);
      this.ctx.statusPanel?.updateApi('USGS', { status: 'ok' });
      dataFreshness.recordUpdate('usgs', earthquakeResult.value.length);
    } else {
      this.ctx.intelligenceCache.earthquakes = [];
      this.ctx.map?.setEarthquakes([]);
      this.ctx.statusPanel?.updateApi('USGS', { status: 'error' });
      dataFreshness.recordError('usgs', String(earthquakeResult.reason));
    }

    if (eonetResult.status === 'fulfilled') {
      this.ctx.map?.setNaturalEvents(eonetResult.value);
      this.ctx.statusPanel?.updateFeed('EONET', {
        status: 'ok',
        itemCount: eonetResult.value.length,
      });
      this.ctx.statusPanel?.updateApi('NASA EONET', { status: 'ok' });
    } else {
      this.ctx.map?.setNaturalEvents([]);
      this.ctx.statusPanel?.updateFeed('EONET', {
        status: 'error',
        errorMessage: String(eonetResult.reason),
      });
      this.ctx.statusPanel?.updateApi('NASA EONET', { status: 'error' });
    }

    const hasEarthquakes =
      earthquakeResult.status === 'fulfilled' && earthquakeResult.value.length > 0;
    const hasEonet = eonetResult.status === 'fulfilled' && eonetResult.value.length > 0;
    this.ctx.map?.setLayerReady('natural', hasEarthquakes || hasEonet);
  }

  async loadTechEvents(): Promise<void> {
    console.log(
      '[loadTechEvents] Called. SITE_VARIANT:',
      SITE_VARIANT,
      'techEvents layer:',
      this.ctx.mapLayers.techEvents,
    );
    if (SITE_VARIANT !== 'tech' && !this.ctx.mapLayers.techEvents) {
      console.log('[loadTechEvents] Skipping - not tech variant and layer disabled');
      return;
    }

    try {
      // Try hydrated bootstrap data first (instant, no RPC)
      const hydrated = getHydratedData('techEvents') as
        | {
            events?: Array<{
              id: string;
              title: string;
              type: string;
              location: string;
              coords?: { lat: number; lng: number; country: string; virtual?: boolean };
              startDate: string;
              endDate: string;
              url: string;
            }>;
          }
        | undefined;
      let events = hydrated?.events;

      if (!events?.length) {
        // Fallback: RPC call
        const client = new ResearchServiceClient(getRpcBaseUrl(), {
          fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
        });
        const data = await client.listTechEvents({
          type: 'conference',
          mappable: true,
          days: 90,
          limit: 50,
        });
        if (!data.success) throw new Error(data.error || 'Unknown error');
        events = data.events;
      } else {
        // Filter hydrated data to match map layer needs (conferences, mappable, 90 days)
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + 90);
        events = events
          .filter(
            (e) =>
              e.type === 'conference' &&
              e.coords &&
              !e.coords.virtual &&
              new Date(e.startDate) <= cutoff,
          )
          .slice(0, 50);
      }

      const now = new Date();
      const mapEvents = (events || []).map((e: any) => ({
        id: e.id,
        title: e.title,
        location: e.location,
        lat: e.coords?.lat ?? 0,
        lng: e.coords?.lng ?? 0,
        country: e.coords?.country ?? '',
        startDate: e.startDate,
        endDate: e.endDate,
        url: e.url,
        daysUntil: Math.ceil(
          (new Date(e.startDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      }));

      this.ctx.latestTechEvents = mapEvents;
      this.ctx.map?.setTechEvents(mapEvents);
      this.ctx.map?.setLayerReady('techEvents', mapEvents.length > 0);
      this.ctx.statusPanel?.updateFeed('Tech Events', {
        status: 'ok',
        itemCount: mapEvents.length,
      });

      this.updateSearchIndex();
    } catch (error) {
      console.error('[App] Failed to load tech events:', error);
      this.ctx.latestTechEvents = [];
      this.ctx.map?.setTechEvents([]);
      this.ctx.map?.setLayerReady('techEvents', false);
      this.ctx.statusPanel?.updateFeed('Tech Events', {
        status: 'error',
        errorMessage: String(error),
      });
    }
  }

  async loadWeatherAlerts(): Promise<void> {
    try {
      const alerts = await fetchWeatherAlerts();
      this.ctx.map?.setWeatherAlerts(alerts);
      this.ctx.map?.setLayerReady('weather', alerts.length > 0);
      this.ctx.statusPanel?.updateFeed('Weather', { status: 'ok', itemCount: alerts.length });
      dataFreshness.recordUpdate('weather', alerts.length);
    } catch (error) {
      this.ctx.map?.setLayerReady('weather', false);
      this.ctx.statusPanel?.updateFeed('Weather', { status: 'error' });
      dataFreshness.recordError('weather', String(error));
    }
  }

  async loadAisSignals(): Promise<void> {
    try {
      const { disruptions, density } = await fetchAisSignals();
      const aisStatus = getAisStatus();
      console.log('[Ships] Events:', {
        disruptions: disruptions.length,
        density: density.length,
        vessels: aisStatus.vessels,
      });
      this.ctx.map?.setAisData(disruptions, density);
      this.ctx.intelligenceCache.aisDisruptions = disruptions;
      await runSignalAggregator(this.ctx.statusPanel, 'AIS disruptions', (aggregator) =>
        aggregator.ingestAisDisruptions(disruptions),
      );
      ingestAisDisruptionsForCII(disruptions);
      this.refreshCiiAndBrief();
      updateAndCheck([{ type: 'ais_gaps', region: 'global', count: disruptions.length }])
        .then(async (anomalies) => {
          if (anomalies.length > 0) {
            await runSignalAggregator(this.ctx.statusPanel, 'temporal anomalies', (aggregator) =>
              aggregator.ingestTemporalAnomalies(anomalies),
            );
            ingestTemporalAnomaliesForCII(anomalies);
            this.refreshCiiAndBrief();
          }
        })
        .catch(() => {});

      const hasData = disruptions.length > 0 || density.length > 0;
      this.ctx.map?.setLayerReady('ais', hasData);

      const shippingCount = disruptions.length + density.length;
      const shippingStatus = shippingCount > 0 ? 'ok' : aisStatus.connected ? 'warning' : 'error';
      this.ctx.statusPanel?.updateFeed('Shipping', {
        status: shippingStatus,
        itemCount: shippingCount,
        errorMessage:
          !aisStatus.connected && shippingCount === 0 ? 'AIS snapshot unavailable' : undefined,
      });
      this.ctx.statusPanel?.updateApi('AISStream', {
        status: aisStatus.connected ? 'ok' : 'warning',
      });
      if (hasData) {
        dataFreshness.recordUpdate('ais', shippingCount);
      }
    } catch (error) {
      this.ctx.map?.setLayerReady('ais', false);
      this.ctx.statusPanel?.updateFeed('Shipping', {
        status: 'error',
        errorMessage: String(error),
      });
      this.ctx.statusPanel?.updateApi('AISStream', { status: 'error' });
      dataFreshness.recordError('ais', String(error));
    }
  }

  waitForAisData(): void {
    const maxAttempts = 30;
    let attempts = 0;

    const checkData = () => {
      if (this.ctx.isDestroyed) return;
      attempts++;
      const status = getAisStatus();

      if (status.vessels > 0 || status.connected) {
        this.loadAisSignals();
        this.ctx.map?.setLayerLoading('ais', false);
        return;
      }

      if (attempts >= maxAttempts) {
        this.ctx.map?.setLayerLoading('ais', false);
        this.ctx.map?.setLayerReady('ais', false);
        this.ctx.statusPanel?.updateFeed('Shipping', {
          status: 'error',
          errorMessage: 'Connection timeout',
        });
        return;
      }

      setTimeout(checkData, 1000);
    };

    checkData();
  }

  private lastWebcamBbox: { w: number; s: number; e: number; n: number; zoom: number } | null =
    null;
  private lastWebcamFetchAt = 0;

  async loadWebcams(): Promise<void> {
    if (!this.ctx.map) return;
    try {
      const map = this.ctx.map;
      const zoom = Math.max(2, map.getState().zoom ?? 3);

      const now = Date.now();
      if (now - this.lastWebcamFetchAt < 1000) return;

      const bboxStr = map.getBbox();
      const parts = bboxStr ? bboxStr.split(',').map(Number) : [-180, -90, 180, 90];
      const w = parts[0] ?? -180;
      const s = parts[1] ?? -90;
      const e = parts[2] ?? 180;
      const n = parts[3] ?? 90;

      if (this.lastWebcamBbox && this.lastWebcamBbox.zoom === zoom) {
        const prev = this.lastWebcamBbox;
        const overlapW = Math.max(0, Math.min(prev.e, e) - Math.max(prev.w, w));
        const overlapH = Math.max(0, Math.min(prev.n, n) - Math.max(prev.s, s));
        const overlapArea = overlapW * overlapH;
        const currentArea = Math.max(0.001, (e - w) * (n - s));
        if (overlapArea / currentArea > 0.8) return;
      }

      this.lastWebcamFetchAt = now;
      this.lastWebcamBbox = { w, s, e, n, zoom };

      const { fetchWebcams } = await import('@/services/webcams');
      const result = await fetchWebcams(zoom, { w, s, e, n });

      const allMarkers = [...result.webcams, ...result.clusters];
      map.setWebcams(allMarkers);
      map.setLayerReady('webcams', allMarkers.length > 0);
    } catch (err) {
      console.warn('[data-loader] webcams failed:', err);
      this.ctx.map?.setLayerReady('webcams', false);
    }
  }

  async loadFlightDelays(): Promise<void> {
    try {
      const { fetchFlightDelays } = await import('@/services/aviation');
      const delays = await fetchFlightDelays();
      this.ctx.map?.setFlightDelays(delays);
      this.ctx.map?.setLayerReady('flights', delays.length > 0);
      this.ctx.intelligenceCache.flightDelays = delays;
      const severe = delays.filter(
        (d) => d.severity === 'major' || d.severity === 'severe' || d.delayType === 'closure',
      );
      if (severe.length > 0) ingestAviationForCII(severe);
      this.ctx.statusPanel?.updateFeed('Flights', {
        status: 'ok',
        itemCount: delays.length,
      });
      this.ctx.statusPanel?.updateApi('FAA', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('flights', false);
      this.ctx.statusPanel?.updateFeed('Flights', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('FAA', { status: 'error' });
    }
  }

  async loadMilitary(): Promise<void> {
    if (this.ctx.intelligenceCache.military) {
      const { flights, flightClusters, vessels, vesselClusters } =
        this.ctx.intelligenceCache.military;
      this.ctx.map?.setMilitaryFlights(flights, flightClusters);
      this.ctx.map?.setMilitaryVessels(vessels, vesselClusters);
      this.ctx.map?.updateMilitaryForEscalation(flights, vessels);
      this.loadCachedPosturesForBanner();
      setInsightsMilitaryFlights(flights);
      const hasData = flights.length > 0 || vessels.length > 0;
      this.ctx.map?.setLayerReady('military', hasData);
      const militaryCount = flights.length + vessels.length;
      this.ctx.statusPanel?.updateFeed('Military', {
        status: militaryCount > 0 ? 'ok' : 'warning',
        itemCount: militaryCount,
        errorMessage: militaryCount === 0 ? 'No military activity in view' : undefined,
      });
      this.ctx.statusPanel?.updateApi('OpenSky', { status: 'ok' });
      return;
    }
    try {
      const militaryVessels = await getMilitaryVesselsModule();
      if (militaryVessels.isMilitaryVesselTrackingConfigured()) {
        militaryVessels.initMilitaryVesselStream();
      }
      const [flightData, vesselData] = await Promise.all([
        fetchMilitaryFlights(),
        militaryVessels.fetchMilitaryVessels(),
      ]);
      this.ctx.intelligenceCache.military = {
        flights: flightData.flights,
        flightClusters: flightData.clusters,
        vessels: vesselData.vessels,
        vesselClusters: vesselData.clusters,
      };
      fetchUSNIFleetReport()
        .then((report) => {
          if (report) this.ctx.intelligenceCache.usniFleet = report;
        })
        .catch(() => {});
      this.ctx.map?.setMilitaryFlights(flightData.flights, flightData.clusters);
      this.ctx.map?.setMilitaryVessels(vesselData.vessels, vesselData.clusters);
      ingestFlights(flightData.flights);
      ingestVessels(vesselData.vessels);
      ingestMilitaryForCII(flightData.flights, vesselData.vessels);
      await runSignalAggregator(this.ctx.statusPanel, 'military tracks', (aggregator) => {
        aggregator.ingestFlights(flightData.flights);
        aggregator.ingestVessels(vesselData.vessels);
      });
      updateAndCheck([
        { type: 'military_flights', region: 'global', count: flightData.flights.length },
        { type: 'vessels', region: 'global', count: vesselData.vessels.length },
      ])
        .then(async (anomalies) => {
          if (anomalies.length > 0) {
            await runSignalAggregator(this.ctx.statusPanel, 'temporal anomalies', (aggregator) =>
              aggregator.ingestTemporalAnomalies(anomalies),
            );
            ingestTemporalAnomaliesForCII(anomalies);
            this.refreshCiiAndBrief();
          }
        })
        .catch(() => {});
      this.ctx.map?.updateMilitaryForEscalation(flightData.flights, vesselData.vessels);
      this.refreshCiiAndBrief();
      if (!isInLearningMode()) {
        await this.runMilitarySurgeAnalysis(flightData.flights);
      }

      this.loadCachedPosturesForBanner();
      setInsightsMilitaryFlights(flightData.flights);

      const hasData = flightData.flights.length > 0 || vesselData.vessels.length > 0;
      this.ctx.map?.setLayerReady('military', hasData);
      const militaryCount = flightData.flights.length + vesselData.vessels.length;
      this.ctx.statusPanel?.updateFeed('Military', {
        status: militaryCount > 0 ? 'ok' : 'warning',
        itemCount: militaryCount,
        errorMessage: militaryCount === 0 ? 'No military activity in view' : undefined,
      });
      this.ctx.statusPanel?.updateApi('OpenSky', { status: 'ok' });
      dataFreshness.recordUpdate('opensky', flightData.flights.length);
    } catch (error) {
      // A teardown that races an in-flight vessel load is a deliberate
      // cancellation, not a real fetch failure — leave feed/api state intact.
      if (isVesselRuntimeStoppedError(error)) return;
      this.ctx.map?.setLayerReady('military', false);
      this.ctx.statusPanel?.updateFeed('Military', {
        status: 'error',
        errorMessage: String(error),
      });
      this.ctx.statusPanel?.updateApi('OpenSky', { status: 'error' });
      dataFreshness.recordError('opensky', String(error));
    }
  }

  private async runMilitarySurgeAnalysis(flights: MilitaryFlight[]): Promise<void> {
    try {
      // military-surge pulls bases-expanded, so keep it off the eager boot graph
      // and make its optional enrichment non-fatal to the military fetch path.
      const {
        analyzeFlightsForSurge,
        surgeAlertToSignal,
        detectForeignMilitaryPresence,
        foreignPresenceToSignal,
      } = await import('@/services/military-surge');
      const surgeAlerts = analyzeFlightsForSurge(flights);
      if (surgeAlerts.length > 0) {
        const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
        addToSignalHistory(surgeSignals);
        if (this.shouldShowIntelligenceNotifications())
          this.showSignalNotification(surgeSignals, 'Military surge');
      }
      const foreignAlerts = detectForeignMilitaryPresence(flights);
      if (foreignAlerts.length > 0) {
        const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
        addToSignalHistory(foreignSignals);
        if (this.shouldShowIntelligenceNotifications())
          this.showSignalNotification(foreignSignals, 'Foreign presence');
      }
    } catch (error) {
      console.warn('[Intelligence] Military surge analysis skipped:', error);
    }
  }

  private async loadCachedPosturesForBanner(): Promise<void> {
    try {
      const data = await fetchCachedTheaterPosture();
      if (data && data.postures.length > 0) {
        this.callbacks.renderCriticalBanner(data.postures);
        setPostureData(data);
      }
    } catch (error) {
      console.warn('[App] Failed to load cached postures for banner:', error);
    }
  }

  async loadDiseaseOutbreaks(): Promise<void> {
    try {
      const data = await fetchDiseaseOutbreaks();
      if (data.outbreaks?.length) {
        this.ctx.map?.setDiseaseOutbreaks(data.outbreaks);
        this.ctx.map?.setLayerReady('diseaseOutbreaks', true);
      }
    } catch (e) {
      console.error('[App] Disease outbreaks load failed:', e);
    }
  }

  async runCorrelationAnalysis(): Promise<void> {
    try {
      if (this.ctx.latestClusters.length === 0 && this.ctx.allNews.length > 0) {
        this.ctx.latestClusters = mlWorker.isAvailable
          ? await clusterNewsHybrid(this.ctx.allNews)
          : await analysisWorker.clusterNews(this.ctx.allNews);
      }

      if (this.ctx.latestClusters.length > 0) {
        ingestNewsForCII(this.ctx.latestClusters);
        dataFreshness.recordUpdate('gdelt', this.ctx.latestClusters.length);
        this.refreshCiiAndBrief();
        setGeoHubActivities(getTopActiveGeoHubs(this.ctx.latestClusters));
        this.newsLoader.applyTechHubActivities();
      }

      const signals = await analysisWorker.analyzeCorrelations(
        this.ctx.latestClusters,
        this.ctx.latestPredictions,
        this.ctx.latestMarkets,
      );

      let geoSignals: ReturnType<typeof geoConvergenceToSignal>[] = [];
      if (!isInLearningMode()) {
        const geoAlerts = detectGeoConvergence(this.ctx.seenGeoAlerts);
        geoSignals = geoAlerts.map(geoConvergenceToSignal);
      }

      const keywordSpikeSignals = await drainTrendingSignalQueue();
      const allSignals = [...signals, ...geoSignals, ...keywordSpikeSignals];
      if (allSignals.length > 0) {
        addToSignalHistory(allSignals);
        if (this.shouldShowIntelligenceNotifications())
          this.showSignalNotification(allSignals, 'Correlation');
      }
    } catch (error) {
      console.error('[App] Correlation analysis failed:', error);
    }
  }

  async loadFirmsData(): Promise<void> {
    try {
      const fireResult = await fetchAllFires(1);
      if (fireResult.skipped) {
        this.ctx.statusPanel?.updateApi('FIRMS', { status: 'error' });
        return;
      }
      const { regions, totalCount } = fireResult;
      if (totalCount > 0) {
        const flat = flattenFires(regions);
        const satelliteFires = flat.map((f) => ({
          lat: f.location?.latitude ?? 0,
          lon: f.location?.longitude ?? 0,
          brightness: f.brightness,
          frp: f.frp,
          region: f.region,
          acq_date: new Date(f.detectedAt).toISOString().slice(0, 10),
        }));

        this.ctx.intelligenceCache.satelliteFires = satelliteFires;
        await runSignalAggregator(this.ctx.statusPanel, 'satellite fires', (aggregator) =>
          aggregator.ingestSatelliteFires(satelliteFires),
        );
        ingestSatelliteFiresForCII(satelliteFires);
        this.refreshCiiAndBrief();

        this.ctx.map?.setFires(toMapFires(flat));

        dataFreshness.recordUpdate('firms', totalCount);
      } else {
        this.ctx.intelligenceCache.satelliteFires = [];
        ingestSatelliteFiresForCII([]);
        this.refreshCiiAndBrief();
      }
      this.ctx.statusPanel?.updateApi('FIRMS', { status: 'ok' });
    } catch (e) {
      console.warn('[App] FIRMS load failed:', e);
      this.ctx.statusPanel?.updateApi('FIRMS', { status: 'error' });
      dataFreshness.recordError('firms', String(e));
    }
  }

  syncDataFreshnessWithLayers(): void {
    for (const [layer, sourceIds] of Object.entries(LAYER_TO_SOURCE)) {
      const enabled = this.ctx.mapLayers[layer as keyof MapLayers] ?? false;
      for (const sourceId of sourceIds) {
        dataFreshness.setEnabled(sourceId as DataSourceId, enabled);
      }
    }

    if (!isAisConfigured()) {
      dataFreshness.setEnabled('ais', false);
    }
    if (isOutagesConfigured() === false) {
      dataFreshness.setEnabled('outages', false);
    }
  }

  // Bumped to v2 alongside src/services/rss.ts CACHE_PREFIX (`feed:` →
  // `feed:v2:`). Pre-v2 entries here serialize NewsItem WITHOUT the new
  // `pubDateMissing` flag — on hydrate they get `undefined`, which
  // `effectivePubDateMs` treats as `false`, so items that previously had
  // synthesized `Date.now()` stamps would fraudulently claim freshness
  // for the 24h gate window. Pre-v2 entries are left to TTL out (no
  // explicit invalidation needed).
  private static readonly HAPPY_ITEMS_CACHE_KEY = 'happy-all-items:v2';

  async hydrateHappyPanelsFromCache(): Promise<void> {
    try {
      type CachedItem = Omit<NewsItem, 'pubDate'> & { pubDate?: number };
      const entry = await getPersistentCache<CachedItem[]>(DataLoaderManager.HAPPY_ITEMS_CACHE_KEY);
      if (!entry || !entry.data || entry.data.length === 0) return;
      if (Date.now() - entry.updatedAt > 24 * 60 * 60 * 1000) return;

      const items: NewsItem[] = entry.data.map((item) => ({
        ...item,
        pubDate: new Date(displayPubDateMs(item)),
      }));

      setHappyPanelData({ curatedItems: items, feedItems: items });
    } catch (err) {
      console.warn('[App] Happy panel cache hydration failed:', err);
    }
  }

  private async loadHappySupplementaryAndRender(): Promise<void> {
    const curated = [...this.ctx.happyAllItems];
    // Early render with curated-only items
    setHappyPanelData({ curatedItems: curated, feedItems: curated });

    let supplementary: NewsItem[] = [];
    try {
      const gdeltTopics = await fetchAllPositiveTopicIntelligence();
      const gdeltItems: NewsItem[] = gdeltTopics.flatMap((topic) =>
        topic.articles.map((article) => ({
          source: 'GDELT',
          title: article.title,
          link: article.url,
          pubDate: article.date ? new Date(article.date) : new Date(),
          isAlert: false,
          imageUrl: article.image || undefined,
          happyCategory: classifyNewsItem('GDELT', article.title),
        })),
      );

      supplementary = await filterBySentiment(gdeltItems);
    } catch (err) {
      console.warn('[App] Happy supplementary pipeline failed, using curated only:', err);
    }

    if (supplementary.length > 0) {
      const merged = [...curated, ...supplementary];
      merged.sort((a, b) => effectivePubDateMs(b) - effectivePubDateMs(a));
      // Update feedItems with GDELT-merged list; curatedItems stay as curated
      setHappyPanelData({ curatedItems: curated, feedItems: merged });
    }

    setPersistentCache(
      DataLoaderManager.HAPPY_ITEMS_CACHE_KEY,
      this.ctx.happyAllItems.map((item) => ({
        ...item,
        pubDate: displayPubDateMs(item),
      })),
    ).catch(() => {});
  }

  private async loadPositiveEvents(): Promise<void> {
    const hydrated = getHydratedData('positiveGeoEvents') as
      | {
          events?: Array<{
            latitude: number;
            longitude: number;
            name: string;
            category: string;
            count: number;
            timestamp: number;
          }>;
        }
      | undefined;
    let gdeltEvents: PositiveGeoEvent[];
    if (hydrated?.events?.length) {
      gdeltEvents = hydrated.events.map((e) => ({
        lat: e.latitude,
        lon: e.longitude,
        name: e.name,
        category: (e.category || 'humanity-kindness') as HappyContentCategory,
        count: e.count,
        timestamp: e.timestamp,
      }));
    } else {
      gdeltEvents = await fetchPositiveGeoEvents();
    }
    const rssEvents = geocodePositiveNewsItems(
      this.ctx.happyAllItems.map((item) => ({
        title: item.title,
        category: item.happyCategory,
      })),
    );
    const seen = new Set<string>();
    const merged = [...gdeltEvents, ...rssEvents].filter((e) => {
      if (seen.has(e.name)) return false;
      seen.add(e.name);
      return true;
    });
    this.ctx.map?.setPositiveEvents(merged);
  }

  private loadKindnessData(): void {
    const kindnessItems = fetchKindnessData(
      this.ctx.happyAllItems.map((item) => ({
        title: item.title,
        happyCategory: item.happyCategory,
      })),
    );
    this.ctx.map?.setKindnessData(kindnessItems);
  }

  private async loadSpeciesData(): Promise<void> {
    const species = await fetchConservationWins();
    this.ctx.map?.setSpeciesRecoveryZones(species);
    if (SITE_VARIANT === 'happy' && species.length > 0) {
      checkMilestones({
        speciesRecoveries: species.map((s) => ({ name: s.commonName, status: s.recoveryStatus })),
        newSpeciesCount: species.length,
      });
    }
  }

  private async loadRenewableData(): Promise<void> {
    const { fetchRenewableEnergyData } = await import('@/services/renewable-energy-data');
    const result = await fetchRenewableEnergyData();
    if (SITE_VARIANT === 'happy' && result.state === 'live' && result.data?.globalPercentage) {
      checkMilestones({
        renewablePercent: result.data.globalPercentage,
      });
    }
  }
}
