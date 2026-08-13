import { useState, useEffect, useCallback } from 'react';
import { escapeHtml } from '@/services/forecast';
import type { Forecast, ForecastCase } from '@/generated/client/worldmonitor/forecast/v1/service_client';
import { t } from '@/services/i18n';
import { getForecastMacroRegion } from '../../../shared/forecast-macro-regions.js';
import { shouldFetchCaseFile } from '@/components/forecast-case-files';
import { PanelShell } from '@/components/PanelShell';
import { hasPremiumAccess } from '@/services/panel-gating';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { isDesktopRuntime } from '@/services/runtime';
import {
  forecastsChannel,
  forecastSourceChannel,
  forecastTheatersChannel,
  loadForecastCaseFiles,
  type ForecastSourceState,
  type SimulationTheater,
} from '@/services/forecast-panel-store';

// ── Constants ─────────────────────────────────────────────────────────────────

const DOMAINS = ['all', 'conflict', 'market', 'supply_chain', 'political', 'military', 'cyber', 'infrastructure'] as const;
type Domain = typeof DOMAINS[number];
const PANEL_MIN_PROBABILITY = 0.1;

const FORECAST_REGIONS = [
  { id: '', label: 'All Regions' },
  { id: 'mena', label: 'MENA' },
  { id: 'east-asia', label: 'East Asia' },
  { id: 'europe', label: 'Europe' },
  { id: 'south-asia', label: 'South Asia' },
  { id: 'sub-saharan-africa', label: 'Africa' },
  { id: 'latam', label: 'LatAm' },
  { id: 'north-america', label: 'N. America' },
] as const;

const DOMAIN_LABELS: Record<string, string> = {
  all: 'All', conflict: 'Conflict', market: 'Market', supply_chain: 'Supply Chain',
  political: 'Political', military: 'Military', cyber: 'Cyber', infrastructure: 'Infra',
};

const DOMAIN_COLORS: Record<string, string> = {
  conflict: '#e05252', market: '#d29922', supply_chain: '#58a6ff',
  political: '#bc8cff', military: '#f85149', cyber: '#bc8cff', infrastructure: '#3fb950',
};

const STATE_KIND_DOMAIN: Record<string, string> = {
  supply_chain_disruption: 'supply_chain', freight_disruption: 'supply_chain',
  energy_disruption: 'market', energy_price_shock: 'market',
  military_posture: 'military', conflict_escalation: 'conflict',
};

const PATH_ID_LABELS: Record<string, string> = {
  escalation: 'Escalation', containment: 'Containment', market_cascade: 'Market Cascade',
};

// ── CSS injection ─────────────────────────────────────────────────────────────

