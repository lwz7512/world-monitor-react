import { usePanelData } from '@/hooks/usePanelData';
import { getHydratedData } from '@/services/bootstrap';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

// ── Types ────────────────────────────────────────────────────────────────────

interface BreadthSnapshot {
  date: string;
  pctAbove20d: number | null;
  pctAbove50d: number | null;
  pctAbove200d: number | null;
}

export interface BreadthData {
  currentPctAbove20d: number | null;
  currentPctAbove50d: number | null;
  currentPctAbove200d: number | null;
  updatedAt: string;
  history: BreadthSnapshot[];
  unavailable?: boolean;
}

interface RawHistoryEntry {
  date: string;
  pctAbove20d?: number | null;
  pctAbove50d?: number | null;
  pctAbove200d?: number | null;
}

interface RawSeedPayload {
  current?: { pctAbove20d?: number | null; pctAbove50d?: number | null; pctAbove200d?: number | null };
  currentPctAbove20d?: number | null;
  currentPctAbove50d?: number | null;
  currentPctAbove200d?: number | null;
  updatedAt?: string;
  history?: RawHistoryEntry[];
  unavailable?: boolean;
}

// ── Chart constants ───────────────────────────────────────────────────────────

const SVG_W = 480, SVG_H = 160;
const ML = 32, MR = 12, MT = 10, MB = 22;
const CW = SVG_W - ML - MR;
const CH = SVG_H - MT - MB;

type SeriesKey = 'pctAbove20d' | 'pctAbove50d' | 'pctAbove200d';
type SeriesRun = Array<{ x: number; y: number }>;

const SERIES: { key: SeriesKey; color: string; label: string; fillOpacity: number }[] = [
  { key: 'pctAbove20d',  color: '#3b82f6', label: '20-day SMA',  fillOpacity: 0.08 },
  { key: 'pctAbove50d',  color: '#f59e0b', label: '50-day SMA',  fillOpacity: 0.06 },
  { key: 'pctAbove200d', color: '#22c55e', label: '200-day SMA', fillOpacity: 0.04 },
];

// ── Pure helpers ──────────────────────────────────────────────────────────────

function toNullable(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Number.isFinite(v) ? v : null;
}

function normalizeBreadthData(raw: RawSeedPayload): BreadthData {
  const current = raw.current;
  return {
    currentPctAbove20d:  toNullable(raw.currentPctAbove20d  ?? current?.pctAbove20d),
    currentPctAbove50d:  toNullable(raw.currentPctAbove50d  ?? current?.pctAbove50d),
    currentPctAbove200d: toNullable(raw.currentPctAbove200d ?? current?.pctAbove200d),
    updatedAt: raw.updatedAt ?? '',
    history: (raw.history ?? []).map((e) => ({
      date: e.date,
      pctAbove20d:  toNullable(e.pctAbove20d),
      pctAbove50d:  toNullable(e.pctAbove50d),
      pctAbove200d: toNullable(e.pctAbove200d),
    })),
    unavailable: raw.unavailable,
  };
}

function xPos(i: number, total: number): number {
  if (total <= 1) return ML + CW / 2;
  return ML + (i / (total - 1)) * CW;
}

function yPos(v: number): number {
  return MT + CH - (v / 100) * CH;
}

/**
 * Split series into contiguous runs separated by null/missing readings.
 * Gaps stay visible instead of being bridged by a continuous line.
 */
function splitSeriesByNulls(points: BreadthSnapshot[], key: SeriesKey): SeriesRun[] {
  const runs: SeriesRun[] = [];
  let current: SeriesRun = [];
  for (let i = 0; i < points.length; i++) {
    const v = points[i]![key];
    if (v === null || v === undefined || !Number.isFinite(v)) {
      if (current.length > 0) { runs.push(current); current = []; }
      continue;
    }
    current.push({ x: xPos(i, points.length), y: yPos(v) });
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function runToAreaPath(run: SeriesRun): string {
  if (run.length < 2) return '';
  const baseline = yPos(0).toFixed(1);
  const first = run[0]!.x.toFixed(1);
  const last  = run[run.length - 1]!.x.toFixed(1);
  const coords = run.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L');
  return `M${first},${baseline} L${coords} L${last},${baseline} Z`;
}

function runToPolylinePoints(run: SeriesRun): string {
  return run.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

async function fetchBreadthData(_signal: AbortSignal): Promise<BreadthData> {
  const hydrated = getHydratedData('breadthHistory') as RawSeedPayload | undefined;
  if (hydrated && !hydrated.unavailable && hydrated.history?.length) {
    return normalizeBreadthData(hydrated);
  }
  const { MarketServiceClient } = await import('@/generated/client/worldmonitor/market/v1/service_client');
  const { getRpcBaseUrl } = await import('@/services/rpc-client');
  const client = new MarketServiceClient(getRpcBaseUrl(), { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) });
  const resp = await client.getMarketBreadthHistory({});
  if (resp.unavailable) throw new Error(t('common.noDataShort'));
  return normalizeBreadthData(resp as unknown as RawSeedPayload);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ReadingBadge({ val, color }: { val: number; color: string }) {
  const bg = val >= 60 ? 'rgba(34,197,94,0.12)' : val >= 40 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)';
  const fg = val >= 60 ? '#22c55e' : val >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, background: bg }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span style={{ fontSize: 14, fontWeight: 600, color: fg }}>{val.toFixed(1)}%</span>
    </span>
  );
}

