import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { safeUrlAttr } from '@/utils/sanitize';
import { createLazyClient, getRpcBaseUrl, rpcFetch } from '@/services/rpc-client';
import { ClimateServiceClient } from '@/services/generated-rpc-clients';
import type { ListClimateNewsResponse, ClimateNewsItem } from '@/generated/client/worldmonitor/climate/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

const getClient = createLazyClient(() => new ClimateServiceClient(getRpcBaseUrl(), { fetch: rpcFetch }));

async function fetcher(_signal: AbortSignal): Promise<ListClimateNewsResponse> {
  const data = await getClient().listClimateNews({});
  if (!data.items?.length) throw new Error(t('components.climateNews.loadError') ?? 'No climate news');
  return data;
}

function formatTimeAgo(epochMs: number): string {
  const mins = Math.floor((Date.now() - epochMs) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? '1d ago' : `${days}d ago`;
}

function truncate(text: string, max = 120): string {
  if (!text || text.length <= max) return text ?? '';
  return text.slice(0, max).replace(/\s+\S*$/, '') + '...';
}

function NewsCard({ item }: { item: ClimateNewsItem }) {
  const timeAgo = item.publishedAt ? formatTimeAgo(item.publishedAt) : '';
  const summary = truncate(item.summary);
  const url = safeUrlAttr(item.url).toString();

  const inner = (
    <>
      <div className="climate-news-card__header">
        <span className="climate-news-card__source">{item.sourceName}</span>
        <span className="climate-news-card__time">{timeAgo}</span>
      </div>
      <div className="climate-news-card__title">{item.title}</div>
      {summary && <div className="climate-news-card__summary">{summary}</div>}
    </>
  );

  if (!url) return <div className="climate-news-card">{inner}</div>;
  return <a className="climate-news-card" href={url} target="_blank" rel="noopener noreferrer">{inner}</a>;
}

export function ClimateNewsPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'climateNews',
    ttlMs: 5 * 60 * 1000,
  });

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
      </div>
    );
  }

  if (error || !data?.items?.length) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('components.climateNews.loadError')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div className="climate-news-list">
      {data.items.map((item, i) => <NewsCard key={item.url || i} item={item} />)}
    </div>
  );
}

export function ClimateNewsPanel() {
  return (
    <PanelShell
      id="climate-news"
      title={t('panels.climateNews')}
      infoTooltip={t('components.climateNews.infoTooltip')}
    >
      <ClimateNewsPanelContent />
    </PanelShell>
  );
}
