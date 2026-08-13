import { installSwUpdateHandler } from '@/bootstrap/sw-update';

function readStorageNum(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeStorageNum(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

/**
 * Registers the PWA service worker and wires its periodic update-check poll
 * plus the update-available toast (installSwUpdateHandler). Skipped inside
 * Tauri — desktop builds don't run a service worker.
 */
export function installServiceWorkerRegistration(version: string): void {
  if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) return;
  if (!('serviceWorker' in navigator)) return;

  installSwUpdateHandler({ version });

  const SW_UPDATE_SUCCESS_INTERVAL_MS = 60 * 60 * 1000;
  const SW_UPDATE_FAILURE_INTERVAL_MS = 5 * 60 * 1000;
  const SW_UPDATE_LAST_CHECK_KEY = 'wm-sw-last-update-check';
  const SW_UPDATE_LAST_RESULT_KEY = 'wm-sw-last-update-ok';

  navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then((registration) => {
      console.log('[PWA] Service worker registered');

      let swUpdateInFlight = false;

      const maybeCheckForSwUpdate = async (
        reason: 'initial' | 'visible' | 'online' | 'interval'
      ): Promise<void> => {
        if (swUpdateInFlight) return;
        if (!navigator.onLine) return;
        if (reason === 'interval' && document.visibilityState !== 'visible') return;

        const now = Date.now();
        const lastCheck = readStorageNum(SW_UPDATE_LAST_CHECK_KEY);
        const lastOk = readStorageNum(SW_UPDATE_LAST_RESULT_KEY);
        const interval = lastOk >= lastCheck ? SW_UPDATE_SUCCESS_INTERVAL_MS : SW_UPDATE_FAILURE_INTERVAL_MS;
        if (now - lastCheck < interval) return;

        swUpdateInFlight = true;
        writeStorageNum(SW_UPDATE_LAST_CHECK_KEY, now);
        try {
          await registration.update();
          writeStorageNum(SW_UPDATE_LAST_RESULT_KEY, now);
        } catch (e) {
          console.warn('[PWA] SW update check failed:', e);
        } finally {
          swUpdateInFlight = false;
        }
      };

      void maybeCheckForSwUpdate('initial');

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void maybeCheckForSwUpdate('visible');
        }
      });

      window.addEventListener('online', () => {
        void maybeCheckForSwUpdate('online');
      });

      const swUpdateInterval = window.setInterval(() => {
        void maybeCheckForSwUpdate('interval');
      }, 15 * 60 * 1000);

      (window as unknown as Record<string, unknown>).__swUpdateInterval = swUpdateInterval;
    })
    .catch((err) => {
      console.warn('[PWA] Service worker registration failed:', err);
    });
}
