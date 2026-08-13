import { isDesktopRuntime, getLocalApiPort } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { trackWebcamSelected, trackWebcamRegionFiltered } from '@/services/analytics';
import { getStreamQuality, subscribeStreamQualityChange } from '@/services/ai-flow-settings';
import { isMobileDevice, loadFromStorage, saveToStorage } from '@/utils';
import {
  playAllLiveMedia,
  registerLiveMediaStarter,
  unregisterLiveMediaStarter,
  type LiveMediaStopReason,
} from '@/services/live-media-controller';
import {
  getLiveStreamsAlwaysOn,
  subscribeLiveStreamsSettingsChange,
} from '@/services/live-stream-settings';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { isAllowedWebcamEmbedMessageOrigin } from '@/components/_live-webcams-origin';
import { IDLE_PAUSE_MS, STORAGE_KEYS } from '@/config';

export type WebcamRegion = 'middle-east' | 'europe' | 'asia' | 'americas' | 'space';

export interface WebcamFeed {
  id: string;
  city: string;
  country: string;
  region: WebcamRegion;
  channelHandle: string;
  fallbackVideoId: string;
}

// Verified YouTube live stream IDs — validated Feb 2026 via title cross-check.
// IDs may rotate; update when stale.
export const WEBCAM_FEEDS: WebcamFeed[] = [
  // Middle East — Jerusalem & Tehran adjacent (conflict hotspots)
  {
    id: 'jerusalem',
    city: 'Jerusalem',
    country: 'Israel',
    region: 'middle-east',
    channelHandle: '@TheWesternWall',
    fallbackVideoId: 'e34xb-Fbl0U',
  },
  {
    id: 'middle-east',
    city: 'Middle East',
    country: 'Multi',
    region: 'middle-east',
    channelHandle: '@MiddleEastCams',
    fallbackVideoId: 'oxT5R6I0N6E',
  },
  {
    id: 'tel-aviv',
    city: 'Tel Aviv',
    country: 'Israel',
    region: 'middle-east',
    channelHandle: '@IsraelLiveCam',
    fallbackVideoId: 'gmtlJ_m2r5A',
  },
  {
    id: 'mecca',
    city: 'Mecca',
    country: 'Saudi Arabia',
    region: 'middle-east',
    channelHandle: '@MakkahLive',
    fallbackVideoId: 'kJwEsQTegxk',
  },
  {
    id: 'beirut-mtv',
    city: 'Beirut',
    country: 'Lebanon',
    region: 'middle-east',
    channelHandle: '@MTVLebanonNews',
    fallbackVideoId: 'djF-Lkgfp6k',
  },
  // Europe
  {
    id: 'kyiv',
    city: 'Kyiv',
    country: 'Ukraine',
    region: 'europe',
    channelHandle: '@DWNews',
    fallbackVideoId: '-Q7FuPINDjA',
  },
  {
    id: 'odessa',
    city: 'Odessa',
    country: 'Ukraine',
    region: 'europe',
    channelHandle: '@UkraineLiveCam',
    fallbackVideoId: 'e2gC37ILQmk',
  },
  {
    id: 'paris',
    city: 'Paris',
    country: 'France',
    region: 'europe',
    channelHandle: '@PalaisIena',
    fallbackVideoId: 'OzYp4NRZlwQ',
  },
  {
    id: 'st-petersburg',
    city: 'St. Petersburg',
    country: 'Russia',
    region: 'europe',
    channelHandle: '@SPBLiveCam',
    fallbackVideoId: 'CjtIYbmVfck',
  },
  {
    id: 'london',
    city: 'London',
    country: 'UK',
    region: 'europe',
    channelHandle: '@EarthCam',
    fallbackVideoId: 'Lxqcg1qt0XU',
  },
  // Americas
  {
    id: 'washington',
    city: 'Washington DC',
    country: 'USA',
    region: 'americas',
    channelHandle: '@AxisCommunications',
    fallbackVideoId: '1wV9lLe14aU',
  },
  {
    id: 'new-york',
    city: 'New York',
    country: 'USA',
    region: 'americas',
    channelHandle: '@EarthCam',
    fallbackVideoId: '4qyZLflp-sI',
  },
  {
    id: 'los-angeles',
    city: 'Los Angeles',
    country: 'USA',
    region: 'americas',
    channelHandle: '@VeniceVHotel',
    fallbackVideoId: 'EO_1LWqsCNE',
  },
  {
    id: 'miami',
    city: 'Miami',
    country: 'USA',
    region: 'americas',
    channelHandle: '@FloridaLiveCams',
    fallbackVideoId: '5YCajRjvWCg',
  },
  // Asia-Pacific — Taipei first (strait hotspot), then Shanghai, Tokyo, Seoul
  {
    id: 'taipei',
    city: 'Taipei',
    country: 'Taiwan',
    region: 'asia',
    channelHandle: '@JackyWuTaipei',
    fallbackVideoId: 'z_fY1pj1VBw',
  },
  {
    id: 'shanghai',
    city: 'Shanghai',
    country: 'China',
    region: 'asia',
    channelHandle: '@SkylineWebcams',
    fallbackVideoId: '76EwqI5XZIc',
  },
  {
    id: 'tokyo',
    city: 'Tokyo',
    country: 'Japan',
    region: 'asia',
    channelHandle: '@TokyoLiveCam4K',
    fallbackVideoId: '_k-5U7IeK8g',
  },
  {
    id: 'seoul',
    city: 'Seoul',
    country: 'South Korea',
    region: 'asia',
    channelHandle: '@UNvillage_live',
    fallbackVideoId: '-JhoMGoAfFc',
  },
  {
    id: 'sydney',
    city: 'Sydney',
    country: 'Australia',
    region: 'asia',
    channelHandle: '@WebcamSydney',
    fallbackVideoId: '7pcL-0Wo77U',
  },
  // Space
  {
    id: 'iss-earth',
    city: 'ISS Earth View',
    country: 'Space',
    region: 'space',
    channelHandle: '@NASA',
    fallbackVideoId: 'vytmBNhc9ig',
  },
  {
    id: 'nasa-live',
    city: 'NASA TV',
    country: 'Space',
    region: 'space',
    channelHandle: '@NASA',
    fallbackVideoId: 'zPH5KtjJFaQ',
  },
  {
    id: 'space-x',
    city: 'SpaceX',
    country: 'Space',
    region: 'space',
    channelHandle: '@SpaceX',
    fallbackVideoId: 'fO9e9jnhYK8',
  },
  {
    id: 'space-walk',
    city: 'Space',
    country: 'Space',
    region: 'space',
    channelHandle: '@NASA',
    fallbackVideoId: 'fO9e9jnhYK8',
  },
];

