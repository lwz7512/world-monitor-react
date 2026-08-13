import type { UnhcrSummary } from '@/services/displacement';

type DisplacementState = UnhcrSummary | null | undefined;

let _state: DisplacementState = undefined;
const _subs = new Set<(state: DisplacementState) => void>();

export function setDisplacementData(data: UnhcrSummary): void {
  _state = data;
  for (const sub of _subs) sub(_state);
}

export function setDisplacementError(): void {
  _state = null;
  for (const sub of _subs) sub(_state);
}

export function getDisplacementState(): DisplacementState { return _state; }

export function subscribeDisplacementData(cb: (state: DisplacementState) => void): () => void {
  _subs.add(cb);
  return () => { _subs.delete(cb); };
}
