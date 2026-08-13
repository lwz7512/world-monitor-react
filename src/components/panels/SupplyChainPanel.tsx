import {
  useState, useEffect, useRef, useCallback,
} from 'react';
import { t } from '@/services/i18n';
import type {
  GetShippingRatesResponse,
  GetChokepointStatusResponse,
  GetCriticalMineralsResponse,
  GetShippingStressResponse,
  BypassOption,
  TransitDayCount,
} from '@/generated/client/worldmonitor/supply_chain/v1/service_client';
import { fetchBypassOptions, fetchChokepointHistory } from '@/services/supply-chain';
import type { ScenarioResult } from '@/config/scenario-templates';
import { SCENARIO_TEMPLATES } from '@/config/scenario-templates';
import { TransitChart } from '@/utils/transit-chart';
import { isFeatureAvailable } from '@/services/runtime-config';
import { isDesktopRuntime } from '@/services/runtime';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { hasPremiumAccess } from '@/services/panel-gating';
import { trackGateHit } from '@/services/analytics';
import { runScenario as runScenarioRpc, getScenarioStatus } from '@/services/scenario';
import {
  shippingRatesChannel, chokepointStatusChannel,
  criticalMineralsChannel, shippingStressChannel,
} from '@/services/supply-chain-data-store';
import {
  type ActiveScenarioState, getScenarioState, subscribeScenarioState,
} from '@/services/supply-chain-scenario-store';
import { PanelShell } from '@/components/PanelShell';

// ── Types ─────────────────────────────────────────────────────────────────────

type TabId = 'chokepoints' | 'shipping' | 'indicators' | 'minerals' | 'stress';

const FLOW_SUPPORTED_IDS = new Set(['hormuz_strait', 'malacca_strait', 'suez', 'bab_el_mandeb']);

// ── Pure sparkline SVG ────────────────────────────────────────────────────────

function SparklineSvg({ values, dates }: { values: number[]; dates?: string[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 200; const h = 40;
  const totalH = dates?.length ? h + 14 : h;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={totalH} viewBox={`0 0 ${w} ${totalH}`} style={{ display: 'block', margin: '4px 0' }}>
      <polyline points={pts} fill="none" stroke="var(--accent-primary, #4fc3f7)" strokeWidth="1.5" />
      {dates?.length ? (
        <>
          <text x="0" y={totalH - 1} fill="var(--text-dim,#888)" fontSize="9" textAnchor="start">{dates[0]!.slice(0, 7)}</text>
          <text x={w} y={totalH - 1} fill="var(--text-dim,#888)" fontSize="9" textAnchor="end">{dates[dates.length - 1]!.slice(0, 7)}</text>
        </>
      ) : null}
    </svg>
  );
}

// ── Transit chart (imperative D3) ─────────────────────────────────────────────

function TransitChartMount({
  cpId,
  historyCache,
  historyInflight,
}: {
  cpId: string;
  historyCache: Map<string, TransitDayCount[]>;
  historyInflight: Set<string>;
}) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = divRef.current;
    if (!el || !cpId) return;
    el.innerHTML = t('components.supplyChain.loadingHistory') || 'Loading transit history…';

    const cached = historyCache.get(cpId);
    if (cached?.length) {
      el.innerHTML = '';
      const chart = new TransitChart();
      chart.mount(el, cached);
      return () => chart.destroy();
    }

    if (historyInflight.has(cpId)) return;
    historyInflight.add(cpId);
    let cancelled = false;

    void fetchChokepointHistory(cpId).then(resp => {
      historyInflight.delete(cpId);
      if (cancelled) return;
      const liveEl = divRef.current;
      if (!liveEl) return;
      if (resp.history.length) {
        historyCache.set(cpId, resp.history);
        liveEl.innerHTML = '';
        const chart = new TransitChart();
        chart.mount(liveEl, resp.history);
        // chart lives until component unmounts (next cleanup)
      } else {
        liveEl.textContent = t('components.supplyChain.historyUnavailable') || 'History unavailable';
      }
    }).catch(() => {
      historyInflight.delete(cpId);
      if (!cancelled && divRef.current) {
        divRef.current.textContent = t('components.supplyChain.historyUnavailable') || 'History unavailable';
      }
    });

    return () => { cancelled = true; historyInflight.delete(cpId); };
  }, [cpId, historyCache, historyInflight]);

  return (
    <div
      ref={divRef}
      style={{ marginTop: 8, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12 }}
    />
  );
}

