import { useState, useEffect } from 'react';
import type { MarketData } from '@/types';
import { formatPrice, formatChange, getChangeClass } from '@/utils';
import { miniSparkline } from '@/utils/sparkline';
import { t } from '@/services/i18n';
import { isDesktopRuntime } from '@/services/runtime';
import { hasPlottableMarketSeries } from '@/components/market-chart-interactions';
import { openMarketChartModal } from '@/components/market-chart-modal';
import {
  renderChinaCorporateDisclosureSignals,
  type ChinaCorporateDisclosureSnapshot,
} from '@/components/market-disclosures';
import { openWatchlistModal } from '@/components/watchlist-modal';
import { PanelShell } from '@/components/PanelShell';
import {
  marketsDataChannel,
  marketsDisclosuresChannel,
  marketsStateChannel,
  marketsRateLimitedChannel,
  type MarketsState,
} from '@/services/market-panel-store';

function StockRow({ stock, index }: { stock: MarketData; index: number }) {
  const plottable = hasPlottableMarketSeries(stock);
  const handleClick = plottable ? () => openMarketChartModal(stock) : undefined;
  const handleKeyDown = plottable
    ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openMarketChartModal(stock);
        }
      }
    : undefined;

  return (
    <div
      className={`market-item${plottable ? ' market-item-clickable' : ''}`}
      data-market-chart={plottable ? index : undefined}
      role={plottable ? 'button' : undefined}
      tabIndex={plottable ? 0 : undefined}
      aria-label={
        plottable ? t('components.markets.chart.title', { symbol: stock.display }) : undefined
      }
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="market-info">
        <span className="market-name">{stock.name}</span>
        <span className="market-symbol">{stock.display}</span>
      </div>
      <div className="market-data">
        <span dangerouslySetInnerHTML={{ __html: miniSparkline(stock.sparkline, stock.change) }} />
        <span className="market-price">{formatPrice(stock.price!)}</span>
        <span className={`market-change ${getChangeClass(stock.change!)}`}>
          {formatChange(stock.change!)}
        </span>
      </div>
    </div>
  );
}

export function MarketPanelContent() {
  const [markets, setMarkets] = useState<MarketData[]>(marketsDataChannel.get);
  const [disclosures, setDisclosures] = useState<ChinaCorporateDisclosureSnapshot | null>(
    marketsDisclosuresChannel.get,
  );
  const [panelState, setPanelState] = useState<MarketsState>(marketsStateChannel.get);
  const [rateLimited, setRateLimited] = useState<boolean>(marketsRateLimitedChannel.get);

  useEffect(() => {
    const u1 = marketsDataChannel.subscribe(setMarkets);
    const u2 = marketsDisclosuresChannel.subscribe(setDisclosures);
    const u3 = marketsStateChannel.subscribe(setPanelState);
    const u4 = marketsRateLimitedChannel.subscribe(setRateLimited);
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, []);

  if (panelState.kind === 'idle') return null;

  if (panelState.kind === 'retrying') {
    return (
      <div
        className="panel-message"
        style={{ padding: '20px', color: 'var(--text-dim)', fontSize: '13px' }}
      >
        {panelState.message}
      </div>
    );
  }

  if (panelState.kind === 'configError') {
    return (
      <div className="config-error-message">
        {panelState.message}
        {isDesktopRuntime() && (
          <button
            type="button"
            className="config-error-settings-btn"
            onClick={() =>
              void import('@/services/tauri-bridge')
                .then(({ invokeTauri }) => invokeTauri('open_settings_window_command'))
                .catch(() => {})
            }
          >
            {t('components.panel.openSettings')}
          </button>
        )}
      </div>
    );
  }

  const disclosureHtml = renderChinaCorporateDisclosureSignals(disclosures);
  const hasMarkets = markets.length > 0;
  const unavailableMessage = rateLimited
    ? t('common.rateLimitedMarket')
    : t('common.failedMarketData');

  if (!hasMarkets && !disclosureHtml) {
    return (
      <div
        className="panel-message"
        style={{ padding: '20px', color: 'var(--text-dim)', fontSize: '13px' }}
      >
        {unavailableMessage}
      </div>
    );
  }

  return (
    <div>
      {markets.map((stock, idx) => (
        <StockRow key={stock.symbol || idx} stock={stock} index={idx} />
      ))}
      {!hasMarkets && <div className="market-data-unavailable">{unavailableMessage}</div>}
      {disclosureHtml && <div dangerouslySetInnerHTML={{ __html: disclosureHtml }} />}
    </div>
  );
}

function WatchlistButton({ label = 'Watchlist' }: { label?: string }) {
  return (
    <button
      className="live-news-settings-btn"
      title="Customize market watchlist"
      onClick={(e) => {
        e.stopPropagation();
        openWatchlistModal();
      }}
    >
      {label}
    </button>
  );
}

export function MarketPanel() {
  return (
    <PanelShell
      id="markets"
      title={t('panels.markets')}
      infoTooltip={t('components.markets.infoTooltip')}
      headerActions={<WatchlistButton />}
    >
      <MarketPanelContent />
    </PanelShell>
  );
}
