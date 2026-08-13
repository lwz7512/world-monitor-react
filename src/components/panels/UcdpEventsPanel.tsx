import { useState, useEffect } from 'react';
import { t } from '@/services/i18n';
import type { UcdpGeoEvent, UcdpEventType } from '@/types';
import { getUcdpEventsData, subscribeUcdpEventsData } from '@/services/ucdp-events-store';
import { PanelShell } from '@/components/PanelShell';

const UCDP_EVENT_TYPES: UcdpEventType[] = ['state-based', 'non-state', 'one-sided'];
const PROTO_VIOLENCE_TYPE: Record<UcdpEventType, string> = {
  'state-based': 'UCDP_VIOLENCE_TYPE_STATE_BASED',
  'non-state': 'UCDP_VIOLENCE_TYPE_NON_STATE',
  'one-sided': 'UCDP_VIOLENCE_TYPE_ONE_SIDED',
};

export function UcdpEventsPanelContent() {
  const [eventsData, setEventsData] = useState(getUcdpEventsData);
  const [activeTab, setActiveTab] = useState<UcdpEventType>('state-based');

  useEffect(() => subscribeUcdpEventsData(setEventsData), []);

  const { events, aggregates } = eventsData;

  if (events.length === 0) {
    return <div className="panel-loading">{t('common.loadingUcdpEvents')}</div>;
  }

  const filtered = events.filter(e => e.type_of_violence === activeTab);
  const tabCounts: Record<UcdpEventType, number> = { 'state-based': 0, 'non-state': 0, 'one-sided': 0 };
  if (aggregates) {
    for (const type of UCDP_EVENT_TYPES) tabCounts[type] = aggregates[PROTO_VIOLENCE_TYPE[type]]?.count ?? 0;
  } else {
    for (const e of events) tabCounts[e.type_of_violence] += 1;
  }

  const totalDeaths = aggregates
    ? (aggregates[PROTO_VIOLENCE_TYPE[activeTab]]?.totalDeaths ?? 0)
    : filtered.reduce((s, e) => s + e.deaths_best, 0);

  const displayed = filtered.slice(0, 50);

  const tabs: { key: UcdpEventType; label: string }[] = [
    { key: 'state-based', label: t('components.ucdpEvents.stateBased') },
    { key: 'non-state', label: t('components.ucdpEvents.nonState') },
    { key: 'one-sided', label: t('components.ucdpEvents.oneSided') },
  ];

  return (
    <div className="ucdp-panel-content">
      <div className="ucdp-header">
        <div className="panel-tabs">
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`panel-tab${tab.key === activeTab ? ' active' : ''}`}
              data-tab={tab.key}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label} <span className="ucdp-tab-count">{tabCounts[tab.key]}</span>
            </button>
          ))}
        </div>
        {totalDeaths > 0 && (
          <span className="ucdp-total-deaths">
            {t('components.ucdpEvents.deathsCount', { count: totalDeaths.toLocaleString() })}
          </span>
        )}
      </div>
      {displayed.length === 0 ? (
        <div className="panel-empty">{t('common.noEventsInCategory')}</div>
      ) : (
        <table className="ucdp-table">
          <thead>
            <tr>
              <th>{t('components.ucdpEvents.country')}</th>
              <th>{t('components.ucdpEvents.deaths')}</th>
              <th>{t('components.ucdpEvents.date')}</th>
              <th>{t('components.ucdpEvents.actors')}</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((e: UcdpGeoEvent, i: number) => {
              const deathsClass = e.type_of_violence === 'state-based' ? 'ucdp-deaths-state'
                : e.type_of_violence === 'non-state' ? 'ucdp-deaths-nonstate'
                : 'ucdp-deaths-onesided';
              return (
                <tr
                  key={`${e.latitude}-${e.longitude}-${i}`}
                  className="ucdp-row"
                  data-lat={e.latitude}
                  data-lon={e.longitude}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    if (Number.isFinite(e.latitude) && Number.isFinite(e.longitude)) {
                      window.dispatchEvent(new CustomEvent('wm:ucdp-event-click', { detail: { lat: e.latitude, lon: e.longitude } }));
                    }
                  }}
                >
                  <td className="ucdp-country">{e.country}</td>
                  <td className="ucdp-deaths">
                    {e.deaths_best > 0 ? (
                      <>
                        <span className={deathsClass}>{e.deaths_best}</span>{' '}
                        <small className="ucdp-range">({e.deaths_low}-{e.deaths_high})</small>
                      </>
                    ) : (
                      <span className="ucdp-deaths-zero">0</span>
                    )}
                  </td>
                  <td className="ucdp-date">{e.date_start}</td>
                  <td className="ucdp-actors">{e.side_a} vs {e.side_b}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {filtered.length > 50 && (
        <div className="panel-more">
          {t('components.ucdpEvents.moreNotShown', { count: filtered.length - 50 })}
        </div>
      )}
    </div>
  );
}

export function UcdpEventsPanel() {
  return (
    <PanelShell
      id="ucdp-events"
      title={t('panels.ucdpEvents')}
      infoTooltip={t('components.ucdpEvents.infoTooltip')}
      defaultRowSpan={2}
    >
      <UcdpEventsPanelContent />
    </PanelShell>
  );
}
