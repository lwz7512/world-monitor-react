import { useState } from 'react';
import { t } from '@/services/i18n';
import { usePanelData } from '@/hooks/usePanelData';
import type { InternetOutage } from '@/types';
import type {
  ListInternetDdosAttacksResponse,
  TrafficAnomaly,
} from '@/generated/client/worldmonitor/infrastructure/v1/service_client';
import {
  fetchInternetOutages,
  fetchDdosAttacks,
  fetchTrafficAnomalies,
} from '@/services/infrastructure';
import { PanelShell } from '@/components/PanelShell';

type Tab = 'outages' | 'ddos' | 'anomalies';

interface AllData {
  outages: InternetOutage[];
  ddos: ListInternetDdosAttacksResponse | null;
  anomalies: TrafficAnomaly[];
}

async function fetcher(_signal: AbortSignal): Promise<AllData> {
  const [outages, ddosResp, anomaliesResp] = await Promise.allSettled([
    fetchInternetOutages(),
    fetchDdosAttacks(),
    fetchTrafficAnomalies(),
  ]);
  return {
    outages: outages.status === 'fulfilled' ? outages.value : [],
    ddos: ddosResp.status === 'fulfilled' ? ddosResp.value : null,
    anomalies: anomaliesResp.status === 'fulfilled' ? (anomaliesResp.value.anomalies ?? []) : [],
  };
}

function OutageRow({ o }: { o: InternetOutage }) {
  const sevColor = o.severity === 'total' ? '#ff2020' : o.severity === 'major' ? '#ff8800' : '#ffcc00';
  const badge = o.severity === 'total' ? 'NATIONWIDE' : o.severity === 'major' ? 'REGIONAL' : 'PARTIAL';
  const ongoing = !o.endDate;
  return (
    <div className="id-row">
      <div className="id-row-header">
        <span className="id-severity-dot" style={{ color: sevColor }}>●</span>
        <span className="id-row-title">{o.country}</span>
        <span className={`id-badge severity-${o.severity}`}>{badge}</span>
        {ongoing && <span className="id-badge ongoing">⚡ LIVE</span>}
      </div>
      <div className="id-row-sub">{o.title}</div>
      {o.cause && <div className="id-row-meta">{o.cause.replace(/_/g, ' ')}</div>}
    </div>
  );
}

function BarRow({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="id-bar-row">
      <span className="id-bar-label">{label}</span>
      <div className="id-bar-track">
        <div className="id-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      <span className="id-bar-pct">{pct.toFixed(1)}%</span>
    </div>
  );
}

