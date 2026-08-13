import { fetchLiveVideoInfo } from '@/services/live-news';
import {
  isDesktopRuntime,
  getRemoteApiBaseUrl,
  getApiBaseUrl,
  getLocalApiPort,
} from '@/services/runtime';
import { t } from '@/services/i18n';
import { saveToStorage } from '@/utils';
import { IDLE_PAUSE_MS, STORAGE_KEYS } from '@/config';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { getStreamQuality } from '@/services/ai-flow-settings';
import {
  getActiveLiveMedia,
  playAllLiveMedia,
  registerLiveMediaStarter,
  releaseLiveMediaPlayback,
  requestLiveMediaPlayback,
  stopLiveMediaPlayback,
  unregisterLiveMediaStarter,
} from '@/services/live-media-controller';
import {
  getLiveStreamsAlwaysOn,
  subscribeLiveStreamsSettingsChange,
} from '@/services/live-stream-settings';
import {
  loadChannelsFromStorage,
  saveChannelsToStorage,
  getDefaultLiveChannels,
  DIRECT_HLS_MAP,
  PROXIED_HLS_MAP,
  IDLE_ACTIVITY_EVENTS,
  type LiveChannel,
} from '@/services/live-news-channels';

// YouTube IFrame Player API types
type YouTubePlayer = {
  mute(): void;
  unMute(): void;
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(videoId: string): void;
  cueVideoById(videoId: string): void;
  setPlaybackQuality?(quality: string): void;
  getIframe?(): HTMLIFrameElement;
  getVolume?(): number;
  isMuted?(): boolean;
  destroy(): void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string | HTMLElement,
        options: {
          videoId: string;
          host?: string;
          playerVars: Record<string, number | string>;
          events: { onReady: () => void; onError?: (event: { data: number }) => void };
        },
      ) => YouTubePlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Module-level singleton so multiple instances don't race the API load.
let youtubeApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-youtube-iframe-api="true"]',
    );
    if (existing) {
      if (window.YT?.Player) {
        resolve();
        return;
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve();
      };
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.dataset.youtubeIframeApi = 'true';
    script.onerror = () => {
      console.warn('[LiveNews] YouTube IFrame API failed to load');
      youtubeApiPromise = null;
      script.remove();
      resolve();
    };
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
}

function resolveYouTubeOrigin(): string | null {
  const fallback = 'https://worldmonitor.app';
  try {
    const { protocol, origin, host } = window.location;
    if (protocol === 'http:' || protocol === 'https:') {
      if (host === 'tauri.localhost' || host.endsWith('.tauri.localhost')) return fallback;
      return origin;
    }
    if (protocol === 'tauri:' || protocol === 'asset:') return fallback;
  } catch {
    /* ignore */
  }
  return fallback;
}

function getEmbedOrigin(): string {
  if (isDesktopRuntime()) return `http://localhost:${getLocalApiPort()}`;
  try {
    return new URL(getRemoteApiBaseUrl()).origin;
  } catch {
    return 'https://worldmonitor.app';
  }
}

// ── React state bridge ────────────────────────────────────────────────────────
export interface LiveNewsControllerState {
  setIsPlaying: (v: boolean) => void;
  setIsMuted: (v: boolean) => void;
  setChannels: (v: LiveChannel[]) => void;
  setActiveChannelId: (id: string) => void;
  setIsFullscreen: (updater: boolean | ((prev: boolean) => boolean)) => void;
  getContentEl: () => HTMLDivElement | null;
  getSwitcherEl: () => HTMLDivElement | null;
}

const HLS_COOLDOWN_MS = 5 * 60 * 1000;
const BOT_CHECK_TIMEOUT_MS = 15_000;
const MUTE_SYNC_POLL_MS = 500;

// ── Controller class ──────────────────────────────────────────────────────────
export class LiveNewsController {
  // ── Mutable player state ──────────────────────────────────────────────────
  liveMediaSessionToken = 0;
  isPlaying = false;
  isMuted = true;
  alwaysOn: boolean;
  wasPlayingBeforeIdle = false;
  deferredInit = false;
  isPlayerReady = false;
  currentVideoId: string | null = null;
  forceFallbackVideoForNextInit = false;
  useDesktopEmbedProxy: boolean;
  idleDetectionEnabled = false;
  suppressChannelClick = false;
  youtubeOrigin: string | null;
  playerElementId: string;
  player: YouTubePlayer | null = null;
  playerContainer: HTMLDivElement | null = null;
  playerElement: HTMLDivElement | null = null;
  nativeVideoElement: HTMLVideoElement | null = null;
  hlsInstance: import('hls.js').default | null = null;
  desktopEmbedIframe: HTMLIFrameElement | null = null;
  desktopEmbedSession: {
    iframe: HTMLIFrameElement;
    channelId: string;
    sessionToken: number;
  } | null = null;
  desktopEmbedRenderToken = 0;
  idleTimeout: ReturnType<typeof setTimeout> | null = null;
  idleCallbackId: number | ReturnType<typeof setTimeout> | null = null;
  lazyObserver: IntersectionObserver | null = null;
  botCheckTimeout: ReturnType<typeof setTimeout> | null = null;
  muteSyncInterval: ReturnType<typeof setInterval> | null = null;
  readonly hlsFailureCooldown = new Map<string, number>();
  channels: LiveChannel[];
  activeChannel: LiveChannel;

  // ── Stored handler references for add/removeEventListener ────────────────
  private _idleResetHandler: (() => void) | null = null;
  private _visibilityChangeHandler: (() => void) | null = null;
  private _messageHandler: ((e: MessageEvent) => void) | null = null;
  private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private _stopHandler: (() => void) | null = null;
  private _resumeHandler: (() => void) | null = null;
  private _refreshHandler: (() => void) | null = null;
  private _playAllStarter: (() => void) | null = null;
  private _unsubStream: (() => void) | null = null;
  private _dragMouseDown: ((e: MouseEvent) => void) | null = null;
  private _dragMouseMove: ((e: MouseEvent) => void) | null = null;
  private _dragMouseUp: (() => void) | null = null;

