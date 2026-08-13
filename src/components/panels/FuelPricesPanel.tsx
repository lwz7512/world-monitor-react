import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { createLazyClient, getRpcBaseUrl, rpcFetch } from '@/services/rpc-client';
import { EconomicServiceClient } from '@/services/generated-rpc-clients';
import type { ListFuelPricesResponse } from '@/generated/client/worldmonitor/economic/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

const getClient = createLazyClient(() => new EconomicServiceClient(getRpcBaseUrl(), { fetch: rpcFetch }));

async function fetcher(_signal: AbortSignal): Promise<ListFuelPricesResponse> {
  const data = await getClient().listFuelPrices({});
  if (!data.countries?.length) throw new Error(t('common.failedMarketData') ?? 'No data');
  return data;
}

type FuelEntry = ListFuelPricesResponse['countries'][number]['gasoline'];

function fuelCell(fuel: FuelEntry, cheapCode: string, priceyCode: string, countryCode: string, showWow: boolean): string {
  if (!fuel?.usdPrice) return `<td class="gb-cell gb-na">N/A</td>`;
  const cls = countryCode === cheapCode ? 'gb-cheapest' : countryCode === priceyCode ? 'gb-priciest' : '';
  let wowStr = '';
  if (showWow && fuel.wowPct != null && fuel.wowPct !== 0) {
    const sign = fuel.wowPct >= 0 ? '▲' : '▼';
    const wowCls = fuel.wowPct >= 0 ? 'bm-wow-up' : 'bm-wow-down';
    wowStr = ` <span class="${wowCls}">${sign}${Math.abs(fuel.wowPct).toFixed(1)}%</span>`;
  }
  return `<td class="gb-cell ${cls}">$${fuel.usdPrice.toFixed(3)}${wowStr}</td>`;
}

function buildHtml(data: ListFuelPricesResponse): string {
  const sorted = [...data.countries!].sort((a, b) => (b.gasoline?.usdPrice ?? 0) - (a.gasoline?.usdPrice ?? 0));
  const cheapestGas = data.cheapestGasoline ?? '';
  const priciestGas = data.mostExpensiveGasoline ?? '';
  const cheapestDsl = data.cheapestDiesel ?? '';
  const priciestDsl = data.mostExpensiveDiesel ?? '';
  const showWow = !!data.wowAvailable;

  const rows = sorted.map(c => `<tr>
    <td class="gb-item-name">${escapeHtml(c.flag)} ${escapeHtml(c.name)}</td>
    ${fuelCell(c.gasoline, cheapestGas, priciestGas, c.code, showWow)}
    ${fuelCell(c.diesel, cheapestDsl, priciestDsl, c.code, showWow)}
  </tr>`).join('');

  const updatedAt = data.fetchedAt ? new Date(data.fetchedAt).toLocaleDateString() : '';
  const countLabel = data.countryCount ? ` (${data.countryCount} ${t('components.fuelPrices.countries')})` : '';

  return `<div class="gb-wrapper"><div class="gb-scroll"><table class="gb-table">
    <thead><tr>
      <th class="gb-item-col">${t('panels.fuelPricesCountry')}</th>
      <th class="gb-cell">${t('panels.fuelPricesGasoline')}</th>
      <th class="gb-cell">${t('panels.fuelPricesDiesel')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${updatedAt ? `<div class="gb-updated">${t('components.status.updatedAt', { time: updatedAt })}${countLabel}</div>` : ''}</div>`;
}

export function FuelPricesPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'fuelPrices',
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

export function FuelPricesPanel() {
  return (
    <PanelShell
      id="fuel-prices"
      title={t('panels.fuelPrices')}
      infoTooltip={t('components.fuelPrices.infoTooltip')}
    >
      <FuelPricesPanelContent />
    </PanelShell>
  );
}