const MAX_GRID_CELLS = 4;
const ECO_IDLE_PAUSE_MS = IDLE_PAUSE_MS;
const IDLE_ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'] as const;
const EMBED_READY_TIMEOUT_MS = 15000;

export type ViewMode = 'grid' | 'single';
export type RegionFilter = 'all' | WebcamRegion;

export const ALL_REGIONS: RegionFilter[] = [
  'all',
  'middle-east',
  'europe',
  'americas',
  'asia',
  'space',
];

export interface WebcamPrefs {
  regionFilter: RegionFilter;
  viewMode: ViewMode;
  activeFeedId: string;
}

export function loadWebcamPrefs(forceSingleView: boolean): WebcamPrefs {
  const stored = loadFromStorage<Partial<WebcamPrefs>>(STORAGE_KEYS.webcamPrefs, {});
  const region = stored.regionFilter as RegionFilter;
  const regionFilter = ALL_REGIONS.includes(region) ? region : 'all';
  const viewMode = forceSingleView
    ? 'single'
    : stored.viewMode === 'grid' || stored.viewMode === 'single'
      ? stored.viewMode
      : 'grid';
  const regionFeeds =
    regionFilter === 'all' ? WEBCAM_FEEDS : WEBCAM_FEEDS.filter((f) => f.region === regionFilter);
  const matchedFeed = regionFeeds.find((f) => f.id === stored.activeFeedId);
  const activeFeedId = matchedFeed?.id ?? regionFeeds[0]?.id ?? WEBCAM_FEEDS[0]!.id;
  return { regionFilter, viewMode, activeFeedId };
}

export function saveWebcamPrefs(prefs: WebcamPrefs): void {
  saveToStorage(STORAGE_KEYS.webcamPrefs, prefs);
}

