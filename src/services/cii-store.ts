import type { CountryScore } from '@/services/country-instability';
import type { CachedRiskScores } from '@/services/cached-risk-scores';
import { toCountryScore } from '@/services/cached-risk-scores';

type CiiState = { type: 'data'; cached: CachedRiskScores } | { type: 'unavailable' } | null;

let _state: CiiState = null;
const _subs = new Set<(state: CiiState) => void>();

export function setCiiData(cached: CachedRiskScores): void {
  _state = { type: 'data', cached };
  for (const sub of _subs) sub(_state);
}

export function setCiiUnavailable(): void {
  _state = { type: 'unavailable' };
  for (const sub of _subs) sub(_state);
}

export function getCiiState(): CiiState { return _state; }

export function subscribeCiiState(cb: (state: CiiState) => void): () => void {
  _subs.add(cb);
  return () => { _subs.delete(cb); };
}

export function getCiiScores(): CountryScore[] {
  if (_state?.type !== 'data') return [];
  return _state.cached.cii.map(toCountryScore).filter(s => s.score > 0);
}
