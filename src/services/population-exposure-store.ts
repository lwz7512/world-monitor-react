import type { PopulationExposure } from '@/types';

type PopulationExposureState = PopulationExposure[] | null | undefined;
// undefined = loading, null = error, PopulationExposure[] = data (may be empty)

let _state: PopulationExposureState = undefined;
const _subs = new Set<(state: PopulationExposureState) => void>();

export function setPopulationExposures(exposures: PopulationExposure[]): void {
  _state = exposures;
  for (const sub of _subs) sub(_state);
}

export function setPopulationExposureError(): void {
  _state = null;
  for (const sub of _subs) sub(_state);
}

export function getPopulationExposureState(): PopulationExposureState {
  return _state;
}

export function subscribePopulationExposures(cb: (state: PopulationExposureState) => void): () => void {
  _subs.add(cb);
  return () => { _subs.delete(cb); };
}
