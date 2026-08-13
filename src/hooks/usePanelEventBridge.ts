import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { setRendererCapability } from '@/services/china-corridor-store';
import { saveToStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';
import { t } from '@/services/i18n';
import type { ChinaCorridorControlTower } from '@/services/supply-chain';

/**
 * Handles window custom-event listeners that were previously managed by
 * PanelLayoutManager.createPanels() / destroy(). These events are dispatched
 * by React panel components to trigger map operations or app-level state updates.
 *
 * Phase 7 Batch 1 extraction from panel-layout.ts.
 */
export function usePanelEventBridge(): void {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx) return;

    const mapFocus = (zoom: number) => (e: Event) => {
      const { lat, lon } = (e as CustomEvent<{ lat: number; lon: number }>).detail;
      ctx.map?.setCenter(lat, lon, zoom);
    };

    const climateHandler = mapFocus(4);
    const radiationHandler = mapFocus(4);
    const thermalHandler = mapFocus(4);
    const correlationHandler = mapFocus(4);
    const strategicRiskHandler = mapFocus(4);
    const strategicPostureHandler = mapFocus(4);
    const displacementHandler = mapFocus(4);
    const ucdpHandler = mapFocus(5);
    const geoHubHandler = mapFocus(4);
    const techHubHandler = mapFocus(4);

    const techEventHandler = (e: Event) => {
      const { lat, lng, zoom } = (e as CustomEvent<{ lat: number; lng: number; zoom: number }>).detail;
      ctx.map?.setCenter(lat, lng, zoom ?? 10);
    };

    const gccInvestmentHandler = (e: Event) => {
      const { lat, lon } = (e as CustomEvent<{ lat: number; lon: number }>).detail;
      void import('@/services/investments-focus').then(({ focusInvestmentOnMap }) => {
        focusInvestmentOnMap(ctx.map, ctx.mapLayers, lat, lon);
      });
    };

    const scenarioActivateHandler = (e: Event) => {
      const { scenarioId, result } = (e as CustomEvent).detail;
      ctx.map?.activateScenario(scenarioId, result);
    };

    const scenarioDismissHandler = () => {
      ctx.map?.deactivateScenario();
    };

    const corridorSelectHandler = (e: Event) => {
      const { corridor } = (e as CustomEvent<{ corridor: ChinaCorridorControlTower }>).detail;
      const supported = ctx.map?.setChinaCorridorSelection(corridor);
      if (supported !== undefined) setRendererCapability(supported);
      if (ctx.isMobile) {
        const mapSection = document.getElementById('mapSection');
        if (mapSection && !mapSection.classList.contains('hidden') && mapSection.classList.contains('collapsed')) {
          mapSection.classList.remove('collapsed');
          saveToStorage('mobile-map-collapsed', false);
          const btn = document.querySelector('.map-collapse-btn') as HTMLButtonElement | null;
          if (btn) btn.textContent = `▼ ${t('components.map.hideMap')}`;
          window.dispatchEvent(new Event('resize'));
        }
        document.querySelector('.main-content')?.scrollTo({ top: 0 });
      }
    };

    const happyMapFocusHandler = (e: Event) => {
      const { lat, lon } = (e as CustomEvent<{ lat: number; lon: number }>).detail;
      ctx.map?.setCenter(lat, lon, 4);
      ctx.map?.flashLocation(lat, lon, 3000);
    };

    const monitorsChangedHandler = (e: Event) => {
      const actions = getPublishedAppActions();
      const { monitors } = (e as CustomEvent).detail;
      ctx.monitors = monitors;
      saveToStorage(STORAGE_KEYS.monitors, monitors);
      actions?.updateMonitorResults();
    };

    const ciiShareStoryHandler = (e: Event) => {
      const actions = getPublishedAppActions();
      const { code, name } = (e as CustomEvent).detail;
      actions?.openCountryStory(code, name);
    };

    const ciiCountryClickHandler = (e: Event) => {
      const actions = getPublishedAppActions();
      const { code } = (e as CustomEvent).detail;
      actions?.openCountryBrief(code);
    };

    window.addEventListener('wm:climate-map-focus', climateHandler);
    window.addEventListener('wm:radiation-map-focus', radiationHandler);
    window.addEventListener('wm:thermal-map-focus', thermalHandler);
    window.addEventListener('wm:correlation-map-focus', correlationHandler);
    window.addEventListener('wm:strategic-risk-click', strategicRiskHandler);
    window.addEventListener('wm:strategic-posture-click', strategicPostureHandler);
    window.addEventListener('wm:displacement-click', displacementHandler);
    window.addEventListener('wm:ucdp-event-click', ucdpHandler);
    window.addEventListener('wm:geo-hub-click', geoHubHandler);
    window.addEventListener('wm:tech-hub-click', techHubHandler);
    window.addEventListener('wm:tech-event-click', techEventHandler);
    window.addEventListener('wm:gcc-investment-click', gccInvestmentHandler);
    window.addEventListener('wm:scenario-activate', scenarioActivateHandler);
    window.addEventListener('wm:scenario-dismiss', scenarioDismissHandler);
    window.addEventListener('wm:corridor-select', corridorSelectHandler);
    window.addEventListener('happy:map-focus', happyMapFocusHandler);
    window.addEventListener('wm:monitors-changed', monitorsChangedHandler);
    window.addEventListener('wm:cii-share-story', ciiShareStoryHandler);
    window.addEventListener('wm:cii-country-click', ciiCountryClickHandler);

    return () => {
      window.removeEventListener('wm:climate-map-focus', climateHandler);
      window.removeEventListener('wm:radiation-map-focus', radiationHandler);
      window.removeEventListener('wm:thermal-map-focus', thermalHandler);
      window.removeEventListener('wm:correlation-map-focus', correlationHandler);
      window.removeEventListener('wm:strategic-risk-click', strategicRiskHandler);
      window.removeEventListener('wm:strategic-posture-click', strategicPostureHandler);
      window.removeEventListener('wm:displacement-click', displacementHandler);
      window.removeEventListener('wm:ucdp-event-click', ucdpHandler);
      window.removeEventListener('wm:geo-hub-click', geoHubHandler);
      window.removeEventListener('wm:tech-hub-click', techHubHandler);
      window.removeEventListener('wm:tech-event-click', techEventHandler);
      window.removeEventListener('wm:gcc-investment-click', gccInvestmentHandler);
      window.removeEventListener('wm:scenario-activate', scenarioActivateHandler);
      window.removeEventListener('wm:scenario-dismiss', scenarioDismissHandler);
      window.removeEventListener('wm:corridor-select', corridorSelectHandler);
      window.removeEventListener('happy:map-focus', happyMapFocusHandler);
      window.removeEventListener('wm:monitors-changed', monitorsChangedHandler);
      window.removeEventListener('wm:cii-share-story', ciiShareStoryHandler);
      window.removeEventListener('wm:cii-country-click', ciiCountryClickHandler);
    };
  }, [ctx]);
}
