import { usePanelData } from '@/hooks/usePanelData';
import { getHydratedData } from '@/services/bootstrap';
import { CISS_STALE_THRESHOLD_MS } from '@/shared/ciss-staleness';
import { t } from '@/services/i18n';
import type { GetEuFsiResponse } from '@/generated/client/worldmonitor/economic/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FSIData {
  fsiValue: number;
  fsiLabel: string;
  hygPrice: number;
  tltPrice: number;
  vix: number;
  hySpread: number;
  euFsi: GetEuFsiResponse | null;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function fsiLabelColor(label: string): string {
  if (label === 'Low Stress') return '#27ae60';
  if (label === 'Moderate Stress') return '#f39c12';
  if (label === 'Elevated Stress') return '#e67e22';
  return '#c0392b';
}

function fsiInterpretation(label: string): string {
  if (label === 'Low Stress') return t('components.fsi.interpretation.low');
  if (label === 'Moderate Stress') return t('components.fsi.interpretation.moderate');
  if (label === 'Elevated Stress') return t('components.fsi.interpretation.elevated');
  return t('components.fsi.interpretation.severe');
}

function fsiLabelDisplay(label: string): string {
  if (label === 'Low Stress') return t('components.fsi.labels.lowStress');
  if (label === 'Moderate Stress') return t('components.fsi.labels.moderateStress');
  if (label === 'Elevated Stress') return t('components.fsi.labels.elevatedStress');
  if (label === 'Severe Stress') return t('components.fsi.labels.severeStress');
  return label;
}

function cissLabelColor(label: string): string {
  if (label === 'Low') return '#27ae60';
  if (label === 'Moderate') return '#f39c12';
  if (label === 'Elevated') return '#e67e22';
  return '#c0392b';
}

function cissLabelDisplay(label: string): string {
  if (label === 'Low') return t('components.fsi.cissLabels.low');
  if (label === 'Moderate') return t('components.fsi.cissLabels.moderate');
  if (label === 'Elevated') return t('components.fsi.cissLabels.elevated');
  if (label === 'High') return t('components.fsi.cissLabels.high');
  return label;
}

function cissIsStale(latestDate: string): boolean {
  const ts = Date.parse(latestDate);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > CISS_STALE_THRESHOLD_MS;
}

