import { useState, useEffect, useRef } from 'react';
import { t } from '@/services/i18n';
import { isMobileDevice } from '@/utils';
import { isDesktopRuntime } from '@/services/runtime';
import { track } from '@/services/analytics';
import { PanelShell } from '@/components/PanelShell';
import {
  LiveWebcamsController,
  WEBCAM_FEEDS,
  ALL_REGIONS,
  loadWebcamPrefs,
  type ViewMode,
  type RegionFilter,
} from './LiveWebcamsController';

// ── SVGs ──────────────────────────────────────────────────────────────────────
const FULLSCREEN_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const EXIT_FULLSCREEN_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>';
const GRID_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>';
const SINGLE_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="3" width="18" height="14" rx="2"/><rect x="3" y="19" width="18" height="2" rx="1"/></svg>';
const BACK_GRID_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg> Grid';

function getRegionLabel(key: RegionFilter): string {
  switch (key) {
    case 'all':
      return t('components.webcams.regions.all') ?? 'All';
    case 'middle-east':
      return t('components.webcams.regions.mideast') ?? 'Mid-East';
    case 'europe':
      return t('components.webcams.regions.europe') ?? 'Europe';
    case 'americas':
      return t('components.webcams.regions.americas') ?? 'Americas';
    case 'asia':
      return t('components.webcams.regions.asia') ?? 'Asia';
    case 'space':
      return t('components.webcams.regions.space') ?? 'Space';
  }
}

// Evaluated once at module load — stable for the session.
const forceSingleView = !isDesktopRuntime() && isMobileDevice();

// ── Component ─────────────────────────────────────────────────────────────────
export function LiveWebcamsPanel() {
  const prefs = useRef(loadWebcamPrefs(forceSingleView));
  const [viewMode, setViewMode] = useState<ViewMode>(prefs.current.viewMode);
  const [regionFilter, setRegionFilter] = useState<RegionFilter>(prefs.current.regionFilter);
  const [activeFeedId, setActiveFeedId] = useState<string>(prefs.current.activeFeedId);
  const [, setIsIdle] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<LiveWebcamsController | null>(null);
  if (!ctrlRef.current) {
    ctrlRef.current = new LiveWebcamsController({
      setViewMode,
      setRegionFilter,
      setActiveFeedId,
      setIsIdle,
      setIsFullscreen,
      getContentEl: () => contentRef.current,
    });
  }

  useEffect(() => {
    ctrlRef.current!.mount();
    return () => ctrlRef.current!.destroy();
  }, []);

  const ctrl = ctrlRef.current;
  const filteredFeeds =
    regionFilter === 'all' ? WEBCAM_FEEDS : WEBCAM_FEEDS.filter((f) => f.region === regionFilter);

  const headerActions = (
    <>
      <span className="panel-live-count">{WEBCAM_FEEDS.length}</span>
      <button
        type="button"
        className="live-mute-btn"
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        onClick={(e) => {
          e.stopPropagation();
          track('webcam-fullscreen', { entering: !isFullscreen });
          ctrl.toggleFullscreen();
        }}
        dangerouslySetInnerHTML={{ __html: isFullscreen ? EXIT_FULLSCREEN_SVG : FULLSCREEN_SVG }}
      />
    </>
  );

  return (
    <PanelShell
      id="live-webcams"
      title={t('panels.liveWebcams')}
      className="panel-wide"
      closable
      collapsible
      headerActions={headerActions}
      infoTooltip={t('components.liveWebcams.infoTooltip') ?? undefined}
    >
      <div className="webcam-toolbar">
        <div className="webcam-toolbar-group">
          {ALL_REGIONS.map((key) => (
            <button
              key={key}
              type="button"
              className={`webcam-region-btn${key === regionFilter ? ' active' : ''}`}
              onClick={() => ctrl.setRegionFilter(key)}
            >
              {getRegionLabel(key)}
            </button>
          ))}
        </div>
        <div className="webcam-toolbar-group">
          {!forceSingleView && (
            <button
              type="button"
              className={`webcam-view-btn${viewMode === 'grid' ? ' active' : ''}`}
              data-mode="grid"
              title="Grid view"
              onClick={() => ctrl.setViewMode('grid')}
              dangerouslySetInnerHTML={{ __html: GRID_SVG }}
            />
          )}
          <button
            type="button"
            className={`webcam-view-btn${viewMode === 'single' ? ' active' : ''}`}
            data-mode="single"
            title="Single view"
            onClick={() => ctrl.setViewMode('single')}
            dangerouslySetInnerHTML={{ __html: SINGLE_SVG }}
          />
        </div>
      </div>
      {viewMode === 'single' && (
        <div className="webcam-switcher">
          {!forceSingleView && (
            <button
              type="button"
              className="webcam-feed-btn webcam-back-btn"
              onClick={() => ctrl.setViewMode('grid')}
              dangerouslySetInnerHTML={{ __html: BACK_GRID_SVG }}
            />
          )}
          {filteredFeeds.map((feed) => (
            <button
              key={feed.id}
              type="button"
              className={`webcam-feed-btn${feed.id === activeFeedId ? ' active' : ''}`}
              onClick={() => {
                if (feed.id === activeFeedId) return;
                ctrl.switchFeedInSingleView(feed);
              }}
            >
              {feed.city}
            </button>
          ))}
        </div>
      )}
      <div ref={contentRef} />
    </PanelShell>
  );
}
