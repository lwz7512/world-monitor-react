import type { ClusteredEvent, MilitaryFlight } from '@/types';

export interface InsightsData {
  clusters: ClusteredEvent[];
  militaryFlights: MilitaryFlight[];
}

let _data: InsightsData = { clusters: [], militaryFlights: [] };
const _subs = new Set<(data: InsightsData) => void>();

export function setInsightsClusters(clusters: ClusteredEvent[]): void {
  _data = { ..._data, clusters };
  for (const sub of _subs) sub(_data);
}

export function setInsightsMilitaryFlights(flights: MilitaryFlight[]): void {
  _data = { ..._data, militaryFlights: flights };
  for (const sub of _subs) sub(_data);
}

export function getInsightsData(): InsightsData { return _data; }

export function subscribeInsightsData(cb: (data: InsightsData) => void): () => void {
  _subs.add(cb);
  return () => { _subs.delete(cb); };
}