let _styleInjected = false;
function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .fc-panel { font-size: 12px; }
    .fc-filters { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border-color, #333); }
    .fc-filter { background: transparent; border: 1px solid var(--border-color, #444); color: var(--text-secondary, #aaa); padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; font-family: inherit; }
    .fc-filter.fc-active { background: var(--accent-color, #3b82f6); color: #fff; border-color: var(--accent-color, #3b82f6); }
    .fc-nexus { padding: 8px; }
    .fc-theater-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-bottom: 10px; }
    .fc-theater-card { background: var(--panel-bg, #161b22); border: 1px solid var(--border-color, #30363d); border-radius: 8px; padding: 18px 16px; cursor: pointer; transition: all 0.2s; position: relative; overflow: hidden; }
    .fc-theater-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--fc-theater-color, #58a6ff); }
    .fc-theater-card:hover { border-color: #40464f; transform: translateY(-1px); }
    .fc-theater-card.fc-theater-selected { border-color: var(--accent-color, #58a6ff); background: rgba(88,166,255,0.04); }
    .fc-theater-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
    .fc-theater-name { font-size: 11px; font-weight: 700; line-height: 1.3; color: var(--text-primary, #e6edf3); flex: 1; padding-right: 8px; }
    .fc-gauge-wrap { position: relative; width: 38px; height: 38px; flex-shrink: 0; }
    .fc-gauge-svg { width: 38px; height: 38px; transform: rotate(-90deg); }
    .fc-gauge-bg { fill: none; stroke: var(--border-color, #30363d); stroke-width: 4; }
    .fc-gauge-fill { fill: none; stroke-width: 4; stroke-linecap: round; }
    .fc-gauge-label { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); font-size: 9px; font-weight: 700; }
    .fc-theater-path { font-size: 9px; color: var(--text-secondary, #7d8590); line-height: 1.4; margin-top: 4px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .fc-path-type { font-size: 8px; padding: 1px 4px; border-radius: 2px; font-weight: 600; letter-spacing: 0.03em; opacity: 0.75; white-space: nowrap; }
    .fc-path-type-escalation { background: rgba(224,82,82,0.2); color: #e05252; border: 1px solid rgba(224,82,82,0.3); }
    .fc-path-type-containment { background: rgba(63,185,80,0.15); color: #3fb950; border: 1px solid rgba(63,185,80,0.25); }
    .fc-path-type-market_cascade { background: rgba(210,153,34,0.15); color: #d29922; border: 1px solid rgba(210,153,34,0.25); }
    .fc-cat-tag { font-size: 9px; padding: 1px 5px; border-radius: 3px; white-space: nowrap; flex-shrink: 0; font-weight: 500; display: inline-block; }
    .fc-theater-detail { background: var(--panel-bg, #161b22); border: 1px solid var(--border-color, #30363d); border-radius: 5px; margin-bottom: 10px; overflow: hidden; }
    .fc-theater-detail-hdr { padding: 10px 12px; border-bottom: 1px solid var(--border-color, #30363d); display: flex; align-items: center; gap: 8px; }
    .fc-theater-detail-name { font-size: 12px; font-weight: 700; color: var(--text-primary, #e6edf3); }
    .fc-theater-paths { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px 12px; }
    @media (max-width: 480px) { .fc-theater-paths { grid-template-columns: 1fr; } }
    .fc-path-card { background: rgba(0,0,0,0.25); border: 1px solid var(--border-color, #30363d); border-radius: 4px; padding: 9px 10px; }
    .fc-path-label { font-size: 10px; font-weight: 700; color: var(--text-primary, #e6edf3); margin-bottom: 2px; }
    .fc-path-conf { font-size: 9px; color: var(--text-secondary, #7d8590); margin-bottom: 5px; }
    .fc-path-bar { height: 2px; border-radius: 1px; margin: 4px 0; }
    .fc-path-summary { font-size: 10px; color: var(--text-secondary, #7d8590); line-height: 1.5; }
    .fc-path-actors { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 5px; }
    .fc-actor-chip { font-size: 9px; padding: 1px 5px; border: 1px solid var(--border-color, #30363d); border-radius: 2px; color: var(--text-secondary, #7d8590); background: rgba(255,255,255,0.02); }
    .fc-theater-footer { padding: 8px 12px; border-top: 1px solid var(--border-color, #30363d); display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .fc-footer-title { font-size: 9px; color: var(--text-secondary, #7d8590); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px; }
    .fc-footer-item { font-size: 9px; color: var(--text-secondary, #7d8590); padding: 2px 0; line-height: 1.4; }
    .fc-footer-item::before { content: '›'; margin-right: 4px; }
    .fc-stab-item::before { color: #3fb950; }
    .fc-inval-item::before { color: #e05252; }
    .fc-react-item::before { color: #58a6ff; }
    .fc-section-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-secondary, #7d8590); padding: 6px 8px 4px; }
    .fc-prob-table { border: 1px solid var(--border-color, #30363d); border-radius: 4px; overflow: hidden; margin: 0 8px 8px; }
    .fc-prob-hdr { display: grid; grid-template-columns: 1fr 80px 100px 60px; padding: 8px 14px; border-bottom: 1px solid var(--border-color, #30363d); }
    .fc-prob-hdr span { font-size: 9px; color: var(--text-secondary, #7d8590); text-transform: uppercase; letter-spacing: 0.08em; }
    .fc-prob-item { border-bottom: 1px solid var(--border-color, #30363d); }
    .fc-prob-item:last-child { border-bottom: none; }
    .fc-prob-row { display: grid; grid-template-columns: 1fr 80px 100px 60px; align-items: center; padding: 9px 14px; cursor: pointer; transition: background 0.1s; }
    .fc-prob-item:hover .fc-prob-row { background: rgba(255,255,255,0.02); }
    .fc-prob-label { font-size: 10px; color: var(--text-secondary, #7d8590); line-height: 1.4; }
    .fc-bar-wrap { display: flex; align-items: center; gap: 8px; }
    .fc-prob-bar-track { flex: 1; height: 4px; background: var(--border-color, #30363d); border-radius: 2px; overflow: hidden; min-width: 40px; }
    .fc-prob-bar-fill { height: 100%; border-radius: 2px; }
    .fc-prob-pct { font-size: 11px; font-weight: 700; min-width: 30px; text-align: right; }
    .fc-trend-text { font-size: 10px; }
    .fc-domain-tag { font-size: 9px; padding: 2px 6px; border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fc-hidden { display: none; }
    .fc-toggle-row { display: none; flex-wrap: wrap; gap: 8px; padding: 0 14px 8px; }
    .fc-prob-item:hover .fc-toggle-row { display: flex; }
    .fc-toggle { cursor: pointer; color: var(--text-secondary, #7d8590); font-size: 11px; }
    .fc-toggle:hover { color: var(--text-primary, #e6edf3); }
    .fc-detail { padding: 8px 14px 4px; border-top: 1px solid var(--border-color, #2a2a2a); }
    .fc-detail-grid { display: grid; gap: 8px; }
    .fc-section { display: grid; gap: 4px; }
    .fc-section-title { color: var(--text-secondary, #888); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
    .fc-section-copy { font-size: 11px; color: var(--text-primary, #d3d3d3); line-height: 1.45; }
    .fc-list-block { display: grid; gap: 4px; }
    .fc-list-item { font-size: 11px; color: var(--text-secondary, #a0a0a0); line-height: 1.4; }
    .fc-list-item::before { content: ''; display: inline-block; width: 6px; height: 1px; background: var(--text-secondary, #666); margin-right: 6px; vertical-align: middle; }
    .fc-chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .fc-chip { border: 1px solid var(--border-color, #363636); border-radius: 999px; padding: 2px 8px; font-size: 10px; color: var(--text-secondary, #9a9a9a); background: rgba(255,255,255,0.02); }
    .fc-perspectives { margin-top: 2px; }
    .fc-perspective { font-size: 11px; color: var(--text-secondary, #999); padding: 2px 0; line-height: 1.4; }
    .fc-perspective strong { color: var(--text-primary, #ccc); font-weight: 600; }
    .fc-scenario { font-style: italic; }
    .fc-signals { padding: 8px 14px 4px; border-top: 1px solid var(--border-color, #2a2a2a); }
    .fc-signal { color: var(--text-secondary, #a0a0a0); font-size: 11px; padding: 3px 0 3px 12px; line-height: 1.45; position: relative; margin-top: 2px; }
    .fc-signal::before { content: ''; position: absolute; left: 0; top: 9px; display: inline-block; width: 6px; height: 1px; background: var(--text-secondary, #555); }
    .fc-empty { padding: 20px; text-align: center; color: var(--text-secondary, #888); }
    .fc-source-notice { margin: 6px 8px 0; padding: 6px 8px; border: 1px solid rgba(210,153,34,0.35); border-radius: 4px; color: #d29922; background: rgba(210,153,34,0.08); font-size: 10px; line-height: 1.35; }
    .fc-sim-bar-wrap { margin-top: 4px; }
    .fc-sim-bar { height: 2px; border-radius: 1px; opacity: 0.45; transition: opacity 0.15s; }
    .fc-prob-item:hover .fc-sim-bar { opacity: 0.9; }
    .fc-sim-label { font-size: 9px; display: none; margin-top: 2px; line-height: 1.2; }
    .fc-prob-item:hover .fc-sim-label { display: block; }
    .fc-sim-chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 600; letter-spacing: 0.03em; white-space: nowrap; flex-shrink: 0; line-height: 1.6; }
    .fc-sim-chip::before { content: ''; display: inline-block; width: 4px; height: 4px; border-radius: 50%; flex-shrink: 0; }
    .fc-sim-chip--backed { background: rgba(63,185,80,0.12); color: #3fb950; border: 1px solid rgba(63,185,80,0.28); }
    .fc-sim-chip--backed::before { background: #3fb950; }
    .fc-sim-chip--flagged { background: rgba(210,153,34,0.12); color: #d29922; border: 1px solid rgba(210,153,34,0.28); }
    .fc-sim-chip--flagged::before { background: #d29922; }
    .fc-sim-chip--skeptical { background: rgba(224,82,82,0.10); color: #e05252; border: 1px solid rgba(224,82,82,0.28); }
    .fc-sim-chip--skeptical::before { background: #e05252; }
    .fc-label-inner { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .fc-forecast-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  document.head.appendChild(style);
}

// ── Pure render helpers (HTML strings) ───────────────────────────────────────

function renderList(items: string[] | undefined): string {
  if (!items || items.length === 0) return '';
  return `<div class="fc-list-block">${items.map(item => `<div class="fc-list-item">${escapeHtml(item)}</div>`).join('')}</div>`;
}

function renderEvidence(items: Array<{ summary?: string; weight?: number }> | undefined): string {
  if (!items || items.length === 0) return '';
  return `<div class="fc-list-block">${items.map(item => {
    const suffix = typeof item.weight === 'number' ? ` (${Math.round(item.weight * 100)}%)` : '';
    return `<div class="fc-list-item">${escapeHtml(`${item.summary || ''}${suffix}`.trim())}</div>`;
  }).join('')}</div>`;
}

function renderActors(items: ForecastCase['actors']): string {
  if (!items || items.length === 0) return '';
  return `<div class="fc-list-block">${items.map(actor => {
    const chips = [
      actor.category ? actor.category : '',
      typeof actor.influenceScore === 'number' ? `Influence ${Math.round(actor.influenceScore * 100)}%` : '',
    ].filter(Boolean).map(chip => `<span class="fc-chip">${escapeHtml(chip)}</span>`).join('');
    return `
      <div class="fc-section-copy">
        <strong>${escapeHtml(actor.name || 'Actor')}</strong>
        ${chips ? `<div class="fc-chip-row" style="margin-top:4px;">${chips}</div>` : ''}
        ${actor.role ? `<div class="fc-list-item">${escapeHtml(actor.role)}</div>` : ''}
        ${actor.objectives?.[0] ? `<div class="fc-list-item"><strong>Objective:</strong> ${escapeHtml(actor.objectives[0])}</div>` : ''}
        ${actor.constraints?.[0] ? `<div class="fc-list-item"><strong>Constraint:</strong> ${escapeHtml(actor.constraints[0])}</div>` : ''}
        ${actor.likelyActions?.[0] ? `<div class="fc-list-item"><strong>Likely action:</strong> ${escapeHtml(actor.likelyActions[0])}</div>` : ''}
      </div>
    `;
  }).join('')}</div>`;
}

function renderBranches(items: ForecastCase['branches']): string {
  if (!items || items.length === 0) return '';
  return `<div class="fc-list-block">${items.map(branch => {
    const projected = typeof branch.projectedProbability === 'number'
      ? `<span class="fc-chip">Projected ${Math.round(branch.projectedProbability * 100)}%</span>`
      : '';
    const rounds = (branch.rounds || []).slice(0, 3).map(round => {
      const copy = [(round.developments || []).slice(0, 2).join(' '), (round.actorMoves || []).slice(0, 1).join(' ')].filter(Boolean).join(' ');
      return `<div class="fc-list-item"><strong>R${round.round || 0}:</strong> ${escapeHtml(copy || round.focus || '')}</div>`;
    }).join('');
    return `
      <div class="fc-section-copy">
        <strong>${escapeHtml(branch.title || branch.kind || 'Branch')}</strong>
        <div class="fc-chip-row" style="margin-top:4px;">${projected}</div>
        ${branch.summary ? `<div class="fc-list-item">${escapeHtml(branch.summary)}</div>` : ''}
        ${branch.outcome ? `<div class="fc-list-item"><strong>Outcome:</strong> ${escapeHtml(branch.outcome)}</div>` : ''}
        ${rounds}
      </div>
    `;
  }).join('')}</div>`;
}

function renderDetailBodyHtml(f: Forecast): string {
  const caseFile = f.caseFile;
  const sections: string[] = [];

  if (f.scenario) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">Executive View</div><div class="fc-section-copy fc-scenario">${escapeHtml(f.scenario)}</div></div>`);
  }
  if (caseFile?.baseCase) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">Base Case</div><div class="fc-section-copy">${escapeHtml(caseFile.baseCase)}</div></div>`);
  }
  if (caseFile?.changeSummary || caseFile?.changeItems?.length) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">What Changed</div>${caseFile?.changeSummary ? `<div class="fc-section-copy">${escapeHtml(caseFile.changeSummary)}</div>` : ''}${caseFile?.changeItems?.length ? renderList(caseFile.changeItems) : ''}</div>`);
  }
  if (caseFile?.worldState?.summary || caseFile?.worldState?.activePressures?.length) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">World State</div>${caseFile?.worldState?.summary ? `<div class="fc-section-copy">${escapeHtml(caseFile.worldState.summary)}</div>` : ''}${caseFile?.worldState?.activePressures?.length ? `<div class="fc-section-copy"><strong>Pressures:</strong></div>${renderList(caseFile.worldState.activePressures)}` : ''}${caseFile?.worldState?.stabilizers?.length ? `<div class="fc-section-copy"><strong>Stabilizers:</strong></div>${renderList(caseFile.worldState.stabilizers)}` : ''}${caseFile?.worldState?.keyUnknowns?.length ? `<div class="fc-section-copy"><strong>Key unknowns:</strong></div>${renderList(caseFile.worldState.keyUnknowns)}` : ''}</div>`);
  }
  if (caseFile?.escalatoryCase || caseFile?.contrarianCase) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">Alternative Paths</div>${caseFile?.escalatoryCase ? `<div class="fc-section-copy"><strong>Escalatory:</strong> ${escapeHtml(caseFile.escalatoryCase)}</div>` : ''}${caseFile?.contrarianCase ? `<div class="fc-section-copy"><strong>Contrarian:</strong> ${escapeHtml(caseFile.contrarianCase)}</div>` : ''}</div>`);
  }
  if (caseFile?.branches?.length) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">Simulated Branches</div>${renderBranches(caseFile.branches)}</div>`);
  }
  if (caseFile?.supportingEvidence?.length) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">Supporting Evidence</div>${renderEvidence(caseFile.supportingEvidence)}</div>`);
  }
  if (caseFile?.counterEvidence?.length) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">Counter Evidence</div>${renderEvidence(caseFile.counterEvidence)}</div>`);
  }
  if (caseFile?.triggers?.length) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">Signals To Watch</div>${renderList(caseFile.triggers)}</div>`);
  }
  if (caseFile?.actors?.length) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">Actors</div>${renderActors(caseFile.actors)}</div>`);
  } else if (caseFile?.actorLenses?.length) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">Actor Lenses</div>${renderList(caseFile.actorLenses)}</div>`);
  }
  if (f.perspectives?.strategic) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">Perspectives</div><div class="fc-perspectives"><div class="fc-perspective"><strong>Strategic:</strong> ${escapeHtml(f.perspectives.strategic)}</div><div class="fc-perspective"><strong>Regional:</strong> ${escapeHtml(f.perspectives.regional || '')}</div><div class="fc-perspective"><strong>Contrarian:</strong> ${escapeHtml(f.perspectives.contrarian || '')}</div></div></div>`);
  }

  const chips = [
    f.calibration?.marketTitle ? `Market: ${f.calibration.marketTitle} (${Math.round((f.calibration.marketPrice || 0) * 100)}%)` : '',
    typeof f.priorProbability === 'number' ? `Prior: ${Math.round(f.priorProbability * 100)}%` : '',
    f.cascades?.length ? `Cascades: ${f.cascades.length}` : '',
  ].filter(Boolean);
  if (chips.length > 0) {
    sections.push(`<div class="fc-section"><div class="fc-section-title">Context</div><div class="fc-chip-row">${chips.map(c => `<span class="fc-chip">${escapeHtml(c)}</span>`).join('')}</div></div>`);
  }

  return `<div class="fc-detail-grid">${sections.join('')}</div>`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TheaterCard({ t: theater, isSelected, onClick }: { t: SimulationTheater; isSelected: boolean; onClick: () => void }) {
  const domain = STATE_KIND_DOMAIN[theater.stateKind] || 'supply_chain';
  const color = DOMAIN_COLORS[domain] || '#58a6ff';
  const catLabel = DOMAIN_LABELS[domain] || domain;
  const dominantPath = theater.topPaths[0];
  const conf = dominantPath?.confidence ?? 0;
  const confPct = Math.round(conf * 100);
  const confColor = conf >= 0.65 ? '#3fb950' : conf >= 0.45 ? '#d29922' : '#e05252';
  const r = 15;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - conf);

  return (
    <div
      className={`fc-theater-card${isSelected ? ' fc-theater-selected' : ''}`}
      style={{ '--fc-theater-color': color } as React.CSSProperties}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div className="fc-theater-top">
        <div className="fc-theater-name">{theater.theaterLabel}</div>
        <div className="fc-gauge-wrap">
          <svg className="fc-gauge-svg" viewBox="0 0 34 34">
            <circle className="fc-gauge-bg" cx="17" cy="17" r={r} />
            <circle className="fc-gauge-fill" cx="17" cy="17" r={r}
              stroke={confColor}
              strokeDasharray={circ.toFixed(1)}
              strokeDashoffset={offset.toFixed(1)} />
          </svg>
          <span className="fc-gauge-label" style={{ color: confColor }}>{conf > 0 ? `${confPct}%` : '—'}</span>
        </div>
      </div>
      <span className="fc-cat-tag" style={{ background: `${color}1f`, color, border: `1px solid ${color}47` }}>{catLabel}</span>
      {dominantPath && (
        <div className="fc-theater-path">
          {dominantPath.pathId && (
            <span className={`fc-path-type fc-path-type-${dominantPath.pathId}`}>
              {PATH_ID_LABELS[dominantPath.pathId] ?? dominantPath.pathId}
            </span>
          )}
          {dominantPath.label}
        </div>
      )}
    </div>
  );
}

function TheaterDetail({ theater }: { theater: SimulationTheater }) {
  const domain = STATE_KIND_DOMAIN[theater.stateKind] || 'supply_chain';
  const color = DOMAIN_COLORS[domain] || '#58a6ff';
  const catLabel = DOMAIN_LABELS[domain] || domain;

  return (
    <div className="fc-theater-detail">
      <div className="fc-theater-detail-hdr">
        <span className="fc-theater-detail-name">{theater.theaterLabel}</span>
        <span className="fc-cat-tag" style={{ background: `${color}1f`, color, border: `1px solid ${color}47` }}>{catLabel}</span>
      </div>
      <div className="fc-theater-paths">
        {theater.topPaths.map((p) => {
          const pctColor = p.confidence >= 0.65 ? '#3fb950' : p.confidence >= 0.45 ? '#d29922' : '#e05252';
          const confText = p.confidence > 0 ? `${Math.round(p.confidence * 100)}% confidence` : '—';
          return (
            <div key={p.pathId || p.label} className="fc-path-card">
              <div className="fc-path-label">
                {p.pathId && <span className={`fc-path-type fc-path-type-${p.pathId}`}>{PATH_ID_LABELS[p.pathId] ?? p.pathId}</span>}
                {p.label}
              </div>
              <div className="fc-path-conf">{confText}</div>
              <div className="fc-path-bar" style={{ background: pctColor, width: `${Math.round(p.confidence * 100)}%` }} />
              <div className="fc-path-summary">{p.summary}</div>
              {p.keyActors.length > 0 && (
                <div className="fc-path-actors">
                  {p.keyActors.map(a => <span key={a} className="fc-actor-chip">{a}</span>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {(theater.dominantReactions.length > 0 || theater.stabilizers.length > 0 || theater.invalidators.length > 0) && (
        <div className="fc-theater-footer">
          <div className="fc-theater-footer-section">
            <div className="fc-footer-title">Reactions</div>
            {theater.dominantReactions.length > 0
              ? theater.dominantReactions.map(r => <div key={r} className="fc-footer-item fc-react-item">{r}</div>)
              : <div className="fc-footer-item" style={{ opacity: 0.4 }}>—</div>}
          </div>
          <div className="fc-theater-footer-section">
            <div className="fc-footer-title">Stabilizers</div>
            {theater.stabilizers.length > 0
              ? theater.stabilizers.map(s => <div key={s} className="fc-footer-item fc-stab-item">{s}</div>)
              : <div className="fc-footer-item" style={{ opacity: 0.4 }}>—</div>}
          </div>
          <div className="fc-theater-footer-section">
            <div className="fc-footer-title">Invalidators</div>
            {theater.invalidators.length > 0
              ? theater.invalidators.map(s => <div key={s} className="fc-footer-item fc-inval-item">{s}</div>)
              : <div className="fc-footer-item" style={{ opacity: 0.4 }}>—</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function ForecastRow({
  f,
  detailOpen,
  signalsOpen,
  onToggleDetail,
  onToggleSignals,
  onRowClick,
}: {
  f: Forecast;
  detailOpen: boolean;
  signalsOpen: boolean;
  onToggleDetail: () => void;
  onToggleSignals: () => void;
  onRowClick: () => void;
}) {
  const pct = Math.round((f.probability || 0) * 100);
  const domain = f.domain || 'conflict';
  const catColor = DOMAIN_COLORS[domain] || '#7d8590';
  const catLabel = DOMAIN_LABELS[domain] || domain;
  const probColor = pct >= 60 ? '#3fb950' : pct >= 40 ? '#d29922' : '#e05252';
  const trendText = f.trend === 'rising' ? '↑ rising' : f.trend === 'falling' ? '↓ falling' : '→ stable';
  const trendColor = f.trend === 'rising' ? '#3fb950' : f.trend === 'falling' ? '#e05252' : '#7d8590';
  const adj = f.simulationAdjustment ?? 0;
  const demoted = f.demotedBySimulation ?? false;
  const sigs = f.signals || [];

  // Sim chip
  let simChipHtml = '';
  if (demoted) simChipHtml = '<span class="fc-sim-chip fc-sim-chip--skeptical">AI skeptical</span>';
  else if (adj > 0) simChipHtml = '<span class="fc-sim-chip fc-sim-chip--backed">AI backed</span>';
  else if (adj < 0) simChipHtml = '<span class="fc-sim-chip fc-sim-chip--flagged">AI flagged</span>';

  // Sim bar
  let simBarHtml = '';
  if (adj !== 0) {
    const conf = f.simPathConfidence ?? 1.0;
    const adjPct = Math.round(Math.abs(adj) * 100);
    let barColor: string;
    let labelText: string;
    if (demoted) { barColor = '#e05252'; labelText = `AI flag: dropped · −${adjPct}%`; }
    else if (adj > 0) { barColor = conf >= 0.70 ? '#3fb950' : '#d29922'; labelText = conf < 0.70 ? `AI signal (moderate) · +${adjPct}%` : `AI signal · +${adjPct}%`; }
    else { barColor = '#ea580c'; labelText = `AI caution · −${adjPct}%`; }
    const barWidthPct = adj > 0 ? Math.round(Math.max(20, conf * 100)) : 100;
    simBarHtml = `<div class="fc-sim-bar-wrap"><div class="fc-sim-bar" style="width:${barWidthPct}%;background:${barColor}"></div><span class="fc-sim-label" style="color:${barColor}">${escapeHtml(labelText)}</span></div>`;
  }

  return (
    <div className="fc-prob-item">
      <div className="fc-prob-row" style={demoted ? { opacity: 0.5 } : undefined} onClick={onRowClick}>
        <div className="fc-prob-label" style={{ borderLeft: `2px solid ${catColor}47`, paddingLeft: '6px' }}>
          <div className="fc-label-inner">
            <span className="fc-forecast-title">{f.title}</span>
            {simChipHtml && <span dangerouslySetInnerHTML={{ __html: simChipHtml }} />}
          </div>
          {simBarHtml && <span dangerouslySetInnerHTML={{ __html: simBarHtml }} />}
        </div>
        <div className="fc-bar-wrap">
          <div className="fc-prob-bar-track">
            <div className="fc-prob-bar-fill" style={{ background: probColor, width: `${pct}%` }} />
          </div>
          <span className="fc-prob-pct" style={{ color: probColor }}>{pct}%</span>
        </div>
        <span className="fc-trend-text" style={{ color: trendColor }}>{trendText}</span>
        <span className="fc-domain-tag" style={{ background: `${catColor}1f`, color: catColor, border: `1px solid ${catColor}33` }}>{catLabel}</span>
      </div>
      <div className="fc-toggle-row">
        <span className="fc-toggle" onClick={(e) => { e.stopPropagation(); onToggleDetail(); }}>Analysis</span>
        {sigs.length > 0 && (
          <span className="fc-toggle" onClick={(e) => { e.stopPropagation(); onToggleSignals(); }}>Signals ({sigs.length})</span>
        )}
      </div>
      {detailOpen && (
        <div className="fc-detail">
          {f.caseFile
            ? <div dangerouslySetInnerHTML={{ __html: renderDetailBodyHtml(f) }} />
            : <div style={{ padding: '8px 0', color: 'var(--text-secondary)', fontSize: '11px' }}>Loading analysis…</div>}
        </div>
      )}
      {signalsOpen && sigs.length > 0 && (
        <div className="fc-signals">
          {sigs.map((s, i) => (
            <div key={i} className="fc-signal">{s.value.replace(/^[\s–—-]+/, '')}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

export function ForecastPanelContent() {
  const [forecasts, setForecasts] = useState<Forecast[]>(forecastsChannel.get);
  const [sourceState, setSourceState] = useState<ForecastSourceState>(forecastSourceChannel.get);
  const [theaters, setTheaters] = useState<SimulationTheater[]>(forecastTheatersChannel.get);

  const [activeDomain, setActiveDomain] = useState<Domain>('all');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [expandedTheaterId, setExpandedTheaterId] = useState<string | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(() => new Set());
  const [expandedSignals, setExpandedSignals] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    injectStyles();
    const u1 = forecastsChannel.subscribe(setForecasts);
    const u2 = forecastSourceChannel.subscribe(setSourceState);
    const u3 = forecastTheatersChannel.subscribe(setTheaters);
    return () => { u1(); u2(); u3(); };
  }, []);

  const getVisible = useCallback((): Forecast[] => {
    const probFiltered = forecasts.filter(f => (f.probability || 0) >= PANEL_MIN_PROBABILITY);
    if (!selectedRegion) return probFiltered;
    return probFiltered.filter(f => getForecastMacroRegion(f.region) === selectedRegion);
  }, [forecasts, selectedRegion]);

  const handleToggleDetail = useCallback((f: Forecast) => {
    const isOpening = !expandedDetails.has(f.id);
    setExpandedDetails(prev => {
      const next = new Set(prev);
      if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
      return next;
    });
    if (isOpening && shouldFetchCaseFile(f, true, !f.caseFile)) {
      void loadForecastCaseFiles();
    }
  }, [expandedDetails]);

  const visibleForecasts = getVisible();
  const filtered = activeDomain === 'all'
    ? visibleForecasts
    : visibleForecasts.filter(f => f.domain === activeDomain);

  const sourceNotice = (!sourceState.degraded && !sourceState.stale && !sourceState.error) ? null : (() => {
    const errorDetail = sourceState.degraded ? '' : sourceState.error.replace(/_/g, ' ');
    const parts = [
      sourceState.degraded ? 'Forecast source degraded' : '',
      sourceState.stale ? 'stale cache' : '',
      errorDetail,
    ].filter(Boolean);
    return parts.join(' · ');
  })();

  const emptyCopy = visibleForecasts.length > 0
    ? 'No forecasts match the current filter'
    : sourceState.degraded
      ? 'Forecast backend unavailable'
      : sourceState.error
        ? 'Forecast request failed'
        : 'No forecasts available';

  return (
    <div className="fc-panel">
      <div className="fc-filters">
        {DOMAINS.map(d => (
          <button
            key={d}
            className={`fc-filter${d === activeDomain ? ' fc-active' : ''}`}
            onClick={() => setActiveDomain(d)}
            type="button"
          >
            {DOMAIN_LABELS[d]}
          </button>
        ))}
      </div>
      <div className="fc-filters">
        {FORECAST_REGIONS.map(r => (
          <button
            key={r.id}
            className={`fc-filter${r.id === selectedRegion ? ' fc-active' : ''}`}
            onClick={() => setSelectedRegion(r.id === selectedRegion ? r.id : r.id)}
            type="button"
          >
            {r.label}
          </button>
        ))}
      </div>
      {sourceNotice && <div className="fc-source-notice">{sourceNotice}</div>}
      {theaters.length > 0 && (
        <div className="fc-nexus">
          <div className="fc-section-label" style={{ paddingTop: '4px' }}>Active Theaters</div>
          <div className="fc-theater-grid">
            {theaters.map(th => (
              <TheaterCard
                key={th.theaterId}
                t={th}
                isSelected={expandedTheaterId === th.theaterId}
                onClick={() => setExpandedTheaterId(prev => prev === th.theaterId ? null : th.theaterId)}
              />
            ))}
          </div>
          {expandedTheaterId && (() => {
            const th = theaters.find(t => t.theaterId === expandedTheaterId);
            return th ? <TheaterDetail theater={th} /> : null;
          })()}
        </div>
      )}
      {theaters.length > 0 && filtered.length > 0 && (
        <div className="fc-section-label">Probability Bets</div>
      )}
      {filtered.length === 0 ? (
        <div className="fc-empty">{emptyCopy}</div>
      ) : (
        <div className="fc-prob-table">
          <div className="fc-prob-hdr">
            <span>Forecast</span><span>Probability</span><span>Trend</span><span>Domain</span>
          </div>
          {filtered.map(f => (
            <ForecastRow
              key={f.id}
              f={f}
              detailOpen={expandedDetails.has(f.id)}
              signalsOpen={expandedSignals.has(f.id)}
              onToggleDetail={() => handleToggleDetail(f)}
              onToggleSignals={() => setExpandedSignals(prev => {
                const next = new Set(prev);
                if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
                return next;
              })}
              onRowClick={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function useDesktopGate() {
  const [authState, setAuthState] = useState(getAuthState);
  useEffect(() => subscribeAuthState(setAuthState), []);
  return isDesktopRuntime() && !hasPremiumAccess(authState);
}

export function ForecastPanel() {
  const locked = useDesktopGate();
  return (
    <PanelShell
      id="forecast"
      title="AI Forecasts"
      showCount
      infoTooltip={t('components.forecast.infoTooltip')}
      locked={locked}
      lockedFeatures={locked ? [
        t('premium.features.forecasts1', { defaultValue: 'AI-powered geopolitical forecasts' }),
        t('premium.features.forecasts2', { defaultValue: 'Cross-domain cascade predictions' }),
        t('premium.features.forecasts3', { defaultValue: 'Prediction market calibration' }),
      ] : undefined}
    >
      <ForecastPanelContent />
    </PanelShell>
  );
}
