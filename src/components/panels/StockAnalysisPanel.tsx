import { useState, useEffect, useCallback } from 'react';
import type { StockAnalysisResult } from '@/services/stock-analysis';
import type { StockAnalysisHistory } from '@/services/stock-analysis-history';
import type { InsiderTransactionsResult } from '@/services/insider-transactions';
import {
  getStockAnalysisRatingAction,
  getStockAnalysisRatingBullishFactors,
  getStockAnalysisRatingConfidence,
  getStockAnalysisRatingRiskFactors,
  getStockAnalysisRatingScore,
  getStockAnalysisRatingSignal,
  getStockAnalysisRatingSummary,
  getStockAnalysisRatingWhyNow,
} from '@/services/stock-analysis-rating';
import { getMarketWatchlistEntries } from '@/services/market-watchlist';
import { isAnalyzableSymbol } from '@/services/stock-analysis';
import { buildFundamentalDisplayCells } from '@/services/stock-fundamentals-display';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { sparkline } from '@/utils/sparkline';
import { openWatchlistModal } from '@/components/watchlist-modal';
import { PanelShell } from '@/components/PanelShell';
import { getPanelGateReason, PanelGateReason, resolveBillingAwareGateReason, resolveGateAction } from '@/services/panel-gating';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { openSignIn } from '@/services/clerk';
import {
  stockAnalysisItemsChannel,
  stockAnalysisHistoryChannel,
  stockAnalysisInsiderChannel,
  stockAnalysisStateChannel,
  type StockAnalysisState,
} from '@/services/stock-analysis-store';
import { t } from '@/services/i18n';
import type { AnalystConsensus, PriceTarget, UpgradeDowngrade } from '@/generated/client/worldmonitor/market/v1/service_client';

type SortKey = 'score-desc' | 'change-desc' | 'symbol-asc';
type FilterKey = 'all' | 'strong-buy' | 'buy' | 'hold' | 'sell';

const SORT_OPTIONS: Array<{ key: SortKey; label: string; cmp: (a: StockAnalysisResult, b: StockAnalysisResult) => number }> = [
  { key: 'score-desc', label: 'Score ↓', cmp: (a, b) => getStockAnalysisRatingScore(b) - getStockAnalysisRatingScore(a) },
  { key: 'change-desc', label: '1d % ↓', cmp: (a, b) => b.changePercent - a.changePercent },
  { key: 'symbol-asc', label: 'Symbol A-Z', cmp: (a, b) => (a.display || a.symbol).localeCompare(b.display || b.symbol) },
];

const FILTER_OPTIONS: Array<{ key: FilterKey; label: string; match: (i: StockAnalysisResult) => boolean }> = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'strong-buy', label: 'Strong Buy', match: (i) => getStockAnalysisRatingSignal(i).toLowerCase().includes('strong buy') },
  { key: 'buy', label: 'Buy+', match: (i) => getStockAnalysisRatingSignal(i).toLowerCase().includes('buy') },
  { key: 'hold', label: 'Hold', match: (i) => { const s = getStockAnalysisRatingSignal(i).toLowerCase(); return s.includes('hold') || s.includes('watch'); } },
  { key: 'sell', label: 'Sell', match: (i) => getStockAnalysisRatingSignal(i).toLowerCase().includes('sell') },
];

function stockSignalClass(signal: string): string {
  const n = signal.toLowerCase();
  if (n.includes('buy')) return 'badge-bullish';
  if (n.includes('hold') || n.includes('watch')) return 'badge-neutral';
  return 'badge-bearish';
}

function fmtChange(change: number): string {
  return `${change >= 0 ? '+' : ''}${Number.isFinite(change) ? change.toFixed(2) : '0.00'}%`;
}

function fmtPrice(price: number, currency: string): string {
  if (!Number.isFinite(price)) return 'N/A';
  return `${currency === 'USD' ? '$' : ''}${price.toFixed(2)}${currency && currency !== 'USD' ? ` ${currency}` : ''}`;
}

function fmtDollarCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function txCodeLabel(code: string): string {
  if (code === 'P') return 'Buy';
  if (code === 'S') return 'Sell';
  if (code === 'M') return 'Exercise';
  if (code === 'A') return 'Award';
  if (code === 'D') return 'Disposition';
  if (code === 'F') return 'Tax/Fee';
  return code;
}

