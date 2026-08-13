import { useState, useEffect } from 'react';
import type { PopulationExposure } from '@/types';
import { formatPopulation } from '@/services/population-exposure';
import { getPopulationExposureState, subscribePopulationExposures } from '@/services/population-exposure-store';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

function getTypeIcon(type: string): string {
  switch (type) {
    case 'state-based':
    case 'non-state':
    case 'one-sided':
    case 'conflict':
    case 'battle':
      return '⚔️';
    case 'earthquake':
      return '🌍';
    case 'flood':
      return '🌊';
    case 'fire':
    case 'wildfire':
      return '🔥';
    default:
      return '📍';
  }
}

export function PopulationExposurePanelContent() {
  const [state, setState] = useState(getPopulationExposureState);
  useEffect(() => subscribePopulationExposures(setState), []);

  if (state === undefined) return <div className="panel-loading">{t('common.calculatingExposure')}</div>;
  if (state === null || state.length === 0) return <div className="panel-empty">{t('common.noDataAvailable')}</div>;

  const exposures: PopulationExposure[] = state;
  const totalAffected = exposures.reduce((sum, e) => sum + e.exposedPopulation, 0);

  return (
    <div className="popexp-panel-content">
      <div className="popexp-summary">
        <span className="popexp-label">{t('components.populationExposure.totalAffected')}</span>
        <span className="popexp-total">{formatPopulation(totalAffected)}</span>
      </div>
      <div className="popexp-list">
        {exposures.slice(0, 30).map((e, i) => {
          const icon = getTypeIcon(e.eventType);
          const popClass = e.exposedPopulation >= 1_000_000 ? ' popexp-pop-large' : '';
          return (
            <div key={`${e.eventName}-${i}`} className="popexp-card">
              <div className="popexp-card-name">{icon} {e.eventName}</div>
              <div className="popexp-card-meta">
                <span className={`popexp-card-pop${popClass}`}>
                  {t('components.populationExposure.affectedCount', { count: formatPopulation(e.exposedPopulation) })}
                </span>
                <span className="popexp-card-radius">
                  {t('components.populationExposure.radiusKm', { km: String(e.exposureRadiusKm) })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PopulationExposurePanel() {
  return (
    <PanelShell
      id="population-exposure"
      title={t('panels.populationExposure')}
      infoTooltip={t('components.populationExposure.infoTooltip')}
    >
      <PopulationExposurePanelContent />
    </PanelShell>
  );
}
