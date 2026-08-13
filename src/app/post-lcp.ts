import type { AppContext } from '@/app/app-context';
import type { DataLoaderManager } from '@/app/data-loader';
import { markLcpDebug } from '@/utils/lcp-debug';
import { waitForBootstrapSlowTier } from '@/services/bootstrap';
import { isDesktopRuntime } from '@/services/runtime';
import { preloadCountryGeometry } from '@/services/country-geometry';
import { startLearning } from '@/services/country-instability';

export async function waitForSlowBootstrapCheckpoint(ctx: AppContext): Promise<void> {
  markLcpDebug('wm:data:slow-tier-wait-start');
  try {
    const settled = await waitForBootstrapSlowTier(isDesktopRuntime() ? 8_500 : 3_500);
    markLcpDebug('wm:data:slow-tier-wait-end', { settled });
    if (ctx.isDestroyed) return;
    document.dispatchEvent(new CustomEvent('wm:bootstrap-state-changed'));
  } catch {
    markLcpDebug('wm:data:slow-tier-wait-error');
  }
}

export async function preloadCountryGeometryForPostLcpWork(): Promise<void> {
  markLcpDebug('wm:data:country-geometry-start');
  try {
    await preloadCountryGeometry();
    markLcpDebug('wm:data:country-geometry-ready');
  } catch {
    markLcpDebug('wm:data:country-geometry-error');
  }
}

export function startPostLcpIntelligence(
  ctx: AppContext,
  dataLoader: DataLoaderManager,
  countryGeometryReady: Promise<void>,
  geometryAlreadyApplied: boolean,
): void {
  void countryGeometryReady.finally(() => {
    if (ctx.isDestroyed) return;
    // Replay geometry-dependent CII only when the fan-out ingested before
    // precision geometry was ready; otherwise the first-pass attribution is
    // already correct and a replay is a redundant compute + repaint (#4512).
    if (!geometryAlreadyApplied) {
      dataLoader.refreshGeometryDependentCiiAfterCountryGeometry();
    }
    // Correlation and country-learning use precision geometry/name matching,
    // but they are post-initial-data work and should not hold the LCP path.
    void loadInitialCorrelationEngine(ctx);
    startLearning();
  });
}

async function loadInitialCorrelationEngine(ctx: AppContext): Promise<void> {
  try {
    const {
      CorrelationEngine,
      militaryAdapter,
      escalationAdapter,
      economicAdapter,
      disasterAdapter,
    } = await import('@/services/correlation-engine');

    if (ctx.isDestroyed) return;
    const engine = new CorrelationEngine();
    engine.registerAdapter(militaryAdapter);
    engine.registerAdapter(escalationAdapter);
    engine.registerAdapter(economicAdapter);
    engine.registerAdapter(disasterAdapter);
    ctx.correlationEngine = engine;

    const { setCorrelationCards } = await import('@/services/correlation-store');
    await engine.run(ctx);
    if (ctx.isDestroyed) return;
    for (const domain of ['military', 'escalation', 'economic', 'disaster'] as const) {
      setCorrelationCards(domain, engine.getCards(domain));
    }
  } catch (error) {
    console.warn('[CorrelationEngine] Initial lazy load/run failed:', error);
  }
}
