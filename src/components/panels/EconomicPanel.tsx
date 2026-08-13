import { useState, useEffect } from 'react';
import { t } from '@/services/i18n';
import { BLS_METRO_IDS, type FredSeries, type BisData } from '@/services/economic';
import { formatAwardAmount, getAwardTypeIcon, type SpendingSummary } from '@/services/usa-spending';
import { getCSSColor } from '@/utils';
import { sparkline } from '@/utils/sparkline';
import { isDesktopRuntime } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';
import type { GetEconomicStressResponse, EconomicStressComponent } from '@/generated/client/worldmonitor/economic/v1/service_client';
import {
  economicFredDataChannel,
  economicFredStateChannel,
  economicLastUpdateChannel,
  economicBisChannel,
  economicBlsChannel,
  economicSpendingChannel,
  economicStressChannel,
} from '@/services/economic-panel-store';
import { PanelShell } from '@/components/PanelShell';

type TabId = 'indicators' | 'spending' | 'centralBanks' | 'labor' | 'stress';

function stressScoreColor(score: number): string {
  if (score < 20) return '#27ae60';
  if (score < 40) return '#f1c40f';
  if (score < 60) return '#e67e22';
  if (score < 80) return '#e74c3c';
  return '#8e44ad';
}

function stressFormatRaw(id: string, raw: number): string {
  if (id === 'ICSA') return raw >= 1000 ? (raw / 1000).toFixed(0) + 'K' : raw.toFixed(0);
  if (id === 'VIXCLS') return raw.toFixed(2);
  if (id === 'STLFSI4' || id === 'GSCPI') return raw.toFixed(3);
  return raw.toFixed(2);
}

function formatSeriesValue(series: FredSeries): string {
  if (series.value === null) return 'N/A';
  if (series.unit === '$B') return `$${series.value.toLocaleString()}B`;
  return `${series.value.toLocaleString()}${series.unit}`;
}

function formatSeriesChange(series: FredSeries): string {
  if (series.change === null) return 'No change';
  const sign = series.change > 0 ? '+' : '';
  if (series.unit === '$B') {
    const prefix = series.change < 0 ? '-$' : `${sign}$`;
    return `${prefix}${Math.abs(series.change).toLocaleString()}B`;
  }
  return `${sign}${series.change.toLocaleString()}${series.unit}`;
}

function getSeriesChangeClass(change: number | null): string {
  if (change === null || change === 0) return 'neutral';
  return change > 0 ? 'positive' : 'negative';
}

function getMacroPressure(data: FredSeries[]) {
  const byId = new Map(data.map(s => [s.id, s]));
  const vix = byId.get('VIXCLS')?.value ?? null;
  const curve = byId.get('T10Y2Y')?.value ?? null;
  const unemployment = byId.get('UNRATE')?.value ?? null;
  const fedFunds = byId.get('FEDFUNDS')?.value ?? null;
  let score = 0;
  if (vix !== null) score += vix >= 25 ? 2 : vix >= 18 ? 1 : 0;
  if (curve !== null) score += curve <= 0 ? 2 : curve < 0.5 ? 1 : 0;
  if (unemployment !== null) score += unemployment >= 4.5 ? 1 : 0;
  if (fedFunds !== null) score += fedFunds >= 5 ? 1 : fedFunds <= 2 ? -1 : 0;
  if (score >= 4) return { label: t('components.economic.pressure.stress'), detail: t('components.economic.pressure.stressDetail'), className: 'macro-pressure-stress' };
  if (score >= 2) return { label: t('components.economic.pressure.watch'), detail: t('components.economic.pressure.watchDetail'), className: 'macro-pressure-watch' };
  return { label: t('components.economic.pressure.steady'), detail: t('components.economic.pressure.steadyDetail'), className: 'macro-pressure-steady' };
}

function SeriesRow({ series }: { series: FredSeries }) {
  const spkHtml = sparkline(series.observations?.map(o => o.value) ?? [], series.change !== null && series.change >= 0 ? '#4caf50' : '#f44336', 120, 28, 'display:block;margin:2px 0');
  return (
    <div className="economic-indicator" data-series={series.id}>
      <div className="indicator-header">
        <span className="indicator-name">{series.name}</span>
        <span className="indicator-id">{series.id}</span>
      </div>
      <div className="indicator-value">
        <span className="value">{formatSeriesValue(series)}</span>
        <span className={`change ${getSeriesChangeClass(series.change)}`}>{formatSeriesChange(series)}</span>
      </div>
      <div className="indicator-date">{series.date}</div>
      {spkHtml && <span dangerouslySetInnerHTML={{ __html: spkHtml }} />}
    </div>
  );
}

