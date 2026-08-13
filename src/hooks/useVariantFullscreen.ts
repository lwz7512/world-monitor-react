import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { SITE_VARIANT } from '@/config';
import { VARIANT_META } from '@/config/variant-meta';
import { trackVariantSwitch } from '@/services/analytics';

function writeStorageValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // UI preferences remain in memory for the current page.
  }
}

export function useVariantFullscreen(): void {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx) return;
    const c = ctx;

    type FullscreenDoc = Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };

    function getFullscreenDocument(): FullscreenDoc {
      return document as FullscreenDoc;
    }

    function syncMapAfterLayoutChange(delayMs = 320): void {
      const sync = () => {
        c.map?.setIsResizing(false);
        c.map?.resize();
      };
      requestAnimationFrame(sync);
      window.setTimeout(sync, delayMs);
    }

    async function exitFullscreenForNavigation(): Promise<void> {
      const doc = getFullscreenDocument();
      if (!doc.fullscreenElement && !doc.webkitFullscreenElement) return;
      try {
        if (typeof doc.exitFullscreen === 'function') {
          await doc.exitFullscreen();
          return;
        }
        await doc.webkitExitFullscreen?.();
      } catch { /* proceed with navigation regardless */ }
    }

    async function navigateToVariant(
      variant: string,
      options: { href?: string; isLocalDev: boolean },
    ): Promise<void> {
      trackVariantSwitch(SITE_VARIANT, variant);
      await exitFullscreenForNavigation();

      if (c.isDesktopApp || options.isLocalDev) {
        writeStorageValue('worldmonitor-variant', variant);
        window.location.reload();
        return;
      }

      const target = options.href || VARIANT_META[variant]?.url;
      if (!target) return;
      try {
        const parsed = new URL(target, window.location.href);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
        window.location.href = parsed.toString();
      } catch {
        return;
      }
    }

    function toggleFullscreen(): void {
      const doc = getFullscreenDocument();
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        try {
          const exitResult = typeof doc.exitFullscreen === 'function'
            ? doc.exitFullscreen()
            : doc.webkitExitFullscreen?.();
          void Promise.resolve(exitResult).catch(() => { });
        } catch { }
      } else {
        const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
        if (el.requestFullscreen) {
          try { void el.requestFullscreen()?.catch(() => { }); } catch { }
        } else if (el.webkitRequestFullscreen) {
          try { el.webkitRequestFullscreen(); } catch { }
        }
      }
    }

    // Variant option links in header/nav
    const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    c.container.querySelectorAll<HTMLAnchorElement>('.variant-option').forEach(link => {
      link.addEventListener('click', (e) => {
        const variant = link.dataset.variant;
        if (!variant || variant === SITE_VARIANT) return;
        e.preventDefault();
        void navigateToVariant(variant, { href: link.href, isLocalDev });
      });
    });

    // Fullscreen button
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    let onFullscreenChange: (() => void) | null = null;
    const onFullscreenClick = () => toggleFullscreen();

    if (!c.isDesktopApp && fullscreenBtn) {
      fullscreenBtn.addEventListener('click', onFullscreenClick);
      onFullscreenChange = () => {
        fullscreenBtn.classList.toggle('active', !!document.fullscreenElement);
        syncMapAfterLayoutChange();
      };
      document.addEventListener('fullscreenchange', onFullscreenChange);
    }

    // Bridge for imperative calls (e.g. from MobilePrimaryNav variant callbacks)
    function onNavigateEvent(e: Event): void {
      const { variant, options } = (e as CustomEvent<{ variant: string; options: { href?: string; isLocalDev: boolean } }>).detail;
      void navigateToVariant(variant, options);
    }
    function onToggleFullscreenEvent(): void {
      toggleFullscreen();
    }

    document.addEventListener('wm:navigate-to-variant', onNavigateEvent);
    document.addEventListener('wm:toggle-fullscreen', onToggleFullscreenEvent);

    return () => {
      if (fullscreenBtn) fullscreenBtn.removeEventListener('click', onFullscreenClick);
      if (onFullscreenChange) document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('wm:navigate-to-variant', onNavigateEvent);
      document.removeEventListener('wm:toggle-fullscreen', onToggleFullscreenEvent);
    };
  }, [ctx]);
}
