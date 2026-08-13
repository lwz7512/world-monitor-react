import { useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { formatChange, getChangeClass, getHeatmapClass } from '@/utils';
import { fetchSectors } from '@/services/market';
import { SECTORS } from '@/config';
import type { SectorValuation } from '@/types';
import type { GetSectorSummaryResponse } from '@/generated/client/worldmonitor/market/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

type HeatmapTab = 'performance' | 'valuations';

interface HeatmapItem {
  symbol?: string;
  name: string;
  change: number | null;
}

interface SectorBar {
  symbol: string;
  name: string;
  change1d: number;
}

type SectorResp = GetSectorSummaryResponse & { valuations?: Record<string, SectorValuation> };

function mapResponse(resp: SectorResp): {
  items: HeatmapItem[];
  sectorBars: SectorBar[];
  valuations: Record<string, SectorValuation>;
} {
  const nameMap = new Map(SECTORS.map((s) => [s.symbol, s.name]));
  const items: HeatmapItem[] = resp.sectors.map((s) => ({
    symbol: s.symbol,
    name: nameMap.get(s.symbol) ?? s.name,
    change: s.change,
  }));
  const sectorBars: SectorBar[] = items
    .filter(
      (s): s is HeatmapItem & { symbol: string; change: number } =>
        !!s.symbol && Number.isFinite(s.change),
    )
    .map((s) => ({ symbol: s.symbol, name: s.name, change1d: s.change }));
  return { items, sectorBars, valuations: resp.valuations ?? {} };
}

async function fetcher(_signal: AbortSignal): Promise<SectorResp> {
  return fetchSectors() as Promise<SectorResp>;
}

export function HeatmapPanelContent() {
  const [tab, setTab] = useState<HeatmapTab>('performance');
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'sectors',
    ttlMs: 5 * 60 * 1000,
  });

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
      </div>
    );
  }

  if (error || !data || data.sectors.length === 0) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.failedSectorData')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const { items, sectorBars, valuations } = mapResponse(data);
  const hasValuations = Object.keys(valuations).length > 0;
  const activeTab = tab === 'valuations' && !hasValuations ? 'performance' : tab;

  const tabBar = hasValuations ? (
    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
      <button
        className={`panel-tab${activeTab === 'performance' ? ' active' : ''}`}
        style={{ fontSize: 11, padding: '3px 10px' }}
        onClick={() => setTab('performance')}
      >
        Performance
      </button>
      <button
        className={`panel-tab${activeTab === 'valuations' ? ' active' : ''}`}
        style={{ fontSize: 11, padding: '3px 10px' }}
        onClick={() => setTab('valuations')}
      >
        Valuations
      </button>
    </div>
  ) : null;

  return (
    <>
      {tabBar}
      {activeTab === 'valuations' && hasValuations ? (
        <ValuationsView valuations={valuations} heatmapData={items} />
      ) : (
        <PerformanceView heatmapData={items} sectorBars={sectorBars} />
      )}
    </>
  );
}

