import { usePanelData } from '@/hooks/usePanelData';
import { getHydratedData } from '@/services/bootstrap';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

interface CategoryData {
  score: number;
  weight: number;
  contribution: number;
  degraded?: boolean;
}

export interface FearGreedData {
  compositeScore: number;
  compositeLabel: string;
  previousScore: number;
  seededAt: string;
  sentiment?: CategoryData;
  volatility?: CategoryData;
  positioning?: CategoryData;
  trend?: CategoryData;
  breadth?: CategoryData;
  momentum?: CategoryData;
  liquidity?: CategoryData;
  credit?: CategoryData;
  macro?: CategoryData;
  crossAsset?: CategoryData;
  vix: number;
  hySpread: number;
  yield10y: number;
  putCallRatio: number;
  pctAbove200d: number;
  cnnFearGreed: number;
  cnnLabel: string;
  aaiiBull: number;
  aaiiBear: number;
  fedRate: string;
  unavailable?: boolean;
}

const CAT_KEYS = ['sentiment','volatility','positioning','trend','breadth','momentum','liquidity','credit','macro','crossAsset'] as const;

const CAT_DISPLAY: Record<string, string> = {
  sentiment: 'Sentiment', volatility: 'Volatility', positioning: 'Positioning',
  trend: 'Trend', breadth: 'Breadth', momentum: 'Momentum',
  liquidity: 'Liquidity', credit: 'Credit', macro: 'Macro', crossAsset: 'Cross-Asset',
};

function scoreColor(score: number): string {
  if (score <= 20) return '#e74c3c';
  if (score <= 40) return '#e67e22';
  if (score <= 60) return '#f1c40f';
  if (score <= 80) return '#2ecc71';
  return '#27ae60';
}

function fmt(v: number | null | undefined, digits = 2): string {
  return v == null ? 'N/A' : v.toFixed(digits);
}

function getRegimeState(score: number): { state: string; stance: string; color: string } {
  if (score <= 20) return { state: 'Crisis / Risk-Off',    stance: 'CASH',       color: '#c0392b' };
  if (score <= 35) return { state: 'Stressed / Defensive', stance: 'DEFENSIVE',  color: '#e67e22' };
  if (score <= 50) return { state: 'Fragile / Hedged',     stance: 'HEDGED',     color: '#f1c40f' };
  if (score <= 65) return { state: 'Stable / Normal',      stance: 'NORMAL',     color: '#2ecc71' };
  return               { state: 'Strong / Risk-On',       stance: 'AGGRESSIVE', color: '#27ae60' };
}

function getDivergenceWarnings(d: FearGreedData): string[] {
  const warnings: string[] = [];
  const mom  = d.momentum?.score ?? 50;
  const sent = d.sentiment?.score ?? 50;
  const comp = d.compositeScore;
  if (mom < 10)  warnings.push('Momentum at extreme low — broad equity selling pressure');
  if (sent < 15) warnings.push('Sentiment in extreme fear zone');
  if (d.cnnFearGreed > 0 && Math.abs(comp - d.cnnFearGreed) > 20)
    warnings.push(`CNN F&G ${Math.round(d.cnnFearGreed)} diverges ${Math.abs(Math.round(comp - d.cnnFearGreed))}pts from composite`);
  if ((d.trend?.score ?? 50) < 20) warnings.push('Trend in breakdown — price structure deteriorating');
  return warnings;
}

