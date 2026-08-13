import type { CSSProperties } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import {
  fetchCrossSourceSignals,
  type ListCrossSourceSignalsResponse,
} from '@/services/cross-source-signals';
import type { CrossSourceSignal } from '@/generated/client/worldmonitor/intelligence/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

const SEVERITY_COLOR: Record<string, string> = {
  CROSS_SOURCE_SIGNAL_SEVERITY_CRITICAL: 'var(--semantic-critical)',
  CROSS_SOURCE_SIGNAL_SEVERITY_HIGH: '#ff8c8c',
  CROSS_SOURCE_SIGNAL_SEVERITY_MEDIUM: 'var(--yellow)',
  CROSS_SOURCE_SIGNAL_SEVERITY_LOW: 'var(--text-dim)',
};

const SEVERITY_LABEL: Record<string, string> = {
  CROSS_SOURCE_SIGNAL_SEVERITY_CRITICAL: 'CRITICAL',
  CROSS_SOURCE_SIGNAL_SEVERITY_HIGH: 'HIGH',
  CROSS_SOURCE_SIGNAL_SEVERITY_MEDIUM: 'MED',
  CROSS_SOURCE_SIGNAL_SEVERITY_LOW: 'LOW',
};

const SEVERITY_BADGE_BG: Record<string, string> = {
  CROSS_SOURCE_SIGNAL_SEVERITY_CRITICAL: 'var(--semantic-critical)',
  CROSS_SOURCE_SIGNAL_SEVERITY_HIGH: 'rgba(255,140,140,0.15)',
  CROSS_SOURCE_SIGNAL_SEVERITY_MEDIUM: 'rgba(245,197,66,0.08)',
  CROSS_SOURCE_SIGNAL_SEVERITY_LOW: 'transparent',
};

const SEVERITY_BADGE_COLOR: Record<string, string> = {
  CROSS_SOURCE_SIGNAL_SEVERITY_CRITICAL: '#fff',
  CROSS_SOURCE_SIGNAL_SEVERITY_HIGH: '#ff8c8c',
  CROSS_SOURCE_SIGNAL_SEVERITY_MEDIUM: 'var(--yellow)',
  CROSS_SOURCE_SIGNAL_SEVERITY_LOW: 'var(--text-dim)',
};

const SEVERITY_BADGE_BORDER: Record<string, string> = {
  CROSS_SOURCE_SIGNAL_SEVERITY_CRITICAL: '1px solid var(--semantic-critical)',
  CROSS_SOURCE_SIGNAL_SEVERITY_HIGH: '1px solid rgba(255,140,140,0.4)',
  CROSS_SOURCE_SIGNAL_SEVERITY_MEDIUM: '1px solid rgba(245,197,66,0.35)',
  CROSS_SOURCE_SIGNAL_SEVERITY_LOW: '1px solid var(--border)',
};

const TYPE_LABEL: Record<string, string> = {
  CROSS_SOURCE_SIGNAL_TYPE_COMPOSITE_ESCALATION: 'COMPOSITE',
  CROSS_SOURCE_SIGNAL_TYPE_THERMAL_SPIKE: 'THERMAL',
  CROSS_SOURCE_SIGNAL_TYPE_GPS_JAMMING: 'GPS JAM',
  CROSS_SOURCE_SIGNAL_TYPE_MILITARY_FLIGHT_SURGE: 'MIL FLTX',
  CROSS_SOURCE_SIGNAL_TYPE_UNREST_SURGE: 'UNREST',
  CROSS_SOURCE_SIGNAL_TYPE_OREF_ALERT_CLUSTER: 'ADVISORY',
  CROSS_SOURCE_SIGNAL_TYPE_VIX_SPIKE: 'VIX',
  CROSS_SOURCE_SIGNAL_TYPE_COMMODITY_SHOCK: 'COMDTY',
  CROSS_SOURCE_SIGNAL_TYPE_CYBER_ESCALATION: 'CYBER',
  CROSS_SOURCE_SIGNAL_TYPE_SHIPPING_DISRUPTION: 'SHIPPING',
  CROSS_SOURCE_SIGNAL_TYPE_SANCTIONS_SURGE: 'SANCTIONS',
  CROSS_SOURCE_SIGNAL_TYPE_EARTHQUAKE_SIGNIFICANT: 'QUAKE',
  CROSS_SOURCE_SIGNAL_TYPE_RADIATION_ANOMALY: 'RADIATION',
  CROSS_SOURCE_SIGNAL_TYPE_INFRASTRUCTURE_OUTAGE: 'INFRA',
  CROSS_SOURCE_SIGNAL_TYPE_WILDFIRE_ESCALATION: 'WILDFIRE',
  CROSS_SOURCE_SIGNAL_TYPE_DISPLACEMENT_SURGE: 'DISPLCMT',
  CROSS_SOURCE_SIGNAL_TYPE_FORECAST_DETERIORATION: 'FORECAST',
  CROSS_SOURCE_SIGNAL_TYPE_MARKET_STRESS: 'MARKET',
  CROSS_SOURCE_SIGNAL_TYPE_WEATHER_EXTREME: 'WEATHER',
  CROSS_SOURCE_SIGNAL_TYPE_MEDIA_TONE_DETERIORATION: 'MEDIA',
  CROSS_SOURCE_SIGNAL_TYPE_RISK_SCORE_SPIKE: 'RISK',
};

