import { trackCriticalBannerAction } from '@/services/analytics';
import type { TheaterPostureSummary } from '@/services/military-surge';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';

function readSessionStorageValue(key: string): string | null {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}

function writeSessionStorageValue(key: string, value: string): void {
  try { window.sessionStorage.setItem(key, value); } catch {
    // Banner dismissal remains functional for this render even without persistence.
  }
}

export interface CriticalBannerState {
  el: HTMLElement | null;
}

export function renderCriticalBanner(
  postures: TheaterPostureSummary[],
  state: CriticalBannerState,
  isMobile: boolean,
  setMapCenter: (lat: number, lon: number, zoom: number) => void,
): void {
  const dismissedAt = readSessionStorageValue('banner-dismissed');
  if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < 30 * 60 * 1000) {
    return;
  }

  const critical = postures.filter(
    (p) => p.postureLevel === 'critical' || (p.postureLevel === 'elevated' && p.strikeCapable)
  );

  if (critical.length === 0) {
    if (state.el) {
      state.el.remove();
      state.el = null;
      document.body.classList.remove('has-critical-banner');
    }
    return;
  }

  const top = critical[0]!;
  const isCritical = top.postureLevel === 'critical';

  if (!state.el) {
    state.el = document.createElement('div');
    state.el.className = 'critical-posture-banner';
    const header = document.querySelector('.header');
    if (header) header.insertAdjacentElement('afterend', state.el);
  }

  document.body.classList.add('has-critical-banner');
  state.el.className = `critical-posture-banner ${isCritical ? 'severity-critical' : 'severity-elevated'}`;
  setTrustedHtml(state.el, trustedHtml(`
    <div class="banner-content">
      <span class="banner-icon">${isCritical ? '🚨' : '⚠️'}</span>
      <span class="banner-headline">${escapeHtml(top.headline)}</span>
      <span class="banner-stats">${top.totalAircraft} aircraft • ${escapeHtml(top.summary)}</span>
      ${top.strikeCapable ? '<span class="banner-strike">STRIKE CAPABLE</span>' : ''}
    </div>
    <button class="banner-view" data-lat="${top.centerLat}" data-lon="${top.centerLon}">View Region</button>
    <button class="banner-dismiss">×</button>
  `, "legacy direct innerHTML migration"));

  state.el.querySelector('.banner-view')?.addEventListener('click', () => {
    console.log('[Banner] View Region clicked:', top.theaterId, 'lat:', top.centerLat, 'lon:', top.centerLon);
    trackCriticalBannerAction('view', top.theaterId);
    if (typeof top.centerLat === 'number' && typeof top.centerLon === 'number') {
      if (isMobile) window.dispatchEvent(new CustomEvent('wm:reveal-mobile-map'));
      setMapCenter(top.centerLat, top.centerLon, 4);
    } else {
      console.error('[Banner] Missing coordinates for', top.theaterId);
    }
  });

  state.el.querySelector('.banner-dismiss')?.addEventListener('click', () => {
    trackCriticalBannerAction('dismiss', top.theaterId);
    state.el?.classList.add('dismissed');
    document.body.classList.remove('has-critical-banner');
    writeSessionStorageValue('banner-dismissed', Date.now().toString());
  });
}