function listHtml(items: string[], cssClass: string): string {
  if (items.length === 0) return '';
  return `<ul class="${cssClass}" style="margin:8px 0 0;padding-left:18px;font-size:12px;line-height:1.5">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderRatingBarHtml(c: AnalystConsensus): string {
  const total = c.total || 1;
  const pct = (v: number) => ((v / total) * 100).toFixed(1);
  const segments = [
    { label: 'Strong Buy', count: c.strongBuy, color: '#16a34a', pct: pct(c.strongBuy) },
    { label: 'Buy', count: c.buy, color: '#4ade80', pct: pct(c.buy) },
    { label: 'Hold', count: c.hold, color: '#facc15', pct: pct(c.hold) },
    { label: 'Sell', count: c.sell, color: '#f87171', pct: pct(c.sell) },
    { label: 'Strong Sell', count: c.strongSell, color: '#dc2626', pct: pct(c.strongSell) },
  ].filter((s) => s.count > 0);
  const bar = segments.map((s) => `<div style="flex:${s.count};background:${s.color};height:8px;min-width:2px" title="${escapeHtml(s.label)}: ${s.count} (${s.pct}%)"></div>`).join('');
  const legend = segments.map((s) => `<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:${s.color};display:inline-block"></span>${s.count}</span>`).join('<span style="color:var(--border);margin:0 4px">|</span>');
  return `<div style="margin-bottom:8px"><div style="display:flex;gap:1px;border-radius:4px;overflow:hidden;margin-bottom:4px">${bar}</div><div style="font-size:10px;color:var(--text-dim);display:flex;align-items:center;flex-wrap:wrap;gap:2px">${legend}<span style="margin-left:6px;color:var(--text-dim)">(${total} analysts)</span></div></div>`;
}

function renderPriceTargetHtml(pt: PriceTarget, currentPrice: number, currency: string): string {
  const currSymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : (currency || '$');
  const isSymbolPrefix = currSymbol.length === 1;
  const fmt = (v: number) => isSymbolPrefix ? `${currSymbol}${v.toFixed(2)}` : `${v.toFixed(2)} ${currSymbol}`;
  const hasVal = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const low = hasVal(pt.low) ? pt.low : undefined;
  const high = hasVal(pt.high) ? pt.high : undefined;
  const mean = hasVal(pt.mean) ? pt.mean : undefined;
  const median = hasVal(pt.median) ? pt.median : undefined;
  const displayMedian = median ?? mean;
  if (!displayMedian) return '';
  const cells: string[] = [];
  if (low !== undefined) cells.push(`<div style="border:1px solid var(--border);padding:6px 8px;flex:1;min-width:90px"><div style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">Low</div><div style="margin-top:2px">${escapeHtml(fmt(low))}</div></div>`);
  cells.push(`<div style="border:1px solid var(--border);padding:6px 8px;flex:1;min-width:90px"><div style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">Median</div><div style="margin-top:2px">${escapeHtml(fmt(displayMedian))}</div></div>`);
  if (high !== undefined) cells.push(`<div style="border:1px solid var(--border);padding:6px 8px;flex:1;min-width:90px"><div style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">High</div><div style="margin-top:2px">${escapeHtml(fmt(high))}</div></div>`);
  cells.push(`<div style="border:1px solid var(--border);padding:6px 8px;flex:1;min-width:90px"><div style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">Analysts</div><div style="margin-top:2px">${escapeHtml(String(pt.numberOfAnalysts))}</div></div>`);
  if (currentPrice > 0) {
    const upsidePct = ((displayMedian - currentPrice) / currentPrice) * 100;
    const upsideColor = upsidePct >= 0 ? 'var(--semantic-normal)' : 'var(--semantic-critical)';
    const upsideStr = `${upsidePct >= 0 ? '+' : ''}${upsidePct.toFixed(1)}%`;
    cells.push(`<div style="border:1px solid var(--border);padding:6px 8px;flex:1;min-width:90px"><div style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">vs Current</div><div style="margin-top:2px;color:${upsideColor}">${escapeHtml(upsideStr)}</div></div>`);
  }
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;font-size:11px;margin-bottom:8px">${cells.join('')}</div>`;
}

