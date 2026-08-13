import { useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import {
  fetchServiceStatuses,
  type ServiceStatusResult,
  type ServiceStatusSummary,
} from '@/services/infrastructure';
import { PanelShell } from '@/components/PanelShell';

type CategoryFilter = 'all' | 'cloud' | 'dev' | 'comm' | 'ai' | 'saas';

const CATEGORIES: CategoryFilter[] = ['all', 'cloud', 'dev', 'comm', 'ai', 'saas'];

function categoryLabel(cat: CategoryFilter): string {
  return t(`components.serviceStatus.categories.${cat}`) ?? cat;
}

function statusIcon(status: string): string {
  if (status === 'operational') return '●';
  if (status === 'degraded') return '◐';
  if (status === 'outage') return '○';
  return '?';
}

async function fetcher(_signal: AbortSignal) {
  return fetchServiceStatuses();
}

function Summary({ s }: { s: ServiceStatusSummary }) {
  return (
    <div className="service-status-summary">
      <div className="summary-item operational">
        <span className="summary-count">{s.operational}</span>
        <span className="summary-label">{t('components.serviceStatus.ok')}</span>
      </div>
      <div className="summary-item degraded">
        <span className="summary-count">{s.degraded}</span>
        <span className="summary-label">{t('components.serviceStatus.degraded')}</span>
      </div>
      <div className="summary-item outage">
        <span className="summary-count">{s.outage}</span>
        <span className="summary-label">{t('components.serviceStatus.outage')}</span>
      </div>
    </div>
  );
}

function ServiceRow({ svc }: { svc: ServiceStatusResult }) {
  return (
    <div className={`service-status-item ${svc.status}`}>
      <span className="status-icon">{statusIcon(svc.status)}</span>
      <span className="status-name">{svc.name}</span>
      <span className={`status-badge ${svc.status}`}>{svc.status.toUpperCase()}</span>
    </div>
  );
}

export function ServiceStatusPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, { ttlMs: 5 * 60 * 1000 });
  const [filter, setFilter] = useState<CategoryFilter>('all');

  if (loading) {
    return (
      <div className="service-status-loading">
        <div className="loading-spinner" />
        <span>{t('components.serviceStatus.checkingServices')}</span>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{t('common.failedToLoad')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const filtered = filter === 'all'
    ? data.services
    : data.services.filter(s => s.category === filter);

  const issues = filtered.filter(s => s.status !== 'operational');

  return (
    <div>
      <Summary s={data.summary} />
      <div className="service-status-filters">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            className={`status-filter-btn${filter === cat ? ' active' : ''}`}
            onClick={() => setFilter(cat)}
          >
            {categoryLabel(cat)}
          </button>
        ))}
      </div>
      <div className="service-status-list">
        {filtered.map(svc => <ServiceRow key={svc.id} svc={svc} />)}
      </div>
      {issues.length === 0 && (
        <div className="all-operational">{t('components.serviceStatus.allOperational')}</div>
      )}
    </div>
  );
}

export function ServiceStatusPanel() {
  return (
    <PanelShell
      id="service-status"
      title={t('panels.serviceStatus')}
      infoTooltip={t('components.serviceStatus.infoTooltip')}
    >
      <ServiceStatusPanelContent />
    </PanelShell>
  );
}