function StressComponentCard({ c }: { c: EconomicStressComponent }) {
  if (c.missing) {
    return (
      <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 6, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</span>
          <span style={{ fontSize: 10, color: '#888' }}>N/A</span>
        </div>
        <div style={{ fontSize: 9, color: '#666', fontStyle: 'italic' }}>Data unavailable</div>
      </div>
    );
  }
  const color = stressScoreColor(c.score);
  const barWidth = Math.min(100, Math.max(0, c.score)).toFixed(1);
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{stressFormatRaw(c.id, c.rawValue)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.07)', borderRadius: 3, height: 5, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${barWidth}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, color, minWidth: 28, textAlign: 'right' }}>{c.score.toFixed(0)}</span>
      </div>
    </div>
  );
}

function IndicatorsTab({ fredData, fredState, fredErrorMsg }: { fredData: FredSeries[]; fredState: string; fredErrorMsg: string }) {
  if (fredData.length === 0) {
    if (isDesktopRuntime() && !isFeatureAvailable('economicFred')) {
      return <div className="economic-empty">{t('components.economic.fredKeyMissing')}</div>;
    }
    if (fredState === 'error' || fredState === 'retrying') {
      const isRetrying = fredState === 'retrying';
      const mainMsg = isRetrying
        ? t('common.upstreamUnavailable')
        : (fredErrorMsg.includes('—') ? fredErrorMsg.slice(0, fredErrorMsg.indexOf('—')).trimEnd() : fredErrorMsg);
      return (
        <div className="panel-error-state">
          <div className="panel-loading-radar panel-error-radar">
            <div className="panel-radar-sweep" /><div className="panel-radar-dot error" />
          </div>
          <div className="panel-error-msg">{mainMsg}</div>
          {isRetrying && <div className="panel-error-countdown">{fredErrorMsg}</div>}
        </div>
      );
    }
    return <div className="economic-empty">{t('components.economic.noIndicatorData')}</div>;
  }
  const pressure = getMacroPressure(fredData);
  const summaryIds = ['VIXCLS', 'T10Y2Y', 'FEDFUNDS', 'UNRATE'];
  const summarySeries = fredData.filter(s => summaryIds.includes(s.id));
  const detailSeries = fredData.filter(s => !summaryIds.includes(s.id));
  const orderedSeries = [...summarySeries, ...detailSeries];
  return (
    <div className="economic-content-macro">
      <div className={`macro-pressure-card ${pressure.className}`}>
        <div className="macro-pressure-label">{t('components.economic.pressure.label')}</div>
        <div className="macro-pressure-value">{pressure.label}</div>
        <div className="macro-pressure-detail">{pressure.detail}</div>
      </div>
      <div className="macro-summary-grid">
        {summarySeries.map(s => (
          <div key={s.id} className="macro-summary-card">
            <div className="macro-summary-head">
              <span className="indicator-name">{s.name}</span>
              <span className="indicator-id">{s.id}</span>
            </div>
            <div className="macro-summary-value">{formatSeriesValue(s)}</div>
            <div className={`macro-summary-change ${getSeriesChangeClass(s.change)}`}>{formatSeriesChange(s)}</div>
          </div>
        ))}
      </div>
      <div className="economic-indicators">
        {orderedSeries.map(s => <SeriesRow key={s.id} series={s} />)}
      </div>
    </div>
  );
}

