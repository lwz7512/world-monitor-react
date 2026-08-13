import { useState, useEffect, useRef, type RefObject } from 'react';
import * as d3 from 'd3';
import type {
  RenewableEnergyFetchResult,
  RegionRenewableData,
  CapacitySeries,
} from '@/services/renewable-energy-data';
import { getCSSColor } from '@/utils';
import { PanelShell } from '@/components/PanelShell';
import { t } from '@/services/i18n';

// ── Arc gauge ─────────────────────────────────────────────────────────────────

function GaugeChart({ percentage, year }: { percentage: number; year: number }) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    el.innerHTML = '';

    const size = 140;
    const radius = size / 2;
    const innerRadius = radius * 0.7;
    const outerRadius = radius;

    const svg = d3.select(el)
      .append('svg')
      .attr('viewBox', `0 0 ${size} ${size}`)
      .attr('width', size).attr('height', size)
      .style('display', 'block');

    const g = svg.append('g').attr('transform', `translate(${radius},${radius})`);

    const arc = d3.arc().innerRadius(innerRadius).outerRadius(outerRadius).cornerRadius(4).startAngle(0);

    g.append('path')
      .datum({ endAngle: Math.PI * 2 })
      .attr('d', arc as any)
      .attr('fill', getCSSColor('--border'));

    const targetAngle = (percentage / 100) * Math.PI * 2;
    const foreground = g.append('path')
      .datum({ endAngle: 0 })
      .attr('d', arc as any)
      .attr('fill', getCSSColor('--green'));

    const interpolate = d3.interpolate(0, targetAngle);
    foreground.transition().duration(1500).ease(d3.easeCubicOut)
      .attrTween('d', () => (t: number) => (arc as any)({ endAngle: interpolate(t) }));

    g.append('text')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('dy', '-0.15em').attr('fill', getCSSColor('--text'))
      .attr('font-size', '22px').attr('font-weight', '700')
      .text(`${percentage.toFixed(1)}%`);

    g.append('text')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('dy', '1.4em').attr('fill', getCSSColor('--text-dim'))
      .attr('font-size', '10px').text('Renewable');
  }, [percentage]);

  return (
    <div className="renewable-gauge-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 12 }}>
      <div ref={divRef} />
      <div className="gauge-year" style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
        Data from {year}
      </div>
    </div>
  );
}

// ── Historical sparkline ──────────────────────────────────────────────────────

function SparklineChart({
  historicalData,
  containerRef,
}: {
  historicalData: Array<{ year: number; value: number }>;
  containerRef: RefObject<HTMLDivElement>;
}) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    el.innerHTML = '';

    const containerWidth = containerRef.current?.clientWidth ?? 200;
    const totalWidth = containerWidth - 16;
    const height = 40;
    const margin = { top: 4, right: 8, bottom: 4, left: 8 };
    const width = totalWidth - margin.left - margin.right;
    if (width <= 0) return;

    const svg = d3.select(el)
      .append('svg').attr('width', totalWidth)
      .attr('height', height + margin.top + margin.bottom)
      .style('display', 'block');

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xExtent = d3.extent(historicalData, d => d.year) as [number, number];
    const yExtent = d3.extent(historicalData, d => d.value) as [number, number];
    const yPadding = (yExtent[1] - yExtent[0]) * 0.1;

    const x = d3.scaleLinear().domain(xExtent).range([0, width]);
    const y = d3.scaleLinear().domain([yExtent[0] - yPadding, yExtent[1] + yPadding]).range([height, 0]);
    const greenColor = getCSSColor('--green');

    g.append('path').datum(historicalData)
      .attr('d', d3.area<{ year: number; value: number }>()
        .x(d => x(d.year)).y0(height).y1(d => y(d.value)).curve(d3.curveMonotoneX))
      .attr('fill', greenColor).attr('opacity', 0.15);

    g.append('path').datum(historicalData)
      .attr('d', d3.line<{ year: number; value: number }>()
        .x(d => x(d.year)).y(d => y(d.value)).curve(d3.curveMonotoneX))
      .attr('fill', 'none').attr('stroke', greenColor).attr('stroke-width', 1.5);
  }, [historicalData, containerRef]);

  return <div className="renewable-sparkline-section" style={{ marginBottom: 12 }} ref={divRef} />;
}

