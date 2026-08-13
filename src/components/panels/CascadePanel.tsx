import { useState, useEffect, useRef } from 'react';
import { t } from '@/services/i18n';
import { getCSSColor } from '@/utils';
import {
  buildDependencyGraph,
  calculateCascade,
  getGraphStats,
  clearGraphCache,
  preloadCables,
  type DependencyGraph,
} from '@/services/infrastructure-cascade';
import type { CascadeResult, CascadeImpactLevel, InfrastructureNode } from '@/types';
import { PanelShell } from '@/components/PanelShell';

type NodeFilter = 'all' | 'cable' | 'pipeline' | 'port' | 'chokepoint';

function getImpactColor(level: CascadeImpactLevel): string {
  switch (level) {
    case 'critical': return getCSSColor('--semantic-critical');
    case 'high': return getCSSColor('--semantic-high');
    case 'medium': return getCSSColor('--semantic-elevated');
    case 'low': return getCSSColor('--semantic-normal');
  }
}

function getImpactEmoji(level: CascadeImpactLevel): string {
  switch (level) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🟢';
  }
}

function getNodeTypeEmoji(type: string): string {
  switch (type) {
    case 'cable': return '🔌';
    case 'pipeline': return '🛢️';
    case 'port': return '⚓';
    case 'chokepoint': return '🚢';
    case 'country': return '🏳️';
    default: return '📍';
  }
}

function getFilterLabel(filter: Exclude<NodeFilter, 'all'>): string {
  const labels: Record<Exclude<NodeFilter, 'all'>, string> = {
    cable: t('components.cascade.filters.cables'),
    pipeline: t('components.cascade.filters.pipelines'),
    port: t('components.cascade.filters.ports'),
    chokepoint: t('components.cascade.filters.chokepoints'),
  };
  return labels[filter];
}

function getFilteredNodes(graph: DependencyGraph, filter: NodeFilter): InfrastructureNode[] {
  const nodes: InfrastructureNode[] = [];
  for (const node of graph.nodes.values()) {
    if ((filter === 'all' || node.type === filter) && node.type !== 'country') {
      nodes.push(node);
    }
  }
  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}

