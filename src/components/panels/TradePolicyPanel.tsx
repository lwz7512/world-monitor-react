import { useState, useEffect } from 'react';
import { t } from '@/services/i18n';
import type {
  GetTradeRestrictionsResponse,
  GetTariffTrendsResponse,
  GetTradeFlowsResponse,
  GetTradeBarriersResponse,
  GetCustomsRevenueResponse,
  ListComtradeFlowsResponse,
  TariffDataPoint,
} from '@/services/trade';
import { isFeatureAvailable } from '@/services/runtime-config';
import { isDesktopRuntime } from '@/services/runtime';
import {
  tradePolicyRestrictionsChannel,
  tradePolicyTariffsChannel,
  tradePolicyFlowsChannel,
  tradePolicyBarriersChannel,
  tradePolicyRevenueChannel,
  tradePolicyComtradeChannel,
} from '@/services/trade-policy-store';
import { PanelShell } from '@/components/PanelShell';
import { getPanelGateReason, PanelGateReason, resolveBillingAwareGateReason, resolveGateAction } from '@/services/panel-gating';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { openSignIn } from '@/services/clerk';

type TabId = 'restrictions' | 'tariffs' | 'flows' | 'barriers' | 'revenue' | 'comtrade';

function SourceLink({ url }: { url: string }) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return <a href={url} target="_blank" rel="noopener" className="trade-source-link">Source</a>;
    }
  } catch { /* invalid URL */ }
  return null;
}

function getLatestBaselineTariffPoint(tariffsData: GetTariffTrendsResponse | null): TariffDataPoint | null {
  if (!tariffsData?.datapoints?.length) return null;
  return [...tariffsData.datapoints].sort((a, b) => b.year - a.year)[0] ?? null;
}

function getEffectiveTariffGapSummary(tariffsData: GetTariffTrendsResponse | null) {
  const baseline = getLatestBaselineTariffPoint(tariffsData);
  const effectiveRate = tariffsData?.effectiveTariffRate ?? null;
  if (!baseline || !effectiveRate) return null;
  return { baseline, effectiveRate, gap: effectiveRate.tariffRate - baseline.tariffRate };
}

function RestrictionEffectiveContext({ reportingCountry, tariffsData }: { reportingCountry: string; tariffsData: GetTariffTrendsResponse | null }) {
  if (reportingCountry !== 'United States') return null;
  const gapSummary = getEffectiveTariffGapSummary(tariffsData);
  if (!gapSummary) return null;
  const gapSign = gapSummary.gap > 0 ? '+' : '';
  return (
    <div className="trade-policy-inline-note">
      {t('components.tradePolicy.effectiveTariffRateLabel')}: {gapSummary.effectiveRate.tariffRate.toFixed(1)}%
      <span className="trade-policy-inline-sep">|</span>
      {t('components.tradePolicy.gapVsMfnLabel')}: {gapSign}{gapSummary.gap.toFixed(1)}pp
    </div>
  );
}

