import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { createLazyClient, getRpcBaseUrl, rpcFetch } from '@/services/rpc-client';
import { EconomicServiceClient } from '@/services/generated-rpc-clients';
import type { GetMacroSignalsResponse } from '@/generated/client/worldmonitor/economic/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

const getClient = createLazyClient(() => new EconomicServiceClient(getRpcBaseUrl(), { fetch: rpcFetch }));

interface MacroSignalData {
  timestamp: string;
  verdict: string;
  bullishCount: number;
  totalCount: number;
  signals: {
    liquidity: { status: string; value: number | null; sparkline: number[] };
    flowStructure: { status: string; btcReturn5: number | null; qqqReturn5: number | null };
    macroRegime: { status: string; qqqRoc20: number | null; xlpRoc20: number | null };
    technicalTrend: { status: string; btcPrice: number | null; sma50: number | null; sma200: number | null; vwap30d: number | null; mayerMultiple: number | null; sparkline: number[] };
    hashRate: { status: string; change30d: number | null };
    priceMomentum: { status: string };
    fearGreed: { status: string; value: number | null; history: Array<{ value: number; date: string }> };
  };
  meta: { qqqSparkline: number[] };
  unavailable?: boolean;
}

function mapProtoToData(r: GetMacroSignalsResponse): MacroSignalData {
  const s = r.signals;
  return {
    timestamp: r.timestamp,
    verdict: r.verdict,
    bullishCount: r.bullishCount,
    totalCount: r.totalCount,
    signals: {
      liquidity: { status: s?.liquidity?.status ?? 'UNKNOWN', value: s?.liquidity?.value ?? null, sparkline: s?.liquidity?.sparkline ?? [] },
      flowStructure: { status: s?.flowStructure?.status ?? 'UNKNOWN', btcReturn5: s?.flowStructure?.btcReturn5 ?? null, qqqReturn5: s?.flowStructure?.qqqReturn5 ?? null },
      macroRegime: { status: s?.macroRegime?.status ?? 'UNKNOWN', qqqRoc20: s?.macroRegime?.qqqRoc20 ?? null, xlpRoc20: s?.macroRegime?.xlpRoc20 ?? null },
      technicalTrend: { status: s?.technicalTrend?.status ?? 'UNKNOWN', btcPrice: s?.technicalTrend?.btcPrice ?? null, sma50: s?.technicalTrend?.sma50 ?? null, sma200: s?.technicalTrend?.sma200 ?? null, vwap30d: s?.technicalTrend?.vwap30d ?? null, mayerMultiple: s?.technicalTrend?.mayerMultiple ?? null, sparkline: s?.technicalTrend?.sparkline ?? [] },
      hashRate: { status: s?.hashRate?.status ?? 'UNKNOWN', change30d: s?.hashRate?.change30d ?? null },
      priceMomentum: { status: s?.priceMomentum?.status ?? 'UNKNOWN' },
      fearGreed: { status: s?.fearGreed?.status ?? 'UNKNOWN', value: s?.fearGreed?.value ?? null, history: s?.fearGreed?.history ?? [] },
    },
    meta: { qqqSparkline: r.meta?.qqqSparkline ?? [] },
    unavailable: r.unavailable,
  };
}