function AnomalyRow({ a }: { a: TrafficAnomaly }) {
  const ongoing = a.status === 'ONGOING';
  const typeLabel = a.type.replace(/^ANOMALY_/, '');
  const location = a.locationName || a.locationCode || '';
  const asn = a.asnName ? `AS${a.asn} ${a.asnName}` : '';
  const timeStr = a.startDate
    ? (() => { try { return new Date(a.startDate).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } })()
    : '';
  return (
    <div className="id-row">
      <div className="id-row-header">
        <span className="id-anomaly-type">{typeLabel}</span>
        {location && <span className="id-row-title">{location}</span>}
        {ongoing
          ? <span className="id-badge ongoing">⚡ ONGOING</span>
          : <span className="id-badge historical">HISTORICAL</span>
        }
      </div>
      {asn && <div className="id-row-meta">{asn}</div>}
      {timeStr && <div className="id-row-meta">{timeStr}</div>}
    </div>
  );
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

export function InternetDisruptionsPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    hydrationKey: 'internetDisruptions',
    ttlMs: 5 * 60 * 1000,
  });
  const [tab, setTab] = useState<Tab>('outages');

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

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.failedToLoad')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const { outages, ddos, anomalies } = data;
  const sortedOutages = [...outages].sort((a, b) => {
    const order: Record<string, number> = { total: 0, major: 1, partial: 2 };
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });
  const sortedAnomalies = [...anomalies].sort((a, b) => {
    if (a.status === 'ONGOING' && b.status !== 'ONGOING') return -1;
    if (b.status === 'ONGOING' && a.status !== 'ONGOING') return 1;
    return (b.startDate ?? 0) - (a.startDate ?? 0);
  });

  const ddosCount = ddos ? (ddos.protocol.length + ddos.vector.length) : 0;
  const counts: Record<Tab, number> = { outages: outages.length, ddos: ddosCount, anomalies: anomalies.length };
  const labels: Record<Tab, string> = {
    outages: t('panels.internetDisruptionsTabs.outages') ?? 'Outages',
    ddos: t('panels.internetDisruptionsTabs.ddos') ?? 'DDoS',
    anomalies: t('panels.internetDisruptionsTabs.anomalies') ?? 'Anomalies',
  };

  return (
    <div>
      <div className="id-tabs">
        {(['outages', 'ddos', 'anomalies'] as Tab[]).map(t => (
          <button
            key={t}
            className={`id-tab-btn${tab === t ? ' active' : ''}`}
            data-tab={t}
            onClick={() => setTab(t)}
          >
            {labels[t]}
            {counts[t] > 0 && <span className="id-tab-count">{counts[t]}</span>}
          </button>
        ))}
      </div>

      {tab === 'outages' && (
        sortedOutages.length === 0
          ? <div className="id-empty">{t('components.internetDisruptions.noOutages')}</div>
          : <div className="id-list">{sortedOutages.map(o => <OutageRow key={o.country + o.title} o={o} />)}</div>
      )}

      {tab === 'ddos' && (
        !ddos || (!ddos.protocol.length && !ddos.vector.length)
          ? <div className="id-empty">{t('components.internetDisruptions.noDdos')}</div>
          : (
            <div className="id-ddos">
              {ddos.dateRangeStart && (
                <div className="id-date-range">
                  {formatDate(ddos.dateRangeStart)} – {formatDate(ddos.dateRangeEnd)}
                </div>
              )}
              {ddos.protocol.length > 0 && (
                <div className="id-section">
                  <div className="id-section-title">{t('components.internetDisruptions.byProtocol')}</div>
                  {ddos.protocol.slice(0, 6).map(e => <BarRow key={e.label} label={e.label} pct={e.percentage} color="#b400ff" />)}
                </div>
              )}
              {ddos.vector.length > 0 && (
                <div className="id-section">
                  <div className="id-section-title">{t('components.internetDisruptions.byVector')}</div>
                  {ddos.vector.slice(0, 6).map(e => <BarRow key={e.label} label={e.label} pct={e.percentage} color="#ff4400" />)}
                </div>
              )}
              {ddos.topTargetLocations.length > 0 && (
                <div className="id-section">
                  <div className="id-section-title">{t('components.internetDisruptions.topTargets')}</div>
                  {ddos.topTargetLocations.slice(0, 8).map(loc => (
                    <BarRow key={loc.countryCode} label={loc.countryName || loc.countryCode} pct={loc.percentage} color="#cc0044" />
                  ))}
                </div>
              )}
            </div>
          )
      )}

      {tab === 'anomalies' && (
        sortedAnomalies.length === 0
          ? <div className="id-empty">{t('components.internetDisruptions.noAnomalies')}</div>
          : <div className="id-list">{sortedAnomalies.map((a, i) => <AnomalyRow key={a.asnName || i} a={a} />)}</div>
      )}
    </div>
  );
}

export function InternetDisruptionsPanel() {
  return (
    <PanelShell
      id="internet-disruptions"
      title={t('panels.internetDisruptions')}
      infoTooltip={t('components.internetDisruptions.infoTooltip')}
      defaultRowSpan={2}
    >
      <InternetDisruptionsPanelContent />
    </PanelShell>
  );
}