function PerformanceView({
  heatmapData,
  sectorBars,
}: {
  heatmapData: HeatmapItem[];
  sectorBars: SectorBar[];
}) {
  const sorted = [...sectorBars]
    .filter((s) => Number.isFinite(s.change1d))
    .sort((a, b) => b.change1d - a.change1d);
  const maxAbs = sorted.length > 0 ? Math.max(...sorted.map((s) => Math.abs(s.change1d)), 3) : 3;

  return (
    <>
      <div className="heatmap">
        {heatmapData.map((sector, i) => {
          const change = sector.change ?? 0;
          return (
            <div key={i} className={`heatmap-cell ${getHeatmapClass(change)}`}>
              {sector.symbol && <div className="sector-ticker">{sector.symbol}</div>}
              <div className={`sector-change ${getChangeClass(change)}`}>
                {formatChange(change)}
              </div>
              <div className="sector-name">{sector.name}</div>
            </div>
          );
        })}
      </div>
      {sorted.length > 0 && (
        <div className="heatmap-bar-chart">
          {sorted.map((s, i) => {
            const pct = Math.min((Math.abs(s.change1d) / maxAbs) * 100, 100).toFixed(1);
            const isPos = s.change1d >= 0;
            const color = isPos ? 'var(--green)' : 'var(--red)';
            return (
              <div key={i} className="heatmap-bar-row">
                <span className="heatmap-bar-label">{s.symbol}</span>
                <div className="heatmap-bar-track">
                  <div
                    className="heatmap-bar-fill"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
                <span className={`heatmap-bar-value ${isPos ? 'positive' : 'negative'}`}>
                  {isPos ? '+' : ''}
                  {s.change1d.toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function ValuationsView({
  valuations,
  heatmapData,
}: {
  valuations: Record<string, SectorValuation>;
  heatmapData: HeatmapItem[];
}) {
  const entries = Object.entries(valuations)
    .map(([symbol, v]) => ({ symbol, ...v }))
    .filter((e) => e.forwardPE !== null || e.trailingPE !== null);

  if (entries.length === 0) {
    return (
      <div style={{ padding: 8, color: 'var(--text-dim)', fontSize: 12 }}>
        No valuation data available
      </div>
    );
  }

  const sorted = [...entries].sort(
    (a, b) => (a.forwardPE ?? a.trailingPE ?? 999) - (b.forwardPE ?? b.trailingPE ?? 999),
  );
  const peValues = sorted.map((e) => e.forwardPE ?? e.trailingPE ?? 0).filter((v) => v > 0);
  const median =
    (peValues.length > 0 ? peValues[Math.floor(peValues.length / 2)] : undefined) ?? 20;
  const maxPE = Math.max(...peValues, 30);
  const nameMap = new Map(heatmapData.map((s) => [s.symbol, s.name]));

  const fmtPE = (v: number | null) => (v !== null ? v.toFixed(1) : '--');
  const fmtPct = (v: number | null) => {
    if (v === null) return '--';
    const pct = v * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };
  const fmtBeta = (v: number | null) => (v !== null ? v.toFixed(2) : '--');
  const peColor = (v: number | null) => {
    if (v === null) return 'var(--text-dim)';
    if (v < median * 0.8) return 'var(--green)';
    if (v > median * 1.2) return 'var(--red)';
    return '#e6a817';
  };

  return (
    <>
      <div className="heatmap-bar-chart" style={{ marginBottom: 12 }}>
        {sorted.map((e, i) => {
          const pe = e.forwardPE ?? e.trailingPE ?? 0;
          const pct = Math.min((pe / maxPE) * 100, 100).toFixed(1);
          const color = peColor(pe > 0 ? pe : null);
          const label = nameMap.get(e.symbol) ?? e.symbol;
          return (
            <div key={i} className="heatmap-bar-row">
              <span className="heatmap-bar-label" title={e.symbol}>
                {label}
              </span>
              <div className="heatmap-bar-track">
                <div className="heatmap-bar-fill" style={{ width: `${pct}%`, background: color }} />
              </div>
              <span className="heatmap-bar-value" style={{ color }}>
                {pe > 0 ? pe.toFixed(1) + 'x' : '--'}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '3px 6px', textAlign: 'left', fontWeight: 500 }}>Sector</th>
              <th style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 500 }}>Trail P/E</th>
              <th style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 500 }}>Fwd P/E</th>
              <th style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 500 }}>Beta</th>
              <th style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 500 }}>YTD</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e, i) => (
              <tr key={i}>
                <td style={{ padding: '3px 6px', whiteSpace: 'nowrap' }}>
                  {nameMap.get(e.symbol) ?? e.symbol}
                </td>
                <td
                  style={{ padding: '3px 6px', textAlign: 'right', color: peColor(e.trailingPE) }}
                >
                  {fmtPE(e.trailingPE)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: peColor(e.forwardPE) }}>
                  {fmtPE(e.forwardPE)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right' }}>{fmtBeta(e.beta)}</td>
                <td
                  style={{
                    padding: '3px 6px',
                    textAlign: 'right',
                    color:
                      e.ytdReturn === null
                        ? 'var(--text-dim)'
                        : e.ytdReturn >= 0
                          ? 'var(--green)'
                          : 'var(--red)',
                  }}
                >
                  {fmtPct(e.ytdReturn)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function HeatmapPanel() {
  return (
    <PanelShell
      id="heatmap"
      title={t('panels.heatmap')}
      infoTooltip={t('components.heatmap.infoTooltip')}
    >
      <HeatmapPanelContent />
    </PanelShell>
  );
}
