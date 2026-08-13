import { useState, useEffect, useRef, useCallback } from 'react';
import { GIVING_STALE_CEILING_MS, formatCurrency, type GivingSummary, type GivingProvenance, type PlatformGiving, type CategoryBreakdown } from '@/services/giving/model';
import { fetchGivingSummary } from '@/services/giving';
import { availableGivingTabs, type GivingTab } from '@/components/giving-renderer';
import { t } from '@/services/i18n';
import { sanitizeUrl } from '@/utils/sanitize';
import { PanelShell } from '@/components/PanelShell';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusKey(availability: GivingSummary['availability']): string {
  if (availability === 'available') return 'components.giving.status.published';
  if (availability === 'available-but-legacy') return 'components.giving.status.legacy';
  if (availability === 'cached-refresh-unavailable') return 'components.giving.status.cached';
  return 'components.giving.status.partial';
}

function verifiedHttpsUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    return sanitizeUrl(rawUrl) || null;
  } catch {
    return null;
  }
}

function compactNumber(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toLocaleString();
}

function formatReportedValue(entry: GivingProvenance): string {
  if (entry.reportedUnit === 'USD') return formatCurrency(entry.reportedValue);
  if (entry.reportedUnit === 'GBP') return `GBP ${compactNumber(entry.reportedValue)}`;
  if (entry.reportedUnit === 'USD billion') return `$${entry.reportedValue.toFixed(1)}B`;
  if (entry.reportedUnit === 'grants') return `${compactNumber(entry.reportedValue)} grants`;
  return `${compactNumber(entry.reportedValue)} ${entry.reportedUnit}`.trim();
}

function qualifierPrefix(valueQualifier: string): string {
  if (valueQualifier === 'more_than' || valueQualifier === 'at_least')
    return `${t('components.giving.atLeast')} `;
  if (valueQualifier === 'about')
    return `${t('components.giving.about')} `;
  return '';
}

function formatQualifiedValue(entry: GivingProvenance, value: string): string {
  return `${qualifierPrefix(entry.valueQualifier)}${value}`;
}

function platformProvenance(data: GivingSummary, platform: string): GivingProvenance | undefined {
  return data.provenance.find(e =>
    e.sourceName === platform ||
    e.coveredMetricPaths.some(p => p.includes(`[platform=${platform}]`)),
  );
}