// ── Bypass section ────────────────────────────────────────────────────────────

type BypassContent = 'loading' | 'gate' | 'error' | BypassOption[];

function BypassSection({ chokepointId }: { chokepointId: string }) {
  const [content, setContent] = useState<BypassContent>('loading');
  const gateTrackedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    gateTrackedRef.current = false;

    const isPro = hasPremiumAccess(getAuthState());

    if (!isPro) {
      setContent('gate');
      if (!gateTrackedRef.current) { trackGateHit('bypass-corridors'); gateTrackedRef.current = true; }
      const unsub = subscribeAuthState(state => {
        if (!hasPremiumAccess(state)) return;
        unsub();
        if (cancelled) return;
        setContent('loading');
        fetchBypassOptions(chokepointId, 'container', 100)
          .then(resp => { if (!cancelled) setContent(resp.options); })
          .catch(() => { if (!cancelled) setContent('error'); });
      });
      return () => { cancelled = true; unsub(); };
    }

    fetchBypassOptions(chokepointId, 'container', 100)
      .then(resp => { if (!cancelled) setContent(resp.options); })
      .catch(() => { if (!cancelled) setContent('error'); });

    return () => { cancelled = true; };
  }, [chokepointId]);

  const WAR_RISK_LABELS: Record<string, string> = {
    WAR_RISK_TIER_WAR_ZONE: 'War Zone', WAR_RISK_TIER_CRITICAL: 'Critical',
    WAR_RISK_TIER_HIGH: 'High', WAR_RISK_TIER_ELEVATED: 'Elevated', WAR_RISK_TIER_NORMAL: 'Normal',
  };

  return (
    <div className="sc-bypass-section">
      <div className="sc-bypass-heading">Bypass Options</div>
      {content === 'loading' && <div className="sc-bypass-loading">Loading bypass options…</div>}
      {content === 'gate' && (
        <div className="sc-bypass-gate">
          <span className="sc-bypass-lock">🔒</span>
          <span className="sc-bypass-gate-text">Bypass corridors available with PRO</span>
        </div>
      )}
      {content === 'error' && <div className="sc-bypass-error">Bypass data unavailable</div>}
      {Array.isArray(content) && (
        content.length === 0
          ? <div className="sc-bypass-error">No bypass options available</div>
          : (
            <table className="sc-bypass-table">
              <thead><tr><th>Corridor</th><th>+Days</th><th>+Cost</th><th>Risk</th></tr></thead>
              <tbody>
                {content.slice(0, 3).map((opt, i) => {
                  const days = opt.addedTransitDays > 0 ? `+${opt.addedTransitDays}d` : '-';
                  const cost = opt.addedCostMultiplier > 1 ? `+${((opt.addedCostMultiplier - 1) * 100).toFixed(0)}%` : '-';
                  const risk = WAR_RISK_LABELS[opt.bypassWarRiskTier] ?? opt.bypassWarRiskTier;
                  return <tr key={i}><td>{opt.name}</td><td>{days}</td><td>{cost}</td><td>{risk}</td></tr>;
                })}
              </tbody>
            </table>
          )
      )}
    </div>
  );
}

// ── Scenario banner ───────────────────────────────────────────────────────────

