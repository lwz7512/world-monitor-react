import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { getTechReadinessRankings, type TechReadinessScore } from '@/services/economic';
import { PanelShell } from '@/components/PanelShell';

const FLAGS: Record<string, string> = {
  'USA': '🇺🇸', 'CHN': '🇨🇳', 'JPN': '🇯🇵', 'DEU': '🇩🇪', 'KOR': '🇰🇷',
  'GBR': '🇬🇧', 'IND': '🇮🇳', 'ISR': '🇮🇱', 'SGP': '🇸🇬', 'TWN': '🇹🇼',
  'FRA': '🇫🇷', 'CAN': '🇨🇦', 'SWE': '🇸🇪', 'NLD': '🇳🇱', 'CHE': '🇨🇭',
  'FIN': '🇫🇮', 'IRL': '🇮🇪', 'AUS': '🇦🇺', 'BRA': '🇧🇷', 'IDN': '🇮🇩',
  'ESP': '🇪🇸', 'ITA': '🇮🇹', 'MEX': '🇲🇽', 'RUS': '🇷🇺', 'TUR': '🇹🇷',
  'SAU': '🇸🇦', 'ARE': '🇦🇪', 'POL': '🇵🇱', 'THA': '🇹🇭', 'MYS': '🇲🇾',
  'VNM': '🇻🇳', 'PHL': '🇵🇭', 'NZL': '🇳🇿', 'AUT': '🇦🇹', 'BEL': '🇧🇪',
  'DNK': '🇩🇰', 'NOR': '🇳🇴', 'PRT': '🇵🇹', 'CZE': '🇨🇿', 'ZAF': '🇿🇦',
  'NGA': '🇳🇬', 'KEN': '🇰🇪', 'EGY': '🇪🇬', 'ARG': '🇦🇷', 'CHL': '🇨🇱',
  'COL': '🇨🇴', 'PAK': '🇵🇰', 'BGD': '🇧🇩', 'UKR': '🇺🇦', 'ROU': '🇷🇴',
  'EST': '🇪🇪', 'LVA': '🇱🇻', 'LTU': '🇱🇹', 'HUN': '🇭🇺', 'GRC': '🇬🇷',
  'QAT': '🇶🇦', 'BHR': '🇧🇭', 'KWT': '🇰🇼', 'OMN': '🇴🇲', 'JOR': '🇯🇴',
};

function scoreClass(score: number): string {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function fmt(v: number | null): string {
  return v === null ? '—' : Math.round(v).toString();
}

async function fetcher(_signal: AbortSignal): Promise<TechReadinessScore[]> {
  return getTechReadinessRankings();
}

function CountryRow({ c }: { c: TechReadinessScore }) {
  const cls = scoreClass(c.score);
  return (
    <div className={`readiness-item ${cls}`} data-country={c.country}>
      <div className="readiness-rank">#{c.rank}</div>
      <div className="readiness-flag">{FLAGS[c.country] ?? '🌐'}</div>
      <div className="readiness-info">
        <div className="readiness-name">{c.countryName}</div>
        <div className="readiness-components">
          <span title={t('components.techReadiness.internetUsers') ?? ''}>{'\u{1F310}'}{fmt(c.components.internet)}</span>
          <span title={t('components.techReadiness.mobileSubscriptions') ?? ''}>{'\u{1F4F1}'}{fmt(c.components.mobile)}</span>
          <span title={t('components.techReadiness.rdSpending') ?? ''}>{'\u{1F52C}'}{fmt(c.components.rdSpend)}</span>
        </div>
      </div>
      <div className={`readiness-score ${cls}`}>{c.score}</div>
    </div>
  );
}

export function TechReadinessPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'techReadiness',
    ttlMs: 6 * 60 * 60 * 1000,
  });

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
        <div className="panel-loading-text">{t('components.techReadiness.fetchingData') ?? 'Loading…'}</div>
      </div>
    );
  }

  if (error || !data?.length) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.failedToLoad')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div className="tech-readiness-list">
      {data.slice(0, 25).map(c => <CountryRow key={c.country} c={c} />)}
      <div className="readiness-footer">
        <span className="readiness-source">{t('components.techReadiness.source')}</span>
      </div>
    </div>
  );
}

export function TechReadinessPanel() {
  return (
    <PanelShell
      id="tech-readiness"
      title={t('panels.techReadiness')}
      infoTooltip={t('components.techReadiness.infoTooltip')}
    >
      <TechReadinessPanelContent />
    </PanelShell>
  );
}
