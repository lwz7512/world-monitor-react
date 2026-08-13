import { usePanelData } from '@/hooks/usePanelData';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { fetchPredictions, type PredictionMarket } from '@/services/prediction';
import { PanelShell } from '@/components/PanelShell';

function formatVolume(volume?: number): string {
  if (!volume) return '';
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
  return `$${volume.toFixed(0)}`;
}

function convictionLabel(yes: number): { label: string; cls: string } {
  if (yes >= 60) return { label: t('components.predictions.leanYes') ?? 'Lean Yes', cls: 'conviction-yes' };
  if (yes <= 40) return { label: t('components.predictions.leanNo') ?? 'Lean No', cls: 'conviction-no' };
  return { label: t('components.predictions.tossUp') ?? 'Toss-up', cls: 'conviction-neutral' };
}

function PredictionCard({ p }: { p: PredictionMarket }) {
  const yesPercent = Math.round(p.yesPrice);
  const noPercent = 100 - yesPercent;
  const volumeStr = formatVolume(p.volume);
  const safeUrl = sanitizeUrl(p.url || '');
  const { label: convLabel, cls: convCls } = convictionLabel(yesPercent);

  let expiryStr = '';
  if (p.endDate) {
    const d = new Date(p.endDate);
    if (Number.isFinite(d.getTime())) {
      expiryStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }

  const isKalshi = p.source === 'kalshi';
  const sourceLabel = isKalshi ? 'Kalshi' : 'Polymarket';
  const srcClass = isKalshi ? 'kalshi' : 'polymarket';
  const yesStrong = yesPercent >= 60 ? ' prediction-bar-strong' : '';
  const noStrong = noPercent >= 60 ? ' prediction-bar-strong' : '';

  return (
    <div className={`prediction-item prediction-src-${srcClass}`}>
      <div className="prediction-head">
        <span className="prediction-source" data-source={srcClass}>{sourceLabel}</span>
        {safeUrl
          ? <a href={safeUrl} target="_blank" rel="noopener" className="prediction-question prediction-link">{p.title}</a>
          : <div className="prediction-question">{p.title}</div>
        }
      </div>
      <div className="prediction-meta">
        {volumeStr && <span>{t('components.predictions.vol')}: {volumeStr}</span>}
        {expiryStr && <span>{t('components.predictions.closes')}: {expiryStr}</span>}
        <span className={`prediction-conviction ${convCls}`}>{convLabel}</span>
      </div>
      <div className="prediction-bar">
        <div className={`prediction-yes${yesStrong}`} style={{ width: `${yesPercent}%` }}>
          <span className="prediction-label">{t('components.predictions.yes')} {yesPercent}%</span>
        </div>
        <div className={`prediction-no${noStrong}`} style={{ width: `${noPercent}%` }}>
          <span className="prediction-label">{t('components.predictions.no')} {noPercent}%</span>
        </div>
      </div>
    </div>
  );
}

async function fetcher(_signal: AbortSignal): Promise<PredictionMarket[]> {
  return fetchPredictions();
}

export function PredictionPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'predictions',
    ttlMs: 10 * 60 * 1000,
  });

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
      </div>
    );
  }

  if (error || !data?.length) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.failedPredictions')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div className="prediction-list">
      {data.map((p, i) => <PredictionCard key={p.title || i} p={p} />)}
    </div>
  );
}

export function PredictionPanel() {
  return (
    <PanelShell
      id="polymarket"
      title={t('panels.polymarket')}
      infoTooltip={t('components.prediction.infoTooltip')}
    >
      <PredictionPanelContent />
    </PanelShell>
  );
}
