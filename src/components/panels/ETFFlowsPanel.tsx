import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { getHydratedData } from '@/services/bootstrap';
import type { ListEtfFlowsResponse, EtfFlow, EtfFlowsSummary } from '@/generated/client/worldmonitor/market/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatVolume(v: number): string {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toLocaleString();
}

function flowClass(direction: string): string {
  if (direction === 'inflow')  return 'flow-inflow';
  if (direction === 'outflow') return 'flow-outflow';
  return 'flow-neutral';
}

function changeClass(val: number): string {
  if (val >  0.1) return 'change-positive';
  if (val < -0.1) return 'change-negative';
  return 'change-neutral';
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchEtfFlows(_signal: AbortSignal): Promise<ListEtfFlowsResponse> {
  // Bootstrap hydration first
  const hydrated = getHydratedData('etfFlows') as ListEtfFlowsResponse | undefined;
  if (hydrated?.etfs?.length) return hydrated;

  const { MarketServiceClient } = await import('@/services/generated-rpc-clients');
  const { getRpcBaseUrl } = await import('@/services/rpc-client');
  const client = new MarketServiceClient(getRpcBaseUrl(), {
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  });
  return client.listEtfFlows({});
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryBar({ s }: { s: EtfFlowsSummary }) {
  const dirClass = s.netDirection.includes('INFLOW') ? 'flow-inflow'
    : s.netDirection.includes('OUTFLOW') ? 'flow-outflow' : 'flow-neutral';
  const dirLabel = s.netDirection.includes('INFLOW')
    ? t('components.etfFlows.netInflow') : t('components.etfFlows.netOutflow');

  return (
    <div className={`etf-summary ${dirClass}`}>
      <div className="etf-summary-item">
        <span className="etf-summary-label">{t('components.etfFlows.netFlow')}</span>
        <span className={`etf-summary-value ${dirClass}`}>{dirLabel}</span>
      </div>
      <div className="etf-summary-item">
        <span className="etf-summary-label">{t('components.etfFlows.estFlow')}</span>
        <span className="etf-summary-value">${formatVolume(Math.abs(s.totalEstFlow))}</span>
      </div>
      <div className="etf-summary-item">
        <span className="etf-summary-label">{t('components.etfFlows.totalVol')}</span>
        <span className="etf-summary-value">{formatVolume(s.totalVolume)}</span>
      </div>
      <div className="etf-summary-item">
        <span className="etf-summary-label">{t('components.etfFlows.etfs')}</span>
        <span className="etf-summary-value">{s.inflowCount}↑ {s.outflowCount}↓</span>
      </div>
    </div>
  );
}

function EtfRow({ etf }: { etf: EtfFlow }) {
  const flowSign = etf.direction === 'inflow' ? '+' : etf.direction === 'outflow' ? '-' : '';
  return (
    <tr className={`etf-row ${flowClass(etf.direction)}`}>
      <td className="etf-ticker">{etf.ticker}</td>
      <td className="etf-issuer">{etf.issuer}</td>
      <td className={`etf-flow ${flowClass(etf.direction)}`}>{flowSign}${formatVolume(Math.abs(etf.estFlow))}</td>
      <td className="etf-volume">{formatVolume(etf.volume)}</td>
      <td className={`etf-change ${changeClass(etf.priceChange)}`}>
        {etf.priceChange > 0 ? '+' : ''}{etf.priceChange.toFixed(2)}%
      </td>
    </tr>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside Panel base class's content div. */
export function ETFFlowsPanelContent() {
  const { data, loading, error, refetch } = usePanelData<ListEtfFlowsResponse>(fetchEtfFlows, {
    hydrationKey: 'etfFlows',
    ttlMs: 5 * 60 * 1000,
  });

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar"><div className="panel-radar-sweep" /><div className="panel-radar-dot" /></div>
        <div className="panel-loading-text">{t('common.loadingEtfData')}</div>
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

  if (!data.etfs?.length) {
    const msg = data.rateLimited ? t('components.etfFlows.rateLimited') : t('components.etfFlows.unavailable');
    return <div className="panel-loading-text">{msg}</div>;
  }

  const s = data.summary ?? { etfCount: 0, totalVolume: 0, totalEstFlow: 0, netDirection: 'NEUTRAL', inflowCount: 0, outflowCount: 0 };

  return (
    <div className="etf-flows-container">
      <SummaryBar s={s} />
      <div className="etf-table-wrap">
        <table className="etf-table">
          <thead>
            <tr>
              <th>{t('components.etfFlows.table.ticker')}</th>
              <th>{t('components.etfFlows.table.issuer')}</th>
              <th>{t('components.etfFlows.table.estFlow')}</th>
              <th>{t('components.etfFlows.table.volume')}</th>
              <th>{t('components.etfFlows.table.change')}</th>
            </tr>
          </thead>
          <tbody>
            {data.etfs.map(etf => <EtfRow key={etf.ticker} etf={etf} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ETFFlowsPanel() {
  return (
    <PanelShell
      id="etf-flows"
      title={t('panels.etfFlows')}
      infoTooltip={t('components.etfFlows.infoTooltip')}
    >
      <ETFFlowsPanelContent />
    </PanelShell>
  );
}
