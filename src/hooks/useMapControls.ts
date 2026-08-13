import { useEffect } from 'react';
import { saveToStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { useAppContextMaybe } from '@/context/AppContext';

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* preferences kept in memory */ }
}
function removeStorage(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ok */ }
}

function syncMap(ctx: NonNullable<ReturnType<typeof useAppContextMaybe>>, delayMs = 320): void {
  const sync = () => { ctx.map?.setIsResizing(false); ctx.map?.resize(); };
  requestAnimationFrame(sync);
  window.setTimeout(sync, delayMs);
}

export function useMapControls(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;

    // ── Height resize ──────────────────────────────────────────────────────
    const mapSection = document.getElementById('mapSection');
    const mapContainer = document.getElementById('mapContainer');
    const resizeHandle = document.getElementById('mapResizeHandle');

    let endHeightResize: (() => void) | null = null;
    let onHeightMove: ((e: MouseEvent) => void) | null = null;
    let onHeightVisChange: (() => void) | null = null;

    if (mapSection && mapContainer && resizeHandle) {
      const getMinH = () => (window.innerWidth >= 1600 ? 280 : 350);
      const getMaxH = () => {
        if (window.innerWidth < 1600) return Math.max(getMinH(), window.innerHeight - 150);
        const bottomGrid = document.getElementById('mapBottomGrid');
        const empty = !bottomGrid || bottomGrid.children.length === 0;
        return window.innerHeight - 60 - (empty ? 25 : 300);
      };
      const getTarget = () => (window.innerWidth >= 1600 ? mapContainer : mapSection);

      const saved = readStorage('map-height');
      if (saved) {
        const n = Number.parseInt(saved, 10);
        if (Number.isFinite(n)) {
          const clamped = Math.max(getMinH(), Math.min(n, getMaxH()));
          if (window.innerWidth >= 1600) { mapContainer.style.flex = 'none'; mapContainer.style.height = `${clamped}px`; }
          else { mapSection.style.height = `${clamped}px`; }
          if (clamped !== n) writeStorage('map-height', `${clamped}px`);
        } else {
          removeStorage('map-height');
        }
      }

      let isResizing = false;
      let startY = 0;
      let startHeight = 0;

      endHeightResize = () => {
        if (!isResizing) return;
        isResizing = false;
        ctx.map?.setIsResizing(false);
        ctx.map?.resize();
        mapSection.classList.remove('resizing');
        document.body.style.cursor = '';
        writeStorage('map-height', getTarget().style.height);
      };

      resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = getTarget().offsetHeight;
        ctx.map?.setIsResizing(true);
        mapSection.classList.add('resizing');
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
      });

      resizeHandle.addEventListener('dblclick', () => {
        const isWide = window.innerWidth >= 1600;
        const target = getTarget();
        const finalH = Math.max(getMinH(), Math.min(window.innerHeight * 0.5, getMaxH()));
        ctx.map?.setIsResizing(true);
        target.classList.add('map-section-smooth');
        if (isWide) target.style.flex = 'none';
        target.style.height = `${finalH}px`;
        let fired = false;
        const onEnd = () => {
          if (fired) return;
          fired = true;
          target.classList.remove('map-section-smooth');
          target.removeEventListener('transitionend', onEnd);
          writeStorage('map-height', `${finalH}px`);
          ctx.map?.setIsResizing(false);
          ctx.map?.resize();
        };
        target.addEventListener('transitionend', onEnd);
        ctx.map?.resize();
        setTimeout(onEnd, 500);
      });

      onHeightMove = (e: MouseEvent) => {
        if (!isResizing) return;
        const isWide = window.innerWidth >= 1600;
        const target = getTarget();
        const newH = Math.max(getMinH(), Math.min(startHeight + (e.clientY - startY), getMaxH()));
        if (isWide) target.style.flex = 'none';
        target.style.height = `${newH}px`;
        ctx.map?.resize();
      };

      onHeightVisChange = () => { if (document.hidden) endHeightResize?.(); };

      document.addEventListener('mousemove', onHeightMove);
      document.addEventListener('mouseup', endHeightResize);
      window.addEventListener('blur', endHeightResize);
      document.addEventListener('visibilitychange', onHeightVisChange);
    }

    // ── Width resize ───────────────────────────────────────────────────────
    const mainContent = document.querySelector<HTMLElement>('.main-content');
    const widthHandle = document.getElementById('mapWidthResizeHandle');

    let endWidthResize: (() => void) | null = null;
    let onWidthMove: ((e: MouseEvent) => void) | null = null;

    if (mainContent && widthHandle) {
      const savedW = readStorage('map-col-width');
      if (savedW) mainContent.style.setProperty('--map-col-width', savedW);

      let isResizingW = false;
      let startX = 0;
      let startTotalW = 0;
      let startColPx = 0;

      endWidthResize = () => {
        if (!isResizingW) return;
        isResizingW = false;
        ctx.map?.setIsResizing(false);
        ctx.map?.resize();
        document.body.classList.remove('map-width-resizing');
        widthHandle.classList.remove('resizing');
        const cur = mainContent.style.getPropertyValue('--map-col-width');
        if (cur) writeStorage('map-col-width', cur);
      };

      widthHandle.addEventListener('mousedown', (e) => {
        isResizingW = true;
        startX = e.clientX;
        startTotalW = mainContent.offsetWidth;
        const raw = mainContent.style.getPropertyValue('--map-col-width') || '60%';
        startColPx = startTotalW * (parseFloat(raw) / 100);
        ctx.map?.setIsResizing(true);
        document.body.classList.add('map-width-resizing');
        widthHandle.classList.add('resizing');
        e.preventDefault();
      });

      onWidthMove = (e: MouseEvent) => {
        if (!isResizingW) return;
        const newPct = Math.max(25, Math.min(75, ((startColPx + (e.clientX - startX)) / startTotalW) * 100));
        mainContent.style.setProperty('--map-col-width', `${newPct.toFixed(1)}%`);
        ctx.map?.resize();
      };

      document.addEventListener('mousemove', onWidthMove);
      document.addEventListener('mouseup', endWidthResize);
      window.addEventListener('blur', endWidthResize);
    }

    // ── Pin / fullscreen / dimension toggle ────────────────────────────────
    const pinSection = mapSection ?? document.getElementById('mapSection');
    const pinBtn = document.getElementById('mapPinBtn');
    let onFullscreenEsc: ((e: KeyboardEvent) => void) | null = null;

    if (pinSection && pinBtn) {
      const isPinned = readStorage('map-pinned') === 'true';
      if (isPinned) { pinSection.classList.add('pinned'); pinBtn.classList.add('active'); }

      pinBtn.addEventListener('click', () => {
        const nowPinned = pinSection.classList.toggle('pinned');
        pinBtn.classList.toggle('active', nowPinned);
        writeStorage('map-pinned', String(nowPinned));
      });

      // Fullscreen
      const fullBtn = document.getElementById('mapFullscreenBtn');
      if (fullBtn) {
        const expandSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
        const shrinkSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>';
        let isFullscreen = false;
        const toggleFullscreen = () => {
          isFullscreen = !isFullscreen;
          pinSection.classList.toggle('live-news-fullscreen', isFullscreen);
          document.body.classList.toggle('live-news-fullscreen-active', isFullscreen);
          setTrustedHtml(fullBtn, trustedHtml(isFullscreen ? shrinkSvg : expandSvg, 'legacy direct innerHTML migration'));
          fullBtn.title = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
          syncMap(ctx);
        };
        fullBtn.addEventListener('click', toggleFullscreen);
        onFullscreenEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && isFullscreen) toggleFullscreen(); };
        document.addEventListener('keydown', onFullscreenEsc);
      }
    }

    // Dimension toggle (flat ↔ globe)
    const dimToggle = document.getElementById('mapDimensionToggle');
    dimToggle?.querySelectorAll<HTMLButtonElement>('.map-dim-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (!mode) return;
        const isGlobe = mode === 'globe';
        if (isGlobe === (ctx.map?.isGlobeMode() ?? false)) return;
        dimToggle.querySelectorAll('.map-dim-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        saveToStorage(STORAGE_KEYS.mapMode, isGlobe ? 'globe' : 'flat');
        if (isGlobe) ctx.map?.switchToGlobe(); else ctx.map?.switchToFlat();
        if (ctx.mapLayers.resilienceScore && !ctx.map?.isDeckGLActive?.()) {
          ctx.mapLayers = { ...ctx.mapLayers, resilienceScore: false };
          saveToStorage(STORAGE_KEYS.mapLayers, ctx.mapLayers);
        }
      });
    });

    return () => {
      if (endHeightResize) {
        document.removeEventListener('mouseup', endHeightResize);
        window.removeEventListener('blur', endHeightResize);
      }
      if (onHeightMove) document.removeEventListener('mousemove', onHeightMove);
      if (onHeightVisChange) document.removeEventListener('visibilitychange', onHeightVisChange);
      if (endWidthResize) {
        document.removeEventListener('mouseup', endWidthResize);
        window.removeEventListener('blur', endWidthResize);
      }
      if (onWidthMove) document.removeEventListener('mousemove', onWidthMove);
      if (onFullscreenEsc) document.removeEventListener('keydown', onFullscreenEsc);
    };
  }, [ctx]);
}
