import { useEffect, useRef } from 'react';
import { startSmartPollLoop } from '@/services/runtime';

export interface ScheduledRefreshOptions {
  /** If provided, the poll only fires when this returns true. */
  condition?: () => boolean;
  /** Trigger one immediate run before the first interval. Default false. */
  runImmediately?: boolean;
}

/**
 * Schedule a recurring async task that pauses when the tab is hidden.
 *
 * Equivalent to React's `useEffect(() => { const id = setInterval(...); return clearInterval(id); }, [...])`
 * but visibility-aware (uses SmartPollLoop under the hood, same as RefreshScheduler).
 *
 * The `fn` reference is stable — updated on every render without restarting the loop.
 */
export function useScheduledRefresh(
  fn: () => Promise<void>,
  intervalMs: number,
  opts: ScheduledRefreshOptions = {},
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const conditionRef = useRef(opts.condition);
  conditionRef.current = opts.condition;

  useEffect(() => {
    const loop = startSmartPollLoop(
      async () => {
        if (conditionRef.current && !conditionRef.current()) return;
        return fnRef.current();
      },
      {
        intervalMs,
        pauseWhenHidden: true,
        refreshOnVisible: false,
        runImmediately: opts.runImmediately ?? false,
        maxBackoffMultiplier: 4,
      },
    );
    return () => loop.stop();
  // intervalMs and runImmediately are construction-time — changing them restarts the loop.
  // condition and fn are read via refs so they don't restart.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, opts.runImmediately]);
}
