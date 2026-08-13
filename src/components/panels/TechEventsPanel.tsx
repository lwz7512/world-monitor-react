import { useState, useEffect } from 'react';
import type { TechEvent, ListTechEventsResponse } from '@/generated/client/worldmonitor/research/v1/service_client';
import { createLazyClient, getRpcBaseUrl, rpcFetch } from '@/services/rpc-client';
import { getHydratedData } from '@/services/bootstrap';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { isDesktopRuntime } from '@/services/runtime';
import { ResearchServiceClient } from '@/services/generated-rpc-clients';
import type { DeductContextDetail } from '@/types';
import { PanelShell } from '@/components/PanelShell';

const getResearchClient = createLazyClient(
  () => new ResearchServiceClient(getRpcBaseUrl(), { fetch: rpcFetch }),
);

type ViewMode = 'upcoming' | 'conferences' | 'earnings' | 'all';

const TYPE_ICONS: Record<string, string> = {
  conference: '🎤', earnings: '📊', ipo: '🔔', other: '📌',
};
const TYPE_CLASSES: Record<string, string> = {
  conference: 'type-conference', earnings: 'type-earnings', ipo: 'type-ipo', other: 'type-other',
};

function getFilteredEvents(events: TechEvent[], mode: ViewMode): TechEvent[] {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  switch (mode) {
    case 'upcoming': return events.filter(e => { const s = new Date(e.startDate); return s >= now && s <= in30; }).slice(0, 20);
    case 'conferences': return events.filter(e => e.type === 'conference' && new Date(e.startDate) >= now).slice(0, 30);
    case 'earnings': return events.filter(e => e.type === 'earnings' && new Date(e.startDate) >= now).slice(0, 30);
    case 'all': return events.filter(e => new Date(e.startDate) >= now).slice(0, 50);
    default: return [];
  }
}

function EventItem({ event }: { event: TechEvent }) {
  const startDate = new Date(event.startDate);
  const endDate = new Date(event.endDate);
  const now = new Date();

  const isToday = startDate.toDateString() === now.toDateString();
  const isSoon = !isToday && startDate <= new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const isThisWeek = startDate <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endDateStr =
    endDate > startDate && endDate.toDateString() !== startDate.toDateString()
      ? ` - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : '';

  const cls = ['tech-event', TYPE_CLASSES[event.type], isToday ? 'is-today' : '', isSoon ? 'is-soon' : '', isThisWeek ? 'is-this-week' : ''].filter(Boolean).join(' ');
  const safeUrl = sanitizeUrl(event.url || '');
  const desktop = isDesktopRuntime();

  function handleMapClick() {
    window.dispatchEvent(
      new CustomEvent<{ lat: number; lng: number; zoom: number }>('wm:tech-event-click', {
        detail: { lat: event.coords!.lat, lng: event.coords!.lng, zoom: 10 },
      }),
    );
  }

  function handleDeductClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const detail: DeductContextDetail = {
      query: `What is the expected impact of the tech event: ${event.title}?`,
      geoContext: `Event details: ${event.title} (${event.type}) taking place from ${dateStr}${endDateStr}. Location: ${event.location || 'Unknown/Virtual'}.`,
      autoSubmit: true,
    };
    document.dispatchEvent(new CustomEvent('wm:deduct-context', { detail }));
  }

  return (
    <div className={cls}>
      <div className="event-date">
        <span className="event-month">{startDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
        <span className="event-day">{startDate.getDate()}</span>
        {isToday && <span className="today-badge">{t('components.techEvents.today')}</span>}
        {isSoon && !isToday && <span className="soon-badge">{t('components.techEvents.soon')}</span>}
      </div>
      <div className="event-content">
        <div className="event-header">
          <span className="event-icon">{TYPE_ICONS[event.type] ?? '📌'}</span>
          <span className="event-title">{event.title}</span>
          {safeUrl && <a href={safeUrl} target="_blank" rel="noopener" className="event-url" title={t('components.techEvents.moreInfo')}>↗</a>}
        </div>
        <div className="event-meta">
          <span className="event-dates">{dateStr}{endDateStr}</span>
          {event.location && <span className="event-location">{event.location}</span>}
          {desktop && (
            <button
              className="event-deduce-link"
              title="Deduce Situation with AI"
              style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7, fontSize: '1.1em', transition: 'opacity 0.2s', marginLeft: 'auto', paddingRight: '4px' }}
              onClick={handleDeductClick}
            >🧠</button>
          )}
          {event.coords && !event.coords.virtual && (
            <button className="event-map-link" title={t('components.techEvents.showOnMap')} onClick={handleMapClick}>📍</button>
          )}
        </div>
      </div>
    </div>
  );
}

export function TechEventsPanelContent() {
  const [events, setEvents] = useState<TechEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('upcoming');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);

      const hydrated = getHydratedData('techEvents') as ListTechEventsResponse | undefined;
      if (hydrated?.events?.length) {
        if (!cancelled) { setEvents(hydrated.events); setLoading(false); }
        return;
      }

      try {
        const data = await getResearchClient().listTechEvents({ type: '', mappable: false, days: 180, limit: 100 });
        if (cancelled) return;
        if (!data.success) throw new Error(data.error || 'Unknown error');
        setEvents(data.events);
        setError(null);
      } catch {
        if (!cancelled) setError(t('common.failedToLoad'));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="tech-events-loading">
        <div className="loading-spinner" />
        <span>{t('components.techEvents.loading')}</span>
      </div>
    );
  }

  if (error) return <div className="panel-error">{error}</div>;

  const filtered = getFilteredEvents(events, viewMode);
  const upcomingConfs = events.filter(e => e.type === 'conference' && new Date(e.startDate) >= new Date());
  const mappableCount = upcomingConfs.filter(e => e.coords && !e.coords.virtual).length;

  const tabs: Array<[ViewMode, string]> = [
    ['upcoming', t('components.techEvents.upcoming')],
    ['conferences', t('components.techEvents.conferences')],
    ['earnings', t('components.techEvents.earnings')],
    ['all', t('components.techEvents.all')],
  ];

  return (
    <div className="tech-events-panel">
      <div className="panel-tabs">
        {tabs.map(([view, label]) => (
          <button key={view} className={`panel-tab${viewMode === view ? ' active' : ''}`} onClick={() => setViewMode(view)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tech-events-stats">
        <span className="stat">📅 {t('components.techEvents.conferencesCount', { count: String(upcomingConfs.length) })}</span>
        <span className="stat">📍 {t('components.techEvents.onMap', { count: String(mappableCount) })}</span>
        <a href="https://www.techmeme.com/events" target="_blank" rel="noopener" className="source-link">{t('components.techEvents.techmemeEvents')}</a>
      </div>
      <div className="tech-events-list">
        {filtered.length > 0
          ? filtered.map((e, i) => <EventItem key={e.id || i} event={e} />)
          : <div className="empty-state">{t('components.techEvents.noEvents')}</div>}
      </div>
    </div>
  );
}

export function TechEventsPanel() {
  return (
    <PanelShell
      id="events"
      title={t('panels.events')}
      infoTooltip={t('components.techEvents.infoTooltip')}
      className="panel-tall"
    >
      <TechEventsPanelContent />
    </PanelShell>
  );
}
