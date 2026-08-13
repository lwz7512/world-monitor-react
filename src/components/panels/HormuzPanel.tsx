import { useState, useCallback } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { fetchHormuzTracker } from '@/services/hormuz-tracker';
import type { HormuzTrackerData, HormuzChart, HormuzSeries } from '@/services/hormuz-tracker';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

// ── Constants ─────────────────────────────────────────────────────────────────

const CHART_COLORS = ['#e67e22', '#1abc9c', '#9b59b6', '#27ae60'];
const ZERO_COLOR   = 'rgba(231,76,60,0.5)';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case 'closed':     return '#e74c3c';
    case 'disrupted':  return '#e67e22';
    case 'restricted': return '#f39c12';
    default:           return '#2ecc71';
  }
}

async function fetchData(_signal: AbortSignal): Promise<HormuzTrackerData> {
  const data = await fetchHormuzTracker();
  if (!data) throw new Error(t('components.hormuzTracker.errors.unavailable'));
  return data;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface TooltipState { text: string; x: number; y: number; }

function BarChart({
  series, color, unit, width = 280, height = 52, onBarHover, onLeave,
}: {
  series: HormuzSeries[];
  color: string;
  unit: string;
  width?: number;
  height?: number;
  onBarHover: (text: string, x: number, y: number) => void;
  onLeave: () => void;
}) {
  if (!series.length) {
    return <div style={{ height, display: 'flex', alignItems: 'center', color: 'var(--text-dim)', fontSize: 10 }}>{t('components.hormuzTracker.noData')}</div>;
  }

  const max  = Math.max(...series.map(p => p.value), 1);
  const barW = Math.max(2, Math.floor((width - series.length) / series.length));

  return (
    <svg className="hz-svg" width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {series.map((p, i) => {
        const x = i * (barW + 1);
        const h = Math.max(p.value > 0 ? 2 : 1, Math.round((p.value / max) * (height - 2)));
        const fill = p.value === 0 ? ZERO_COLOR : color;
        return (
          <g key={i}>
            <rect x={x} y={height - h} width={barW} height={h} fill={fill} rx={1} />
            <rect
              x={x} y={0} width={barW} height={height} fill="transparent"
              style={{ cursor: 'crosshair' }}
              onMouseEnter={e => {
                const r = (e.target as SVGRectElement).getBoundingClientRect();
                onBarHover(`${p.date.slice(5)}  ${p.value} ${unit}`, r.left + r.width / 2, Math.max(8, r.top - 28));
              }}
              onMouseLeave={onLeave}
            />
          </g>
        );
      })}
    </svg>
  );
}

function ChartRow({
  chart, idx, onBarHover, onLeave,
}: {
  chart: HormuzChart;
  idx: number;
  onBarHover: (text: string, x: number, y: number) => void;
  onLeave: () => void;
}) {
  const color   = CHART_COLORS[idx % CHART_COLORS.length] ?? '#3498db';
  const last    = chart.series[chart.series.length - 1];
  const lastVal = last ? Number(last.value).toFixed(0) : t('components.hormuzTracker.notAvailable');
  const lastDate = last ? last.date.slice(5) : '';
  const unit    = chart.label.includes('crude_oil')
    ? t('components.hormuzTracker.units.ktPerDay')
    : t('components.hormuzTracker.units.generic');

  return (
    <div className="hz-chart" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{chart.title}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color }}>
          {lastVal} <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{unit} · {lastDate}</span>
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        <BarChart series={chart.series} color={color} unit={unit} onBarHover={onBarHover} onLeave={onLeave} />
      </div>
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside Panel base class's content div. */
export function HormuzPanelContent() {
  const { data, loading, error, refetch } = usePanelData<HormuzTrackerData>(fetchData, {
    ttlMs: 30 * 60 * 1000,
  });

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const handleBarHover = useCallback((text: string, x: number, y: number) => {
    setTooltip({ text, x, y });
  }, []);

  const handleLeave = useCallback(() => setTooltip(null), []);

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

  const sColor = statusColor(data.status);

  return (
    <div style={{ padding: '12px 14px', position: 'relative' }}>
      {/* Fixed tooltip */}
      {tooltip && (
        <div className="hz-tip" style={{
          position: 'fixed', pointerEvents: 'none',
          left: tooltip.x, top: tooltip.y, transform: 'translateX(-50%)',
          background: 'rgba(15,17,26,0.95)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 4, padding: '3px 8px', fontSize: 10, color: '#fff',
          whiteSpace: 'nowrap', zIndex: 9999, letterSpacing: '0.02em',
        }}>
          {tooltip.text}
        </div>
      )}

      {/* Status badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ background: sColor, color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.08em' }}>
          {data.status.toUpperCase()}
        </span>
        {data.updatedDate && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{data.updatedDate}</span>}
      </div>

      {/* Charts */}
      <div>
        {data.charts.length > 0
          ? data.charts.map((c, i) => (
              <ChartRow key={c.label} chart={c} idx={i} onBarHover={handleBarHover} onLeave={handleLeave} />
            ))
          : <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: '8px 0' }}>{t('components.hormuzTracker.chartUnavailable')}</div>
        }
      </div>

      {/* Attribution */}
      <div style={{ marginTop: 4, fontSize: 9, color: 'var(--text-dim)' }}>
        {t('components.hormuzTracker.sourcePrefix')}{' '}
        <a href={data.attribution.url} target="_blank" rel="noopener" style={{ color: 'var(--text-dim)', textDecoration: 'underline' }}>
          {data.attribution.source}
        </a>
      </div>
    </div>
  );
}

export function HormuzPanel() {
  return (
    <PanelShell
      id="hormuz-tracker"
      title={t('components.hormuzTracker.title')}
      infoTooltip={t('components.hormuzTracker.infoTooltip')}
    >
      <HormuzPanelContent />
    </PanelShell>
  );
}
