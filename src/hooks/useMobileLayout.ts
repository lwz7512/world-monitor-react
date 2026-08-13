import { useEffect, useRef } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { MobilePanelNav } from '@/components/MobilePanelNav';
import { loadFromStorage, saveToStorage } from '@/utils';
import { t } from '@/services/i18n';

export function useMobileLayout(): void {
  const ctx = useAppContextMaybe();
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!ctx?.isMobile) return;

    // Category chip bar mounted above the panels grid.
    const grid = document.getElementById('panelsGrid');
    if (grid) {
      const nav = new MobilePanelNav(() => ctx.panelSettings);
      ctx.mobilePanelNav = nav;
      grid.before(nav.getElement());
      nav.refresh();
    }

    // Map collapse button — boot-shell marker is cleared here; the hydrated
    // map owns the persistent collapsed state on #mapSection at runtime.
    document.documentElement.classList.remove('wm-map-collapsed');
    const mapSection = document.getElementById('mapSection');
    const headerLeft = mapSection?.querySelector('.panel-header-left');
    if (mapSection && headerLeft) {
      const collapsed = loadFromStorage<boolean>('mobile-map-collapsed', true) === true;
      if (collapsed) mapSection.classList.add('collapsed');

      const btn = document.createElement('button');
      btn.className = 'map-collapse-btn';
      btn.textContent = collapsed
        ? `▶ ${t('components.map.showMap')}`
        : `▼ ${t('components.map.hideMap')}`;
      headerLeft.after(btn);
      btnRef.current = btn;

      btn.addEventListener('click', () => {
        const isCollapsed = mapSection.classList.toggle('collapsed');
        btn.textContent = isCollapsed
          ? `▶ ${t('components.map.showMap')}`
          : `▼ ${t('components.map.hideMap')}`;
        saveToStorage('mobile-map-collapsed', isCollapsed);
        if (!isCollapsed) window.dispatchEvent(new Event('resize'));
      });
    }

    // Reveal handler: dispatched by renderCriticalBanner when the user taps
    // "View Region" so the map expands before the fly-to runs.
    const revealHandler = () => {
      const ms = document.getElementById('mapSection');
      if (!ms || ms.classList.contains('hidden')) return;
      if (ms.classList.contains('collapsed')) {
        ms.classList.remove('collapsed');
        saveToStorage('mobile-map-collapsed', false);
        if (btnRef.current) {
          btnRef.current.textContent = `▼ ${t('components.map.hideMap')}`;
        }
        window.dispatchEvent(new Event('resize'));
      }
      document.querySelector('.main-content')?.scrollTo({ top: 0 });
    };
    window.addEventListener('wm:reveal-mobile-map', revealHandler);

    return () => {
      window.removeEventListener('wm:reveal-mobile-map', revealHandler);
      ctx.mobilePanelNav?.destroy();
      ctx.mobilePanelNav = null;
      btnRef.current?.remove();
      btnRef.current = null;
    };
  }, [ctx]);
}
