import { useState, useEffect, useRef, useCallback, type RefObject } from 'react';
import * as d3 from 'd3';
import {
  type ProgressDataSet,
  type ProgressDataPoint,
  type ProgressDataSource,
  fetchProgressData,
} from '@/services/progress-data';
import { usePanelData } from '@/hooks/usePanelData';
import { getCSSColor } from '@/utils';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

// ── Constants ─────────────────────────────────────────────────────────────────

const CHART_MARGIN = { top: 8, right: 12, bottom: 24, left: 40 };
const CHART_HEIGHT = 90;
const RESIZE_DEBOUNCE_MS = 200;

// ── Types ─────────────────────────────────────────────────────────────────────

interface TooltipState {
  text: string;
  x: number;
  y: number;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatAxisValue(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatTooltipValue(value: number): string {
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

// ── D3 chart renderer ─────────────────────────────────────────────────────────

function renderD3Chart(
  container: HTMLElement,
  contentEl: HTMLElement,
  data: ProgressDataPoint[],
  color: string,
  onTooltip: (state: TooltipState | null) => void,
): void {
  const containerWidth = contentEl.clientWidth - 16;
  if (containerWidth <= 0) return;

  const width = containerWidth - CHART_MARGIN.left - CHART_MARGIN.right;
  const height = CHART_HEIGHT;

  const svg = d3.select(container)
    .append('svg')
    .attr('width', containerWidth)
    .attr('height', height + CHART_MARGIN.top + CHART_MARGIN.bottom)
    .style('display', 'block');

  const g = svg.append('g')
    .attr('transform', `translate(${CHART_MARGIN.left},${CHART_MARGIN.top})`);

  const xExtent = d3.extent(data, d => d.year) as [number, number];
  const yExtent = d3.extent(data, d => d.value) as [number, number];
  const yPadding = (yExtent[1] - yExtent[0]) * 0.1;

  const x = d3.scaleLinear().domain(xExtent).range([0, width]);
  const y = d3.scaleLinear()
    .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
    .range([height, 0]);

  const area = d3.area<ProgressDataPoint>()
    .x(d => x(d.year)).y0(height).y1(d => y(d.value))
    .curve(d3.curveMonotoneX);

  const line = d3.line<ProgressDataPoint>()
    .x(d => x(d.year)).y(d => y(d.value))
    .curve(d3.curveMonotoneX);

  g.append('path').datum(data).attr('d', area).attr('fill', color).attr('opacity', 0.2);
  g.append('path').datum(data).attr('d', line).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2);

  const xAxisG = g.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x).ticks(Math.min(5, data.length)).tickFormat(d => String(d)));
  xAxisG.selectAll('text').attr('fill', 'var(--text-dim)').attr('font-size', '9px');
  xAxisG.selectAll('line').attr('stroke', 'var(--border-subtle)');
  xAxisG.select('.domain').attr('stroke', 'var(--border-subtle)');

  const yAxisG = g.append('g')
    .call(d3.axisLeft(y).ticks(3).tickFormat(d => formatAxisValue(d as number)));
  yAxisG.selectAll('text').attr('fill', 'var(--text-dim)').attr('font-size', '9px');
  yAxisG.selectAll('line').attr('stroke', 'var(--border-subtle)');
  yAxisG.select('.domain').attr('stroke', 'var(--border-subtle)');

  // Hover interaction
  const bisector = d3.bisector<ProgressDataPoint, number>(d => d.year).left;

  const focusLine = g.append('line')
    .attr('stroke', color).attr('stroke-width', 1).attr('stroke-dasharray', '3,3').attr('opacity', 0);
  const focusDot = g.append('circle')
    .attr('r', 3.5).attr('fill', color).attr('stroke', '#fff').attr('stroke-width', 1.5).attr('opacity', 0);

  g.append('rect')
    .attr('width', width).attr('height', height)
    .attr('fill', 'none').attr('pointer-events', 'all')
    .style('cursor', 'crosshair')
    .on('mousemove', (event: MouseEvent) => {
      const overlayNode = (event.target as SVGRectElement);
      const [mx] = d3.pointer(event, overlayNode);
      const yearVal = x.invert(mx);
      const idx = bisector(data, yearVal, 1);
      const d0 = data[idx - 1];
      const d1 = data[idx];
      if (!d0) return;
      const nearest = d1 && (yearVal - d0.year > d1.year - yearVal) ? d1 : d0;
      const cx = x(nearest.year);
      const cy = y(nearest.value);

      focusLine.attr('x1', cx).attr('x2', cx).attr('y1', 0).attr('y2', height).attr('opacity', 0.4);
      focusDot.attr('cx', cx).attr('cy', cy).attr('opacity', 1);

      // Position relative to content element
      const contentRect = contentEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const tooltipX = containerRect.left - contentRect.left + CHART_MARGIN.left + cx + 10;
      const tooltipY = containerRect.top - contentRect.top + CHART_MARGIN.top + cy - 12;
      onTooltip({ text: `${nearest.year}: ${formatTooltipValue(nearest.value)}`, x: tooltipX, y: tooltipY });
    })
    .on('mouseleave', () => {
      focusLine.attr('opacity', 0);
      focusDot.attr('opacity', 0);
      onTooltip(null);
    });
}