function contextProvenance(data: GivingSummary, metricPath: string): GivingProvenance | undefined {
  return data.provenance.find(e =>
    e.coveredMetricPaths.some(p => p.includes(metricPath)),
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SourceName({ entry }: { entry: GivingProvenance }) {
  const safeUrl = verifiedHttpsUrl(entry.sourceUrl);
  if (safeUrl) {
    return <a href={safeUrl} target="_blank" rel="noopener noreferrer nofollow">{entry.sourceName}</a>;
  }
  return <>{entry.sourceName}</>;
}

function SourceMeta({ entry }: { entry: GivingProvenance }) {
  const when = entry.sourcePublishedAt ? ` · ${entry.sourcePublishedAt}` : '';
  return (
    <span className="giving-source-meta">
      <SourceName entry={entry} /> · {entry.referencePeriod}{when}
    </span>
  );
}

function AggregateStats({ data }: { data: GivingSummary }) {
  const contributors = data.provenance.filter(e => e.includedInHighlightedAggregate && e.status === 'verified');
  const atLeast = contributors.some(e => e.valueQualifier === 'more_than' || e.valueQualifier === 'at_least');
  const annualizedDaily = Number.isFinite(data.estimatedDailyFlowUsd) && data.estimatedDailyFlowUsd > 0
    ? data.estimatedDailyFlowUsd : 0;
  const annualized = annualizedDaily * 365;
  const value = annualized > 0 ? formatCurrency(annualized) : t('components.giving.sourceNotVerified');
  const qualifier = atLeast ? qualifierPrefix('at_least') : '';
  const sources = contributors.map(e => `${e.sourceName} · ${e.referencePeriod}`).join(' · ');

  return (
    <div className="giving-stats-grid">
      <div className="giving-stat-box giving-stat-headline">
        <span className="giving-stat-value">{qualifier}{value}</span>
        <span className="giving-stat-label">{t('components.giving.trackedAnnualized')}</span>
        {sources && <span className="giving-source-meta">{sources}</span>}
      </div>
      <div className="giving-stat-box">
        <span className="giving-stat-value">{annualizedDaily > 0 ? formatCurrency(annualizedDaily) : '—'}</span>
        <span className="giving-stat-label">{t('components.giving.annualizedDaily')}</span>
      </div>
    </div>
  );
}

function PlatformRow({ data, platform }: { data: GivingSummary; platform: PlatformGiving }) {
  const evidence = platformProvenance(data, platform.platform);
  let benchmarkContent: React.ReactNode;

  if (!evidence || evidence.status === 'unverified') {
    benchmarkContent = <span className="giving-unverified">{t('components.giving.sourceNotVerified')}</span>;
  } else if (evidence.status === 'partially_verified') {
    benchmarkContent = (
      <>
        <span className="giving-benchmark-value">{formatQualifiedValue(evidence, formatReportedValue(evidence))}</span>
        <span className="giving-benchmark-kind">{t('components.giving.partialEstimate')}</span>
        <span className="giving-methodology-note">{evidence.notes}</span>
      </>
    );
  } else if (evidence.denominator.includes('cumulative')) {
    benchmarkContent = (
      <>
        <span className="giving-benchmark-value">{formatQualifiedValue(evidence, formatReportedValue(evidence))}</span>
        <span className="giving-benchmark-kind">{t('components.giving.reportedCumulative')}</span>
      </>
    );
  } else {
    const val = platform.dailyVolumeUsd > 0
      ? formatCurrency(platform.dailyVolumeUsd * 365)
      : formatReportedValue(evidence);
    benchmarkContent = (
      <>
        <span className="giving-benchmark-value">{formatQualifiedValue(evidence, val)}</span>
        <span className="giving-benchmark-kind">{t('components.giving.trackedAnnualized')}</span>
      </>
    );
  }

  return (
    <tr className="giving-row">
      <td className="giving-platform-name">{platform.platform}</td>
      <td className="giving-platform-benchmark">
        {benchmarkContent}
        {evidence && <SourceMeta entry={evidence} />}
      </td>
    </tr>
  );
}

function PlatformsTab({ data }: { data: GivingSummary }) {
  if (!data.platforms.length) {
    return <div className="panel-empty">{t('common.noDataShort')}</div>;
  }
  return (
    <table className="giving-table">
      <thead>
        <tr>
          <th>{t('components.giving.platform')}</th>
          <th>{t('components.giving.benchmark')}</th>
        </tr>
      </thead>
      <tbody>
        {data.platforms.map(p => <PlatformRow key={p.platform} data={data} platform={p} />)}
      </tbody>
    </table>
  );
}

function CategoryRow({ data, category }: { data: GivingSummary; category: CategoryBreakdown }) {
  const evidence = contextProvenance(data, 'categories[*].share');
  const verified = evidence?.status === 'verified';
  const value = verified
    ? `${(category.share * 100).toFixed(1)}%`
    : t('components.giving.sourceNotVerified');
  return (
    <tr className="giving-row">
      <td className="giving-cat-name">{category.category}</td>
      <td className="giving-category-benchmark">
        <span className={verified ? 'giving-benchmark-value' : 'giving-unverified'}>{value}</span>
        {evidence && <SourceMeta entry={evidence} />}
      </td>
    </tr>
  );
}

function CategoriesTab({ data }: { data: GivingSummary }) {
  if (!data.categories.length) {
    return <div className="panel-empty">{t('common.noDataShort')}</div>;
  }
  return (
    <table className="giving-table giving-cat-table">
      <tbody>
        {data.categories.map(c => <CategoryRow key={c.category} data={data} category={c} />)}
      </tbody>
    </table>
  );
}

function InstitutionalMetric({ data, path, label }: { data: GivingSummary; path: string; label: string }) {
  const evidence = contextProvenance(data, path);
  const verified = evidence?.status === 'verified';
  return (
    <div className="giving-stat-box">
      <span className={verified ? 'giving-stat-value' : 'giving-unverified'}>
        {verified && evidence
          ? formatQualifiedValue(evidence, formatReportedValue(evidence))
          : t('components.giving.sourceNotVerified')}
      </span>
      <span className="giving-stat-label">{label}</span>
      {evidence && <SourceMeta entry={evidence} />}
    </div>
  );
}

function InstitutionalTab({ data }: { data: GivingSummary }) {
  return (
    <div className="giving-inst-grid">
      <InstitutionalMetric data={data} path="institutional.oecd_oda_annual_usd_bn" label={t('components.giving.oecdOda')} />
      <InstitutionalMetric data={data} path="institutional.candid_grants_tracked" label={t('components.giving.candidGrants')} />
    </div>
  );
}

function MethodologySection({ data }: { data: GivingSummary }) {
  const open = data.availability === 'available' ? undefined : true;
  return (
    <details className="giving-methodology" open={open}>
      <summary>{t('components.giving.sourcesMethodology')}</summary>
      <p>{t('components.giving.methodologyIntro')}</p>
      <ul>
        {data.provenance.map((entry, i) => (
          <li key={i} className="giving-methodology-item">
            <span className="giving-methodology-source"><SourceName entry={entry} /></span>
            <span className="giving-source-meta">{entry.referencePeriod} · {entry.status.replace(/_/g, ' ')}</span>
            <span className="giving-methodology-note">{entry.notes}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

type PanelState =
  | { type: 'loading' }
  | { type: 'unavailable' }
  | { type: 'data'; data: GivingSummary };

export function GivingPanelContent() {
  const [panelState, setPanelState] = useState<PanelState>({ type: 'loading' });
  const [activeTab, setActiveTab] = useState<GivingTab>('platforms');
  const expiryTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const showUnavailable = useCallback(() => {
    if (expiryTimerRef.current !== null) {
      globalThis.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    setPanelState({ type: 'unavailable' });
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    void (async () => {
      const result = await fetchGivingSummary();
      if (unmountedRef.current) return;
      if (!result.ok) { showUnavailable(); return; }
      const data = result.data;
      const materializedAt = Date.parse(data.materializedAt);
      const expiresInMs = materializedAt + GIVING_STALE_CEILING_MS - Date.now();
      if (!Number.isFinite(materializedAt) || expiresInMs <= 0) { showUnavailable(); return; }
      expiryTimerRef.current = globalThis.setTimeout(() => {
        expiryTimerRef.current = null;
        if (!unmountedRef.current) showUnavailable();
      }, expiresInMs);
      setPanelState({ type: 'data', data });
      setActiveTab(prev => {
        const tabs = availableGivingTabs(data);
        return tabs.includes(prev) ? prev : 'platforms';
      });
    })();
    return () => {
      unmountedRef.current = true;
      if (expiryTimerRef.current !== null) {
        globalThis.clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
    };
  }, [showUnavailable]);

  if (panelState.type === 'loading') {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar"><div className="panel-radar-sweep" /><div className="panel-radar-dot" /></div>
        <div className="panel-loading-text">{t('common.loadingGiving')}</div>
      </div>
    );
  }

  if (panelState.type === 'unavailable') {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{t('common.noDataShort')}</div>
      </div>
    );
  }

  const { data } = panelState;
  const tabs = availableGivingTabs(data);
  const currentTab = tabs.includes(activeTab) ? activeTab : 'platforms';
  const tabLabels: Record<GivingTab, string> = {
    platforms: t('components.giving.tabs.platforms'),
    categories: t('components.giving.tabs.categories'),
    institutional: t('components.giving.tabs.institutional'),
  };

  return (
    <div className="giving-panel-content">
      <div className={`giving-status giving-status-${data.availability}`} role="status">
        {t(statusKey(data.availability))}
      </div>

      <AggregateStats data={data} />

      {tabs.length > 1 && (
        <div className="panel-tabs">
          {tabs.map(tab => (
            <button
              key={tab}
              className={`panel-tab ${currentTab === tab ? 'active' : ''}`}
              data-tab={tab}
              onClick={() => setActiveTab(tab)}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
      )}

      {currentTab === 'categories'    ? <CategoriesTab data={data} />    :
       currentTab === 'institutional' ? <InstitutionalTab data={data} /> :
                                        <PlatformsTab data={data} />}

      <MethodologySection data={data} />
    </div>
  );
}

export function GivingPanel() {
  return (
    <PanelShell
      id="giving"
      title={t('components.giving.benchmarkTitle')}
      infoTooltip={t('components.giving.benchmarkInfoTooltip')}
    >
      <GivingPanelContent />
    </PanelShell>
  );
}
