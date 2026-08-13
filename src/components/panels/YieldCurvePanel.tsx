import { useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

// ── Constants & types ─────────────────────────────────────────────────────────

const SERIES_IDS = ['DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS5', 'DGS10', 'DGS30'] as const;
const TENOR_LABELS = ['1M', '3M', '6M', '1Y', '2Y', '5Y', '10Y', '30Y'];
const ECB_TENOR_ORDER = ['1Y', '2Y', '5Y', '10Y', '20Y', '30Y'];

const SVG_W = 480, SVG_H = 180;
const ML = 40, MR = 20, MT = 16, MB = 24;
const CW = SVG_W - ML - MR, CH = SVG_H - MT - MB;

type Tab = 'curve' | 'rates';

interface YieldPoint { tenor: string; value: number | null; }
interface RateObs    { date: string; value: number; }
interface RateRow    { id: string; label: string; obs: RateObs[]; color: string; }

export interface YieldCurveData {
  current:  YieldPoint[];
  prior:    YieldPoint[];
  ecbRates: Record<string, number> | null;
  rateRows: RateRow[];
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function xPos(i: number, n: number): number { return ML + (n <= 1 ? CW / 2 : (i / (n - 1)) * CW); }
function yPos(v: number, lo: number, hi: number): number { return MT + CH - ((v - lo) / (hi - lo || 1)) * CH; }

function polyPts(pts: YieldPoint[], lo: number, hi: number): string {
  return pts.flatMap((p, i) => p.value !== null ? [`${xPos(i, pts.length).toFixed(2)},${yPos(p.value, lo, hi).toFixed(2)}`] : []).join(' ');
}

function ecbXPos(tenor: string): number | null {
  const map: Record<string, number> = { '1Y': 3, '2Y': 4, '5Y': 5, '10Y': 6, '20Y': 6.5, '30Y': 7 };
  const idx = map[tenor];
  return idx != null ? ML + (idx / 7) * CW : null;
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchYieldCurve(_signal: AbortSignal): Promise<YieldCurveData> {
  const { EconomicServiceClient } = await import('@/generated/client/worldmonitor/economic/v1/service_client');
  const { getRpcBaseUrl } = await import('@/services/rpc-client');
  const client = new EconomicServiceClient(getRpcBaseUrl(), {
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  });

  const [fredResp, ecbResp] = await Promise.allSettled([
    client.getFredSeriesBatch({
      seriesIds: [...SERIES_IDS, 'ESTR', 'EURIBOR3M', 'EURIBOR6M', 'EURIBOR1Y'],
      limit: 36,
    }),
    client.getEuYieldCurve({}),
  ]);

  const results = fredResp.status === 'fulfilled' ? (fredResp.value.results ?? {}) : {};

  const current = SERIES_IDS.map((id, i) => {
    const obs = results[id]?.observations ?? [];
    return { tenor: TENOR_LABELS[i] ?? id, value: obs.length > 0 ? (obs[obs.length - 1]?.value ?? null) : null };
  });
  const prior = SERIES_IDS.map((id, i) => {
    const obs = results[id]?.observations ?? [];
    return { tenor: TENOR_LABELS[i] ?? id, value: obs.length > 1 ? (obs[obs.length - 2]?.value ?? null) : null };
  });
  const ecbRates = ecbResp.status === 'fulfilled' && !ecbResp.value.unavailable && ecbResp.value.data?.rates
    ? (ecbResp.value.data.rates as Record<string, number>) : null;
  const rateRows: RateRow[] = [
    { id: 'ESTR',       label: '€STR',       obs: results['ESTR']?.observations ?? [],       color: '#2ecc71' },
    { id: 'EURIBOR3M',  label: 'EURIBOR 3M', obs: results['EURIBOR3M']?.observations ?? [],  color: '#3498db' },
    { id: 'EURIBOR6M',  label: 'EURIBOR 6M', obs: results['EURIBOR6M']?.observations ?? [],  color: '#9b59b6' },
    { id: 'EURIBOR1Y',  label: 'EURIBOR 1Y', obs: results['EURIBOR1Y']?.observations ?? [],  color: '#e67e22' },
  ];

  if (current.every(p => p.value === null)) throw new Error('No yield data available');
  return { current, prior, ecbRates, rateRows };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function YieldCurveChart({ current, prior, ecbRates }: { current: YieldPoint[]; prior: YieldPoint[]; ecbRates: Record<string, number> | null }) {
  const usVals   = current.map(p => p.value).filter((v): v is number => v !== null);
  const prVals   = prior.map(p => p.value).filter((v): v is number => v !== null);
  const ecbVals  = ecbRates ? Object.values(ecbRates) : [];
  const all      = [...usVals, ...prVals, ...ecbVals];

  if (all.length === 0) {
    return <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12 }}>No yield data available.</div>;
  }

  const lo = Math.max(0, Math.min(...all) - 0.25);
  const hi = Math.max(...all) + 0.5;
  const ySteps = [0, 1, 2, 3].map(i => lo + ((hi - lo) / 3) * i);

  // ECB overlay polyline points
  const ecbPts = ECB_TENOR_ORDER.flatMap(tenor => {
    const r = ecbRates?.[tenor]; const x = ecbXPos(tenor);
    return r != null && x !== null ? [`${x.toFixed(2)},${yPos(r, lo, hi).toFixed(2)}`] : [];
  });

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
      {/* Y-axis labels + grid lines */}
      {ySteps.map((v, i) => {
        const y = yPos(v, lo, hi);
        return (
          <g key={i}>
            <text x={ML - 4} y={y} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize={8} dominantBaseline="middle">
              {v.toFixed(1)}%
            </text>
            <line x1={ML} y1={y} x2={SVG_W - MR} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          </g>
        );
      })}

      {/* X-axis labels */}
      {TENOR_LABELS.map((label, i) => (
        <text key={label} x={xPos(i, TENOR_LABELS.length)} y={SVG_H - MB + 12}
          textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={8}>{label}</text>
      ))}

      {/* Prior US curve */}
      {polyPts(prior, lo, hi) && (
        <polyline points={polyPts(prior, lo, hi)} fill="none"
          stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} strokeDasharray="4,3" strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* ECB overlay */}
      {ecbPts.length >= 2 && (
        <>
          <polyline points={ecbPts.join(' ')} fill="none"
            stroke="#2ecc71" strokeWidth={1.5} strokeDasharray="5,3" strokeLinecap="round" strokeLinejoin="round" />
          {ECB_TENOR_ORDER.map(tenor => {
            const r = ecbRates?.[tenor]; const x = ecbXPos(tenor);
            return r != null && x !== null
              ? <circle key={tenor} cx={x} cy={yPos(r, lo, hi)} r={2.5} fill="#2ecc71" stroke="rgba(0,0,0,0.4)" strokeWidth={1} />
              : null;
          })}
        </>
      )}

      {/* Current US curve */}
      <polyline points={polyPts(current, lo, hi)} fill="none"
        stroke="#3498db" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {current.map((p, i) => p.value !== null
        ? <circle key={p.tenor} cx={xPos(i, current.length)} cy={yPos(p.value, lo, hi)} r={3} fill="#3498db" stroke="rgba(0,0,0,0.4)" strokeWidth={1} />
        : null
      )}
    </svg>
  );
}

function YieldTable({ points }: { points: YieldPoint[] }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{points.map(p => (
            <th key={p.tenor} style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-dim)', padding: '4px 6px', textAlign: 'center' }}>{p.tenor}</th>
          ))}</tr>
        </thead>
        <tbody>
          <tr>{points.map(p => (
            <td key={p.tenor} style={{ fontSize: 11, color: 'var(--text)', padding: '4px 6px', textAlign: 'center' }}>
              {p.value !== null ? `${p.value.toFixed(2)}%` : 'N/A'}
            </td>
          ))}</tr>
        </tbody>
      </table>
    </div>
  );
}

