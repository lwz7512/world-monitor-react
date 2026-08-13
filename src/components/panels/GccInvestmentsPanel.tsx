import { useState, useReducer } from 'react';
import { GULF_INVESTMENTS } from '@/config/gulf-fdi';
import type {
  GulfInvestment,
  GulfInvestmentSector,
  GulfInvestorCountry,
  GulfInvestingEntity,
  GulfInvestmentStatus,
} from '@/types';
import { toUniqueSorted } from '@/utils';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

interface InvestmentFilters {
  investingCountry: GulfInvestorCountry | 'ALL';
  sector: GulfInvestmentSector | 'ALL';
  entity: GulfInvestingEntity | 'ALL';
  status: GulfInvestmentStatus | 'ALL';
  search: string;
}

const STATUS_COLORS: Record<GulfInvestmentStatus, string> = {
  'operational':        '#22c55e',
  'under-construction': '#f59e0b',
  'announced':          '#60a5fa',
  'rumoured':           '#a78bfa',
  'cancelled':          '#ef4444',
  'divested':           '#6b7280',
};

const FLAG: Record<string, string> = { SA: '🇸🇦', UAE: '🇦🇪' };

function getSectorLabel(sector: GulfInvestmentSector): string {
  const labels: Record<GulfInvestmentSector, string> = {
    ports: t('components.investments.sectors.ports'),
    pipelines: t('components.investments.sectors.pipelines'),
    energy: t('components.investments.sectors.energy'),
    datacenters: t('components.investments.sectors.datacenters'),
    airports: t('components.investments.sectors.airports'),
    railways: t('components.investments.sectors.railways'),
    telecoms: t('components.investments.sectors.telecoms'),
    water: t('components.investments.sectors.water'),
    logistics: t('components.investments.sectors.logistics'),
    mining: t('components.investments.sectors.mining'),
    'real-estate': t('components.investments.sectors.realEstate'),
    manufacturing: t('components.investments.sectors.manufacturing'),
  };
  return labels[sector] ?? sector;
}

