import { useState, useEffect, useRef } from 'react';
import { getChangeClass } from '@/utils';
import { describeFreshness } from '@/services/persistent-cache';
import { getPanelGateReason, PanelGateReason, resolveBillingAwareGateReason, resolveGateAction } from '@/services/panel-gating';
import { FrameworkSelector } from '@/components/FrameworkSelector';
import { openWatchlistModal } from '@/components/watchlist-modal';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { openSignIn } from '@/services/clerk';
import {
  dailyBriefStateChannel,
  type BriefPanelState,
} from '@/services/daily-market-brief-store';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

function formatGeneratedTime(isoTimestamp: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    }).format(new Date(isoTimestamp));
  } catch {
    return isoTimestamp;
  }
}

function stanceLabel(stance: 'bullish' | 'neutral' | 'defensive'): string {
  if (stance === 'bullish') return 'Bullish';
  if (stance === 'defensive') return 'Defensive';
  return 'Neutral';
}

function formatPrice(price: number | null): string {
  if (typeof price !== 'number' || !Number.isFinite(price)) return 'N/A';
  return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatChange(change: number | null): string {
  if (typeof change !== 'number' || !Number.isFinite(change)) return 'Flat';
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

export function DailyMarketBriefPanelContent() {
  const [panelState, setPanelState] = useState<BriefPanelState>(dailyBriefStateChannel.get);

  useEffect(() => dailyBriefStateChannel.subscribe(setPanelState), []);

  if (panelState.kind === 'idle') return null;

  if (panelState.kind === 'loading') {
    return (
      <div className="panel-message" style={{ padding: '20px', color: 'var(--text-dim)', fontSize: '13px' }}>
        {panelState.message}
      </div>
    );
  }

  if (panelState.kind === 'error') {
    return (
      <div className="panel-message" style={{ padding: '20px', color: 'var(--text-dim)', fontSize: '13px' }}>
        {panelState.message}
      </div>
    );
  }

  const { brief, source } = panelState;
  const freshness = describeFreshness(new Date(brief.generatedAt).getTime());

  return (
    <div className="daily-brief-shell" data-badge={source} data-badge-label={freshness} style={{ display: 'grid', gap: '12px' }}>
      <div className="daily-brief-card" style={{ display: 'grid', gap: '6px', padding: '12px', border: '1px solid var(--border)', borderRadius: '4px', background: 'rgba(255,255,255,0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600 }}>{brief.title}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{formatGeneratedTime(brief.generatedAt, brief.timezone)}</div>
        </div>
        <div style={{ fontSize: '12px', lineHeight: 1.5, color: 'var(--text)' }}>{brief.summary}</div>
      </div>

      <div style={{ display: 'grid', gap: '10px' }}>
        <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '4px', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ fontSize: '11px', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '4px' }}>Action Plan</div>
          <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{brief.actionPlan}</div>
        </div>
        <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '4px', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ fontSize: '11px', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '4px' }}>Risk Watch</div>
          <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{brief.riskWatch}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '8px' }}>
        {brief.items.map((item, idx) => (
          <div key={`${item.symbol}-${idx}`} style={{ display: 'grid', gap: '6px', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '4px', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600 }}>{item.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{item.display}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '12px', fontWeight: 600 }}>{formatPrice(item.price)}</div>
                <div className={`market-change ${getChangeClass(item.change ?? 0)}`} style={{ fontSize: '11px' }}>{formatChange(item.change)}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ fontSize: '11px', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{stanceLabel(item.stance)}</div>
              {item.relatedHeadline && <div style={{ fontSize: '11px', color: 'var(--text-dim)', textAlign: 'right', maxWidth: '55%' }}>Linked headline</div>}
            </div>
            <div style={{ fontSize: '12px', lineHeight: 1.45 }}>{item.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FrameworkSelectorWidget() {
  const containerRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const instance = new FrameworkSelector({
      panelId: 'daily-market-brief',
      isPremium: true,
      panel: null,
      note: 'Applies to client-generated analysis only',
    });
    containerRef.current.appendChild(instance.el);
    return () => { instance.destroy(); };
  }, []);
  return <span ref={containerRef} />;
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

export function DailyMarketBriefPanel() {
  const { locked, onLockedCtaClick } = usePremiumGate();
  return (
    <PanelShell
      id="daily-market-brief"
      title="Daily Market Brief"
      infoTooltip={t('components.dailyMarketBrief.infoTooltip')}
      locked={locked}
      onLockedCtaClick={onLockedCtaClick}
      headerActions={!locked ? (
        <>
          <FrameworkSelectorWidget />
          <WatchlistButton label="Edit Watchlist" />
        </>
      ) : undefined}
    >
      <DailyMarketBriefPanelContent />
    </PanelShell>
  );
}

