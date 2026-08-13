import type { AppContext } from '@/app/app-context';
import { hasPremiumAccess } from '@/services/panel-gating';

function isPanelNearViewport(ctx: AppContext, panelId: string, marginPx = 400): boolean {
  const panel = ctx.panels[panelId] as
    { isNearViewport?: (marginPx?: number) => boolean } | undefined;
  return panel?.isNearViewport?.(marginPx) ?? false;
}

function isAnyPanelNearViewport(ctx: AppContext, panelIds: string[], marginPx = 400): boolean {
  return panelIds.some((panelId) => isPanelNearViewport(ctx, panelId, marginPx));
}

export async function primeVisiblePanelData(ctx: AppContext, forceAll = false): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  const primeTask = (key: string, task: () => Promise<unknown>): void => {
    if (ctx.visiblePanelPrimed.has(key) || ctx.inFlight.has(key)) return;
    const wrapped = (async () => {
      ctx.inFlight.add(key);
      try {
        await task();
        ctx.visiblePanelPrimed.add(key);
      } finally {
        ctx.inFlight.delete(key);
      }
    })();
    tasks.push(wrapped);
  };

  const shouldPrime = (id: string): boolean => forceAll || isPanelNearViewport(ctx, id);
  const shouldPrimeAny = (ids: string[]): boolean => forceAll || isAnyPanelNearViewport(ctx, ids);

  if (shouldPrimeAny(['markets', 'heatmap', 'commodities', 'crypto', 'energy-complex'])) {
    primeTask('markets', () => ctx.dataLoader!.loadMarkets());
  }
  if (shouldPrime('polymarket')) {
    primeTask('predictions', () => ctx.dataLoader!.loadPredictions());
  }
  if (shouldPrime('economic')) {
    primeTask('fred', () => ctx.dataLoader!.loadFredData());
    primeTask('spending', () => ctx.dataLoader!.loadGovernmentSpending());
    primeTask('bis', () => ctx.dataLoader!.loadBisData());
  }
  if (shouldPrime('global-procurement') && hasPremiumAccess()) {
    primeTask('global-tenders', () => ctx.dataLoader!.loadGlobalTenders());
  }
  if (shouldPrime('energy-complex')) {
    primeTask('oil', () => ctx.dataLoader!.loadOilAnalytics());
  }
  // trade-policy moved into the _wmAccess block below — see fix for
  // anonymous 401 bug where loadTradePolicy fired 6 PRO-gated RPCs
  // unconditionally on every page load.
  if (shouldPrime('supply-chain')) {
    primeTask('supplyChain', () => ctx.dataLoader!.loadSupplyChain());
  }
  if (shouldPrime('china-corridors')) {
    primeTask('chinaCorridors', () => ctx.dataLoader!.loadChinaCorridors());
  }
  if (shouldPrime('china-activity-nowcast')) {
    primeTask('chinaActivityNowcast', () => ctx.dataLoader!.loadChinaActivityNowcast());
  }
  if (shouldPrime('cross-source-signals')) {
    primeTask('crossSourceSignals', () => ctx.dataLoader!.loadCrossSourceSignals());
  }

  const _wmAccess = hasPremiumAccess();
  if (_wmAccess) {
    if (shouldPrime('trade-policy')) {
      primeTask('tradePolicy', () => ctx.dataLoader!.loadTradePolicy());
    }
    if (shouldPrime('stock-analysis')) {
      primeTask('stockAnalysis', () => ctx.dataLoader!.loadStockAnalysis());
    }
    if (shouldPrime('stock-backtest')) {
      primeTask('stockBacktest', () => ctx.dataLoader!.loadStockBacktest());
    }
    if (shouldPrime('daily-market-brief')) {
      primeTask('dailyMarketBrief', () => ctx.dataLoader!.loadDailyMarketBrief());
    }
    if (shouldPrime('market-implications')) {
      primeTask('marketImplications', () => ctx.dataLoader!.loadMarketImplications());
    }
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
  }
}
