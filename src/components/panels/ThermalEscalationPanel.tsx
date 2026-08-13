import { t } from '@/services/i18n';
import { fetchThermalEscalations } from '@/services/thermal-escalation';
import { usePanelData } from '@/hooks/usePanelData';
import { PanelShell } from '@/components/PanelShell';

const STATUS_CLASS: Record<string, string> = {
  spike: 'spike', persistent: 'persistent', elevated: 'elevated', normal: 'normal',
};

function formatAge(date: Date): string {
  const ageMs = Date.now() - date.getTime();
  if (ageMs < 60 * 60 * 1000) {
    const mins = Math.max(1, Math.floor(ageMs / (60 * 1000)));
    return t('components.thermalEscalation.age.minutesAgo', { count: mins });
  }
  if (ageMs < 24 * 60 * 60 * 1000) {
    const hours = Math.max(1, Math.floor(ageMs / (60 * 60 * 1000)));
    return t('components.thermalEscalation.age.hoursAgo', { count: hours });
  }
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  if (days < 30) return t('components.thermalEscalation.age.daysAgo', { count: days });
  return date.toISOString().slice(0, 10);
}

export function ThermalEscalationPanelContent() {
  const { data, loading } = usePanelData(() => fetchThermalEscalations(), { ttlMs: 15 * 60 * 1000 });

  if (loading || !data) {
    return <div className="panel-loading">{t('components.thermalEscalation.loading')}</div>;
  }

  const { clusters, fetchedAt, summary } = data;

  if (clusters.length === 0) {
    return <div className="panel-empty">{t('components.thermalEscalation.empty')}</div>;
  }

  const footer = fetchedAt && fetchedAt.getTime() > 0
    ? t('components.thermalEscalation.footer.updated', { time: fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
    : '';

  const stats = [
    { val: summary.elevatedCount, label: t('components.thermalEscalation.summary.elevated'), cls: 'te-stat-elevated' },
    { val: summary.spikeCount, label: t('components.thermalEscalation.summary.spikes'), cls: 'te-stat-spike' },
    { val: summary.persistentCount, label: t('components.thermalEscalation.summary.persist'), cls: 'te-stat-persistent' },
    { val: summary.conflictAdjacentCount, label: t('components.thermalEscalation.summary.conflict'), cls: 'te-stat-conflict' },
    { val: summary.highRelevanceCount, label: t('components.thermalEscalation.summary.strategic'), cls: 'te-stat-strategic' },
  ].filter(s => s.val > 0);

  return (
    <div className="te-panel">
      <div className="te-summary">
        <div className="te-stat">
          <span className="te-stat-val">{summary.clusterCount}</span>
          <span className="te-stat-label">{t('components.thermalEscalation.summary.total')}</span>
        </div>
        {stats.map(s => (
          <div key={s.cls} className={`te-stat ${s.cls}`}>
            <span className="te-stat-val">{s.val}</span>
            <span className="te-stat-label">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="te-list">
        {clusters.map((c, i) => {
          const statusClass = STATUS_CLASS[c.status] ?? 'normal';
          const persistence = c.persistenceHours >= 24
            ? `${Math.round(c.persistenceHours / 24)}d`
            : `${Math.round(c.persistenceHours)}h`;
          const frpDisplay = c.totalFrp >= 1000 ? `${(c.totalFrp / 1000).toFixed(1)}k` : c.totalFrp.toFixed(0);
          const deltaSign = c.countDelta > 0 ? '+' : '';
          const deltaClass = c.countDelta > 0 ? 'pos' : c.countDelta < 0 ? 'neg' : '';
          const age = formatAge(c.lastDetectedAt);

          return (
            <div
              key={`${c.regionLabel}-${i}`}
              className={`te-card te-card-${statusClass}`}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                if (Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
                  window.dispatchEvent(new CustomEvent('wm:thermal-map-focus', { detail: { lat: c.lat, lon: c.lon } }));
                }
              }}
            >
              <div className="te-card-accent" />
              <div className="te-card-body">
                <div className="te-region">{c.regionLabel}</div>
                <div className="te-meta">
                  {t('components.thermalEscalation.observations', { count: c.observationCount })} · {t('components.thermalEscalation.sources', { count: c.uniqueSourceCount })}
                </div>
                <div className="te-badges">
                  <span className={`te-badge te-badge-${statusClass}`}>{c.status}</span>
                  {c.context === 'conflict_adjacent' && <span className="te-badge te-badge-conflict">{t('components.thermalEscalation.badges.conflictAdjacent')}</span>}
                  {c.context === 'energy_adjacent' && <span className="te-badge te-badge-energy">{t('components.thermalEscalation.badges.energyAdjacent')}</span>}
                  {c.context === 'industrial' && <span className="te-badge te-badge-industrial">{t('components.thermalEscalation.badges.industrial')}</span>}
                  {c.strategicRelevance === 'high' && <span className="te-badge te-badge-strategic">{t('components.thermalEscalation.badges.strategic')}</span>}
                </div>
              </div>
              <div className="te-metrics">
                <div className="te-frp">{frpDisplay} <span className="te-frp-unit">MW</span></div>
                <div className={`te-delta ${deltaClass}`}>{deltaSign}{Math.round(c.countDelta)} · z{c.zScore.toFixed(1)}</div>
                <div className="te-persist">{persistence}</div>
                <div className="te-last">{age}</div>
              </div>
            </div>
          );
        })}
      </div>
      {footer && <div className="te-footer">{footer}</div>}
    </div>
  );
}

export function ThermalEscalationPanel() {
  return (
    <PanelShell
      id="thermal-escalation"
      title={t('components.thermalEscalation.title')}
      infoTooltip={t('components.thermalEscalation.infoTooltip')}
    >
      <ThermalEscalationPanelContent />
    </PanelShell>
  );
}
