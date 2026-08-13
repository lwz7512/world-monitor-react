import { useState, useEffect, useCallback } from 'react';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { sparkline } from '@/utils/sparkline';
import {
  fetchConsumerPriceOverview,
  fetchConsumerPriceCategories,
  fetchConsumerPriceMovers,
  fetchRetailerPriceSpreads,
  fetchConsumerPriceFreshness,
  fetchAllMarketsOverview,
  MARKETS,
  SINGLE_MARKETS,
  DEFAULT_MARKET,
  DEFAULT_BASKET,
  type GetConsumerPriceOverviewResponse,
  type ListConsumerPriceCategoriesResponse,
  type ListConsumerPriceMoversResponse,
  type ListRetailerPriceSpreadsResponse,
  type GetConsumerPriceFreshnessResponse,
  type CategorySnapshot,
  type PriceMover,
  type RetailerSpread,
} from '@/services/consumer-prices';
import { getAllCountriesInflation, type CountryInflationRow } from '@/services/imf-country-data';
import { PanelShell } from '@/components/PanelShell';

type TabId = 'overview' | 'categories' | 'movers' | 'spread' | 'health' | 'world';
const TAB_IDS: readonly TabId[] = ['overview', 'categories', 'movers', 'spread', 'health', 'world'];

const SETTINGS_KEY = 'wm-consumer-prices-v1';
const CHANGE_EVENT = 'wm-consumer-prices-settings-changed';
const OPEN_TAB_EVENT = 'wm-consumer-prices-open-tab';

interface PanelSettings {
  market: string;
  basket: string;
  range: '7d' | '30d' | '90d';
  tab: TabId;
  categoryFilter: string | null;
}

const DEFAULT_SETTINGS: PanelSettings = {
  market: DEFAULT_MARKET,
  basket: DEFAULT_BASKET,
  range: '30d',
  tab: 'overview',
  categoryFilter: null,
};

function loadSettings(): PanelSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: PanelSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: s }));
  } catch {}
}

function pctBadge(val: number | null | undefined, invertColor = false): string {
  if (val == null || val === 0) return '<span class="cp-badge cp-badge--neutral">—</span>';
  const cls = invertColor
    ? val > 0 ? 'cp-badge--red' : 'cp-badge--green'
    : val > 0 ? 'cp-badge--green' : 'cp-badge--red';
  const sign = val > 0 ? '+' : '';
  return `<span class="cp-badge ${cls}">${sign}${val.toFixed(1)}%</span>`;
}

function pricePressureBadge(wowPct: number): string {
  if (Math.abs(wowPct) < 0.5) return '<span class="cp-pressure cp-pressure--steady">Stable</span>';
  if (wowPct >= 2) return '<span class="cp-pressure cp-pressure--stress">Rising</span>';
  if (wowPct > 0.5) return '<span class="cp-pressure cp-pressure--watch">Mild Rise</span>';
  return '<span class="cp-pressure cp-pressure--green">Easing</span>';
}