interface WebcamIframeTracker {
  feed: WebcamFeed;
  container: HTMLElement;
  timeout: ReturnType<typeof setTimeout> | null;
  blocked: boolean;
}

export interface LiveWebcamsControllerState {
  setViewMode: (v: ViewMode) => void;
  setRegionFilter: (v: RegionFilter) => void;
  setActiveFeedId: (id: string) => void;
  setIsIdle: (v: boolean) => void;
  setIsFullscreen: (v: boolean) => void;
  getContentEl: () => HTMLDivElement | null;
}

export class LiveWebcamsController {
  private viewMode: ViewMode;
  private regionFilter: RegionFilter;
  private activeFeed: WebcamFeed;
  private iframes: HTMLIFrameElement[] = [];
  private iframeTrackers = new Map<HTMLIFrameElement, WebcamIframeTracker>();
  private activeIframeFeedIds = new Set<string>();
  private observer: IntersectionObserver | null = null;
  private isVisible = false;
  private idleTimeout: ReturnType<typeof setTimeout> | null = null;
  private boundIdleResetHandler!: () => void;
  private boundVisibilityHandler!: () => void;
  private idleDetectionEnabled = false;
  private isIdle = false;
  private alwaysOn = getLiveStreamsAlwaysOn();
  private unsubscribeStreamSettings: (() => void) | null = null;
  private unsubscribeStreamQuality: (() => void) | null = null;
  private resumeFeedAfterIdleIds: string[] = [];
  private isFullscreen = false;
  private readonly forceSingleView = !isDesktopRuntime() && isMobileDevice();

  private readonly boundPlayAllStarter = () => {
    if (this.canHostLiveMedia()) this.playAllFeeds();
  };
  private boundEmbedMessageHandler!: (e: MessageEvent) => void;
  private boundFullscreenEscHandler!: (e: KeyboardEvent) => void;
  private boundStopHandler!: () => void;
  private boundResumeHandler!: () => void;

  constructor(private readonly state: LiveWebcamsControllerState) {
    const prefs = loadWebcamPrefs(this.forceSingleView);
    this.regionFilter = prefs.regionFilter;
    this.viewMode = prefs.viewMode;
    this.activeFeed = WEBCAM_FEEDS.find((f) => f.id === prefs.activeFeedId) ?? WEBCAM_FEEDS[0]!;
  }

  private get element(): HTMLElement | null {
    return document.getElementById('live-webcams');
  }

  private get content(): HTMLDivElement | null {
    return this.state.getContentEl();
  }

  private canHostLiveMedia(): boolean {
    const el = this.element;
    return !!el?.isConnected && !el.closest('[data-collapsed]');
  }

  private get filteredFeeds(): WebcamFeed[] {
    if (this.regionFilter === 'all') return WEBCAM_FEEDS;
    return WEBCAM_FEEDS.filter((f) => f.region === this.regionFilter);
  }

  private static readonly ALL_GRID_IDS = ['jerusalem', 'middle-east', 'kyiv', 'washington'];

  private get gridFeeds(): WebcamFeed[] {
    if (this.regionFilter === 'all') {
      return LiveWebcamsController.ALL_GRID_IDS.map((id) =>
        WEBCAM_FEEDS.find((f) => f.id === id)!,
      ).filter(Boolean);
    }
    return this.filteredFeeds.slice(0, MAX_GRID_CELLS);
  }

  private savePrefs(): void {
    saveWebcamPrefs({
      regionFilter: this.regionFilter,
      viewMode: this.viewMode,
      activeFeedId: this.activeFeed.id,
    });
  }

