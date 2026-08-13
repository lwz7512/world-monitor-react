import { useState, useEffect, useRef, useCallback } from 'react';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { fetchCachedTheaterPosture, type CachedTheaterPosture } from '@/services/cached-theater-posture';
import { getMilitaryVesselsModule, isVesselRuntimeStoppedError } from '@/services/military-vessels-lazy';
import { recalcPostureWithVessels, type TheaterPostureSummary } from '@/services/military-surge';
import { isDesktopRuntime } from '@/services/runtime';
import type { DeductContextDetail } from '@/types';
import { buildNewsContext } from '@/utils/news-context';
import { subscribePostureData, setPostures } from '@/services/strategic-posture-store';
import { getAllNews } from '@/services/all-news-store';
import { PanelShell } from '@/components/PanelShell';

type PostureLevel = 'critical' | 'elevated' | 'normal';

function getPostureBadgeLabel(level: string): string {
  switch (level) {
    case 'critical': return t('components.strategicPosture.badges.critical');
    case 'elevated': return t('components.strategicPosture.badges.elevated');
    default: return t('components.strategicPosture.badges.normal');
  }
}

function PostureBadge({ level }: { level: string }) {
  return (
    <span className={`posture-badge posture-${level as PostureLevel}`}>
      {getPostureBadgeLabel(level)}
    </span>
  );
}

function TrendChip({ trend, changePercent }: { trend: string; changePercent: number }) {
  if (trend === 'increasing') {
    return <span className="posture-trend trend-up">↗ +{changePercent}%</span>;
  }
  if (trend === 'decreasing') {
    return <span className="posture-trend trend-down">↘ {changePercent}%</span>;
  }
  return <span className="posture-trend trend-stable">→ {t('components.strategicPosture.trendStable')}</span>;
}

function theaterDisplayName(p: TheaterPostureSummary): string {
  const key = `components.strategicPosture.theaters.${p.theaterId}`;
  const translated = t(key);
  return translated !== key ? translated : p.theaterName;
}

