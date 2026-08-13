/**
 * Singleton bridge: lets the imperative App class publish its AppContext
 * to the React component tree without requiring a shared React root.
 *
 * Usage:
 *   - App.ts calls publishAppContext(this.state) once after UI init
 *   - AppContextProvider subscribes via subscribeAppContext(setCtx)
 *   - Any module outside React can read getPublishedAppContext()
 */
import type { AppContext } from '@/app/app-context';

type Listener = (ctx: AppContext) => void;

let _ctx: AppContext | null = null;
const _listeners = new Set<Listener>();

export function publishAppContext(ctx: AppContext): void {
  _ctx = ctx;
  for (const fn of _listeners) fn(ctx);
}

/**
 * Subscribe to app context updates. If the context has already been published,
 * the callback fires immediately (synchronously) on subscription.
 * Returns an unsubscribe function.
 */
export function subscribeAppContext(fn: Listener): () => void {
  if (_ctx) fn(_ctx);
  _listeners.add(fn);
  return () => void _listeners.delete(fn);
}

export function getPublishedAppContext(): AppContext | null {
  return _ctx;
}

/**
 * Re-notify all React listeners that ctx has been mutated.
 *
 * Call this after any in-place mutation of ctx that React components should
 * react to — e.g. after a new panel mounts (ctx.panels updated) or after
 * applyPanelSettings() toggles ctx.panelSettings.enabled.
 */
export function refreshAppContext(): void {
  if (!_ctx) return;
  for (const fn of _listeners) fn(_ctx);
}

/** For use in App.destroy() — clears the bridge so a re-init starts clean. */
export function clearAppContextBridge(): void {
  _ctx = null;
}
