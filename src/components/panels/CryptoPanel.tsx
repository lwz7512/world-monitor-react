import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { formatChange, getChangeClass } from '@/utils';
import { miniSparkline } from '@/utils/sparkline';
import { fetchCrypto } from '@/services/market';
import type { CryptoData } from '@/types';
import { PanelShell } from '@/components/PanelShell';

function buildHtml(data: CryptoData[]): string {
  return data
    .map(
      (coin) => `
      <div class="market-item">
        <div class="market-info">
          <span class="market-name">${escapeHtml(coin.name)}</span>
          <span class="market-symbol">${escapeHtml(coin.symbol)}</span>
        </div>
        <div class="market-data">
          ${miniSparkline(coin.sparkline, coin.change)}
          <span class="market-price">$${coin.price.toLocaleString()}</span>
          <span class="market-change ${getChangeClass(coin.change)}">${formatChange(coin.change)}</span>
        </div>
      </div>
    `
    )
    .join('');
}

async function fetcher(_signal: AbortSignal): Promise<CryptoData[]> {
  return fetchCrypto();
}

export function CryptoPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'cryptoQuotes',
    ttlMs: 5 * 60 * 1000,
  });

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
      </div>
    );
  }

  if (error || !data || data.length === 0) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.failedCryptoData')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  return <div dangerouslySetInnerHTML={{ __html: buildHtml(data) }} />;
}

export function CryptoPanel() {
  return (
    <PanelShell
      id="crypto"
      title={t('panels.crypto')}
      infoTooltip={t('components.crypto.infoTooltip')}
    >
      <CryptoPanelContent />
    </PanelShell>
  );
}