// ── Single chart component ────────────────────────────────────────────────────

function ProgressChart({
  dataset,
  contentRef,
  containerWidth,
  onTooltip,
}: {
  dataset: ProgressDataSet;
  contentRef: RefObject<HTMLDivElement>;
  containerWidth: number;
  onTooltip: (state: TooltipState | null) => void;
}) {
  const chartDivRef = useRef<HTMLDivElement>(null);
  const { indicator, data, changePercent } = dataset;
  const oldest = data[0];
  const sign = changePercent >= 0 ? '+' : '';
  const changeText = `${sign}${changePercent.toFixed(1)}% since ${oldest?.year}`;
  const unitText = indicator.unit ? ` (${indicator.unit})` : '';

  useEffect(() => {
    const el = chartDivRef.current;
    const contentEl = contentRef.current;
    if (!el || !contentEl || data.length === 0) return;
    // Clear previous SVG before redrawing
    el.innerHTML = '';
    renderD3Chart(el, contentEl, data, indicator.color, onTooltip);
  }, [data, indicator.color, contentRef, onTooltip, containerWidth]);

  return (
    <div className="progress-chart-container" style={{ marginBottom: 12 }}>
      <div
        className="progress-chart-header"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 4px 4px' }}
      >
        <span className="progress-chart-label" style={{ fontWeight: 600, fontSize: 12, color: indicator.color }}>
          {indicator.label}
        </span>
        <span className="progress-chart-meta" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {changeText}{unitText}
        </span>
      </div>
      <div className="progress-chart-svg-container" ref={chartDivRef} />
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

export function ProgressChartsPanelContent() {
  const { data, loading } = usePanelData(fetchProgressData, { ttlMs: 6 * 60 * 60 * 1000 });
  const datasets: ProgressDataSet[] = data ? (Array.isArray(data) ? data : data.datasets) : [];
  const source: ProgressDataSource = data && !Array.isArray(data) ? data.source : 'hydrated';

  const [containerWidth, setContainerWidth] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // ResizeObserver — updates containerWidth to trigger chart re-renders
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => setContainerWidth(el.clientWidth), RESIZE_DEBOUNCE_MS);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => {
      ro.disconnect();
      if (debounce) clearTimeout(debounce);
    };
  }, []);

  const handleTooltip = useCallback((state: TooltipState | null) => setTooltip(state), []);

  const valid = datasets.filter(ds => ds.data.length > 0);

  if (loading && datasets.length === 0) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar"><div className="panel-radar-sweep" /><div className="panel-radar-dot" /></div>
      </div>
    );
  }

  if (datasets.length > 0 && valid.length === 0) {
    return (
      <div className="progress-charts-empty" style={{ padding: 16, color: 'var(--text-dim)', textAlign: 'center' }}>
        {t('components.progressCharts.noData')}
      </div>
    );
  }

  return (
    <div ref={contentRef} style={{ position: 'relative' }}>
      {source === 'fallback' && (
        <div
          className="progress-charts-fallback-banner"
          role="status"
          data-source="fallback"
          title={t('components.progressCharts.fallbackTooltip')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            margin: '0 0 8px 0', padding: '6px 8px', fontSize: 11,
            color: 'var(--text-dim)',
            background: 'var(--bg-subtle, rgba(255,255,255,0.04))',
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
            borderRadius: 4,
          }}
        >
          {t('components.progressCharts.fallbackBadge')}
        </div>
      )}

      {valid.map(dataset => (
        <ProgressChart
          key={dataset.indicator.id}
          dataset={dataset}
          contentRef={contentRef as RefObject<HTMLDivElement>}
          containerWidth={containerWidth}
          onTooltip={handleTooltip}
        />
      ))}

      {tooltip && (
        <div
          className="progress-chart-tooltip"
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            background: getCSSColor('--bg'),
            border: `1px solid ${getCSSColor('--border')}`,
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            color: getCSSColor('--text'),
            zIndex: 9999,
            whiteSpace: 'nowrap',
            boxShadow: `0 2px 6px ${getCSSColor('--shadow-color')}`,
            left: tooltip.x,
            top: tooltip.y,
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

export function ProgressChartsPanel() {
  return (
    <PanelShell
      id="progress"
      title="Human Progress"
    >
      <ProgressChartsPanelContent />
    </PanelShell>
  );
}
