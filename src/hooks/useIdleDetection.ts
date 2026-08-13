import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { IDLE_PAUSE_MS } from '@/config';

export function useIdleDetection(): void {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx) return;
    const c = ctx;
    const timerRef = { current: null as ReturnType<typeof setTimeout> | null };

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!document.hidden) {
          c.isIdle = true;
          document.body?.classList.add('animations-paused');
          console.log('[App] User idle - pausing animations to save resources');
        }
      }, IDLE_PAUSE_MS);
    }

    function onActivity() {
      if (c.isIdle) {
        c.isIdle = false;
        document.body?.classList.remove('animations-paused');
      }
      resetTimer();
    }

    function onResetEvent() { resetTimer(); }

    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'] as const;
    activityEvents.forEach(ev => document.addEventListener(ev, onActivity, { passive: true }));
    document.addEventListener('wm:reset-idle-timer', onResetEvent);
    resetTimer();

    return () => {
      activityEvents.forEach(ev => document.removeEventListener(ev, onActivity));
      document.removeEventListener('wm:reset-idle-timer', onResetEvent);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [ctx]);
}
