import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { getChinaActivityNowcastData } from '@/services/china-activity-nowcast';
import { renderChinaActivityNowcastView } from '@/components/china-activity-nowcast-view';
import type { ChinaActivityNowcastResponse } from '../../../shared/china-activity-nowcast';
import { PanelShell } from '@/components/PanelShell';

async function fetcher(_signal: AbortSignal): Promise<ChinaActivityNowcastResponse> {
  return getChinaActivityNowcastData();
}

export function ChinaActivityNowcastPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, { ttlMs: 6 * 60 * 60 * 1000 });

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
        <div className="panel-error-msg">{error ?? t('common.failedToLoad')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div
      className="china-nowcast-view"
      /* renderChinaActivityNowcastView escapes every dynamic value before constructing markup */
      dangerouslySetInnerHTML={{ __html: renderChinaActivityNowcastView(data) }}
    />
  );
}

export function ChinaActivityNowcastPanel() {
  return (
    <PanelShell
      id="china-activity-nowcast"
      title="China Activity Nowcast"
      infoTooltip="A deterministic directional comparison of revision-aware official activity and reviewed proxy families. Missing and stale inputs are excluded; this is not a replacement GDP estimate."
      defaultRowSpan={2}
      className="panel-wide"
    >
      <ChinaActivityNowcastPanelContent />
    </PanelShell>
  );
}
