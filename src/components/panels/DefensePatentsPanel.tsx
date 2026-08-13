import { useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { t, getLocale } from '@/services/i18n';
import { getRpcBaseUrl } from '@/services/rpc-client';
import { sanitizeUrl } from '@/utils/sanitize';
import type { DefensePatentFiling } from '@/generated/client/worldmonitor/military/v1/service_client';
import { MilitaryServiceClient } from '@/services/generated-rpc-clients';
import { PanelShell } from '@/components/PanelShell';

type ViewMode = 'all' | 'H04B' | 'H01L' | 'F42B' | 'G06N' | 'C12N';

const CPC_CODES: ViewMode[] = ['H04B', 'H01L', 'F42B', 'G06N', 'C12N'];

const CPC_ICONS: Record<string, string> = {
  H04B: '📡',
  H01L: '💾',
  F42B: '💣',
  G06N: '🤖',
  C12N: '🧬',
};

let _client: InstanceType<typeof MilitaryServiceClient> | null = null;
function getClient() {
  if (!_client) {
    _client = new MilitaryServiceClient(getRpcBaseUrl(), { fetch: (...args) => globalThis.fetch(...args) });
  }
  return _client;
}

function cpcLabel(code: string): string {
  switch (code) {
    case 'H04B': return t('components.defensePatents.cpcLabels.H04B') ?? code;
    case 'H01L': return t('components.defensePatents.cpcLabels.H01L') ?? code;
    case 'F42B': return t('components.defensePatents.cpcLabels.F42B') ?? code;
    case 'G06N': return t('components.defensePatents.cpcLabels.G06N') ?? code;
    case 'C12N': return t('components.defensePatents.cpcLabels.C12N') ?? code;
    default: return code;
  }
}

type PatentData = { patents: DefensePatentFiling[]; total: number };

async function fetcher(_signal: AbortSignal): Promise<PatentData> {
  return getClient().listDefensePatents({ cpcCode: '', assignee: '', limit: 100 });
}

function PatentRow({ p }: { p: DefensePatentFiling }) {
  const date = p.date
    ? new Date(p.date).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  const icon = CPC_ICONS[p.cpcCode] ?? '🔬';
  const safeUrl = sanitizeUrl(p.url || '');

  return (
    <div className="defense-patent-row">
      <div className="patent-icon" title={p.cpcDesc || p.cpcCode}>{icon}</div>
      <div className="patent-body">
        <div className="patent-header">
          <span className="patent-assignee">{p.assignee}</span>
          {safeUrl && (
            <a href={safeUrl} target="_blank" rel="noopener" className="patent-link" title={t('components.defensePatents.viewOnUspto') ?? ''}>↗</a>
          )}
        </div>
        <div className="patent-title">{p.title}</div>
        <div className="patent-meta">
          <span className={`patent-cpc cpc-${p.cpcCode}`}>{p.cpcDesc || p.cpcCode}</span>
          {date && <span className="patent-date">{date}</span>}
          {p.patentId && <span className="patent-id">{p.patentId}</span>}
        </div>
      </div>
    </div>
  );
}

export function DefensePatentsPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, { ttlMs: 6 * 60 * 60 * 1000 });
  const [view, setView] = useState<ViewMode>('all');

  if (loading) {
    return (
      <div className="defense-patents-loading">
        <div className="loading-spinner" />
        <span>{t('components.defensePatents.loading') ?? 'Loading…'}</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('components.defensePatents.error')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const tabs: [ViewMode, string][] = [
    ['all', t('components.defensePatents.tabs.all') ?? 'All'],
    ...CPC_CODES.map((code): [ViewMode, string] => [code, cpcLabel(code)]),
  ];

  const filtered = view === 'all'
    ? data.patents.slice(0, 50)
    : data.patents.filter(p => p.cpcCode === view).slice(0, 30);

  return (
    <div className="defense-patents-panel">
      <div className="panel-tabs">
        {tabs.map(([mode, label]) => (
          <button
            key={mode}
            className={`panel-tab${view === mode ? ' active' : ''}`}
            onClick={() => setView(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="defense-patents-list">
        {filtered.length > 0
          ? filtered.map(p => <PatentRow key={p.patentId || p.title} p={p} />)
          : <div className="empty-state">{t('components.defensePatents.empty') ?? 'No patents found'}</div>
        }
      </div>
    </div>
  );
}

export function DefensePatentsPanel() {
  return (
    <PanelShell
      id="defense-patents"
      title={t('components.defensePatents.title')}
      infoTooltip={t('components.defensePatents.infoTooltip')}
    >
      <DefensePatentsPanelContent />
    </PanelShell>
  );
}
