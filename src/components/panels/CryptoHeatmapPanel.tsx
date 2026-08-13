import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { formatChange, getChangeClass, getHeatmapClass } from '@/utils';
import { fetchCryptoSectors } from '@/services/market';
import type { CryptoSector } from '@/generated/client/worldmonitor/market/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

function buildHtml(sectors: CryptoSector[]): string {
  const cells = sectors
    .map((sector) => {
      const change = sector.change ?? 0;
      return `
      <div class="heatmap-cell ${getHeatmapClass(change)}">
        <div class="sector-name">${escapeHtml(sector.name)}</div>
        <div class="sector-change ${getChangeClass(change)}">${formatChange(change)}</div>
      </div>
    `;
    })
    .join('');
  return `<div class="heatmap">${cells}</div>`;
}

async function fetcher(_signal: AbortSignal): Promise<CryptoSector[]> {
  return fetchCryptoSectors();
}

export function CryptoHeatmapPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'cryptoSectors',
    ttlMs: 10 * 60 * 1000,
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
        <div className="panel-error-msg">{error ?? t('common.failedSectorData')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  return <div dangerouslySetInnerHTML={{ __html: buildHtml(data) }} />;
}

export function CryptoHeatmapPanel() {
  return (
    <PanelShell
      id="crypto-heatmap"
      title="Crypto Sectors"
    >
      <CryptoHeatmapPanelContent />
    </PanelShell>
  );
}