function MiniSparkline({ obs, color, w = 80, h = 22 }: { obs: RateObs[]; color: string; w?: number; h?: number }) {
  const vals = obs.map(o => o.value).filter(v => Number.isFinite(v));
  if (vals.length < 2) return <svg width={w} height={h} />;
  const lo = Math.min(...vals), hi = Math.max(...vals), rng = hi - lo || 0.01;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - ((v - lo) / rng) * (h - 2) - 1).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RatesTab({ rows }: { rows: RateRow[] }) {
  if (rows.every(r => r.obs.length === 0)) {
    return <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12 }}>ECB rate data unavailable</div>;
  }
  return (
    <div style={{ paddingTop: 4 }}>
      {rows.map(row => {
        const latest = row.obs[row.obs.length - 1];
        if (!latest) return null;
        const prev = row.obs[row.obs.length - 2];
        const change = prev ? latest.value - prev.value : null;
        const changeColor = change === null ? '' : change >= 0 ? '#e74c3c' : '#27ae60';
        return (
          <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ width: 90, fontSize: 10, color: 'var(--text-dim)' }}>{row.label}</div>
            <MiniSparkline obs={row.obs.slice(-24)} color={row.color} />
            <div style={{ minWidth: 44, textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {latest.value.toFixed(2)}%
            </div>
            {change !== null && (
              <div style={{ fontSize: 10, color: changeColor }}>
                {change >= 0 ? '+' : ''}{change.toFixed(2)}%
              </div>
            )}
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 'auto' }}>{latest.date}</div>
          </div>
        );
      })}
      <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-dim)' }}>Source: ECB</div>
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside Panel base class's content div. */
export function YieldCurvePanelContent() {
  const { data, loading, error, refetch } = usePanelData<YieldCurveData>(fetchYieldCurve, {
    ttlMs: 15 * 60 * 1000,
  });
  const [tab, setTab] = useState<Tab>('curve');

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

  const { current, prior, ecbRates, rateRows } = data;

  // 2Y-10Y spread
  const y2  = current.find(p => p.tenor === '2Y')?.value ?? null;
  const y10 = current.find(p => p.tenor === '10Y')?.value ?? null;
  const inverted  = y2 !== null && y10 !== null && y2 > y10;
  const spreadBps = y2 !== null && y10 !== null ? Math.round((y10 - y2) * 100) : null;

  return (
    <div style={{ padding: '10px 14px 6px' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {(['curve', 'rates'] as Tab[]).map(tabId => (
          <button key={tabId} className={`panel-tab${tab === tabId ? ' active' : ''}`}
            style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setTab(tabId)}>
            {tabId === 'curve' ? 'US Curve' : 'ECB Rates'}
          </button>
        ))}
      </div>

      {tab === 'curve' ? (
        <>
          {/* Status badge + spread */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 4 }}>
            <span style={{
              background: inverted ? '#e74c3c' : '#2ecc71',
              color: inverted ? '#fff' : '#000',
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, letterSpacing: '0.08em',
            }}>
              {inverted ? 'INVERTED' : 'NORMAL'}
            </span>
            {spreadBps !== null && (
              <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 10 }}>
                2Y-10Y Spread:{' '}
                <span style={{ color: inverted ? '#e74c3c' : '#2ecc71' }}>
                  {spreadBps >= 0 ? '+' : ''}{spreadBps}bps
                </span>
              </span>
            )}
          </div>

          {/* Chart */}
          <div style={{ margin: '0 -4px' }}>
            <YieldCurveChart current={current} prior={prior} ecbRates={ecbRates} />
          </div>

          {/* Tenor table */}
          <YieldTable points={current} />

          {/* Legend */}
          <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-dim)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>
              <svg width={20} height={4} style={{ verticalAlign: 'middle' }}>
                <line x1={0} y1={2} x2={20} y2={2} stroke="#3498db" strokeWidth={2} />
              </svg>
              {' '}US (Current)
            </span>
            <span>
              <svg width={20} height={4} style={{ verticalAlign: 'middle' }}>
                <line x1={0} y1={2} x2={20} y2={2} stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} strokeDasharray="4,3" />
              </svg>
              {' '}US (Prior)
            </span>
            {ecbRates && (
              <span>
                <svg width={20} height={4} style={{ verticalAlign: 'middle' }}>
                  <line x1={0} y1={2} x2={20} y2={2} stroke="#2ecc71" strokeWidth={1.5} strokeDasharray="5,3" />
                </svg>
                {' '}EU (ECB AAA)
              </span>
            )}
            <span style={{ marginLeft: 'auto' }}>Source: FRED / ECB</span>
          </div>
        </>
      ) : (
        <RatesTab rows={rateRows} />
      )}
    </div>
  );
}

export function YieldCurvePanel() {
  return (
    <PanelShell
      id="yield-curve"
      title="Yield Curve & Rates"
      infoTooltip={t('components.yieldCurve.infoTooltip')}
    >
      <YieldCurvePanelContent />
    </PanelShell>
  );
}