function ScenarioBanner({
  state,
  onDismiss,
}: {
  state: ActiveScenarioState;
  onDismiss: () => void;
}) {
  const { scenarioId, result } = state;
  const tpl = result.template;
  const scenarioName = SCENARIO_TEMPLATES.find(t => t.id === scenarioId)?.name ?? scenarioId.replace(/-/g, ' ');
  const top5 = result.topImpactCountries.slice(0, 5);
  const durationStr = tpl ? `${tpl.durationDays}d` : null;
  const costBumpPct = tpl ? Math.round((tpl.costShockMultiplier - 1) * 100) : null;
  const costStr = costBumpPct != null && costBumpPct > 0 ? `+${costBumpPct}% cost` : null;
  const closurePctStr = tpl ? `${tpl.disruptionPct}% closure` : null;
  const taglineParts = [durationStr, closurePctStr, costStr].filter(Boolean).join(' / ');

  return (
    <div className="sc-scenario-banner">
      <div className="sc-scenario-top">
        <span className="sc-scenario-icon">⚠</span>
        <span className="sc-scenario-name">{scenarioName}</span>
        {(durationStr || costStr) && (
          <span className="sc-scenario-params">
            {[durationStr, costStr].filter(Boolean).map((s, i) => (
              <span key={i} className="sc-scenario-param">{s}</span>
            ))}
          </span>
        )}
        <span className="sc-scenario-countries">
          {top5.map((c, i) => (
            <span key={i} className="sc-scenario-country">{c.iso2} <em>{c.impactPct.toFixed(0)}%</em></span>
          ))}
        </span>
        <button className="sc-scenario-dismiss" aria-label="Dismiss scenario" onClick={onDismiss}>×</button>
      </div>
      {taglineParts && (
        <div className="sc-scenario-tagline">
          Simulating {taglineParts} on {result.affectedChokepointIds.length} chokepoint{result.affectedChokepointIds.length === 1 ? '' : 's'}. Chokepoint card below shows projected score; map highlights disrupted routes.
        </div>
      )}
    </div>
  );
}

// ── Chokepoints tab ───────────────────────────────────────────────────────────