  private buildEmbedUrl(videoId: string): string {
    const quality = getStreamQuality();
    if (isDesktopRuntime()) {
      const params = new URLSearchParams({ videoId, autoplay: '1', mute: '1' });
      if (quality !== 'auto') params.set('vq', quality);
      return `http://localhost:${getLocalApiPort()}/api/youtube-embed?${params.toString()}`;
    }
    const vq = quality !== 'auto' ? `&vq=${quality}` : '';
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1&rel=0&enablejsapi=1&origin=${window.location.origin}${vq}`;
  }

  private createIframe(feed: WebcamFeed): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.className = 'webcam-iframe';
    iframe.src = this.buildEmbedUrl(feed.fallbackVideoId);
    iframe.title = `${feed.city} live webcam`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; storage-access';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    if (!isDesktopRuntime()) {
      iframe.allowFullscreen = true;
      iframe.setAttribute('loading', 'lazy');
    }
    return iframe;
  }

  private findIframeBySource(source: MessageEventSource | null): HTMLIFrameElement | null {
    if (!source || !(source instanceof Window)) return null;
    for (const iframe of this.iframes) {
      if (iframe.contentWindow === source) return iframe;
    }
    return null;
  }

  private clearIframeTimeout(iframe: HTMLIFrameElement): void {
    const tracker = this.iframeTrackers.get(iframe);
    if (!tracker?.timeout) return;
    clearTimeout(tracker.timeout);
    tracker.timeout = null;
  }

  private markIframeBlocked(iframe: HTMLIFrameElement): void {
    const tracker = this.iframeTrackers.get(iframe);
    if (!tracker || tracker.blocked) return;
    tracker.blocked = true;
    this.clearIframeTimeout(iframe);
    this.renderBlockedOverlay(iframe, tracker.feed, tracker.container);
  }

  private markIframeReady(iframe: HTMLIFrameElement): void {
    const tracker = this.iframeTrackers.get(iframe);
    if (!tracker) return;
    tracker.blocked = false;
    this.clearIframeTimeout(iframe);
    tracker.container.querySelector('.webcam-embed-fallback')?.remove();
  }

  private trackIframe(iframe: HTMLIFrameElement, feed: WebcamFeed, container: HTMLElement): void {
    const tracker: WebcamIframeTracker = {
      feed,
      container,
      timeout: null,
      blocked: false,
    };
    this.iframeTrackers.set(iframe, tracker);
    iframe.addEventListener('load', () => this.markIframeReady(iframe), { once: true });
    tracker.timeout = setTimeout(() => this.markIframeBlocked(iframe), EMBED_READY_TIMEOUT_MS);
  }

  private playFeed(feed: WebcamFeed, source: 'grid' | 'single' | 'settings'): void {
    if (source !== 'settings') {
      trackWebcamSelected(feed.id, feed.city, source);
    }
    this.activeFeed = feed;
    this.state.setActiveFeedId(feed.id);
    this.isIdle = false;
    const alreadyActive = this.activeIframeFeedIds.has(feed.id);
    this.activeIframeFeedIds.add(feed.id);
    this.savePrefs();
    if (!this.isVisible || document.hidden) return;
    if (
      this.viewMode === 'grid' &&
      !this.forceSingleView &&
      !alreadyActive &&
      this.activateGridCell(feed)
    ) {
      return;
    }
    this.render();
  }

  private activateGridCell(feed: WebcamFeed): boolean {
    const content = this.content;
    if (!content) return false;
    const grid = content.querySelector('.webcam-grid');
    if (!grid) return false;
    const preview = grid.querySelector<HTMLElement>(
      `.webcam-preview-tile[data-feed-id="${CSS.escape(feed.id)}"]`,
    );
    const cell = preview?.closest('.webcam-cell') as HTMLElement | null;
    if (!cell) return false;
    setTrustedHtml(cell, trustedHtml('', 'legacy direct innerHTML migration'));
    const iframe = this.createIframe(feed);
    cell.appendChild(iframe);
    this.iframes.push(iframe);
    this.trackIframe(iframe, feed, cell);
    const label = document.createElement('div');
    label.className = 'webcam-cell-label';
    setTrustedHtml(
      label,
      trustedHtml(
        `<span class="webcam-live-dot"></span><span class="webcam-city">${escapeHtml(feed.city.toUpperCase())}</span>`,
        'legacy direct innerHTML migration',
      ),
    );
    cell.appendChild(label);
    return true;
  }

  private isPanelVisible(): boolean {
    const el = this.element;
    if (!el?.isConnected) return false;
    const rect = el.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  private startAlwaysOnPlayback(): boolean {
    if (!this.alwaysOn || document.hidden || !this.element?.isConnected || !this.isVisible)
      return false;
    const feeds =
      this.viewMode === 'grid' && !this.forceSingleView ? this.gridFeeds : [this.activeFeed];
    let added = false;
    for (const feed of feeds) {
      if (!this.activeIframeFeedIds.has(feed.id)) {
        this.activeIframeFeedIds.add(feed.id);
        added = true;
      }
    }
    if (!added) return false;
    this.isIdle = false;
    this.render();
    return true;
  }

  private playAllFeeds(): void {
    const feeds =
      this.viewMode === 'grid' && !this.forceSingleView ? this.gridFeeds : [this.activeFeed];
    let added = false;
    for (const feed of feeds) {
      if (!this.activeIframeFeedIds.has(feed.id)) {
        this.activeIframeFeedIds.add(feed.id);
        added = true;
      }
    }
    if (!added) return;
    this.isIdle = false;
    if (this.isVisible && !document.hidden) this.render();
  }

  private clearActivePlayback(): void {
    this.activeIframeFeedIds.clear();
    this.destroyIframes();
  }

  private teardownPlayback(reason: LiveMediaStopReason): void {
    this.resumeFeedAfterIdleIds = reason === 'idle' ? Array.from(this.activeIframeFeedIds) : [];
    this.clearActivePlayback();
    if (this.isVisible && !this.isIdle && this.element?.isConnected && !document.hidden) {
      this.render();
    }
  }

  private renderPreviewTile(
    container: HTMLElement,
    feed: WebcamFeed,
    source: 'grid' | 'single',
  ): void {
    const preview = document.createElement('div');
    preview.className = 'webcam-preview-tile';
    preview.dataset.feedId = feed.id;

    const status = document.createElement('div');
    status.className = 'webcam-preview-status';
    const dot = document.createElement('span');
    dot.className = 'webcam-live-dot';
    const statusText = document.createElement('span');
    statusText.textContent = t('components.webcams.previewStatus') || 'Live preview';
    status.append(dot, statusText);

    const title = document.createElement('div');
    title.className = 'webcam-preview-title';
    title.textContent = feed.city;

    const meta = document.createElement('div');
    meta.className = 'webcam-preview-meta';
    meta.textContent = `${feed.country} · ${feed.region.replace('-', ' ')}`;

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'offline-retry webcam-preview-play';
    playBtn.textContent = t('components.webcams.play') || 'Play';
    const playAll = () => {
      trackWebcamSelected(feed.id, feed.city, source);
      this.activeFeed = feed;
      this.state.setActiveFeedId(feed.id);
      this.savePrefs();
      playAllLiveMedia();
    };
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playAll();
    });

    preview.addEventListener('click', () => playAll());
    preview.append(status, title, meta, playBtn);
    container.appendChild(preview);
  }

  private retryIframe(oldIframe: HTMLIFrameElement): void {
    const tracker = this.iframeTrackers.get(oldIframe);
    if (!tracker) return;

    if (!oldIframe.parentNode) {
      this.clearIframeTimeout(oldIframe);
      return;
    }
    const freshIframe = this.createIframe(tracker.feed);
    try {
      oldIframe.replaceWith(freshIframe);
    } catch {
      this.clearIframeTimeout(oldIframe);
      this.iframeTrackers.delete(oldIframe);
      oldIframe.src = 'about:blank';
      tracker.container.querySelector('.webcam-embed-fallback')?.remove();
      tracker.container.appendChild(freshIframe);
      const idx = this.iframes.indexOf(oldIframe);
      if (idx >= 0) this.iframes[idx] = freshIframe;
      else this.iframes.push(freshIframe);
      this.trackIframe(freshIframe, tracker.feed, tracker.container);
      return;
    }
    oldIframe.src = 'about:blank';

    const idx = this.iframes.indexOf(oldIframe);
    if (idx >= 0) this.iframes[idx] = freshIframe;

    this.clearIframeTimeout(oldIframe);
    this.iframeTrackers.delete(oldIframe);
    this.trackIframe(freshIframe, tracker.feed, tracker.container);
    tracker.container.querySelector('.webcam-embed-fallback')?.remove();
  }

  private renderBlockedOverlay(
    iframe: HTMLIFrameElement,
    feed: WebcamFeed,
    container: HTMLElement,
  ): void {
    container.querySelector('.webcam-embed-fallback')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'webcam-embed-fallback';
    overlay.addEventListener('click', (e) => e.stopPropagation());

    const message = document.createElement('div');
    message.className = 'webcam-embed-fallback-text';
    message.textContent = 'This stream is blocked or failed to load.';

    const actions = document.createElement('div');
    actions.className = 'webcam-embed-fallback-actions';

    const retryBtn = document.createElement('button');
    retryBtn.className = 'offline-retry webcam-embed-retry';
    retryBtn.textContent = t('common.retry') || 'Retry';
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.retryIframe(iframe);
    });

    const openBtn = document.createElement('a');
    openBtn.className = 'offline-retry webcam-embed-open';
    openBtn.href = `https://www.youtube.com/watch?v=${encodeURIComponent(feed.fallbackVideoId)}`;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener noreferrer';
    openBtn.textContent = t('components.liveNews.openOnYouTube') || 'Open on YouTube';
    openBtn.addEventListener('click', (e) => e.stopPropagation());

    actions.append(retryBtn, openBtn);
    overlay.append(message, actions);
    container.appendChild(overlay);
  }

