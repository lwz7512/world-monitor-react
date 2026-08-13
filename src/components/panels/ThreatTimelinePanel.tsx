import { useState, useEffect } from 'react';
import * as d3 from 'd3';
import { fetchServerInsights, getServerInsights } from '@/services/insights-loader';
import { sanitizeUrl } from '@/utils/sanitize';
import {
  THREAT_LEVELS,
  THREAT_LEVEL_COLORS,
  THREAT_LEVEL_LABELS,
  buildThreatTimelineState,
  countHighSeverityDays,
  describeThreatTimelineTrend,
  normalizeServerInsightStories,
  type ThreatTimelineDay,
  type ThreatTimelineGroup,
  type ThreatTimelineItem,
  type ThreatTimelineState,
  type TimelineThreatLevel,
} from '@/components/threat-timeline-utils';
import { PanelShell } from '@/components/PanelShell';

// ── Constants ─────────────────────────────────────────────────────────────────

const STACK_LEVELS = [...THREAT_LEVELS].reverse() as TimelineThreatLevel[];
const CHART_WIDTH = 360;
const CHART_HEIGHT = 150;
const MARGIN = { top: 12, right: 10, bottom: 28, left: 24 };

// ── Sub-components ────────────────────────────────────────────────────────────

interface StackRow {
  key: string;
  label: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

function ThreatChart({ days }: { days: ThreatTimelineDay[] }) {
  const rows: StackRow[] = days.map(day => ({
    key: day.key,
    label: day.label,
    critical: day.counts.critical,
    high: day.counts.high,
    medium: day.counts.medium,
    low: day.counts.low,
    info: day.counts.info,
  }));

  const maxTotal = Math.max(1, d3.max(days, day => day.total) ?? 1);
  const x = d3.scaleBand<string>()
    .domain(days.map(day => day.key))
    .range([MARGIN.left, CHART_WIDTH - MARGIN.right])
    .padding(0.24);
  const y = d3.scaleLinear()
    .domain([0, maxTotal])
    .nice()
    .range([CHART_HEIGHT - MARGIN.bottom, MARGIN.top]);

  const layers = d3.stack<StackRow, TimelineThreatLevel>().keys(STACK_LEVELS)(rows);
  const gridY = y(maxTotal);
  const axisY = CHART_HEIGHT - MARGIN.bottom;

  return (
    <div className="threat-timeline-chart-wrap">
      <svg
        className="threat-timeline-chart"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="Seven-day threat level distribution"
      >
        <line
          x1={MARGIN.left} x2={CHART_WIDTH - MARGIN.right}
          y1={gridY.toFixed(1)} y2={gridY.toFixed(1)}
          className="threat-timeline-grid"
        />
        <line
          x1={MARGIN.left} x2={CHART_WIDTH - MARGIN.right}
          y1={axisY.toFixed(1)} y2={axisY.toFixed(1)}
          className="threat-timeline-axis"
        />
        {layers.map(layer => {
          const level = layer.key as TimelineThreatLevel;
          return layer.map((segment, idx) => {
            const day = days[idx];
            if (!day) return null;
            const xPos = x(day.key);
            if (xPos === undefined) return null;
            const yTop = y(segment[1]);
            const yBottom = y(segment[0]);
            const barH = Math.max(0, yBottom - yTop);
            if (barH <= 0) return null;
            return (
              <rect
                key={`${level}-${day.key}`}
                x={xPos.toFixed(1)}
                y={yTop.toFixed(1)}
                width={x.bandwidth().toFixed(1)}
                height={barH.toFixed(1)}
                rx={2}
                fill={THREAT_LEVEL_COLORS[level]}
              >
                <title>{day.label} {THREAT_LEVEL_LABELS[level]}: {day.counts[level]}</title>
              </rect>
            );
          });
        })}
        <g className="threat-timeline-labels">
          {days.map(day => {
            const xPos = x(day.key);
            if (xPos === undefined) return null;
            const centerX = (xPos + x.bandwidth() / 2).toFixed(1);
            const [month = '', dayNumber = ''] = day.label.split(' ');
            return (
              <text key={day.key} x={centerX} y={CHART_HEIGHT - 16} textAnchor="middle">
                <tspan x={centerX} dy="0">{month}</tspan>
                <tspan x={centerX} dy="10">{dayNumber}</tspan>
              </text>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function ThreatItem({ item }: { item: ThreatTimelineItem }) {
  const href = sanitizeUrl(item.sourceUrl);
  const titleCodePoints = Array.from(item.title);
  const truncated = titleCodePoints.length > 94 ? `${titleCodePoints.slice(0, 91).join('')}...` : item.title;
  const source = item.provenance || item.source || 'News Digest';
  const diffMs = Math.max(0, Date.now() - item.timestampMs);
  const hours = Math.floor(diffMs / 3600000);
  const age = hours < 1 ? 'just now' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;

  return (
    <article className="threat-timeline-item">
      {href
        ? <a href={href} target="_blank" rel="noopener" className="threat-timeline-item-title">{truncated}</a>
        : <span className="threat-timeline-item-title">{truncated}</span>
      }
      <div className="threat-timeline-item-meta">
        <span className="threat-timeline-source">{source}</span>
        {item.sourceCount > 1 && <span className="threat-timeline-source-count">{item.sourceCount} sources</span>}
        <span>{age}</span>
      </div>
    </article>
  );
}

function ThreatGroups({ groups }: { groups: ThreatTimelineGroup[] }) {
  if (!groups.length) {
    return <div className="threat-timeline-empty-inline">No grouped alerts in the current window.</div>;
  }
  return (
    <>
      {groups.map(group => (
        <section key={group.level} className={`threat-timeline-group threat-${group.level}`}>
          <div className="threat-timeline-group-header">
            <span className="threat-timeline-group-name">{group.label}</span>
            <span className="threat-timeline-group-count">{group.count}</span>
          </div>
          {group.items.map(item => <ThreatItem key={item.id} item={item} />)}
        </section>
      ))}
    </>
  );
}

function PanelStyles() {
  return (
    <style>{`
      .threat-timeline-panel { display: grid; gap: 10px; }
      .threat-timeline-summary { display: grid; grid-template-columns: 76px 76px 1fr; gap: 8px; align-items: stretch; }
      .threat-timeline-stat, .threat-timeline-trend { border: 1px solid var(--border-color); background: var(--bg-secondary); border-radius: 8px; padding: 8px; min-width: 0; }
      .threat-timeline-stat-value { display: block; font-size: 20px; line-height: 1; font-weight: 700; color: var(--text-primary); }
      .threat-timeline-stat-label, .threat-timeline-trend-copy, .threat-timeline-footer, .threat-timeline-note { display: block; font-size: 11px; color: var(--text-secondary); margin-top: 4px; }
      .threat-timeline-trend { border-left: 3px solid var(--accent-color); }
      .threat-timeline-trend.worsening { border-left-color: #ef4444; }
      .threat-timeline-trend.easing { border-left-color: #38bdf8; }
      .threat-timeline-trend-label { display: block; color: var(--text-primary); font-size: 13px; font-weight: 700; }
      .threat-timeline-chart-wrap { border: 1px solid var(--border-color); border-radius: 8px; background: rgba(15, 23, 42, 0.18); padding: 6px; }
      .threat-timeline-chart { width: 100%; height: 150px; display: block; overflow: visible; }
      .threat-timeline-grid { stroke: var(--border-color); stroke-dasharray: 3 3; opacity: 0.7; }
      .threat-timeline-axis { stroke: var(--border-color); }
      .threat-timeline-labels text { fill: var(--text-secondary); font-size: 9px; }
      .threat-timeline-legend { display: flex; flex-wrap: wrap; gap: 6px; }
      .threat-timeline-legend-item { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-secondary); }
      .threat-timeline-swatch { width: 8px; height: 8px; border-radius: 999px; }
      .threat-timeline-groups { display: grid; gap: 8px; }
      .threat-timeline-group { border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; background: var(--bg-secondary); }
      .threat-timeline-group-header { display: flex; align-items: center; justify-content: space-between; padding: 7px 9px; border-bottom: 1px solid var(--border-color); }
      .threat-timeline-group-name { font-size: 12px; font-weight: 700; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0; }
      .threat-timeline-group-count { font-size: 11px; color: var(--text-secondary); }
      .threat-timeline-item { padding: 8px 9px; display: grid; gap: 4px; }
      .threat-timeline-item + .threat-timeline-item { border-top: 1px solid var(--border-color); }
      .threat-timeline-item-title { color: var(--text-primary); font-size: 12px; line-height: 1.35; text-decoration: none; }
      a.threat-timeline-item-title:hover { color: var(--accent-color); }
      .threat-timeline-item-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; color: var(--text-secondary); font-size: 10px; }
      .threat-timeline-source, .threat-timeline-source-count { border: 1px solid var(--border-color); border-radius: 999px; padding: 1px 6px; color: var(--text-secondary); }
      .threat-critical .threat-timeline-group-header { border-left: 3px solid #ef4444; }
      .threat-high .threat-timeline-group-header { border-left: 3px solid #f97316; }
      .threat-medium .threat-timeline-group-header { border-left: 3px solid #eab308; }
      .threat-low .threat-timeline-group-header { border-left: 3px solid #38bdf8; }
      .threat-info .threat-timeline-group-header { border-left: 3px solid #94a3b8; }
      .threat-timeline-empty, .threat-timeline-empty-inline { border: 1px dashed var(--border-color); border-radius: 8px; padding: 14px; color: var(--text-secondary); background: var(--bg-secondary); }
      .threat-timeline-empty-title { color: var(--text-primary); font-size: 13px; font-weight: 700; }
      .threat-timeline-empty-copy { margin-top: 5px; font-size: 12px; line-height: 1.4; color: var(--text-secondary); }
      @media (max-width: 520px) {
        .threat-timeline-summary { grid-template-columns: 1fr 1fr; }
        .threat-timeline-trend { grid-column: 1 / -1; }
      }
    `}</style>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

type RenderState =
  | { type: 'empty'; message: string; reasons: string[] }
  | { type: 'data'; state: ThreatTimelineState; sourceLabel: string };

export function ThreatTimelinePanelContent() {
  const [renderState, setRenderState] = useState<RenderState>({
    type: 'empty',
    message: 'Waiting for intelligence insight data.',
    reasons: [],
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const serverInsights = getServerInsights() ?? await fetchServerInsights();
        if (cancelled || !serverInsights) return;
        const items = normalizeServerInsightStories(serverInsights);
        const state = buildThreatTimelineState(items, {
          status: serverInsights.status,
          statusMessage: serverInsights.status === 'degraded' ? 'Server insight snapshot degraded' : '',
        });
        if (cancelled) return;
        if (!state.hasData) {
          setRenderState({
            type: 'empty',
            message: state.status === 'degraded'
              ? 'No recent threat metadata available from the intelligence snapshot.'
              : 'No recent threat metadata in the last 7 days.',
            reasons: state.degradedReasons,
          });
          return;
        }
        setRenderState({ type: 'data', state, sourceLabel: 'Insights snapshot' });
      } catch (err) {
        console.warn('[ThreatTimeline] insight fetch failed:', err);
        setRenderState({ type: 'empty', message: 'Failed to load threat timeline data.', reasons: [] });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (renderState.type === 'empty') {
    return (
      <div className="threat-timeline-panel">
        <div className="threat-timeline-empty">
          <div className="threat-timeline-empty-title">{renderState.message}</div>
          <div className="threat-timeline-empty-copy">The panel will populate when intelligence insights include timestamped threat levels.</div>
        </div>
        {renderState.reasons.length > 0 && (
          <div className="threat-timeline-note">{renderState.reasons.join(' | ')}</div>
        )}
        <PanelStyles />
      </div>
    );
  }

  const { state, sourceLabel } = renderState;
  const highSeverityCount = state.totals.critical + state.totals.high;
  const highSeverityDays = countHighSeverityDays(state);
  const trend = describeThreatTimelineTrend(state.days);
  const total = state.items.length;

  return (
    <div className="threat-timeline-panel">
      <div className="threat-timeline-summary">
        <div className="threat-timeline-stat">
          <span className="threat-timeline-stat-value">{highSeverityCount}</span>
          <span className="threat-timeline-stat-label">Critical/high</span>
        </div>
        <div className="threat-timeline-stat">
          <span className="threat-timeline-stat-value">{highSeverityDays}</span>
          <span className="threat-timeline-stat-label">Active days</span>
        </div>
        <div className={`threat-timeline-trend ${trend.className}`}>
          <span className="threat-timeline-trend-label">{trend.label}</span>
          <span className="threat-timeline-trend-copy">{trend.copy}</span>
        </div>
      </div>

      <ThreatChart days={state.days} />

      <div className="threat-timeline-legend">
        {THREAT_LEVELS.map(level => (
          <span key={level} className="threat-timeline-legend-item">
            <span className="threat-timeline-swatch" style={{ background: THREAT_LEVEL_COLORS[level] }} />
            {THREAT_LEVEL_LABELS[level]} <strong>{state.totals[level]}</strong>
          </span>
        ))}
      </div>

      <div className="threat-timeline-groups" aria-label="Current threat alerts grouped by level">
        <ThreatGroups groups={state.groups} />
      </div>

      <div className="threat-timeline-footer">
        {total} insight item{total === 1 ? '' : 's'} from {sourceLabel}
      </div>

      {state.degradedReasons.length > 0 && (
        <div className="threat-timeline-note">{state.degradedReasons.join(' | ')}</div>
      )}

      <PanelStyles />
    </div>
  );
}

export function ThreatTimelinePanel() {
  return (
    <PanelShell
      id="threat-timeline"
      title="Threat Timeline"
      infoTooltip="Seven-day threat-level distribution from intelligence insights."
      defaultRowSpan={2}
    >
      <ThreatTimelinePanelContent />
    </PanelShell>
  );
}
