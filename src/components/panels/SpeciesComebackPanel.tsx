import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { type SpeciesRecovery, fetchConservationWins } from '@/services/conservation-data';
import { usePanelData } from '@/hooks/usePanelData';
import { getCSSColor } from '@/utils';
import { getLocale } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';
import { t } from '@/services/i18n';

// ── Constants ─────────────────────────────────────────────────────────────────

const SPARKLINE_MARGIN = { top: 4, right: 8, bottom: 16, left: 8 };
const SPARKLINE_HEIGHT = 50;
const VIEWBOX_WIDTH = 280;

const FALLBACK_IMAGE_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" fill="%236B8F5E">' +
  '<rect width="400" height="300" fill="%23f0f4ed"/>' +
  '<text x="200" y="160" text-anchor="middle" font-size="64">&#x1F33F;</text>' +
  '</svg>',
);

// ── Number formatting ─────────────────────────────────────────────────────────

let _numFmtLocale = '';
let _numFmt: Intl.NumberFormat = new Intl.NumberFormat('en-US');

function getNumberFormat(): Intl.NumberFormat {
  const locale = getLocale();
  if (locale !== _numFmtLocale) {
    _numFmtLocale = locale;
    _numFmt = new Intl.NumberFormat(locale);
  }
  return _numFmt;
}

// ── Sparkline sub-component ───────────────────────────────────────────────────

function SparklineChart({ data }: { data: Array<{ year: number; value: number }> }) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = divRef.current;
    if (!el || data.length < 2) return;

    el.innerHTML = '';
    const color = getCSSColor('--green') || '#6B8F5E';
    const width = VIEWBOX_WIDTH - SPARKLINE_MARGIN.left - SPARKLINE_MARGIN.right;
    const height = SPARKLINE_HEIGHT;

    const svg = d3.select(el)
      .append('svg')
      .attr('width', '100%')
      .attr('height', height + SPARKLINE_MARGIN.top + SPARKLINE_MARGIN.bottom)
      .attr('viewBox', `0 0 ${VIEWBOX_WIDTH} ${height + SPARKLINE_MARGIN.top + SPARKLINE_MARGIN.bottom}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('display', 'block');

    const g = svg.append('g')
      .attr('transform', `translate(${SPARKLINE_MARGIN.left},${SPARKLINE_MARGIN.top})`);

    const xExtent = d3.extent(data, d => d.year) as [number, number];
    const yMax = d3.max(data, d => d.value) as number;
    const yPadding = yMax * 0.1;

    const x = d3.scaleLinear().domain(xExtent).range([0, width]);
    const y = d3.scaleLinear().domain([0, yMax + yPadding]).range([height, 0]);

    const area = d3.area<{ year: number; value: number }>()
      .x(d => x(d.year)).y0(height).y1(d => y(d.value))
      .curve(d3.curveMonotoneX);

    const line = d3.line<{ year: number; value: number }>()
      .x(d => x(d.year)).y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(data).attr('d', area).attr('fill', color).attr('opacity', 0.2);
    g.append('path').datum(data).attr('d', line).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.5);

    const fmt = getNumberFormat();
    const first = data[0]!;
    const last = data[data.length - 1]!;

    g.append('text')
      .attr('x', x(first.year)).attr('y', height + SPARKLINE_MARGIN.bottom - 2)
      .attr('text-anchor', 'start').attr('font-size', '9px').attr('fill', 'var(--text-dim, #999)')
      .text(`${first.year}: ${fmt.format(first.value)}`);

    g.append('text')
      .attr('x', x(last.year)).attr('y', height + SPARKLINE_MARGIN.bottom - 2)
      .attr('text-anchor', 'end').attr('font-size', '9px').attr('fill', 'var(--text-dim, #999)')
      .text(`${last.year}: ${fmt.format(last.value)}`);
  }, [data]);

  return <div className="species-sparkline" ref={divRef} />;
}

// ── Species card sub-component ────────────────────────────────────────────────

function SpeciesCard({ entry }: { entry: SpeciesRecovery }) {
  const recoveryLabel = entry.recoveryStatus.charAt(0).toUpperCase() + entry.recoveryStatus.slice(1);

  return (
    <div className="species-card">
      <div className="species-photo">
        <img
          src={entry.photoUrl}
          alt={entry.commonName}
          loading="lazy"
          onError={e => {
            const img = e.currentTarget;
            img.onerror = null;
            img.src = FALLBACK_IMAGE_SVG;
          }}
        />
      </div>

      <div className="species-info">
        <h4 className="species-name">{entry.commonName}</h4>
        <span className="species-scientific" style={{ fontStyle: 'italic' }}>{entry.scientificName}</span>
        <div className="species-badges">
          <span className={`species-badge badge-${entry.recoveryStatus}`}>{recoveryLabel}</span>
          <span className="species-badge badge-iucn">{entry.iucnCategory}</span>
        </div>
        <span className="species-region">{entry.region}</span>
      </div>

      <SparklineChart data={entry.populationData} />

      <div className="species-summary">
        <p>{entry.summaryText}</p>
        <cite className="species-source">{entry.source}</cite>
      </div>
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

export function SpeciesComebackPanelContent() {
  const { data: species, loading } = usePanelData(fetchConservationWins, { ttlMs: 6 * 60 * 60 * 1000 });

  if (loading || !species) return null;

  if (species.length === 0) {
    return <div className="species-empty">No conservation data available</div>;
  }

  return (
    <div className="species-grid">
      {species.map(entry => (
        <SpeciesCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

export function SpeciesComebackPanel() {
  return (
    <PanelShell
      id="species"
      title="Conservation Wins"
      infoTooltip={t('components.conservationWins.infoTooltip')}
    >
      <SpeciesComebackPanelContent />
    </PanelShell>
  );
}
