import { useState, useEffect, useRef } from 'react';
import { mlWorker } from '@/services/ml-worker';
import { generateSummary, type SummarizeOptions } from '@/services/summarization';
import { parallelAnalysis, type AnalyzedHeadline } from '@/services/parallel-analysis';
import { signalAggregator, type RegionalConvergence } from '@/services/signal-aggregator';
import { focalPointDetector } from '@/services/focal-point-detector';
import { stripOrefLabels } from '@/services/oref-alerts';
import { ingestNewsForCII } from '@/services/country-instability';
import { getCachedCountryScoreValue } from '@/services/cached-risk-scores';
import { getTheaterPostureSummaries } from '@/services/military-surge';
import { getCachedPosture } from '@/services/cached-theater-posture';
import { isMobileDevice } from '@/utils';
import { sanitizeUrl } from '@/utils/sanitize';
import { collectBriefSources, normalizeCachedBriefSources, type BriefSource } from '@/utils/brief-sources';
import { formatIntelBrief } from '@/utils/format-intel-brief';
import { SITE_VARIANT } from '@/config';
import { deletePersistentCache, getPersistentCache, setPersistentCache } from '@/services/persistent-cache';
import { t } from '@/services/i18n';
import { isDesktopRuntime } from '@/services/runtime';
import { getAiFlowSettings, isAnyAiProviderEnabled, subscribeAiFlowChange } from '@/services/ai-flow-settings';
import { getActiveFrameworkForPanel, subscribeFrameworkChange } from '@/services/analysis-framework-store';
import { subscribeInsightsData, getInsightsData } from '@/services/insights-store';
import { fetchServerInsights, getServerInsights, type ServerInsights, type ServerInsightStory } from '@/services/insights-loader';
import { computeISQ, type SignalQuality, type SignalQualityInput } from '@/utils/signal-quality';
import { extractEntitiesFromTitle } from '@/services/entity-extraction';
import { getEntityIndex } from '@/services/entity-index';
import type { ClusteredEvent, FocalPoint, MilitaryFlight } from '@/types';
import { PanelShell } from '@/components/PanelShell';

// ── Constants ─────────────────────────────────────────────────────────────────

const BRIEF_COOLDOWN_MS = 120000;
const BRIEF_CACHE_KEY = 'summary:world-brief';
const BRIEF_CACHE_MAX_SOURCES = 12;

// ── Types ─────────────────────────────────────────────────────────────────────

type Sentiment = { label: string; score: number };

interface ServerRenderData {
  path: 'server';
  insights: ServerInsights;
  sortedStories: ServerInsightStory[];
  sentiments: Sentiment[] | null;
  worldBrief: string | null;
  worldBriefSources: BriefSource[];
  focalPoints: FocalPoint[];
  convergenceZones: RegionalConvergence[];
  missedStories: AnalyzedHeadline[];
}

interface ClientRenderData {
  path: 'client';
  items: Array<{ cluster: ClusteredEvent; isq: SignalQuality }>;
  sentiments: Sentiment[] | null;
  worldBrief: string | null;
  worldBriefSources: BriefSource[];
  focalPoints: FocalPoint[];
  convergenceZones: RegionalConvergence[];
  missedStories: AnalyzedHeadline[];
}

type PanelState =
  | { type: 'idle' }
  | { type: 'progress'; step: number; total: number; message: string }
  | { type: 'empty'; message: string }
  | { type: 'disabled' }
  | { type: 'error' }
  | { type: 'result'; data: ServerRenderData | ClientRenderData };

// ── Helpers ───────────────────────────────────────────────────────────────────

const getAuthoritativeCountryScore = getCachedCountryScoreValue;

function extractISQInput(cluster: ClusteredEvent): SignalQualityInput {
  const entities = extractEntitiesFromTitle(cluster.primaryTitle);
  const idx = getEntityIndex();
  const countryEntity = entities.find(
    e => e.matchType === 'alias' && idx.byId.get(e.entityId)?.type === 'country',
  );
  return {
    sourceCount: cluster.sourceCount,
    isAlert: cluster.isAlert,
    sourceTier: cluster.topSources?.[0]?.tier ?? undefined,
    threatLevel: cluster.threat?.level ?? undefined,
    velocity: cluster.velocity ?? undefined,
    countryCode: countryEntity?.entityId ?? null,
  };
}

function selectTopStories(
  clusters: ClusteredEvent[],
  maxCount: number,
  focalFn: (code: string) => { focalScore: number; urgency: string } | null,
  ciiFn: (code: string) => number | null,
  isFocalReadyFn: () => boolean,
): Array<{ cluster: ClusteredEvent; isq: SignalQuality }> {
  const allScored = clusters.map(c => ({
    cluster: c,
    isq: computeISQ(extractISQInput(c), focalFn, ciiFn, isFocalReadyFn),
  }));
  const candidates = allScored.filter(({ cluster: c, isq }) =>
    c.sourceCount >= 2 ||
    c.isAlert ||
    (c.velocity && c.velocity.level !== 'normal') ||
    isq.composite > 0.55 ||
    isq.tier === 'strong',
  );
  const sorted = candidates.sort((a, b) => b.isq.composite - a.isq.composite);
  const selected: Array<{ cluster: ClusteredEvent; isq: SignalQuality }> = [];
  const sourceCount = new Map<string, number>();
  const MAX_PER_SOURCE = 3;
  for (const item of sorted) {
    const source = item.cluster.primarySource;
    const count = sourceCount.get(source) ?? 0;
    if (count < MAX_PER_SOURCE) {
      selected.push(item);
      sourceCount.set(source, count + 1);
    }
    if (selected.length >= maxCount) break;
  }
  return selected;
}

