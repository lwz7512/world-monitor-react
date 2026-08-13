import { useState } from 'react';
import type { AIRegulation, RegulatoryAction, CountryRegulationProfile } from '@/types';
import {
  AI_REGULATIONS,
  COUNTRY_REGULATION_PROFILES,
  getUpcomingDeadlines,
  getRecentActions,
} from '@/config';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { getCSSColor } from '@/utils';
import { PanelShell } from '@/components/PanelShell';

type ViewMode = 'timeline' | 'deadlines' | 'regulations' | 'countries';

const TYPE_ICONS: Record<RegulatoryAction['type'], string> = {
  'law-passed': '📜',
  'executive-order': '🏛️',
  'guideline': '📋',
  'enforcement': '⚖️',
  'consultation': '💬',
};

function formatDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString('en-US', opts);
}

function TimelineView() {
  const recentActions = getRecentActions(12);
  if (recentActions.length === 0) {
    return <div className="empty-state">{t('components.regulation.emptyActions')}</div>;
  }
  return (
    <div className="timeline-view">
      <div className="timeline-header">
        <h4>{t('components.regulation.recentActions')}</h4>
        <span className="count">{t('components.regulation.actionsCount', { count: String(recentActions.length) })}</span>
      </div>
      <div className="timeline-list">
        {recentActions.map((action, i) => {
          const impactColors: Record<RegulatoryAction['impact'], string> = {
            high: getCSSColor('--semantic-critical'),
            medium: getCSSColor('--semantic-elevated'),
            low: getCSSColor('--semantic-normal'),
          };
          return (
            <div key={i} className={`timeline-item impact-${action.impact}`}>
              <div className="timeline-marker">
                <span className="timeline-icon">{TYPE_ICONS[action.type]}</span>
                <div className="timeline-line" />
              </div>
              <div className="timeline-content">
                <div className="timeline-header-row">
                  <span className="timeline-date">{formatDate(action.date, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                  <span className="timeline-country">{action.country}</span>
                  <span className="timeline-impact" style={{ color: impactColors[action.impact] }}>{action.impact.toUpperCase()}</span>
                </div>
                <h5>{action.title}</h5>
                <p>{action.description}</p>
                {action.source && <span className="timeline-source">{t('components.regulation.source')}: {action.source}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeadlinesView() {
  const upcomingDeadlines = getUpcomingDeadlines();
  if (upcomingDeadlines.length === 0) {
    return <div className="empty-state">{t('components.regulation.emptyDeadlines')}</div>;
  }
  return (
    <div className="deadlines-view">
      <div className="deadlines-header">
        <h4>{t('components.regulation.upcomingDeadlines')}</h4>
        <span className="count">{t('components.regulation.deadlinesCount', { count: String(upcomingDeadlines.length) })}</span>
      </div>
      <div className="deadlines-list">
        {upcomingDeadlines.map((reg, i) => {
          const deadline = new Date(reg.complianceDeadline!);
          const daysUntil = Math.ceil((deadline.getTime() - Date.now()) / 86400000);
          const urgencyClass = daysUntil < 90 ? 'urgent' : daysUntil < 180 ? 'warning' : 'normal';
          return (
            <div key={i} className={`deadline-item ${urgencyClass}`}>
              <div className="deadline-countdown">
                <div className="days-until">{daysUntil}</div>
                <div className="days-label">{t('components.regulation.days')}</div>
              </div>
              <div className="deadline-content">
                <h5>{reg.shortName}</h5>
                <p className="deadline-name">{reg.name}</p>
                <div className="deadline-meta">
                  <span className="deadline-date">📅 {formatDate(reg.complianceDeadline!, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                  <span className="deadline-country">🌍 {reg.country}</span>
                </div>
                {reg.penalties && <p className="deadline-penalties">⚠️ Penalties: {reg.penalties}</p>}
                <div className="deadline-scope">
                  {reg.scope.map(s => <span key={s} className="scope-tag">{s}</span>)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RegulationCard({ reg }: { reg: AIRegulation }) {
  const typeColors: Record<AIRegulation['type'], string> = {
    comprehensive: getCSSColor('--semantic-low'),
    sectoral: getCSSColor('--semantic-high'),
    voluntary: getCSSColor('--semantic-normal'),
    proposed: getCSSColor('--semantic-elevated'),
  };
  const effectiveDate = reg.effectiveDate
    ? formatDate(reg.effectiveDate, { year: 'numeric', month: 'short' })
    : 'TBD';
  const regulationLink = reg.link ? sanitizeUrl(reg.link) : '';
  return (
    <div className="regulation-card">
      <div className="regulation-card-header">
        <h5>{reg.shortName}</h5>
        <span className="regulation-type" style={{ backgroundColor: typeColors[reg.type] }}>{reg.type}</span>
      </div>
      <p className="regulation-full-name">{reg.name}</p>
      <div className="regulation-meta">
        <span>🌍 {reg.country}</span>
        <span>📅 {effectiveDate}</span>
        <span className={`status-badge status-${reg.status}`}>{reg.status}</span>
      </div>
      {reg.description && <p className="regulation-description">{reg.description}</p>}
      <div className="regulation-provisions">
        <strong>{t('components.regulation.keyProvisions')}:</strong>
        <ul>
          {reg.keyProvisions.slice(0, 3).map((p, i) => <li key={i}>{p}</li>)}
          {reg.keyProvisions.length > 3 && (
            <li className="more-provisions">{t('components.regulation.moreProvisions', { count: String(reg.keyProvisions.length - 3) })}</li>
          )}
        </ul>
      </div>
      <div className="regulation-scope">
        {reg.scope.map(s => <span key={s} className="scope-tag">{s}</span>)}
      </div>
      {regulationLink && <a href={regulationLink} target="_blank" rel="noopener noreferrer" className="regulation-link">{t('components.regulation.learnMore')} →</a>}
    </div>
  );
}

function RegulationsView() {
  const active = AI_REGULATIONS.filter(r => r.status === 'active');
  const proposed = AI_REGULATIONS.filter(r => r.status === 'proposed');
  return (
    <div className="regulations-view">
      <div className="regulations-section">
        <h4>{t('components.regulation.activeCount', { count: String(active.length) })}</h4>
        <div className="regulations-list">
          {active.map((reg, i) => <RegulationCard key={i} reg={reg} />)}
        </div>
      </div>
      <div className="regulations-section">
        <h4>{t('components.regulation.proposedCount', { count: String(proposed.length) })}</h4>
        <div className="regulations-list">
          {proposed.map((reg, i) => <RegulationCard key={i} reg={reg} />)}
        </div>
      </div>
    </div>
  );
}

function CountryCard({ profile }: { profile: CountryRegulationProfile }) {
  const stanceColors: Record<CountryRegulationProfile['stance'], string> = {
    strict: getCSSColor('--semantic-critical'),
    moderate: getCSSColor('--semantic-elevated'),
    permissive: getCSSColor('--semantic-normal'),
    undefined: getCSSColor('--text-muted'),
  };
  const color = stanceColors[profile.stance];
  return (
    <div className={`country-card stance-${profile.stance}`}>
      <div className="country-card-header" style={{ borderLeft: `4px solid ${color}` }}>
        <h5>{profile.country}</h5>
        <span className="stance-badge" style={{ backgroundColor: color }}>{profile.stance.toUpperCase()}</span>
      </div>
      <p className="country-summary">{profile.summary}</p>
      <div className="country-stats">
        <div className="stat">
          <span className="stat-value">{profile.activeRegulations.length}</span>
          <span className="stat-label">{t('components.regulation.active')}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{profile.proposedRegulations.length}</span>
          <span className="stat-label">{t('components.regulation.proposed')}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatDate(profile.lastUpdated, { month: 'short', year: 'numeric' })}</span>
          <span className="stat-label">{t('components.regulation.updated')}</span>
        </div>
      </div>
    </div>
  );
}

function CountriesView() {
  const stanceOrder: Record<CountryRegulationProfile['stance'], number> = {
    strict: 0, moderate: 1, permissive: 2, undefined: 3,
  };
  const profiles = [...COUNTRY_REGULATION_PROFILES].sort((a, b) => stanceOrder[a.stance] - stanceOrder[b.stance]);
  return (
    <div className="countries-view">
      <div className="countries-header">
        <h4>{t('components.regulation.globalLandscape')}</h4>
        <div className="stance-legend">
          {(['strict', 'moderate', 'permissive', 'undefined'] as const).map(s => (
            <span key={s} className="legend-item">
              <span className={`color-box ${s}`} /> {t(`components.regulation.stances.${s}`)}
            </span>
          ))}
        </div>
      </div>
      <div className="countries-list">
        {profiles.map((p, i) => <CountryCard key={i} profile={p} />)}
      </div>
    </div>
  );
}

export function AiRegulationPanelContent() {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');

  const tabs: Array<{ key: ViewMode; label: string }> = [
    { key: 'timeline', label: t('components.regulation.timeline') },
    { key: 'deadlines', label: t('components.regulation.deadlines') },
    { key: 'regulations', label: t('components.regulation.regulations') },
    { key: 'countries', label: t('components.regulation.countries') },
  ];

  return (
    <div className="regulation-panel">
      <div className="regulation-header">
        <h3>{t('components.regulation.dashboard')}</h3>
        <div className="panel-tabs">
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`panel-tab${viewMode === tab.key ? ' active' : ''}`}
              onClick={() => setViewMode(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="regulation-content">
        {viewMode === 'timeline' && <TimelineView />}
        {viewMode === 'deadlines' && <DeadlinesView />}
        {viewMode === 'regulations' && <RegulationsView />}
        {viewMode === 'countries' && <CountriesView />}
      </div>
    </div>
  );
}

export function AiRegulationPanel() {
  return (
    <PanelShell
      id="ai-regulation"
      title={t('panels.regulation')}
      infoTooltip={t('components.regulation.infoTooltip')}
    >
      <AiRegulationPanelContent />
    </PanelShell>
  );
}