function TheaterCard({ posture }: { posture: TheaterPostureSummary }) {
  const p = posture;
  const displayName = theaterDisplayName(p);
  const isExpanded = p.postureLevel !== 'normal';

  const handleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.posture-deduce-btn')) return;
    if (!Number.isNaN(p.centerLat) && !Number.isNaN(p.centerLon)) {
      window.dispatchEvent(new CustomEvent('wm:strategic-posture-click', { detail: { lat: p.centerLat, lon: p.centerLon } }));
    }
  };

  const handleDeduce = (e: React.MouseEvent) => {
    e.stopPropagation();
    const query = `What is the expected strategic impact of the current military posture in the ${p.shortName} theater?`;
    let geoContext = `Theater: ${p.shortName} (${p.theaterName}). Military Assets: ${p.totalAircraft} aircraft, ${p.totalVessels} naval vessels. Readiness Level: ${p.postureLevel}. Assets breakdown: ${p.fighters} fighters, ${p.bombers} bombers, ${p.carriers} carriers, ${p.submarines} submarines. Focus/Target: ${p.targetNation || 'Unknown'}.`;
    const newsCtx = buildNewsContext(getAllNews);
    if (newsCtx) geoContext += `\n\n${newsCtx}`;
    const detail: DeductContextDetail = { query, geoContext, autoSubmit: true };
    document.dispatchEvent(new CustomEvent('wm:deduct-context', { detail }));
  };

  if (!isExpanded) {
    const chips: React.ReactNode[] = [];
    if (p.totalAircraft > 0) chips.push(<span key="air" className="posture-chip air">✈️ {p.totalAircraft}</span>);
    if (p.totalVessels > 0) chips.push(<span key="naval" className="posture-chip naval">⚓ {p.totalVessels}</span>);
    return (
      <div
        className="posture-theater posture-compact"
        data-lat={p.centerLat}
        data-lon={p.centerLon}
        title={t('components.strategicPosture.clickToView', { name: escapeHtml(displayName) })}
        onClick={handleClick}
        style={{ cursor: 'pointer' }}
      >
        <span className="posture-name">{p.shortName}</span>
        <div className="posture-chips">{chips}</div>
        <PostureBadge level={p.postureLevel} />
      </div>
    );
  }

  const airStats: React.ReactNode[] = [];
  if (p.fighters > 0) airStats.push(<span key="f" className="posture-stat" title={t('components.strategicPosture.units.fighters')}>✈️ {p.fighters}</span>);
  if (p.tankers > 0) airStats.push(<span key="t" className="posture-stat" title={t('components.strategicPosture.units.tankers')}>⛽ {p.tankers}</span>);
  if (p.awacs > 0) airStats.push(<span key="a" className="posture-stat" title={t('components.strategicPosture.units.awacs')}>📡 {p.awacs}</span>);
  if (p.reconnaissance > 0) airStats.push(<span key="r" className="posture-stat" title={t('components.strategicPosture.units.recon')}>🔍 {p.reconnaissance}</span>);
  if (p.transport > 0) airStats.push(<span key="tr" className="posture-stat" title={t('components.strategicPosture.units.transport')}>📦 {p.transport}</span>);
  if (p.bombers > 0) airStats.push(<span key="b" className="posture-stat" title={t('components.strategicPosture.units.bombers')}>💣 {p.bombers}</span>);
  if (p.drones > 0) airStats.push(<span key="d" className="posture-stat" title={t('components.strategicPosture.units.drones')}>🛸 {p.drones}</span>);
  if (airStats.length === 0 && p.totalAircraft > 0) {
    airStats.push(<span key="all" className="posture-stat" title={t('components.strategicPosture.units.aircraft')}>✈️ {p.totalAircraft}</span>);
  }

  const navalStats: React.ReactNode[] = [];
  if (p.carriers > 0) navalStats.push(<span key="cv" className="posture-stat carrier" title={t('components.strategicPosture.units.carriers')}>🚢 {p.carriers}</span>);
  if (p.destroyers > 0) navalStats.push(<span key="dd" className="posture-stat" title={t('components.strategicPosture.units.destroyers')}>⚓ {p.destroyers}</span>);
  if (p.frigates > 0) navalStats.push(<span key="ff" className="posture-stat" title={t('components.strategicPosture.units.frigates')}>🛥️ {p.frigates}</span>);
  if (p.submarines > 0) navalStats.push(<span key="ss" className="posture-stat" title={t('components.strategicPosture.units.submarines')}>🦈 {p.submarines}</span>);
  if (p.patrol > 0) navalStats.push(<span key="pc" className="posture-stat" title={t('components.strategicPosture.units.patrol')}>🚤 {p.patrol}</span>);
  if (p.auxiliaryVessels > 0) navalStats.push(<span key="ax" className="posture-stat" title={t('components.strategicPosture.units.auxiliary')}>⚓ {p.auxiliaryVessels}</span>);
  if (navalStats.length === 0 && p.totalVessels > 0) {
    navalStats.push(<span key="all" className="posture-stat" title={t('components.strategicPosture.units.navalVessels')}>⚓ {p.totalVessels}</span>);
  }

  return (
    <div
      className={`posture-theater posture-expanded ${p.postureLevel}`}
      data-lat={p.centerLat}
      data-lon={p.centerLon}
      title={t('components.strategicPosture.clickToViewMap')}
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    >
      <div className="posture-theater-header">
        <span className="posture-name">{displayName}</span>
        <PostureBadge level={p.postureLevel} />
      </div>
      <div className="posture-forces">
        {airStats.length > 0 && (
          <div className="posture-force-row">
            <span className="posture-domain">{t('components.strategicPosture.domains.air')}</span>
            <div className="posture-stats">{airStats}</div>
          </div>
        )}
        {navalStats.length > 0 && (
          <div className="posture-force-row">
            <span className="posture-domain">{t('components.strategicPosture.domains.sea')}</span>
            <div className="posture-stats">{navalStats}</div>
          </div>
        )}
      </div>
      <div className="posture-footer">
        {p.strikeCapable && <span className="posture-strike">⚡ {t('components.strategicPosture.strike')}</span>}
        <TrendChip trend={p.trend} changePercent={p.changePercent} />
        {p.targetNation && <span className="posture-focus">→ {p.targetNation}</span>}
        {isDesktopRuntime() && (
          <button
            className="posture-deduce-btn"
            title="Deduce Situation with AI"
            style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7, fontSize: '1.1em', transition: 'opacity 0.2s', marginLeft: 'auto' }}
            onClick={handleDeduce}
          >
            🧠
          </button>
        )}
      </div>
    </div>
  );
}

type LoadingStage = 'aircraft' | 'vessels' | 'analysis';
type ViewState = 'loading' | 'data' | 'nodata' | 'error';