function RestrictionsTab({ data, tariffsData }: { data: GetTradeRestrictionsResponse; tariffsData: GetTariffTrendsResponse | null }) {
  if (!data.restrictions?.length) {
    return <div className="economic-empty">{t('components.tradePolicy.noOverviewData')}</div>;
  }
  const gapSummary = getEffectiveTariffGapSummary(tariffsData);
  return (
    <>
      {gapSummary ? (
        <div className="trade-policy-note">
          {t('components.tradePolicy.usBaselineLabel')}: <strong>{gapSummary.baseline.tariffRate.toFixed(1)}%</strong>.{' '}
          {t('components.tradePolicy.effectiveTariffRateLabel')}: <strong>{gapSummary.effectiveRate.tariffRate.toFixed(1)}%</strong>.{' '}
          {t('components.tradePolicy.gapLabel')}: <strong>{gapSummary.gap > 0 ? '+' : ''}{gapSummary.gap.toFixed(1)}pp</strong>.{' '}
          {t('components.tradePolicy.overviewNoteTail')}{' '}
          <SourceLink url={gapSummary.effectiveRate.sourceUrl} />
        </div>
      ) : (
        <div className="trade-policy-note">{t('components.tradePolicy.overviewNoteNoEffective')}</div>
      )}
      <div className="trade-restrictions-list">
        {data.restrictions.map((r, i) => {
          const statusClass = r.status === 'high' ? 'status-active' : r.status === 'moderate' ? 'status-notified' : 'status-terminated';
          const statusLabel = r.status === 'high' ? t('components.tradePolicy.highTariff') : r.status === 'moderate' ? t('components.tradePolicy.moderateTariff') : t('components.tradePolicy.lowTariff');
          return (
            <div key={i} className="trade-restriction-card">
              <div className="trade-restriction-header">
                <span className="trade-country">{r.reportingCountry}</span>
                <span className="trade-badge">{r.measureType}</span>
                <span className={`trade-status ${statusClass}`}>{statusLabel}</span>
              </div>
              <div className="trade-restriction-body">
                <div className="trade-sector">{r.productSector}</div>
                {r.description && <div className="trade-description">{r.description}</div>}
                <RestrictionEffectiveContext reportingCountry={r.reportingCountry} tariffsData={tariffsData} />
                {r.affectedCountry && <div className="trade-affected">Affects: {r.affectedCountry}</div>}
              </div>
              <div className="trade-restriction-footer">
                {r.notifiedAt && <span className="trade-date">{r.notifiedAt}</span>}
                <SourceLink url={r.sourceUrl} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TariffsTab({ data }: { data: GetTariffTrendsResponse }) {
  if (!data.datapoints?.length) {
    return <div className="economic-empty">{t('components.tradePolicy.noTariffData')}</div>;
  }
  const sortedDatapoints = [...data.datapoints].sort((a, b) => b.year - a.year);
  const latestBaseline = sortedDatapoints[0] ?? null;
  const effectiveRate = data.effectiveTariffRate ?? null;
  const gap = latestBaseline && effectiveRate ? effectiveRate.tariffRate - latestBaseline.tariffRate : null;

  return (
    <>
      {latestBaseline && (
        <div className="trade-tariff-summary">
          <div className="trade-tariff-card">
            <div className="trade-tariff-label">{t('components.tradePolicy.baselineMfnTariff')}</div>
            <div className="trade-tariff-value">{latestBaseline.tariffRate.toFixed(1)}%</div>
            <div className="trade-tariff-meta">{t('components.tradePolicy.wtoBaselineMeta', { year: String(latestBaseline.year) })}</div>
          </div>
          {effectiveRate ? (
            <>
              <div className="trade-tariff-card">
                <div className="trade-tariff-label">{t('components.tradePolicy.effectiveTariffRateLabel')}</div>
                <div className="trade-tariff-value">{effectiveRate.tariffRate.toFixed(1)}%</div>
                <div className="trade-tariff-meta">
                  {[effectiveRate.sourceName, effectiveRate.observationPeriod, effectiveRate.updatedAt ? `Updated ${effectiveRate.updatedAt}` : ''].filter(Boolean).join(' | ')}
                  {effectiveRate.sourceUrl && <span className="trade-tariff-source"><SourceLink url={effectiveRate.sourceUrl} /></span>}
                </div>
              </div>
              {gap !== null && (
                <div className="trade-tariff-card">
                  <div className="trade-tariff-label">{t('components.tradePolicy.gapLabel')}</div>
                  <div className={`trade-tariff-value ${gap >= 0 ? 'trade-tariff-gap-positive' : 'trade-tariff-gap-negative'}`}>
                    {gap > 0 ? '+' : ''}{gap.toFixed(1)}pp
                  </div>
                  <div className="trade-tariff-meta">{t('components.tradePolicy.effectiveMinusBaseline')}</div>
                </div>
              )}
            </>
          ) : (
            <div className="trade-tariff-card trade-tariff-card-muted">
              <div className="trade-tariff-label">{t('components.tradePolicy.effectiveTariffRateLabel')}</div>
              <div className="trade-tariff-value">—</div>
              <div className="trade-tariff-meta">{t('components.tradePolicy.noEffectiveCoverageForCountry')}</div>
            </div>
          )}
        </div>
      )}
      <div className="trade-tariffs-table">
        <table>
          <thead>
            <tr>
              <th>Year</th>
              <th>{t('components.tradePolicy.mfnAppliedRate')}</th>
              <th>Sector</th>
            </tr>
          </thead>
          <tbody>
            {sortedDatapoints.map((d, i) => (
              <tr key={i}>
                <td>{d.year}</td>
                <td>{d.tariffRate.toFixed(1)}%</td>
                <td>{d.productSector || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FlowsTab({ data }: { data: GetTradeFlowsResponse }) {
  if (!data.flows?.length) {
    return <div className="economic-empty">{t('components.tradePolicy.noFlowData')}</div>;
  }
  return (
    <div className="trade-flows-list">
      {data.flows.map((f, i) => {
        const exportClass = f.yoyExportChange >= 0 ? 'change-positive' : 'change-negative';
        const importClass = f.yoyImportChange >= 0 ? 'change-positive' : 'change-negative';
        return (
          <div key={i} className="trade-flow-card">
            <div className="trade-flow-year">{f.year}</div>
            <div className="trade-flow-metrics">
              <div className="trade-flow-metric">
                <span className="trade-flow-label">{t('components.tradePolicy.exports')}</span>
                <span className="trade-flow-value">${f.exportValueUsd.toFixed(0)}M</span>
                <span className={`trade-flow-change ${exportClass}`}>{f.yoyExportChange >= 0 ? '▲' : '▼'} {Math.abs(f.yoyExportChange).toFixed(1)}%</span>
              </div>
              <div className="trade-flow-metric">
                <span className="trade-flow-label">{t('components.tradePolicy.imports')}</span>
                <span className="trade-flow-value">${f.importValueUsd.toFixed(0)}M</span>
                <span className={`trade-flow-change ${importClass}`}>{f.yoyImportChange >= 0 ? '▲' : '▼'} {Math.abs(f.yoyImportChange).toFixed(1)}%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarriersTab({ data }: { data: GetTradeBarriersResponse }) {
  if (!data.barriers?.length) {
    return <div className="economic-empty">{t('components.tradePolicy.noBarriers')}</div>;
  }
  return (
    <div className="trade-barriers-list">
      {data.barriers.map((b, i) => (
        <div key={i} className="trade-barrier-card">
          <div className="trade-barrier-header">
            <span className="trade-country">{b.notifyingCountry}</span>
            <span className="trade-badge">{b.measureType}</span>
          </div>
          <div className="trade-barrier-body">
            <div className="trade-barrier-title">{b.title}</div>
            {b.productDescription && <div className="trade-sector">{b.productDescription}</div>}
            {b.objective && <div className="trade-description">{b.objective}</div>}
          </div>
          <div className="trade-barrier-footer">
            {b.dateDistributed && <span className="trade-date">{b.dateDistributed}</span>}
            <SourceLink url={b.sourceUrl} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RevenueTab({ data }: { data: GetCustomsRevenueResponse }) {
  if (!data.months?.length) {
    return <div className="economic-empty">{t('components.tradePolicy.noRevenueData')}</div>;
  }
  const months = data.months;
  const latest = months[months.length - 1]!;
  const latestFy = latest.fiscalYear;
  const currentFyMonths = months.filter(m => m.fiscalYear === latestFy);
  const priorFyMonths = months.filter(m => m.fiscalYear === latestFy - 1).slice(0, currentFyMonths.length);
  const currentFytd = currentFyMonths.reduce((s, m) => s + m.monthlyAmountBillions, 0);
  const priorFytd = priorFyMonths.reduce((s, m) => s + m.monthlyAmountBillions, 0);
  const yoyChange = priorFytd > 0 ? ((currentFytd - priorFytd) / priorFytd) * 100 : 0;
  const changeClass = yoyChange >= 0 ? 'change-negative' : 'change-positive';
  const priorAvg = priorFyMonths.length > 0 ? priorFytd / priorFyMonths.length : 0;
  const chartMonths = [...months].slice(-12);
  const maxVal = Math.max(...chartMonths.map(m => m.monthlyAmountBillions), 1);

  return (
    <>
      <div className="trade-revenue-summary">
        <div className="trade-revenue-headline">
          <span className="trade-revenue-label">{t('components.tradePolicy.fytdLabel', { year: String(latestFy) })}</span>
          <span className="trade-revenue-value">${currentFytd.toFixed(1)}B</span>
        </div>
        <div className="trade-revenue-compare">
          {t('components.tradePolicy.vsPriorFy', { year: String(latestFy - 1) })}: ${priorFytd.toFixed(1)}B{' '}
          <span className={changeClass}>{yoyChange >= 0 ? '▲' : '▼'} {Math.abs(yoyChange).toFixed(0)}%</span>
        </div>
      </div>
      <div className="trade-revenue-chart">
        {chartMonths.map((m, i) => {
          const pct = Math.round((m.monthlyAmountBillions / maxVal) * 100);
          const isSpike = m.monthlyAmountBillions > priorAvg * 1.5;
          return (
            <div key={i} className="trade-chart-col" title={`${m.recordDate.slice(0, 7)}: $${m.monthlyAmountBillions.toFixed(1)}B`}>
              <div className={`trade-chart-bar${isSpike ? ' trade-chart-spike' : ''}`} style={{ height: `${pct}%` }} />
              <div className="trade-chart-label">{m.recordDate.slice(5, 7)}</div>
            </div>
          );
        })}
      </div>
      <div className="trade-tariffs-table">
        <table>
          <thead>
            <tr>
              <th>{t('components.tradePolicy.colDate')}</th>
              <th>{t('components.tradePolicy.colMonthly')}</th>
              <th>{t('components.tradePolicy.colFytd')}</th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().slice(0, 24).map((m, i) => (
              <tr key={i} className={m.monthlyAmountBillions > priorAvg * 2 ? 'trade-revenue-spike' : ''}>
                <td>{m.recordDate}</td>
                <td>${m.monthlyAmountBillions.toFixed(1)}B</td>
                <td>${m.fytdAmountBillions.toFixed(1)}B</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ComtradeTab({ data }: { data: ListComtradeFlowsResponse }) {
  const flows = data.flows;
  if (!flows?.length) {
    return <div className="economic-empty">{t('components.tradePolicy.noComtradeData')}</div>;
  }
  const worldTotals = flows.filter(f => f.partnerCode === '0' || f.partnerCode === '000');
  const toDedup = worldTotals.length > 0 ? worldTotals : flows;
  const byYearDominant = new Map<string, typeof flows[0]>();
  for (const f of toDedup) {
    const key = `${f.reporterCode}:${f.cmdCode}:${f.year}`;
    const existing = byYearDominant.get(key);
    if (!existing || f.tradeValueUsd > existing.tradeValueUsd) byYearDominant.set(key, f);
  }
  const latest = new Map<string, typeof flows[0]>();
  for (const f of byYearDominant.values()) {
    const key = `${f.reporterCode}:${f.cmdCode}`;
    const existing = latest.get(key);
    if (!existing || f.year > existing.year) latest.set(key, f);
  }
  const sorted = [...latest.values()].sort((a, b) => {
    if (a.isAnomaly !== b.isAnomaly) return a.isAnomaly ? -1 : 1;
    return Math.abs(b.yoyChange) - Math.abs(a.yoyChange);
  });

  return (
    <div className="trade-tariffs-table">
      <table>
        <thead>
          <tr>
            <th>{t('components.tradePolicy.colReporter')}</th>
            <th>{t('components.tradePolicy.colCommodity')}</th>
            <th>{t('components.tradePolicy.colTradeValue')}</th>
            <th>{t('components.tradePolicy.yoyChange')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((f, i) => {
            const yoyClass = f.yoyChange >= 0 ? 'change-positive' : 'change-negative';
            const valueStr = f.tradeValueUsd >= 1e9
              ? `$${(f.tradeValueUsd / 1e9).toFixed(1)}B`
              : `$${(f.tradeValueUsd / 1e6).toFixed(0)}M`;
            return (
              <tr key={i} className={f.isAnomaly ? 'trade-anomaly-row' : ''}>
                <td>
                  {f.reporterName}
                  {f.isAnomaly && (
                    <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 600, letterSpacing: '0.05em', padding: '1px 5px', borderRadius: 3, background: 'rgba(255,68,68,0.15)', color: 'var(--red)', verticalAlign: 'middle', textTransform: 'uppercase' }}>
                      {t('components.tradePolicy.anomalyBadge')}
                    </span>
                  )}
                </td>
                <td>{f.cmdDesc}</td>
                <td>{valueStr} <span className="trade-flow-year">{f.year}</span></td>
                <td className={yoyClass}>{f.yoyChange >= 0 ? '▲' : '▼'} {Math.abs(f.yoyChange * 100).toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TradePolicyPanelContent() {
  const [restrictions, setRestrictions] = useState<GetTradeRestrictionsResponse | null>(tradePolicyRestrictionsChannel.get);
  const [tariffs, setTariffs] = useState<GetTariffTrendsResponse | null>(tradePolicyTariffsChannel.get);
  const [flows, setFlows] = useState<GetTradeFlowsResponse | null>(tradePolicyFlowsChannel.get);
  const [barriers, setBarriers] = useState<GetTradeBarriersResponse | null>(tradePolicyBarriersChannel.get);
  const [revenue, setRevenue] = useState<GetCustomsRevenueResponse | null>(tradePolicyRevenueChannel.get);
  const [comtrade, setComtrade] = useState<ListComtradeFlowsResponse | null>(tradePolicyComtradeChannel.get);
  const [activeTab, setActiveTab] = useState<TabId>('restrictions');

  useEffect(() => tradePolicyRestrictionsChannel.subscribe(setRestrictions), []);
  useEffect(() => tradePolicyTariffsChannel.subscribe(setTariffs), []);
  useEffect(() => tradePolicyFlowsChannel.subscribe(setFlows), []);
  useEffect(() => tradePolicyBarriersChannel.subscribe(setBarriers), []);
  useEffect(() => tradePolicyRevenueChannel.subscribe(setRevenue), []);
  useEffect(() => tradePolicyComtradeChannel.subscribe(setComtrade), []);

  const wtoAvailable = !isDesktopRuntime() || isFeatureAvailable('wtoTrade');
  const hasTariffs = wtoAvailable && !!(tariffs?.datapoints?.length);
  const hasFlows = wtoAvailable && !!(flows?.flows?.length);
  const hasBarriers = wtoAvailable && !!(barriers?.barriers?.length);
  const hasRevenue = !!(revenue?.months?.length);
  const hasComtrade = !!(comtrade?.flows?.length);

  // Auto-switch to revenue when WTO is unavailable and current tab is WTO-only
  useEffect(() => {
    if (!wtoAvailable && activeTab !== 'revenue' && activeTab !== 'comtrade') {
      setActiveTab(hasRevenue ? 'revenue' : 'comtrade');
    }
  }, [wtoAvailable, hasRevenue]);

  if (!wtoAvailable && !hasRevenue && !hasComtrade) {
    return <div className="economic-empty">{t('components.tradePolicy.apiKeyMissing')}</div>;
  }

  const effectiveTab: TabId = (!wtoAvailable && activeTab !== 'revenue' && activeTab !== 'comtrade')
    ? (hasRevenue ? 'revenue' : 'comtrade')
    : activeTab;

  const activeData = effectiveTab === 'restrictions' ? restrictions
    : effectiveTab === 'tariffs' ? tariffs
    : effectiveTab === 'flows' ? flows
    : effectiveTab === 'barriers' ? barriers
    : effectiveTab === 'comtrade' ? comtrade
    : revenue;

  const activeHasData = effectiveTab === 'restrictions' ? !!(restrictions?.restrictions?.length)
    : effectiveTab === 'tariffs' ? !!(tariffs?.datapoints?.length)
    : effectiveTab === 'flows' ? !!(flows?.flows?.length)
    : effectiveTab === 'barriers' ? !!(barriers?.barriers?.length)
    : effectiveTab === 'comtrade' ? !!(comtrade?.flows?.length)
    : !!(revenue?.months?.length);

  const unavailableBanner = !activeHasData && (activeData as { upstreamUnavailable?: boolean } | null)?.upstreamUnavailable
    ? (effectiveTab === 'revenue' ? t('components.tradePolicy.treasuryUnavailable')
      : effectiveTab === 'comtrade' ? t('components.tradePolicy.comtradeUnavailable')
      : t('components.tradePolicy.upstreamUnavailable'))
    : null;

  const source = effectiveTab === 'comtrade' ? t('components.tradePolicy.sourceComtrade')
    : effectiveTab === 'revenue' ? t('components.tradePolicy.sourceTreasury')
    : (effectiveTab === 'tariffs' || effectiveTab === 'restrictions') && tariffs?.effectiveTariffRate?.sourceName
    ? `${t('components.tradePolicy.sourceWto')} / ${tariffs.effectiveTariffRate.sourceName}`
    : t('components.tradePolicy.sourceWto');

  return (
    <div className="trade-policy-content">
      <div className="panel-tabs">
        {wtoAvailable && (
          <button className={`panel-tab ${effectiveTab === 'restrictions' ? 'active' : ''}`} data-tab="restrictions" onClick={() => setActiveTab('restrictions')}>
            {t('components.tradePolicy.overview')}
          </button>
        )}
        {hasTariffs && (
          <button className={`panel-tab ${effectiveTab === 'tariffs' ? 'active' : ''}`} data-tab="tariffs" onClick={() => setActiveTab('tariffs')}>
            {t('components.tradePolicy.tariffs')}
          </button>
        )}
        {hasFlows && (
          <button className={`panel-tab ${effectiveTab === 'flows' ? 'active' : ''}`} data-tab="flows" onClick={() => setActiveTab('flows')}>
            {t('components.tradePolicy.flows')}
          </button>
        )}
        {hasBarriers && (
          <button className={`panel-tab ${effectiveTab === 'barriers' ? 'active' : ''}`} data-tab="barriers" onClick={() => setActiveTab('barriers')}>
            {t('components.tradePolicy.barriers')}
          </button>
        )}
        {hasRevenue && (
          <button className={`panel-tab ${effectiveTab === 'revenue' ? 'active' : ''}`} data-tab="revenue" onClick={() => setActiveTab('revenue')}>
            {t('components.tradePolicy.revenue')}
          </button>
        )}
        {hasComtrade && (
          <button className={`panel-tab ${effectiveTab === 'comtrade' ? 'active' : ''}`} data-tab="comtrade" onClick={() => setActiveTab('comtrade')}>
            {t('components.tradePolicy.strategicFlows')}
          </button>
        )}
      </div>

      {unavailableBanner && <div className="economic-warning">{unavailableBanner}</div>}

      <div className="economic-content">
        {effectiveTab === 'restrictions' && restrictions && <RestrictionsTab data={restrictions} tariffsData={tariffs} />}
        {effectiveTab === 'tariffs' && tariffs && <TariffsTab data={tariffs} />}
        {effectiveTab === 'flows' && flows && <FlowsTab data={flows} />}
        {effectiveTab === 'barriers' && barriers && <BarriersTab data={barriers} />}
        {effectiveTab === 'revenue' && revenue && <RevenueTab data={revenue} />}
        {effectiveTab === 'comtrade' && comtrade && <ComtradeTab data={comtrade} />}
      </div>

      <div className="economic-footer">
        <span className="economic-source">{source}</span>
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

export function TradePolicyPanel() {
  const { locked, onLockedCtaClick } = usePremiumGate();
  return (
    <PanelShell
      id="trade-policy"
      title={t('panels.tradePolicy')}
      infoTooltip={t('components.tradePolicy.infoTooltip')}
      defaultRowSpan={2}
      locked={locked}
      onLockedCtaClick={onLockedCtaClick}
    >
      <TradePolicyPanelContent />
    </PanelShell>
  );
}