function renderRecentUpgradesHtml(upgrades: UpgradeDowngrade[]): string {
  const rows = upgrades.slice(0, 3).map((u) => {
    const actionColor = u.action === 'up' || u.action === 'init' ? 'var(--semantic-normal)' : u.action === 'down' ? 'var(--semantic-critical)' : 'var(--text-dim)';
    const actionLabel = u.action === 'up' ? 'Upgrade' : u.action === 'down' ? 'Downgrade' : u.action === 'init' ? 'Initiated' : escapeHtml(u.action);
    const gradeChange = u.fromGrade ? `${escapeHtml(u.fromGrade)} → ${escapeHtml(u.toGrade)}` : escapeHtml(u.toGrade);
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 8px;border:1px solid var(--border);background:rgba(255,255,255,0.02);font-size:11px"><span style="font-weight:500">${escapeHtml(u.firm)}</span><span style="color:${actionColor};white-space:nowrap">${actionLabel}</span><span style="color:var(--text-dim);white-space:nowrap">${gradeChange}</span></div>`;
  }).join('');
  return `<div style="display:grid;gap:4px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Recent Actions</div>${rows}</div>`;
}

function renderInsiderHtml(data: InsiderTransactionsResult | undefined): string {
  if (data === undefined) return '';
  if (data.unavailable) return `<div style="font-size:11px;color:var(--text-dim);padding:8px;border:1px solid var(--border)">Insider data unavailable</div>`;
  if (data.transactions.length === 0 && data.totalBuys === 0 && data.totalSells === 0) {
    return `<div style="font-size:11px;color:var(--text-dim);padding:8px;border:1px solid var(--border)">No insider transactions in the last 6 months</div>`;
  }
  const buysStr = fmtDollarCompact(data.totalBuys);
  const sellsStr = fmtDollarCompact(data.totalSells);
  const netStr = `${data.netValue >= 0 ? '+' : ''}${fmtDollarCompact(data.netValue)}`;
  const netColor = data.netValue >= 0 ? 'var(--semantic-normal)' : 'var(--semantic-critical)';
  const summary = `<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;font-family:var(--font-mono)"><span>Buys: <span style="color:var(--semantic-normal)">${escapeHtml(buysStr)}</span></span><span>Sells: <span style="color:var(--semantic-critical)">${escapeHtml(sellsStr)}</span></span><span>Net: <span style="color:${netColor};font-weight:600">${escapeHtml(netStr)}</span></span></div>`;
  const rows = data.transactions.slice(0, 5);
  const table = rows.length > 0 ? `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px"><thead><tr style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em;text-align:left"><th style="padding:4px 6px;border-bottom:1px solid var(--border)">Name</th><th style="padding:4px 6px;border-bottom:1px solid var(--border)">Type</th><th style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:right">Shares</th><th style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:right">Value</th><th style="padding:4px 6px;border-bottom:1px solid var(--border)">Date</th></tr></thead><tbody>${rows.map(tx => {
    const isBuy = tx.transactionCode === 'P';
    const isSell = tx.transactionCode === 'S';
    const typeColor = isBuy ? 'var(--semantic-normal)' : isSell ? 'var(--semantic-critical)' : 'var(--text-dim)';
    const valueCell = tx.value === 0 ? '—' : fmtDollarCompact(tx.value);
    return `<tr><td style="padding:4px 6px;border-bottom:1px solid var(--border);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(tx.name)}</td><td style="padding:4px 6px;border-bottom:1px solid var(--border);color:${typeColor}">${escapeHtml(txCodeLabel(tx.transactionCode))}</td><td style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:right;font-family:var(--font-mono)">${Number.isFinite(tx.shares) ? tx.shares.toLocaleString() : '0'}</td><td style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:right;font-family:var(--font-mono)">${valueCell}</td><td style="padding:4px 6px;border-bottom:1px solid var(--border);color:var(--text-dim)">${escapeHtml(tx.transactionDate)}</td></tr>`;
  }).join('')}</tbody></table>` : '';
  return `<div style="display:grid;gap:6px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Insider Activity (6 months)</div>${summary}${table}</div>`;
}

