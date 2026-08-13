import { useState, useEffect, useCallback } from 'react';
import type { StockBacktestResult } from '@/services/stock-backtest';
import {
  stockBacktestItemsChannel,
  stockBacktestStateChannel,
  type StockBacktestState,
} from '@/services/stock-backtest-store';
import { openWatchlistModal } from '@/components/watchlist-modal';
import { PanelShell } from '@/components/PanelShell';
import { getPanelGateReason, PanelGateReason, resolveBillingAwareGateReason, resolveGateAction } from '@/services/panel-gating';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { openSignIn } from '@/services/clerk';
import { t } from '@/services/i18n';

function tone(value: number): string {
  if (value > 0) return '#8df0b2';
  if (value < 0) return '#ff8c8c';
  return 'var(--text-dim)';
}

function fmtPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function backtestSignalClass(winRate: number): string {
  if (winRate >= 55) return 'badge-bullish';
  if (winRate >= 45) return 'badge-neutral';
  return 'badge-bearish';
}

function backtestSignalLabel(winRate: number): string {
  if (winRate >= 55) return 'Profitable';
  if (winRate >= 45) return 'Mixed';
  return 'Losing';
}

type SortKey = 'winrate-desc' | 'direction-desc' | 'avgreturn-desc' | 'signals-desc' | 'symbol-asc';
type FilterKey = 'all' | 'profitable' | 'mixed' | 'losing';

const SORT_OPTIONS: Array<{ key: SortKey; label: string; cmp: (a: StockBacktestResult, b: StockBacktestResult) => number }> = [
  { key: 'winrate-desc', label: 'Win Rate ↓', cmp: (a, b) => b.winRate - a.winRate },
  { key: 'direction-desc', label: 'Direction ↓', cmp: (a, b) => b.directionAccuracy - a.directionAccuracy },
  { key: 'avgreturn-desc', label: 'Avg Return ↓', cmp: (a, b) => b.avgSimulatedReturnPct - a.avgSimulatedReturnPct },
  { key: 'signals-desc', label: 'Signals ↓', cmp: (a, b) => b.actionableEvaluations - a.actionableEvaluations },
  { key: 'symbol-asc', label: 'Symbol A-Z', cmp: (a, b) => (a.display || a.symbol).localeCompare(b.display || b.symbol) },
];

const FILTER_OPTIONS: Array<{ key: FilterKey; label: string; match: (i: StockBacktestResult) => boolean }> = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'profitable', label: 'Profitable', match: (i) => i.winRate >= 55 },
  { key: 'mixed', label: 'Mixed', match: (i) => i.winRate >= 45 && i.winRate < 55 },
  { key: 'losing', label: 'Losing', match: (i) => i.winRate < 45 },
];

