import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { getHydratedData } from '@/services/bootstrap';
import { proFreshRpcFetch } from '@/services/premium-fetch';
import type { ListStablecoinMarketsResponse, Stablecoin, StablecoinSummary } from '@/generated/client/worldmonitor/market/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLargeNum(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

function pegClass(status: string): string {
  if (status === 'ON PEG')       return 'peg-on';
  if (status === 'SLIGHT DEPEG') return 'peg-slight';
  return 'peg-off';
}

function healthClass(status: string): string {
  if (status === 'HEALTHY') return 'health-good';
  if (status === 'CAUTION') return 'health-caution';
  return 'health-warning';
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchStablecoins(_signal: AbortSignal): Promise<ListStablecoinMarketsResponse> {
  const hydrated = getHydratedData('stablecoinMarkets') as ListStablecoinMarketsResponse | undefined;
  if (hydrated?.stablecoins?.length) return hydrated;

  const { MarketServiceClient } = await import('@/services/generated-rpc-clients');
  const { getRpcBaseUrl } = await import('@/services/rpc-client');
  const client = new MarketServiceClient(getRpcBaseUrl(), { fetch: proFreshRpcFetch });
  return client.listStablecoinMarkets({ coins: [] });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HealthBar({ s }: { s: StablecoinSummary }) {
  return (
    <div className={`stable-health ${healthClass(s.healthStatus)}`}>
      <span className="health-label">{s.healthStatus}</span>
      <span className="health-detail">MCap: {formatLargeNum(s.totalMarketCap)} | Vol: {formatLargeNum(s.totalVolume24h)}</span>
    </div>
  );
}

function PegRow({ c }: { c: Stablecoin }) {
  return (
    <div className="stable-row">
      <div className="stable-info">
        <span className="stable-symbol">{c.symbol}</span>
        <span className="stable-name">{c.name}</span>
      </div>
      <div className="stable-price">${c.price.toFixed(4)}</div>
      <div className={`stable-peg ${pegClass(c.pegStatus)}`}>
        <span className="peg-badge">{c.pegStatus}</span>
        <span className="peg-dev">{c.deviation.toFixed(2)}%</span>
      </div>
    </div>
  );
}

function SupplyRow({ c }: { c: Stablecoin }) {
  return (
    <div className="stable-supply-row">
      <span className="stable-symbol">{c.symbol}</span>
      <span className="stable-mcap">{formatLargeNum(c.marketCap)}</span>
      <span className="stable-vol">{formatLargeNum(c.volume24h)}</span>
      <span className={`stable-change ${c.change24h >= 0 ? 'change-positive' : 'change-negative'}`}>
        {c.change24h >= 0 ? '+' : ''}{c.change24h.toFixed(2)}%
      </span>
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside Panel base class's content div. */
export function StablecoinPanelContent() {
  const { data, loading, error, refetch } = usePanelData<ListStablecoinMarketsResponse>(fetchStablecoins, {
    hydrationKey: 'stablecoinMarkets',
    ttlMs: 5 * 60 * 1000,
  });

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar"><div className="panel-radar-sweep" /><div className="panel-radar-dot" /></div>
        <div className="panel-loading-text">{t('common.loadingStablecoins')}</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.noDataShort')}</div>
        <button className="panel-error-retry" data-panel-retry onClick={refetch}>Retry</button>
      </div>
    );
  }

  if (!data.stablecoins?.length) {
    return <div className="panel-empty">{t('common.noDataShort')}</div>;
  }

  const s = data.summary ?? { totalMarketCap: 0, totalVolume24h: 0, coinCount: 0, depeggedCount: 0, healthStatus: 'UNAVAILABLE' };

  return (
    <div className="stablecoin-container">
      <HealthBar s={s} />

      <div className="stable-section">
        <div className="stable-section-title">{t('components.stablecoins.pegHealth')}</div>
        <div className="stable-peg-list">
          {data.stablecoins.map(c => <PegRow key={c.id} c={c} />)}
        </div>
      </div>

      <div className="stable-section">
        <div className="stable-section-title">{t('components.stablecoins.supplyVolume')}</div>
        <div className="stable-supply-header">
          <span>{t('components.stablecoins.token')}</span>
          <span>{t('components.stablecoins.mcap')}</span>
          <span>{t('components.stablecoins.vol24h')}</span>
          <span>{t('components.stablecoins.chg24h')}</span>
        </div>
        <div className="stable-supply-list">
          {data.stablecoins.map(c => <SupplyRow key={c.id} c={c} />)}
        </div>
      </div>
    </div>
  );
}

export function StablecoinPanel() {
  return (
    <PanelShell
      id="stablecoins"
      title={t('panels.stablecoins')}
      infoTooltip={t('components.stablecoins.infoTooltip')}
    >
      <StablecoinPanelContent />
    </PanelShell>
  );
}
