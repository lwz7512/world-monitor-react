import { useState, useEffect, useCallback } from 'react';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { formatPrice, formatChange, getChangeClass } from '@/utils';
import { miniSparkline } from '@/utils/sparkline';
import { fetchCommodityQuotes } from '@/services/market';
import { COMMODITIES, SITE_VARIANT } from '@/config';
import type { MarketData } from '@/types';
import { PanelShell } from '@/components/PanelShell';

type CommoditiesTab = 'commodities' | 'fx' | 'xau';

interface FxRateItem {
  currency: string;
  rate: number;
  change1d: number | null;
}

interface CommodityItem {
  symbol?: string;
  display: string;
  price: number | null;
  change: number | null;
  sparkline?: number[];
}

const ENERGY_SYMBOLS = new Set(['CL=F', 'BZ=F', 'NG=F']);

const XAU_CURRENCY_CONFIG: Array<{ symbol: string; label: string; flag: string; multiply: boolean }> = [
  { symbol: 'EURUSD=X',  label: 'EUR', flag: '\u{1F1EA}\u{1F1FA}', multiply: false },
  { symbol: 'GBPUSD=X',  label: 'GBP', flag: '\u{1F1EC}\u{1F1E7}', multiply: false },
  { symbol: 'USDJPY=X',  label: 'JPY', flag: '\u{1F1EF}\u{1F1F5}', multiply: true  },
  { symbol: 'USDCNY=X',  label: 'CNY', flag: '\u{1F1E8}\u{1F1F3}', multiply: true  },
  { symbol: 'USDINR=X',  label: 'INR', flag: '\u{1F1EE}\u{1F1F3}', multiply: true  },
  { symbol: 'AUDUSD=X',  label: 'AUD', flag: '\u{1F1E6}\u{1F1FA}', multiply: false },
  { symbol: 'USDCHF=X',  label: 'CHF', flag: '\u{1F1E8}\u{1F1ED}', multiply: true  },
  { symbol: 'USDCAD=X',  label: 'CAD', flag: '\u{1F1E8}\u{1F1E6}', multiply: true  },
  { symbol: 'USDTRY=X',  label: 'TRY', flag: '\u{1F1F9}\u{1F1F7}', multiply: true  },
];

const EUR_FX_ORDER = ['USD', 'GBP', 'JPY', 'CHF', 'CAD', 'CNY', 'AUD'];

function renderXauHtml(commodities: CommodityItem[]): string {
  const gcf = commodities.find((d) => d.symbol === 'GC=F' && d.price !== null);
  if (!gcf?.price) return `<div style="padding:8px;color:var(--text-dim);font-size:12px">Gold price unavailable</div>`;

  const goldUsd = gcf.price;
  const fxMap = new Map(commodities.filter((d) => d.symbol?.endsWith('=X')).map((d) => [d.symbol!, d]));

  const rows = XAU_CURRENCY_CONFIG.map((cfg) => {
    const fx = fxMap.get(cfg.symbol);
    if (!fx?.price || !Number.isFinite(fx.price)) return null;
    const xauPrice = cfg.multiply ? goldUsd * fx.price : goldUsd / fx.price;
    if (!Number.isFinite(xauPrice) || xauPrice <= 0) return null;
    return `<div class="commodity-item">
      <div class="commodity-name">${escapeHtml(cfg.flag)} XAU/${escapeHtml(cfg.label)}</div>
      <div class="commodity-price" style="font-size:11px">${escapeHtml(Math.round(xauPrice).toLocaleString())}</div>
    </div>`;
  }).filter(Boolean);

  if (rows.length === 0) {
    const placeholders = XAU_CURRENCY_CONFIG.map((cfg) =>
      `<div class="commodity-item">
        <div class="commodity-name">${escapeHtml(cfg.flag)} XAU/${escapeHtml(cfg.label)}</div>
        <div class="commodity-price" style="font-size:11px">--</div>
      </div>`
    ).join('');
    return `<div class="commodities-grid">${placeholders}</div><div style="margin-top:6px;font-size:9px;color:var(--text-dim)">FX rates unavailable</div>`;
  }
  return `<div class="commodities-grid">${rows.join('')}</div><div style="margin-top:6px;font-size:9px;color:var(--text-dim)">Computed from GC=F + Yahoo FX</div>`;
}

