import { useState, useEffect } from 'react';
import { t } from '@/services/i18n';
import type { TechHubActivity } from '@/services/tech-activity';
import { getTechHubActivities, subscribeTechHubActivities } from '@/services/tech-hubs-store';
import { sanitizeUrl } from '@/utils/sanitize';
import { PanelShell } from '@/components/PanelShell';

const COUNTRY_FLAGS: Record<string, string> = {
  'USA': '🇺🇸', 'United States': '🇺🇸', 'UK': '🇬🇧', 'United Kingdom': '🇬🇧',
  'China': '🇨🇳', 'India': '🇮🇳', 'Israel': '🇮🇱', 'Germany': '🇩🇪',
  'France': '🇫🇷', 'Canada': '🇨🇦', 'Japan': '🇯🇵', 'South Korea': '🇰🇷',
  'Singapore': '🇸🇬', 'Australia': '🇦🇺', 'Netherlands': '🇳🇱', 'Sweden': '🇸🇪',
  'Switzerland': '🇨🇭', 'Brazil': '🇧🇷', 'Indonesia': '🇮🇩', 'UAE': '🇦🇪',
  'Estonia': '🇪🇪', 'Ireland': '🇮🇪', 'Finland': '🇫🇮', 'Spain': '🇪🇸',
  'Italy': '🇮🇹', 'Poland': '🇵🇱', 'Mexico': '🇲🇽', 'Argentina': '🇦🇷',
  'Chile': '🇨🇱', 'Colombia': '🇨🇴', 'Nigeria': '🇳🇬', 'Kenya': '🇰🇪',
  'South Africa': '🇿🇦', 'Egypt': '🇪🇬', 'Taiwan': '🇹🇼', 'Vietnam': '🇻🇳',
  'Thailand': '🇹🇭', 'Malaysia': '🇲🇾', 'Philippines': '🇵🇭', 'New Zealand': '🇳🇿',
  'Austria': '🇦🇹', 'Belgium': '🇧🇪', 'Denmark': '🇩🇰', 'Norway': '🇳🇴',
  'Portugal': '🇵🇹', 'Czech Republic': '🇨🇿', 'Romania': '🇷🇴', 'Ukraine': '🇺🇦',
  'Russia': '🇷🇺', 'Turkey': '🇹🇷', 'Saudi Arabia': '🇸🇦', 'Qatar': '🇶🇦',
  'Pakistan': '🇵🇰', 'Bangladesh': '🇧🇩',
};

function getFlag(country: string): string {
  return COUNTRY_FLAGS[country] ?? '🌐';
}

function TechHubItem({ hub, index }: { hub: TechHubActivity; index: number }) {
  const trendIcon = hub.trend === 'rising' ? '↑' : hub.trend === 'falling' ? '↓' : '';
  const topStory = hub.topStories[0];
  return (
    <>
      <div
        className={`tech-hub-item ${hub.activityLevel}`}
        style={{ cursor: 'pointer' }}
        onClick={() => window.dispatchEvent(new CustomEvent('wm:tech-hub-click', { detail: { lat: hub.lat, lon: hub.lon } }))}
      >
        <div className="hub-rank">{index + 1}</div>
        <span className={`hub-indicator ${hub.activityLevel}`} />
        <div className="hub-info">
          <div className="hub-header">
            <span className="hub-name">{hub.city}</span>
            <span className="hub-flag">{getFlag(hub.country)}</span>
            {hub.hasBreaking && <span className="hub-breaking">ALERT</span>}
          </div>
          <div className="hub-meta">
            <span className="hub-news-count">
              {hub.newsCount} {hub.newsCount === 1 ? 'story' : 'stories'}
            </span>
            {trendIcon && <span className={`hub-trend ${hub.trend}`}>{trendIcon}</span>}
            <span className="hub-tier">{hub.tier}</span>
          </div>
        </div>
        <div className="hub-score">{Math.round(hub.score)}</div>
      </div>
      {topStory && (
        <a
          className="hub-top-story"
          href={sanitizeUrl(topStory.link)}
          target="_blank"
          rel="noopener"
        >
          {topStory.title.length > 80 ? `${topStory.title.slice(0, 77)}...` : topStory.title}
        </a>
      )}
    </>
  );
}

export function TechHubsPanelContent() {
  const [activities, setActivities] = useState(getTechHubActivities);

  useEffect(() => subscribeTechHubActivities(setActivities), []);

  if (activities.length === 0) {
    return <div className="panel-loading">{t('common.noActiveTechHubs')}</div>;
  }

  return (
    <div className="tech-hubs-panel">
      {activities.slice(0, 10).map((hub, i) => (
        <TechHubItem key={hub.hubId} hub={hub} index={i} />
      ))}
    </div>
  );
}

export function TechHubsPanel() {
  return (
    <PanelShell
      id="tech-hubs"
      title={t('panels.techHubs')}
      showCount
      infoTooltip={t('components.techHubs.infoTooltip')}
    >
      <TechHubsPanelContent />
    </PanelShell>
  );
}
