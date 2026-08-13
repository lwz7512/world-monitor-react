import { useState, useEffect } from 'react';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { usePanelData } from '@/hooks/usePanelData';
import { hasPremiumAccess } from '@/services/panel-gating';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { isDesktopRuntime } from '@/services/runtime';
import { PanelShell } from '@/components/PanelShell';
import {
  TELEGRAM_TOPICS,
  fetchTelegramFeed,
  formatTelegramTime,
  type TelegramItem,
  type TelegramFeedResponse,
} from '@/services/telegram-intel';

const LIVE_THRESHOLD_MS = 600_000;

async function fetcher(_signal: AbortSignal): Promise<TelegramFeedResponse> {
  return fetchTelegramFeed(50);
}

function TelegramItemCard({ item }: { item: TelegramItem }) {
  const timeAgo = formatTelegramTime(item.ts);
  const itemDate = new Date(item.ts).getTime();
  const isLive = !Number.isNaN(itemDate) && (Date.now() - itemDate) < LIVE_THRESHOLD_MS;

  return (
    <div className={`telegram-intel-item${isLive ? ' is-live' : ''}`}>
      <div className="telegram-intel-item-header">
        <div className="telegram-intel-channel-wrapper">
          <span className="telegram-intel-channel">{item.channelTitle || item.channel}</span>
          {isLive && <span className="live-indicator">{t('components.telegramIntel.live')}</span>}
        </div>
        <div className="telegram-intel-meta">
          <span className="telegram-intel-topic">{item.topic}</span>
          <span className="telegram-intel-time">{timeAgo}</span>
        </div>
      </div>
      <div
        className="telegram-intel-text"
        dangerouslySetInnerHTML={{
          __html: (item.text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/\n/g, '<br>'),
        }}
      />
      {item.mediaUrls && item.mediaUrls.length > 0 && (
        <div className="telegram-intel-media-grid">
          {item.mediaUrls.map((url, i) => {
            const safeUrl = sanitizeUrl(url);
            const isVideo = /\.(mp4|webm|mov)(\?.*)?$/i.test(url);
            return isVideo ? (
              <video
                key={i}
                className="telegram-intel-video"
                src={safeUrl}
                controls
                preload="metadata"
                playsInline
              />
            ) : (
              <img
                key={i}
                className="telegram-intel-image"
                src={safeUrl}
                loading="lazy"
                onClick={() => window.open(safeUrl, '_blank', 'noopener,noreferrer')}
                alt=""
              />
            );
          })}
        </div>
      )}
      <div className="telegram-intel-item-actions">
        <a
          href={sanitizeUrl(item.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="telegram-follow-btn"
        >
          {t('components.telegramIntel.viewSource')}
        </a>
      </div>
    </div>
  );
}

export function TelegramIntelPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, { ttlMs: 5 * 60 * 1000 });
  const [activeTopic, setActiveTopic] = useState('all');

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
        <div className="panel-loading-text">{t('components.telegramIntel.loading') ?? 'Loading…'}</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.failedToLoad')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  if (!data.enabled) {
    return (
      <div className="empty-state error">{t('components.telegramIntel.disabled')}</div>
    );
  }

  const filtered = activeTopic === 'all'
    ? data.items
    : data.items.filter(item => item.topic === activeTopic);

  return (
    <div className="telegram-intel-panel">
      <div className="panel-tabs">
        {TELEGRAM_TOPICS.map(topic => (
          <button
            key={topic.id}
            className={`panel-tab${activeTopic === topic.id ? ' active' : ''}`}
            data-topic-id={topic.id}
            onClick={() => setActiveTopic(topic.id)}
          >
            {t(topic.labelKey)}
          </button>
        ))}
      </div>
      {filtered.length === 0
        ? <div className="empty-state">{t('components.telegramIntel.empty') ?? 'No messages'}</div>
        : (
          <div className="telegram-intel-items">
            {filtered.map((item, i) => <TelegramItemCard key={item.url || i} item={item} />)}
          </div>
        )
      }
    </div>
  );
}

function useDesktopGate() {
  const [authState, setAuthState] = useState(getAuthState);
  useEffect(() => subscribeAuthState(setAuthState), []);
  return isDesktopRuntime() && !hasPremiumAccess(authState);
}

export function TelegramIntelPanel() {
  const locked = useDesktopGate();
  return (
    <PanelShell
      id="telegram-intel"
      title={t('panels.telegramIntel')}
      showCount
      defaultRowSpan={2}
      infoTooltip={t('components.telegramIntel.infoTooltip')}
      locked={locked}
      lockedFeatures={locked ? [t('premium.features.telegramIntel1'), t('premium.features.telegramIntel2')] : undefined}
    >
      <TelegramIntelPanelContent />
    </PanelShell>
  );
}
