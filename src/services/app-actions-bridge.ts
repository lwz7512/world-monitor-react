/**
 * Singleton bridge: lets App.ts publish its EventHandlerCallbacks to React hooks
 * without requiring a shared React root.
 *
 * Usage:
 *   - App.ts calls publishAppActions(callbacks) once after constructing EventHandlerManager
 *   - Hooks inside useEffect call getPublishedAppActions() — safe because actions are
 *     published before publishAppContext fires, so ctx-gated effects always see them
 */
import type { EventHandlerCallbacks } from '@/app/event-handlers';

let _actions: EventHandlerCallbacks | null = null;

export function publishAppActions(actions: EventHandlerCallbacks): void {
  _actions = actions;
}

/**
 * Returns the published actions, or null if App.ts has not yet constructed
 * EventHandlerManager. In practice, this is never null inside a [ctx]-gated
 * useEffect because actions are published before publishAppContext.
 */
export function getPublishedAppActions(): EventHandlerCallbacks | null {
  return _actions;
}

/** For use in App.destroy() — clears the bridge so a re-init starts clean. */
export function clearAppActionsBridge(): void {
  _actions = null;
}
