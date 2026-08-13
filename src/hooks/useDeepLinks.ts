import { useEffect, useRef } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { trackDeeplinkOpened } from '@/services/analytics';
import { getCountryNameByCode } from '@/services/country-geometry';
import { CountryIntelManager } from '@/app/country-intel';

const DEEP_LINK_INITIAL_DELAY_MS = 1500;

export function useDeepLinks(): void {
  const ctx = useAppContextMaybe();
  const chokepointTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ctx) return;
    const c = ctx;
    const dl = c.pendingDeepLinks;
    if (!dl) return;
    c.pendingDeepLinks = null;

    const actions = getPublishedAppActions();

    // ?c=IR or /story path
    const url = new URL(window.location.href);
    const storyCode = dl.storyCode ?? url.searchParams.get('c');
    if (url.pathname === '/story' || storyCode) {
      if (storyCode) {
        trackDeeplinkOpened('country', storyCode);
        const countryName = getCountryNameByCode(storyCode.toUpperCase()) || storyCode;
        window.setTimeout(() => {
          actions?.openCountryBriefByCode?.(storyCode.toUpperCase(), countryName, { maximize: true });
          actions?.syncUrlState();
        }, DEEP_LINK_INITIAL_DELAY_MS);
        return;
      }
    }

    // ?country=UA or ?country=UA&expanded=1
    if (dl.country) {
      const country = dl.country;
      const expanded = dl.expanded;
      trackDeeplinkOpened('country', country);
      const cName = CountryIntelManager.resolveCountryName(country);
      window.setTimeout(() => {
        actions?.openCountryBriefByCode?.(country, cName, { maximize: expanded });
        actions?.syncUrlState();
      }, DEEP_LINK_INITIAL_DELAY_MS);
    }

    // ?chokepoint=bab_el_mandeb
    if (dl.chokepoint) {
      const chokepoint = dl.chokepoint;
      trackDeeplinkOpened('chokepoint', chokepoint);
      c.activeChokepoint = chokepoint;
      chokepointTimerRef.current = window.setTimeout(() => {
        chokepointTimerRef.current = null;
        if (c.isDestroyed) return;
        c.mapLayers.waterways = true;
        c.map?.enableLayer('waterways');
        c.map?.openChokepoint(chokepoint);
        actions?.syncUrlState();
      }, DEEP_LINK_INITIAL_DELAY_MS);
    }

    return () => {
      if (chokepointTimerRef.current !== null) {
        window.clearTimeout(chokepointTimerRef.current);
        chokepointTimerRef.current = null;
      }
    };
  }, [ctx]);
}