  constructor(
    private state: LiveNewsControllerState,
    channels: LiveChannel[],
    activeChannel: LiveChannel,
  ) {
    this.alwaysOn = getLiveStreamsAlwaysOn();
    this.useDesktopEmbedProxy = isDesktopRuntime();
    this.youtubeOrigin = resolveYouTubeOrigin();
    this.playerElementId = `live-news-player-${Date.now()}`;
    this.channels = channels;
    this.activeChannel = activeChannel;
  }

  // ── State sync helpers ────────────────────────────────────────────────────
  private syncIsPlaying(val: boolean): void {
    this.isPlaying = val;
    this.state.setIsPlaying(val);
  }

  private syncIsMuted(val: boolean): void {
    this.isMuted = val;
    this.state.setIsMuted(val);
  }

  private syncChannels(newChannels: LiveChannel[], newActive?: LiveChannel): void {
    this.channels = newChannels;
    if (newActive) {
      this.activeChannel = newActive;
      this.state.setActiveChannelId(newActive.id);
    }
    this.state.setChannels([...newChannels]);
  }

  // ── Panel visibility check ────────────────────────────────────────────────
  private canHostLiveMedia(): boolean {
    const el = document.getElementById('live-news');
    if (!el || !el.isConnected) return false;
    if (el.classList.contains('hidden') || el.classList.contains('panel-collapsed')) return false;
    return true;
  }

  // ── Player teardown ───────────────────────────────────────────────────────
  private clearBotCheckTimeout(): void {
    if (this.botCheckTimeout) {
      clearTimeout(this.botCheckTimeout);
      this.botCheckTimeout = null;
    }
  }

  private stopMuteSyncPolling(): void {
    if (this.muteSyncInterval !== null) {
      clearInterval(this.muteSyncInterval);
      this.muteSyncInterval = null;
    }
  }