function getTheaterPostureContext(flights: MilitaryFlight[]): string {
  const cachedPostures = getCachedPosture()?.postures;
  const postures = cachedPostures?.length
    ? cachedPostures
    : (flights.length > 0 ? getTheaterPostureSummaries(flights) : []);
  const significant = postures.filter(
    p => p.postureLevel === 'critical' || p.postureLevel === 'elevated' || p.strikeCapable,
  );
  if (significant.length === 0) return '';
  const lines = significant.map(p => {
    const parts: string[] = [];
    parts.push(`${p.theaterName}: ${p.totalAircraft} aircraft`);
    parts.push(`(${p.postureLevel.toUpperCase()})`);
    if (p.strikeCapable) parts.push('STRIKE CAPABLE');
    parts.push(`- ${p.summary}`);
    if (p.targetNation) parts.push(`Focus: ${p.targetNation}`);
    return parts.join(' ');
  });
  return `\n\nCRITICAL MILITARY POSTURE:\n${lines.join('\n')}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressDisplay({ step, total, message }: { step: number; total: number; message: string }) {
  const percent = Math.round((step / total) * 100);
  return (
    <div className="insights-progress">
      <div className="insights-progress-bar">
        <div className="insights-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="insights-progress-info">
        <span className="insights-progress-step">{t('components.insights.step', { step: String(step), total: String(total) })}</span>
        <span className="insights-progress-message">{message}</span>
      </div>
    </div>
  );
}

function DisabledStateDisplay() {
  return (
    <div className="insights-disabled">
      <div className="insights-disabled-icon">⚡</div>
      <div className="insights-disabled-title">{t('components.insights.insightsDisabledTitle')}</div>
      <div className="insights-disabled-hint">{t('components.insights.insightsDisabledHint')}</div>
    </div>
  );
}

function BriefSourcesFooter({ sources, className = 'brief-sources', maxSources = 6 }: { sources: BriefSource[]; className?: string; maxSources?: number }) {
  const normalized = collectBriefSources(sources, maxSources);
  if (!normalized.length) return null;
  const sourceWord = normalized.length === 1 ? 'source' : 'sources';
  return (
    <details className={className}>
      <summary>Sources ({normalized.length})</summary>
      <div className="brief-sources-note">
        AI-synthesized from {normalized.length} {sourceWord} &middot; may contain errors &middot;{' '}
        <a href="/docs/methodology/news-digest-and-briefing" target="_blank" rel="noopener noreferrer">Methodology</a>
      </div>
      <ol>
        {normalized.map((s, i) => (
          <li key={i}>
            <a href={sanitizeUrl(s.url)} target="_blank" rel="noopener noreferrer">{s.title}</a>
            <span className="brief-source-meta">
              {s.source}
              {s.publishedAt && <span className="brief-source-date">{s.publishedAt.slice(0, 10)}</span>}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function BriefExtras({ insights }: { insights: ServerInsights }) {
  const lines = Array.isArray(insights.briefStoryLines) ? insights.briefStoryLines : [];
  const sources = insights.worldBriefSources ?? [];
  const generatedMs = new Date(insights.generatedAt).getTime();
  const newestMs = insights.sourceAgeRange?.newestMs;
  const showFreshness = Number.isFinite(generatedMs) && Number.isFinite(newestMs);

  if (!lines.length && !showFreshness) return null;

  const agoMin = showFreshness ? Math.max(0, Math.round((Date.now() - generatedMs) / 60000)) : 0;
  const newestAgeH = showFreshness ? Math.max(0, Math.round((Date.now() - (newestMs as number)) / 3600000 * 10) / 10) : 0;

  return (
    <>
      {lines.length > 0 && (
        <ol className="insights-brief-lines">
          {lines.map((line, i) => {
            const html = formatIntelBrief(line.text, { sources })
              .replace(/^<div class="brief-para">/, '')
              .replace(/<\/div>$/, '')
              .replace(/^<p>/, '')
              .replace(/<\/p>$/, '');
            return <li key={i} dangerouslySetInnerHTML={{ __html: html }} />;
          })}
        </ol>
      )}
      {showFreshness && (
        <div className="insights-brief-freshness">
          {t('components.insights.briefFreshness', { minutes: String(agoMin), hours: String(newestAgeH) })}
        </div>
      )}
    </>
  );
}

function WorldBrief({ brief, sources, extraNode }: { brief: string; sources: BriefSource[]; extraNode?: React.ReactNode }) {
  const heading =
    SITE_VARIANT === 'tech'      ? `🚀 ${t('components.insights.briefTech')}`
    : SITE_VARIANT === 'commodity' ? `⛏️ ${t('components.insights.briefCommodity')}`
    : SITE_VARIANT === 'energy'    ? `⚡ ${t('components.insights.briefEnergy')}`
    :                                `🌍 ${t('components.insights.briefWorld')}`;
  const maxSources = Math.max(6, sources.length);
  return (
    <div className="insights-brief">
      <div className="insights-section-title">{heading}</div>
      <div className="insights-brief-text">{brief}</div>
      {extraNode}
      <BriefSourcesFooter sources={sources} className="insights-brief-sources" maxSources={maxSources} />
    </div>
  );
}

const FOCAL_ICONS: Record<string, string> = {
  internet_outage: '🌐',
  military_flight: '✈️',
  military_vessel: '⚓',
  protest: '📢',
  ais_disruption: '🚢',
  active_strike: '💥',
};

function FocalPointsSection({ points }: { points: FocalPoint[] }) {
  const correlated = points.filter(
    fp => (fp.newsMentions > 0 && fp.signalCount > 0) || fp.signalTypes.includes('active_strike'),
  ).slice(0, 5);
  if (!correlated.length) return null;
  return (
    <div className="insights-section insights-focal">
      <div className="insights-section-title">🎯 {t('components.insights.focalPoints')}</div>
      {correlated.map((fp, i) => {
        const icons = fp.signalTypes.map(type => FOCAL_ICONS[type] || '').join(' ');
        const topHeadline = fp.topHeadlines[0];
        const headlineText = topHeadline?.title?.slice(0, 60) || '';
        const headlineUrl = sanitizeUrl(topHeadline?.url || '');
        return (
          <div key={i} className={`focal-point ${fp.urgency}`}>
            <div className="focal-point-header">
              <span className="focal-point-name">{fp.displayName}</span>
              <span className={`focal-point-urgency ${fp.urgency}`}>{fp.urgency.toUpperCase()}</span>
            </div>
            <div className="focal-point-signals">{icons}</div>
            <div className="focal-point-stats">
              {t('components.insights.newsSignals', { news: fp.newsMentions, signals: fp.signalCount })}
            </div>
            {headlineText && headlineUrl && (
              <a href={headlineUrl} target="_blank" rel="noopener" className="focal-point-headline">
                "{headlineText}..."
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CONVERGENCE_ICONS: Record<string, string> = {
  internet_outage: '🌐',
  military_flight: '✈️',
  military_vessel: '🚢',
  protest: '🪧',
  ais_disruption: '⚓',
};

function ConvergenceZonesSection({ zones }: { zones: RegionalConvergence[] }) {
  if (!zones.length) return null;
  return (
    <div className="insights-section insights-convergence">
      <div className="insights-section-title">📍 {t('components.insights.geographicConvergence')}</div>
      {zones.slice(0, 3).map((zone, i) => {
        const icons = zone.signalTypes.map(type => CONVERGENCE_ICONS[type] || '📍').join('');
        return (
          <div key={i} className="convergence-zone">
            <div className="convergence-region">{icons} {zone.region}</div>
            <div className="convergence-description">{zone.description}</div>
            <div className="convergence-stats">
              {t('components.insights.signalTypesEvents', { types: zone.signalTypes.length, events: zone.totalSignals })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SentimentOverview({ sentiments }: { sentiments: Sentiment[] }) {
  if (!sentiments.length) return null;
  const negative = sentiments.filter(s => s.label === 'negative').length;
  const positive = sentiments.filter(s => s.label === 'positive').length;
  const neutral = sentiments.length - negative - positive;
  const total = sentiments.length;
  const negPct = Math.round((negative / total) * 100);
  const neuPct = Math.round((neutral / total) * 100);
  const posPct = 100 - negPct - neuPct;
  let toneLabel = t('components.insights.toneMixed');
  let toneClass = 'neutral';
  if (negative > positive + neutral) { toneLabel = t('components.insights.toneNegative'); toneClass = 'negative'; }
  else if (positive > negative + neutral) { toneLabel = t('components.insights.tonePositive'); toneClass = 'positive'; }
  return (
    <div className="insights-sentiment-bar">
      <div className="sentiment-bar-track">
        <div className="sentiment-bar-negative" style={{ width: `${negPct}%` }} />
        <div className="sentiment-bar-neutral" style={{ width: `${neuPct}%` }} />
        <div className="sentiment-bar-positive" style={{ width: `${posPct}%` }} />
      </div>
      <div className="sentiment-bar-labels">
        <span className="sentiment-label negative">{negative}</span>
        <span className="sentiment-label neutral">{neutral}</span>
        <span className="sentiment-label positive">{positive}</span>
      </div>
      <div className={`sentiment-tone ${toneClass}`}>{t('components.insights.overall', { tone: toneLabel })}</div>
    </div>
  );
}

function ServerStats({ insights }: { insights: ServerInsights }) {
  return (
    <div className="insights-stats">
      <div className="insight-stat">
        <span className="insight-stat-value">{insights.multiSourceCount}</span>
        <span className="insight-stat-label">{t('components.insights.multiSource')}</span>
      </div>
      <div className="insight-stat">
        <span className="insight-stat-value">{insights.fastMovingCount}</span>
        <span className="insight-stat-label">{t('components.insights.fastMoving')}</span>
      </div>
      <div className="insight-stat">
        <span className="insight-stat-value">{insights.clusterCount}</span>
        <span className="insight-stat-label">{t('components.insights.clusters')}</span>
      </div>
    </div>
  );
}

function ClientStats({ clusters }: { clusters: ClusteredEvent[] }) {
  const multiSource = clusters.filter(c => c.sourceCount >= 2).length;
  const fastMoving = clusters.filter(c => c.velocity && c.velocity.level !== 'normal').length;
  const alerts = clusters.filter(c => c.isAlert).length;
  return (
    <div className="insights-stats">
      <div className="insight-stat">
        <span className="insight-stat-value">{multiSource}</span>
        <span className="insight-stat-label">{t('components.insights.multiSource')}</span>
      </div>
      <div className="insight-stat">
        <span className="insight-stat-value">{fastMoving}</span>
        <span className="insight-stat-label">{t('components.insights.fastMoving')}</span>
      </div>
      {alerts > 0 && (
        <div className="insight-stat alert">
          <span className="insight-stat-value">{alerts}</span>
          <span className="insight-stat-label">{t('components.insights.alertsLabel')}</span>
        </div>
      )}
    </div>
  );
}

function ProvenanceLine({ insights }: { insights: ServerInsights }) {
  const prov = insights.provenance;
  if (!prov?.storiesConsidered) return null;
  return (
    <div className="insights-provenance" title={t('components.insights.provenanceTitle')}>
      {t('components.insights.compiledFrom', { stories: String(prov.storiesConsidered), sources: String(prov.sourcesConsidered) })}
    </div>
  );
}

const ISQ_BADGE_CLASS: Record<string, string> = {
  strong: 'isq-strong', notable: 'isq-notable', weak: 'isq-weak', noise: 'isq-noise',
};
const VALID_THREAT_LEVELS = ['critical', 'high', 'elevated', 'moderate', 'medium', 'low', 'info'];

function ServerStories({ stories, sentiments }: { stories: ServerInsightStory[]; sentiments: Sentiment[] | null }) {
  return (
    <>
      {stories.map((story, i) => {
        const sentiment = sentiments?.[i];
        const sentClass = sentiment?.label === 'negative' ? 'negative' : sentiment?.label === 'positive' ? 'positive' : 'neutral';
        const badges: React.ReactNode[] = [];
        if (story.sourceCount >= 3)
          badges.push(<span key="conf" className="insight-badge confirmed">✓ {t('components.insights.sources', { count: story.sourceCount })}</span>);
        else if (story.sourceCount >= 2)
          badges.push(<span key="multi" className="insight-badge multi">{t('components.insights.sources', { count: story.sourceCount })}</span>);
        if (story.isAlert)
          badges.push(<span key="alert" className="insight-badge alert">⚠ {t('components.insights.alert')}</span>);
        if (story.threatLevel === 'critical' || story.threatLevel === 'high') {
          const safeThreat = VALID_THREAT_LEVELS.includes(story.threatLevel) ? story.threatLevel : 'moderate';
          badges.push(<span key="threat" className={`insight-badge velocity ${safeThreat}`}>{story.category}</span>);
        }
        const title = story.primaryTitle.length > 100
          ? `${story.primaryTitle.slice(0, 100)}...`
          : story.primaryTitle;
        return (
          <div key={i} className="insight-story">
            <div className="insight-story-header">
              <span className={`insight-sentiment-dot ${sentClass}`} />
              <span className="insight-story-title">{title}</span>
            </div>
            {badges.length > 0 && <div className="insight-badges">{badges}</div>}
          </div>
        );
      })}
    </>
  );
}

function ClientStories({ items, sentiments }: { items: Array<{ cluster: ClusteredEvent; isq: SignalQuality }>; sentiments: Sentiment[] | null }) {
  return (
    <>
      {items.map(({ cluster, isq }, i) => {
        const sentiment = sentiments?.[i];
        const sentClass = sentiment?.label === 'negative' ? 'negative' : sentiment?.label === 'positive' ? 'positive' : 'neutral';
        const badges: React.ReactNode[] = [];
        if (isq.tier === 'strong' || isq.tier === 'notable')
          badges.push(<span key="isq" className={`insight-badge ${ISQ_BADGE_CLASS[isq.tier]}`}>{isq.tier.toUpperCase()}</span>);
        if (cluster.sourceCount >= 3)
          badges.push(<span key="conf" className="insight-badge confirmed">✓ {t('components.insights.sources', { count: cluster.sourceCount })}</span>);
        else if (cluster.sourceCount >= 2)
          badges.push(<span key="multi" className="insight-badge multi">{t('components.insights.sources', { count: cluster.sourceCount })}</span>);
        if (cluster.velocity && cluster.velocity.level !== 'normal') {
          const velIcon = cluster.velocity.trend === 'rising' ? '↑' : '';
          badges.push(<span key="vel" className={`insight-badge velocity ${cluster.velocity.level}`}>{velIcon}+{cluster.velocity.sourcesPerHour}/hr</span>);
        }
        if (cluster.isAlert)
          badges.push(<span key="alert" className="insight-badge alert">⚠ {t('components.insights.alert')}</span>);
        const title = cluster.primaryTitle.length > 100
          ? `${cluster.primaryTitle.slice(0, 100)}...`
          : cluster.primaryTitle;
        return (
          <div key={i} className="insight-story">
            <div className="insight-story-header">
              <span className={`insight-sentiment-dot ${sentClass}`} />
              <span className="insight-story-title">{title}</span>
            </div>
            {badges.length > 0 && <div className="insight-badges">{badges}</div>}
          </div>
        );
      })}
    </>
  );
}

function MissedStoriesSection({ missed }: { missed: AnalyzedHeadline[] }) {
  let showMlDetected = false;
  try { showMlDetected = localStorage.getItem('wm:debug-ml') === '1'; } catch { /* ignore */ }
  if (!missed.length || !showMlDetected) return null;
  return (
    <div className="insights-section insights-missed">
      <div className="insights-section-title">🎯 {t('components.insights.mlDetected')}</div>
      {missed.slice(0, 3).map((story, i) => {
        const topPerspective = story.perspectives
          .filter(p => p.name !== 'keywords')
          .sort((a, b) => b.score - a.score)[0];
        const perspectiveName = topPerspective?.name ?? 'ml';
        const perspectiveScore = topPerspective?.score ?? 0;
        const storyTitle = story.title.length > 80 ? `${story.title.slice(0, 80)}...` : story.title;
        return (
          <div key={i} className="insight-story missed">
            <div className="insight-story-header">
              <span className="insight-sentiment-dot ml-flagged" />
              <span className="insight-story-title">{storyTitle}</span>
            </div>
            <div className="insight-badges">
              <span className="insight-badge ml-detected">🔬 {perspectiveName}: {(perspectiveScore * 100).toFixed(0)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside the insights panel's content div. */
export function InsightsPanelContent() {
  const [input, setInput] = useState<{ clusters: ClusteredEvent[]; version: number }>(() => {
    const d = getInsightsData();
    return { clusters: d.clusters, version: 0 };
  });
  const [panelState, setPanelState] = useState<PanelState>({ type: 'idle' });

  const flightsRef = useRef<MilitaryFlight[]>(getInsightsData().militaryFlights);
  const updateGenerationRef = useRef(0);
  const cachedBriefRef = useRef<string | null>(null);
  const cachedBriefSourcesRef = useRef<BriefSource[]>([]);
  const lastBriefUpdateRef = useRef(0);
  const lastMissedStoriesRef = useRef<AnalyzedHeadline[]>([]);

  // Receive data pushed from the data-loader via the insights store
  useEffect(() => subscribeInsightsData(({ clusters, militaryFlights }) => {
    flightsRef.current = militaryFlights;
    setInput(prev => ({ clusters, version: prev.version + 1 }));
  }), []);

  // Early-paint: load cached brief at mount if no real data yet (mirrors paintCachedBriefEarly)
  useEffect(() => {
    const gen = updateGenerationRef.current;
    getPersistentCache<{ summary: string; sources?: BriefSource[] }>(BRIEF_CACHE_KEY)
      .then(entry => {
        if (updateGenerationRef.current > gen || !entry?.data?.summary) return;
        const { sources, legacySourceShape } = normalizeCachedBriefSources(entry.data, BRIEF_CACHE_MAX_SOURCES);
        if (legacySourceShape) { void deletePersistentCache(BRIEF_CACHE_KEY); return; }
        cachedBriefRef.current = entry.data.summary;
        cachedBriefSourcesRef.current = sources;
        lastBriefUpdateRef.current = entry.updatedAt;
        setPanelState({
          type: 'result',
          data: {
            path: 'client',
            items: [],
            sentiments: null,
            worldBrief: entry.data.summary,
            worldBriefSources: sources,
            focalPoints: [],
            convergenceZones: [],
            missedStories: [],
          },
        });
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // AI flow change subscription
  useEffect(() => {
    if (isDesktopRuntime() || isMobileDevice()) return;
    return subscribeAiFlowChange((changedKey) => {
      if (changedKey === 'mapNewsFlash') return;
      updateGenerationRef.current++;
      cachedBriefRef.current = null;
      lastBriefUpdateRef.current = 0;
      void deletePersistentCache(BRIEF_CACHE_KEY).catch(() => {});
      if (!isAnyAiProviderEnabled()) {
        setPanelState({ type: 'disabled' });
        return;
      }
      setInput(prev => ({ clusters: prev.clusters, version: prev.version + 1 }));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Framework change subscription
  useEffect(() => {
    return subscribeFrameworkChange('insights', () => {
      setInput(prev => ({ clusters: prev.clusters, version: prev.version + 1 }));
    });
  }, []);

  // Main pipeline
  useEffect(() => {
    if (input.version === 0) return; // not yet triggered from outside

    const gen = ++updateGenerationRef.current;
    const { clusters } = input;

    async function runPipeline() {
      // Try server-side pre-computed insights first
      let serverInsights = getServerInsights();
      if (!serverInsights) {
        if (updateGenerationRef.current !== gen) return;
        serverInsights = await fetchServerInsights();
        if (updateGenerationRef.current !== gen) return;
      }
      if (serverInsights) {
        await runServerPipeline(serverInsights, clusters, gen);
        return;
      }

      if (clusters.length === 0) {
        setPanelState({ type: 'empty', message: t('components.insights.waitingForData') });
        return;
      }
      if (isMobileDevice()) {
        setPanelState({ type: 'empty', message: t('components.insights.waitingForData') });
        return;
      }
      await runClientPipeline(clusters, gen);
    }

    async function runServerPipeline(serverInsights: ServerInsights, clusters: ClusteredEvent[], gen: number) {
      const totalSteps = 2;
      try {
        if (clusters.length === 0) lastMissedStoriesRef.current = [];

        setPanelState({ type: 'progress', step: 1, total: totalSteps, message: t('components.insights.loadingServerInsights') });
        const flights = flightsRef.current;

        let focalPoints: FocalPoint[] = [];
        let convergenceZones: RegionalConvergence[] = [];

        if (SITE_VARIANT === 'full') {
          const _cp = getCachedPosture()?.postures;
          const theaterPostures = _cp?.length
            ? _cp
            : (flights.length > 0 ? getTheaterPostureSummaries(flights) : []);
          if (theaterPostures.length > 0) signalAggregator.ingestTheaterPostures(theaterPostures);
          const signalSummary = signalAggregator.getSummary();
          convergenceZones = signalSummary.convergenceZones;
          const focalSummary = focalPointDetector.analyze(clusters, signalSummary);
          focalPoints = focalSummary.focalPoints;
          if (focalSummary.focalPoints.length > 0) {
            ingestNewsForCII(clusters);
            window.dispatchEvent(new CustomEvent('focal-points-ready'));
          }
        }

        if (updateGenerationRef.current !== gen) return;

        setPanelState({ type: 'progress', step: 2, total: totalSteps, message: t('components.insights.analyzingSentiment') });

        const focalFnServer = (code: string) => {
          const fp = focalPointDetector.getFocalPointForCountry(code);
          return (fp && (fp.signalCount > 0 || fp.signalTypes.includes('active_strike'))) ? fp : null;
        };
        const isFocalReadyServer = () => (focalPointDetector.getLastSummary()?.topCountries.some(
          fp => fp.signalCount > 0 || fp.signalTypes.includes('active_strike'),
        ) ?? false);

        const sortedStories = [...serverInsights.topStories].sort((a, b) => {
          const isqA = computeISQ(
            { sourceCount: a.sourceCount, isAlert: a.isAlert, threatLevel: a.threatLevel ?? undefined, countryCode: a.countryCode, velocity: a.velocity },
            focalFnServer, getAuthoritativeCountryScore, isFocalReadyServer,
          );
          const isqB = computeISQ(
            { sourceCount: b.sourceCount, isAlert: b.isAlert, threatLevel: b.threatLevel ?? undefined, countryCode: b.countryCode, velocity: b.velocity },
            focalFnServer, getAuthoritativeCountryScore, isFocalReadyServer,
          );
          return isqB.composite - isqA.composite;
        });

        const titles = sortedStories.slice(0, 5).map(s => s.primaryTitle);
        let sentiments: Sentiment[] | null = null;
        if (mlWorker.isAvailable) {
          sentiments = await mlWorker.classifySentiment(titles).catch(() => null);
        }
        if (updateGenerationRef.current !== gen) return;

        // Cache the brief from server
        const worldBriefSources = collectBriefSources(
          serverInsights.worldBriefSources ?? [],
          Math.min(12, Math.max(6, serverInsights.worldBriefSources?.length ?? 6)),
        );
        if (serverInsights.worldBrief) {
          cachedBriefRef.current = serverInsights.worldBrief;
          cachedBriefSourcesRef.current = worldBriefSources;
          lastBriefUpdateRef.current = Date.now();
          void setPersistentCache(BRIEF_CACHE_KEY, { summary: serverInsights.worldBrief, sources: worldBriefSources });
        }

        setPanelState({
          type: 'result',
          data: {
            path: 'server',
            insights: { ...serverInsights, topStories: sortedStories },
            sortedStories,
            sentiments,
            worldBrief: serverInsights.worldBrief ?? null,
            worldBriefSources,
            focalPoints,
            convergenceZones,
            missedStories: lastMissedStoriesRef.current,
          },
        });
      } catch (error) {
        console.error('[InsightsPanel] Server path error, falling back:', error);
        await runClientPipeline(clusters, gen);
      }
    }

    async function runClientPipeline(clusters: ClusteredEvent[], gen: number) {
      if (!isDesktopRuntime() && !isAnyAiProviderEnabled()) {
        setPanelState({ type: 'disabled' });
        return;
      }

      const aiFlow = isDesktopRuntime() ? { cloudLlm: true, browserModel: true } : getAiFlowSettings();
      const summarizeOpts: SummarizeOptions = {
        skipCloudProviders: !aiFlow.cloudLlm,
        skipBrowserFallback: !aiFlow.browserModel,
      };
      const totalSteps = 4;
      const flights = flightsRef.current;

      try {
        setPanelState({ type: 'progress', step: 1, total: totalSteps, message: t('components.insights.rankingStories') });

        const parallelPromise = parallelAnalysis.analyzeHeadlines(clusters)
          .then(report => { lastMissedStoriesRef.current = report.missedByKeywords; })
          .catch(err => { console.warn('[ParallelAnalysis] Error:', err); });

        let focalPoints: FocalPoint[] = [];
        let convergenceZones: RegionalConvergence[] = [];
        let focalSummaryAiCtx = '';
        let signalSummaryAiCtx = '';

        if (SITE_VARIANT === 'full') {
          const _cp = getCachedPosture()?.postures;
          const theaterPostures = _cp?.length
            ? _cp
            : (flights.length > 0 ? getTheaterPostureSummaries(flights) : []);
          if (theaterPostures.length > 0) signalAggregator.ingestTheaterPostures(theaterPostures);
          const signalSummary = signalAggregator.getSummary();
          convergenceZones = signalSummary.convergenceZones;
          signalSummaryAiCtx = signalSummary.aiContext;
          const focalSummary = focalPointDetector.analyze(clusters, signalSummary);
          focalPoints = focalSummary.focalPoints;
          focalSummaryAiCtx = focalSummary.aiContext;
          if (focalSummary.focalPoints.length > 0) {
            ingestNewsForCII(clusters);
            window.dispatchEvent(new CustomEvent('focal-points-ready'));
          }
        }

        const focalFn = (code: string) => {
          const fp = focalPointDetector.getFocalPointForCountry(code);
          return (fp && (fp.signalCount > 0 || fp.signalTypes.includes('active_strike'))) ? fp : null;
        };
        const isFocalReady = () => (focalPointDetector.getLastSummary()?.topCountries.some(
          fp => fp.signalCount > 0 || fp.signalTypes.includes('active_strike'),
        ) ?? false);

        const importantItems = selectTopStories(clusters, 8, focalFn, getAuthoritativeCountryScore, isFocalReady);

        if (importantItems.length === 0) {
          setPanelState({ type: 'empty', message: t('components.insights.noStories') });
          return;
        }

        const importantClusters = importantItems.map(({ cluster }) => cluster);
        const titles = importantClusters.slice(0, 5).map(c => stripOrefLabels(c.primaryTitle));
        const currentBriefSources = collectBriefSources(
          importantClusters.slice(0, 5).map(cluster => ({
            primaryTitle: stripOrefLabels(cluster.primaryTitle),
            primarySource: cluster.primarySource,
            primaryLink: cluster.primaryLink,
            pubDate: cluster.lastUpdated,
          })),
          6,
        );

        setPanelState({ type: 'progress', step: 2, total: totalSteps, message: t('components.insights.analyzingSentiment') });

        let sentiments: Sentiment[] | null = null;
        if (mlWorker.isAvailable) {
          sentiments = await mlWorker.classifySentiment(titles).catch(() => null);
        }
        if (updateGenerationRef.current !== gen) return;

        // Load cached brief
        if (!cachedBriefRef.current) {
          const entry = await getPersistentCache<{ summary: string; sources?: BriefSource[] }>(BRIEF_CACHE_KEY);
          if (updateGenerationRef.current !== gen) return;
          if (entry?.data?.summary) {
            const { sources, legacySourceShape } = normalizeCachedBriefSources(entry.data, BRIEF_CACHE_MAX_SOURCES);
            if (!legacySourceShape) {
              cachedBriefRef.current = entry.data.summary;
              cachedBriefSourcesRef.current = sources;
              lastBriefUpdateRef.current = entry.updatedAt;
            } else {
              void deletePersistentCache(BRIEF_CACHE_KEY);
            }
          }
        }

        let worldBrief = cachedBriefRef.current;
        const now = Date.now();

        if (!worldBrief || now - lastBriefUpdateRef.current > BRIEF_COOLDOWN_MS) {
          setPanelState({ type: 'progress', step: 3, total: totalSteps, message: t('components.insights.generatingBrief') });

          const theaterContext = SITE_VARIANT === 'full' ? getTheaterPostureContext(flights) : '';
          let geoContext = SITE_VARIANT === 'full'
            ? (focalSummaryAiCtx || signalSummaryAiCtx) + theaterContext
            : SITE_VARIANT === 'commodity'
              ? 'You are generating a commodities market brief. Focus on gold and precious metals price movements, mining supply risks, energy market dynamics, and macro factors driving commodity prices. Highlight supply disruptions, geopolitical risks to mining regions, central bank gold activity, and USD/inflation trends.'
              : SITE_VARIANT === 'energy'
                ? 'You are generating a global energy-intelligence brief. Focus on physical supply: oil & gas pipeline status and disruptions (Druzhba, Nord Stream, TurkStream, Power of Siberia, CPC), chokepoint flow (Hormuz, Malacca, Suez, Bab el-Mandeb, Turkish Straits, Danish Straits, Panama), storage levels (EU gas, US SPR, IEA stocks, days-of-cover), fuel shortages (jet / petrol / diesel / heating oil), refinery outages, LNG flows, OPEC+ production signals, and sanctions impacts. Prefer physical constraints and evidence-grounded status changes over price commentary. Attribute every flow figure to its source (AIS calibration, operator disclosure, regulator data) — never ship a bare conclusion.'
                : '';

          const insightsFw = getActiveFrameworkForPanel('insights');
          if (insightsFw) geoContext = `${geoContext}\n\n---\nAnalytical Framework:\n${insightsFw.systemPromptAppend}`;

          const result = await generateSummary(titles, (_s, _t2, msg) => {
            setPanelState({ type: 'progress', step: 3, total: totalSteps, message: t('components.insights.generatingBriefSub', { msg }) });
          }, geoContext, undefined, summarizeOpts);

          if (updateGenerationRef.current !== gen) return;

          if (result) {
            worldBrief = result.summary;
            cachedBriefRef.current = worldBrief;
            cachedBriefSourcesRef.current = currentBriefSources;
            lastBriefUpdateRef.current = now;
            void setPersistentCache(BRIEF_CACHE_KEY, { summary: worldBrief, sources: currentBriefSources });
          }
        } else {
          setPanelState({ type: 'progress', step: 3, total: totalSteps, message: t('components.insights.usingCachedBrief') });
        }

        setPanelState({ type: 'progress', step: 4, total: totalSteps, message: t('components.insights.multiPerspectiveAnalysis') });
        await parallelPromise;
        if (updateGenerationRef.current !== gen) return;

        const finalSources = cachedBriefSourcesRef.current.length > 0 ? cachedBriefSourcesRef.current : currentBriefSources;
        setPanelState({
          type: 'result',
          data: {
            path: 'client',
            items: importantItems,
            sentiments,
            worldBrief,
            worldBriefSources: finalSources,
            focalPoints,
            convergenceZones,
            missedStories: lastMissedStoriesRef.current,
          },
        });
      } catch (error) {
        console.error('[InsightsPanel] Error:', error);
        setPanelState({ type: 'error' });
      }
    }

    void runPipeline();
  }, [input]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (panelState.type === 'idle') {
    return (
      <div className="insights-empty">{t('components.insights.waitingForData')}</div>
    );
  }

  if (panelState.type === 'progress') {
    return <ProgressDisplay step={panelState.step} total={panelState.total} message={panelState.message} />;
  }

  if (panelState.type === 'empty') {
    return <div className="insights-empty">{panelState.message}</div>;
  }

  if (panelState.type === 'disabled') {
    return <DisabledStateDisplay />;
  }

  if (panelState.type === 'error') {
    return <div className="insights-empty">{t('common.errorLoading')}</div>;
  }

  const { data } = panelState;

  if (data.path === 'server') {
    const { insights, sortedStories, sentiments, worldBrief, worldBriefSources, focalPoints, convergenceZones, missedStories } = data;
    return (
      <>
        {worldBrief && (
          <WorldBrief brief={worldBrief} sources={worldBriefSources} extraNode={<BriefExtras insights={insights} />} />
        )}
        <FocalPointsSection points={focalPoints} />
        <ConvergenceZonesSection zones={convergenceZones} />
        {sentiments && sentiments.length > 0 && <SentimentOverview sentiments={sentiments} />}
        <ServerStats insights={insights} />
        <ProvenanceLine insights={insights} />
        <div className="insights-section">
          <div className="insights-section-title">{t('components.insights.breakingConfirmed')}</div>
          <ServerStories stories={sortedStories} sentiments={sentiments} />
        </div>
        <MissedStoriesSection missed={missedStories} />
      </>
    );
  }

  // Client path (also used for early-paint cached brief)
  const { items, sentiments, worldBrief, worldBriefSources, focalPoints, convergenceZones, missedStories } = data;
  const clientClusters = items.map(({ cluster }) => cluster);
  return (
    <>
      {worldBrief && <WorldBrief brief={worldBrief} sources={worldBriefSources} />}
      <FocalPointsSection points={focalPoints} />
      <ConvergenceZonesSection zones={convergenceZones} />
      {sentiments && sentiments.length > 0 && <SentimentOverview sentiments={sentiments} />}
      {clientClusters.length > 0 && <ClientStats clusters={clientClusters} />}
      {items.length > 0 && (
        <div className="insights-section">
          <div className="insights-section-title">{t('components.insights.breakingConfirmed')}</div>
          <ClientStories items={items} sentiments={sentiments} />
        </div>
      )}
      <MissedStoriesSection missed={missedStories} />
    </>
  );
}

export function InsightsPanel() {
  return (
    <PanelShell
      id="insights"
      title={t('panels.insights')}
      infoTooltip={t('components.insights.infoTooltip')}
    >
      <InsightsPanelContent />
    </PanelShell>
  );
}
