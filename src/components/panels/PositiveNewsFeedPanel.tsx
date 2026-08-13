import { useState, useCallback, useEffect } from 'react';
import type { NewsItem } from '@/types';
import type { HappyContentCategory } from '@/services/positive-classifier';
import { HAPPY_CATEGORY_ALL, HAPPY_CATEGORY_LABELS } from '@/services/positive-classifier';
import { shareHappyCard } from '@/services/happy-share-renderer';
import { getHappyPanelData, subscribeHappyPanelData } from '@/services/happy-items-store';
import { formatTime } from '@/utils';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

// ── Sub-components ────────────────────────────────────────────────────────────

function NewsCard({ item }: { item: NewsItem }) {
  const [shared, setShared] = useState(false);

  const handleShare = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    shareHappyCard(item).catch(() => {});
    setShared(true);
    setTimeout(() => setShared(false), 1500);
  }, [item]);

  const categoryLabel = item.happyCategory ? HAPPY_CATEGORY_LABELS[item.happyCategory] : '';

  return (
    <a
      className="positive-card"
      href={sanitizeUrl(item.link)}
      target="_blank"
      rel="noopener"
      data-category={item.happyCategory ?? ''}
    >
      {item.imageUrl && (
        <div className="positive-card-image">
          <img
            src={sanitizeUrl(item.imageUrl)}
            alt=""
            loading="lazy"
            onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
          />
        </div>
      )}
      <div className="positive-card-body">
        <div className="positive-card-meta">
          <span className="positive-card-source">{item.source}</span>
          {item.happyCategory && (
            <span className={`positive-card-category cat-${item.happyCategory}`}>{categoryLabel}</span>
          )}
        </div>
        <span className="positive-card-title">{item.title}</span>
        <span className="positive-card-time">{formatTime(item.pubDate)}</span>
        <button
          className={`positive-card-share${shared ? ' shared' : ''}`}
          aria-label="Share this story"
          onClick={handleShare}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
      </div>
    </a>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

export function PositiveNewsFeedPanelContent() {
  const [allItems, setAllItems] = useState<NewsItem[]>(() => getHappyPanelData().feedItems);
  const [activeFilter, setActiveFilter] = useState<HappyContentCategory | 'all'>('all');

  useEffect(() => subscribeHappyPanelData((data) => setAllItems(data.feedItems)), []);

  const filtered = activeFilter === 'all'
    ? allItems
    : allItems.filter(item => item.happyCategory === activeFilter);

  return (
    <>
      <div className="positive-feed-filters">
        <button
          className={`positive-filter-btn${activeFilter === 'all' ? ' active' : ''}`}
          data-category="all"
          onClick={() => setActiveFilter('all')}
        >
          All
        </button>
        {HAPPY_CATEGORY_ALL.map(category => (
          <button
            key={category}
            className={`positive-filter-btn${activeFilter === category ? ' active' : ''}`}
            data-category={category}
            onClick={() => setActiveFilter(category)}
          >
            {HAPPY_CATEGORY_LABELS[category]}
          </button>
        ))}
      </div>

      {filtered.length === 0
        ? <div className="positive-feed-empty">{t('components.positiveNewsFeed.noStories')}</div>
        : filtered.map((item, idx) => (
            <NewsCard key={`${item.link}-${idx}`} item={item} />
          ))
      }
    </>
  );
}

export function PositiveNewsFeedPanel() {
  return (
    <PanelShell
      id="positive-feed"
      title="Good News Feed"
    >
      <PositiveNewsFeedPanelContent />
    </PanelShell>
  );
}