function formatUSD(usd?: number): string {
  if (usd === undefined) return t('components.investments.undisclosed');
  if (usd >= 100000) return `$${(usd / 1000).toFixed(0)}B`;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}B`;
  return `$${usd.toLocaleString()}M`;
}

function getFiltered(filters: InvestmentFilters, sortKey: keyof GulfInvestment, sortAsc: boolean): GulfInvestment[] {
  const { investingCountry, sector, entity, status, search } = filters;
  const q = search.toLowerCase();
  return GULF_INVESTMENTS
    .filter(inv => {
      if (investingCountry !== 'ALL' && inv.investingCountry !== investingCountry) return false;
      if (sector !== 'ALL' && inv.sector !== sector) return false;
      if (entity !== 'ALL' && inv.investingEntity !== entity) return false;
      if (status !== 'ALL' && inv.status !== status) return false;
      if (q && !inv.assetName.toLowerCase().includes(q)
             && !inv.targetCountry.toLowerCase().includes(q)
             && !inv.description.toLowerCase().includes(q)
             && !inv.investingEntity.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
}

const entities = toUniqueSorted(GULF_INVESTMENTS.map(i => i.investingEntity));
const sectors = toUniqueSorted(GULF_INVESTMENTS.map(i => i.sector));

const DEFAULT_FILTERS: InvestmentFilters = {
  investingCountry: 'ALL', sector: 'ALL', entity: 'ALL', status: 'ALL', search: '',
};

export function GccInvestmentsPanelContent() {
  const [filters, setFilters] = useState<InvestmentFilters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<keyof GulfInvestment>('assetName');
  const [sortAsc, setSortAsc] = useState(true);
  const [filtersExpanded, toggleFilters] = useReducer(v => !v, false);

  const filtered = getFiltered(filters, sortKey, sortAsc);
  const hasActiveFilter = filters.investingCountry !== 'ALL' || filters.sector !== 'ALL'
    || filters.entity !== 'ALL' || filters.status !== 'ALL';

  function handleSort(key: keyof GulfInvestment) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  function sortCls(key: keyof GulfInvestment) {
    return sortKey === key ? 'fdi-sort fdi-sort-active' : 'fdi-sort';
  }

  function sortLabel(key: keyof GulfInvestment, label: string) {
    return sortKey === key ? `${label} ${sortAsc ? '↑' : '↓'}` : label;
  }

  return (
    <div>
      <div className="fdi-search-row">
        <input
          className="fdi-search"
          type="text"
          placeholder={t('components.investments.searchPlaceholder')}
          value={filters.search}
          onInput={e => setFilters(f => ({ ...f, search: (e.target as HTMLInputElement).value }))}
        />
        <button
          className={`fdi-filter-toggle${filtersExpanded || hasActiveFilter ? ' fdi-filters-active' : ''}`}
          onClick={toggleFilters}
          title="Filters"
          aria-label="Toggle filters"
          aria-pressed={filtersExpanded}
        >
          ⚙
        </button>
      </div>
      <div className={`fdi-filters${filtersExpanded ? ' fdi-filters-open' : ''}`}>
        <select className="fdi-filter" value={filters.investingCountry} onChange={e => setFilters(f => ({ ...f, investingCountry: e.target.value as GulfInvestorCountry | 'ALL' }))}>
          <option value="ALL">🌐 {t('components.investments.allCountries')}</option>
          <option value="SA">🇸🇦 {t('components.investments.saudiArabia')}</option>
          <option value="UAE">🇦🇪 {t('components.investments.uae')}</option>
        </select>
        <select className="fdi-filter" value={filters.sector} onChange={e => setFilters(f => ({ ...f, sector: e.target.value as GulfInvestmentSector | 'ALL' }))}>
          <option value="ALL">{t('components.investments.allSectors')}</option>
          {sectors.map(s => <option key={s} value={s}>{getSectorLabel(s as GulfInvestmentSector)}</option>)}
        </select>
        <select className="fdi-filter" value={filters.entity} onChange={e => setFilters(f => ({ ...f, entity: e.target.value as GulfInvestingEntity | 'ALL' }))}>
          <option value="ALL">{t('components.investments.allEntities')}</option>
          {entities.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select className="fdi-filter" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value as GulfInvestmentStatus | 'ALL' }))}>
          <option value="ALL">{t('components.investments.allStatuses')}</option>
          <option value="operational">{t('components.investments.operational')}</option>
          <option value="under-construction">{t('components.investments.underConstruction')}</option>
          <option value="announced">{t('components.investments.announced')}</option>
          <option value="rumoured">{t('components.investments.rumoured')}</option>
          <option value="divested">{t('components.investments.divested')}</option>
        </select>
        <div className="fdi-sort-pills">
          {(['assetName', 'investmentUSD', 'targetCountry', 'yearAnnounced'] as const).map(key => {
            const labels: Record<string, string> = {
              assetName: t('components.investments.asset'),
              investmentUSD: t('components.investments.investment'),
              targetCountry: t('components.investments.country'),
              yearAnnounced: t('components.investments.year'),
            };
            return (
              <button key={key} className={sortCls(key)} onClick={() => handleSort(key)}>
                {sortLabel(key, labels[key] ?? key)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="fdi-list">
        {filtered.length === 0 ? (
          <div className="fdi-empty">{t('components.investments.noMatch')}</div>
        ) : filtered.map(inv => {
          const statusColor = STATUS_COLORS[inv.status] ?? '#6b7280';
          const flag = FLAG[inv.investingCountry] ?? '';
          const year = inv.yearAnnounced ?? inv.yearOperational ?? '—';
          return (
            <div
              key={inv.id}
              className="fdi-row"
              style={{ cursor: 'pointer' }}
              onClick={() => window.dispatchEvent(new CustomEvent('wm:gcc-investment-click', { detail: { lat: inv.lat, lon: inv.lon } }))}
            >
              <div className="fdi-row-line1">
                <span className="fdi-flag">{flag}</span>
                <span className="fdi-asset-name">{inv.assetName}</span>
                <span className="fdi-entity-sub">{inv.investingEntity}</span>
                <span className="fdi-usd">{formatUSD(inv.investmentUSD)}</span>
              </div>
              <div className="fdi-row-line2">
                <span className="fdi-country">{inv.targetCountry}</span>
                <span className="fdi-sector-badge">{getSectorLabel(inv.sector)}</span>
                <span className="fdi-status-label">
                  <span className="fdi-status-dot" style={{ background: statusColor }} />
                  {inv.status}
                </span>
                <span className="fdi-year">{year}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GccInvestmentsPanel() {
  return (
    <PanelShell
      id="gcc-investments"
      title={t('panels.gccInvestments')}
      infoTooltip={t('components.investments.infoTooltip')}
    >
      <GccInvestmentsPanelContent />
    </PanelShell>
  );
}
