import { useCallback } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { getHydratedData } from '@/services/bootstrap';
import { t } from '@/services/i18n';
import type { HyperliquidAssetFlow } from '@/generated/client/worldmonitor/market/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AssetView {
  symbol: string;
  display: string;
  group: string;
  funding: number | null;
  oiDelta1h: number | null;
  composite: number;
  warmup: boolean;
  stale: boolean;
}

export interface PositioningData {
  warmup: boolean;
  commodityAssets: AssetView[];
  cryptoAssets: AssetView[];
  fxAssets: AssetView[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ELEVATED_THRESHOLD = 40;

const CLICK_TARGETS: Record<string, string> = {
  BTC: 'crypto', ETH: 'crypto', SOL: 'crypto',
  PAXG: 'commodities',
  'xyz:CL': 'commodities', 'xyz:BRENTOIL': 'commodities',
  'xyz:GOLD': 'commodities', 'xyz:SILVER': 'commodities',
  'xyz:PLATINUM': 'commodities', 'xyz:PALLADIUM': 'commodities',
  'xyz:COPPER': 'commodities', 'xyz:NATGAS': 'commodities',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFiniteNumber(v: string | number | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function oiDelta1h(sparkOi: number[] | undefined): number | null {
  if (!Array.isArray(sparkOi) || sparkOi.length < 13) return null;
  const last     = sparkOi[sparkOi.length - 1]!;
  const lookback = sparkOi[sparkOi.length - 13]!;
  if (!(lookback > 0) || !Number.isFinite(last)) return null;
  return (last - lookback) / lookback;
}

function mapAsset(a: HyperliquidAssetFlow | Record<string, unknown>, fromSeed: boolean): AssetView {
  const sparkOi = Array.isArray(a.sparkOi) ? (a.sparkOi as number[]).filter(v => Number.isFinite(v)) : [];
  return {
    symbol:    String(a.symbol ?? ''),
    display:   String(a.display ?? ''),
    group:     String(a.group ?? ''),
    funding:   fromSeed
      ? (typeof a.funding === 'number' && Number.isFinite(a.funding) ? a.funding : null)
      : parseFiniteNumber(a.funding as string | number | undefined),
    oiDelta1h: oiDelta1h(sparkOi),
    composite: Number(a.composite || 0),
    warmup:    Boolean(a.warmup),
    stale:     Boolean(a.stale),
  };
}

function mapAssets(assets: Array<HyperliquidAssetFlow | Record<string, unknown>>, fromSeed: boolean): Omit<PositioningData, 'warmup'> {
  const commodityAssets: AssetView[] = [], cryptoAssets: AssetView[] = [], fxAssets: AssetView[] = [];
  for (const a of assets) {
    const v = mapAsset(a, fromSeed);
    if (v.group === 'fx') fxAssets.push(v);
    else if (v.group === 'crypto') cryptoAssets.push(v);
    else commodityAssets.push(v);
  }
  return { commodityAssets, cryptoAssets, fxAssets };
}

function gaugeColor(score: number, funding: number | null): string {
  if (score < 15) return 'var(--text-dim)';
  const bearish = funding != null && funding < 0;
  if (bearish) {
    if (score >= 60) return '#e74c3c';
    if (score >= 40) return '#e67e22';
    return '#c0392b88';
  }
  if (score >= 60) return '#2ecc71';
  if (score >= 40) return '#27ae60';
  return '#2ecc7188';
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchPositioning(_signal: AbortSignal): Promise<PositioningData> {
  // Bootstrap hydration first
  const hydrated = getHydratedData('hyperliquidFlow') as Record<string, unknown> | undefined;
  let initial: PositioningData | null = null;
  if (hydrated && !hydrated.unavailable && Array.isArray(hydrated.assets) && hydrated.assets.length > 0) {
    initial = { ...mapAssets(hydrated.assets as Array<Record<string, unknown>>, true), warmup: Boolean(hydrated.warmup) };
  }

  const { MarketServiceClient } = await import('@/generated/client/worldmonitor/market/v1/service_client');
  const { getRpcBaseUrl } = await import('@/services/rpc-client');
  const client = new MarketServiceClient(getRpcBaseUrl(), {
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  });

  try {
    const resp = await client.getHyperliquidFlow({});
    if (resp.unavailable || !resp.assets?.length) {
      return initial ?? { warmup: true, commodityAssets: [], cryptoAssets: [], fxAssets: [] };
    }
    return { ...mapAssets(resp.assets as HyperliquidAssetFlow[], false), warmup: Boolean(resp.warmup) };
  } catch {
    return initial ?? { warmup: true, commodityAssets: [], cryptoAssets: [], fxAssets: [] };
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ArcGauge({ score, color, size = 56 }: { score: number; color: string; size?: number }) {
  const r          = (size - 6) / 2;
  const cx         = size / 2;
  const cy         = size / 2 + 2;
  const startAngle = Math.PI * 0.8;
  const endAngle   = Math.PI * 2.2;
  const fillAngle  = startAngle + (score / 100) * (endAngle - startAngle);
  const largeArc   = (fillAngle - startAngle) > Math.PI ? 1 : 0;
  const opacity    = score < 15 ? 0.4 : score < 40 ? 0.6 : 0.9;

  const bgX1 = cx + r * Math.cos(startAngle), bgY1 = cy + r * Math.sin(startAngle);
  const bgX2 = cx + r * Math.cos(endAngle),   bgY2 = cy + r * Math.sin(endAngle);
  const fX2  = cx + r * Math.cos(fillAngle),  fY2  = cy + r * Math.sin(fillAngle);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pos-gauge">
      <path d={`M ${bgX1} ${bgY1} A ${r} ${r} 0 1 1 ${bgX2} ${bgY2}`}
        fill="none" stroke="var(--border-color, #333)" strokeWidth={3} strokeLinecap="round" />
      {score > 0 && (
        <path d={`M ${bgX1} ${bgY1} A ${r} ${r} 0 ${largeArc} 1 ${fX2} ${fY2}`}
          fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" opacity={opacity} />
      )}
      <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={13} fontWeight={600} opacity={opacity}>
        {Math.round(score)}
      </text>
    </svg>
  );
}

function AssetCard({ asset, onNavigate }: { asset: AssetView; onNavigate: (symbol: string) => void }) {
  const score       = Math.round(asset.composite);
  const color       = gaugeColor(score, asset.funding);
  const elevated    = score >= ELEVATED_THRESHOLD;
  const hasTarget   = Boolean(CLICK_TARGETS[asset.symbol]);
  const fundingStr  = asset.funding != null ? `${(asset.funding * 100).toFixed(3)}%` : '--';
  const fundingCls  = asset.funding != null && asset.funding < 0 ? 'change-negative' : 'change-positive';
  const oiStr       = asset.oiDelta1h != null ? `${asset.oiDelta1h >= 0 ? '+' : ''}${(asset.oiDelta1h * 100).toFixed(1)}%` : '--';
  const oiCls       = asset.oiDelta1h != null && asset.oiDelta1h < 0 ? 'change-negative' : 'change-positive';

  const title = `${asset.symbol} score ${score}/100`
    + (asset.funding != null ? ` | funding ${fundingStr}` : '')
    + (asset.oiDelta1h != null ? ` | OI delta ${oiStr}` : '')
    + (asset.warmup ? ' | warming up' : '')
    + (asset.stale  ? ' | upstream stale' : '');

  const cls = `pos-card${elevated ? ' pos-card--elevated' : ''}${hasTarget ? ' pos-card--clickable' : ''}`;

  return (
    <div
      className={cls}
      title={title}
      style={elevated ? { '--pos-glow-color': color } as React.CSSProperties : undefined}
      onClick={hasTarget ? () => onNavigate(asset.symbol) : undefined}
    >
      <div className="pos-card__name">
        {asset.display}
        {asset.stale  && <span className="pos-badge pos-badge--stale">stale</span>}
        {asset.warmup && <span className="pos-badge pos-badge--warmup">warm</span>}
      </div>
      <ArcGauge score={score} color={color} />
      <div className="pos-card__metrics">
        <span className={fundingCls} title="hourly funding">{fundingStr}</span>
        <span className={oiCls} title="OI delta 1h">{oiStr}</span>
      </div>
    </div>
  );
}

function PositionSection({ header, assets, onNavigate }: { header: string; assets: AssetView[]; onNavigate: (symbol: string) => void }) {
  if (assets.length === 0) return null;
  const sorted = [...assets].sort((a, b) => b.composite - a.composite);
  return (
    <div className="pos-section">
      <div className="pos-section__header">{header}</div>
      <div className="pos-grid">
        {sorted.map(a => <AssetCard key={a.symbol} asset={a} onNavigate={onNavigate} />)}
      </div>
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside Panel base class's content div. */
export function PositioningPanelContent() {
  const { data, loading, error, refetch } = usePanelData<PositioningData>(fetchPositioning, {
    hydrationKey: 'hyperliquidFlow',
    ttlMs: 5 * 60 * 1000,
  });

  const handleNavigate = useCallback((symbol: string) => {
    const panelId = CLICK_TARGETS[symbol];
    if (!panelId) return;
    const panelEl = document.querySelector<HTMLElement>(`[data-panel="${panelId}"]`);
    if (panelEl) {
      panelEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      panelEl.classList.add('panel-highlight');
      setTimeout(() => panelEl.classList.remove('panel-highlight'), 1500);
    }
  }, []);

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar"><div className="panel-radar-sweep" /><div className="panel-radar-dot" /></div>
        <div className="panel-loading-text">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error}</div>
        <button className="panel-error-retry" data-panel-retry onClick={refetch}>Retry</button>
      </div>
    );
  }

  // Warmup state (empty data on cold deploy) — show guidance, not an error
  const isEmpty = !data || (data.commodityAssets.length === 0 && data.cryptoAssets.length === 0 && data.fxAssets.length === 0);
  if (isEmpty || data?.warmup) {
    return (
      <div className="pos-panel">
        {(isEmpty || data?.warmup) && <div className="pos-warmup">{t('components.positioning247.warmup')}</div>}
        {!isEmpty && data && (
          <>
            <PositionSection header={t('components.positioning247.commodities')} assets={data.commodityAssets} onNavigate={handleNavigate} />
            <PositionSection header={t('components.positioning247.crypto')}      assets={data.cryptoAssets}    onNavigate={handleNavigate} />
            <PositionSection header={t('components.positioning247.fx')}          assets={data.fxAssets}        onNavigate={handleNavigate} />
          </>
        )}
        <div className="pos-footer">{t('components.positioning247.footer')}</div>
      </div>
    );
  }

  return (
    <div className="pos-panel">
      <PositionSection header={t('components.positioning247.commodities')} assets={data.commodityAssets} onNavigate={handleNavigate} />
      <PositionSection header={t('components.positioning247.crypto')}      assets={data.cryptoAssets}    onNavigate={handleNavigate} />
      <PositionSection header={t('components.positioning247.fx')}          assets={data.fxAssets}        onNavigate={handleNavigate} />
      <div className="pos-footer">{t('components.positioning247.footer')}</div>
    </div>
  );
}

export function PositioningPanel() {
  return (
    <PanelShell
      id="positioning-247"
      title={t('components.positioning247.title')}
      infoTooltip={t('components.positioning247.infoTooltip')}
    >
      <PositioningPanelContent />
    </PanelShell>
  );
}
