import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { createLazyClient, getRpcBaseUrl, rpcFetch } from '@/services/rpc-client';
import { EconomicServiceClient } from '@/services/generated-rpc-clients';
import type { ListBigMacPricesResponse } from '@/generated/client/worldmonitor/economic/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

const getClient = createLazyClient(() => new EconomicServiceClient(getRpcBaseUrl(), { fetch: rpcFetch }));

async function fetcher(_signal: AbortSignal): Promise<ListBigMacPricesResponse> {
  const data = await getClient().listBigMacPrices({});
  if (!data.countries?.length) throw new Error(t('common.failedMarketData') ?? 'No data');
  return data;
}

function buildHtml(data: ListBigMacPricesResponse): string {
  const sorted = [...data.countries!]
    .filter((c): c is typeof c & { usdPrice: number } => c.usdPrice != null && c.usdPrice > 0)
    .sort((a, b) => b.usdPrice - a.usdPrice);

  const maxCode = sorted[0]?.code;
  const minCode = sorted[sorted.length - 1]?.code;
  const showWow = data.wowAvailable && data.wowAvgPct !== undefined;
  const wowHeader = showWow ? `<th class="gb-cell">${t('panels.bigmacWow')}</th>` : '';

  const rows = sorted.map(c => {
    const cls = c.code === minCode ? 'gb-cheapest' : c.code === maxCode ? 'gb-priciest' : '';
    let wowCell = '';
    if (showWow) {
      const pct = c.wowPct ?? null;
      if (pct == null) {
        wowCell = `<td class="gb-cell gb-na">—</td>`;
      } else {
        const sign = pct >= 0 ? '▲' : '▼';
        const wowCls = pct >= 0 ? 'bm-wow-up' : 'bm-wow-down';
        wowCell = `<td class="gb-cell ${wowCls}">${sign}${Math.abs(pct).toFixed(1)}%</td>`;
      }
    }
    return `<tr><td class="gb-item-name">${escapeHtml(c.flag)} ${escapeHtml(c.name)}</td><td class="gb-cell ${cls}">$${c.usdPrice.toFixed(2)}</td>${wowCell}</tr>`;
  }).join('');

  let wowSummary = '';
  if (showWow) {
    const avg = data.wowAvgPct!;
    const sign = avg >= 0 ? '▲' : '▼';
    const cls = avg >= 0 ? 'bm-wow-up' : 'bm-wow-down';
    wowSummary = `<div class="bm-wow-summary">Global avg: <span class="${cls}">${sign}${Math.abs(avg).toFixed(1)}% ${t('panels.bigmacWow')}</span></div>`;
  }

  const updatedAt = data.fetchedAt ? new Date(data.fetchedAt).toLocaleDateString() : '';

  return `<div class="gb-wrapper">${wowSummary}<div class="gb-scroll"><table class="gb-table">
    <thead><tr>
      <th class="gb-item-col">${t('panels.bigmacCountry')}</th>
      <th class="gb-cell">USD</th>
      ${wowHeader}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${updatedAt ? `<div class="gb-updated">${t('components.status.updatedAt', { time: updatedAt })}</div>` : ''}</div>`;
}

export function BigMacPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'bigmac',
    ttlMs: 6 * 60 * 60 * 1000,
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

  return <div dangerouslySetInnerHTML={{ __html: buildHtml(data) }} />;
}

export function BigMacPanel() {
  return (
    <PanelShell
      id="bigmac"
      title={t('panels.bigmac')}
      infoTooltip={t('components.bigmac.infoTooltip')}
    >
      <BigMacPanelContent />
    </PanelShell>
  );
}
