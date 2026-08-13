import { useState, useCallback, useEffect } from 'react';
import { t } from '@/services/i18n';
import type { Monitor, NewsItem } from '@/types';
import { MONITOR_COLORS, STORAGE_KEYS } from '@/config';
import { generateId, formatTime, getCSSColor } from '@/utils';
import { sanitizeUrl } from '@/utils/sanitize';
import { getMonitorNews, subscribeMonitorNews } from '@/services/monitor-news-store';
import { subscribeMonitorItems } from '@/services/monitors-store';
import { loadFromStorage } from '@/utils';
import { PanelShell } from '@/components/PanelShell';

// ── Match logic (pure) ────────────────────────────────────────────────────────

function matchNews(monitors: Monitor[], news: NewsItem[]): NewsItem[] {
  const matched: NewsItem[] = [];
  for (const item of news) {
    for (const monitor of monitors) {
      const searchText =
        `${item.title} ${(item as unknown as { description?: string }).description ?? ''}`.toLowerCase();
      const hit = monitor.keywords.some((kw) => {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(searchText);
      });
      if (hit) matched.push({ ...item, monitorColor: monitor.color });
    }
  }
  const seen = new Set<string>();
  return matched.filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}

// ── Main panel content ────────────────────────────────────────────────────────

export function MonitorPanelContent() {
  const [monitors, setMonitors] = useState<Monitor[]>(() =>
    loadFromStorage<Monitor[]>(STORAGE_KEYS.monitors, []),
  );
  const [inputValue, setInputValue] = useState('');
  const [news, setNews] = useState<NewsItem[]>(getMonitorNews);

  useEffect(() => subscribeMonitorNews(setNews), []);
  useEffect(
    () =>
      subscribeMonitorItems((incoming) => {
        setMonitors(incoming);
      }),
    [],
  );

  const addMonitor = useCallback(() => {
    const keywords = inputValue.trim();
    if (!keywords) return;
    const monitor: Monitor = {
      id: generateId(),
      keywords: keywords.split(',').map((k) => k.trim().toLowerCase()),
      color:
        MONITOR_COLORS[monitors.length % MONITOR_COLORS.length] ?? getCSSColor('--status-live'),
    };
    const next = [...monitors, monitor];
    setMonitors(next);
    setInputValue('');
    window.dispatchEvent(new CustomEvent('wm:monitors-changed', { detail: { monitors: next } }));
  }, [inputValue, monitors]);

  const removeMonitor = useCallback(
    (id: string) => {
      const next = monitors.filter((m) => m.id !== id);
      setMonitors(next);
      window.dispatchEvent(new CustomEvent('wm:monitors-changed', { detail: { monitors: next } }));
    },
    [monitors],
  );

  const matched = matchNews(monitors, news);
  const unique = matched.slice(0, 10);

  return (
    <>
      <div className="monitor-input-container">
        <input
          type="text"
          className="monitor-input"
          id="monitorKeywords"
          placeholder={t('components.monitor.placeholder')}
          value={inputValue}
          onChange={(e) => setInputValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addMonitor();
          }}
        />
        <button className="monitor-add-btn" id="addMonitorBtn" onClick={addMonitor}>
          {t('components.monitor.add')}
        </button>
      </div>

      <div id="monitorsList">
        {monitors.map((m) => (
          <span key={m.id} className="monitor-tag">
            <span className="monitor-tag-color" style={{ background: m.color }} />
            {m.keywords.join(', ')}
            <span className="monitor-tag-remove" onClick={() => removeMonitor(m.id)}>
              ×
            </span>
          </span>
        ))}
      </div>

      <div id="monitorsResults">
        {monitors.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 12 }}>
            {t('components.monitor.addKeywords')}
          </div>
        ) : news.length === 0 ? null : unique.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 12 }}>
            {t('components.monitor.noMatches', { count: String(news.length) })}
          </div>
        ) : (
          <>
            <div style={{ color: 'var(--text-dim)', fontSize: 10, margin: '12px 0 8px' }}>
              {matched.length > 10
                ? t('components.monitor.showingMatches', {
                    count: '10',
                    total: String(matched.length),
                  })
                : `${matched.length} ${matched.length === 1 ? t('components.monitor.match') : t('components.monitor.matches')}`}
            </div>
            {unique.map((item, i) => (
              <div
                key={`${item.link}-${i}`}
                className="item"
                style={{
                  borderLeft: `2px solid ${item.monitorColor ?? ''}`,
                  paddingLeft: 8,
                  marginLeft: -8,
                }}
              >
                <div className="item-source">{item.source}</div>
                <a
                  className="item-title"
                  href={sanitizeUrl(item.link)}
                  target="_blank"
                  rel="noopener"
                >
                  {item.title}
                </a>
                <div className="item-time">{formatTime(item.pubDate)}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

export function MonitorPanel() {
  return (
    <PanelShell
      id="monitors"
      title={t('panels.monitors')}
      infoTooltip={t('components.monitors.infoTooltip')}
    >
      <MonitorPanelContent />
    </PanelShell>
  );
}
