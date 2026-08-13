import { useState, useEffect } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { escapeHtml } from '@/utils/sanitize';
import { createLazyClient, getRpcBaseUrl, rpcFetch } from '@/services/rpc-client';
import { fetchHormuzTracker, type HormuzTrackerData } from '@/services/hormuz-tracker';
import { getEuGasStorageData } from '@/services/economic';
import { fetchCommodityQuotes } from '@/services/market';
import { buildOverviewState, type OverviewState, type TileState } from '@/components/_energy-risk-overview-state';
import { SupplyChainServiceClient } from '@/services/generated-rpc-clients';
import { PanelShell } from '@/components/PanelShell';

const getSupplyChainClient = createLazyClient(() => new SupplyChainServiceClient(getRpcBaseUrl(), { fetch: rpcFetch }));

const BRENT_META = [{ symbol: 'BZ=F', name: 'Brent Crude', display: 'BRENT' }];

const DEFAULT_CRISIS_START_DATE = '2026-02-23';
const CRISIS_START_MS = (() => {
  try {
    const d = (import.meta.env as Record<string, string | undefined>).VITE_HORMUZ_CRISIS_START_DATE || DEFAULT_CRISIS_START_DATE;
    return Date.parse(`${d}T00:00:00Z`);
  } catch {
    return Date.parse(`${DEFAULT_CRISIS_START_DATE}T00:00:00Z`);
  }
})();

const HORMUZ_STATUS_COLOR: Record<HormuzTrackerData['status'], string> = {
  closed:     '#e74c3c',
  disrupted:  '#e74c3c',
  restricted: '#f39c12',
  open:       '#27ae60',
};
const HORMUZ_STATUS_LABEL: Record<HormuzTrackerData['status'], string> = {
  closed:     'Closed',
  disrupted:  'Disrupted',
  restricted: 'Restricted',
  open:       'Open',
};

const RISK_OVERVIEW_CSS = `
  .ero-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:8px; padding:8px; }
  .ero-tile { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:10px 12px; min-height:64px; display:flex; flex-direction:column; justify-content:center; }
  .ero-tile__label { font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:rgba(255,255,255,0.55); margin-bottom:4px; }
  .ero-tile__value { font-size:18px; font-weight:600; line-height:1.1; }
  .ero-tile__sub { font-size:12px; margin-top:2px; }
`;

let _stylesInjected = false;
function injectStylesOnce() {
  if (_stylesInjected || typeof document === 'undefined') return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-ero-styles', '');
  style.textContent = RISK_OVERVIEW_CSS;
  document.head.appendChild(style);
}

async function fetcher(_signal: AbortSignal): Promise<OverviewState> {
  const [hormuz, euGas, brent, disruptions] = await Promise.allSettled([
    fetchHormuzTracker(),
    getEuGasStorageData(),
    fetchCommodityQuotes(BRENT_META),
    getSupplyChainClient().listEnergyDisruptions({ assetId: '', assetType: '', ongoingOnly: true }),
  ]);
  return buildOverviewState(hormuz, euGas, brent, disruptions, Date.now());
}

function Tile({ label, value, color, sub, degraded }: {
  label: string; value: string; color: string; sub?: string; degraded?: boolean
}) {
  return (
    <div className="ero-tile" data-degraded={degraded ? 'true' : undefined}>
      <div className="ero-tile__label">{label}</div>
      <div className="ero-tile__value" style={{ color }}>{value}</div>
      {sub && <div className="ero-tile__sub" style={{ color }}>{sub}</div>}
    </div>
  );
}

function HormuzTile({ tile }: { tile: TileState<{ status: string }> }) {
  if (tile.status !== 'fulfilled' || !tile.value) return <Tile label="Hormuz" value="—" color="#7f8c8d" degraded />;
  const status = tile.value.status as HormuzTrackerData['status'];
  return <Tile label="Hormuz" value={HORMUZ_STATUS_LABEL[status] ?? escapeHtml(tile.value.status)} color={HORMUZ_STATUS_COLOR[status] ?? '#7f8c8d'} />;
}

