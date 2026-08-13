import { t } from '@/services/i18n';
import { fetchClimateAnomalies, getSeverityIcon, formatDelta } from '@/services/climate';
import { usePanelData } from '@/hooks/usePanelData';
import { PanelShell } from '@/components/PanelShell';

export function ClimateAnomalyPanelContent() {
  const { data, loading } = usePanelData(() => fetchClimateAnomalies(), { ttlMs: 30 * 60 * 1000 });

  if (loading || !data) {
    return <div className="panel-loading">{t('common.loadingClimateData')}</div>;
  }

  if (!data.ok || data.anomalies.length === 0) {
    return <div className="panel-empty">{t('components.climate.noAnomalies')}</div>;
  }

  const severityOrder: Record<string, number> = { extreme: 0, moderate: 1, normal: 2 };
  const sorted = [...data.anomalies].sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2));

  return (
    <div className="climate-panel-content">
      <table className="climate-table">
        <thead>
          <tr>
            <th>{t('components.climate.zone')}</th>
            <th>{t('components.climate.temp')}</th>
            <th>{t('components.climate.precip')}</th>
            <th>{t('components.climate.severityLabel')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a, i) => {
            const icon = getSeverityIcon(a);
            const tempClass = a.tempDelta > 0 ? 'climate-warm' : 'climate-cold';
            const precipClass = a.precipDelta > 0 ? 'climate-wet' : 'climate-dry';
            const sevClass = `severity-${a.severity}`;
            const rowClass = `climate-row${a.severity === 'extreme' ? ' climate-extreme-row' : ''}`;
            return (
              <tr
                key={`${a.zone}-${i}`}
                className={rowClass}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  if (Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
                    window.dispatchEvent(new CustomEvent('wm:climate-map-focus', { detail: { lat: a.lat, lon: a.lon } }));
                  }
                }}
              >
                <td className="climate-zone"><span className="climate-icon">{icon}</span>{a.zone}</td>
                <td className={`climate-num ${tempClass}`}>{formatDelta(a.tempDelta, '°C')}</td>
                <td className={`climate-num ${precipClass}`}>{formatDelta(a.precipDelta, 'mm')}</td>
                <td><span className={`climate-badge ${sevClass}`}>{t(`components.climate.severity.${a.severity}`)}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ClimateAnomalyPanel() {
  return (
    <PanelShell
      id="climate"
      title={t('panels.climate')}
      infoTooltip={t('components.climate.infoTooltip')}
    >
      <ClimateAnomalyPanelContent />
    </PanelShell>
  );
}
