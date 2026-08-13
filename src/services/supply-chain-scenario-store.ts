import type { ScenarioResult } from '@/config/scenario-templates';

export interface ActiveScenarioState { scenarioId: string; result: ScenarioResult }

type ScenarioState = ActiveScenarioState | null;

let _state: ScenarioState = null;
const _subs = new Set<(s: ScenarioState) => void>();

export function showScenario(state: ActiveScenarioState): void {
  _state = state;
  for (const sub of _subs) sub(_state);
}

export function hideScenario(): void {
  _state = null;
  for (const sub of _subs) sub(_state);
}

export function getScenarioState(): ScenarioState { return _state; }

export function subscribeScenarioState(cb: (s: ScenarioState) => void): () => void {
  _subs.add(cb);
  return () => { _subs.delete(cb); };
}
