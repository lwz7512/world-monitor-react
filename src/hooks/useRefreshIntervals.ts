import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { REFRESH_INTERVALS, SITE_VARIANT } from '@/config';
import { hasPremiumAccess } from '@/services/panel-gating';
import { refreshDataFreshnessFromHealth } from '@/services/health-freshness';
import { scheduleAfterFirstPaint } from '@/utils/after-paint';

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';

export function useRefreshIntervals() {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx?.refreshScheduler || !ctx?.dataLoader) return;
    const c = ctx;
    const scheduler = c.refreshScheduler!;
    const loader = c.dataLoader!;

    function isPanelNearViewport(panelId: string, marginPx = 400): boolean {
      const panel = c.panels[panelId] as { isNearViewport?: (m?: number) => boolean } | undefined;
      return panel?.isNearViewport?.(marginPx) ?? false;
    }
    function isAnyPanelNearViewport(panelIds: string[], marginPx = 400): boolean {
      return panelIds.some((id) => isPanelNearViewport(id, marginPx));
    }
    function shouldRefreshIntelligence(): boolean {
      return (
        isAnyPanelNearViewport(['cii', 'strategic-risk', 'strategic-posture']) ||
        !!c.countryBriefPage?.isVisible()
      );
    }
    function shouldRefreshFirms(): boolean {
      return isPanelNearViewport('satellite-fires');
    }
    function shouldRefreshCorrelation(): boolean {
      return isAnyPanelNearViewport([
        'military-correlation',
        'escalation-correlation',
        'economic-correlation',
        'disaster-correlation',
      ]);
    }

    // Always refresh news for all variants
    scheduler.scheduleRefresh('news', () => loader.loadNews(), REFRESH_INTERVALS.feeds);
    // Registration (and its immediate first hydration) is deferred to
    // post-paint idle: freshness badges are below-the-fold decoration, so the
    // fetch must not compete with the LCP-window requests (#4907, #4890).
    scheduleAfterFirstPaint(() => {
      scheduler.scheduleRefresh(
        'health-freshness',
        async () => {
          await refreshDataFreshnessFromHealth();
        },
        REFRESH_INTERVALS.healthFreshness,
        undefined,
        { runImmediately: true },
      );
    });

    // Happy variant only refreshes news -- skip all geopolitical/financial/military refreshes
    if (SITE_VARIANT !== 'happy') {
      scheduler.registerAll([
        {
          name: 'markets',
          fn: () => loader.loadMarkets(),
          intervalMs: REFRESH_INTERVALS.markets,
          condition: () =>
            isAnyPanelNearViewport([
              'markets',
              'heatmap',
              'commodities',
              'crypto',
              'crypto-heatmap',
              'defi-tokens',
              'ai-tokens',
              'other-tokens',
            ]),
        },
        {
          name: 'predictions',
          fn: () => loader.loadPredictions(),
          intervalMs: REFRESH_INTERVALS.predictions,
          condition: () => isPanelNearViewport('polymarket'),
        },
        {
          name: 'forecasts',
          fn: () => loader.loadForecasts(),
          intervalMs: REFRESH_INTERVALS.forecasts,
          condition: () => isPanelNearViewport('forecast'),
        },
        {
          name: 'pizzint',
          fn: () => loader.loadPizzInt(),
          intervalMs: REFRESH_INTERVALS.pizzint,
          condition: () => SITE_VARIANT === 'full',
        },
        {
          name: 'natural',
          fn: () => loader.loadNatural(),
          intervalMs: REFRESH_INTERVALS.natural,
          condition: () => c.mapLayers.natural,
        },
        {
          name: 'weather',
          fn: () => loader.loadWeatherAlerts(),
          intervalMs: REFRESH_INTERVALS.weather,
          condition: () => c.mapLayers.weather,
        },
        {
          name: 'fred',
          fn: () => loader.loadFredData(),
          intervalMs: REFRESH_INTERVALS.fred,
          condition: () => isPanelNearViewport('economic'),
        },
        {
          name: 'spending',
          fn: () => loader.loadGovernmentSpending(),
          intervalMs: REFRESH_INTERVALS.spending,
          condition: () => isPanelNearViewport('economic'),
        },
        {
          name: 'global-tenders',
          fn: () => loader.loadGlobalTenders(),
          intervalMs: REFRESH_INTERVALS.spending,
          condition: () => hasPremiumAccess() && isPanelNearViewport('global-procurement'),
        },
        {
          name: 'bis',
          fn: () => loader.loadBisData(),
          intervalMs: REFRESH_INTERVALS.bis,
          condition: () => isPanelNearViewport('economic'),
        },
        {
          name: 'oil',
          fn: () => loader.loadOilAnalytics(),
          intervalMs: REFRESH_INTERVALS.oil,
          condition: () => isPanelNearViewport('energy-complex'),
        },
        {
          name: 'firms',
          fn: () => loader.loadFirmsData(),
          intervalMs: REFRESH_INTERVALS.firms,
          condition: () => shouldRefreshFirms(),
        },
        {
          name: 'ais',
          fn: () => loader.loadAisSignals(),
          intervalMs: REFRESH_INTERVALS.ais,
          condition: () => c.mapLayers.ais,
        },
        {
          name: 'cables',
          fn: () => loader.loadCableActivity(),
          intervalMs: REFRESH_INTERVALS.cables,
          condition: () => c.mapLayers.cables,
        },
        {
          name: 'cableHealth',
          fn: () => loader.loadCableHealth(),
          intervalMs: REFRESH_INTERVALS.cableHealth,
          condition: () => c.mapLayers.cables,
        },
        {
          name: 'flights',
          fn: () => loader.loadFlightDelays(),
          intervalMs: REFRESH_INTERVALS.flights,
          condition: () => c.mapLayers.flights,
        },
        {
          name: 'cyberThreats',
          fn: () => {
            c.cyberThreatsCache = null;
            return loader.loadCyberThreats();
          },
          intervalMs: REFRESH_INTERVALS.cyberThreats,
          condition: () => CYBER_LAYER_ENABLED && c.mapLayers.cyberThreats,
        },
      ]);
    }

    if (SITE_VARIANT === 'finance') {
      scheduler.scheduleRefresh(
        'stock-analysis',
        () => loader.loadStockAnalysis(),
        REFRESH_INTERVALS.stockAnalysis,
        () => hasPremiumAccess() && isPanelNearViewport('stock-analysis'),
      );
      scheduler.scheduleRefresh(
        'daily-market-brief',
        () => loader.loadDailyMarketBrief(),
        REFRESH_INTERVALS.dailyMarketBrief,
        () => hasPremiumAccess() && isPanelNearViewport('daily-market-brief'),
      );
      scheduler.scheduleRefresh(
        'stock-backtest',
        () => loader.loadStockBacktest(),
        REFRESH_INTERVALS.stockBacktest,
        () => hasPremiumAccess() && isPanelNearViewport('stock-backtest'),
      );
      scheduler.scheduleRefresh(
        'market-implications',
        () => loader.loadMarketImplications(),
        REFRESH_INTERVALS.marketImplications,
        () => hasPremiumAccess() && isPanelNearViewport('market-implications'),
      );
    }

    scheduler.scheduleRefresh(
      'wsb-tickers',
      () => loader.loadWsbTickers(),
      REFRESH_INTERVALS.wsbTickers,
      () => hasPremiumAccess() && isPanelNearViewport('wsb-ticker-scanner'),
    );

    // Server-side temporal anomalies (news + satellite_fires)
    if (SITE_VARIANT !== 'happy') {
      scheduler.scheduleRefresh(
        'temporalBaseline',
        () => loader.refreshTemporalBaseline(),
        REFRESH_INTERVALS.temporalBaseline,
        () => shouldRefreshIntelligence(),
      );
    }

    // WTO trade policy data — annual data, poll every 10 min to avoid hammering upstream.
    // PRO-gated: the isNearViewport check is a visibility gate, not an entitlement gate,
    // so without hasPremiumAccess() here we'd still hit the 6 WTO RPCs every poll for
    // free users once the panel scrolled into view.
    if (
      SITE_VARIANT === 'full' ||
      SITE_VARIANT === 'finance' ||
      SITE_VARIANT === 'commodity' ||
      SITE_VARIANT === 'energy'
    ) {
      scheduler.scheduleRefresh(
        'tradePolicy',
        () => loader.loadTradePolicy(),
        REFRESH_INTERVALS.tradePolicy,
        () => hasPremiumAccess() && isPanelNearViewport('trade-policy'),
      );
      scheduler.scheduleRefresh(
        'supplyChain',
        () => loader.loadSupplyChain(),
        REFRESH_INTERVALS.supplyChain,
        () => isPanelNearViewport('supply-chain'),
      );
      scheduler.scheduleRefresh(
        'chinaCorridors',
        () => loader.loadChinaCorridors(),
        REFRESH_INTERVALS.chinaCorridors,
        () => isPanelNearViewport('china-corridors'),
      );
      scheduler.scheduleRefresh(
        'chinaActivityNowcast',
        () => loader.loadChinaActivityNowcast(),
        REFRESH_INTERVALS.chinaActivityNowcast,
        () => isPanelNearViewport('china-activity-nowcast'),
      );
    }

    scheduler.scheduleRefresh(
      'cross-source-signals',
      () => loader.loadCrossSourceSignals(),
      REFRESH_INTERVALS.crossSourceSignals,
      () => isPanelNearViewport('cross-source-signals'),
    );

    // Refresh intelligence signals for CII (geopolitical variant only)
    if (SITE_VARIANT === 'full') {
      scheduler.scheduleRefresh(
        'intelligence',
        () => {
          const { military, iranEvents } = c.intelligenceCache;
          c.intelligenceCache = {};
          if (military) c.intelligenceCache.military = military;
          if (iranEvents) c.intelligenceCache.iranEvents = iranEvents;
          return loader.loadIntelligenceSignals();
        },
        REFRESH_INTERVALS.intelligence,
        () => shouldRefreshIntelligence(),
      );
    }

    // Correlation engine refresh
    scheduler.scheduleRefresh(
      'correlation-engine',
      async () => {
        const engine = c.correlationEngine;
        if (!engine) return;
        const { setCorrelationCards } = await import('@/services/correlation-store');
        await engine.run(c);
        for (const domain of ['military', 'escalation', 'economic', 'disaster'] as const) {
          setCorrelationCards(domain, engine.getCards(domain));
        }
      },
      REFRESH_INTERVALS.correlationEngine,
      () => shouldRefreshCorrelation(),
    );
    // No cleanup — RefreshScheduler.destroy() handles teardown via App.destroy()
  }, [ctx]);
}
