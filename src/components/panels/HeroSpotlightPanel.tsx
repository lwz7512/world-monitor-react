import { useState, useEffect } from 'react';
import type { NewsItem } from '@/types';
import { getHappyPanelData, subscribeHappyPanelData } from '@/services/happy-items-store';
import { sanitizeUrl } from '@/utils/sanitize';
import { effectivePubDateMs } from '@/services/feed-date';
import { PanelShell } from '@/components/PanelShell';

function selectHeroStory(items: NewsItem[]): NewsItem | undefined {
  return [...items]
    .filter(item => item.happyCategory === 'humanity-kindness')
    .sort((a, b) => effectivePubDateMs(b) - effectivePubDateMs(a))[0];
}

// ── Main panel content ────────────────────────────────────────────────────────

export function HeroSpotlightPanelContent() {
  const [story, setStory] = useState<NewsItem | undefined>(() => selectHeroStory(getHappyPanelData().curatedItems));
  const [loaded, setLoaded] = useState(() => getHappyPanelData().curatedItems.length > 0);

  useEffect(() => subscribeHappyPanelData((data) => {
    setStory(selectHeroStory(data.curatedItems));
    setLoaded(true);
  }), []);

  if (!loaded) {
    return <div className="hero-card-loading">Loading today&apos;s hero...</div>;
  }

  if (!story) {
    return <div className="hero-card-empty">No hero story available today</div>;
  }

  const timeStr = story.pubDate.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  const hasLocation = story.lat !== undefined && story.lon !== undefined;

  return (
    <div className="hero-card">
      {story.imageUrl && (
        <div className="hero-card-image">
          <img
            src={sanitizeUrl(story.imageUrl)}
            alt=""
            loading="lazy"
            onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
          />
        </div>
      )}
      <div className="hero-card-body">
        <span className="hero-card-source">{story.source}</span>
        <h3 className="hero-card-title">
          <a href={sanitizeUrl(story.link)} target="_blank" rel="noopener">
            {story.title}
          </a>
        </h3>
        <span className="hero-card-time">{timeStr}</span>
        {hasLocation && (
          <button
            className="hero-card-location-btn"
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('happy:map-focus', { detail: { lat: story.lat, lon: story.lon } }))}
          >
            Show on map
          </button>
        )}
      </div>
    </div>
  );
}

export function HeroSpotlightPanel() {
  return (
    <PanelShell
      id="spotlight"
      title="Today's Hero"
    >
      <HeroSpotlightPanelContent />
    </PanelShell>
  );
}
