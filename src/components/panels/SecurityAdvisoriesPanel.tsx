import { useState } from 'react';
import { t } from '@/services/i18n';
import type { SecurityAdvisory } from '@/services/security-advisories';
import { fetchSecurityAdvisories } from '@/services/security-advisories';
import { usePanelData } from '@/hooks/usePanelData';
import { sanitizeUrl } from '@/utils/sanitize';
import { PanelShell } from '@/components/PanelShell';

type AdvisoryFilter = 'all' | 'critical' | 'US' | 'AU' | 'UK' | 'health';

function getLevelClass(level?: SecurityAdvisory['level']): string {
  switch (level) {
    case 'do-not-travel': return 'sa-level-dnt';
    case 'reconsider': return 'sa-level-reconsider';
    case 'caution': return 'sa-level-caution';
    case 'normal': return 'sa-level-normal';
    default: return 'sa-level-info';
  }
}

function getLevelLabel(level?: SecurityAdvisory['level']): string {
  switch (level) {
    case 'do-not-travel': return t('components.securityAdvisories.levels.doNotTravel');
    case 'reconsider': return t('components.securityAdvisories.levels.reconsider');
    case 'caution': return t('components.securityAdvisories.levels.caution');
    case 'normal': return t('components.securityAdvisories.levels.normal');
    default: return t('components.securityAdvisories.levels.info');
  }
}

function getSourceFlag(sourceCountry: string): string {
  switch (sourceCountry) {
    case 'US': return '🇺🇸';
    case 'AU': return '🇦🇺';
    case 'UK': return '🇬🇧';
    case 'EU': return '🇪🇺';
    case 'INT': return '🏥';
    default: return '🌐';
  }
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return t('components.securityAdvisories.time.justNow');
  if (minutes < 60) return t('components.securityAdvisories.time.minutesAgo', { count: String(minutes) });
  if (hours < 24) return t('components.securityAdvisories.time.hoursAgo', { count: String(hours) });
  if (days < 7) return t('components.securityAdvisories.time.daysAgo', { count: String(days) });
  return date.toLocaleDateString();
}

export function SecurityAdvisoriesPanelContent() {
  const { data, loading, refetch } = usePanelData(() => fetchSecurityAdvisories(), { ttlMs: 15 * 60 * 1000 });
  const [activeFilter, setActiveFilter] = useState<AdvisoryFilter>('all');

  const advisories = data?.ok ? data.advisories : [];

  if (loading && advisories.length === 0) {
    return <div className="panel-loading">{t('components.securityAdvisories.loading')}</div>;
  }

  const getFiltered = (): SecurityAdvisory[] => {
    switch (activeFilter) {
      case 'critical':
        return advisories.filter(a => a.level === 'do-not-travel' || a.level === 'reconsider');
      case 'health':
        return advisories.filter(a => a.sourceCountry === 'EU' || a.sourceCountry === 'INT');
      case 'US':
      case 'AU':
      case 'UK':
        return advisories.filter(a => a.sourceCountry === activeFilter);
      default:
        return advisories;
    }
  };

  const dntCount = advisories.filter(a => a.level === 'do-not-travel').length;
  const reconsiderCount = advisories.filter(a => a.level === 'reconsider').length;
  const cautionCount = advisories.filter(a => a.level === 'caution').length;
  const filtered = getFiltered();
  const displayed = filtered.slice(0, 30);

  const filters: Array<{ key: AdvisoryFilter; label: string }> = [
    { key: 'all', label: t('common.all') },
    { key: 'critical', label: t('components.securityAdvisories.critical') },
    { key: 'US', label: '🇺🇸 US' },
    { key: 'AU', label: '🇦🇺 AU' },
    { key: 'UK', label: '🇬🇧 UK' },
    { key: 'health', label: `🏥 ${t('components.securityAdvisories.health')}` },
  ];

  return (
    <div className="sa-panel-content">
      <div className="sa-summary">
        <div className="sa-summary-item sa-level-dnt">
          <span className="sa-summary-count">{dntCount}</span>
          <span className="sa-summary-label">{t('components.securityAdvisories.levels.doNotTravel')}</span>
        </div>
        <div className="sa-summary-item sa-level-reconsider">
          <span className="sa-summary-count">{reconsiderCount}</span>
          <span className="sa-summary-label">{t('components.securityAdvisories.levels.reconsider')}</span>
        </div>
        <div className="sa-summary-item sa-level-caution">
          <span className="sa-summary-count">{cautionCount}</span>
          <span className="sa-summary-label">{t('components.securityAdvisories.levels.caution')}</span>
        </div>
      </div>
      <div className="sa-filters">
        {filters.map(f => (
          <button
            key={f.key}
            type="button"
            className={`sa-filter${activeFilter === f.key ? ' sa-filter-active' : ''}`}
            onClick={() => setActiveFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="sa-list">
        {displayed.length === 0 ? (
          <div className="panel-empty">{t('components.securityAdvisories.noMatching')}</div>
        ) : displayed.map((a, i) => {
          const levelCls = getLevelClass(a.level);
          const levelLabel = getLevelLabel(a.level);
          const flag = getSourceFlag(a.sourceCountry);
          return (
            <div key={`${a.link}-${i}`} className={`sa-item ${levelCls}`}>
              <div className="sa-item-header">
                <span className={`sa-badge ${levelCls}`}>{levelLabel}</span>
                <span className="sa-source">{flag} {a.source}</span>
              </div>
              <div className="sa-body">
                <a href={sanitizeUrl(a.link)} target="_blank" rel="noopener" className="sa-title">{a.title}</a>
                <span className="sa-time">{formatTime(a.pubDate)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="sa-footer">
        <span className="sa-footer-source">{t('components.securityAdvisories.sources')}</span>
        <button type="button" className="sa-refresh-btn" onClick={() => refetch()}>
          {t('components.securityAdvisories.refresh')}
        </button>
      </div>
    </div>
  );
}

export function SecurityAdvisoriesPanel() {
  return (
    <PanelShell
      id="security-advisories"
      title={t('panels.securityAdvisories')}
      infoTooltip={t('components.securityAdvisories.infoTooltip')}
      defaultRowSpan={2}
    >
      <SecurityAdvisoriesPanelContent />
    </PanelShell>
  );
}
