import type { UcdpGeoEvent } from '@/types';
import type { UcdpTabAggregate } from '@/services/conflict';

export interface UcdpEventsData {
  events: UcdpGeoEvent[];
  aggregates?: Record<string, UcdpTabAggregate>;
}

let _data: UcdpEventsData = { events: [] };
const _subscribers = new Set<(data: UcdpEventsData) => void>();

export function setUcdpEventsData(data: UcdpEventsData): void {
  _data = data;
  for (const sub of _subscribers) sub(_data);
}

export function getUcdpEventsData(): UcdpEventsData {
  return _data;
}

export function subscribeUcdpEventsData(cb: (data: UcdpEventsData) => void): () => void {
  _subscribers.add(cb);
  return () => { _subscribers.delete(cb); };
}
