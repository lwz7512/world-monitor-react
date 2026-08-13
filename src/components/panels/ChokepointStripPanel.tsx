import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { fetchChokepointStatus } from '@/services/supply-chain';
import type { GetChokepointStatusResponse, ChokepointInfo } from '@/generated/client/worldmonitor/supply_chain/v1/service_client';
import { PanelShell } from '@/components/PanelShell';

const STRIP_ORDER = ['hormuz_strait', 'malacca_strait', 'suez', 'bab_el_mandeb', 'bosphorus', 'dover_strait', 'panama'];

function shortName(id: string): string {
  switch (id) {
    case 'hormuz_strait': return t('components.chokepointStrip.shortName.hormuzStrait');
    case 'malacca_strait': return t('components.chokepointStrip.shortName.malaccaStrait');
    case 'suez': return t('components.chokepointStrip.shortName.suez');
    case 'bab_el_mandeb': return t('components.chokepointStrip.shortName.babElMandeb');
    case 'bosphorus': return t('components.chokepointStrip.shortName.bosphorus');
    case 'dover_strait': return t('components.chokepointStrip.shortName.danishStraits');
    case 'panama': return t('components.chokepointStrip.shortName.panama');
    default: return '';
  }
}

function statusColor(status: string): string {
  const s = (status || '').toLowerCase();
  if (s.includes('closed') || s.includes('critical')) return '#e74c3c';
  if (s.includes('disrupted') || s.includes('high')) return '#e67e22';
  if (s.includes('restricted') || s.includes('elevated') || s.includes('medium')) return '#f39c12';
  return '#2ecc71';
}

function formatFlow(cp: ChokepointInfo): string {
  const est = cp.flowEstimate;
  if (!est || typeof est.currentMbd !== 'number' || typeof est.baselineMbd !== 'number') return '—';
  const pct = est.baselineMbd > 0 ? Math.round((est.currentMbd / est.baselineMbd) * 100) : null;
  if (pct == null) return t('components.chokepointStrip.flow.mbd', { value: est.currentMbd.toFixed(1) });
  return t('components.chokepointStrip.flow.pctOfBaseline', { pct });
}

async function fetcher(_signal: AbortSignal): Promise<GetChokepointStatusResponse> {
  return fetchChokepointStatus();
}

export function ChokepointStripPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'chokepoints',
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

  if (error || !data?.chokepoints?.length) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('components.chokepointStrip.errors.noData')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const byId = new Map(data.chokepoints.map(cp => [cp.id, cp]));
  const ordered = STRIP_ORDER.map(id => byId.get(id)).filter((cp): cp is ChokepointInfo => !!cp);

  return (
    <div className="cp-strip-wrap">
      <div className="cp-strip">
        {ordered.map(cp => {
          const color = statusColor(cp.status);
          const short = shortName(cp.id) || cp.name;
          const flow = formatFlow(cp);
          return (
            <div
              key={cp.id}
              className="cp-chip"
              data-cp={cp.id}
              title={`${cp.name} - ${cp.status || t('components.chokepointStrip.unknown')}`}
            >
              <div className="cp-chip-dot" style={{ background: color }} />
              <div className="cp-chip-body">
                <div className="cp-chip-name">
                  {short}
                  {cp.activeWarnings > 0 && (
                    <span className="cp-chip-warn">{cp.activeWarnings}</span>
                  )}
                </div>
                <div className="cp-chip-flow">{flow}</div>
              </div>
            </div>
          );
        })}
      </div>
      {data.fetchedAt && (
        <div className="cp-attribution">
          {t('components.chokepointStrip.attribution.creditName')} · {new Date(data.fetchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}

export function ChokepointStripPanel() {
  return (
    <PanelShell
      id="chokepoint-strip"
      title={t('components.chokepointStrip.title')}
      infoTooltip={t('components.chokepointStrip.infoTooltip')}
    >
      <ChokepointStripPanelContent />
    </PanelShell>
  );
}