  private destroyPlayer(): void {
    this.clearBotCheckTimeout();
    this.stopMuteSyncPolling();
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }
    if (this.nativeVideoElement) {
      this.nativeVideoElement.pause();
      this.nativeVideoElement.removeAttribute('src');
      this.nativeVideoElement.load();
      this.nativeVideoElement = null;
    }
    this.desktopEmbedIframe = null;
    this.desktopEmbedSession = null;
    this.desktopEmbedRenderToken += 1;
    this.isPlayerReady = false;
    this.currentVideoId = null;
    if (this.playerContainer) {
      this.playerContainer.innerHTML = '';
      if (!this.useDesktopEmbedProxy) {
        this.playerElement = document.createElement('div');
        this.playerElement.id = this.playerElementId;
        this.playerContainer.appendChild(this.playerElement);
      } else {
        this.playerElement = null;
      }
    }
  }

  // ── Placeholder rendering ─────────────────────────────────────────────────
  private renderPlaceholder(): void {
    this.deferredInit = false;
    this.playerContainer = null;
    this.playerElement = null;
    const container = this.state.getContentEl();
    if (!container) return;
    container.innerHTML = '';

    const shell = document.createElement('div');
    shell.className = 'live-news-placeholder live-media-shell';

    const status = document.createElement('div');
    status.className = 'live-media-shell-status';
    const dot = document.createElement('span');
    dot.className = 'live-media-shell-dot';
    const statusText = document.createElement('span');
    statusText.textContent = t('components.liveNews.readyStatus') || 'Ready when you are';
    status.append(dot, statusText);

    const label = document.createElement('div');
    label.className = 'live-media-shell-title';
    label.textContent = this.activeChannel.name;

    const playBtn = document.createElement('button');
    playBtn.className = 'offline-retry';
    playBtn.textContent = t('components.liveNews.playLiveFeed') || 'Play live feed';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playAllLiveMedia();
    });

    shell.append(status, label, playBtn);
    shell.addEventListener('click', () => playAllLiveMedia());
    container.appendChild(shell);
  }

  // ── HLS URL resolution ────────────────────────────────────────────────────
  private getDirectHlsUrl(channelId: string): string | undefined {
    const url = DIRECT_HLS_MAP[channelId];
    if (!url) return undefined;
    const failedAt = this.hlsFailureCooldown.get(channelId);
    if (failedAt && Date.now() - failedAt < HLS_COOLDOWN_MS) return undefined;
    return url;
  }

  private getProxiedHlsUrl(channelId: string): string | undefined {
    if (!isDesktopRuntime()) return undefined;
    const entry = PROXIED_HLS_MAP[channelId];
    if (!entry) return undefined;
    const failedAt = this.hlsFailureCooldown.get(channelId);
    if (failedAt && Date.now() - failedAt < HLS_COOLDOWN_MS) return undefined;
    return `http://127.0.0.1:${getLocalApiPort()}/api/hls-proxy?url=${encodeURIComponent(entry.url)}`;
  }

  // ── Channel video resolution ──────────────────────────────────────────────
  private async resolveChannelVideo(channel: LiveChannel, forceFallback = false): Promise<void> {
    if (this.getDirectHlsUrl(channel.id) || this.getProxiedHlsUrl(channel.id) || channel.hlsUrl) {
      channel.videoId = channel.fallbackVideoId;
      channel.isLive = true;
      return;
    }
    if (channel.useFallbackOnly || forceFallback) {
      channel.videoId = channel.fallbackVideoId;
      channel.isLive = false;
      return;
    }
    if (!channel.handle) {
      channel.videoId = channel.fallbackVideoId;
      channel.isLive = false;
      return;
    }
    const info = await fetchLiveVideoInfo(channel.handle);
    channel.videoId = info.videoId || channel.fallbackVideoId;
    channel.isLive = !!info.videoId;
    const failedAt = this.hlsFailureCooldown.get(channel.id);
    const cooldownActive = failedAt !== undefined && Date.now() - failedAt < HLS_COOLDOWN_MS;
    channel.hlsUrl = !cooldownActive && info.hlsUrl ? info.hlsUrl : undefined;
  }

  // ── Error / offline views ─────────────────────────────────────────────────
  private showOfflineMessage(channel: LiveChannel): void {
    this.destroyPlayer();
    const container = this.state.getContentEl();
    if (!container) return;
    const safeName = escapeHtml(channel.name);
    container.innerHTML = `
      <div class="live-offline live-offline-compact">
        <div class="offline-icon">📺</div>
        <div class="offline-text">${t('components.liveNews.notLive', { name: safeName })}</div>
        <button class="offline-retry" onclick="this.closest('.panel').querySelector('.live-channel-btn.active')?.click()">${t('common.retry')}</button>
      </div>`;
  }

  private showEmbedError(channel: LiveChannel, errorCode: number): void {
    this.destroyPlayer();
    const container = this.state.getContentEl();
    if (!container) return;
    const watchUrl = channel.videoId
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(channel.videoId)}`
      : channel.handle
        ? `https://www.youtube.com/${encodeURIComponent(channel.handle)}`
        : 'https://www.youtube.com';
    const safeName = escapeHtml(channel.name);
    container.innerHTML = `
      <div class="live-offline live-offline-compact">
        <div class="offline-icon">!</div>
        <div class="offline-text">${t('components.liveNews.cannotEmbed', { name: safeName, code: String(errorCode) })}</div>
        <a class="offline-retry" href="${sanitizeUrl(watchUrl)}" target="_blank" rel="noopener noreferrer">${t('components.liveNews.openOnYouTube')}</a>
      </div>`;
  }

  private async openYouTubeSignIn(): Promise<void> {
    const url =
      'https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/';
    if (isDesktopRuntime()) {
      try {
        const { tryInvokeTauri } = await import('@/services/tauri-bridge');
        await tryInvokeTauri('open_youtube_login');
      } catch {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  private showBotCheckPrompt(channel: LiveChannel): void {
    const watchUrl = channel.videoId
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(channel.videoId)}`
      : channel.handle
        ? `https://www.youtube.com/${encodeURIComponent(channel.handle)}`
        : 'https://www.youtube.com';

    this.destroyPlayer();
    const container = this.state.getContentEl();
    if (!container) return;
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'live-offline live-offline-compact';

    const icon = document.createElement('div');
    icon.className = 'offline-icon';
    icon.textContent = '⚠️';

    const text = document.createElement('div');
    text.className = 'offline-text';
    text.textContent =
      t('components.liveNews.botCheck', { name: channel.name }) ||
      'YouTube is requesting sign-in verification';

    const actions = document.createElement('div');
    actions.className = 'bot-check-actions';

    const signinBtn = document.createElement('button');
    signinBtn.className = 'offline-retry bot-check-signin';
    signinBtn.textContent = t('components.liveNews.signInToYouTube') || 'Sign in to YouTube';
    signinBtn.addEventListener('click', () => void this.openYouTubeSignIn());

    const retryBtn = document.createElement('button');
    retryBtn.className = 'offline-retry bot-check-retry';
    retryBtn.textContent = t('common.retry') || 'Retry';
    retryBtn.addEventListener('click', () => {
      this.ensurePlayerContainer();
      if (this.useDesktopEmbedProxy) this.renderDesktopEmbed(true);
      else void this.initializePlayer();
    });

    const ytLink = document.createElement('a');
    ytLink.className = 'offline-retry';
    ytLink.href = watchUrl;
    ytLink.target = '_blank';
    ytLink.rel = 'noopener noreferrer';
    ytLink.textContent = t('components.liveNews.openOnYouTube') || 'Open on YouTube';

    actions.append(signinBtn, retryBtn, ytLink);
    wrapper.append(icon, text, actions);
    container.appendChild(wrapper);
  }

  // ── Player container management ───────────────────────────────────────────
  private ensurePlayerContainer(): void {
    this.deferredInit = true;
    const container = this.state.getContentEl();
    if (!container) return;
    container.innerHTML = '';
    const pc = document.createElement('div');
    pc.className = 'live-news-player';
    if (!this.useDesktopEmbedProxy) {
      const pe = document.createElement('div');
      pe.id = this.playerElementId;
      pc.appendChild(pe);
      this.playerElement = pe;
    } else {
      this.playerElement = null;
    }
    container.appendChild(pc);
    this.playerContainer = pc;
  }

  // ── Desktop embed ─────────────────────────────────────────────────────────
  private postToEmbed(msg: Record<string, unknown>): void {
    if (!this.desktopEmbedIframe?.contentWindow) return;
    this.desktopEmbedIframe.contentWindow.postMessage(msg, getEmbedOrigin());
  }

  private syncDesktopEmbedState(): void {
    this.postToEmbed({ type: this.isPlaying ? 'play' : 'pause' });
    this.postToEmbed({ type: this.isMuted ? 'mute' : 'unmute' });
  }

  private renderDesktopEmbed(force = false): void {
    if (!this.useDesktopEmbedProxy) return;
    void (async () => {
      const channelId = this.activeChannel.id;
      const sessionToken = this.liveMediaSessionToken;
      const videoId = this.activeChannel.videoId;
      if (!videoId) {
        this.showOfflineMessage(this.activeChannel);
        return;
      }
      if (!force && this.currentVideoId === videoId && this.desktopEmbedIframe) {
        this.syncDesktopEmbedState();
        return;
      }
      const renderToken = ++this.desktopEmbedRenderToken;
      this.currentVideoId = videoId;
      this.isPlayerReady = true;
      if (!this.playerContainer || !this.playerContainer.parentElement)
        this.ensurePlayerContainer();
      if (!this.playerContainer) return;
      this.desktopEmbedIframe = null;
      this.desktopEmbedSession = null;
      this.playerContainer.innerHTML = '';

      const quality = getStreamQuality();
      const params = new URLSearchParams({
        videoId,
        autoplay: this.isPlaying ? '1' : '0',
        mute: this.isMuted ? '1' : '0',
        origin: this.youtubeOrigin || 'https://worldmonitor.app',
        parentOrigin: window.location.origin,
      });
      if (quality !== 'auto') params.set('vq', quality);
      const embedUrl = `http://localhost:${getLocalApiPort()}/api/youtube-embed?${params.toString()}`;

      if (renderToken !== this.desktopEmbedRenderToken) return;
      if (this.liveMediaSessionToken !== sessionToken || this.activeChannel.id !== channelId)
        return;

      const iframe = document.createElement('iframe');
      iframe.className = 'live-news-embed-frame';
      iframe.src = embedUrl;
      iframe.title = `${this.activeChannel.name} live feed`;
      iframe.style.cssText = 'width:100%;height:100%;border:0';
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen; storage-access';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.setAttribute('loading', 'eager');

      this.desktopEmbedIframe = iframe;
      this.desktopEmbedSession = { iframe, channelId, sessionToken };
      this.playerContainer.appendChild(iframe);
      this.startBotCheckTimeout();
    })();
  }

  private startBotCheckTimeout(): void {
    this.clearBotCheckTimeout();
    const channelId = this.activeChannel.id;
    const sessionToken = this.liveMediaSessionToken;
    this.botCheckTimeout = setTimeout(() => {
      this.botCheckTimeout = null;
      if (
        !this.isPlayerReady &&
        this.liveMediaSessionToken === sessionToken &&
        this.activeChannel.id === channelId
      ) {
        this.showBotCheckPrompt(this.activeChannel);
      }
    }, BOT_CHECK_TIMEOUT_MS);
  }

  // ── Native HLS player ─────────────────────────────────────────────────────
  private async renderNativeHlsPlayer(): Promise<void> {
    const hlsUrl =
      this.getDirectHlsUrl(this.activeChannel.id) ||
      this.getProxiedHlsUrl(this.activeChannel.id) ||
      this.activeChannel.hlsUrl;
    if (!hlsUrl || !(hlsUrl.startsWith('https://') || hlsUrl.startsWith('http://127.0.0.1')))
      return;
    const sessionToken = this.liveMediaSessionToken;

    this.destroyPlayer();
    this.ensurePlayerContainer();
    if (!this.playerContainer) return;
    this.playerContainer.innerHTML = '';

    const video = document.createElement('video');
    video.className = 'live-news-native-video';
    video.autoplay = this.isPlaying;
    video.muted = this.isMuted;
    video.playsInline = true;
    video.controls = true;
    video.setAttribute('referrerpolicy', 'no-referrer');
    video.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';

    const failedChannel = this.activeChannel;
    let hlsErrorFired = false;

    const onHlsFatalError = () => {
      if (hlsErrorFired) return;
      hlsErrorFired = true;
      console.warn('[LiveNews] HLS fatal error for', failedChannel.id, hlsUrl);
      if (this.hlsInstance) {
        this.hlsInstance.destroy();
        this.hlsInstance = null;
      }
      video.pause();
      video.removeAttribute('src');
      this.nativeVideoElement = null;
      this.hlsFailureCooldown.set(failedChannel.id, Date.now());
      failedChannel.hlsUrl = undefined;
      if (
        this.liveMediaSessionToken === sessionToken &&
        this.activeChannel.id === failedChannel.id
      ) {
        this.ensurePlayerContainer();
        void this.initializePlayer();
      }
    };

    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl');
    if (nativeHls) {
      video.src = hlsUrl;
      video.addEventListener('error', onHlsFatalError);
    } else {
      const { default: Hls } = await import('hls.js');
      const container = this.state.getContentEl();
      if (!container?.isConnected) return;
      if (this.liveMediaSessionToken !== sessionToken || this.activeChannel.id !== failedChannel.id)
        return;
      if (!Hls.isSupported()) {
        onHlsFatalError();
        return;
      }
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      this.hlsInstance = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_ev, data) => {
        if (data.fatal) onHlsFatalError();
      });
      video.addEventListener('error', onHlsFatalError);
    }

    video.addEventListener('volumechange', () => {
      if (!this.nativeVideoElement) return;
      const muted = this.nativeVideoElement.muted || this.nativeVideoElement.volume === 0;
      if (muted !== this.isMuted) this.syncIsMuted(muted);
    });
    video.addEventListener('pause', () => {
      if (this.nativeVideoElement && this.isPlaying) this.syncIsPlaying(false);
    });
    video.addEventListener('play', () => {
      if (this.nativeVideoElement && !this.isPlaying) this.syncIsPlaying(true);
    });

    this.nativeVideoElement = video;
    this.playerContainer.appendChild(video);
    this.isPlayerReady = true;
    this.currentVideoId = this.activeChannel.videoId || null;

    if (this.isPlaying) {
      const wantUnmute = !this.isMuted;
      video.muted = true;
      video
        .play()
        ?.then(() => {
          if (
            wantUnmute &&
            this.nativeVideoElement === video &&
            this.liveMediaSessionToken === sessionToken
          ) {
            video.muted = false;
          }
        })
        .catch(() => {});
    }
  }

  // ── Sync native video / player state ─────────────────────────────────────
  private syncNativeVideoState(): void {
    if (!this.nativeVideoElement) return;
    this.nativeVideoElement.muted = this.isMuted;
    if (this.isPlaying) this.nativeVideoElement.play()?.catch(() => {});
    else this.nativeVideoElement.pause();
  }

  private async initializePlayer(): Promise<void> {
    if (!this.useDesktopEmbedProxy && !this.nativeVideoElement && this.player) return;

    const channel = this.activeChannel;
    const channelId = channel.id;
    const sessionToken = this.liveMediaSessionToken;
    const useFallback = channel.useFallbackOnly || this.forceFallbackVideoForNextInit;
    this.forceFallbackVideoForNextInit = false;

    await this.resolveChannelVideo(channel, useFallback);

    const container = this.state.getContentEl();
    if (!container?.isConnected) return;
    if (this.liveMediaSessionToken !== sessionToken || this.activeChannel.id !== channelId) return;

    if (
      this.getDirectHlsUrl(this.activeChannel.id) ||
      this.getProxiedHlsUrl(this.activeChannel.id) ||
      this.activeChannel.hlsUrl
    ) {
      void this.renderNativeHlsPlayer();
      return;
    }

    if (!this.activeChannel.videoId || !/^[\w-]{10,12}$/.test(this.activeChannel.videoId)) {
      this.showOfflineMessage(this.activeChannel);
      return;
    }

    if (this.useDesktopEmbedProxy) {
      this.renderDesktopEmbed(true);
      return;
    }

    await loadYouTubeApi();
    if (!container.isConnected) return;
    if (this.liveMediaSessionToken !== sessionToken || this.activeChannel.id !== channelId) return;
    if (this.player || !this.playerElement || !window.YT?.Player) return;

    const storageObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLIFrameElement) {
            let isYT = false;
            try {
              isYT = new URL(node.src).hostname.endsWith('youtube.com');
            } catch {
              /* ok */
            }
            if (!isYT) continue;
            const cur = node.getAttribute('allow') || '';
            if (!cur.includes('storage-access'))
              node.setAttribute('allow', cur ? `${cur}; storage-access` : 'storage-access');
            storageObserver.disconnect();
            if (obsTimeout !== null) clearTimeout(obsTimeout);
            return;
          }
        }
      }
    });
    let obsTimeout: ReturnType<typeof setTimeout> | null = null;
    if (this.playerContainer) {
      storageObserver.observe(this.playerContainer, { childList: true, subtree: true });
      obsTimeout = setTimeout(() => storageObserver.disconnect(), 10_000);
    }

    const playerChannelId = this.activeChannel.id;
    const playerToken = this.liveMediaSessionToken;

    try {
      this.player = new window.YT.Player(this.playerElementId, {
        host: 'https://www.youtube.com',
        videoId: this.activeChannel.videoId,
        playerVars: {
          autoplay: this.isPlaying ? 1 : 0,
          mute: this.isMuted ? 1 : 0,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1,
          ...(this.youtubeOrigin
            ? { origin: this.youtubeOrigin, widget_referrer: this.youtubeOrigin }
            : {}),
        },
        events: {
          onReady: () => {
            if (
              this.liveMediaSessionToken !== playerToken ||
              this.activeChannel.id !== playerChannelId
            )
              return;
            this.clearBotCheckTimeout();
            this.isPlayerReady = true;
            this.currentVideoId = this.activeChannel.videoId || null;
            const iframe = this.player?.getIframe?.();
            if (iframe) iframe.referrerPolicy = 'strict-origin-when-cross-origin';
            const quality = getStreamQuality();
            if (quality !== 'auto') this.player?.setPlaybackQuality?.(quality);
            this.syncPlayerState();
            this.muteSyncInterval = setInterval(() => {
              if (this.useDesktopEmbedProxy || !this.player || !this.isPlayerReady) return;
              const p = this.player as { isMuted?(): boolean; getVolume?(): number };
              const muted = typeof p.isMuted === 'function' ? p.isMuted() : p.getVolume?.() === 0;
              if (typeof muted === 'boolean' && muted !== this.isMuted) this.syncIsMuted(muted);
            }, MUTE_SYNC_POLL_MS);
          },
          onError: (event) => {
            if (
              this.liveMediaSessionToken !== playerToken ||
              this.activeChannel.id !== playerChannelId
            )
              return;
            this.clearBotCheckTimeout();
            const code = Number(event?.data ?? 0);
            if (
              code === 153 &&
              this.activeChannel.fallbackVideoId &&
              this.activeChannel.videoId !== this.activeChannel.fallbackVideoId
            ) {
              this.destroyPlayer();
              this.forceFallbackVideoForNextInit = true;
              this.ensurePlayerContainer();
              void this.initializePlayer();
              return;
            }
            if (code === 153 && isDesktopRuntime()) {
              this.useDesktopEmbedProxy = true;
              this.destroyPlayer();
              this.ensurePlayerContainer();
              this.renderDesktopEmbed(true);
              return;
            }
            this.destroyPlayer();
            this.showEmbedError(this.activeChannel, code);
          },
        },
      });
    } catch (err) {
      storageObserver.disconnect();
      if (obsTimeout !== null) clearTimeout(obsTimeout);
      throw err;
    }

    this.startBotCheckTimeout();
  }

  private syncPlayerState(): void {
    if (this.nativeVideoElement) {
      const videoId = this.activeChannel.videoId;
      if (videoId && this.currentVideoId !== videoId) void this.initializePlayer();
      else this.syncNativeVideoState();
      return;
    }
    if (this.useDesktopEmbedProxy) {
      const videoId = this.activeChannel.videoId;
      if (videoId && this.currentVideoId !== videoId) this.renderDesktopEmbed(true);
      else this.syncDesktopEmbedState();
      return;
    }
    if (!this.player || !this.isPlayerReady) return;
    const videoId = this.activeChannel.videoId;
    if (!videoId) return;
    const isNew = this.currentVideoId !== videoId;
    if (isNew) {
      this.currentVideoId = videoId;
      if (!this.playerElement || !document.getElementById(this.playerElementId)) {
        this.ensurePlayerContainer();
        void this.initializePlayer();
        return;
      }
      if (this.isPlaying) this.player.loadVideoById(videoId);
      else this.player.cueVideoById(videoId);
    }
    if (this.isMuted) this.player.mute();
    else this.player.unMute();
    if (this.isPlaying) {
      if (isNew) {
        this.player.pauseVideo?.();
        setTimeout(() => {
          if (this.player && this.isPlaying) {
            this.player.mute?.();
            this.player.playVideo?.();
            if (!this.isMuted) setTimeout(() => this.player?.unMute?.(), 500);
          }
        }, 800);
      } else {
        this.player.playVideo?.();
      }
    } else {
      this.player.pauseVideo?.();
    }
  }

  private renderPlayer(): void {
    this.ensurePlayerContainer();
    void this.initializePlayer();
  }

  // ── Playback lifecycle ────────────────────────────────────────────────────
  private requestPlaybackForActiveChannel(): void {
    const streamId = this.activeChannel.id;
    requestLiveMediaPlayback(
      'live-news',
      streamId,
      () => {
        this.liveMediaSessionToken += 1;
        this.syncIsPlaying(true);
        this.wasPlayingBeforeIdle = true;
        this.renderPlayer();
      },
      (reason) => {
        this.liveMediaSessionToken += 1;
        const shouldResume = reason === 'idle' && this.wasPlayingBeforeIdle;
        this.syncIsPlaying(false);
        this.wasPlayingBeforeIdle = shouldResume;
        this.destroyPlayer();
        const container = this.state.getContentEl();
        if (container?.isConnected) this.renderPlaceholder();
      },
    );
  }

  private triggerInit(): void {
    if (this.deferredInit) return;
    this.deferredInit = true;
    if (this.lazyObserver) {
      this.lazyObserver.disconnect();
      this.lazyObserver = null;
    }
    if (this.idleCallbackId !== null) {
      if ('cancelIdleCallback' in window)
        (window as Window & { cancelIdleCallback(id: number): void }).cancelIdleCallback(
          this.idleCallbackId as number,
        );
      else clearTimeout(this.idleCallbackId as ReturnType<typeof setTimeout>);
      this.idleCallbackId = null;
    }
    this.requestPlaybackForActiveChannel();
  }

  private startAlwaysOnPlaybackIfVisible(): void {
    if (!this.alwaysOn || document.hidden) return;
    const el = document.getElementById('live-news');
    if (!el?.isConnected) return;
    if (
      getActiveLiveMedia('live-news')?.panelId === 'live-news' &&
      this.activeChannel.id === getActiveLiveMedia('live-news')?.streamId
    )
      return;
    this.requestPlaybackForActiveChannel();
  }

  private setupLazyInit(): void {
    const el = document.getElementById('live-news');
    if (!el) return;
    this.lazyObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        this.lazyObserver?.disconnect();
        this.lazyObserver = null;
        if (!this.alwaysOn) return;
        if ('requestIdleCallback' in window) {
          this.idleCallbackId = (
            window as Window & {
              requestIdleCallback(cb: () => void, opts: { timeout: number }): number;
            }
          ).requestIdleCallback(
            () => {
              this.idleCallbackId = null;
              this.triggerInit();
            },
            { timeout: 1000 },
          );
        } else {
          this.idleCallbackId = setTimeout(() => {
            this.idleCallbackId = null;
            this.triggerInit();
          }, 1000);
        }
      },
      { threshold: 0.1 },
    );
    this.lazyObserver.observe(el);
  }

  private resumeFromIdle(): void {
    if (getActiveLiveMedia('live-news')?.panelId === 'live-news') return;
    if (this.wasPlayingBeforeIdle && !this.isPlaying) this.requestPlaybackForActiveChannel();
  }

  private applyIdleMode(): void {
    if (this.alwaysOn) {
      if (this.idleTimeout) {
        clearTimeout(this.idleTimeout);
        this.idleTimeout = null;
      }
      if (this.idleDetectionEnabled && this._idleResetHandler) {
        IDLE_ACTIVITY_EVENTS.forEach((ev) =>
          document.removeEventListener(ev, this._idleResetHandler!),
        );
        this.idleDetectionEnabled = false;
      }
      this.startAlwaysOnPlaybackIfVisible();
      return;
    }
    if (!this.idleDetectionEnabled && this._idleResetHandler) {
      IDLE_ACTIVITY_EVENTS.forEach((ev) =>
        document.addEventListener(ev, this._idleResetHandler!, { passive: true }),
      );
      this.idleDetectionEnabled = true;
    }
    this._idleResetHandler?.();
  }

  // ── Channel switching ─────────────────────────────────────────────────────
  async switchChannel(channel: LiveChannel): Promise<void> {
    if (channel.id === this.activeChannel.id) return;

    this.activeChannel = channel;
    this.state.setActiveChannelId(channel.id);
    saveToStorage(STORAGE_KEYS.activeChannel, channel.id);

    const hasIntent =
      this.deferredInit ||
      this.isPlaying ||
      !!this.player ||
      !!this.desktopEmbedIframe ||
      !!this.nativeVideoElement ||
      getActiveLiveMedia('live-news')?.panelId === 'live-news';
    const hadOwnership = getActiveLiveMedia('live-news')?.panelId === 'live-news';

    const switcher = this.state.getSwitcherEl();
    if (switcher) {
      switcher.querySelectorAll<HTMLElement>('.live-channel-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.channelId === channel.id);
        if (hasIntent && btn.dataset.channelId === channel.id) btn.classList.add('loading');
      });
    }

    if (!hasIntent) {
      switcher
        ?.querySelectorAll<HTMLElement>('.live-channel-btn')
        .forEach((btn) => btn.classList.remove('loading', 'offline'));
      this.renderPlaceholder();
      return;
    }

    await this.resolveChannelVideo(channel);
    const container = this.state.getContentEl();
    if (!container?.isConnected) return;
    if (this.activeChannel.id !== channel.id) {
      switcher
        ?.querySelectorAll<HTMLElement>('.live-channel-btn.loading')
        .forEach((b) => b.classList.remove('loading'));
      return;
    }
    if (hadOwnership && getActiveLiveMedia('live-news')?.panelId !== 'live-news') {
      switcher
        ?.querySelectorAll<HTMLElement>('.live-channel-btn.loading')
        .forEach((b) => b.classList.remove('loading'));
      this.renderPlaceholder();
      return;
    }
    if (!hasIntent) {
      switcher
        ?.querySelectorAll<HTMLElement>('.live-channel-btn.loading')
        .forEach((b) => b.classList.remove('loading'));
      this.renderPlaceholder();
      return;
    }

    switcher?.querySelectorAll<HTMLElement>('.live-channel-btn').forEach((btn) => {
      btn.classList.remove('loading');
      if (btn.dataset.channelId === channel.id && !channel.videoId) btn.classList.add('offline');
    });

    this.requestPlaybackForActiveChannel();
  }

  // ── Toggle controls ───────────────────────────────────────────────────────
  togglePlayback(): void {
    if (this.isPlaying || this.player || this.desktopEmbedIframe || this.nativeVideoElement) {
      stopLiveMediaPlayback('live-news', 'user-paused');
      return;
    }
    this.requestPlaybackForActiveChannel();
  }

  toggleMute(): void {
    this.syncIsMuted(!this.isMuted);
    this.syncPlayerState();
  }

  toggleFullscreen(): void {
    this.state.setIsFullscreen((prev) => {
      const next = !prev;
      const el = document.getElementById('live-news');
      el?.classList.toggle('live-news-fullscreen', next);
      document.body.classList.toggle('live-news-fullscreen-active', next);
      return next;
    });
  }

  // ── Public API for external events ────────────────────────────────────────
  private stopLiveMediaForClose(): void {
    this.liveMediaSessionToken += 1;
    this.wasPlayingBeforeIdle = false;
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }
    stopLiveMediaPlayback('live-news', 'destroyed');
    if (this.player || this.desktopEmbedIframe || this.nativeVideoElement) {
      this.syncIsPlaying(false);
      this.destroyPlayer();
      this.renderPlaceholder();
    }
  }

  private resumeLiveMediaForShow(): void {
    if (!this.alwaysOn) return;
    if (this.canHostLiveMedia()) this.startAlwaysOnPlaybackIfVisible();
    else if (!this.lazyObserver) this.setupLazyInit();
  }

  private refreshChannelsFromStorage(): void {
    let loaded = loadChannelsFromStorage();
    if (loaded.length === 0) loaded = getDefaultLiveChannels();
    let active = loaded.find((ch) => ch.id === this.activeChannel.id);
    if (!active) {
      active = loaded[0]!;
      void this.switchChannel(active);
    }
    this.syncChannels(loaded, active);
  }

  openChannelManagementModal(): void {
    if (document.querySelector('.live-channels-modal-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'live-channels-modal-overlay';
    overlay.setAttribute('aria-modal', 'true');
    const modal = document.createElement('div');
    modal.className = 'live-channels-modal';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'live-channels-modal-close';
    closeBtn.setAttribute('aria-label', t('common.close') ?? 'Close');
    closeBtn.innerHTML = '&times;';
    const container = document.createElement('div');
    modal.append(closeBtn, container);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    import('@/live-channels-window')
      .then(async ({ initLiveChannelsWindow }) => {
        await initLiveChannelsWindow(container);
      })
      .catch(console.error);

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      this.refreshChannelsFromStorage();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
  }

  // ── Drag reorder setup ────────────────────────────────────────────────────
  private setupDragReorder(): void {
    const switcher = this.state.getSwitcherEl();
    if (!switcher) return;

    let dragging: HTMLElement | null = null;
    let dragStarted = false;
    let startX = 0;
    const THRESHOLD = 6;

    this._dragMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const btn = (e.target as HTMLElement).closest('.live-channel-btn') as HTMLElement | null;
      if (!btn) return;
      this.suppressChannelClick = false;
      dragging = btn;
      dragStarted = false;
      startX = e.clientX;
      e.preventDefault();
    };

    this._dragMouseMove = (e: MouseEvent) => {
      if (!dragging || !this.state.getSwitcherEl()) return;
      if (!dragStarted) {
        if (Math.abs(e.clientX - startX) < THRESHOLD) return;
        dragStarted = true;
        dragging.classList.add('live-channel-dragging');
      }
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('.live-channel-btn') as HTMLElement | null;
      if (!target || target === dragging) return;
      const sw = this.state.getSwitcherEl();
      if (!sw) return;
      const all = Array.from(sw.querySelectorAll('.live-channel-btn'));
      const idx = all.indexOf(dragging);
      const tidx = all.indexOf(target);
      if (idx === -1 || tidx === -1) return;
      if (idx < tidx) target.parentElement?.insertBefore(dragging, target.nextSibling);
      else target.parentElement?.insertBefore(dragging, target);
    };

    this._dragMouseUp = () => {
      if (!dragging) return;
      if (dragStarted) {
        dragging.classList.remove('live-channel-dragging');
        const sw = this.state.getSwitcherEl();
        if (sw) {
          const ids = Array.from(sw.querySelectorAll<HTMLElement>('.live-channel-btn'))
            .map((el) => el.dataset.channelId)
            .filter((id): id is string => !!id);
          const orderMap = new Map(this.channels.map((ch) => [ch.id, ch]));
          const reordered = ids
            .map((id) => orderMap.get(id))
            .filter((ch): ch is LiveChannel => !!ch);
          this.channels = reordered;
          saveChannelsToStorage(reordered);
          this.state.setChannels([...reordered]);
        }
        this.suppressChannelClick = true;
        setTimeout(() => {
          this.suppressChannelClick = false;
        }, 0);
      }
      dragging = null;
      dragStarted = false;
    };

    switcher.addEventListener('mousedown', this._dragMouseDown);
    document.addEventListener('mousemove', this._dragMouseMove);
    document.addEventListener('mouseup', this._dragMouseUp);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  mount(): void {
    // Set up idle reset handler first — applyIdleMode needs it
    this._idleResetHandler = () => {
      if (this.alwaysOn) return;
      if (this.idleTimeout) clearTimeout(this.idleTimeout);
      this.resumeFromIdle();
      this.idleTimeout = setTimeout(() => {
        this.wasPlayingBeforeIdle = this.isPlaying;
        if (this.isPlaying) this.syncIsPlaying(false);
        stopLiveMediaPlayback('live-news', 'idle');
      }, IDLE_PAUSE_MS);
    };

    this.renderPlaceholder();

    this._playAllStarter = () => {
      if (this.canHostLiveMedia()) this.triggerInit();
    };
    registerLiveMediaStarter('live-news', this._playAllStarter);

    this._unsubStream = subscribeLiveStreamsSettingsChange((alwaysOn) => {
      const wasAlwaysOn = this.alwaysOn;
      this.alwaysOn = alwaysOn;
      this.applyIdleMode();
      if (wasAlwaysOn && !alwaysOn) {
        if (this.lazyObserver) {
          this.lazyObserver.disconnect();
          this.lazyObserver = null;
        }
        if (this.idleCallbackId !== null) {
          if ('cancelIdleCallback' in window)
            (window as Window & { cancelIdleCallback(id: number): void }).cancelIdleCallback(
              this.idleCallbackId as number,
            );
          else clearTimeout(this.idleCallbackId as ReturnType<typeof setTimeout>);
          this.idleCallbackId = null;
        }
      }
      if (alwaysOn && !this.deferredInit && this.canHostLiveMedia())
        this.startAlwaysOnPlaybackIfVisible();
      else if (alwaysOn && !this.deferredInit && !this.lazyObserver) this.setupLazyInit();
    });

    this._visibilityChangeHandler = () => {
      if (document.hidden) {
        if (this.idleTimeout) clearTimeout(this.idleTimeout);
        stopLiveMediaPlayback('live-news', 'hidden');
      } else {
        this.applyIdleMode();
      }
    };
    document.addEventListener('visibilitychange', this._visibilityChangeHandler);

    this.applyIdleMode();

    this._messageHandler = (e: MessageEvent) => {
      const session = this.desktopEmbedSession;
      if (!session || e.source !== session.iframe.contentWindow) return;
      if (
        this.liveMediaSessionToken !== session.sessionToken ||
        this.activeChannel.id !== session.channelId
      )
        return;
      const expected = getEmbedOrigin();
      const local = getApiBaseUrl();
      if (e.origin !== expected && (!local || e.origin !== local)) return;
      const msg = e.data as Record<string, unknown> | null;
      if (!msg || typeof msg !== 'object' || !msg['type']) return;
      if (msg['type'] === 'yt-ready') {
        this.clearBotCheckTimeout();
        this.isPlayerReady = true;
        this.syncDesktopEmbedState();
      } else if (msg['type'] === 'yt-error') {
        this.clearBotCheckTimeout();
        const code = Number(msg['code'] ?? 0);
        const ch = this.activeChannel;
        if (code === 153 && ch.fallbackVideoId && ch.videoId !== ch.fallbackVideoId) {
          ch.videoId = ch.fallbackVideoId;
          this.renderDesktopEmbed(true);
        } else {
          this.showEmbedError(ch, code);
        }
      } else if (msg['type'] === 'yt-mute-state') {
        const muted = msg['muted'] === true;
        if (this.isMuted !== muted) this.syncIsMuted(muted);
      }
    };
    window.addEventListener('message', this._messageHandler);

    this._keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.state.setIsFullscreen((prev) => {
          if (!prev) return false;
          document.getElementById('live-news')?.classList.remove('live-news-fullscreen');
          document.body.classList.remove('live-news-fullscreen-active');
          return false;
        });
      }
    };
    document.addEventListener('keydown', this._keydownHandler);

    this._stopHandler = () => this.stopLiveMediaForClose();
    this._resumeHandler = () => this.resumeLiveMediaForShow();
    this._refreshHandler = () => this.refreshChannelsFromStorage();
    window.addEventListener('wm:live-news-stop', this._stopHandler);
    window.addEventListener('wm:live-news-resume', this._resumeHandler);
    window.addEventListener('wm:live-news-refresh-channels', this._refreshHandler);

    if (this.alwaysOn) this.setupLazyInit();

    this.setupDragReorder();
  }

  destroy(): void {
    this.liveMediaSessionToken += 1;
    if (this._playAllStarter) unregisterLiveMediaStarter('live-news', this._playAllStarter);
    releaseLiveMediaPlayback('live-news');
    this.destroyPlayer();
    if (this._unsubStream) {
      this._unsubStream();
      this._unsubStream = null;
    }
    if (this._visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this._visibilityChangeHandler);
      this._visibilityChangeHandler = null;
    }
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
      this._messageHandler = null;
    }
    if (this._keydownHandler) {
      document.removeEventListener('keydown', this._keydownHandler);
      this._keydownHandler = null;
    }
    if (this._stopHandler) {
      window.removeEventListener('wm:live-news-stop', this._stopHandler);
      this._stopHandler = null;
    }
    if (this._resumeHandler) {
      window.removeEventListener('wm:live-news-resume', this._resumeHandler);
      this._resumeHandler = null;
    }
    if (this._refreshHandler) {
      window.removeEventListener('wm:live-news-refresh-channels', this._refreshHandler);
      this._refreshHandler = null;
    }
    if (this.lazyObserver) {
      this.lazyObserver.disconnect();
      this.lazyObserver = null;
    }
    if (this.idleCallbackId !== null) {
      if ('cancelIdleCallback' in window)
        (window as Window & { cancelIdleCallback(id: number): void }).cancelIdleCallback(
          this.idleCallbackId as number,
        );
      else clearTimeout(this.idleCallbackId as ReturnType<typeof setTimeout>);
      this.idleCallbackId = null;
    }
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }
    if (this.idleDetectionEnabled && this._idleResetHandler) {
      IDLE_ACTIVITY_EVENTS.forEach((ev) =>
        document.removeEventListener(ev, this._idleResetHandler!),
      );
      this.idleDetectionEnabled = false;
    }
    document.getElementById('live-news')?.classList.remove('live-news-fullscreen');
    document.body.classList.remove('live-news-fullscreen-active');
    // Drag reorder cleanup
    const switcher = this.state.getSwitcherEl();
    if (switcher && this._dragMouseDown)
      switcher.removeEventListener('mousedown', this._dragMouseDown);
    if (this._dragMouseMove) document.removeEventListener('mousemove', this._dragMouseMove);
    if (this._dragMouseUp) document.removeEventListener('mouseup', this._dragMouseUp);
  }
}