function DetailRow({ item, colSpan }: { item: StockBacktestResult; colSpan: number }) {
  return (
    <tr className="watchlist-detail-row">
      <td colSpan={colSpan}>
        <section style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '16px', letterSpacing: '-0.02em' }}>{item.name || item.symbol}</strong>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{item.display || item.symbol}</span>
                <span className={`signal-badge ${backtestSignalClass(item.winRate)}`}>{backtestSignalLabel(item.winRate)}</span>
              </div>
              <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.5 }}>{item.summary}</div>
            </div>
            <div style={{ textAlign: 'right', minWidth: '110px' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: tone(item.avgSimulatedReturnPct) }}>{fmtPct(item.avgSimulatedReturnPct)}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Avg simulated return</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '8px', fontSize: '11px' }}>
            <div style={{ border: '1px solid var(--border)', padding: '8px' }}><div style={{ color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Win Rate</div><div style={{ marginTop: '4px' }}>{fmtPct(item.winRate)}</div></div>
            <div style={{ border: '1px solid var(--border)', padding: '8px' }}><div style={{ color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Direction Accuracy</div><div style={{ marginTop: '4px' }}>{fmtPct(item.directionAccuracy)}</div></div>
            <div style={{ border: '1px solid var(--border)', padding: '8px' }}><div style={{ color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cumulative</div><div style={{ marginTop: '4px', color: tone(item.cumulativeSimulatedReturnPct) }}>{fmtPct(item.cumulativeSimulatedReturnPct)}</div></div>
            <div style={{ border: '1px solid var(--border)', padding: '8px' }}><div style={{ color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Signals</div><div style={{ marginTop: '4px' }}>{item.actionableEvaluations}</div></div>
            <div style={{ border: '1px solid var(--border)', padding: '8px' }}><div style={{ color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Rating Basis</div><div style={{ marginTop: '4px' }}>{item.ratingBasis === 'technical_only' ? 'Technical only' : item.ratingBasis}</div></div>
          </div>
          <div style={{ display: 'grid', gap: '6px' }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)' }}>Recent Evaluations</div>
            {item.evaluations.map((ev, idx) => (
              <div key={`${ev.analysisId || idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', fontSize: '11px' }}>
                <span>{ev.signal} · {ev.outcome} · {fmtPct(ev.simulatedReturnPct)}</span>
                <span style={{ color: 'var(--text-dim)' }}>{new Date(Number(ev.analysisAt)).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </section>
      </td>
    </tr>
  );
}

export function StockBacktestPanelContent() {
  const [items, setItems] = useState<StockBacktestResult[]>(stockBacktestItemsChannel.get);
  const [panelState, setPanelState] = useState<StockBacktestState>(stockBacktestStateChannel.get);
  const [sort, setSort] = useState<SortKey>('winrate-desc');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    const u1 = stockBacktestItemsChannel.subscribe(setItems);
    const u2 = stockBacktestStateChannel.subscribe(setPanelState);
    return () => { u1(); u2(); };
  }, []);

  useEffect(() => {
    if (expandedKey && !items.some((i) => i.symbol === expandedKey)) {
      setExpandedKey(null);
    }
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
      <div className="watchlist-intro" style={{ fontSize: '12px', color: 'var(--text-dim)', padding: '8px 12px 0' }}>
        Historical replay of the technical signal model over recent daily bars. Point-in-time fundamentals are not included.
      </div>
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
              <th className="watchlist-th-sortable watchlist-th-right" onClick={() => setSort('winrate-desc')}>Win Rate{sort === 'winrate-desc' ? ' ↓' : ''}</th>
              <th className="watchlist-th-sortable watchlist-th-right" onClick={() => setSort('direction-desc')}>Direction{sort === 'direction-desc' ? ' ↓' : ''}</th>
              <th className="watchlist-th-sortable watchlist-th-right" onClick={() => setSort('avgreturn-desc')}>Avg Return{sort === 'avgreturn-desc' ? ' ↓' : ''}</th>
              <th className="watchlist-th-sortable watchlist-th-right" onClick={() => setSort('signals-desc')}>Signals{sort === 'signals-desc' ? ' ↓' : ''}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={COLS} className="watchlist-empty">No symbols match the current filter.</td></tr>
            ) : filtered.map((item) => (
              <>
                <tr
                  key={item.symbol}
                  className={`watchlist-row${expandedKey === item.symbol ? ' watchlist-row-expanded' : ''}`}
                  onClick={() => handleRowClick(item.symbol)}
                >
                  <td><strong>{item.display || item.symbol}</strong></td>
                  <td className="watchlist-td-right">{fmtPct(item.winRate)}</td>
                  <td className="watchlist-td-right">{fmtPct(item.directionAccuracy)}</td>
                  <td className="watchlist-td-right" style={{ color: tone(item.avgSimulatedReturnPct) }}>{fmtPct(item.avgSimulatedReturnPct)}</td>
                  <td className="watchlist-td-right">{item.actionableEvaluations}</td>
                </tr>
                {expandedKey === item.symbol && <DetailRow key={`${item.symbol}-detail`} item={item} colSpan={COLS} />}
              </>
            ))}
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

export function StockBacktestPanel() {
  const { locked, onLockedCtaClick } = usePremiumGate();
  return (
    <PanelShell
      id="stock-backtest"
      title="Premium Backtesting"
      infoTooltip={t('components.stockBacktest.infoTooltip')}
      locked={locked}
      onLockedCtaClick={onLockedCtaClick}
      headerActions={!locked ? <WatchlistButton label="Edit Watchlist" /> : undefined}
    >
      <StockBacktestPanelContent />
    </PanelShell>
  );
}
