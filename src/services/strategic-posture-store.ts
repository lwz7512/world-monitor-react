import type { CachedTheaterPosture } from '@/services/cached-theater-posture';
import type { TheaterPostureSummary } from '@/services/military-surge';

let _data: CachedTheaterPosture | null = null;
let _postures: TheaterPostureSummary[] = [];
const _subs = new Set<(data: CachedTheaterPosture) => void>();

export function setPostureData(data: CachedTheaterPosture): void {
  _data = data;
  for (const sub of _subs) sub(_data);
}

export function getPostureState(): CachedTheaterPosture | null { return _data; }

export function subscribePostureData(cb: (data: CachedTheaterPosture) => void): () => void {
  _subs.add(cb);
  return () => { _subs.delete(cb); };
}

export function setPostures(postures: TheaterPostureSummary[]): void {
  _postures = postures;
}

export function getPostures(): TheaterPostureSummary[] { return _postures; }