function ChokepointsTab({
  chokepointData,
  expandedChokepoint,
  onToggle,
  activeScenario,
  onRunScenario,
  historyCache,
  historyInflight,
}: {
  chokepointData: GetChokepointStatusResponse;
  expandedChokepoint: string | null;
  onToggle: (name: string) => void;
  activeScenario: ActiveScenarioState | null;
  onRunScenario: (scenarioId: string) => void;
  historyCache: Map<string, TransitDayCount[]>;
  historyInflight: Set<string>;
}) {
  const { chokepoints } = chokepointData;
  if (!chokepoints?.length) return <div className="economic-empty">{t('components.supplyChain.noChokepoints')}</div>;

  const sorted = [...chokepoints].sort((a, b) => b.disruptionScore - a.disruptionScore);
  const affectedSet = new Set(activeScenario?.result.affectedChokepointIds ?? []);
  const projectedScore = activeScenario?.result.template?.disruptionPct ?? null;

  return (
    <div className="trade-restrictions-list">
      {sorted.map(cp => {
        const isAffected = affectedSet.has(cp.id);
        const expanded = expandedChokepoint === cp.name;
        const ts = cp.transitSummary;
        const statusDot = cp.status === 'red' ? 'sc-dot-red' : cp.status === 'yellow' ? 'sc-dot-yellow' : 'sc-dot-green';
        const statusClass = cp.status === 'red' ? 'status-active' : cp.status === 'yellow' ? 'status-notified' : 'status-terminated';
        const aisDisruptions = cp.aisDisruptions ?? (cp.congestionLevel === 'normal' ? 0 : 1);
        const wowPct = ts?.wowChangePct ?? 0;
        const hasWow = ts && wowPct !== 0;
        const disruptPct = ts?.disruptionPct ?? 0;
        const disruptClass = disruptPct > 10 ? 'sc-disrupt-red' : disruptPct > 3 ? 'sc-disrupt-yellow' : 'sc-disrupt-green';
        const riskClass = (ts?.riskLevel === 'critical' || ts?.riskLevel === 'high') ? 'sc-disrupt-red'
          : (ts?.riskLevel === 'elevated' || ts?.riskLevel === 'moderate') ? 'sc-disrupt-yellow' : 'sc-disrupt-green';
        const tier = cp.warRiskTier ?? 'WAR_RISK_TIER_NORMAL';
        const tierLabel: Record<string, string> = { WAR_RISK_TIER_WAR_ZONE: 'War Zone', WAR_RISK_TIER_CRITICAL: 'Critical', WAR_RISK_TIER_HIGH: 'High', WAR_RISK_TIER_ELEVATED: 'Elevated', WAR_RISK_TIER_NORMAL: 'Normal' };
        const tierClass: Record<string, string> = { WAR_RISK_TIER_WAR_ZONE: 'war', WAR_RISK_TIER_CRITICAL: 'critical', WAR_RISK_TIER_HIGH: 'high', WAR_RISK_TIER_ELEVATED: 'elevated', WAR_RISK_TIER_NORMAL: 'normal' };
        const showProjection = isAffected && projectedScore != null && projectedScore > cp.disruptionScore;
        const template = expanded ? SCENARIO_TEMPLATES.find(tmpl => tmpl.affectedChokepointIds.includes(cp.id) && tmpl.type !== 'tariff_shock') : null;
        const isPro = hasPremiumAccess(getAuthState());
        const isActiveScenario = activeScenario?.scenarioId === template?.id;

        return (
          <div
            key={cp.id}
            className={`trade-restriction-card${expanded ? ' expanded' : ''}${isAffected ? ' scenario-affected' : ''}`}
            style={{ cursor: 'pointer', ...(isAffected ? { borderLeft: '3px solid #dc2626' } : {}) }}
            onClick={() => onToggle(cp.name)}
          >
            <div className="trade-restriction-header">
              <span className="trade-country">{cp.name}</span>
              <span className={`sc-status-dot ${statusDot}`} />
              <span className="trade-badge">{cp.disruptionScore}/100</span>
              {showProjection && <span className="trade-badge trade-badge--projected" style={{ background: '#7f1d1d', color: '#fff', marginLeft: 4 }}>→ {projectedScore}/100</span>}
              <span className={`trade-status ${statusClass}`}>{cp.status}</span>
            </div>
            <div className="trade-restriction-body">
              {isAffected && activeScenario?.result.template && (
                <div className="sc-metric-row" style={{ background: '#7f1d1d22', padding: '4px 6px', borderRadius: 3, marginBottom: 4, fontSize: 11 }}>
                  <span style={{ color: '#fca5a5', fontWeight: 600 }}>⚠ Projected under scenario: {activeScenario.result.template.disruptionPct}% closure for {activeScenario.result.template.durationDays} days{activeScenario.result.template.costShockMultiplier > 1 ? ` (+${Math.round((activeScenario.result.template.costShockMultiplier - 1) * 100)}% cost)` : ''}</span>
                </div>
              )}
              <div className="sc-metric-row">
                <span>{cp.activeWarnings} {t('components.supplyChain.warnings')} · {aisDisruptions} {t('components.supplyChain.aisDisruptions')}</span>
                {cp.directions?.length ? <span>{cp.directions.join('/')}</span> : null}
              </div>
              {ts && ts.dataAvailable === false && (
                <div className="sc-metric-row" style={{ opacity: 0.5, fontSize: 11 }}><span>{t('components.supplyChain.transitDataUnavailable') || 'Transit data unavailable (upstream partial)'}</span></div>
              )}
              {ts && ts.dataAvailable !== false && (ts.todayTotal > 0 || hasWow || disruptPct > 0) && (
                <div className="sc-metric-row">
                  {ts.todayTotal > 0 && <span>{ts.todayTotal} {t('components.supplyChain.vessels')}</span>}
                  {hasWow && <span>{t('components.supplyChain.wowChange')}: <span className={wowPct >= 0 ? 'change-positive' : 'change-negative'}>{wowPct >= 0 ? '▲' : '▼'}{Math.abs(wowPct).toFixed(1)}%</span></span>}
                  {disruptPct > 0 && <span>{t('components.supplyChain.disruption')}: <span className={disruptClass}>{disruptPct.toFixed(1)}%</span></span>}
                </div>
              )}
              {ts?.riskLevel && (
                <div className="sc-metric-row">
                  <span>{t('components.supplyChain.riskLevel')}: <span className={riskClass}>{ts.riskLevel}</span></span>
                  <span>{ts.incidentCount7d} {t('components.supplyChain.incidents7d')}</span>
                </div>
              )}
              <div className="sc-metric-row">
                <span className={`sc-war-risk-badge sc-war-risk-badge--${tierClass[tier] ?? 'normal'}`}>{tierLabel[tier] ?? 'Normal'}</span>
              </div>
              {cp.flowEstimate ? (() => {
                const fe = cp.flowEstimate;
                const pct = Math.round(fe.flowRatio * 100);
                const flowColor = fe.disrupted || pct < 85 ? '#ef4444' : pct < 95 ? '#f59e0b' : 'var(--text-dim,#888)';
                return (
                  <div className="sc-metric-row" style={{ color: flowColor }}>
                    <span>~{fe.currentMbd} mb/d <span style={{ opacity: 0.7 }}>({pct}% of {fe.baselineMbd} baseline)</span>
                      {fe.hazardAlertLevel && fe.hazardAlertName && (
                        <span style={{ background: '#ea580c', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 3, marginLeft: 4 }}>⚠ {fe.hazardAlertName.toUpperCase()}</span>
                      )}
                    </span>
                  </div>
                );
              })() : FLOW_SUPPORTED_IDS.has(cp.id) ? (
                <div className="sc-metric-row" style={{ color: 'var(--text-dim,#888)', fontSize: 11, opacity: 0.7 }}>
                  <span>{t('components.supplyChain.flowUnavailable')}</span>
                </div>
              ) : null}
              {cp.description && <div className="trade-description">{cp.description}</div>}
              <div className="trade-affected">{cp.affectedRoutes.slice(0, 3).join(', ')}</div>
              {expanded && ts?.riskReportAction && <div className="sc-routing-advisory">{ts.riskReportAction}</div>}
              {expanded && ts?.dataAvailable !== false && (
                <TransitChartMount cpId={cp.id} historyCache={historyCache} historyInflight={historyInflight} />
              )}
              {expanded && <BypassSection chokepointId={cp.id} />}
              {expanded && template && (
                <div
                  className="sc-scenario-trigger"
                  data-scenario-id={template.id}
                  data-chokepoint-id={cp.id}
                  onClick={e => { e.stopPropagation(); if (!isActiveScenario) onRunScenario(template.id); }}
                >
                  <button
                    className={['sc-scenario-btn', !isPro ? 'sc-scenario-btn--gated' : '', isActiveScenario ? 'sc-scenario-btn--active' : ''].filter(Boolean).join(' ')}
                    disabled={isActiveScenario}
                    aria-label={`Simulate ${template.name}`}
                  >
                    {isActiveScenario ? 'Active' : 'Simulate Closure'}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Shipping / Indicators tabs ────────────────────────────────────────────────

function IndexCard({ idx }: { idx: GetShippingRatesResponse['indices'][number] }) {
  const changeClass = idx.changePct >= 0 ? 'change-positive' : 'change-negative';
  const arrow = idx.changePct >= 0 ? '▲' : '▼';
  return (
    <div className="trade-restriction-card">
      {idx.spikeAlert && <div className="economic-warning">{t('components.supplyChain.spikeAlert')}</div>}
      <div className="trade-restriction-header">
        <span className="trade-country">{idx.name}</span>
        <span className="trade-badge">{idx.currentValue.toFixed(0)} {idx.unit}</span>
        <span className={`trade-flow-change ${changeClass}`}>{arrow} {Math.abs(idx.changePct).toFixed(1)}%</span>
      </div>
      <div className="trade-restriction-body">
        <SparklineSvg values={idx.history.map(h => h.value)} dates={idx.history.map(h => h.date)} />
      </div>
    </div>
  );
}

function ShippingTab({ shippingData, chokepointData }: { shippingData: GetShippingRatesResponse | null; chokepointData: GetChokepointStatusResponse | null }) {
  const CONTAINER = new Set(['SCFI', 'CCFI']);
  const BULK = new Set(['BDI', 'BCI', 'BPI', 'BSI', 'BHSI']);

  const cps = chokepointData?.chokepoints;
  const hasFred = (shippingData?.indices?.length ?? 0) > 0;

  const disruption = cps?.length ? (() => {
    if (!cps) return null;
    const sorted = [...cps].sort((a, b) => b.disruptionScore - a.disruptionScore);
    const rows = sorted.filter(cp => cp.disruptionScore > 0);
    const display = rows.length > 0 ? rows : sorted.slice(0, 5);
    return display;
  })() : null;

  if (!hasFred && !disruption) return <div className="economic-empty">{t('components.supplyChain.noShipping')}</div>;

  const containerIndices = shippingData?.indices.filter(i => CONTAINER.has(i.indexId)) ?? [];
  const bulkIndices = shippingData?.indices.filter(i => BULK.has(i.indexId)) ?? [];

  return (
    <div className="trade-restrictions-list">
      {disruption && (
        <div style={{ marginBottom: 8 }}>
          <div className="trade-sector" style={{ fontWeight: 600, marginBottom: 4 }}>{t('components.supplyChain.corridorDisruption')}</div>
          <table className="sc-disruption-table">
            <thead><tr><th>{t('components.supplyChain.corridor')}</th><th>{t('components.supplyChain.vessels')}</th><th>{t('components.supplyChain.wowChange')}</th><th>{t('components.supplyChain.disruption')}</th><th>{t('components.supplyChain.risk')}</th></tr></thead>
            <tbody>
              {disruption.map(cp => {
                const ts = cp.transitSummary;
                const statusDot = cp.status === 'red' ? 'sc-dot-red' : cp.status === 'yellow' ? 'sc-dot-yellow' : 'sc-dot-green';
                const wowPct = ts?.wowChangePct ?? 0;
                const disruptPct = ts?.disruptionPct ?? 0;
                const disruptClass = disruptPct > 10 ? 'sc-disrupt-red' : disruptPct > 3 ? 'sc-disrupt-yellow' : 'sc-disrupt-green';
                const riskLevel = ts?.riskLevel || '-';
                const riskClass = (riskLevel === 'critical' || riskLevel === 'high') ? 'sc-disrupt-red'
                  : (riskLevel === 'elevated' || riskLevel === 'moderate') ? 'sc-disrupt-yellow' : '';
                return (
                  <tr key={cp.id}>
                    <td><span className={`sc-status-dot ${statusDot}`} /> {cp.name}</td>
                    <td>{ts?.todayTotal ?? 0}</td>
                    <td>{wowPct !== 0 ? <span className={wowPct >= 0 ? 'change-positive' : 'change-negative'}>{wowPct >= 0 ? '▲' : '▼'}{Math.abs(wowPct).toFixed(1)}%</span> : '-'}</td>
                    <td><span className={disruptClass}>{disruptPct > 0 ? `${disruptPct.toFixed(1)}%` : '-'}</span></td>
                    <td>{riskClass ? <span className={riskClass}>{riskLevel}</span> : riskLevel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!isDesktopRuntime() || isFeatureAvailable('supplyChain') ? (
        <>
          {containerIndices.length > 0 && (
            <>
              <div className="trade-sector" style={{ fontWeight: 600, margin: '8px 0 4px' }}>{t('components.supplyChain.containerRates')}</div>
              {containerIndices.map(idx => <IndexCard key={idx.indexId} idx={idx} />)}
            </>
          )}
          {bulkIndices.length > 0 && (
            <>
              <div className="trade-sector" style={{ fontWeight: 600, margin: '8px 0 4px' }}>{t('components.supplyChain.bulkShipping')}</div>
              {bulkIndices.map(idx => <IndexCard key={idx.indexId} idx={idx} />)}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function IndicatorsTab({ shippingData }: { shippingData: GetShippingRatesResponse | null }) {
  if (isDesktopRuntime() && !isFeatureAvailable('supplyChain')) return null;
  if (!shippingData?.indices?.length) return <div className="economic-empty">{t('components.supplyChain.noShipping')}</div>;

  const CONTAINER = new Set(['SCFI', 'CCFI']); const BULK = new Set(['BDI', 'BCI', 'BPI', 'BSI', 'BHSI']);
  const econIndices = shippingData.indices.filter(i => !CONTAINER.has(i.indexId) && !BULK.has(i.indexId));
  if (!econIndices.length) return <div className="economic-empty">{t('components.supplyChain.noShipping')}</div>;

  return <div className="trade-restrictions-list">{econIndices.map(idx => <IndexCard key={idx.indexId} idx={idx} />)}</div>;
}

// ── Minerals tab ──────────────────────────────────────────────────────────────

function MineralsTab({ mineralsData }: { mineralsData: GetCriticalMineralsResponse | null }) {
  if (!mineralsData?.minerals?.length) return <div className="economic-empty">{t('components.supplyChain.noMinerals')}</div>;
  return (
    <div className="trade-tariffs-table">
      <table>
        <thead><tr><th>{t('components.supplyChain.mineral')}</th><th>{t('components.supplyChain.topProducers')}</th><th>HHI</th><th>{t('components.supplyChain.risk')}</th></tr></thead>
        <tbody>
          {mineralsData.minerals.map(m => {
            const riskClass = m.riskRating === 'critical' ? 'sc-risk-critical' : m.riskRating === 'high' ? 'sc-risk-high' : m.riskRating === 'moderate' ? 'sc-risk-moderate' : 'sc-risk-low';
            const top3 = m.topProducers.slice(0, 3).map(p => `${p.country} ${p.sharePct.toFixed(0)}%`).join(', ');
            return <tr key={m.mineral}><td>{m.mineral}</td><td>{top3}</td><td>{m.hhi.toFixed(0)}</td><td><span className={riskClass}>{m.riskRating}</span></td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Stress tab ────────────────────────────────────────────────────────────────

function StressTab({ stressData }: { stressData: GetShippingStressResponse | null }) {
  if (!stressData?.carriers?.length) return <div className="economic-empty">Shipping stress data unavailable</div>;
  const { stressScore, stressLevel, carriers } = stressData;
  const levelColor = stressLevel === 'critical' ? '#e74c3c' : stressLevel === 'elevated' ? '#e67e22' : stressLevel === 'moderate' ? '#f1c40f' : '#27ae60';
  const gaugeBg = stressLevel === 'critical' ? 'rgba(231,76,60,0.15)' : stressLevel === 'elevated' ? 'rgba(230,126,34,0.15)' : stressLevel === 'moderate' ? 'rgba(241,196,15,0.15)' : 'rgba(39,174,96,0.15)';
  const gaugeWidth = Math.round(Math.min(100, Math.max(0, stressScore)));
  return (
    <div className="trade-restrictions-list">
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Composite Stress Score</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 3, background: gaugeBg, color: levelColor }}>{stressLevel.toUpperCase()}</span>
        </div>
        <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${gaugeWidth}%`, borderRadius: 3, background: levelColor, transition: 'width 0.4s' }} />
        </div>
        <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{stressScore.toFixed(1)}/100</div>
      </div>
      {carriers.map(c => {
        const changeClass = c.changePct >= 0 ? 'change-positive' : 'change-negative';
        const arrow = c.changePct >= 0 ? '▲' : '▼';
        const typeLabel = c.carrierType === 'etf' ? 'ETF' : c.carrierType === 'index' ? 'IDX' : 'CARR';
        return (
          <div key={c.symbol} className="trade-restriction-card">
            <div className="trade-restriction-header">
              <span className="trade-country" style={{ fontSize: 11 }}>{c.symbol}</span>
              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 2, background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)' }}>{typeLabel}</span>
              <span className="trade-badge">{c.price.toFixed(2)}</span>
              <span className={`trade-flow-change ${changeClass}`}>{arrow} {Math.abs(c.changePct).toFixed(2)}%</span>
            </div>
            <div className="trade-restriction-body" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              {c.name}
              {c.sparkline?.length >= 2 && <SparklineSvg values={c.sparkline} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

export function SupplyChainPanelContent() {
  const [shippingData, setShippingData] = useState<GetShippingRatesResponse | null>(shippingRatesChannel.get);
  const [chokepointData, setChokepointData] = useState<GetChokepointStatusResponse | null>(chokepointStatusChannel.get);
  const [mineralsData, setMineralsData] = useState<GetCriticalMineralsResponse | null>(criticalMineralsChannel.get);
  const [stressData, setStressData] = useState<GetShippingStressResponse | null>(shippingStressChannel.get);
  const [activeTab, setActiveTab] = useState<TabId>('chokepoints');
  const [expandedChokepoint, setExpandedChokepoint] = useState<string | null>(null);
  const [activeScenario, setActiveScenario] = useState<ActiveScenarioState | null>(getScenarioState);

  const historyCacheRef = useRef<Map<string, TransitDayCount[]>>(new Map());
  const historyInflightRef = useRef<Set<string>>(new Set());
  const scenarioPollCtrlRef = useRef<AbortController | null>(null);

  useEffect(() => shippingRatesChannel.subscribe(setShippingData), []);
  useEffect(() => chokepointStatusChannel.subscribe(setChokepointData), []);
  useEffect(() => criticalMineralsChannel.subscribe(setMineralsData), []);
  useEffect(() => shippingStressChannel.subscribe(setStressData), []);
  useEffect(() => subscribeScenarioState(setActiveScenario), []);

  const handleToggle = useCallback((name: string) => {
    setExpandedChokepoint(prev => prev === name ? null : name);
  }, []);

  const handleTabChange = useCallback((tab: TabId) => {
    if (tab !== activeTab) {
      setExpandedChokepoint(null);
      setActiveTab(tab);
    }
  }, [activeTab]);

  const handleRunScenario = useCallback(async (scenarioId: string) => {
    const isPro = hasPremiumAccess(getAuthState());
    if (!isPro) { trackGateHit('scenario-engine'); return; }

    scenarioPollCtrlRef.current?.abort();
    scenarioPollCtrlRef.current = new AbortController();
    const { signal } = scenarioPollCtrlRef.current;

    try {
      const runSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
      const runResp = await runScenarioRpc({ scenarioId, iso2: '' }, { signal: runSignal });
      const jobId = runResp.jobId;
      let result: ScenarioResult | null = null;
      for (let i = 0; i < 60; i++) {
        if (signal.aborted) return;
        if (i > 0) await new Promise(r => setTimeout(r, 1000));
        const status = await getScenarioStatus(jobId, { signal });
        if (status.status === 'done') {
          const r = status.result;
          if (!r || !Array.isArray(r.topImpactCountries)) throw new Error('done without valid result');
          result = r;
          break;
        }
        if (status.status === 'failed') throw new Error('Scenario failed');
      }
      if (!result) throw new Error('Timeout');
      if (signal.aborted) return;
      window.dispatchEvent(new CustomEvent('wm:scenario-activate', { detail: { scenarioId, result } }));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[scenario] run failed:', err);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const anyUnavailable = (d: { upstreamUnavailable?: boolean } | null) => d?.upstreamUnavailable ?? false;
  const activeUnavailable = activeTab === 'chokepoints' ? anyUnavailable(chokepointData)
    : activeTab === 'shipping' || activeTab === 'indicators' ? anyUnavailable(shippingData)
    : activeTab === 'stress' ? anyUnavailable(stressData) : anyUnavailable(mineralsData);

  const TABS: { id: TabId; label: string }[] = [
    { id: 'chokepoints', label: t('components.supplyChain.chokepoints') },
    { id: 'shipping', label: t('components.supplyChain.shipping') },
    { id: 'indicators', label: t('components.supplyChain.economicIndicators') },
    { id: 'minerals', label: t('components.supplyChain.minerals') },
    { id: 'stress', label: 'Stress' },
  ];

  return (
    <>
      {activeScenario && (
        <ScenarioBanner state={activeScenario} onDismiss={() => window.dispatchEvent(new CustomEvent('wm:scenario-dismiss'))} />
      )}
      <div className="panel-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`panel-tab${activeTab === tab.id ? ' active' : ''}`}
            data-tab={tab.id}
            onClick={() => handleTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeUnavailable && (
        <div className="economic-warning">{t('components.supplyChain.upstreamUnavailable')}</div>
      )}
      <div className="economic-content">
        {activeTab === 'chokepoints' && chokepointData && (
          <ChokepointsTab
            chokepointData={chokepointData}
            expandedChokepoint={expandedChokepoint}
            onToggle={handleToggle}
            activeScenario={activeScenario}
            onRunScenario={handleRunScenario}
            historyCache={historyCacheRef.current}
            historyInflight={historyInflightRef.current}
          />
        )}
        {activeTab === 'chokepoints' && !chokepointData && <div className="economic-empty">{t('components.supplyChain.noChokepoints')}</div>}
        {activeTab === 'shipping' && <ShippingTab shippingData={shippingData} chokepointData={chokepointData} />}
        {activeTab === 'indicators' && <IndicatorsTab shippingData={shippingData} />}
        {activeTab === 'minerals' && <MineralsTab mineralsData={mineralsData} />}
        {activeTab === 'stress' && <StressTab stressData={stressData} />}
      </div>
    </>
  );
}

export function SupplyChainPanel() {
  return (
    <PanelShell
      id="supply-chain"
      title={t('panels.supplyChain')}
      infoTooltip={t('components.supplyChain.infoTooltip')}
      defaultRowSpan={2}
    >
      <SupplyChainPanelContent />
    </PanelShell>
  );
}