function BreadthChart({ points }: { points: BreadthSnapshot[] }) {
  if (points.length < 2) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 20, fontSize: 11 }}>
        Collecting data. Chart appears after 2+ days.
      </div>
    );
  }

  const step = Math.max(1, Math.floor(points.length / 6));
  const midY = yPos(50);

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Y-axis grid + labels */}
      {[0, 25, 50, 75, 100].map((v) => {
        const y = yPos(v);
        return (
          <g key={v}>
            <line x1={ML} y1={y} x2={SVG_W - MR} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={ML - 3} y={y} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="8" dominantBaseline="middle">{v}%</text>
          </g>
        );
      })}

      {/* 50% midline dashed */}
      <line x1={ML} y1={midY} x2={SVG_W - MR} y2={midY} stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="4 3" />

      {/* X-axis date labels */}
      {points.map((p, i) => {
        if (i % step !== 0 && i !== points.length - 1) return null;
        return (
          <text key={i} x={xPos(i, points.length)} y={SVG_H - MB + 13} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="7">
            {p.date.slice(5)}
          </text>
        );
      })}

      {/* Area fills then stroke lines, one group per series */}
      {SERIES.map((s) => {
        const runs = splitSeriesByNulls(points, s.key);
        return (
          <g key={s.key}>
            {runs.map((run, ri) => {
              const d = runToAreaPath(run);
              return d ? <path key={ri} d={d} fill={s.color} opacity={s.fillOpacity} /> : null;
            })}
            {runs.map((run, ri) =>
              run.length >= 2
                ? <polyline key={ri} points={runToPolylinePoints(run)} fill="none" stroke={s.color} strokeWidth="1.5" opacity="0.9" />
                : null
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside Panel base class's content div. */
export function MarketBreadthPanelContent() {
  const { data, loading, error, refetch } = usePanelData<BreadthData>(fetchBreadthData, {
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

  if (error || !data?.history?.length) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.noDataShort')}</div>
        <button className="panel-error-retry" data-panel-retry onClick={refetch}>Retry</button>
      </div>
    );
  }

  const currentMap: Record<SeriesKey, number | null> = {
    pctAbove20d:  data.currentPctAbove20d,
    pctAbove50d:  data.currentPctAbove50d,
    pctAbove200d: data.currentPctAbove200d,
  };

  return (
    <div style={{ padding: '12px 14px' }}>
      {/* Legend with current readings */}
      <div style={{ marginBottom: 8 }}>
        {SERIES.map((s) => {
          const val = currentMap[s.key];
          const hasCurrent = typeof val === 'number' && Number.isFinite(val) && val >= 0;
          return (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-dim)' }}>
                <span style={{ width: 8, height: 3, borderRadius: 1, background: s.color, display: 'inline-block' }} />
                % Above {s.label}
              </span>
              {hasCurrent
                ? <ReadingBadge val={val as number} color={s.color} />
                : <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>—</span>
              }
            </div>
          );
        })}
      </div>

      {/* Chart */}
      <div style={{ borderRadius: 6, background: 'rgba(255,255,255,0.02)', padding: '4px 0' }}>
        <BreadthChart points={data.history} />
      </div>

      {data.updatedAt && (
        <div style={{ textAlign: 'right', fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>
          {new Date(data.updatedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

export function MarketBreadthPanel() {
  return (
    <PanelShell
      id="market-breadth"
      title={t('panels.marketBreadth')}
      infoTooltip="Percentage of S&P 500 stocks trading above their 20, 50, and 200-day simple moving averages. A measure of market participation and internal strength."
    >
      <MarketBreadthPanelContent />
    </PanelShell>
  );
}
