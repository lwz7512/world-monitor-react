import { useState, useEffect, useRef, useCallback } from 'react';
import { t } from '@/services/i18n';
import { getCSSColor } from '@/utils';
import {
  calculateStrategicRiskOverview,
  getRecentAlerts,
  getAlertCount,
  type StrategicRiskOverview,
  type UnifiedAlert,
  type AlertPriority,
} from '@/services/cross-module-integration';
import { detectConvergence, type GeoConvergenceAlert } from '@/services/geo-convergence';
import {
  dataFreshness,
  getStatusColor,
  getStatusIcon,
  type DataFreshnessSummary,
} from '@/services/data-freshness';
import { fetchCachedRiskScores, isElevatedCiiScore, toCountryScore, type CachedRiskScores } from '@/services/cached-risk-scores';
import { getCachedPosture } from '@/services/cached-theater-posture';
import type { CountryScore } from '@/services/country-instability';
import { PanelShell } from '@/components/PanelShell';

type StrategicRiskDisplayLevel = 'critical' | 'high' | 'elevated' | 'normal' | 'low';
type StrategicRiskDisplayBand = { min: number; levelKey: StrategicRiskDisplayLevel; colorVar: string };

const STRATEGIC_RISK_BANDS: readonly StrategicRiskDisplayBand[] = [
  { min: 81, levelKey: 'critical', colorVar: '--semantic-critical' },
  { min: 66, levelKey: 'high', colorVar: '--semantic-high' },
  { min: 51, levelKey: 'elevated', colorVar: '--semantic-elevated' },
  { min: 31, levelKey: 'normal', colorVar: '--semantic-normal' },
  { min: 0, levelKey: 'low', colorVar: '--semantic-low' },
] as const;

function getFallbackScoreBand(score: number): typeof STRATEGIC_RISK_BANDS[number] {
  return STRATEGIC_RISK_BANDS.find(band => score >= band.min) ?? STRATEGIC_RISK_BANDS[STRATEGIC_RISK_BANDS.length - 1]!;
}

function getScoreColor(score: number): string { return getCSSColor(getFallbackScoreBand(score).colorVar); }
function getScoreLevel(score: number): string { return t(`countryBrief.levels.${getFallbackScoreBand(score).levelKey}`); }

function getTrendEmoji(trend: string): string {
  if (trend === 'escalating') return '📈';
  if (trend === 'de-escalating') return '📉';
  return '➡️';
}

function getTrendColor(trend: string): string {
  if (trend === 'escalating') return getCSSColor('--semantic-critical');
  if (trend === 'de-escalating') return getCSSColor('--semantic-normal');
  return getCSSColor('--text-dim');
}

function getPriorityColor(priority: AlertPriority): string {
  switch (priority) {
    case 'critical': return getCSSColor('--semantic-critical');
    case 'high': return getCSSColor('--semantic-high');
    case 'medium': return getCSSColor('--semantic-elevated');
    case 'low': return getCSSColor('--semantic-normal');
  }
}

function getPriorityEmoji(priority: AlertPriority): string {
  switch (priority) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🟢';
  }
}

function getTypeEmoji(type: string): string {
  switch (type) {
    case 'convergence': return '🎯';
    case 'cii_spike': return '📊';
    case 'cascade': return '🔗';
    case 'sanctions': return '🚫';
    case 'radiation': return '☢️';
    case 'composite': return '⚠️';
    default: return '📍';
  }
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  if (minutes < 1) return t('components.strategicRisk.time.justNow');
  if (minutes < 60) return t('components.strategicRisk.time.minutesAgo', { count: String(minutes) });
  if (hours < 24) return t('components.strategicRisk.time.hoursAgo', { count: String(hours) });
  return date.toLocaleDateString();
}

function cachedTrendToOverviewTrend(trend: string): StrategicRiskOverview['trend'] {
  if (trend === 'rising' || trend === 'escalating') return 'escalating';
  if (trend === 'falling' || trend === 'de-escalating') return 'de-escalating';
  return 'stable';
}