function mapSeedPayload(raw: Record<string, unknown>): FearGreedData | null {
  const comp = raw.composite as Record<string, unknown> | undefined;
  if (!comp?.score) return null;
  const cats = (raw.categories ?? {}) as Record<string, Record<string, unknown>>;
  const hdr  = (raw.headerMetrics ?? {}) as Record<string, Record<string, unknown> | null>;
  const mapCat = (c: Record<string, unknown> | undefined): CategoryData | undefined =>
    c ? { score: Number(c.score ?? 50), weight: Number(c.weight ?? 0), contribution: Number(c.contribution ?? 0), degraded: Boolean(c.degraded) } : undefined;
  return {
    compositeScore: Number(comp.score), compositeLabel: String(comp.label ?? ''),
    previousScore: Number(comp.previous ?? 0), seededAt: String(raw.timestamp ?? ''),
    sentiment: mapCat(cats.sentiment), volatility: mapCat(cats.volatility),
    positioning: mapCat(cats.positioning), trend: mapCat(cats.trend),
    breadth: mapCat(cats.breadth), momentum: mapCat(cats.momentum),
    liquidity: mapCat(cats.liquidity), credit: mapCat(cats.credit),
    macro: mapCat(cats.macro), crossAsset: mapCat(cats.crossAsset),
    vix: Number(hdr?.vix?.value ?? 0), hySpread: Number(hdr?.hySpread?.value ?? 0),
    yield10y: Number(hdr?.yield10y?.value ?? 0), putCallRatio: Number(hdr?.putCall?.value ?? 0),
    pctAbove200d: Number(hdr?.pctAbove200d?.value ?? 0),
    cnnFearGreed: Number(hdr?.cnnFearGreed?.value ?? 0), cnnLabel: String(hdr?.cnnFearGreed?.label ?? ''),
    aaiiBull: Number(hdr?.aaiBull?.value ?? 0), aaiiBear: Number(hdr?.aaiBear?.value ?? 0),
    fedRate: String(hdr?.fedRate?.value ?? ''), unavailable: false,
  };
}

async function fetchFearGreedData(_signal: AbortSignal): Promise<FearGreedData> {
  const hydrated = getHydratedData('fearGreedIndex') as Record<string, unknown> | undefined;
  if (hydrated && !hydrated.unavailable) {
    const mapped = mapSeedPayload(hydrated);
    if (mapped && mapped.compositeScore > 0) return mapped;
  }
  const { MarketServiceClient } = await import('@/generated/client/worldmonitor/market/v1/service_client');
  const { getRpcBaseUrl } = await import('@/services/rpc-client');
  const client = new MarketServiceClient(getRpcBaseUrl(), { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) });
  const resp = await client.getFearGreedIndex({});
  if (resp.unavailable) throw new Error(t('common.noDataShort'));
  return resp as unknown as FearGreedData;
}

// ── Sub-components ──────────────────────────────────────────────────────────

function coord(cx: number, cy: number, deg: number, radius: number): string {
  const a = (deg * Math.PI) / 180;
  return `${(cx + radius * Math.cos(a)).toFixed(2)},${(cy - radius * Math.sin(a)).toFixed(2)}`;
}

const GAUGE_ZONES = [
  { a1: 180, a2: 144, fill: '#c0392b' },
  { a1: 144, a2: 108, fill: '#e67e22' },
  { a1: 108, a2:  72, fill: '#f1c40f' },
  { a1:  72, a2:  36, fill: '#2ecc71' },
  { a1:  36, a2:   0, fill: '#27ae60' },
];

