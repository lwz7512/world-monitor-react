import { useState, useEffect } from 'react';
import { t } from '@/services/i18n';
import type { UnhcrSummary, CountryDisplacement } from '@/services/displacement';
import { formatPopulation } from '@/services/displacement';
import { subscribe as subscribeFollowed } from '@/services/followed-countries';
import { getDisplacementState, subscribeDisplacementData } from '@/services/displacement-store';
import { PanelShell } from '@/components/PanelShell';

type DisplacementTab = 'origins' | 'hosts';

export function DisplacementPanelContent() {
  const [data, setData] = useState<UnhcrSummary | null | undefined>(getDisplacementState);
  const [activeTab, setActiveTab] = useState<DisplacementTab>('origins');
  const [, setFollowedTick] = useState(0);

  useEffect(() => subscribeDisplacementData(setData), []);
  useEffect(() => subscribeFollowed(() => setFollowedTick(k => k + 1)), []);

  if (!data) return <div className="panel-loading">{t('common.loadingDisplacement')}</div>;

  const g = data.globalTotals;
  const stats = [
    { label: t('components.displacement.refugees'), value: formatPopulation(g.refugees), cls: 'disp-stat-refugees' },
    { label: t('components.displacement.asylumSeekers'), value: formatPopulation(g.asylumSeekers), cls: 'disp-stat-asylum' },
    { label: t('components.displacement.idps'), value: formatPopulation(g.idps), cls: 'disp-stat-idps' },
    { label: t('components.displacement.total'), value: formatPopulation(g.total), cls: 'disp-stat-total' },
  ];

  let countries: CountryDisplacement[];
  if (activeTab === 'origins') {
    countries = [...data.countries]
      .filter(c => c.refugees + c.asylumSeekers > 0)
      .sort((a, b) => (b.refugees + b.asylumSeekers) - (a.refugees + a.asylumSeekers));
  } else {
    countries = [...data.countries]
      .filter(c => (c.hostTotal || 0) > 0)
      .sort((a, b) => (b.hostTotal || 0) - (a.hostTotal || 0));
  }

  const displayed = countries.slice(0, 30);

  return (
    <div className="disp-panel-content">
      <div className="disp-stats-grid">
        {stats.map(s => (
          <div key={s.cls} className={`disp-stat-box ${s.cls}`}>
            <span className="disp-stat-value">{s.value}</span>
            <span className="disp-stat-label">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="panel-tabs" role="tablist" aria-label="Displacement data view">
        <button
          className={`panel-tab${activeTab === 'origins' ? ' active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'origins'}
          id="disp-tab-origins"
          aria-controls="disp-tab-panel"
          onClick={() => setActiveTab('origins')}
        >
          {t('components.displacement.origins')}
        </button>
        <button
          className={`panel-tab${activeTab === 'hosts' ? ' active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'hosts'}
          id="disp-tab-hosts"
          aria-controls="disp-tab-panel"
          onClick={() => setActiveTab('hosts')}
        >
          {t('components.displacement.hosts')}
        </button>
      </div>
      <div id="disp-tab-panel" role="tabpanel" aria-labelledby={`disp-tab-${activeTab}`}>
        {displayed.length === 0 ? (
          <div className="panel-empty">{t('common.noDataShort')}</div>
        ) : (
          <table className="disp-table">
            <thead>
              <tr>
                <th>{t('components.displacement.country')}</th>
                <th>{t('components.displacement.status')}</th>
                <th>{t('components.displacement.count')}</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((c, i) => {
                const hostTotal = c.hostTotal || 0;
                const count = activeTab === 'origins' ? c.refugees + c.asylumSeekers : hostTotal;
                const total = activeTab === 'origins' ? c.totalDisplaced : hostTotal;
                const badgeCls = total >= 1_000_000 ? 'disp-crisis'
                  : total >= 500_000 ? 'disp-high'
                  : total >= 100_000 ? 'disp-elevated'
                  : '';
                const badgeLabel = total >= 1_000_000 ? t('components.displacement.badges.crisis')
                  : total >= 500_000 ? t('components.displacement.badges.high')
                  : total >= 100_000 ? t('components.displacement.badges.elevated')
                  : '';
                return (
                  <tr
                    key={`${c.name}-${i}`}
                    className="disp-row"
                    data-lat={c.lat || ''}
                    data-lon={c.lon || ''}
                    style={{ cursor: (c.lat && c.lon) ? 'pointer' : undefined }}
                    onClick={() => {
                      const lat = Number(c.lat);
                      const lon = Number(c.lon);
                      if (Number.isFinite(lat) && Number.isFinite(lon)) {
                        window.dispatchEvent(new CustomEvent('wm:displacement-click', { detail: { lat, lon } }));
                      }
                    }}
                  >
                    <td className="disp-name">{c.name}</td>
                    <td className="disp-status">
                      {badgeLabel && <span className={`disp-badge ${badgeCls}`}>{badgeLabel}</span>}
                    </td>
                    <td className="disp-count">{formatPopulation(count)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function DisplacementPanel() {
  return (
    <PanelShell
      id="displacement"
      title={t('panels.displacement')}
      infoTooltip={t('components.displacement.infoTooltip')}
      defaultRowSpan={2}
    >
      <DisplacementPanelContent />
    </PanelShell>
  );
}
