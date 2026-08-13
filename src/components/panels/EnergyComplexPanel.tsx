import { useState, useEffect } from 'react';
import { t } from '@/services/i18n';
import {
  formatOilValue, getTrendColor, getTrendIndicator,
  type OilAnalytics, type CrudeInventoryWeek, type NatGasStorageWeek,
  type GetEuGasStorageResponse, type GetOilStocksAnalysisResponse, type LngVulnerabilityData,
} from '@/services/economic';
import { formatPrice, formatChange, getChangeClass } from '@/utils';
import { miniSparkline } from '@/utils/sparkline';
import type { MarketData } from '@/types';
import {
  energyAnalyticsChannel,
  energyTapeChannel,
  energyCrudeWeeksChannel,
  energyNatGasChannel,
  energyEuGasChannel,
  energyOilStocksChannel,
  energyLngVulnerabilityChannel,
  energyRetryMessageChannel,
} from '@/services/energy-complex-store';
import { PanelShell } from '@/components/PanelShell';

function Sparkline({ data, change, w = 80, h = 22 }: { data: number[]; change: number | null; w?: number; h?: number }) {
  const svg = miniSparkline(data, change, w, h);
  if (!svg) return null;
  return <span dangerouslySetInnerHTML={{ __html: svg }} />;
}