function sparklineSvg(data: number[], width = 80, height = 24, color = '#4fc3f7'): string {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="signal-sparkline"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function donutGaugeSvg(value: number | null, size = 48): string {
  if (value === null) return '<span class="signal-value unknown">N/A</span>';
  const v = Math.max(0, Math.min(100, value));
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (v / 100) * circumference;
  let color = '#f44336';
  if (v >= 75) color = '#4caf50';
  else if (v >= 50) color = '#ff9800';
  else if (v >= 25) color = '#ff5722';
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="fg-donut">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="5"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="${size / 2}" y="${size / 2 + 4}" text-anchor="middle" fill="${color}" font-size="12" font-weight="bold">${v}</text>
  </svg>`;
}

function fgSparklineColor(status: string): string {
  const s = status.toUpperCase();
  if (['GREED', 'EXTREME GREED'].includes(s)) return '#4caf50';
  if (['FEAR', 'EXTREME FEAR'].includes(s)) return '#f44336';
  return '#4fc3f7';
}

function statusBadgeClass(status: string): string {
  const s = status.toUpperCase();
  if (['BULLISH', 'RISK-ON', 'GROWING', 'PROFITABLE', 'ALIGNED', 'NORMAL', 'EXTREME GREED', 'GREED'].includes(s)) return 'badge-bullish';
  if (['BEARISH', 'DEFENSIVE', 'DECLINING', 'SQUEEZE', 'PASSIVE GAP', 'EXTREME FEAR', 'FEAR'].includes(s)) return 'badge-bearish';
  return 'badge-neutral';
}

function formatNum(v: number | null, suffix = '%'): string {
  if (v === null) return 'N/A';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}${suffix}`;
}

function signalCardHtml(name: string, status: string, value: string, sparkline: string, detail: string, link: string | null): string {
  const badgeClass = statusBadgeClass(status);
  return `<div class="signal-card${link ? ' signal-card-linked' : ''}">
    <div class="signal-header">
      ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="signal-name signal-card-link">${escapeHtml(name)}</a>` : `<span class="signal-name">${escapeHtml(name)}</span>`}
      <span class="signal-badge ${badgeClass}">${escapeHtml(status)}</span>
    </div>
    <div class="signal-body">
      ${sparkline ? `<div class="signal-sparkline-wrap">${sparkline}</div>` : ''}
      ${value ? `<span class="signal-value">${value}</span>` : ''}
    </div>
    ${detail ? `<div class="signal-detail">${escapeHtml(detail)}</div>` : ''}
  </div>`;
}

function fearGreedCardHtml(fg: MacroSignalData['signals']['fearGreed']): string {
  const badgeClass = statusBadgeClass(fg.status);
  return `<div class="signal-card signal-card-fg">
    <div class="signal-header">
      <span class="signal-name">${t('components.macroSignals.signals.fearGreed')}</span>
      <span class="signal-badge ${badgeClass}">${escapeHtml(fg.status)}</span>
    </div>
    <div class="signal-body signal-body-fg">
      <div style="display:flex;align-items:center;gap:8px">
        ${donutGaugeSvg(fg.value)}
        ${sparklineSvg(fg.history.map(h => h.value), 80, 28, fgSparklineColor(fg.status))}
      </div>
    </div>
    <div class="signal-detail">
      <a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noopener">alternative.me</a>
    </div>
  </div>`;
}

function buildHtml(d: MacroSignalData): string {
  const s = d.signals;
  const verdictClass = d.verdict === 'BUY' ? 'verdict-buy' : d.verdict === 'CASH' ? 'verdict-cash' : 'verdict-unknown';
  const verdictLabel = d.verdict === 'BUY' ? t('components.macroSignals.verdict.buy') : d.verdict === 'CASH' ? t('components.macroSignals.verdict.cash') : escapeHtml(d.verdict);
  return `<div class="macro-signals-container">
    <div class="macro-verdict ${verdictClass}">
      <span class="verdict-label">${t('components.macroSignals.overall')}</span>
      <span style="font-size:9px;background:rgba(247,147,26,0.15);color:#f7931a;border:1px solid rgba(247,147,26,0.3);padding:1px 5px;border-radius:3px;font-weight:700;letter-spacing:0.04em;vertical-align:middle">&#x20bf; BTC</span>
      <span class="verdict-value">${verdictLabel}</span>
      <span class="verdict-detail">${t('components.macroSignals.bullish', { count: String(d.bullishCount), total: String(d.totalCount) })}</span>
    </div>
    <div class="signals-grid">
      ${signalCardHtml(t('components.macroSignals.signals.liquidity'), s.liquidity.status, formatNum(s.liquidity.value), sparklineSvg(s.liquidity.sparkline, 60, 20, '#4fc3f7'), 'JPY 30d ROC', 'https://www.tradingview.com/symbols/JPYUSD/')}
      ${signalCardHtml(t('components.macroSignals.signals.flow'), s.flowStructure.status, `BTC ${formatNum(s.flowStructure.btcReturn5)} / QQQ ${formatNum(s.flowStructure.qqqReturn5)}`, '', '5d returns', null)}
      ${signalCardHtml(t('components.macroSignals.signals.regime'), s.macroRegime.status, `QQQ ${formatNum(s.macroRegime.qqqRoc20)} / XLP ${formatNum(s.macroRegime.xlpRoc20)}`, sparklineSvg(d.meta.qqqSparkline, 60, 20, '#ab47bc'), '20d ROC', 'https://www.tradingview.com/symbols/QQQ/')}
      ${signalCardHtml(t('components.macroSignals.signals.btcTrend'), s.technicalTrend.status, `$${s.technicalTrend.btcPrice?.toLocaleString() ?? 'N/A'}`, sparklineSvg(s.technicalTrend.sparkline, 60, 20, '#ff9800'), `SMA50: $${s.technicalTrend.sma50?.toLocaleString() ?? '-'} | VWAP: $${s.technicalTrend.vwap30d?.toLocaleString() ?? '-'} | Mayer: ${s.technicalTrend.mayerMultiple ?? '-'}`, 'https://www.tradingview.com/symbols/BTCUSD/')}
      ${signalCardHtml(t('components.macroSignals.signals.hashRate'), s.hashRate.status, formatNum(s.hashRate.change30d), '', '30d change', 'https://mempool.space/mining')}
      ${signalCardHtml(t('components.macroSignals.signals.momentum'), s.priceMomentum.status, '', '', 'Mayer Multiple', null)}
      ${fearGreedCardHtml(s.fearGreed)}
    </div>
  </div>`;
}

async function fetcher(_signal: AbortSignal): Promise<MacroSignalData> {
  const res = await getClient().getMacroSignals({});
  return mapProtoToData(res);
}

export function MacroSignalsPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'macroSignals',
    ttlMs: 15 * 60 * 1000,
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

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.noDataShort')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  if (data.unavailable) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{t('common.upstreamUnavailable')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  return <div dangerouslySetInnerHTML={{ __html: buildHtml(data) }} />;
}

export function MacroSignalsPanel() {
  return (
    <PanelShell
      id="macro-signals"
      title={t('panels.macroSignals')}
      infoTooltip={t('components.macroSignals.infoTooltip')}
    >
      <MacroSignalsPanelContent />
    </PanelShell>
  );
}
