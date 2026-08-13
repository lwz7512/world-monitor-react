import { useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { EconomicServiceClient } from '@/services/generated-rpc-clients';
import { getRpcBaseUrl } from '@/services/rpc-client';
import { getHydratedData } from '@/services/bootstrap';
import { sanitizeUrl } from '@/utils/sanitize';
import type { GetEnergyCrisisPoliciesResponse, EnergyCrisisPolicy } from '@/generated/client/worldmonitor/economic/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

const CATEGORY_LABELS: Record<string, string> = {
  conservation: 'Energy Conservation',
  consumer_support: 'Consumer Support',
};

const SECTOR_LABELS: Record<string, string> = {
  transport: 'Transport',
  buildings: 'Buildings',
  industry: 'Industry',
  electricity: 'Electricity',
  agriculture: 'Agriculture',
  general: 'General',
};

const STATUS_CLASS: Record<string, string> = {
  active: 'ecp-status-active',
  planned: 'ecp-status-planned',
  ended: 'ecp-status-ended',
};

let client: InstanceType<typeof EconomicServiceClient> | null = null;
function getClient(): InstanceType<typeof EconomicServiceClient> {
  if (!client) client = new EconomicServiceClient(getRpcBaseUrl(), { fetch: (...args) => globalThis.fetch(...args) });
  return client;
}

async function fetcher(_signal: AbortSignal): Promise<GetEnergyCrisisPoliciesResponse> {
  const hydrated = getHydratedData('energyCrisisPolicies') as GetEnergyCrisisPoliciesResponse | undefined;
  if (hydrated?.policies?.length) return hydrated;
  return getClient().getEnergyCrisisPolicies({ countryCode: '', category: '' });
}

type FilterMode = 'all' | 'conservation' | 'consumer_support';

function PolicyRow({ p }: { p: EnergyCrisisPolicy }) {
  const categoryLabel = CATEGORY_LABELS[p.category] || p.category;
  const sectorLabel = SECTOR_LABELS[p.sector] || p.sector;
  const statusClass = STATUS_CLASS[p.status] || '';
  const categoryClass = p.category === 'conservation' ? 'ecp-cat-conservation' : 'ecp-cat-support';
  return (
    <div className="ecp-policy-row">
      <div className="ecp-policy-header">
        <span className="ecp-country">{p.country}</span>
        <span className={`ecp-pill ${categoryClass}`}>{categoryLabel}</span>
        <span className="ecp-pill ecp-pill-sector">{sectorLabel}</span>
        <span className={`ecp-pill ${statusClass}`}>{p.status}</span>
      </div>
      <div className="ecp-measure">{p.measure}</div>
      <div className="ecp-date">{p.dateAnnounced}</div>
    </div>
  );
}

export function EnergyCrisisPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'energyCrisisPolicies',
    ttlMs: 6 * 60 * 60 * 1000,
  });
  const [filter, setFilter] = useState<FilterMode>('all');

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
        <div className="panel-loading-text">Loading energy crisis policies...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? 'Energy crisis data unavailable'}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>Retry</button>
      </div>
    );
  }

  if (!data.policies?.length) {
    return <div className="panel-empty">No energy crisis policies tracked.</div>;
  }

  const policies = data.policies;
  const conservationCount = policies.filter(p => p.category === 'conservation').length;
  const supportCount = policies.filter(p => p.category === 'consumer_support').length;
  const countryCount = new Set(policies.map(p => p.countryCode)).size;

  const filtered = filter === 'all' ? policies : policies.filter(p => p.category === filter);

  const sourceUrl = sanitizeUrl(data.sourceUrl || 'https://www.iea.org/data-and-statistics/data-tools/2026-energy-crisis-policy-response-tracker') || '#';
  const footer = [
    data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleDateString()}` : '',
    'Source: IEA',
  ].filter(Boolean).join(' · ');

  return (
    <div className="ecp-container">
      <div className="ecp-summary">
        <div className="ecp-summary-card">
          <span className="ecp-summary-value">{countryCount}</span>
          <span className="ecp-summary-label">Countries</span>
        </div>
        <div className="ecp-summary-card ecp-summary-conservation">
          <span className="ecp-summary-value">{conservationCount}</span>
          <span className="ecp-summary-label">Conservation</span>
        </div>
        <div className="ecp-summary-card ecp-summary-support">
          <span className="ecp-summary-value">{supportCount}</span>
          <span className="ecp-summary-label">Consumer Support</span>
        </div>
      </div>

      <div className="ecp-filters">
        {(['all', 'conservation', 'consumer_support'] as FilterMode[]).map(f => (
          <button
            key={f}
            className={`ecp-filter-btn${filter === f ? ' ecp-filter-active' : ''}`}
            data-filter={f}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'conservation' ? 'Conservation' : 'Consumer Support'}
          </button>
        ))}
      </div>

      <div className="ecp-policy-list">
        {filtered.map((p, i) => <PolicyRow key={`${p.countryCode}-${p.sector}-${i}`} p={p} />)}
      </div>

      <div className="ecp-footer">
        <span>{footer}</span>
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="ecp-source-link">IEA Tracker ↗</a>
      </div>
    </div>
  );
}

export function EnergyCrisisPanel() {
  return (
    <PanelShell
      id="energy-crisis"
      title="Energy Crisis Tracker"
      infoTooltip="IEA 2026 Energy Crisis Policy Response Tracker."
      defaultRowSpan={2}
    >
      <EnergyCrisisPanelContent />
    </PanelShell>
  );
}
