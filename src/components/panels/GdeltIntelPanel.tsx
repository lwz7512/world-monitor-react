import { useState, useEffect, useCallback } from 'react';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { miniSparkline } from '@/utils/sparkline';
import {
  getIntelTopics,
  fetchTopicIntelligence,
  fetchTopicTimeline,
  formatArticleDate,
  extractDomain,
  type GdeltArticle,
  type IntelTopic,
  type TopicIntelligence,
  type TopicTimeline,
} from '@/services/gdelt-intel';
import { PanelShell } from '@/components/PanelShell';

interface TopicCacheEntry {
  data: TopicIntelligence;
  timeline: TopicTimeline | null;
  fetchedAt: number;
}

const TOPICS = getIntelTopics();
const TTL = 5 * 60 * 1000;

function Article({ article }: { article: GdeltArticle }) {
  const domain = article.source || extractDomain(article.url);
  const timeAgo = formatArticleDate(article.date);
  const toneClass = article.tone
    ? (article.tone < -2 ? 'tone-negative' : article.tone > 2 ? 'tone-positive' : '')
    : '';

  return (
    <a
      href={sanitizeUrl(article.url)}
      target="_blank"
      rel="noopener"
      className={`gdelt-intel-article${toneClass ? ` ${toneClass}` : ''}`}
    >
      <div className="article-header">
        <span className="article-source">{domain}</span>
        <span className="article-time">{timeAgo}</span>
      </div>
      <div className="article-title">{article.title}</div>
    </a>
  );
}

function TopicSummary({ timeline }: { timeline: TopicTimeline }) {
  const toneVals = timeline.tone.map(p => p.value);
  const volVals = timeline.vol.map(p => p.value);
  const lastTone = toneVals[toneVals.length - 1] ?? 0;
  const toneChange = lastTone >= 0 ? 1 : -1;
  const toneBadgeClass = lastTone < -1.5 ? 'negative' : lastTone > 1.5 ? 'positive' : '';
  const tonePrefix = lastTone < -1.5 ? '▼ ' : lastTone > 1.5 ? '▲ ' : '';
  const toneSvg = miniSparkline(toneVals, toneChange, 60, 18);
  const volSvg = volVals.length >= 2 ? miniSparkline(volVals, 1, 60, 18) : null;
  const lastVol = volVals[volVals.length - 1] ?? 0;

  return (
    <div className="gdelt-topic-summary">
      <div className="gdelt-trend-group">
        {/* miniSparkline returns trusted SVG built from numeric arrays */}
        <span dangerouslySetInnerHTML={{ __html: toneSvg }} />
        <span className={`gdelt-trend-value${toneBadgeClass ? ` ${toneBadgeClass}` : ''}`}>
          {tonePrefix}{lastTone.toFixed(1)}
        </span>
        <span className="gdelt-trend-label">Tone</span>
      </div>
      {volSvg && (
        <div className="gdelt-trend-group">
          <span dangerouslySetInnerHTML={{ __html: volSvg }} />
          <span className="gdelt-trend-value">{Math.round(lastVol)}</span>
          <span className="gdelt-trend-label">Volume</span>
        </div>
      )}
    </div>
  );
}

export function GdeltIntelPanelContent() {
  const [activeTopic, setActiveTopic] = useState<IntelTopic>(() => TOPICS[0]!);
  const [cache, setCache] = useState<Map<string, TopicCacheEntry>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTopic = useCallback(async (topic: IntelTopic) => {
    const cached = cache.get(topic.id);
    if (cached && Date.now() - cached.fetchedAt < TTL) return;

    setLoading(true);
    setError(null);
    try {
      const [data, timeline] = await Promise.all([
        fetchTopicIntelligence(topic),
        fetchTopicTimeline(topic.id),
      ]);
      setCache(prev => new Map(prev).set(topic.id, { data, timeline, fetchedAt: Date.now() }));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[GdeltIntel] Load error:', err);
      setError(t('common.failedIntelFeed') ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadTopic(activeTopic);
  }, [activeTopic]); // eslint-disable-line react-hooks/exhaustive-deps

  const entry = cache.get(activeTopic.id);
  const articles = entry?.data.articles ?? [];
  const timeline = entry?.timeline ?? null;
  const showSummary = timeline && (timeline.tone.length >= 2 || timeline.vol.length >= 2);

  return (
    <div className="gdelt-intel-panel">
      <div className="panel-tabs">
        {TOPICS.map(topic => (
          <button
            key={topic.id}
            className={`panel-tab${activeTopic.id === topic.id ? ' active' : ''}`}
            data-topic-id={topic.id}
            title={topic.description}
            onClick={() => setActiveTopic(topic)}
          >
            <span className="tab-icon">{topic.icon}</span>
            <span className="tab-label">{topic.name}</span>
          </button>
        ))}
      </div>

      {showSummary && <TopicSummary timeline={timeline!} />}

      {loading && (
        <div className="panel-loading">
          <div className="panel-loading-radar">
            <div className="panel-radar-sweep" />
            <div className="panel-radar-dot" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="panel-error-state">
          <div className="panel-error-msg">{error}</div>
          <button className="panel-error-retry" data-panel-retry="" onClick={() => void loadTopic(activeTopic)}>
            {t('common.retry') ?? 'Retry'}
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="gdelt-intel-articles">
          {articles.length > 0
            ? articles.map((a, i) => <Article key={a.url || i} article={a} />)
            : <div className="empty-state">{t('components.gdelt.empty') ?? 'No articles found'}</div>
          }
        </div>
      )}
    </div>
  );
}

export function GdeltIntelPanel() {
  return (
    <PanelShell
      id="gdelt-intel"
      title={t('panels.gdeltIntel')}
      infoTooltip={t('components.gdeltIntel.infoTooltip')}
      defaultRowSpan={2}
    >
      <GdeltIntelPanelContent />
    </PanelShell>
  );
}