function renderFxHtml(fxRates: FxRateItem[]): string {
  const items = fxRates.map((r) => {
    const change = r.change1d ?? null;
    const changeStr = change !== null ? `${change >= 0 ? '+' : ''}${change.toFixed(4)}` : '';
    const changeClass = change === null ? '' : change >= 0 ? 'change-positive' : 'change-negative';
    return `<div class="commodity-item">
      <div class="commodity-name">EUR/${escapeHtml(r.currency)}</div>
      <div class="commodity-price">${escapeHtml(r.rate.toFixed(4))}</div>
      ${changeStr ? `<div class="commodity-change ${escapeHtml(changeClass)}">${escapeHtml(changeStr)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="commodities-grid">${items}</div><div style="margin-top:6px;font-size:9px;color:var(--text-dim)">Source: ECB</div>`;
}

function renderCommoditiesHtml(commodities: CommodityItem[]): string {
  const valid = commodities.filter(
    (d) => typeof d.price === 'number' && Number.isFinite(d.price) && !d.symbol?.endsWith('=X'),
  );
  if (valid.length === 0) return '';
  return '<div class="commodities-grid">' +
    valid.map((c) => `
      <div class="commodity-item">
        <div class="commodity-name">${escapeHtml(c.display)}</div>
        ${miniSparkline(c.sparkline, c.change, 60, 18)}
        <div class="commodity-price">${formatPrice(c.price!)}</div>
        <div class="commodity-change ${getChangeClass(c.change!)}">${formatChange(c.change!)}</div>
      </div>
    `).join('') + '</div>';
}

export function CommoditiesPanelContent() {
  const [commodities, setCommodities] = useState<CommodityItem[]>([]);
  const [fxRates, setFxRates] = useState<FxRateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<CommoditiesTab>('commodities');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [commodityResult, fxModule] = await Promise.all([
        fetchCommodityQuotes(COMMODITIES),
        import('@/services/economic').then((m) => m.getEcbFxRatesData()).catch(() => null),
      ]);

      const mapped: CommodityItem[] = (commodityResult.data as MarketData[])
        .filter((d) => d.symbol !== '^VIX' && !ENERGY_SYMBOLS.has(d.symbol ?? ''))
        .map((d) => ({ symbol: d.symbol, display: d.display, price: d.price, change: d.change, sparkline: d.sparkline }));
      setCommodities(mapped);

      if (fxModule && !fxModule.unavailable && fxModule.rates?.length) {
        const orderedRates = EUR_FX_ORDER
          .map((ccy) => fxModule.rates.find((r) => r.pair === `EUR${ccy}`))
          .filter((r): r is NonNullable<typeof r> => r != null);
        setFxRates(orderedRates.map((r) => ({
          currency: r.pair.slice(3),
          rate: r.rate,
          change1d: r.change1d ?? null,
        })));
      }
    } catch {
      setError(t('common.failedCommodities'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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

  const validCommodities = commodities.filter(
    (d) => typeof d.price === 'number' && Number.isFinite(d.price) && !d.symbol?.endsWith('=X'),
  );
  const hasFx = fxRates.length > 0;
  const hasXau = SITE_VARIANT === 'commodity' && commodities.some((d) => d.symbol === 'GC=F' && d.price !== null);

  if (error && validCommodities.length === 0) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={load}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const activeTab = (tab === 'xau' && !hasXau) ? 'commodities' : tab;

  const tabBar = (hasFx || hasXau) ? (
    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
      <button
        className={`panel-tab${activeTab === 'commodities' ? ' active' : ''}`}
        style={{ fontSize: 11, padding: '3px 10px' }}
        onClick={() => setTab('commodities')}
      >Commodities</button>
      {hasFx && (
        <button
          className={`panel-tab${activeTab === 'fx' ? ' active' : ''}`}
          style={{ fontSize: 11, padding: '3px 10px' }}
          onClick={() => setTab('fx')}
        >EUR FX</button>
      )}
      {hasXau && (
        <button
          className={`panel-tab${activeTab === 'xau' ? ' active' : ''}`}
          style={{ fontSize: 11, padding: '3px 10px' }}
          onClick={() => setTab('xau')}
        >XAU/FX</button>
      )}
    </div>
  ) : null;

  let bodyHtml = '';
  if (activeTab === 'fx' && hasFx) {
    bodyHtml = renderFxHtml(fxRates);
  } else if (activeTab === 'xau' && hasXau) {
    bodyHtml = renderXauHtml(commodities);
  } else {
    bodyHtml = renderCommoditiesHtml(commodities);
  }

  return (
    <>
      {tabBar}
      <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </>
  );
}

export function CommoditiesPanel() {
  return (
    <PanelShell
      id="commodities"
      title={t('panels.commodities')}
      infoTooltip={t('components.commodities.infoTooltip')}
    >
      <CommoditiesPanelContent />
    </PanelShell>
  );
}