function renderCardHtml(
  item: StockAnalysisResult,
  history: StockAnalysisResult[],
  insiderBySymbol: Record<string, InsiderTransactionsResult>,
): string {
  const ratingSignal = getStockAnalysisRatingSignal(item);
  const tone = stockSignalClass(ratingSignal);
  const priorRuns = history.filter((entry) => entry.generatedAt !== item.generatedAt).slice(0, 3);
  const previous = priorRuns[0];
  const signalDelta = previous ? getStockAnalysisRatingScore(item) - getStockAnalysisRatingScore(previous) : null;
  const headlines = item.headlines.slice(0, 2).map((headline) => {
    const href = sanitizeUrl(headline.link);
    const title = escapeHtml(headline.title);
    const source = escapeHtml(headline.source || 'Source');
    return `<a href="${href}" target="_blank" rel="noreferrer" style="display:block;color:var(--text);text-decoration:none;padding:8px 10px;border:1px solid var(--border);background:rgba(255,255,255,0.02)"><div style="font-size:12px;line-height:1.45">${title}</div><div style="margin-top:4px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">${source}</div></a>`;
  }).join('');

  const consensus = item.analystConsensus;
  const pt = item.priceTarget;
  const upgrades = item.recentUpgrades;
  const hasConsensus = consensus && consensus.total > 0;
  const hasMean = typeof pt?.mean === 'number' && pt.mean > 0;
  const hasMedian = typeof pt?.median === 'number' && pt.median > 0;
  const hasPriceTarget = !!pt && pt.numberOfAnalysts > 0 && (hasMean || hasMedian);
  const hasUpgrades = upgrades && upgrades.length > 0;
  const analystSection = (hasConsensus || hasPriceTarget || hasUpgrades)
    ? `<div style="border-top:1px solid var(--border);margin-top:4px;padding-top:10px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim);margin-bottom:8px">Analyst Consensus</div>${hasConsensus ? renderRatingBarHtml(consensus) : ''}${hasPriceTarget ? renderPriceTargetHtml(pt!, item.currentPrice, item.currency) : ''}${hasUpgrades ? renderRecentUpgradesHtml(upgrades!) : ''}</div>`
    : '';

  const fundamentalCells = buildFundamentalDisplayCells(item.fundamentals, item.currency)
    .map((entry) => `<div style="border:1px solid var(--border);padding:6px 8px;flex:1;min-width:88px"><div style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">${escapeHtml(entry.label)}</div><div style="margin-top:2px${entry.color ? `;color:${entry.color}` : ''}">${escapeHtml(entry.value)}</div></div>`);
  const fundamentalsSection = fundamentalCells.length > 0
    ? `<div style="border-top:1px solid var(--border);margin-top:4px;padding-top:10px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim);margin-bottom:8px">Fundamentals</div><div style="display:flex;flex-wrap:wrap;gap:6px">${fundamentalCells.join('')}</div></div>`
    : '';

  const dividendSection = (item.dividendYield && item.dividendYield > 0) ? (() => {
    const yieldStr = `${item.dividendYield.toFixed(1)}%`;
    const rateStr = item.trailingAnnualDividendRate > 0 ? (() => {
      const trimmed = (item.currency || '').trim().toUpperCase();
      const rate = item.trailingAnnualDividendRate;
      if (trimmed && trimmed !== 'USD') {
        try { return ` (${new Intl.NumberFormat('en-US', { style: 'currency', currency: trimmed }).format(rate)}/share)`; }
        catch { return ` (${trimmed} ${rate.toFixed(2)}/share)`; }
      }
      return ` ($${rate.toFixed(2)}/share)`;
    })() : '';
    const cagrStr = item.dividendCagr !== 0 ? `${item.dividendCagr > 0 ? '+' : ''}${item.dividendCagr.toFixed(1)}%` : 'N/A';
    const freqBadge = item.dividendFrequency ? `<span class="badge-neutral" style="font-size:10px;padding:2px 6px;border-radius:3px">${escapeHtml(item.dividendFrequency)}</span>` : '';
    const exDateStr = item.exDividendDate > 0 ? new Date(item.exDividendDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
    const hasPayoutRatio = typeof item.payoutRatio === 'number' && item.payoutRatio > 0;
    const payoutCell = hasPayoutRatio ? `<div><div style="color:var(--text-dim)">Payout Ratio</div><div style="margin-top:3px">${escapeHtml(`${(item.payoutRatio! * 100).toFixed(1)}%`)}</div></div>` : '';
    return `<div style="border:1px solid var(--border);padding:10px 12px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim);margin-bottom:8px">Dividend Profile</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;font-size:11px"><div><div style="color:var(--text-dim)">Yield</div><div style="margin-top:3px">${escapeHtml(yieldStr + rateStr)}</div></div><div><div style="color:var(--text-dim)">5Y CAGR</div><div style="margin-top:3px">${escapeHtml(cagrStr)}</div></div><div><div style="color:var(--text-dim)">Frequency</div><div style="margin-top:3px">${freqBadge || 'N/A'}</div></div>${payoutCell}<div><div style="color:var(--text-dim)">Ex-Dividend</div><div style="margin-top:3px">${escapeHtml(exDateStr)}</div></div></div></div>`;
  })() : '';

  const scoreHistorySvg = history.length >= 2 ? (() => {
    const scores = history.slice(0, 6).reverse().map(getStockAnalysisRatingScore);
    const last = scores[scores.length - 1] ?? 0;
    const prev = scores[scores.length - 2] ?? last;
    return sparkline(scores, last >= prev ? 'var(--semantic-normal)' : 'var(--semantic-critical)', 60, 20, 'display:block;margin-top:4px;align-self:flex-end');
  })() : '';

  return `
    <section class="signal-card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong style="font-size:16px;letter-spacing:-0.02em">${escapeHtml(item.name || item.symbol)}</strong>
            <span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);text-transform:uppercase">${escapeHtml(item.display || item.symbol)}</span>
            <span class="signal-badge ${tone}" style="font-family:var(--font-mono)">${escapeHtml(ratingSignal)}</span>
          </div>
          <div style="margin-top:6px;font-size:12px;color:var(--text-dim);line-height:1.5">${escapeHtml(getStockAnalysisRatingSummary(item))}</div>
        </div>
        <div style="text-align:right;min-width:110px">
          <div style="font-size:18px;font-weight:700">${escapeHtml(fmtPrice(item.currentPrice, item.currency))}</div>
          <div style="font-size:12px;color:${item.changePercent >= 0 ? 'var(--semantic-normal)' : 'var(--semantic-critical)'}">${escapeHtml(fmtChange(item.changePercent))}</div>
          <div style="margin-top:6px;font-size:11px;color:var(--text-dim)">Score ${escapeHtml(String(getStockAnalysisRatingScore(item)))} · ${escapeHtml(getStockAnalysisRatingConfidence(item))}</div>
          ${scoreHistorySvg}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;font-size:11px">
        <div style="border:1px solid var(--border);padding:8px"><div style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">Trend</div><div style="margin-top:4px">${escapeHtml(item.trendStatus)}</div></div>
        <div style="border:1px solid var(--border);padding:8px"><div style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">MA5 Bias</div><div style="margin-top:4px">${escapeHtml(fmtChange(item.biasMa5))}</div></div>
        <div style="border:1px solid var(--border);padding:8px"><div style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">RSI 12</div><div style="margin-top:4px">${escapeHtml(item.rsi12.toFixed(1))}</div></div>
        <div style="border:1px solid var(--border);padding:8px"><div style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">Volume</div><div style="margin-top:4px">${escapeHtml(item.volumeStatus)}</div></div>
        ${item.newsSentiment != null ? `<div style="border:1px solid var(--border);padding:8px"><div style="color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">News</div><div style="margin-top:4px">${escapeHtml(`${item.newsSentiment >= 0.15 ? 'Bullish' : item.newsSentiment <= -0.15 ? 'Bearish' : 'Neutral'} (${item.newsSentiment >= 0 ? '+' : ''}${item.newsSentiment.toFixed(2)})`)}</div></div>` : ''}
      </div>
      ${dividendSection}
      <div style="font-size:12px;line-height:1.55;color:var(--text)"><strong style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Action</strong><div style="margin-top:4px">${escapeHtml(getStockAnalysisRatingAction(item))}</div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
        <div><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Bullish Factors</div>${listHtml(getStockAnalysisRatingBullishFactors(item).slice(0, 3), 'badge-bullish')}</div>
        <div><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Risk Factors</div>${listHtml(getStockAnalysisRatingRiskFactors(item).slice(0, 3), 'badge-bearish')}</div>
      </div>
      <div style="font-size:12px;line-height:1.55;color:var(--text-dim)"><strong style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Why Now</strong><div style="margin-top:4px">${escapeHtml(getStockAnalysisRatingWhyNow(item))}</div></div>
      ${previous ? `<div style="font-size:12px;line-height:1.55;color:var(--text-dim)"><strong style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Signal Drift</strong><div style="margin-top:4px">Previous run was ${escapeHtml(getStockAnalysisRatingSignal(previous))} at score ${escapeHtml(String(getStockAnalysisRatingScore(previous)))}. Current drift is ${escapeHtml(`${signalDelta && signalDelta > 0 ? '+' : ''}${(signalDelta || 0).toFixed(1)}`)}</div></div>` : ''}
      ${priorRuns.length > 0 ? `<div style="display:grid;gap:6px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Recent History</div>${priorRuns.map((entry) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid var(--border);background:rgba(255,255,255,0.02);font-size:11px"><span>${escapeHtml(getStockAnalysisRatingSignal(entry))} · score ${escapeHtml(String(getStockAnalysisRatingScore(entry)))}</span><span style="color:var(--text-dim)">${escapeHtml(new Date(entry.generatedAt).toLocaleString())}</span></div>`).join('')}</div>` : ''}
      ${renderInsiderHtml(insiderBySymbol[item.symbol])}
      ${headlines ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px">${headlines}</div>` : ''}
      ${analystSection}
      ${fundamentalsSection}
    </section>
  `;
}

function buildIntro(itemCount: number): string {
  const skippedCount = getMarketWatchlistEntries().filter((entry) => !isAnalyzableSymbol(entry.symbol)).length;
  const tickerWord = itemCount === 1 ? 'ticker' : 'tickers';
  const skippedNote = skippedCount > 0
    ? ` <span style="color:var(--text-dim)">${skippedCount} watchlist ${skippedCount === 1 ? 'symbol is an index/FX rate' : 'symbols are indices/FX rates'} and don't get an equity report.</span>`
    : '';
  return `Analyst-grade equity reports for the ${itemCount} ${tickerWord} in your watchlist — your picks lead, popular names fill the rest. Use <strong>Edit Watchlist</strong> to add your own.${skippedNote}`;
}

export function StockAnalysisPanelContent() {
  const [items, setItems] = useState<StockAnalysisResult[]>(stockAnalysisItemsChannel.get);
  const [history, setHistory] = useState<StockAnalysisHistory>(stockAnalysisHistoryChannel.get);
  const [insiderBySymbol, setInsiderBySymbol] = useState<Record<string, InsiderTransactionsResult>>(stockAnalysisInsiderChannel.get);
  const [panelState, setPanelState] = useState<StockAnalysisState>(stockAnalysisStateChannel.get);
  const [sort, setSort] = useState<SortKey>('score-desc');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    const u1 = stockAnalysisItemsChannel.subscribe(setItems);
    const u2 = stockAnalysisHistoryChannel.subscribe(setHistory);
    const u3 = stockAnalysisInsiderChannel.subscribe(setInsiderBySymbol);
    const u4 = stockAnalysisStateChannel.subscribe(setPanelState);
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  useEffect(() => {
    if (expandedKey && !items.some((i) => i.symbol === expandedKey)) setExpandedKey(null);
  }, [items, expandedKey]);

  const handleRowClick = useCallback((symbol: string) => {
    setExpandedKey((prev) => (prev === symbol ? null : symbol));
  }, []);

  if (panelState.state === 'idle') return null;

  if (panelState.state === 'retrying' || panelState.state === 'error') {
    return (
      <div className="panel-message" style={{ padding: '20px', color: 'var(--text-dim)', fontSize: '13px' }}>
        {panelState.message}
      </div>
    );
  }

  const filterFn = FILTER_OPTIONS.find((f) => f.key === filter)?.match ?? (() => true);
  const sortFn = SORT_OPTIONS.find((s) => s.key === sort)?.cmp ?? (() => 0);
  const q = search.trim().toLowerCase();
  const filtered = items
    .filter(filterFn)
    .filter((i) => !q || `${i.symbol} ${i.display || ''} ${i.name || ''}`.toLowerCase().includes(q))
    .sort(sortFn);

  const COLS = 5;

  return (
    <div className="watchlist-table-view">
      <div
        className="watchlist-intro"
        style={{ fontSize: '12px', color: 'var(--text-dim)', padding: '8px 12px 0' }}
        dangerouslySetInnerHTML={{ __html: buildIntro(items.length) }}
      />
      <div className="watchlist-controls">
        <input
          className="watchlist-search"
          type="text"
          placeholder="Search ticker or name..."
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <div className="watchlist-control-row">
          <div className="watchlist-pills">
            {FILTER_OPTIONS.map((f) => (
              <button
                key={f.key}
                className={`watchlist-pill${filter === f.key ? ' watchlist-pill-active' : ''}`}
                type="button"
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select
            className="watchlist-sort"
            value={sort}
            onChange={(e) => setSort(e.currentTarget.value as SortKey)}
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="watchlist-table-scroll">
        <table className="watchlist-table">
          <thead>
            <tr>
              <th className="watchlist-th-sortable" onClick={() => setSort('symbol-asc')}>Symbol{sort === 'symbol-asc' ? ' ↓' : ''}</th>
              <th className="watchlist-th-right">Price</th>
              <th>Signal</th>
              <th className="watchlist-th-sortable watchlist-th-right" onClick={() => setSort('score-desc')}>Score{sort === 'score-desc' ? ' ↓' : ''}</th>
              <th className="watchlist-th-sortable watchlist-th-right" onClick={() => setSort('change-desc')}>1d %{sort === 'change-desc' ? ' ↓' : ''}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={COLS} className="watchlist-empty">No symbols match the current filter.</td></tr>
            ) : filtered.map((item) => {
              const signal = getStockAnalysisRatingSignal(item);
              const isExpanded = expandedKey === item.symbol;
              return (
                <>
                  <tr
                    key={item.symbol}
                    className={`watchlist-row${isExpanded ? ' watchlist-row-expanded' : ''}`}
                    onClick={() => handleRowClick(item.symbol)}
                  >
                    <td><strong>{item.display || item.symbol}</strong></td>
                    <td className="watchlist-td-right">{fmtPrice(item.currentPrice, item.currency)}</td>
                    <td><span className={`signal-badge ${stockSignalClass(signal)}`}>{signal}</span></td>
                    <td className="watchlist-td-right">{getStockAnalysisRatingScore(item)}</td>
                    <td className="watchlist-td-right" style={{ color: item.changePercent >= 0 ? 'var(--semantic-normal)' : 'var(--semantic-critical)' }}>{fmtChange(item.changePercent)}</td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${item.symbol}-detail`} className="watchlist-detail-row">
                      <td colSpan={COLS}>
                        <div dangerouslySetInnerHTML={{ __html: renderCardHtml(item, history[item.symbol] || [], insiderBySymbol) }} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WatchlistButton({ label = 'Watchlist' }: { label?: string }) {
  return (
    <button
      className="live-news-settings-btn"
      title="Customize market watchlist"
      onClick={e => { e.stopPropagation(); openWatchlistModal(); }}
    >
      {label}
    </button>
  );
}

function usePremiumGate() {
  const [authState, setAuthState] = useState(getAuthState);
  useEffect(() => subscribeAuthState(setAuthState), []);
  let reason = getPanelGateReason(authState, true);
  if (reason === PanelGateReason.FREE_TIER) reason = resolveBillingAwareGateReason(reason);
  return {
    locked: reason !== PanelGateReason.NONE,
    onLockedCtaClick: () => resolveGateAction(reason, { openAuthModal: openSignIn })(),
  };
}

export function StockAnalysisPanel() {
  const { locked, onLockedCtaClick } = usePremiumGate();
  return (
    <PanelShell
      id="stock-analysis"
      title="Premium Stock Analysis"
      infoTooltip={t('components.stockAnalysis.infoTooltip')}
      locked={locked}
      onLockedCtaClick={onLockedCtaClick}
      headerActions={!locked ? <WatchlistButton label="Edit Watchlist" /> : undefined}
    >
      <StockAnalysisPanelContent />
    </PanelShell>
  );
}