export function CascadePanelContent() {
  const graphRef = useRef<DependencyGraph | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const cascadeResultRef = useRef<CascadeResult | null>(null);
  const [filter, setFilter] = useState<NodeFilter>('cable');
  const [, setRenderTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load / reload graph when loading flag becomes true
  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    void (async () => {
      try {
        await preloadCables();
        if (cancelled) return;
        graphRef.current = buildDependencyGraph();
        setLoading(false);
        setRenderTick(k => k + 1);
      } catch {
        if (!cancelled) setError(t('common.failedDependencyGraph'));
      }
    })();
    return () => { cancelled = true; };
  }, [loading]);

  if (loading) return <div className="panel-loading" />;
  if (error) return <div className="panel-empty">{error}</div>;
  if (!graphRef.current) return <div className="panel-loading" />;

  const graph = graphRef.current;
  const stats = getGraphStats();
  const nodes = getFilteredNodes(graph, filter);
  const selectedType = t(`components.cascade.filterType.${filter}`);
  const cascadeResult = cascadeResultRef.current;

  const runAnalysis = () => {
    if (!selectedNodeRef.current) return;
    cascadeResultRef.current = calculateCascade(selectedNodeRef.current);
    setRenderTick(k => k + 1);
  };

  const resetGraph = () => {
    clearGraphCache();
    graphRef.current = null;
    cascadeResultRef.current = null;
    selectedNodeRef.current = null;
    setLoading(true);
    setError(null);
    setRenderTick(k => k + 1);
  };

  const filterKeys: Exclude<NodeFilter, 'all'>[] = ['cable', 'pipeline', 'port', 'chokepoint'];

  return (
    <div className="cascade-panel">
      <div className="cascade-stats">
        <span>🔌 {stats.cables}</span>
        <span>🛢️ {stats.pipelines}</span>
        <span>⚓ {stats.ports}</span>
        <span>🌊 {stats.chokepoints}</span>
        <span>🏳️ {stats.countries}</span>
        <span>📊 {stats.edges} {t('components.cascade.links')}</span>
        <button type="button" className="cascade-refresh-btn" onClick={resetGraph} aria-label="Refresh graph">
          ↺
        </button>
      </div>
      <div className="cascade-selector">
        <div className="panel-tabs" role="radiogroup" aria-label="Infrastructure type filter">
          {filterKeys.map(f => (
            <button
              key={f}
              type="button"
              className={`panel-tab${filter === f ? ' active' : ''}`}
              role="radio"
              aria-checked={filter === f}
              aria-label={getFilterLabel(f)}
              onClick={() => {
                setFilter(f);
                selectedNodeRef.current = null;
                cascadeResultRef.current = null;
                setRenderTick(k => k + 1);
              }}
            >
              {getNodeTypeEmoji(f)} {getFilterLabel(f)}
            </button>
          ))}
        </div>
        <select
          className="cascade-select"
          aria-label={t('components.cascade.selectInfrastructureHint')}
          disabled={nodes.length === 0}
          value={selectedNodeRef.current ?? ''}
          onChange={(e) => {
            selectedNodeRef.current = e.currentTarget.value || null;
            cascadeResultRef.current = null;
            setRenderTick(k => k + 1);
          }}
        >
          <option value="">{t('components.cascade.selectPrompt', { type: selectedType })}</option>
          {nodes.map(n => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
        <button
          type="button"
          className="cascade-analyze-btn"
          disabled={!selectedNodeRef.current}
          onClick={runAnalysis}
        >
          {t('components.cascade.analyzeImpact')}
        </button>
      </div>
      {cascadeResult ? (
        <div className="cascade-result">
          <div className="cascade-source">
            <span className="cascade-emoji">{getNodeTypeEmoji(cascadeResult.source.type)}</span>
            <span className="cascade-source-name">{cascadeResult.source.name}</span>
            <span className="cascade-source-type">{t(`components.cascade.filterType.${cascadeResult.source.type}`)}</span>
          </div>
          <div className="cascade-section">
            <div className="cascade-section-title">{t('components.cascade.countriesAffected', { count: String(cascadeResult.countriesAffected.length) })}</div>
            <div className="cascade-countries">
              {cascadeResult.countriesAffected.length === 0 ? (
                <div className="empty-state">{t('components.cascade.noCountryImpacts')}</div>
              ) : cascadeResult.countriesAffected.map(c => (
                <div key={c.countryName} className="cascade-country" style={{ borderLeft: `3px solid ${getImpactColor(c.impactLevel)}` }}>
                  <span className="cascade-emoji">{getImpactEmoji(c.impactLevel)}</span>
                  <span className="cascade-country-name">{c.countryName}</span>
                  <span className="cascade-impact">{t(`components.cascade.impactLevels.${c.impactLevel}`)}</span>
                  {c.affectedCapacity > 0 && (
                    <span className="cascade-capacity">{t('components.cascade.capacityPercent', { percent: String(Math.round(c.affectedCapacity * 100)) })}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          {cascadeResult.redundancies && cascadeResult.redundancies.length > 0 && (
            <div className="cascade-section">
              <div className="cascade-section-title">{t('components.cascade.alternativeRoutes')}</div>
              {cascadeResult.redundancies.map(r => (
                <div key={r.name} className="cascade-redundancy">
                  <span className="cascade-redundancy-name">{r.name}</span>
                  <span className="cascade-redundancy-capacity">{Math.round(r.capacityShare * 100)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="cascade-hint">{t('components.cascade.selectInfrastructureHint')}</div>
      )}
    </div>
  );
}

export function CascadePanel() {
  return (
    <PanelShell
      id="cascade"
      title={t('panels.cascade')}
      infoTooltip={t('components.cascade.infoTooltip')}
    >
      <CascadePanelContent />
    </PanelShell>
  );
}