function Gauge({ score, label, delta, color }: { score: number; label: string; delta: number | null; color: string }) {
  const cx = 100, cy = 100, R = 88, r = 60;
  const na = ((180 - score * 1.8) * Math.PI) / 180;
  const nx = (cx + 75 * Math.cos(na)).toFixed(1);
  const ny = (cy - 75 * Math.sin(na)).toFixed(1);
  const dStr = delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} vs prev` : '';
  const dFill = delta != null ? (delta >= 0 ? '#2ecc71' : '#e74c3c') : '';

  return (
    <svg viewBox="0 0 200 115" width="200" height="115" style={{ display: 'block', margin: '0 auto' }}>
      {GAUGE_ZONES.map(z => (
        <path key={z.a1}
          d={`M${coord(cx, cy, z.a1, R)} A${R},${R} 0 0,0 ${coord(cx, cy, z.a2, R)} L${coord(cx, cy, z.a2, r)} A${r},${r} 0 0,1 ${coord(cx, cy, z.a1, r)} Z`}
          fill={z.fill} opacity="0.88"
        />
      ))}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="6" fill={color} />
      <circle cx={cx} cy={cy} r="3" fill="rgba(8,8,8,0.9)" />
      <text x={cx} y="81" textAnchor="middle" fontSize="26" fontWeight="700" fill={color} fontFamily="system-ui,-apple-system,sans-serif">{Math.round(score)}</text>
      <text x={cx} y="96" textAnchor="middle" fontSize="9" fontWeight="600" fill={color} letterSpacing="0.07em" fontFamily="system-ui,-apple-system,sans-serif">{label}</text>
      {dStr && <text x={cx} y="111" textAnchor="middle" fontSize="9" fill={dFill} fontFamily="system-ui,-apple-system,sans-serif">{dStr}</text>}
    </svg>
  );
}

function HdrMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '6px 4px' }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function CategoryRow({ name, cat }: { name: string; cat: CategoryData }) {
  const s = Math.round(cat.score ?? 50);
  const w = Math.round((cat.weight ?? 0) * 100);
  const contrib = (cat.contribution ?? 0).toFixed(1);
  const barColor = scoreColor(s);
  return (
    <div style={{ margin: '4px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)' }}>
        <span>
          {CAT_DISPLAY[name] ?? name}
          {cat.degraded && <span style={{ color: '#e67e22', fontSize: 10 }}> degraded</span>}
        </span>
        <span style={{ color: barColor, fontWeight: 600 }}>{s}</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, margin: '2px 0' }}>
        <div style={{ width: `${s}%`, height: '100%', background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{w}% weight &middot; +{contrib} pts</div>
    </div>
  );
}

/** Content-only component — rendered inside Panel base class's content div. */
export function FearGreedPanelContent() {
  const { data, loading, error, refetch } = usePanelData<FearGreedData>(fetchFearGreedData, {
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

  if (error || !data || data.unavailable || data.compositeScore <= 0) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.noDataShort')}</div>
        <button className="panel-error-retry" data-panel-retry onClick={refetch}>Retry</button>
      </div>
    );
  }

  const score  = data.compositeScore;
  const prev   = data.previousScore;
  const delta  = prev > 0 ? score - prev : null;
  const color  = scoreColor(score);
  const regime = getRegimeState(score);
  const warnings = getDivergenceWarnings(data);

  return (
    <div style={{ padding: '12px 14px' }}>
      {/* Regime header + gauge */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: regime.color, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
          {regime.state}
        </div>
        <Gauge score={score} label={data.compositeLabel} delta={delta} color={color} />
        <div style={{ textAlign: 'center', marginTop: 6, marginBottom: 8 }}>
          <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 999, fontSize: 10, fontWeight: 700, color: '#fff', background: regime.color, letterSpacing: '0.08em' }}>
            {regime.stance}
          </span>
        </div>
      </div>

      {/* Divergence warnings */}
      {warnings.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', marginBottom: 4, borderRadius: 4, border: '1px solid #e67e22', background: 'rgba(230,126,34,0.08)', fontSize: 10, color: '#e67e22' }}>
              &#9888; {w}
            </div>
          ))}
        </div>
      )}

      {/* Header metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 4, marginBottom: 12 }}>
        <HdrMetric label="VIX"       value={data.vix > 0          ? fmt(data.vix, 2)              : 'N/A'} />
        <HdrMetric label="HY Spread" value={data.hySpread > 0     ? `${fmt(data.hySpread, 2)}%`   : 'N/A'} />
        <HdrMetric label="10Y Yield" value={data.yield10y > 0     ? `${fmt(data.yield10y, 2)}%`   : 'N/A'} />
        <HdrMetric label="P/C Ratio" value={data.putCallRatio > 0 ? fmt(data.putCallRatio, 2)     : 'N/A'} />
        <HdrMetric label="% > 200d"  value={data.pctAbove200d     ? `${fmt(data.pctAbove200d, 1)}%` : 'N/A'} />
        <HdrMetric label="CNN F&G"   value={data.cnnFearGreed     ? `${Math.round(data.cnnFearGreed)}` : 'N/A'} />
        <HdrMetric label="AAII Bull" value={data.aaiiBull         ? `${fmt(data.aaiiBull, 1)}%`   : 'N/A'} />
        <HdrMetric label="AAII Bear" value={data.aaiiBear         ? `${fmt(data.aaiiBear, 1)}%`   : 'N/A'} />
        <HdrMetric label="Fed Rate"  value={data.fedRate || 'N/A'} />
      </div>

      {/* Category breakdown */}
      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        Category Breakdown
      </div>
      {CAT_KEYS.map(name => {
        const cat = data[name] as CategoryData | undefined;
        return cat ? <CategoryRow key={name} name={name} cat={cat} /> : null;
      })}
    </div>
  );
}

export function FearGreedPanel() {
  return (
    <PanelShell
      id="fear-greed"
      title={t('panels.fearGreed')}
      infoTooltip="Composite sentiment index: 10 weighted categories (volatility, positioning, breadth, momentum, liquidity, credit, macro, cross-asset, sentiment, trend)."
    >
      <FearGreedPanelContent />
    </PanelShell>
  );
}
