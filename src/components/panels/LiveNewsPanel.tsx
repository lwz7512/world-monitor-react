import { useState, useEffect, useRef } from 'react';
import { t } from '@/services/i18n';
import { loadFromStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';
import { track } from '@/services/analytics';
import {
  loadChannelsFromStorage,
  getDefaultLiveChannels,
  OPTIONAL_LIVE_CHANNELS,
  type LiveChannel,
} from '@/services/live-news-channels';
import { PanelShell } from '@/components/PanelShell';
import { LiveNewsController } from './LiveNewsController';

// ── SVGs ──────────────────────────────────────────────────────────────────────
const PLAY_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
const PAUSE_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
const MUTED_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
const UNMUTED_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
const FULLSCREEN_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const EXIT_FULLSCREEN_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>';
const SETTINGS_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

// ── Helpers ───────────────────────────────────────────────────────────────────
function initChannels(): { channels: LiveChannel[]; active: LiveChannel } {
  let channels = loadChannelsFromStorage();
  if (channels.length === 0) channels = getDefaultLiveChannels();
  const savedId = loadFromStorage<string>(STORAGE_KEYS.activeChannel, '');
  const active = (savedId ? channels.find((c) => c.id === savedId) : null) ?? channels[0]!;
  return { channels, active };
}

// ── Component ─────────────────────────────────────────────────────────────────
export function LiveNewsPanel() {
  const init = useRef<{ channels: LiveChannel[]; active: LiveChannel } | null>(null);
  if (!init.current) {
    const { channels, active } = initChannels();
    init.current = { channels, active };
  }

  const [channels, setChannels] = useState<LiveChannel[]>(init.current.channels);
  const [activeChannelId, setActiveChannelId] = useState<string>(init.current.active.id);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);

  const ctrlRef = useRef<LiveNewsController | null>(null);
  
  if (!ctrlRef.current) {
    ctrlRef.current = new LiveNewsController(
      {
        setIsPlaying,
        setIsMuted,
        setChannels,
        setActiveChannelId,
        setIsFullscreen,
        getContentEl: () => contentRef.current,
        getSwitcherEl: () => switcherRef.current,
      },
      init.current.channels,
      init.current.active,
    );
  }

  useEffect(() => {
    ctrlRef.current!.mount();
    return () => ctrlRef.current!.destroy();
  }, []);

  const ctrl = ctrlRef.current;

  const headerActions = (
    <>
      <span className="panel-live-count">{OPTIONAL_LIVE_CHANNELS.length}</span>
      <button
        type="button"
        className="live-mute-btn"
        title="Toggle playback"
        onClick={(e) => {
          e.stopPropagation();
          ctrl.togglePlayback();
        }}
        dangerouslySetInnerHTML={{ __html: isPlaying ? PAUSE_SVG : PLAY_SVG }}
      />
      <button
        type="button"
        className={`live-mute-btn${!isMuted ? ' unmuted' : ''}`}
        title="Toggle sound"
        onClick={(e) => {
          e.stopPropagation();
          ctrl.toggleMute();
        }}
        dangerouslySetInnerHTML={{ __html: isMuted ? MUTED_SVG : UNMUTED_SVG }}
      />
      <button
        type="button"
        className="live-mute-btn"
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        onClick={(e) => {
          e.stopPropagation();
          track('live-news-fullscreen', { entering: !isFullscreen });
          ctrl.toggleFullscreen();
        }}
        dangerouslySetInnerHTML={{ __html: isFullscreen ? EXIT_FULLSCREEN_SVG : FULLSCREEN_SVG }}
      />
    </>
  );

  return (
    <PanelShell
      id="live-news"
      title={t('panels.liveNews')}
      className="panel-wide"
      closable
      collapsible
      headerActions={headerActions}
    >
      <div className="live-news-toolbar">
        <div ref={switcherRef} className="live-news-switcher">
          {channels.map((ch) => (
            <button
              key={ch.id}
              type="button"
              className={`live-channel-btn${ch.id === activeChannelId ? ' active' : ''}`}
              data-channel-id={ch.id}
              style={{ cursor: 'grab' }}
              onClick={(e) => {
                if (ctrl.suppressChannelClick) {
                  e.preventDefault();
                  return;
                }
                e.preventDefault();
                void ctrl.switchChannel(ch);
              }}
            >
              {ch.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="live-news-settings-btn"
          title={t('components.liveNews.channelSettings') ?? 'Channel Settings'}
          onClick={() => ctrl.openChannelManagementModal()}
          dangerouslySetInnerHTML={{ __html: SETTINGS_SVG }}
        />
      </div>
      <div ref={contentRef} />
    </PanelShell>
  );
}
