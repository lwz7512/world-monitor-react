import type { GeoHubActivity } from '@/services/geo-activity';

let _activities: GeoHubActivity[] = [];
const _subscribers = new Set<(activities: GeoHubActivity[]) => void>();

export function setGeoHubActivities(activities: GeoHubActivity[]): void {
  _activities = activities;
  for (const sub of _subscribers) sub(_activities);
}

export function getGeoHubActivities(): GeoHubActivity[] {
  return _activities;
}

export function subscribeGeoHubActivities(cb: (activities: GeoHubActivity[]) => void): () => void {
  _subscribers.add(cb);
  return () => { _subscribers.delete(cb); };
}
