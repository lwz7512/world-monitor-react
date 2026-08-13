import { useState, useEffect, useRef, useCallback } from 'react';
import { t } from '@/services/i18n';
import type { ConvergenceCard, CorrelationDomain } from '@/services/correlation-engine';
import { readableTextColor } from '@/utils/contrast';
import { getHydratedData, ensureHydrated, waitForBootstrapSlowTier } from '@/services/bootstrap';
import { getGeoHubById } from '@/services/geo-hub-index';
import type { CrossStraitActivitySnapshot } from '@/types/cross-strait-activity';
import {
  crossStraitSourceHealthHeading,
  isCrossStraitActivitySnapshot,
  tryBuildCrossStraitActivityPanelModel,
} from '@/components/cross-strait-activity-summary';
import { getCorrelationCards, subscribeCorrelationCards } from '@/services/correlation-store';
import { PanelShell } from '@/components/PanelShell';

const SCORE_COLORS = {
  critical: '#ff4444',
  high: '#ff8800',
  medium: '#ffcc00',
  low: '#6f6f6f',
};

const TREND_ICONS: Record<string, { symbol: string; color: string }> = {
  escalating: { symbol: '↑', color: '#ff4444' },
  stable: { symbol: '→', color: '#888888' },
  'de-escalating': { symbol: '↓', color: '#44cc44' },
};

interface CardViewProps {
  card: ConvergenceCard;
  isExpanded: boolean;
  hasLiveData: boolean;
  onToggle: (id: string) => void;
  onMapNavigate: (lat: number, lon: number) => void;
}

