import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { fetchAllFires, computeRegionStats, type FireRegionStats } from '@/services/wildfires';
import { PanelShell } from '@/components/PanelShell';

interface FireData { stats: FireRegionStats[]; totalCount: number; fetchedAt: number }

async function fetcher(_signal: AbortSignal): Promise<FireData> {
  const result = await fetchAllFires(1);
  if (result.skipped) throw new Error(t('panels.satelliteFires.noData') ?? 'No thermal data available');
  const stats = computeRegionStats(result.regions);
  return { stats, totalCount: result.totalCount, fetchedAt: Date.now() };
}

function timeSince(fetchedAt: number): string {
  const secs = Math.floor((Date.now() - fetchedAt) / 1000);
  if (secs < 60) return t('components.satelliteFires.time.justNow');
  const mins = Math.floor(secs / 60);
  if (mins < 60) return t('components.satelliteFires.time.minutesAgo', { count: String(mins) });
  const hrs = Math.floor(mins / 60);
  return t('components.satelliteFires.time.hoursAgo', { count: String(hrs) });
}

export function SatelliteFiresPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, { ttlMs: 30 * 60 * 1000 });

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
        <div className="panel-loading-text">{t('common.scanningThermalData')}</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.noDataAvailable')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const { stats, totalCount, fetchedAt } = data;

  if (stats.length === 0) {
    return <div className="panel-empty">{t('common.noDataAvailable')}</div>;
  }

  const totalFrp = stats.reduce((sum, s) => sum + s.totalFrp, 0);
  const totalHigh = stats.reduce((sum, s) => sum + s.highIntensityCount, 0);
  const totalExplosions = stats.reduce((sum, s) => sum + s.possibleExplosionCount, 0);
  const ago = timeSince(fetchedAt);

  return (
    <div className="fires-panel-content">
      <table className="fires-table">
        <thead>
          <tr>
            <th>{t('components.satelliteFires.region')}</th>
            <th>{t('components.satelliteFires.fires')}</th>
            <th>{t('components.satelliteFires.high')}</th>
            <th>FRP</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s, i) => {
            const frpStr = s.totalFrp >= 1000
              ? `${(s.totalFrp / 1000).toFixed(1)}k`
              : Math.round(s.totalFrp).toLocaleString();
            const highClass = s.highIntensityCount > 0 ? ' fires-high' : '';
            return (
              <tr key={`${s.region}-${i}`} className={`fire-row${highClass}`}>
                <td className="fire-region">
                  {s.region}
                  {s.possibleExplosionCount > 0 && (
                    <span className="fires-explosion-badge" title={t('components.satelliteFires.explosionTooltip')}>
                      {s.possibleExplosionCount}
                    </span>
                  )}
                </td>
                <td className="fire-count">{s.fireCount}</td>
                <td className="fire-hi">{s.highIntensityCount}</td>
                <td className="fire-frp">{frpStr}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="fire-totals">
            <td>{t('components.satelliteFires.total')}</td>
            <td>{totalCount}</td>
            <td>{totalHigh}</td>
            <td>{totalFrp >= 1000 ? `${(totalFrp / 1000).toFixed(1)}k` : Math.round(totalFrp).toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
      {totalExplosions > 0 && (
        <div className="fires-explosion-alert">
          {t('components.satelliteFires.possibleExplosions', { count: String(totalExplosions) })}
        </div>
      )}
      <div className="fires-footer">
        <span className="fires-source">NASA FIRMS (VIIRS SNPP)</span>
        <span className="fires-updated">{ago}</span>
      </div>
    </div>
  );
}

export function SatelliteFiresPanel() {
  return (
    <PanelShell
      id="satellite-fires"
      title={t('panels.satelliteFires')}
      infoTooltip={t('components.satelliteFires.infoTooltip')}
    >
      <SatelliteFiresPanelContent />
    </PanelShell>
  );
}