const TYPE_ICON: Record<string, string> = {
  CROSS_SOURCE_SIGNAL_TYPE_COMPOSITE_ESCALATION: '⚡',
  CROSS_SOURCE_SIGNAL_TYPE_THERMAL_SPIKE: '🔴',
  CROSS_SOURCE_SIGNAL_TYPE_EARTHQUAKE_SIGNIFICANT: '🔴',
  CROSS_SOURCE_SIGNAL_TYPE_RADIATION_ANOMALY: '🔴',
  CROSS_SOURCE_SIGNAL_TYPE_WILDFIRE_ESCALATION: '🔴',
  CROSS_SOURCE_SIGNAL_TYPE_GPS_JAMMING: '📡',
  CROSS_SOURCE_SIGNAL_TYPE_CYBER_ESCALATION: '📡',
  CROSS_SOURCE_SIGNAL_TYPE_MILITARY_FLIGHT_SURGE: '✈️',
  CROSS_SOURCE_SIGNAL_TYPE_VIX_SPIKE: '📊',
  CROSS_SOURCE_SIGNAL_TYPE_COMMODITY_SHOCK: '📊',
  CROSS_SOURCE_SIGNAL_TYPE_MARKET_STRESS: '📊',
  CROSS_SOURCE_SIGNAL_TYPE_RISK_SCORE_SPIKE: '📊',
};
const TYPE_ICON_DEFAULT = '⚠️';

function ageSuffix(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function SignalCard({ sig, index }: { sig: CrossSourceSignal; index: number }) {
  const isComposite = sig.type === 'CROSS_SOURCE_SIGNAL_TYPE_COMPOSITE_ESCALATION';
  const sevColor = SEVERITY_COLOR[sig.severity] ?? 'var(--text-dim)';
  const typeLabel = TYPE_LABEL[sig.type] ?? sig.type.replace('CROSS_SOURCE_SIGNAL_TYPE_', '');
  const typeIcon = TYPE_ICON[sig.type] ?? TYPE_ICON_DEFAULT;
  const age = ageSuffix(sig.detectedAt);

  const cardBorder: CSSProperties = isComposite
    ? { boxShadow: '0 0 0 1px rgba(255,80,80,0.3),0 2px 8px rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.25)' }
    : { border: '1px solid var(--border)' };

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', ...cardBorder, background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
      <div style={{ width: 4, flexShrink: 0, background: sevColor }} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', minWidth: 18, textAlign: 'right', flexShrink: 0, fontFamily: 'var(--font-mono)', paddingTop: 1 }}>
          {index + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
            <span style={{ fontSize: 10, padding: '2px 6px', border: '1px solid var(--border)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span>{typeIcon}</span>{typeLabel}
            </span>
            <span style={{
              fontSize: 10, padding: '2px 6px', fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700,
              background: SEVERITY_BADGE_BG[sig.severity] ?? 'transparent',
              color: SEVERITY_BADGE_COLOR[sig.severity] ?? 'var(--text-dim)',
              border: SEVERITY_BADGE_BORDER[sig.severity] ?? '1px solid var(--border)',
            }}>
              {SEVERITY_LABEL[sig.severity] ?? ''}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, padding: '2px 7px', fontSize: 10, color: 'rgba(232,234,237,0.65)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
              {sig.theater}
              <span style={{ opacity: 0.4 }}> · </span>
              {age}
            </span>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text)' }}>{sig.summary}</div>
          {isComposite && sig.contributingTypes.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
              {sig.contributingTypes.slice(0, 5).map(ct => (
                <span key={ct} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 5px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', borderRadius: 2 }}>
                  {ct}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

async function fetcher(_signal: AbortSignal): Promise<ListCrossSourceSignalsResponse> {
  return fetchCrossSourceSignals();
}

export function CrossSourceSignalsPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, { ttlMs: 15 * 60 * 1000 });

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
        <div className="panel-loading-text">Loading signal data…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.failedToLoad')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const signals = data.signals ?? [];

  if (signals.length === 0) {
    const hasEval = data.evaluatedAt != null && data.evaluatedAt > 0;
    return (
      <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
        {hasEval
          ? 'No cross-source signals detected.'
          : 'Signal aggregator is initializing. First evaluation runs within 15 minutes.'}
      </div>
    );
  }

  const compositeCount = data.compositeCount ?? 0;
  const evalTime = data.evaluatedAt && data.evaluatedAt > 0
    ? new Date(data.evaluatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {compositeCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--semantic-critical)', padding: '7px 10px', border: '1px solid rgba(255,80,80,0.3)', background: 'rgba(255,80,80,0.06)', marginBottom: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--semantic-critical)', flexShrink: 0, animation: 'cross-source-pulse-dot 2s ease-in-out infinite' }} />
          {compositeCount} composite escalation zone{compositeCount > 1 ? 's' : ''} detected
        </div>
      )}
      {signals.map((s, i) => <SignalCard key={s.id || i} sig={s} index={i} />)}
      {evalTime && (
        <div style={{ fontSize: 10, color: 'var(--text-dim)', paddingTop: 8, borderTop: '1px solid var(--border)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
          Evaluated {evalTime}
        </div>
      )}
    </div>
  );
}

export function CrossSourceSignalsPanel() {
  return (
    <PanelShell
      id="cross-source-signals"
      title="Cross-Source Signal Aggregator"
      showCount
      infoTooltip="Aggregates 15+ real-time data streams every 15 minutes. Ranks cross-domain signals by severity and detects composite escalation when 3 or more signal categories co-fire in the same theater."
    >
      <CrossSourceSignalsPanelContent />
    </PanelShell>
  );
}
