import { useState, useEffect } from 'react';
import { getPanelGateReason, PanelGateReason, resolveBillingAwareGateReason, resolveGateAction } from '@/services/panel-gating';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { openSignIn } from '@/services/clerk';
import { PanelShell } from '@/components/PanelShell';
import { t } from '@/services/i18n';
import type { MarketImplicationCard, TransmissionNode } from '@/services/market-implications';
import { getMarketImplicationsState, subscribeMarketImplications } from '@/services/market-implications-store';

function directionClass(dir: string): string {
  const d = dir.toUpperCase();
  if (d === 'LONG') return 'badge-bullish';
  if (d === 'SHORT') return 'badge-bearish';
  return 'badge-neutral';
}

function confidenceClass(conf: string): string {
  const c = conf.toUpperCase();
  if (c === 'HIGH') return 'badge-bullish';
  if (c === 'LOW') return 'badge-bearish';
  return 'badge-neutral';
}

function directionLabel(dir: string): string {
  const d = dir.toUpperCase();
  if (d === 'LONG') return t('components.marketImplications.directions.long');
  if (d === 'SHORT') return t('components.marketImplications.directions.short');
  return t('components.marketImplications.directions.hedge');
}

function TransmissionChain({ chain }: { chain: TransmissionNode[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (chain.length === 0) return null;

  return (
    <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '6px', lineHeight: 1.8 }}>
      <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6 }}>
        {t('components.marketImplications.rationale')}
      </span>{' '}
      {chain.map((n, i) => (
        <span key={i}>
          <span
            style={{ cursor: 'pointer', borderBottom: '1px dotted var(--text-dim)' }}
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
          >
            {n.node}
          </span>
          {i < chain.length - 1 && (
            <span style={{ color: 'var(--text-dim)', margin: '0 2px' }}>&rarr;</span>
          )}
        </span>
      ))}
      {openIdx !== null && chain[openIdx] && (
        <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontStyle: 'italic', marginTop: '2px', paddingLeft: '4px' }}>
          {chain[openIdx].logic}
        </div>
      )}
    </div>
  );
}

function ImplicationCard({ card }: { card: MarketImplicationCard }) {
  return (
    <div className="signal-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <span className={`signal-badge ${directionClass(card.direction)}`}>{directionLabel(card.direction)}</span>
        <strong style={{ fontSize: '14px', letterSpacing: '-0.02em' }}>{card.ticker}</strong>
        {card.name && <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{card.name}</span>}
        {card.timeframe && (
          <span className="signal-badge badge-neutral" style={{ fontFamily: 'var(--font-mono)' }}>{card.timeframe}</span>
        )}
        {card.confidence && (
          <span className={`signal-badge ${confidenceClass(card.confidence)}`}>{card.confidence}</span>
        )}
      </div>
      <div style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.4, marginBottom: '6px' }}>{card.title}</div>
      <div style={{ fontSize: '12px', lineHeight: 1.55, color: 'var(--text-dim)' }}>{card.narrative}</div>
      {card.transmissionChain && card.transmissionChain.length > 0 && (
        <TransmissionChain chain={card.transmissionChain} />
      )}
      {card.driver && (
        <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '6px' }}>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('components.marketImplications.driver')}
          </span>{' '}
          {card.driver}
        </div>
      )}
      {card.riskCaveat && (
        <div style={{
          fontSize: '11px', color: 'var(--yellow)', padding: '6px 8px', marginTop: '6px',
          border: '1px solid color-mix(in srgb,var(--yellow) 30%,transparent)',
          background: 'color-mix(in srgb,var(--yellow) 8%,transparent)',
        }}>
          {card.riskCaveat}
        </div>
      )}
    </div>
  );
}

export function MarketImplicationsPanelContent() {
  const [state, setState] = useState(getMarketImplicationsState);

  useEffect(() => subscribeMarketImplications(setState), []);

  if (state === undefined) {
    return <div className="panel-loading">{t('components.marketImplications.loading')}</div>;
  }

  if (state === null || state.degraded || state.cards.length === 0) {
    return (
      <div style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.5, padding: '16px 0', textAlign: 'center' }}>
        {t('components.marketImplications.unavailable')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {state.cards.map((card, i) => (
        <ImplicationCard key={`${card.ticker}-${i}`} card={card} />
      ))}
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', padding: '8px', borderTop: '1px solid var(--border)', lineHeight: 1.5, textAlign: 'center' }}>
        {t('components.marketImplications.disclaimer')}
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

export function MarketImplicationsPanel() {
  const { locked, onLockedCtaClick } = usePremiumGate();
  return (
    <PanelShell
      id="market-implications"
      title={t('components.marketImplications.title')}
      infoTooltip={t('components.marketImplications.infoTooltip')}
      locked={locked}
      onLockedCtaClick={onLockedCtaClick}
    >
      <MarketImplicationsPanelContent />
    </PanelShell>
  );
}