// ── Regional breakdown ────────────────────────────────────────────────────────

function RegionRow({ region, barWidthPct, index, total }: { region: RegionRenewableData; barWidthPct: number; index: number; total: number }) {
  const opacity = total > 1 ? 1.0 - (index / (total - 1)) * 0.5 : 1.0;
  return (
    <div className="region-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span className="region-name" style={{ fontSize: 11, color: 'var(--text-dim)', minWidth: 120, flexShrink: 0 }}>
        {region.name}
      </span>
      <div className="region-bar-container" style={{ flex: 1, height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
        <div
          className="region-bar"
          style={{
            width: `${barWidthPct}%`,
            height: '100%',
            background: getCSSColor('--green'),
            opacity,
            borderRadius: 4,
            transition: 'width 0.6s ease-out',
          }}
        />
      </div>
      <span className="region-value" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', minWidth: 42, textAlign: 'right', flexShrink: 0 }}>
        {region.percentage.toFixed(1)}%
      </span>
    </div>
  );
}

// ── Capacity stacked area chart ───────────────────────────────────────────────

function CapacityChart({
  series,
  containerRef,
}: {
  series: CapacitySeries[];
  containerRef: RefObject<HTMLDivElement>;
}) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = divRef.current;
    if (!el || series.length === 0) return;
    el.innerHTML = '';

    const solarSeries = series.find(s => s.source === 'SUN');
    const windSeries = series.find(s => s.source === 'WND');
    const coalSeries = series.find(s => s.source === 'COL');

    const allYears = new Set<number>();
    for (const s of series) for (const d of s.data) allYears.add(d.year);
    if (allYears.size === 0) return;

    const sortedYears = [...allYears].sort((a, b) => a - b);
    const solarMap = new Map(solarSeries?.data.map(d => [d.year, d.capacityMw]) ?? []);
    const windMap = new Map(windSeries?.data.map(d => [d.year, d.capacityMw]) ?? []);
    const coalMap = new Map(coalSeries?.data.map(d => [d.year, d.capacityMw]) ?? []);

    const combinedData = sortedYears.map(year => ({
      year, solar: solarMap.get(year) ?? 0, wind: windMap.get(year) ?? 0, coal: coalMap.get(year) ?? 0,
    }));

    const containerWidth = containerRef.current?.clientWidth ?? 200;
    const totalWidth = containerWidth - 16;
    const height = 100;
    const margin = { top: 4, right: 8, bottom: 16, left: 8 };
    const innerWidth = totalWidth - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    if (innerWidth <= 0) return;

    const stack = d3.stack<{ year: number; solar: number; wind: number }>()
      .keys(['solar', 'wind']).order(d3.stackOrderNone).offset(d3.stackOffsetNone);
    const stacked = stack(combinedData);

    const xScale = d3.scaleLinear()
      .domain([sortedYears[0]!, sortedYears[sortedYears.length - 1]!]).range([0, innerWidth]);
    const stackedMax = d3.max(stacked, layer => d3.max(layer, d => d[1])) ?? 0;
    const coalMax = d3.max(combinedData, d => d.coal) ?? 0;
    const yMax = Math.max(stackedMax, coalMax) * 1.1;
    const yScale = d3.scaleLinear().domain([0, yMax]).range([innerHeight, 0]);

    const svg = d3.select(el).append('svg')
      .attr('width', totalWidth).attr('height', height)
      .attr('viewBox', `0 0 ${totalWidth} ${height}`)
      .style('display', 'block');
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const solarColor = getCSSColor('--yellow');
    const windColor = getCSSColor('--semantic-info');
    const coalColor = getCSSColor('--red');

    const areaGen = d3.area<d3.SeriesPoint<{ year: number; solar: number; wind: number }>>()
      .x(d => xScale(d.data.year)).y0(d => yScale(d[0])).y1(d => yScale(d[1]))
      .curve(d3.curveMonotoneX);

    stacked.forEach((layer, i) => {
      g.append('path').datum(layer).attr('d', areaGen)
        .attr('fill', i === 0 ? solarColor : windColor).attr('opacity', 0.6);
    });

    g.append('path').datum(combinedData)
      .attr('d', d3.area<{ year: number; coal: number }>()
        .x(d => xScale(d.year)).y0(innerHeight).y1(d => yScale(d.coal)).curve(d3.curveMonotoneX))
      .attr('fill', coalColor).attr('opacity', 0.2);

    g.append('path').datum(combinedData)
      .attr('d', d3.line<{ year: number; coal: number }>()
        .x(d => xScale(d.year)).y(d => yScale(d.coal)).curve(d3.curveMonotoneX))
      .attr('fill', 'none').attr('stroke', coalColor).attr('stroke-width', 1.5).attr('opacity', 0.8);

    const firstYear = sortedYears[0]!;
    const lastYear = sortedYears[sortedYears.length - 1]!;
    g.append('text').attr('x', xScale(firstYear)).attr('y', innerHeight + 12)
      .attr('text-anchor', 'start').attr('fill', getCSSColor('--text-dim')).attr('font-size', '9px').text(String(firstYear));
    g.append('text').attr('x', xScale(lastYear)).attr('y', innerHeight + 12)
      .attr('text-anchor', 'end').attr('fill', getCSSColor('--text-dim')).attr('font-size', '9px').text(String(lastYear));
  }, [series, containerRef]);

  return (
    <div className="capacity-section">
      <div className="capacity-header">US Installed Capacity (EIA)</div>
      <div ref={divRef} />
      <div className="capacity-legend">
        {[
          { color: getCSSColor('--yellow'), label: 'Solar' },
          { color: getCSSColor('--semantic-info'), label: 'Wind' },
          { color: getCSSColor('--red'), label: 'Coal' },
        ].map(({ color, label }) => (
          <div key={label} className="capacity-legend-item">
            <span className="capacity-legend-dot" style={{ backgroundColor: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

export function RenewableEnergyPanelContent() {
  const [result, setResult] = useState<RenewableEnergyFetchResult | null>(null);
  const [capacity, setCapacity] = useState<CapacitySeries[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    void (async () => {
      const { fetchRenewableEnergyData, fetchEnergyCapacity } = await import('@/services/renewable-energy-data');
      const r = await fetchRenewableEnergyData();
      if (unmountedRef.current) return;
      setResult(r);
      try {
        const cap = await fetchEnergyCapacity();
        if (unmountedRef.current) return;
        setCapacity(cap);
      } catch {
        // EIA capacity failure does not break the World Bank gauge
      }
    })();
    return () => { unmountedRef.current = true; };
  }, []);

  if (!result) return (
    <div className="panel-loading">
      <div className="panel-loading-radar"><div className="panel-radar-sweep" /><div className="panel-radar-dot" /></div>
    </div>
  );

  const { data } = result;
  const isEmpty = data === null || (data.globalPercentage === 0 && !data.regions?.length);

  if (isEmpty) {
    return (
      <div className="renewable-empty" style={{ padding: '24px 16px', color: 'var(--text-dim)', textAlign: 'center', fontSize: 13 }}>
        No renewable energy data available
      </div>
    );
  }

  const maxPct = Math.max(...(data!.regions?.map(r => r.percentage) ?? []), 1);

  return (
    <div className="renewable-container" ref={containerRef} style={{ padding: 8 }}>
      <GaugeChart percentage={data!.globalPercentage} year={data!.globalYear} />

      {(data!.historicalData?.length ?? 0) > 2 && (
        <SparklineChart historicalData={data!.historicalData} containerRef={containerRef as RefObject<HTMLDivElement>} />
      )}

      {(data!.regions?.length ?? 0) > 0 && (
        <div className="renewable-regions">
          {data!.regions.map((region, i) => (
            <RegionRow
              key={region.code}
              region={region}
              barWidthPct={(region.percentage / maxPct) * 100}
              index={i}
              total={data!.regions.length}
            />
          ))}
        </div>
      )}

      {capacity.length > 0 && (
        <CapacityChart series={capacity} containerRef={containerRef as RefObject<HTMLDivElement>} />
      )}
    </div>
  );
}

export function RenewableEnergyPanel() {
  return (
    <PanelShell
      id="renewable"
      title="Renewable Energy"
      infoTooltip={t('components.renewable.infoTooltip')}
    >
      <RenewableEnergyPanelContent />
    </PanelShell>
  );
}
