import { useState, useEffect } from 'react';
import { t } from '@/services/i18n';
import type { GeoHubActivity } from '@/services/geo-activity';
import { getGeoHubActivities, subscribeGeoHubActivities } from '@/services/geo-hubs-store';
import { sanitizeUrl } from '@/utils/sanitize';
import { PanelShell } from '@/components/PanelShell';

const COUNTRY_FLAGS: Record<string, string> = {
  'USA': '🇺🇸', 'Russia': '🇷🇺', 'China': '🇨🇳', 'UK': '🇬🇧', 'Belgium': '🇧🇪',
  'Israel': '🇮🇱', 'Iran': '🇮🇷', 'Ukraine': '🇺🇦', 'Taiwan': '🇹🇼', 'Japan': '🇯🇵',
  'South Korea': '🇰🇷', 'North Korea': '🇰🇵', 'India': '🇮🇳', 'Saudi Arabia': '🇸🇦',
  'Turkey': '🇹🇷', 'France': '🇫🇷', 'Germany': '🇩🇪', 'Egypt': '🇪🇬', 'Pakistan': '🇵🇰',
  'Palestine': '🇵🇸', 'Yemen': '🇾🇪', 'Syria': '🇸🇾', 'Lebanon': '🇱🇧',
  'Sudan': '🇸🇩', 'Ethiopia': '🇪🇹', 'Myanmar': '🇲🇲', 'Austria': '🇦🇹',
  'International': '🌐',
};

const TYPE_ICONS: Record<string, string> = {
  capital: '🏛️', conflict: '⚔️', strategic: '⚓', organization: '🏢',
};

const TYPE_LABELS: Record<string, string> = {
  capital: 'Capital', conflict: 'Conflict Zone', strategic: 'Strategic', organization: 'Organization',
};

function getFlag(country: string): string {
  return COUNTRY_FLAGS[country] ?? '🌐';
}

function getTypeIcon(type: string): string {
  return TYPE_ICONS[type] ?? '📍';
}

function getTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

function GeoHubItem({ hub, index }: { hub: GeoHubActivity; index: number }) {
  const trendIcon = hub.trend === 'rising' ? '↑' : hub.trend === 'falling' ? '↓' : '';
  const topStory = hub.topStories[0];
  return (
    <>
      <div
        className={`geo-hub-item ${hub.activityLevel}`}
        style={{ cursor: 'pointer' }}
        onClick={() => window.dispatchEvent(new CustomEvent('wm:geo-hub-click', { detail: { lat: hub.lat, lon: hub.lon } }))}
      >
        <div className="hub-rank">{index + 1}</div>
        <span className={`geo-hub-indicator ${hub.activityLevel}`} />
        <div className="hub-info">
          <div className="hub-header">
            <span className="hub-name">{hub.name}</span>
            <span className="hub-flag">{getFlag(hub.country)}</span>
            {hub.hasBreaking && <span className="hub-breaking geo">ALERT</span>}
          </div>
          <div className="hub-meta">
            <span className="hub-news-count">
              {hub.newsCount} {hub.newsCount === 1 ? t('components.geoHubs.story') : t('components.geoHubs.stories')}
            </span>
            {trendIcon && <span className={`hub-trend ${hub.trend}`}>{trendIcon}</span>}
            <span className="geo-hub-type">{getTypeIcon(hub.type)} {getTypeLabel(hub.type)}</span>
          </div>
        </div>
        <div className="hub-score geo">{Math.round(hub.score)}</div>
      </div>
      {topStory && (
        <a
          className="hub-top-story geo"
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

export function GeoHubsPanelContent() {
  const [activities, setActivities] = useState(getGeoHubActivities);

  useEffect(() => subscribeGeoHubActivities(setActivities), []);

  if (activities.length === 0) {
    return <div className="panel-loading">{t('common.noActiveGeoHubs')}</div>;
  }

  return (
    <div className="geo-hubs-panel">
      {activities.slice(0, 10).map((hub, i) => (
        <GeoHubItem key={hub.hubId} hub={hub} index={i} />
      ))}
    </div>
  );
}

export function GeoHubsPanel() {
  return (
    <PanelShell
      id="geo-hubs"
      title={t('panels.geoHubs')}
      showCount
      infoTooltip={t('components.geoHubs.infoTooltip')}
    >
      <GeoHubsPanelContent />
    </PanelShell>
  );
}