function LoadingView({ stage, startTime }: { stage: LoadingStage; startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const stageIdx = stage === 'aircraft' ? 0 : stage === 'vessels' ? 1 : 2;

  return (
    <div className="posture-panel">
      <div className="posture-loading">
        <div className="posture-loading-radar">
          <div className="posture-radar-sweep"></div>
          <div className="posture-radar-dot"></div>
        </div>
        <div className="posture-loading-title">{t('components.strategicPosture.scanningTheaters')}</div>
        <div className="posture-loading-stages">
          {[
            t('components.strategicPosture.positions'),
            t('components.strategicPosture.navalVesselsLoading'),
            t('components.strategicPosture.theaterAnalysis'),
          ].map((label, i) => {
            const cls = i < stageIdx ? 'complete' : i === stageIdx ? 'active' : 'pending';
            return (
              <div key={i} className={`posture-stage ${cls}`}>
                <span className="posture-stage-dot"></span>
                <span>{label}</span>
              </div>
            );
          })}
        </div>
        <div className="posture-loading-tip">{t('components.strategicPosture.connectingStreams')}</div>
        <div className="posture-loading-elapsed">{t('components.strategicPosture.elapsed', { elapsed: String(elapsed) })}</div>
        <div className="posture-loading-note">{t('components.strategicPosture.initialLoadNote')}</div>
      </div>
    </div>
  );
}

export function StrategicPosturePanelContent() {
  const abortRef = useRef(new AbortController());
  useEffect(() => () => { abortRef.current.abort(); }, []);
  const posturesRef = useRef<TheaterPostureSummary[]>([]);
  const lastTimestampRef = useRef('');
  const isStaleRef = useRef(false);
  const destroyedRef = useRef(false);
  const [view, setView] = useState<ViewState>('loading');
  const [loadingStage, setLoadingStage] = useState<LoadingStage>('aircraft');
  const [loadingStartTime] = useState(() => Date.now());
  const [, setRenderTick] = useState(0);
  const tick = () => setRenderTick(k => k + 1);

  const cacheVesselCounts = useCallback((postures: TheaterPostureSummary[]) => {
    try {
      const counts: Record<string, { destroyers: number; frigates: number; carriers: number; submarines: number; patrol: number; auxiliaryVessels: number; totalVessels: number }> = {};
      for (const p of postures) {
        if (p.totalVessels > 0) {
          counts[p.theaterId] = {
            destroyers: p.destroyers || 0,
            frigates: p.frigates || 0,
            carriers: p.carriers || 0,
            submarines: p.submarines || 0,
            patrol: p.patrol || 0,
            auxiliaryVessels: p.auxiliaryVessels || 0,
            totalVessels: p.totalVessels || 0,
          };
        }
      }
      localStorage.setItem('wm:vesselPosture', JSON.stringify({ counts, ts: Date.now() }));
    } catch { /* quota exceeded or private mode */ }
  }, []);

  const restoreVesselCounts = useCallback((postures: TheaterPostureSummary[]) => {
    try {
      const raw = localStorage.getItem('wm:vesselPosture');
      if (!raw) return;
      const { counts, ts } = JSON.parse(raw);
      if (Date.now() - ts > 30 * 60 * 1000) return;
      for (const p of postures) {
        const cached = counts[p.theaterId];
        if (cached) {
          p.destroyers = cached.destroyers;
          p.frigates = cached.frigates;
          p.carriers = cached.carriers;
          p.submarines = cached.submarines;
          p.patrol = cached.patrol;
          p.auxiliaryVessels = cached.auxiliaryVessels;
          p.totalVessels = cached.totalVessels;
        }
      }
    } catch { /* parse error */ }
  }, []);

  const augmentWithVessels = useCallback(async (postures: TheaterPostureSummary[]): Promise<void> => {
    try {
      const { fetchMilitaryVessels } = await getMilitaryVesselsModule();
      const { vessels } = await fetchMilitaryVessels();
      if (vessels.length === 0) {
        restoreVesselCounts(postures);
        recalcPostureWithVessels(postures);
        return;
      }
      for (const posture of postures) {
        if (!posture.bounds) continue;
        const theaterVessels = vessels.filter(
          v =>
            v.lat >= posture.bounds!.south &&
            v.lat <= posture.bounds!.north &&
            v.lon >= posture.bounds!.west &&
            v.lon <= posture.bounds!.east,
        );
        posture.destroyers = theaterVessels.filter(v => v.vesselType === 'destroyer').length;
        posture.frigates = theaterVessels.filter(v => v.vesselType === 'frigate').length;
        posture.carriers = theaterVessels.filter(v => v.vesselType === 'carrier').length;
        posture.submarines = theaterVessels.filter(v => v.vesselType === 'submarine').length;
        posture.patrol = theaterVessels.filter(v => v.vesselType === 'patrol').length;
        posture.auxiliaryVessels = theaterVessels.filter(
          v => v.vesselType === 'auxiliary' || v.vesselType === 'special' || v.vesselType === 'amphibious' || v.vesselType === 'icebreaker' || v.vesselType === 'research' || v.vesselType === 'unknown',
        ).length;
        posture.totalVessels = theaterVessels.length;
        for (const v of theaterVessels) {
          const op = v.operator || 'unknown';
          posture.byOperator[op] = (posture.byOperator[op] || 0) + 1;
        }
      }
      cacheVesselCounts(postures);
      recalcPostureWithVessels(postures);
    } catch (error) {
      if (isVesselRuntimeStoppedError(error)) return;
      console.warn('[StrategicPosturePanel] Failed to fetch vessels:', error);
      restoreVesselCounts(postures);
      recalcPostureWithVessels(postures);
    }
  }, [cacheVesselCounts, restoreVesselCounts]);

  const updateBadges = useCallback((postures: TheaterPostureSummary[]) => {
    setPostures(postures);
  }, []);

  const doFetchAndRender = useCallback(async (): Promise<void> => {
    setView('loading');
    setLoadingStage('aircraft');
    try {
      const data = await fetchCachedTheaterPosture(abortRef.current.signal);
      if (destroyedRef.current) return;
      if (!data || !data.postures?.length) {
        setView('nodata');
        return;
      }
      const postures: TheaterPostureSummary[] = data.postures.map(p => ({
        ...p,
        byOperator: { ...p.byOperator },
      }));
      setLoadingStage('vessels');
      await augmentWithVessels(postures);
      if (destroyedRef.current) return;
      setLoadingStage('analysis');
      posturesRef.current = postures;
      lastTimestampRef.current = data.timestamp;
      isStaleRef.current = data.stale || false;
      updateBadges(postures);
      setView('data');
      tick();

      if (data.stale) {
        setTimeout(() => { void doFetchAndRender(); }, 3000);
      }
    } catch (error) {
      if (destroyedRef.current) return;
      if ((error as Error)?.name === 'AbortError') return;
      console.error('[StrategicPosturePanel] Fetch error:', error);
      setView('error');
    }
  }, [augmentWithVessels, updateBadges]); // eslint-disable-line react-hooks/exhaustive-deps

  const doUpdatePostures = useCallback(async (data: CachedTheaterPosture): Promise<void> => {
    if (!data || !data.postures?.length) {
      setView('nodata');
      return;
    }
    const postures: TheaterPostureSummary[] = data.postures.map(p => ({
      ...p,
      byOperator: { ...p.byOperator },
    }));
    await augmentWithVessels(postures);
    if (destroyedRef.current) return;
    posturesRef.current = postures;
    lastTimestampRef.current = data.timestamp;
    isStaleRef.current = data.stale || false;
    updateBadges(postures);
    setView('data');
    tick();
  }, [augmentWithVessels, updateBadges]);

  useEffect(() => subscribePostureData(data => { void doUpdatePostures(data); }), [doUpdatePostures]);

  // Initial fetch
  useEffect(() => {
    void doFetchAndRender();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Vessel re-augmentation at 30s/60s/90s/120s
  useEffect(() => {
    const timeouts = [30, 60, 90, 120].map(s =>
      setTimeout(async () => {
        if (destroyedRef.current || posturesRef.current.length === 0) return;
        await augmentWithVessels(posturesRef.current);
        if (destroyedRef.current) return;
        updateBadges(posturesRef.current);
        tick();
      }, s * 1000),
    );
    return () => timeouts.forEach(t => clearTimeout(t));
  }, [augmentWithVessels, updateBadges]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => { destroyedRef.current = true; };
  }, []);

  if (view === 'loading') {
    return <LoadingView stage={loadingStage} startTime={loadingStartTime} />;
  }

  if (view === 'nodata') {
    return (
      <div className="posture-panel">
        <div className="posture-no-data">
          <div className="posture-no-data-icon pulse">📡</div>
          <div className="posture-no-data-title">{t('components.strategicPosture.acquiringData')}</div>
          <div className="posture-no-data-desc">{t('components.strategicPosture.acquiringDesc')}</div>
          <div className="posture-data-sources">
            <div className="posture-source"><span className="posture-source-icon connecting">✈️</span><span>{t('components.strategicPosture.openSkyAdsb')}</span></div>
            <div className="posture-source"><span className="posture-source-icon waiting">🚢</span><span>{t('components.strategicPosture.aisVesselStream')}</span></div>
          </div>
          <button className="posture-retry-btn" onClick={() => void doFetchAndRender()}>
            ↻ {t('components.strategicPosture.retryNow')}
          </button>
        </div>
      </div>
    );
  }

  if (view === 'error') {
    return (
      <div className="posture-panel">
        <div className="posture-no-data">
          <div className="posture-no-data-icon">⚠️</div>
          <div className="posture-no-data-title">{t('components.strategicPosture.feedRateLimited')}</div>
          <div className="posture-no-data-desc">{t('components.strategicPosture.rateLimitedDesc')}</div>
          <div className="posture-error-hint"><strong>{t('components.strategicPosture.rateLimitedTip')}</strong></div>
          <button className="posture-retry-btn" onClick={() => void doFetchAndRender()}>
            ↻ {t('components.strategicPosture.tryAgain')}
          </button>
        </div>
      </div>
    );
  }

  const postures = posturesRef.current;
  const sorted = [...postures].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, elevated: 1, normal: 2 };
    return (order[a.postureLevel] ?? 2) - (order[b.postureLevel] ?? 2);
  });
  const updatedTime = lastTimestampRef.current
    ? new Date(lastTimestampRef.current).toLocaleTimeString()
    : new Date().toLocaleTimeString();
  const isStale = isStaleRef.current;

  return (
    <div className="posture-panel">
      {isStale && (
        <div className="posture-stale-warning">⚠️ {t('components.strategicPosture.staleWarning')}</div>
      )}
      <details className="posture-emoji-key">
        <summary>💡 {t('components.strategicPosture.emojiKeyLabel')}</summary>
        <div className="posture-emoji-key-body">
          <div className="posture-emoji-key-section">{t('components.strategicPosture.emojiKeyAir')}</div>
          {[
            ['✈️', 'fighters'], ['⛽', 'tankers'], ['📡', 'awacs'], ['🔍', 'recon'],
            ['📦', 'transport'], ['💣', 'bombers'], ['🛸', 'drones'],
          ].map(([emoji, key]) => (
            <div key={key} className="posture-emoji-key-item">
              <span>{emoji}</span>
              <span>{t(`components.strategicPosture.units.${key}`)}</span>
            </div>
          ))}
          <div className="posture-emoji-key-section">{t('components.strategicPosture.emojiKeyNaval')}</div>
          {[
            ['🚢', 'carriers'], ['⚓', 'destroyers'], ['🛥️', 'frigates'],
            ['🦈', 'submarines'], ['🚤', 'patrol'], ['⚓', 'auxiliary'],
          ].map(([emoji, key], i) => (
            <div key={`${key}-${i}`} className="posture-emoji-key-item">
              <span>{emoji}</span>
              <span>{t(`components.strategicPosture.units.${key}`)}</span>
            </div>
          ))}
        </div>
      </details>

      {sorted.map(p => (
        <TheaterCard key={p.theaterId} posture={p} />
      ))}

      <div className="posture-footer">
        <span className="posture-updated">
          {isStale ? '⚠️ ' : ''}{t('components.strategicPosture.updated')} {updatedTime}
        </span>
        <button
          className="posture-refresh-btn"
          title={t('components.strategicPosture.refresh')}
          aria-label={t('components.strategicPosture.refresh')}
          onClick={() => void doFetchAndRender()}
        >
          ↻
        </button>
      </div>
    </div>
  );
}

export function StrategicPosturePanel() {
  return (
    <PanelShell
      id="strategic-posture"
      title={t('panels.strategicPosture')}
      infoTooltip={t('components.strategicPosture.infoTooltip')}
      defaultRowSpan={2}
    >
      <StrategicPosturePanelContent />
    </PanelShell>
  );
}