async function fetchFSIData(_signal: AbortSignal): Promise<FSIData> {
  const { MarketServiceClient } = await import('@/generated/client/worldmonitor/market/v1/service_client');
  const { EconomicServiceClient } = await import('@/generated/client/worldmonitor/economic/v1/service_client');
  const { getRpcBaseUrl } = await import('@/services/rpc-client');
  const fetch_ = (...args: Parameters<typeof fetch>) => globalThis.fetch(...args);
  const marketClient = new MarketServiceClient(getRpcBaseUrl(), { fetch: fetch_ });
  const econClient  = new EconomicServiceClient(getRpcBaseUrl(), { fetch: fetch_ });

  // US FSI — hydrated bootstrap first
  let fsiValue = 0, fsiLabel = '', hygPrice = 0, tltPrice = 0, vix = 0, hySpread = 0;
  const hydrated = getHydratedData('fearGreedIndex') as Record<string, unknown> | undefined;
  if (hydrated && !hydrated.unavailable) {
    const hdr = (hydrated.headerMetrics ?? {}) as Record<string, Record<string, unknown> | null>;
    fsiValue   = Number(hdr?.fsi?.value ?? 0);
    fsiLabel   = String(hdr?.fsi?.label ?? '');
    vix        = Number(hdr?.vix?.value ?? 0);
    hySpread   = Number(hdr?.hySpread?.value ?? 0);
  }

  if (fsiValue <= 0) {
    const resp = await marketClient.getFearGreedIndex({});
    if (!resp.unavailable && resp.fsiValue > 0) {
      fsiValue  = resp.fsiValue;
      fsiLabel  = resp.fsiLabel;
      hygPrice  = resp.hygPrice;
      tltPrice  = resp.tltPrice;
      vix       = resp.vix;
      hySpread  = resp.hySpread;
    }
  }

  if (fsiValue <= 0) throw new Error(t('components.fsi.errors.unavailable'));

  // EU CISS — hydrated bootstrap first
  let euFsi: GetEuFsiResponse | null = null;
  try {
    const hydratedEuFsi = getHydratedData('euFsi') as GetEuFsiResponse | undefined;
    if (hydratedEuFsi && !hydratedEuFsi.unavailable && Number.isFinite(hydratedEuFsi.latestValue)) {
      euFsi = hydratedEuFsi;
    } else {
      const euResp = await econClient.getEuFsi({});
      if (!euResp.unavailable && Number.isFinite(euResp.latestValue)) euFsi = euResp;
    }
  } catch {
    // CISS unavailable — render without it
  }

  return { fsiValue, fsiLabel, hygPrice, tltPrice, vix, hySpread, euFsi };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function GaugeBar({ fillPct, gradient }: { fillPct: number; gradient: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${fillPct.toFixed(1)}%`, background: gradient, borderRadius: 4, transition: 'width 0.4s ease' }} />
    </div>
  );
}

function CISSSection({ euFsi }: { euFsi: GetEuFsiResponse }) {
  const cissStale = euFsi.stale || cissIsStale(euFsi.latestDate);
  const color = cissLabelColor(euFsi.label);
  const dateStr = euFsi.latestDate
    ? new Date(euFsi.latestDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '';
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {t('components.fsi.cissTitle')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {euFsi.latestValue.toFixed(4)}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color }}>{cissLabelDisplay(euFsi.label)}</div>
          <div style={{ fontSize: 10, color: cissStale ? '#e67e22' : 'var(--text-dim)' }}>{dateStr}</div>
        </div>
      </div>
      {cissStale && (
        <div style={{ fontSize: 9, color: '#e67e22', background: 'rgba(230,126,34,0.1)', borderRadius: 4, padding: '4px 6px', marginBottom: 8 }}>
          ⚠ {t('components.fsi.cissStale')}
        </div>
      )}
      <GaugeBar fillPct={euFsi.latestValue * 100} gradient="linear-gradient(90deg,#27ae60,#f39c12,#c0392b)" />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', marginTop: 3 }}>
        <span>{t('components.fsi.scale.noStress')}</span>
        <span>{t('components.fsi.scale.extremeStress')}</span>
      </div>
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside Panel base class's content div. */
export function FSIPanelContent() {
  const { data, loading, error, refetch } = usePanelData<FSIData>(fetchFSIData, {
    ttlMs: 5 * 60 * 1000,
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

  const { fsiValue, fsiLabel, hygPrice, tltPrice, vix, hySpread, euFsi } = data;
  const labelColor = fsiLabelColor(fsiLabel);
  const fillPct = Math.min(Math.max((fsiValue / 2.5) * 100, 0), 100);
  const na = t('components.fsi.notAvailable');

  return (
    <div style={{ padding: '12px 14px' }}>
      {/* US FSI hero value */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>{t('components.fsi.usFsiValue')}</div>
        <div style={{ fontSize: 36, fontWeight: 700, color: labelColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {fsiValue.toFixed(4)}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: labelColor, marginTop: 4 }}>
          {fsiLabelDisplay(fsiLabel)}
        </div>
      </div>

      {/* Gauge bar — left = high stress, right = low stress */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', marginBottom: 3 }}>
          <span>{t('components.fsi.scale.highStress')}</span>
          <span>{t('components.fsi.scale.lowStress')}</span>
        </div>
        <GaugeBar fillPct={fillPct} gradient="linear-gradient(90deg,#c0392b,#f39c12,#27ae60)" />
      </div>

      {/* Supporting metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 12 }}>
        <MetricCard label={t('components.fsi.metrics.vix')}      value={vix > 0       ? vix.toFixed(2)         : na} />
        <MetricCard label={t('components.fsi.metrics.hySpread')} value={hySpread > 0   ? hySpread.toFixed(2) + '%' : na} />
        <MetricCard label={t('components.fsi.metrics.hygPrice')} value={hygPrice > 0   ? '$' + hygPrice.toFixed(2)  : na} />
        <MetricCard label={t('components.fsi.metrics.tltPrice')} value={tltPrice > 0   ? '$' + tltPrice.toFixed(2)  : na} />
      </div>

      {/* Interpretation */}
      <div style={{ fontSize: 11, color: 'var(--text-dim)', background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '8px 10px', borderLeft: `3px solid ${labelColor}` }}>
        {fsiInterpretation(fsiLabel)}
      </div>

      {/* EU CISS section */}
      {euFsi && <CISSSection euFsi={euFsi} />}
    </div>
  );
}

export function FSIPanel() {
  return (
    <PanelShell
      id="fsi"
      title={t('components.fsi.title')}
      infoTooltip={t('components.fsi.infoTooltip')}
    >
      <FSIPanelContent />
    </PanelShell>
  );
}
