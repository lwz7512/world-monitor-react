import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { formatPrice, formatChange, getChangeClass } from '@/utils';
import { miniSparkline } from '@/utils/sparkline';
import { createLazyClient, getRpcBaseUrl } from '@/services/rpc-client';
import { proFreshRpcFetch } from '@/services/premium-fetch';
import { MarketServiceClient } from '@/services/generated-rpc-clients';
import type { ListGulfQuotesResponse, GulfQuote } from '@/generated/client/worldmonitor/market/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

const getClient = createLazyClient(() => new MarketServiceClient(getRpcBaseUrl(), { fetch: proFreshRpcFetch }));

async function fetcher(_signal: AbortSignal): Promise<ListGulfQuotesResponse> {
  const data = await getClient().listGulfQuotes({});
  if (!data.quotes?.length) throw new Error(data.rateLimited ? t('common.rateLimitedMarket') ?? 'Rate limited' : t('common.failedMarketData') ?? 'No data');
  return data;
}

function Section({ title, quotes }: { title: string; quotes: GulfQuote[] }) {
  if (!quotes.length) return null;
  return (
    <div className="gulf-section">
      <div className="gulf-section-title">{title}</div>
      {quotes.map((q, i) => (
        <div key={q.symbol || i} className="market-item">
          <div className="market-info">
            <span className="market-name">{q.flag} {escapeHtml(q.name)}</span>
            <span className="market-symbol">{escapeHtml(q.country || q.symbol)}</span>
          </div>
          <div className="market-data">
            <span dangerouslySetInnerHTML={{ __html: miniSparkline(q.sparkline, q.change) }} />
            <span className="market-price">{formatPrice(q.price)}</span>
            <span className={`market-change ${getChangeClass(q.change)}`}>{formatChange(q.change)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function GulfEconomiesPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'gulfQuotes',
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

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.failedMarketData')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const indices = data.quotes!.filter(q => q.type === 'index');
  const currencies = data.quotes!.filter(q => q.type === 'currency');
  const oil = data.quotes!.filter(q => q.type === 'oil');

  return (
    <>
      <Section title={t('panels.gulfIndices')} quotes={indices} />
      <Section title={t('panels.gulfCurrencies')} quotes={currencies} />
      <Section title={t('panels.gulfOil')} quotes={oil} />
    </>
  );
}

export function GulfEconomiesPanel() {
  return (
    <PanelShell
      id="gulf-economies"
      title={t('panels.gulfEconomies')}
      infoTooltip={t('components.gulfEconomies.infoTooltip')}
    >
      <GulfEconomiesPanelContent />
    </PanelShell>
  );
}
