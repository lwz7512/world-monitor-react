import { t } from '@/services/i18n';
import type { RadiationObservation } from '@/services/radiation';
import { fetchRadiationWatch } from '@/services/radiation';
import { usePanelData } from '@/hooks/usePanelData';
import { PanelShell } from '@/components/PanelShell';

function formatReading(value: number, unit: string): string {
  const precision = unit === 'nSv/h' ? 1 : 0;
  return `${value.toFixed(precision)} ${unit}`;
}

function formatDeltaVal(value: number, unit: string, zScore: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)} ${unit} · z${zScore.toFixed(1)}`;
}

function formatObservedAt(date: Date): string {
  const ageMs = Date.now() - date.getTime();
  if (ageMs < 24 * 60 * 60 * 1000) {
    const hours = Math.max(1, Math.floor(ageMs / (60 * 60 * 1000)));
    return t('components.radiationWatch.observed.hoursAgo', { count: hours });
  }
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  if (days < 30) return t('components.radiationWatch.observed.daysAgo', { count: days });
  return date.toISOString().slice(0, 10);
}

function formatSourceLine(observation: RadiationObservation): string {
  const uniqueSources = [...new Set(observation.contributingSources)];
  if (uniqueSources.length <= 1) return observation.source;
  return uniqueSources.join(' + ');
}

function formatConfidence(value: RadiationObservation['confidence']): string {
  switch (value) {
    case 'high': return t('components.radiationWatch.confidence.high');
    case 'medium': return t('components.radiationWatch.confidence.medium');
    default: return t('components.radiationWatch.confidence.low');
  }
}

export function RadiationWatchPanelContent() {
  const { data, loading } = usePanelData(() => fetchRadiationWatch(), { ttlMs: 15 * 60 * 1000 });

  if (loading || !data) {
    return <div className="panel-loading">{t('components.radiationWatch.loading')}</div>;
  }

  const { observations, fetchedAt, summary } = data;

  if (observations.length === 0) {
    return <div className="panel-empty">{t('components.radiationWatch.empty')}</div>;
  }

  const footer = fetchedAt
    ? t('components.radiationWatch.footer.updated', { time: fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
    : '';

  return (
    <div className="radiation-panel-content">
      <div className="radiation-summary">
        {[
          { label: t('components.radiationWatch.summary.anomalies'), value: summary.anomalyCount },
          { label: t('components.radiationWatch.summary.elevated'), value: summary.elevatedCount },
          { label: t('components.radiationWatch.summary.confirmed'), value: summary.corroboratedCount, cls: 'radiation-summary-card-confirmed' },
          { label: t('components.radiationWatch.summary.lowConfidence'), value: summary.lowConfidenceCount, cls: 'radiation-summary-card-low-confidence' },
          { label: t('components.radiationWatch.summary.conflicts'), value: summary.conflictingCount, cls: 'radiation-summary-card-conflict' },
          { label: t('components.radiationWatch.summary.spikes'), value: summary.spikeCount, cls: 'radiation-summary-card-spike' },
        ].map(s => (
          <div key={s.label} className={`radiation-summary-card${s.cls ? ` ${s.cls}` : ''}`}>
            <span className="radiation-summary-label">{s.label}</span>
            <span className="radiation-summary-value">{s.value}</span>
          </div>
        ))}
      </div>
      <table className="radiation-table">
        <thead>
          <tr>
            <th>{t('components.radiationWatch.headers.station')}</th>
            <th>{t('components.radiationWatch.headers.reading')}</th>
            <th>{t('components.radiationWatch.headers.delta')}</th>
            <th>{t('components.radiationWatch.headers.status')}</th>
            <th>{t('components.radiationWatch.headers.observed')}</th>
          </tr>
        </thead>
        <tbody>
          {observations.map((obs, i) => {
            const observed = formatObservedAt(obs.observedAt);
            const reading = formatReading(obs.value, obs.unit);
            const baseline = formatReading(obs.baselineValue, obs.unit);
            const delta = formatDeltaVal(obs.delta, obs.unit, obs.zScore);
            const sourceLine = formatSourceLine(obs);
            const confidence = formatConfidence(obs.confidence);
            return (
              <tr
                key={`${obs.location}-${i}`}
                className="radiation-row"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  if (Number.isFinite(obs.lat) && Number.isFinite(obs.lon)) {
                    window.dispatchEvent(new CustomEvent('wm:radiation-map-focus', { detail: { lat: obs.lat, lon: obs.lon } }));
                  }
                }}
              >
                <td className="radiation-location">
                  <div className="radiation-location-name">{obs.location}</div>
                  <div className="radiation-location-meta">{sourceLine} · {t('components.radiationWatch.baseline', { value: baseline })}</div>
                  <div className="radiation-location-flags">
                    <span className={`radiation-badge radiation-confidence radiation-confidence-${obs.confidence}`}>{confidence}</span>
                    {obs.corroborated && <span className="radiation-badge radiation-flag-confirmed">{t('components.radiationWatch.flags.confirmed')}</span>}
                    {obs.conflictingSources && <span className="radiation-badge radiation-flag-conflict">{t('components.radiationWatch.flags.conflict')}</span>}
                    {obs.convertedFromCpm && <span className="radiation-badge radiation-flag-converted">{t('components.radiationWatch.flags.cpmDerived')}</span>}
                    <span className={`radiation-badge radiation-freshness radiation-freshness-${obs.freshness}`}>{obs.freshness}</span>
                  </div>
                </td>
                <td className="radiation-reading">{reading}</td>
                <td className="radiation-delta">{delta}</td>
                <td><span className={`radiation-severity radiation-severity-${obs.severity}`}>{obs.severity}</span></td>
                <td className="radiation-observed">{observed}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer && <div className="radiation-footer">{footer}</div>}
    </div>
  );
}

export function RadiationWatchPanel() {
  return (
    <PanelShell
      id="radiation-watch"
      title={t('components.radiationWatch.title')}
      infoTooltip={t('components.radiationWatch.infoTooltip')}
    >
      <RadiationWatchPanelContent />
    </PanelShell>
  );
}