function cachedTimestamp(cached: CachedRiskScores): Date | null {
  const raw = cached.strategicRisk.lastUpdated ?? cached.computedAt;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function cachedTopRisks(cached: CachedRiskScores, ciiScores: CountryScore[]): string[] {
  const contributors = cached.strategicRisk.contributors
    .filter(c => c.score > 0)
    .slice(0, 5)
    .map(c => `${c.country}: ${c.score} (${c.level})`);
  if (contributors.length > 0) return contributors;
  return ciiScores.filter(s => s.score > 0).slice(0, 5).map(s => `${s.name}: ${s.score} (${s.level})`);
}

export function StrategicRiskPanelContent() {
  const abortRef = useRef(new AbortController());
  useEffect(() => () => { abortRef.current.abort(); }, []);
  const [overview, setOverview] = useState<StrategicRiskOverview | null>(null);
  const [alerts, setAlerts] = useState<UnifiedAlert[]>([]);
  const [freshnessSummary, setFreshnessSummary] = useState<DataFreshnessSummary | null>(null);
  const convergenceAlertsRef = useRef<GeoConvergenceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const breakingAlertsRef = useRef<Map<string, { threatLevel: 'critical' | 'high'; timestamp: number }>>(new Map());
  const breakingExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyedRef = useRef(false);
  const lastRiskFingerprintRef = useRef('');

  const doRefresh = useCallback(async (): Promise<boolean> => {
    const summary = dataFreshness.getSummary();
    setFreshnessSummary(summary);
    const newConvergenceAlerts = detectConvergence();
    convergenceAlertsRef.current = newConvergenceAlerts;

    const BREAKING_TTL = 30 * 60 * 1000;
    const now = Date.now();
    const staleIds: string[] = [];
    for (const [id, entry] of breakingAlertsRef.current) {
      if (entry.timestamp < now - BREAKING_TTL) staleIds.push(id);
    }
    for (const id of staleIds) breakingAlertsRef.current.delete(id);

    if (breakingExpiryTimerRef.current) clearTimeout(breakingExpiryTimerRef.current);
    if (breakingAlertsRef.current.size > 0) {
      let earliest = Infinity;
      for (const entry of breakingAlertsRef.current.values()) {
        if (entry.timestamp < earliest) earliest = entry.timestamp;
      }
      const msUntilExpiry = (earliest + BREAKING_TTL) - now + 500;
      breakingExpiryTimerRef.current = setTimeout(() => { void doRefresh(); }, Math.max(1000, msUntilExpiry));
    }

    let breakingScore = 0;
    for (const entry of breakingAlertsRef.current.values()) {
      breakingScore += entry.threatLevel === 'critical' ? 15 : 8;
    }
    breakingScore = Math.min(15, breakingScore);

    const cachedPosture = getCachedPosture();
    const postures = cachedPosture?.postures;
    const staleFactor = cachedPosture?.stale ? 0.5 : 1;

    const cachedRiskScores = await fetchCachedRiskScores(abortRef.current.signal);
    if (destroyedRef.current) return false;

    if (!cachedRiskScores) {
      setOverview(null);
      setAlerts([]);
      setError(t('common.failedRiskOverview'));
      setLoading(false);
      return false;
    }

    const localOverview = calculateStrategicRiskOverview(
      newConvergenceAlerts,
      postures ?? undefined,
      breakingScore,
      staleFactor,
    );

    const ciiScores = cachedRiskScores.cii.map(toCountryScore).sort((a, b) => b.score - a.score);
    const mergedOverview: StrategicRiskOverview = {
      ...localOverview,
      avgCIIDeviation: ciiScores[0]?.score ?? cachedRiskScores.strategicRisk.score,
      compositeScore: Math.max(0, Math.min(100, Math.round(cachedRiskScores.strategicRisk.score))),
      trend: cachedTrendToOverviewTrend(cachedRiskScores.strategicRisk.trend),
      topRisks: cachedTopRisks(cachedRiskScores, ciiScores),
      unstableCountries: ciiScores.filter(s => isElevatedCiiScore(s.score)).slice(0, 5),
      timestamp: cachedTimestamp(cachedRiskScores),
      degraded: cachedRiskScores.degraded,
      stale: cachedRiskScores.stale,
    };

    const recentAlerts = getRecentAlerts(24);
    setOverview(mergedOverview);
    setAlerts(recentAlerts);
    setLoading(false);
    setError(null);

    const alertIds = recentAlerts.map(a => a.id).sort().join(',');
    const fp = `${mergedOverview.compositeScore}|${mergedOverview.trend}|${alertIds}`;
    const changed = fp !== lastRiskFingerprintRef.current;
    lastRiskFingerprintRef.current = fp;
    return changed;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to data freshness changes
  useEffect(() => {
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const unsub = dataFreshness.subscribe(() => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => { void doRefresh(); }, 500);
    });
    return () => {
      unsub();
      if (refreshTimeout) clearTimeout(refreshTimeout);
    };
  }, [doRefresh]);

  // Listen for breaking news events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.id) return;
      const level = detail.threatLevel;
      if (level !== 'critical' && level !== 'high') return;
      breakingAlertsRef.current.set(detail.id, { threatLevel: level, timestamp: Date.now() });
      void doRefresh();
    };
    document.addEventListener('wm:breaking-news', handler);
    return () => document.removeEventListener('wm:breaking-news', handler);
  }, [doRefresh]);

  // Initial load
  useEffect(() => {
    void doRefresh().catch(err => {
      if (destroyedRef.current) return;
      console.error('[StrategicRiskPanel] Init error:', err);
      setError(t('common.failedRiskOverview'));
      setLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      destroyedRef.current = true;
      if (breakingExpiryTimerRef.current) clearTimeout(breakingExpiryTimerRef.current);
    };
  }, []);

  if (loading) return <div className="panel-loading">{t('common.loading')}</div>;
  if (error && !overview) {
    return (
      <div className="panel-error">
        <p>{error}</p>
        <button onClick={() => void doRefresh()}>Retry</button>
      </div>
    );
  }
  if (!overview || !freshnessSummary) return <div className="panel-loading">{t('common.loading')}</div>;

  const score = overview.compositeScore;
  const color = getScoreColor(score);
  const level = getScoreLevel(score);
  const scoreDeg = Math.round((score / 100) * 270);
  const alertCounts = getAlertCount();
  const displayAlerts = alerts.slice(0, 5);

  const sources = dataFreshness.getAllSources()
    .filter(s => s.status !== 'no_data' && s.status !== 'disabled')
    .sort((a, b) => {
      const order: Record<string, number> = { error: 0, very_stale: 1, stale: 2, fresh: 3 };
      return (order[a.status] ?? 4) - (order[b.status] ?? 4);
    })
    .slice(0, 6);

  return (
    <div className="strategic-risk-panel">
      {(overview.degraded || overview.stale) && (
        <div className="risk-status-banner risk-status-cached">
          <span className="risk-status-icon">!</span>
          <span className="risk-status-text">
            {t('components.strategicRisk.cachedCiiStatus', {
              states: [
                overview.degraded ? t('components.strategicRisk.sourceStates.degraded') : '',
                overview.stale ? t('components.strategicRisk.sourceStates.stale') : '',
              ].filter(Boolean).join(' · '),
            })}
          </span>
        </div>
      )}

      <div className="risk-gauge">
        <div className="risk-score-container">
          <div
            className="risk-score-ring"
            style={{ '--score-color': color, '--score-deg': `${scoreDeg}deg` } as React.CSSProperties}
          >
            <div className="risk-score-inner">
              <div className="risk-score" style={{ color }}>{score}</div>
              <div className="risk-level" style={{ color }}>{level}</div>
            </div>
          </div>
        </div>
        <div className="risk-trend-container">
          <span className="risk-trend-label">{t('components.strategicRisk.trend')}</span>
          <div className="risk-trend" style={{ color: getTrendColor(overview.trend) }}>
            {getTrendEmoji(overview.trend)}{' '}
            {overview.trend === 'escalating'
              ? t('components.strategicRisk.trends.escalating')
              : overview.trend === 'de-escalating'
              ? t('components.strategicRisk.trends.deEscalating')
              : t('components.strategicRisk.trends.stable')}
          </div>
        </div>
      </div>

      <div className="risk-metrics">
        <div className="risk-metric">
          <span className="risk-metric-value">{overview.convergenceAlerts}</span>
          <span className="risk-metric-label">{t('components.strategicRisk.convergenceMetric')}</span>
        </div>
        <div className="risk-metric">
          <span className="risk-metric-value">{overview.avgCIIDeviation.toFixed(1)}</span>
          <span className="risk-metric-label">{t('components.strategicRisk.ciiDeviation')}</span>
        </div>
        <div className="risk-metric">
          <span className="risk-metric-value">{overview.infrastructureIncidents}</span>
          <span className="risk-metric-label">{t('components.strategicRisk.infraEvents')}</span>
        </div>
        <div className="risk-metric">
          <span className="risk-metric-value">{alertCounts.critical + alertCounts.high}</span>
          <span className="risk-metric-label">{t('components.strategicRisk.highAlerts')}</span>
        </div>
      </div>

      {sources.length > 0 && (
        <div className="risk-section">
          <div className="risk-section-title">{t('components.strategicRisk.dataFreshness')}</div>
          <div className="risk-sources-compact">
            {sources.map(source => (
              <span
                key={source.id}
                className="risk-source-chip"
                title={source.healthStatus || source.status}
                style={{ borderColor: getStatusColor(source.status) }}
              >
                <span className="risk-source-dot" style={{ color: getStatusColor(source.status) }}>
                  {getStatusIcon(source.status)}
                </span>
                <span className="risk-source-name">{source.name}</span>
                <span className="risk-source-time">{dataFreshness.getTimeSince(source.id)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {overview.topRisks.length === 0 ? (
        <div className="risk-empty">{t('components.strategicRisk.noRisks')}</div>
      ) : (
        <div className="risk-section">
          <div className="risk-section-title">{t('components.strategicRisk.topRisks')}</div>
          <div className="risk-list">
            {overview.topRisks.map((risk, i) => {
              const topZone = overview.topConvergenceZones[0];
              const isConvergence = i === 0 && risk.startsWith('Convergence:') && topZone;
              if (isConvergence) {
                return (
                  <div
                    key={i}
                    className="risk-item risk-item-clickable"
                    style={{ cursor: 'pointer' }}
                    onClick={() => window.dispatchEvent(new CustomEvent('wm:strategic-risk-click', { detail: { lat: topZone.lat, lon: topZone.lon } }))}
                  >
                    <span className="risk-rank">{i + 1}.</span>
                    <span className="risk-text">{risk}</span>
                    <span className="risk-location-icon">↗</span>
                  </div>
                );
              }
              return (
                <div key={i} className="risk-item">
                  <span className="risk-rank">{i + 1}.</span>
                  <span className="risk-text">{risk}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {displayAlerts.length > 0 && (
        <div className="risk-section">
          <div className="risk-section-title">
            {t('components.strategicRisk.recentAlerts', { count: String(alerts.length) })}
          </div>
          <div className="risk-alerts">
            {displayAlerts.map(alert => {
              const hasLocation = alert.location?.lat && alert.location.lon;
              return (
                <div
                  key={alert.id}
                  className={`risk-alert${hasLocation ? ' risk-alert-clickable' : ''}`}
                  style={{
                    borderLeft: `3px solid ${getPriorityColor(alert.priority)}`,
                    cursor: hasLocation ? 'pointer' : undefined,
                  }}
                  onClick={() => {
                    if (hasLocation) {
                      window.dispatchEvent(new CustomEvent('wm:strategic-risk-click', { detail: { lat: alert.location!.lat, lon: alert.location!.lon } }));
                    }
                  }}
                >
                  <div className="risk-alert-header">
                    <span className="risk-alert-type">{getTypeEmoji(alert.type)}</span>
                    <span className="risk-alert-priority">{getPriorityEmoji(alert.priority)}</span>
                    <span className="risk-alert-title">{alert.title}</span>
                    {hasLocation && <span className="risk-location-icon">↗</span>}
                  </div>
                  <div className="risk-alert-summary">{alert.summary}</div>
                  <div className="risk-alert-time">{formatTimeAgo(alert.timestamp)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="risk-footer">
        <span className="risk-updated">
          {t('components.strategicRisk.updated', {
            time: overview.timestamp ? overview.timestamp.toLocaleTimeString() : '—',
          })}
        </span>
        <button className="risk-refresh-btn" onClick={() => void doRefresh()}>
          {t('components.strategicRisk.refresh')}
        </button>
      </div>
    </div>
  );
}

export function StrategicRiskPanel() {
  return (
    <PanelShell
      id="strategic-risk"
      title={t('panels.strategicRisk')}
      infoTooltip={t('components.strategicRisk.infoTooltip')}
    >
      <StrategicRiskPanelContent />
    </PanelShell>
  );
}
