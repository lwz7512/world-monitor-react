import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CotInstrumentData {
  name: string;
  code: string;
  reportDate: string;
  assetManagerLong: string;
  assetManagerShort: string;
  leveragedFundsLong: string;
  leveragedFundsShort: string;
  dealerLong: string;
  dealerShort: string;
  netPct: number;
}

export interface CotPositioningData {
  instruments: CotInstrumentData[];
  reportDate: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v: string | number): number {
  return typeof v === 'number' ? v : parseInt(String(v), 10) || 0;
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchCot(_signal: AbortSignal): Promise<CotPositioningData> {
  const { MarketServiceClient } = await import('@/generated/client/worldmonitor/market/v1/service_client');
  const { getRpcBaseUrl } = await import('@/services/rpc-client');
  const client = new MarketServiceClient(getRpcBaseUrl(), {
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  });

  const resp = await client.getCotPositioning({});
  if (resp.unavailable || !resp.instruments?.length) throw new Error('COT data unavailable');
  return { instruments: resp.instruments as CotInstrumentData[], reportDate: resp.reportDate ?? '' };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PositionBar({ netPct, label }: { netPct: number; label: string }) {
  const clamped   = Math.max(-100, Math.min(100, netPct));
  const halfWidth = (Math.abs(clamped) / 100) * 50;
  const color     = clamped >= 0 ? '#2ecc71' : '#e74c3c';
  const leftPct   = clamped >= 0 ? 50 : 50 - halfWidth;
  const sign      = clamped >= 0 ? '+' : '';

  return (
    <div style={{ margin: '3px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{sign}{clamped.toFixed(1)}%</span>
      </div>
      <div style={{ position: 'relative', height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'rgba(255,255,255,0.15)' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${leftPct.toFixed(2)}%`, width: `${halfWidth.toFixed(2)}%`, background: color, borderRadius: 1 }} />
      </div>
    </div>
  );
}

function InstrumentRow({ item }: { item: CotInstrumentData }) {
  const levLong   = toNum(item.leveragedFundsLong);
  const levShort  = toNum(item.leveragedFundsShort);
  const levNetPct = ((levLong - levShort) / Math.max(levLong + levShort, 1)) * 100;

  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{item.code}</span>
      </div>
      <PositionBar netPct={item.netPct} label="Asset Managers" />
      <PositionBar netPct={levNetPct}   label="Leveraged Funds" />
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside Panel base class's content div. */
export function CotPositioningPanelContent() {
  const { data, loading, error, refetch } = usePanelData<CotPositioningData>(fetchCot, {
    ttlMs: 60 * 60 * 1000,
  });

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar"><div className="panel-radar-sweep" /><div className="panel-radar-dot" /></div>
        <div className="panel-loading-text">Loading…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.noDataShort')}</div>
        <button className="panel-error-retry" data-panel-retry onClick={refetch}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '10px 14px' }}>
      {data.instruments.map(item => <InstrumentRow key={item.code} item={item} />)}
      {data.reportDate && (
        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 8, textAlign: 'right' }}>
          Report date: {data.reportDate}
        </div>
      )}
    </div>
  );
}

export function CotPositioningPanel() {
  return (
    <PanelShell
      id="cot-positioning"
      title="CFTC COT Positioning"
      infoTooltip={t('components.cotPositioning.infoTooltip')}
    >
      <CotPositioningPanelContent />
    </PanelShell>
  );
}