  private handleEmbedMessage(e: MessageEvent): void {
    const iframe = this.findIframeBySource(e.source);
    if (!iframe) return;
    if (!isAllowedWebcamEmbedMessageOrigin(e.origin, iframe.src)) return;

    const msg = e.data as
      | { type?: string; state?: number; code?: number; event?: string; info?: unknown }
      | string
      | null;

    if (typeof msg === 'string') {
      if (msg[0] !== '{') return;
      try {
        const parsed = JSON.parse(msg) as { event?: string; info?: { playerState?: number } };
        if (parsed.event === 'onReady' || parsed.event === 'initialDelivery') {
          this.markIframeReady(iframe);
        } else if (parsed.event === 'infoDelivery' && parsed.info?.playerState === 1) {
          this.markIframeReady(iframe);
        }
      } catch {
        /* not YouTube JSON — ignore */
      }
      return;
    }

    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'yt-ready') {
      this.markIframeReady(iframe);
      return;
    }

    if (msg.type === 'yt-state' && (msg.state === 1 || msg.state === 3)) {
      this.markIframeReady(iframe);
      return;
    }

    if (msg.type === 'yt-error') {
      this.markIframeBlocked(iframe);
    }
  }

  private render(): void {
    this.destroyIframes();

    const content = this.content;
    if (!content) return;

    if (!this.isVisible || this.isIdle) {
      setTrustedHtml(
        content,
        trustedHtml(
          `<div class="webcam-placeholder">${escapeHtml(t('components.webcams.paused'))}</div>`,
          'legacy direct innerHTML migration',
        ),
      );
      return;
    }

    if (this.viewMode === 'grid') {
      this.renderGrid(content);
    } else {
      this.renderSingle(content);
    }
  }

  private renderGrid(content: HTMLDivElement): void {
    if (this.forceSingleView) {
      this.viewMode = 'single';
      this.state.setViewMode('single');
      this.renderSingle(content);
      return;
    }

    setTrustedHtml(content, trustedHtml('', 'legacy direct innerHTML migration'));
    content.className = 'panel-content webcam-content';

    const grid = document.createElement('div');
    grid.className = 'webcam-grid';

    const feeds = this.gridFeeds;

    feeds.forEach((feed) => {
      const cell = document.createElement('div');
      cell.className = 'webcam-cell';

      if (this.activeIframeFeedIds.has(feed.id)) {
        const iframe = this.createIframe(feed);
        cell.appendChild(iframe);
        this.iframes.push(iframe);
        this.trackIframe(iframe, feed, cell);

        const label = document.createElement('div');
        label.className = 'webcam-cell-label';
        setTrustedHtml(
          label,
          trustedHtml(
            `<span class="webcam-live-dot"></span><span class="webcam-city">${escapeHtml(feed.city.toUpperCase())}</span>`,
            'legacy direct innerHTML migration',
          ),
        );
        cell.appendChild(label);
      } else {
        this.renderPreviewTile(cell, feed, 'grid');
      }

      grid.appendChild(cell);
    });

    content.appendChild(grid);
  }

  private renderSingle(content: HTMLDivElement): void {
    setTrustedHtml(content, trustedHtml('', 'legacy direct innerHTML migration'));
    content.className = 'panel-content webcam-content';

    const wrapper = document.createElement('div');
    wrapper.className = 'webcam-single';

    if (this.activeIframeFeedIds.has(this.activeFeed.id)) {
      const iframe = this.createIframe(this.activeFeed);
      wrapper.appendChild(iframe);
      this.iframes.push(iframe);
      this.trackIframe(iframe, this.activeFeed, wrapper);
    } else {
      this.renderPreviewTile(wrapper, this.activeFeed, 'single');
    }

    content.appendChild(wrapper);
  }

  private destroyIframes(): void {
    this.iframeTrackers.forEach((tracker, iframe) => {
      if (tracker.timeout) clearTimeout(tracker.timeout);
      iframe.src = 'about:blank';
      iframe.remove();
    });
    this.iframeTrackers.clear();
    this.iframes.forEach((iframe) => {
      if (iframe.isConnected) {
        iframe.src = 'about:blank';
        iframe.remove();
      }
    });
    this.iframes = [];
  }

  private setupIntersectionObserver(): void {
    const el = this.element;
    if (!el) return;
    this.observer = new IntersectionObserver(
      (entries) => {
        const wasVisible = this.isVisible;
        this.isVisible = entries.some((e) => e.isIntersecting);
        if (this.isVisible && !wasVisible && !this.isIdle) {
          if (!this.startAlwaysOnPlayback()) this.render();
        } else if (!this.isVisible && wasVisible) {
          this.teardownPlayback('scroll-away');
        }
      },
      { threshold: 0.1 },
    );
    this.observer.observe(el);
  }

  private applyIdleMode(): void {
    if (this.alwaysOn) {
      if (this.idleTimeout) {
        clearTimeout(this.idleTimeout);
        this.idleTimeout = null;
      }
      if (this.idleDetectionEnabled) {
        IDLE_ACTIVITY_EVENTS.forEach((event) => {
          document.removeEventListener(event, this.boundIdleResetHandler);
        });
        this.idleDetectionEnabled = false;
      }
      this.resumeFeedAfterIdleIds = [];
      if (this.isIdle && !document.hidden) {
        this.isIdle = false;
        this.state.setIsIdle(false);
      }
      this.startAlwaysOnPlayback();
      return;
    }

    if (!this.idleDetectionEnabled) {
      IDLE_ACTIVITY_EVENTS.forEach((event) => {
        document.addEventListener(event, this.boundIdleResetHandler, { passive: true });
      });
      this.idleDetectionEnabled = true;
    }

    this.boundIdleResetHandler();
  }

  private setupIdleDetection(): void {
    this.boundVisibilityHandler = () => {
      if (document.hidden) {
        if (this.idleTimeout) clearTimeout(this.idleTimeout);
        this.teardownPlayback('hidden');
        return;
      }

      if (this.isIdle) {
        this.isIdle = false;
        this.state.setIsIdle(false);
        if (this.isVisible) this.render();
      }

      this.applyIdleMode();
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);

    this.boundIdleResetHandler = () => {
      if (this.alwaysOn) return;
      if (this.idleTimeout) clearTimeout(this.idleTimeout);
      if (this.isIdle) {
        this.isIdle = false;
        this.state.setIsIdle(false);
        if (this.isVisible) {
          const resumeIds = this.resumeFeedAfterIdleIds;
          this.resumeFeedAfterIdleIds = [];
          for (const id of resumeIds) {
            if (WEBCAM_FEEDS.some((feed) => feed.id === id)) this.activeIframeFeedIds.add(id);
          }
          this.render();
        }
      }
      this.idleTimeout = setTimeout(() => {
        this.isIdle = true;
        this.state.setIsIdle(true);
        this.teardownPlayback('idle');
        const content = this.content;
        if (content) {
          setTrustedHtml(
            content,
            trustedHtml(
              `<div class="webcam-placeholder">${escapeHtml(t('components.webcams.pausedIdle'))}</div>`,
              'legacy direct innerHTML migration',
            ),
          );
        }
      }, ECO_IDLE_PAUSE_MS);
    };

    this.applyIdleMode();
  }

  // ── Public methods called by the React component ──────────────────────────

  public setRegionFilter(filter: RegionFilter): void {
    if (filter === this.regionFilter) return;
    trackWebcamRegionFiltered(filter);
    this.regionFilter = filter;
    this.state.setRegionFilter(filter);
    this.clearActivePlayback();
    const feeds = this.filteredFeeds;
    if (feeds.length > 0 && !feeds.includes(this.activeFeed)) {
      this.activeFeed = feeds[0]!;
      this.state.setActiveFeedId(this.activeFeed.id);
    }
    this.savePrefs();
    this.render();
  }

  public setViewMode(mode: ViewMode): void {
    if (this.forceSingleView && mode === 'grid') return;
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.state.setViewMode(mode);
    const keepActive = this.activeIframeFeedIds.has(this.activeFeed.id);
    this.activeIframeFeedIds.clear();
    if (keepActive) this.activeIframeFeedIds.add(this.activeFeed.id);
    this.savePrefs();
    if (!this.startAlwaysOnPlayback()) {
      this.render();
    }
  }

  public toggleFullscreen(): void {
    this.isFullscreen = !this.isFullscreen;
    this.state.setIsFullscreen(this.isFullscreen);
    const el = this.element;
    el?.classList.toggle('live-news-fullscreen', this.isFullscreen);
    document.body.classList.toggle('live-news-fullscreen-active', this.isFullscreen);
  }

  public switchFeedInSingleView(feed: WebcamFeed): void {
    const wasPlaying = this.activeIframeFeedIds.size > 0;
    this.activeIframeFeedIds.clear();
    this.activeFeed = feed;
    this.state.setActiveFeedId(feed.id);
    this.savePrefs();
    if ((this.alwaysOn || wasPlaying) && this.isVisible && !document.hidden) {
      this.playFeed(feed, 'single');
    } else {
      this.render();
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  mount(): void {
    this.boundEmbedMessageHandler = (e) => this.handleEmbedMessage(e);
    this.boundFullscreenEscHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isFullscreen) this.toggleFullscreen();
    };
    this.boundStopHandler = () => {
      this.resumeFeedAfterIdleIds = [];
      if (this.idleTimeout) {
        clearTimeout(this.idleTimeout);
        this.idleTimeout = null;
      }
      this.clearActivePlayback();
      if (this.isVisible && !this.isIdle && this.element?.isConnected) {
        this.render();
      }
    };
    this.boundResumeHandler = () => {
      if (!this.alwaysOn || document.hidden) return;
      this.isVisible = this.isVisible || this.isPanelVisible();
      this.startAlwaysOnPlayback();
    };

    window.addEventListener('message', this.boundEmbedMessageHandler);
    document.addEventListener('keydown', this.boundFullscreenEscHandler);
    window.addEventListener('wm:live-webcams-stop', this.boundStopHandler);
    window.addEventListener('wm:live-webcams-resume', this.boundResumeHandler);

    this.unsubscribeStreamQuality = subscribeStreamQualityChange(() => this.render());
    this.unsubscribeStreamSettings = subscribeLiveStreamsSettingsChange((alwaysOn) => {
      this.alwaysOn = alwaysOn;
      this.applyIdleMode();
      if (alwaysOn && this.isVisible && !document.hidden) {
        this.startAlwaysOnPlayback();
      }
    });

    registerLiveMediaStarter('live-webcams', this.boundPlayAllStarter);
    this.setupIntersectionObserver();
    this.setupIdleDetection();
    this.render();
  }

  destroy(): void {
    this.observer?.disconnect();
    unregisterLiveMediaStarter('live-webcams', this.boundPlayAllStarter);
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }
    document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    document.removeEventListener('keydown', this.boundFullscreenEscHandler);
    window.removeEventListener('message', this.boundEmbedMessageHandler);
    window.removeEventListener('wm:live-webcams-stop', this.boundStopHandler);
    window.removeEventListener('wm:live-webcams-resume', this.boundResumeHandler);
    IDLE_ACTIVITY_EVENTS.forEach((event) => {
      document.removeEventListener(event, this.boundIdleResetHandler);
    });
    if (this.isFullscreen) this.toggleFullscreen();
    this.unsubscribeStreamSettings?.();
    this.unsubscribeStreamSettings = null;
    this.unsubscribeStreamQuality?.();
    this.unsubscribeStreamQuality = null;
    this.destroyIframes();
  }
}
