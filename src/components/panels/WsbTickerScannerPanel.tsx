import { useState, useEffect } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { getHydratedData } from '@/services/bootstrap';
import { toApiUrl } from '@/services/runtime';
import type { CSSProperties } from 'react';
import { PanelShell } from '@/components/PanelShell';
import { getPanelGateReason, PanelGateReason, resolveBillingAwareGateReason, resolveGateAction } from '@/services/panel-gating';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { openSignIn } from '@/services/clerk';

interface WsbTicker {
  symbol: string;
  mentionCount: number;
  uniquePosts: number;
  totalScore: number;
  avgUpvoteRatio: number;
  topPost?: { title: string; url: string; score: number; subreddit: string };
  subreddits: string[];
  velocityScore: number;
}

type SortField = 'mentionCount' | 'totalScore' | 'velocityScore';

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function velocityColor(score: number): string {
  if (score >= 80) return '#e74c3c';
  if (score >= 50) return '#e67e22';
  if (score >= 25) return '#f1c40f';
  return '#27ae60';
}

async function fetcher(_signal: AbortSignal): Promise<WsbTicker[]> {
  const hydrated = getHydratedData('wsbTickers') as { tickers?: WsbTicker[] } | undefined;
  if (hydrated?.tickers?.length) return hydrated.tickers;
  const resp = await fetch(toApiUrl('/api/bootstrap?keys=wsbTickers'), {
    signal: AbortSignal.timeout(5_000),
  });
  if (resp.ok) {
    const { data } = (await resp.json()) as { data: { wsbTickers?: { tickers?: WsbTicker[] } } };
    if (data.wsbTickers?.tickers?.length) return data.wsbTickers.tickers;
  }
  throw new Error('No ticker data available yet');
}

const HEADER_STYLE: CSSProperties = {
  fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase',
  padding: '4px 6px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
};
const CELL_STYLE: CSSProperties = { fontSize: 11, padding: '5px 6px', verticalAlign: 'middle' };

export function WsbTickerScannerPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'wsbTickers',
    ttlMs: 15 * 60 * 1000,
  });
  const [sortField, setSortField] = useState<SortField>('mentionCount');
  const [sortAsc, setSortAsc] = useState(false);

  if (loading) return <div className="panel-loading" />;

  if (error || !data?.length) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? 'No ticker data available yet'}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const handleSort = (field: SortField) => {
    if (field === sortField) setSortAsc(a => !a);
    else { setSortField(field); setSortAsc(false); }
  };

  const dir = sortAsc ? 1 : -1;
  const sorted = [...data].sort((a, b) => dir * (a[sortField] - b[sortField]));
  const maxVelocity = Math.max(1, ...sorted.map(tk => tk.velocityScore));
  const sortIndicator = (field: SortField) => field === sortField ? (sortAsc ? ' ▲' : ' ▼') : '';

  return (
    <div>
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 480 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', borderSpacing: 0 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ ...HEADER_STYLE, textAlign: 'right' }}>#</th>
              <th style={{ ...HEADER_STYLE, textAlign: 'left' }}>Ticker</th>
              <th style={{ ...HEADER_STYLE, textAlign: 'right' }} onClick={() => handleSort('mentionCount')}>Mentions{sortIndicator('mentionCount')}</th>
              <th style={{ ...HEADER_STYLE, textAlign: 'right' }} onClick={() => handleSort('totalScore')}>Score{sortIndicator('totalScore')}</th>
              <th style={{ ...HEADER_STYLE, textAlign: 'left' }} onClick={() => handleSort('velocityScore')}>Velocity{sortIndicator('velocityScore')}</th>
              <th style={{ ...HEADER_STYLE, textAlign: 'left' }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 50).length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No ticker data</td></tr>
            ) : sorted.slice(0, 50).map((tk, i) => {
              const vColor = velocityColor(tk.velocityScore);
              const barPct = Math.max(4, Math.round((tk.velocityScore / maxVelocity) * 100));
              return (
                <tr key={tk.symbol} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...CELL_STYLE, color: 'var(--text-dim)', textAlign: 'right', minWidth: 20 }}>{i + 1}</td>
                  <td style={{ ...CELL_STYLE, fontFamily: "'SF Mono',SFMono-Regular,Consolas,monospace", fontWeight: 700, color: 'var(--text)' }}>{tk.symbol}</td>
                  <td style={{ ...CELL_STYLE, textAlign: 'right', color: 'var(--text)' }}>{tk.mentionCount}</td>
                  <td style={{ ...CELL_STYLE, textAlign: 'right', color: 'var(--text)' }}>{formatCompact(tk.totalScore)}</td>
                  <td style={{ ...CELL_STYLE, minWidth: 80 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: vColor, minWidth: 24, textAlign: 'right' }}>{Math.round(tk.velocityScore)}</span>
                      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}>
                        <div style={{ height: '100%', width: `${barPct}%`, borderRadius: 2, background: vColor }} />
                      </div>
                    </div>
                  </td>
                  <td style={CELL_STYLE}>
                    {tk.subreddits.map(s => (
                      <span key={s} style={{ fontSize: 8, padding: '1px 4px', borderRadius: 2, background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)', marginRight: 2 }}>r/{s}</span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-dim)' }}>
        Reddit · r/wallstreetbets, r/stocks, r/investing · sorted by {sortField.replace(/([A-Z])/g, ' $1').toLowerCase()}
      </div>
    </div>
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

export function WsbTickerScannerPanel() {
  const { locked, onLockedCtaClick } = usePremiumGate();
  return (
    <PanelShell
      id="wsb-ticker-scanner"
      title={t('panels.wsbTickerScanner')}
      showCount
      infoTooltip={t('components.wsbTickerScanner.infoTooltip')}
      locked={locked}
      onLockedCtaClick={onLockedCtaClick}
    >
      <WsbTickerScannerPanelContent />
    </PanelShell>
  );
}