function SpendingTab({ data }: { data: SpendingSummary }) {
  if (!data.awards?.length) {
    return <div className="economic-empty">{t('components.economic.noSpending')}</div>;
  }
  return (
    <>
      <div className="spending-summary">
        <div className="spending-total">
          {formatAwardAmount(data.totalAmount)} {t('components.economic.in')} {data.awards.length} {t('components.economic.awards')}
          <span className="spending-period">{data.periodStart} / {data.periodEnd}</span>
        </div>
      </div>
      <div className="spending-list">
        {data.awards.slice(0, 8).map((award, i) => (
          <div key={i} className="spending-award">
            <div className="award-header">
              <span className="award-icon">{getAwardTypeIcon(award.awardType)}</span>
              <span className="award-amount">{formatAwardAmount(award.amount)}</span>
            </div>
            <div className="award-recipient">{award.recipientName}</div>
            <div className="award-agency">{award.agency}</div>
            {award.description && (
              <div className="award-desc">
                {award.description.slice(0, 100)}{award.description.length > 100 ? '...' : ''}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function CentralBanksTab({ data }: { data: BisData }) {
  if (!data.policyRates?.length) {
    return <div className="economic-empty">{t('components.economic.noBisData')}</div>;
  }
  const greenColor = getCSSColor('--semantic-normal');
  const redColor = getCSSColor('--semantic-critical');
  const neutralColor = getCSSColor('--text-dim');
  const sortedRates = [...data.policyRates].sort((a, b) => b.rate - a.rate);
  return (
    <>
      <div className="bis-section">
        <div className="bis-section-title">{t('components.economic.policyRate')}</div>
        <div className="economic-indicators">
          {sortedRates.map((r, i) => {
            const diff = r.rate - r.previousRate;
            const color = diff < 0 ? greenColor : diff > 0 ? redColor : neutralColor;
            const label = diff < 0 ? t('components.economic.cut') : diff > 0 ? t('components.economic.hike') : t('components.economic.hold');
            const arrow = diff < 0 ? '▼' : diff > 0 ? '▲' : '–';
            return (
              <div key={i} className="economic-indicator">
                <div className="indicator-header">
                  <span className="indicator-name">{r.centralBank}</span>
                  <span className="indicator-id">{r.countryCode}</span>
                </div>
                <div className="indicator-value">
                  <span className="value">{r.rate}%</span>
                  <span className="change" style={{ color }}>{arrow} {label}</span>
                </div>
                <div className="indicator-date">{r.date}</div>
              </div>
            );
          })}
        </div>
      </div>
      {(data.exchangeRates?.length ?? 0) > 0 && (
        <div className="bis-section">
          <div className="bis-section-title">{t('components.economic.realEer')}</div>
          <div className="economic-indicators">
            {data.exchangeRates.map((r, i) => {
              const color = r.realChange > 0 ? redColor : r.realChange < 0 ? greenColor : neutralColor;
              const arrow = r.realChange > 0 ? '▲' : r.realChange < 0 ? '▼' : '–';
              return (
                <div key={i} className="economic-indicator">
                  <div className="indicator-header">
                    <span className="indicator-name">{r.countryName}</span>
                    <span className="indicator-id">{r.countryCode}</span>
                  </div>
                  <div className="indicator-value">
                    <span className="value">{r.realEer}</span>
                    <span className="change" style={{ color }}>{arrow} {r.realChange > 0 ? '+' : ''}{r.realChange}%</span>
                  </div>
                  <div className="indicator-date">{r.date}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {(data.creditToGdp?.length ?? 0) > 0 && (
        <div className="bis-section">
          <div className="bis-section-title">{t('components.economic.creditToGdp')}</div>
          <div className="economic-indicators">
            {[...data.creditToGdp].sort((a, b) => b.creditGdpRatio - a.creditGdpRatio).map((r, i) => {
              const diff = r.creditGdpRatio - r.previousRatio;
              const color = diff > 0 ? redColor : diff < 0 ? greenColor : neutralColor;
              const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '–';
              const changeStr = diff !== 0 ? `${diff > 0 ? '+' : ''}${Math.round(diff * 10) / 10}pp` : '–';
              return (
                <div key={i} className="economic-indicator">
                  <div className="indicator-header">
                    <span className="indicator-name">{r.countryName}</span>
                    <span className="indicator-id">{r.countryCode}</span>
                  </div>
                  <div className="indicator-value">
                    <span className="value">{r.creditGdpRatio}%</span>
                    <span className="change" style={{ color }}>{arrow} {changeStr}</span>
                  </div>
                  <div className="indicator-date">{r.date}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function LaborTab({ blsData }: { blsData: FredSeries[] }) {
  if (!blsData.length) {
    return <div className="economic-empty">{t('components.economic.noIndicatorData')}</div>;
  }
  const national = blsData.filter(s => !BLS_METRO_IDS.has(s.id));
  const metro = blsData.filter(s => BLS_METRO_IDS.has(s.id));
  return (
    <div className="economic-content-macro">
      <div className="economic-indicators">
        {national.map(s => <SeriesRow key={s.id} series={s} />)}
      </div>
      {metro.length > 0 && (
        <div className="bis-section">
          <div className="bis-section-title">{t('components.economic.metroUnemployment')}</div>
          <div className="economic-indicators">
            {metro.map(s => <SeriesRow key={s.id} series={s} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function StressTab({ data }: { data: GetEconomicStressResponse }) {
  if (data.unavailable || !Number.isFinite(data.compositeScore)) {
    return <div className="economic-empty">Stress index data unavailable</div>;
  }
  const color = stressScoreColor(data.compositeScore);
  const needlePct = Math.min(100, Math.max(0, data.compositeScore)).toFixed(1);
  const updatedDate = data.seededAt ? new Date(data.seededAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Composite Score</div>
        <div style={{ fontSize: 38, fontWeight: 700, color, lineHeight: 1 }}>{data.compositeScore.toFixed(1)}</div>
        <div style={{ display: 'inline-block', marginTop: 6, padding: '3px 10px', borderRadius: 12, background: `${color}22`, border: `1px solid ${color}66`, fontSize: 12, fontWeight: 600, color }}>{data.label}</div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ position: 'relative', height: 12, borderRadius: 6, overflow: 'visible', background: 'linear-gradient(to right,#27ae60 0%,#f1c40f 20%,#e67e22 40%,#e74c3c 60%,#8e44ad 80%,#8e44ad 100%)', marginBottom: 4 }}>
          <div style={{ position: 'absolute', top: -4, left: `calc(${needlePct}% - 2px)`, width: 4, height: 20, background: '#fff', borderRadius: 2, boxShadow: '0 0 4px rgba(0,0,0,0.6)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)' }}>
          <span>Low</span><span>Moderate</span><span>Elevated</span><span>Severe</span><span>Critical</span>
        </div>
      </div>
      {data.components.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
          {data.components.map((c, i) => <StressComponentCard key={i} c={c} />)}
        </div>
      )}
      {updatedDate && <div style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'right', marginTop: 8 }}>Updated {updatedDate}</div>}
    </div>
  );
}

export function EconomicPanelContent() {
  const [fredData, setFredData] = useState(economicFredDataChannel.get);
  const [fredStateObj, setFredStateObj] = useState(economicFredStateChannel.get);
  const [lastUpdate, setLastUpdate] = useState(economicLastUpdateChannel.get);
  const [bisData, setBisData] = useState(economicBisChannel.get);
  const [blsData, setBlsData] = useState(economicBlsChannel.get);
  const [spending, setSpending] = useState(economicSpendingChannel.get);
  const [stress, setStress] = useState(economicStressChannel.get);
  const [activeTab, setActiveTab] = useState<TabId>('indicators');

  useEffect(() => economicFredDataChannel.subscribe(setFredData), []);
  useEffect(() => economicFredStateChannel.subscribe(setFredStateObj), []);
  useEffect(() => economicLastUpdateChannel.subscribe(setLastUpdate), []);
  useEffect(() => economicBisChannel.subscribe(setBisData), []);
  useEffect(() => economicBlsChannel.subscribe(setBlsData), []);
  useEffect(() => economicSpendingChannel.subscribe(setSpending), []);
  useEffect(() => economicStressChannel.subscribe(setStress), []);

  const hasSpending = !!(spending?.awards?.length);
  const hasBis = !!(bisData?.policyRates?.length);
  const hasBls = blsData.length > 0;
  const hasStress = !!(stress && !stress.unavailable && Number.isFinite(stress.compositeScore));

  const sourceLabel = activeTab === 'spending' ? 'USASpending.gov'
    : activeTab === 'centralBanks' ? 'BIS'
    : activeTab === 'labor' ? 'BLS'
    : 'FRED';

  return (
    <div className="economic-content-wrapper">
      <div className="panel-tabs">
        <button className={`panel-tab ${activeTab === 'indicators' ? 'active' : ''}`} onClick={() => setActiveTab('indicators')}>
          {t('components.economic.indicators')}
        </button>
        {hasSpending && (
          <button className={`panel-tab ${activeTab === 'spending' ? 'active' : ''}`} onClick={() => setActiveTab('spending')}>
            Recent awards
          </button>
        )}
        {hasBis && (
          <button className={`panel-tab ${activeTab === 'centralBanks' ? 'active' : ''}`} onClick={() => setActiveTab('centralBanks')}>
            {t('components.economic.centralBanks')}
          </button>
        )}
        {hasBls && (
          <button className={`panel-tab ${activeTab === 'labor' ? 'active' : ''}`} onClick={() => setActiveTab('labor')}>
            {t('components.economic.laborMarket')}
          </button>
        )}
        {hasStress && (
          <button className={`panel-tab ${activeTab === 'stress' ? 'active' : ''}`} onClick={() => setActiveTab('stress')}>
            Stress Index
          </button>
        )}
      </div>

      <div className="economic-content">
        {activeTab === 'indicators' && (
          <IndicatorsTab fredData={fredData} fredState={fredStateObj.state} fredErrorMsg={fredStateObj.errorMsg} />
        )}
        {activeTab === 'spending' && spending && <SpendingTab data={spending} />}
        {activeTab === 'centralBanks' && bisData && <CentralBanksTab data={bisData} />}
        {activeTab === 'labor' && <LaborTab blsData={blsData} />}
        {activeTab === 'stress' && stress && <StressTab data={stress} />}
      </div>

      <div className="economic-footer">
        <span className="economic-source">{sourceLabel}{lastUpdate ? ` • ${lastUpdate}` : ''}</span>
      </div>
    </div>
  );
}

export function EconomicPanel() {
  return (
    <PanelShell
      id="economic"
      title={t('panels.economic')}
      infoTooltip={t('components.economic.infoTooltip')}
      defaultRowSpan={2}
    >
      <EconomicPanelContent />
    </PanelShell>
  );
}