function freshnessLabel(min: number | null): string {
  if (min == null || min === 0) return 'Unknown';
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / 1440)}d ago`;
}

function freshnessClass(min: number | null): string {
  if (min == null) return 'cp-fresh--unknown';
  if (min <= 60) return 'cp-fresh--ok';
  if (min <= 240) return 'cp-fresh--warn';
  return 'cp-fresh--stale';
}

function inflationSeverityClass(pct: number | null): string {
  if (pct == null) return 'cp-infl--unknown';
  if (pct >= 10) return 'cp-infl--high';
  if (pct >= 5) return 'cp-infl--warn';
  if (pct < 0) return 'cp-infl--deflation';
  return 'cp-infl--ok';
}

function fmtInflation(pct: number | null): string {
  if (pct == null) return '—';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function renderCategoryMini(c: CategorySnapshot): string {
  const spark = c.sparkline?.length ? sparkline(c.sparkline, 'var(--accent)', 40, 16) : '';
  return `<div class="cp-cat-mini-row" data-category="${escapeHtml(c.slug)}">
    <span class="cp-cat-name">${escapeHtml(c.name)}</span>
    <span class="cp-cat-spark">${spark}</span>
    ${pctBadge(c.momPct, true)}
  </div>`;
}

function renderOverviewHtml(d: GetConsumerPriceOverviewResponse): string {
  if (!d.asOf || d.asOf === '0') return '<div class="cp-empty-state">No price data available yet</div>';
  return `<div class="cp-overview-grid">
    <div class="cp-stat-card">
      <div class="cp-stat-label">Essentials Basket</div>
      <div class="cp-stat-value">${d.essentialsIndex > 0 ? d.essentialsIndex.toFixed(1) : '—'}</div>
      <div class="cp-stat-sub">Index (base 100)</div>
    </div>
    <div class="cp-stat-card">
      <div class="cp-stat-label">Value Basket</div>
      <div class="cp-stat-value">${d.valueBasketIndex > 0 ? d.valueBasketIndex.toFixed(1) : '—'}</div>
      <div class="cp-stat-sub">Index (base 100)</div>
    </div>
    <div class="cp-stat-card">
      <div class="cp-stat-label">Week-over-Week</div>
      <div class="cp-stat-value">${pctBadge(d.wowPct, true)}</div>
      <div class="cp-stat-sub">${pricePressureBadge(d.wowPct)}</div>
    </div>
    <div class="cp-stat-card">
      <div class="cp-stat-label">Month-over-Month</div>
      <div class="cp-stat-value">${pctBadge(d.momPct, true)}</div>
    </div>
    <div class="cp-stat-card">
      <div class="cp-stat-label">Retailer Spread</div>
      <div class="cp-stat-value">${d.retailerSpreadPct > 0 ? `${d.retailerSpreadPct.toFixed(1)}%` : '—'}</div>
      <div class="cp-stat-sub">Cheapest vs most exp.</div>
    </div>
    <div class="cp-stat-card">
      <div class="cp-stat-label">Coverage</div>
      <div class="cp-stat-value">${d.coveragePct > 0 ? `${d.coveragePct.toFixed(0)}%` : '—'}</div>
      <div class="cp-stat-sub ${freshnessClass(d.freshnessLagMin)}">${freshnessLabel(d.freshnessLagMin)}</div>
    </div>
  </div>
  ${d.topCategories?.length ? `<div class="cp-section-label">Top Category Movers</div><div class="cp-category-mini">${d.topCategories.slice(0, 5).map(renderCategoryMini).join('')}</div>` : ''}`;
}

function renderCategoriesHtml(d: ListConsumerPriceCategoriesResponse): string {
  const cats = d.categories;
  if (!cats?.length) return '<div class="cp-empty-state">No category data yet</div>';
  return `<table class="cp-table">
    <thead><tr><th>Category</th><th>WoW</th><th>MoM</th><th>Trend</th><th>Coverage</th></tr></thead>
    <tbody>${cats.map((c) => `<tr class="cp-cat-row" data-category="${escapeHtml(c.slug)}">
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>${pctBadge(c.wowPct, true)}</td>
      <td>${pctBadge(c.momPct, true)}</td>
      <td>${c.sparkline?.length ? sparkline(c.sparkline, 'var(--accent)', 48, 18) : '—'}</td>
      <td>${c.coveragePct > 0 ? `${c.coveragePct.toFixed(0)}%` : '—'}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderMoverRow(m: PriceMover, dir: 'up' | 'down'): string {
  const sign = m.changePct > 0 ? '+' : '';
  return `<div class="cp-mover-row cp-mover-row--${dir}">
    <div class="cp-mover-title">${escapeHtml(m.title)}</div>
    <div class="cp-mover-meta">
      <span class="cp-mover-cat">${escapeHtml(m.category)}</span>
      <span class="cp-mover-retailer">${escapeHtml(m.retailerSlug)}</span>
    </div>
    <div class="cp-mover-pct">${sign}${m.changePct.toFixed(1)}%</div>
  </div>`;
}

function renderMoversHtml(d: ListConsumerPriceMoversResponse, categoryFilter: string | null): string {
  const filterFn = (m: PriceMover) => !categoryFilter || m.category === categoryFilter;
  const risers = (d.risers ?? []).filter(filterFn).slice(0, 8);
  const fallers = (d.fallers ?? []).filter(filterFn).slice(0, 8);
  if (!risers.length && !fallers.length) return '<div class="cp-empty-state">No movers for this selection</div>';
  return `<div class="cp-movers-grid">
    <div class="cp-movers-col">
      <div class="cp-col-header cp-col-header--up">Rising</div>
      ${risers.map((m) => renderMoverRow(m, 'up')).join('') || '<div class="cp-empty-col">None</div>'}
    </div>
    <div class="cp-movers-col">
      <div class="cp-col-header cp-col-header--down">Falling</div>
      ${fallers.map((m) => renderMoverRow(m, 'down')).join('') || '<div class="cp-empty-col">None</div>'}
    </div>
  </div>`;
}

function renderSpreadRow(r: RetailerSpread, rank: number, currency: string): string {
  const isCheapest = rank === 0;
  return `<div class="cp-spread-row ${isCheapest ? 'cp-spread-row--cheapest' : ''}">
    <div class="cp-spread-rank">#${rank + 1}</div>
    <div class="cp-spread-name">${escapeHtml(r.name)}</div>
    <div class="cp-spread-total">${currency} ${r.basketTotal.toFixed(2)}</div>
    <div class="cp-spread-delta">${isCheapest ? '<span class="cp-badge cp-badge--green">Cheapest</span>' : pctBadge(r.deltaVsCheapestPct, true)}</div>
    <div class="cp-spread-items">${r.itemCount} items</div>
    <div class="cp-spread-fresh ${freshnessClass(r.freshnessMin)}">${freshnessLabel(r.freshnessMin)}</div>
  </div>`;
}

function renderSpreadHtml(d: ListRetailerPriceSpreadsResponse): string {
  if (!d?.retailers?.length) return '<div class="cp-empty-state">Retailer comparison starts once data is collected</div>';
  return `<div class="cp-spread-header">
    <span>Spread: <strong>${d.spreadPct.toFixed(1)}%</strong></span>
    <span class="cp-spread-basket">${escapeHtml(d.basketSlug)} · ${escapeHtml(d.currencyCode)}</span>
  </div>
  <div class="cp-spread-list">${d.retailers.map((r, i) => renderSpreadRow(r, i, d.currencyCode)).join('')}</div>`;
}

function renderHealthHtml(d: GetConsumerPriceFreshnessResponse): string {
  if (!d?.retailers?.length) return '<div class="cp-empty-state">Health data not yet available</div>';
  return `<div class="cp-health-summary">
    <span>Overall freshness: <strong class="${freshnessClass(d.overallFreshnessMin)}">${freshnessLabel(d.overallFreshnessMin)}</strong></span>
    ${d.stalledCount > 0 ? `<span class="cp-stalled-badge">${d.stalledCount} stalled</span>` : ''}
  </div>
  <div class="cp-health-list">${d.retailers.map((r) => `<div class="cp-health-row">
    <span class="cp-health-name">${escapeHtml(r.name)}</span>
    <span class="cp-health-status cp-health-status--${r.status}">${r.status}</span>
    <span class="cp-health-rate">${r.parseSuccessRate > 0 ? `${r.parseSuccessRate.toFixed(0)}% parse` : '—'}</span>
    <span class="cp-health-fresh ${freshnessClass(r.freshnessMin)}">${freshnessLabel(r.freshnessMin)}</span>
  </div>`).join('')}</div>`;
}

function renderGlobalOverviewHtml(allMarkets: GetConsumerPriceOverviewResponse[]): string {
  if (!allMarkets.length) return '<div class="cp-empty-state">Loading global data…</div>';
  const rows = SINGLE_MARKETS.map((m) => {
    const d = allMarkets.find((r) => r.marketCode === m.code);
    const hasData = d && d.asOf && d.asOf !== '0' && !d.upstreamUnavailable;
    if (!hasData) {
      return `<tr class="cp-global-row" data-market="${m.code}"><td class="cp-global-flag">${m.label}</td><td colspan="4" class="cp-global-pending">Pending data</td></tr>`;
    }
    const freshCls = freshnessClass(d.freshnessLagMin > 0 ? d.freshnessLagMin : null);
    return `<tr class="cp-global-row" data-market="${m.code}">
      <td class="cp-global-flag">${m.label}</td>
      <td class="cp-global-index">${d.essentialsIndex > 0 ? d.essentialsIndex.toFixed(1) : '—'}</td>
      <td class="cp-global-wow">${pctBadge(d.wowPct, true)}</td>
      <td class="cp-global-spread">${d.retailerSpreadPct > 0 ? `${d.retailerSpreadPct.toFixed(1)}%` : '—'}</td>
      <td class="cp-global-fresh ${freshCls}">${d.freshnessLagMin > 0 ? freshnessLabel(d.freshnessLagMin) : '—'}</td>
    </tr>`;
  }).join('');
  return `<table class="cp-global-table">
    <thead><tr><th>Market</th><th>Index</th><th>WoW</th><th>Spread</th><th>Updated</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="cp-global-hint">Tap a market row to drill in</div>`;
}

function WorldTab({ rows, loading, filter, onFilterChange }: {
  rows: CountryInflationRow[] | null;
  loading: boolean;
  filter: string;
  onFilterChange: (v: string) => void;
}) {
  if (loading || rows === null) {
    return <div className="cp-empty-state">{t('components.consumerPrices.world.loading')}</div>;
  }
  if (rows.length === 0) {
    return <div className="cp-empty-state">{t('components.consumerPrices.world.empty')}</div>;
  }
  const f = filter.trim().toLowerCase();
  const visible = f ? rows.filter((r) => r.name.toLowerCase().includes(f) || r.iso2.toLowerCase().includes(f)) : rows;
  const countLabel = visible.length === 1
    ? t('components.consumerPrices.world.countSingular')
    : t('components.consumerPrices.world.countPlural');
  return (
    <>
      <div className="cp-world-controls">
        <input
          type="search"
          className="cp-world-filter"
          placeholder={t('components.consumerPrices.world.filterPlaceholder')}
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
        />
        <span className="cp-world-count">{visible.length} {countLabel}</span>
      </div>
      <table className="cp-global-table cp-world-table">
        <thead>
          <tr>
            <th>{t('components.consumerPrices.world.country')}</th>
            <th>{t('components.consumerPrices.world.inflationYoY')}</th>
            <th>{t('components.consumerPrices.world.endOfPeriod')}</th>
            <th>{t('components.consumerPrices.world.year')}</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr><td colSpan={4} className="cp-global-pending">{t('components.consumerPrices.world.noMatches')}</td></tr>
          ) : visible.map((r) => (
            <tr key={r.iso2} className="cp-global-row">
              <td className="cp-global-flag">{r.name}</td>
              <td className={`cp-infl-yoy ${inflationSeverityClass(r.inflationPct)}`}>{fmtInflation(r.inflationPct)}</td>
              <td className="cp-infl-eop">{fmtInflation(r.cpiEopPct)}</td>
              <td className="cp-infl-year">{r.year ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cp-global-hint">{t('components.consumerPrices.world.source')}</div>
    </>
  );
}

export function ConsumerPricesPanelContent() {
  const [settings, setSettings] = useState<PanelSettings>(loadSettings);
  const [overview, setOverview] = useState<GetConsumerPriceOverviewResponse | null>(null);
  const [categories, setCategories] = useState<ListConsumerPriceCategoriesResponse | null>(null);
  const [movers, setMovers] = useState<ListConsumerPriceMoversResponse | null>(null);
  const [spread, setSpread] = useState<ListRetailerPriceSpreadsResponse | null>(null);
  const [freshness, setFreshness] = useState<GetConsumerPriceFreshnessResponse | null>(null);
  const [allMarkets, setAllMarkets] = useState<GetConsumerPriceOverviewResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalInflation, setGlobalInflation] = useState<CountryInflationRow[] | null>(null);
  const [inflationLoading, setInflationLoading] = useState(false);
  const [inflationFilter, setInflationFilter] = useState('');

  const updateSettings = useCallback((patch: Partial<PanelSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        if (settings.market === 'all') {
          const markets = await fetchAllMarketsOverview();
          if (controller.signal.aborted) return;
          setAllMarkets(markets);
          setOverview(null);
        } else {
          const [ov, cats, mv, sp, fr] = await Promise.all([
            fetchConsumerPriceOverview(settings.market, settings.basket),
            fetchConsumerPriceCategories(settings.market, settings.basket, settings.range),
            fetchConsumerPriceMovers(settings.market, settings.range),
            fetchRetailerPriceSpreads(settings.market, settings.basket),
            fetchConsumerPriceFreshness(settings.market),
          ]);
          if (controller.signal.aborted) return;
          setOverview(ov); setCategories(cats); setMovers(mv); setSpread(sp); setFreshness(fr);
          setAllMarkets([]);
        }
        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load data');
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [settings.market, settings.basket, settings.range]);

  useEffect(() => {
    if (settings.tab !== 'world' || globalInflation !== null || inflationLoading) return;
    setInflationLoading(true);
    getAllCountriesInflation().then((rows) => {
      setGlobalInflation(rows);
      setInflationLoading(false);
    }).catch(() => setInflationLoading(false));
  }, [settings.tab, globalInflation, inflationLoading]);

  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: string }>).detail?.tab;
      if (!tab || !TAB_IDS.includes(tab as TabId)) return;
      updateSettings({ tab: tab as TabId });
    };
    window.addEventListener(OPEN_TAB_EVENT, handler);
    return () => window.removeEventListener(OPEN_TAB_EVENT, handler);
  }, [updateSettings]);

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const marketBtn = target.closest('[data-market]') as HTMLElement | null;
    if (marketBtn?.dataset.market) {
      const code = marketBtn.dataset.market;
      updateSettings({ market: code, basket: code === 'all' ? DEFAULT_BASKET : `essentials-${code}`, tab: 'overview' });
      return;
    }
    const catRow = target.closest('[data-category]') as HTMLElement | null;
    if (catRow?.dataset.category) {
      updateSettings({ categoryFilter: catRow.dataset.category, tab: 'movers' });
      return;
    }
    if (target.closest('[data-clear-filter]')) updateSettings({ categoryFilter: null });
  };

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar"><div className="panel-radar-sweep" /><div className="panel-radar-dot" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error}</div>
        <button className="panel-error-retry" onClick={() => updateSettings({ range: settings.range })}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const globalTabsOnly = settings.market === 'all' || settings.tab === 'world';
  const allTabs: Array<{ id: TabId; label: string }> = [
    { id: 'overview', label: t('components.consumerPrices.tabs.overview') },
    { id: 'categories', label: t('components.consumerPrices.tabs.categories') },
    { id: 'movers', label: t('components.consumerPrices.tabs.movers') },
    { id: 'spread', label: t('components.consumerPrices.tabs.spread') },
    { id: 'health', label: t('components.consumerPrices.tabs.health') },
    { id: 'world', label: t('components.consumerPrices.tabs.world') },
  ];
  const tabs = globalTabsOnly ? allTabs.filter((tb) => tb.id === 'overview' || tb.id === 'world') : allTabs;
  const activeTab = tabs.some((tb) => tb.id === settings.tab) ? settings.tab : 'overview';
  const noData = overview?.upstreamUnavailable;
  const showRangeBar = (activeTab === 'categories' || activeTab === 'movers') && !noData && settings.market !== 'all';

  let bodyHtml: string | null = null;
  let bodyJsx: React.ReactNode = null;

  if (activeTab === 'world') {
    bodyJsx = <WorldTab rows={globalInflation} loading={inflationLoading} filter={inflationFilter} onFilterChange={setInflationFilter} />;
  } else if (settings.market === 'all') {
    bodyHtml = renderGlobalOverviewHtml(allMarkets);
  } else if (noData) {
    bodyHtml = `<div class="cp-body cp-seeding-state"><div class="cp-seeding-icon">📊</div><div class="cp-seeding-title">Data collection in progress</div><div class="cp-seeding-sub">Retail prices are being aggregated — check back in a few hours.</div></div>`;
  } else {
    switch (activeTab) {
      case 'overview': bodyHtml = overview ? renderOverviewHtml(overview) : '<div class="cp-empty-state">No data yet</div>'; break;
      case 'categories': bodyHtml = categories ? renderCategoriesHtml(categories) : '<div class="cp-empty-state">No category data yet</div>'; break;
      case 'movers': bodyHtml = movers ? renderMoversHtml(movers, settings.categoryFilter) : '<div class="cp-empty-state">No price movement data yet</div>'; break;
      case 'spread': bodyHtml = spread ? renderSpreadHtml(spread) : '<div class="cp-empty-state">No spread data yet</div>'; break;
      case 'health': bodyHtml = freshness ? renderHealthHtml(freshness) : '<div class="cp-empty-state">Health data not yet available</div>'; break;
    }
  }

  return (
    <div className="consumer-prices-panel" onClick={handleClick}>
      {activeTab !== 'world' && (
        <div className="cp-market-bar">
          {MARKETS.map((m) => (
            <button key={m.code} className={`cp-market-btn${settings.market === m.code ? ' active' : ''}`} data-market={m.code}>{m.label}</button>
          ))}
        </div>
      )}
      <div className="panel-tabs">
        {tabs.map((tb) => (
          <button key={tb.id} className={`panel-tab${activeTab === tb.id ? ' active' : ''}`} onClick={() => updateSettings({ tab: tb.id })}>{tb.label}</button>
        ))}
      </div>
      {showRangeBar && (
        <div className="cp-range-bar">
          {(['7d', '30d', '90d'] as const).map((r) => (
            <button key={r} className={`cp-range-btn${settings.range === r ? ' active' : ''}`} onClick={() => updateSettings({ range: r })}>{r}</button>
          ))}
        </div>
      )}
      {activeTab === 'movers' && settings.categoryFilter && !noData && (
        <div className="cp-filter-bar">
          Filtered: <strong>{settings.categoryFilter}</strong>{' '}
          <button data-clear-filter="">✕</button>
        </div>
      )}
      <div className="cp-body">
        {bodyJsx ?? (bodyHtml !== null ? <div dangerouslySetInnerHTML={{ __html: bodyHtml }} /> : null)}
      </div>
    </div>
  );
}

export function ConsumerPricesPanel() {
  return (
    <PanelShell
      id="consumer-prices"
      title={t('panels.consumerPrices')}
      infoTooltip={t('components.consumerPrices.infoTooltip')}
      defaultRowSpan={2}
    >
      <ConsumerPricesPanelContent />
    </PanelShell>
  );
}
