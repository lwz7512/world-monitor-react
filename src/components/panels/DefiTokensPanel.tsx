import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { formatChange, getChangeClass } from '@/utils';
import { fetchDefiTokens } from '@/services/market';
import type { TokenData } from '@/types';
import { PanelShell } from '@/components/PanelShell';

function buildHtml(data: TokenData[]): string {
  return data
    .map(
      (tok) => `
      <div class="market-item">
        <div class="market-info">
          <span class="market-name">${escapeHtml(tok.name)}</span>
          <span class="market-symbol">${escapeHtml(tok.symbol)}</span>
        </div>
        <div class="market-data">
          <span class="market-price">$${tok.price.toLocaleString(undefined, { maximumFractionDigits: tok.price < 1 ? 6 : 2 })}</span>
          <span class="market-change ${getChangeClass(tok.change24h)}">${formatChange(tok.change24h)}</span>
          <span class="market-change market-change--7d ${getChangeClass(tok.change7d)}">${formatChange(tok.change7d)}W</span>
        </div>
      </div>
    `
    )
    .join('');
}

async function fetcher(_signal: AbortSignal): Promise<TokenData[]> {
  return fetchDefiTokens();
}

export function DefiTokensPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'defiTokens',
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

export function DefiTokensPanel() {
  return (
    <PanelShell
      id="defi-tokens"
      title="DeFi Tokens"
      infoTooltip={t('components.defiTokens.infoTooltip')}
    >
      <DefiTokensPanelContent />
    </PanelShell>
  );
}