function EuGasTile({ tile }: { tile: TileState<{ fillPct: number }> }) {
  if (tile.status !== 'fulfilled' || !tile.value) return <Tile label="EU Gas" value="—" color="#7f8c8d" degraded />;
  const { fillPct } = tile.value;
  const color = fillPct < 30 ? '#e74c3c' : fillPct < 50 ? '#f39c12' : '#27ae60';
  return <Tile label="EU Gas" value={`${fillPct.toFixed(0)}%`} color={color} />;
}

function BrentTile({ tile }: { tile: TileState<{ price: number; change: number }> }) {
  if (tile.status !== 'fulfilled' || !tile.value) return <Tile label="Brent" value="—" color="#7f8c8d" degraded />;
  const { price, change } = tile.value;
  const sign = change >= 0 ? '+' : '';
  const color = change >= 0 ? '#e74c3c' : '#27ae60';
  return <Tile label="Brent" value={`$${price.toFixed(2)}`} color={color} sub={`${sign}${change.toFixed(2)}%`} />;
}

function DisruptionsTile({ tile }: { tile: TileState<{ count: number }> }) {
  if (tile.status !== 'fulfilled' || !tile.value) return <Tile label="Active disruptions" value="—" color="#7f8c8d" degraded />;
  const { count: n } = tile.value;
  const color = n === 0 ? '#27ae60' : n < 5 ? '#f39c12' : '#e74c3c';
  return <Tile label="Active disruptions" value={String(n)} color={color} />;
}

function FreshnessTile({ state, now }: { state: OverviewState; now: number }) {
  const tiles = [state.hormuz, state.euGas, state.brent, state.activeDisruptions];
  const fetchedAts = tiles.map(t => t.fetchedAt).filter((v): v is number => typeof v === 'number');
  if (!fetchedAts.length) return <Tile label="Updated" value="—" color="#7f8c8d" degraded />;
  const ageMin = Math.floor((now - Math.max(...fetchedAts)) / 60_000);
  const label = ageMin <= 0 ? 'just now' : ageMin === 1 ? '1 min ago' : `${ageMin} min ago`;
  return <Tile label="Updated" value={label} color="#7f8c8d" />;
}

function CrisisDayTile({ now }: { now: number }) {
  if (!Number.isFinite(CRISIS_START_MS)) return <Tile label="Hormuz crisis" value="—" color="#7f8c8d" degraded />;
  const days = Math.floor((now - CRISIS_START_MS) / 86_400_000);
  if (days < 0) return <Tile label="Hormuz crisis" value="pending" color="#7f8c8d" />;
  return <Tile label="Hormuz crisis" value={`Day ${days}`} color="#7f8c8d" />;
}

export function EnergyRiskOverviewPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, { ttlMs: 5 * 60 * 1000 });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    injectStylesOnce();
    if (!data) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [data]);

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

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? 'Energy data unavailable'}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>Retry</button>
      </div>
    );
  }

  return (
    <div className="ero-grid">
      <HormuzTile tile={data.hormuz} />
      <EuGasTile tile={data.euGas} />
      <BrentTile tile={data.brent} />
      <DisruptionsTile tile={data.activeDisruptions} />
      <FreshnessTile state={data} now={now} />
      <CrisisDayTile now={now} />
    </div>
  );
}

export function EnergyRiskOverviewPanel() {
  return (
    <PanelShell
      id="energy-risk-overview"
      title="Global Energy Risk Overview"
      infoTooltip="Consolidated executive view: Strait of Hormuz vessel status, EU gas storage fill, Brent crude price + 1-day change, active disruption count, data freshness, and a configurable crisis-day counter."
    >
      <EnergyRiskOverviewPanelContent />
    </PanelShell>
  );
}