function CorrelationCardView({ card, isExpanded, hasLiveData, onToggle, onMapNavigate }: CardViewProps) {
  const scoreColor =
    card.score >= 70 ? SCORE_COLORS.critical
    : card.score >= 50 ? SCORE_COLORS.high
    : card.score >= 30 ? SCORE_COLORS.medium
    : SCORE_COLORS.low;
  const trend = TREND_ICONS[card.trend] ?? TREND_ICONS.stable!;

  return (
    <div
      className="correlation-card"
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        marginBottom: 4,
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div
        className="correlation-card-header"
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: 8 }}
        onClick={() => onToggle(card.id)}
      >
        <span
          style={{
            display: 'inline-block',
            minWidth: 28,
            textAlign: 'center',
            padding: '2px 6px',
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 700,
            color: readableTextColor(scoreColor),
            background: scoreColor,
          }}
        >
          {card.score}
        </span>
        <span style={{ flex: 1, fontSize: 11, lineHeight: 1.3 }}>{card.title}</span>
        <span style={{ fontSize: 9, opacity: 0.6, whiteSpace: 'nowrap' }}>
          {t('components.correlation.signals', { count: card.signals.length })}
        </span>
        <span style={{ fontSize: 12, color: trend.color }}>{trend.symbol}</span>
      </div>
      {isExpanded && (
        <div
          className="correlation-card-detail"
          style={{
            display: 'block',
            padding: '0 8px 8px',
            fontSize: 10,
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div style={{ padding: '6px 0' }}>
            {card.signals.slice(0, 10).map((s, i) => (
              <div key={i} style={{ padding: '2px 0', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span
                  style={{
                    fontSize: 8,
                    padding: '1px 4px',
                    borderRadius: 3,
                    background: 'rgba(255,255,255,0.1)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.type}
                </span>
                <span style={{ opacity: 0.8 }}>{s.label}</span>
              </div>
            ))}
          </div>
          {card.assessment ? (
            <div
              style={{
                padding: '6px 8px',
                margin: '4px 0',
                borderRadius: 4,
                background: 'rgba(100,150,255,0.08)',
                borderLeft: '2px solid rgba(100,150,255,0.3)',
                fontSize: 10,
                lineHeight: 1.4,
              }}
            >
              {card.assessment}
            </div>
          ) : card.score >= 60 && hasLiveData ? (
            <div style={{ padding: 4, fontSize: 9, opacity: 0.4, fontStyle: 'italic' }}>
              {t('components.correlation.analyzing')}
            </div>
          ) : null}
          {card.location && (
            <button
              style={{
                marginTop: 4,
                padding: '3px 8px',
                fontSize: 9,
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 3,
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
              onClick={e => {
                e.stopPropagation();
                onMapNavigate(card.location!.lat, card.location!.lon);
              }}
            >
              {t('components.correlation.viewOnMap')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OfficialSourceLabel({ label, sourceUrl }: { label: string; sourceUrl: string }) {
  if (!sourceUrl) return <span>{label}</span>;
  return (
    <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
      {label}
    </a>
  );
}

function CrossStraitSupplement({
  snapshot,
  onMapNavigate,
}: {
  snapshot: CrossStraitActivitySnapshot;
  onMapNavigate: (lat: number, lon: number) => void;
}) {
  const model = tryBuildCrossStraitActivityPanelModel(snapshot);
  if (!model) return null;

  return (
    <section
      className="cross-strait-official-activity"
      style={{
        padding: 8,
        marginBottom: 8,
        border: '1px solid rgba(100,150,255,0.2)',
        borderRadius: 6,
        background: 'rgba(100,150,255,0.05)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <strong style={{ fontSize: 11 }}>{model.heading}</strong>
        <span style={{ fontSize: 9, opacity: 0.6, textAlign: 'right' }}>{model.coverageLabel}</span>
      </div>
      <div style={{ fontSize: 9, lineHeight: 1.35, opacity: 0.72, margin: '4px 0 8px' }}>
        {model.disclaimer}
      </div>
      {model.sourceHealth && (
        <div
          role="status"
          style={{
            fontSize: 8,
            lineHeight: 1.35,
            margin: '0 0 7px',
            padding: 5,
            borderLeft: '2px solid #ff9800',
            background: 'rgba(255,152,0,0.10)',
          }}
        >
          <strong>{crossStraitSourceHealthHeading(model.sourceHealth.state)}</strong>
          <div style={{ opacity: 0.82 }}>{model.sourceHealth.summary}</div>
          {model.sourceHealth.sources.map((source, i) => (
            <div key={i} style={{ marginTop: 2 }}>
              {source.publisher}: {source.transportStatus}; errors:{' '}
              {source.errorCodes.join(', ') || 'none'}; last success:{' '}
              {source.lastSuccessAt ?? 'not recorded'}
            </div>
          ))}
        </div>
      )}
      {model.mnd && (
        <>
          <div style={{ fontSize: 10, marginBottom: 5 }}>
            <OfficialSourceLabel label={model.mnd.publisher} sourceUrl={model.mnd.sourceUrl} />
            <div style={{ fontSize: 9, opacity: 0.65 }}>{model.mnd.reportingLabel}</div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2,minmax(0,1fr))',
              gap: 4,
              marginBottom: 8,
            }}
          >
            {model.mnd.categories.map((cat, i) => (
              <div
                key={i}
                style={{ padding: 5, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4 }}
              >
                <div style={{ fontSize: 9, opacity: 0.7 }}>{cat.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{cat.current}</div>
                {cat.comparisons.map((comp, j) => (
                  <div
                    key={j}
                    style={{ fontSize: 8, opacity: comp.state === 'sufficient' ? 0.72 : 0.5 }}
                  >
                    {comp.label} · {comp.coverage}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      {model.japan.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 700, margin: '5px 0 3px' }}>
            Reviewed Japan MOD regional augmentation
          </div>
          {model.japan.map((rec, i) => (
            <div key={i} style={{ fontSize: 9, lineHeight: 1.35, marginBottom: 4, opacity: 0.75 }}>
              <OfficialSourceLabel label={rec.label} sourceUrl={rec.sourceUrl} />
              {' · '}{rec.reportingLabel} · {rec.summary}
            </div>
          ))}
        </>
      )}
      <button
        type="button"
        style={{
          marginTop: 5,
          padding: '3px 8px',
          fontSize: 9,
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 3,
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
        }}
        onClick={() => {
          const hub = getGeoHubById('taiwan-strait');
          if (hub) onMapNavigate(hub.lat, hub.lon);
        }}
      >
        View Taiwan Strait
      </button>
    </section>
  );
}

interface CorrelationContentProps {
  domain: CorrelationDomain;
  includeMilitarySupplement?: boolean;
}

function CorrelationPanelContent({ domain, includeMilitarySupplement }: CorrelationContentProps) {
  const [cards, setCards] = useState<ConvergenceCard[]>(() => getCorrelationCards(domain));
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [hasLiveData, setHasLiveData] = useState(false);
  const [officialActivity, setOfficialActivity] = useState<CrossStraitActivitySnapshot | null>(null);
  const destroyedRef = useRef(false);

  useEffect(() => {
    return subscribeCorrelationCards((d, updatedCards) => {
      if (d !== domain) return;
      setCards(updatedCards);
      setHasLiveData(true);
    });
  }, [domain]);

  // Cross-strait supplement for Military domain
  useEffect(() => {
    if (!includeMilitarySupplement) return;
    const hydrated = getHydratedData('crossStraitActivity');
    if (isCrossStraitActivitySnapshot(hydrated)) {
      setOfficialActivity(hydrated);
      return;
    }
    let cancelled = false;
    void (async () => {
      await waitForBootstrapSlowTier();
      if (cancelled || destroyedRef.current) return;
      const tierSnapshot = getHydratedData('crossStraitActivity');
      const snapshot = tierSnapshot ?? await ensureHydrated('crossStraitActivity');
      if (cancelled || destroyedRef.current || !isCrossStraitActivitySnapshot(snapshot)) return;
      setOfficialActivity(snapshot);
    })();
    return () => { cancelled = true; };
  }, [includeMilitarySupplement]);

  useEffect(() => {
    return () => { destroyedRef.current = true; };
  }, []);

  const handleToggle = useCallback((id: string) => {
    setExpandedCard(prev => prev === id ? null : id);
  }, []);

  const handleMapNavigate = useCallback((lat: number, lon: number) => {
    window.dispatchEvent(new CustomEvent('wm:correlation-map-focus', { detail: { lat, lon } }));
  }, []);

  return (
    <div>
      {includeMilitarySupplement && officialActivity && (
        <CrossStraitSupplement snapshot={officialActivity} onMapNavigate={handleMapNavigate} />
      )}
      {cards.length === 0 ? (
        <div
          className="correlation-empty"
          style={{ padding: 12, textAlign: 'center', opacity: 0.5, fontSize: 11 }}
        >
          {t('components.correlation.empty')}
        </div>
      ) : (
        <div className="correlation-cards">
          {cards.map(card => (
            <CorrelationCardView
              key={card.id}
              card={card}
              isExpanded={expandedCard === card.id}
              hasLiveData={hasLiveData}
              onToggle={handleToggle}
              onMapNavigate={handleMapNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MilitaryCorrelationPanelContent() {
  return <CorrelationPanelContent domain="military" includeMilitarySupplement />;
}

export function EscalationCorrelationPanelContent() {
  return <CorrelationPanelContent domain="escalation" />;
}

export function EconomicCorrelationPanelContent() {
  return <CorrelationPanelContent domain="economic" />;
}

export function DisasterCorrelationPanelContent() {
  return <CorrelationPanelContent domain="disaster" />;
}

export function MilitaryCorrelationPanel() {
  return (
    <PanelShell
      id="military-correlation"
      title="Force Posture"
      infoTooltip={t('components.militaryCorrelation.infoTooltip')}
    >
      <MilitaryCorrelationPanelContent />
    </PanelShell>
  );
}

export function EscalationCorrelationPanel() {
  return (
    <PanelShell
      id="escalation-correlation"
      title="Escalation Monitor"
      infoTooltip={t('components.escalationCorrelation.infoTooltip')}
    >
      <EscalationCorrelationPanelContent />
    </PanelShell>
  );
}

export function EconomicCorrelationPanel() {
  return (
    <PanelShell
      id="economic-correlation"
      title="Economic Warfare"
      infoTooltip={t('components.economicCorrelation.infoTooltip')}
    >
      <EconomicCorrelationPanelContent />
    </PanelShell>
  );
}

export function DisasterCorrelationPanel() {
  return (
    <PanelShell
      id="disaster-correlation"
      title="Disaster Cascade"
      infoTooltip={t('components.disasterCorrelation.infoTooltip')}
    >
      <DisasterCorrelationPanelContent />
    </PanelShell>
  );
}