function OilStocksSection({ d }: { d: GetOilStocksAnalysisResponse }) {
  if (!d.ieaMembers.length) return null;
  const reg = d.regionalSummary;
  return (
    <div className="energy-tape-section" style={{ marginTop: 8 }}>
      <div className="energy-section-title">IEA Oil Stocks — Days of Cover</div>
      <table className="oil-stocks-table">
        <thead><tr><th>#</th><th>Ctry</th><th>Days</th><th>vs 90d</th></tr></thead>
        <tbody>
          {d.ieaMembers.map(m => (
            <tr key={m.iso2} className="oil-stocks-row">
              <td className="oil-stocks-rank">{m.rank}</td>
              <td className="oil-stocks-iso">{m.iso2}</td>
              <td className="oil-stocks-days">
                {m.netExporter
                  ? <span className="energy-net-exporter-badge">Net Exporter</span>
                  : m.daysOfCover != null ? `${m.daysOfCover} d` : '—'}
                {m.belowObligation && <span className="energy-below-obligation-badge">Below 90d</span>}
              </td>
              <td className="oil-stocks-vs">
                {m.vsObligation != null ? `${m.vsObligation > 0 ? '+' : ''}${m.vsObligation}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="oil-stocks-regional" style={{ marginTop: 6 }}>
        {reg?.europe?.avgDays != null && (
          <div className="oil-stocks-region-row">
            <span className="oil-stocks-region-name">Europe</span>
            <span>avg {reg.europe.avgDays}d / min {reg.europe.minDays ?? '—'}d</span>
            {(reg.europe.countBelowObligation ?? 0) > 0 && (
              <span className="energy-below-obligation-badge">{reg.europe.countBelowObligation} below 90d</span>
            )}
          </div>
        )}
        {reg?.asiaPacific?.avgDays != null && (
          <div className="oil-stocks-region-row">
            <span className="oil-stocks-region-name">Asia-Pacific</span>
            <span>avg {reg.asiaPacific.avgDays}d / min {reg.asiaPacific.minDays ?? '—'}d</span>
            {(reg.asiaPacific.countBelowObligation ?? 0) > 0 && (
              <span className="energy-below-obligation-badge">{reg.asiaPacific.countBelowObligation} below 90d</span>
            )}
          </div>
        )}
        {reg?.northAmerica && (
          <div className="oil-stocks-region-row">
            <span className="oil-stocks-region-name">North America</span>
            <span>
              {reg.northAmerica.netExporters ?? 0} net exporter(s)
              {reg.northAmerica.avgDays != null ? `, avg ${reg.northAmerica.avgDays}d` : ''}
            </span>
          </div>
        )}
      </div>
      <div className="indicator-date" style={{ marginTop: 4 }}>Data: {d.dataMonth} (IEA)</div>
    </div>
  );
}

function LngSection({ d }: { d: LngVulnerabilityData }) {
  return (
    <div className="energy-tape-section" style={{ marginTop: 8 }}>
      <div className="energy-section-title">LNG Vulnerability</div>
      <table className="oil-stocks-table">
        <thead><tr><th>Country</th><th>LNG Share</th><th>LNG Imports</th></tr></thead>
        <tbody>
          {d.top20LngDependent.slice(0, 5).map(e => (
            <tr key={e.iso2} className="oil-stocks-row">
              <td className="oil-stocks-iso">{e.iso2}</td>
              <td className="oil-stocks-days">{(e.lngShareOfImports * 100).toFixed(1)}%</td>
              <td className="oil-stocks-vs">{Math.round(e.lngImportsTj)} TJ</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="indicator-date" style={{ marginTop: 4 }}>Data: {d.dataMonth} (JODI Gas)</div>
    </div>
  );
}

export function EnergyComplexPanelContent() {
  const [analytics, setAnalytics] = useState<OilAnalytics | null>(energyAnalyticsChannel.get);
  const [tape, setTape] = useState<MarketData[]>(energyTapeChannel.get);
  const [crudeWeeks, setCrudeWeeks] = useState<CrudeInventoryWeek[]>(energyCrudeWeeksChannel.get);
  const [natGasWeeks, setNatGasWeeks] = useState<NatGasStorageWeek[]>(energyNatGasChannel.get);
  const [euGas, setEuGas] = useState<GetEuGasStorageResponse | null>(energyEuGasChannel.get);
  const [oilStocks, setOilStocks] = useState<GetOilStocksAnalysisResponse | null>(energyOilStocksChannel.get);
  const [lngVulnerability, setLngVulnerability] = useState<LngVulnerabilityData | null>(energyLngVulnerabilityChannel.get);
  const [retryMessage, setRetryMessage] = useState<string | null>(energyRetryMessageChannel.get);

  useEffect(() => energyAnalyticsChannel.subscribe(setAnalytics), []);
  useEffect(() => energyTapeChannel.subscribe(setTape), []);
  useEffect(() => energyCrudeWeeksChannel.subscribe(setCrudeWeeks), []);
  useEffect(() => energyNatGasChannel.subscribe(setNatGasWeeks), []);
  useEffect(() => energyEuGasChannel.subscribe(setEuGas), []);
  useEffect(() => energyOilStocksChannel.subscribe(setOilStocks), []);
  useEffect(() => energyLngVulnerabilityChannel.subscribe(setLngVulnerability), []);
  useEffect(() => energyRetryMessageChannel.subscribe(setRetryMessage), []);

  const tapeCoveredSymbols = new Set(tape.filter(d => d.price !== null).map(d => d.symbol));
  const metrics = [
    tapeCoveredSymbols.has('CL=F') ? null : analytics?.wtiPrice,
    tapeCoveredSymbols.has('BZ=F') ? null : analytics?.brentPrice,
    analytics?.usProduction,
    analytics?.usInventory,
  ].filter(Boolean) as NonNullable<OilAnalytics['wtiPrice']>[];

  const hasData = metrics.length > 0 || tape.length > 0 || crudeWeeks.length > 0 || natGasWeeks.length > 0 || !!euGas || !!oilStocks || !!lngVulnerability;

  if (!hasData && !retryMessage) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
        <div className="panel-loading-text">{t('common.loading') ?? 'Loading…'}</div>
      </div>
    );
  }

  const footerParts: string[] = [];
  if (analytics && (analytics.wtiPrice || analytics.brentPrice || analytics.usProduction || analytics.usInventory)) footerParts.push('EIA');
  if (tape.length > 0) footerParts.push(t('components.energyComplex.liveTapeSource') ?? 'Live Tape');
  if (euGas) footerParts.push('GIE AGSI+');
  if (oilStocks) footerParts.push('IEA');
  if (lngVulnerability) footerParts.push('JODI Gas');

  const latestCrude = crudeWeeks[0] ?? null;
  const wowChange = latestCrude?.weeklyChangeMb ?? null;
  const wowClass = wowChange === null ? '' : wowChange > 0 ? 'change-negative' : 'change-positive';

  const latestNg = natGasWeeks[0] ?? null;
  const ngChange = latestNg?.weeklyChangeBcf ?? null;
  const ngClass = ngChange === null ? '' : ngChange > 0 ? 'change-negative' : 'change-positive';

  const euFillPct = euGas?.fillPct ?? null;
  const euChange1d = euGas?.fillPctChange1d ?? null;
  const euClass = euChange1d === null ? '' : euChange1d > 0 ? 'change-positive' : 'change-negative';

  return (
    <div className="energy-complex-content">
      {retryMessage && (
        <div className="panel-error-state" style={{ padding: '8px 12px', fontSize: 12 }}>{retryMessage}</div>
      )}

      {metrics.length > 0 && (
        <div className="energy-summary-grid">
          {metrics.map(metric => {
            const trendColor = getTrendColor(metric.trend, metric.name.includes('Production'));
            return (
              <div key={metric.name} className="energy-summary-card">
                <div className="energy-summary-head">
                  <span className="energy-summary-name">{metric.name}</span>
                  <span className="energy-summary-trend" style={{ color: trendColor }}>{getTrendIndicator(metric.trend)}</span>
                </div>
                <div className="energy-summary-value">
                  {formatOilValue(metric.current, metric.unit)} <span className="energy-unit">{metric.unit}</span>
                </div>
                <div className="energy-summary-change" style={{ color: trendColor }}>
                  {metric.changePct > 0 ? '+' : ''}{metric.changePct.toFixed(1)}%
                </div>
                <div className="indicator-date">{metric.lastUpdated.slice(0, 10)}</div>
              </div>
            );
          })}
        </div>
      )}

      {crudeWeeks.length > 0 && (
        <div className="energy-tape-section" style={{ marginTop: 8 }}>
          <div className="energy-section-title">US Crude Inventories (Mb)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <Sparkline data={crudeWeeks.slice().reverse().map(w => w.stocksMb)} change={wowChange} />
            <div>
              <span className="commodity-price">{latestCrude ? `${latestCrude.stocksMb.toFixed(1)} Mb` : '—'}</span>
              {wowChange !== null && (
                <span className={`commodity-change ${wowClass}`} style={{ marginLeft: 6 }}>
                  {wowChange > 0 ? '+' : ''}{wowChange.toFixed(1)} WoW
                </span>
              )}
            </div>
          </div>
          <div className="indicator-date" style={{ marginTop: 2 }}>{latestCrude?.period ?? ''}</div>
        </div>
      )}

      {natGasWeeks.length > 0 && (
        <div className="energy-tape-section" style={{ marginTop: 8 }}>
          <div className="energy-section-title">US Nat Gas Storage (Bcf)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <Sparkline data={natGasWeeks.slice().reverse().map(w => w.storBcf)} change={ngChange} />
            <div>
              <span className="commodity-price">{latestNg ? `${latestNg.storBcf.toFixed(0)} Bcf` : '—'}</span>
              {ngChange !== null && (
                <span className={`commodity-change ${ngClass}`} style={{ marginLeft: 6 }}>
                  {ngChange > 0 ? '+' : ''}{ngChange.toFixed(0)} WoW
                </span>
              )}
            </div>
          </div>
          <div className="indicator-date" style={{ marginTop: 2 }}>{latestNg?.period ?? ''}</div>
        </div>
      )}

      {euFillPct !== null && (
        <div className="energy-tape-section" style={{ marginTop: 8 }}>
          <div className="energy-section-title">EU Gas Storage (Fill %)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <Sparkline data={(euGas?.history ?? []).slice().reverse().map(h => h.fillPct)} change={euChange1d} />
            <div>
              <span className="commodity-price">{euFillPct.toFixed(1)}%</span>
              {euChange1d !== null && (
                <span className={`commodity-change ${euClass}`} style={{ marginLeft: 6 }}>
                  {euChange1d > 0 ? '+' : ''}{euChange1d.toFixed(2)}% 1d
                </span>
              )}
              {euGas?.trend && (
                <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-dim)' }}>{euGas.trend}</span>
              )}
            </div>
          </div>
          <div className="indicator-date" style={{ marginTop: 2 }}>{euGas?.updatedAt ?? ''}</div>
        </div>
      )}

      {tape.length > 0 && (
        <div className="energy-tape-section">
          <div className="energy-section-title">{t('components.energyComplex.liveTape')}</div>
          <div className="commodities-grid energy-tape-grid">
            {tape.map(item => (
              <div key={item.symbol} className="commodity-item energy-tape-card">
                <div className="commodity-name">{item.display}</div>
                <Sparkline data={item.sparkline ?? []} change={item.change} w={60} h={18} />
                <div className="commodity-price">{formatPrice(item.price!)}</div>
                <div className={`commodity-change ${getChangeClass(item.change ?? 0)}`}>{formatChange(item.change ?? 0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {oilStocks && <OilStocksSection d={oilStocks} />}
      {lngVulnerability && <LngSection d={lngVulnerability} />}

      {footerParts.length > 0 && (
        <div className="economic-footer">
          <span className="economic-source">{footerParts.join(' • ')}</span>
        </div>
      )}
    </div>
  );
}

export function EnergyComplexPanel() {
  return (
    <PanelShell
      id="energy-complex"
      title={t('panels.energyComplex')}
      infoTooltip={t('components.energyComplex.infoTooltip')}
      defaultRowSpan={2}
    >
      <EnergyComplexPanelContent />
    </PanelShell>
  );
}
