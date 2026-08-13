import type { TechHubActivity } from '@/services/tech-activity';

let _activities: TechHubActivity[] = [];
const _subscribers = new Set<(activities: TechHubActivity[]) => void>();

export function setTechHubActivities(activities: TechHubActivity[]): void {
  _activities = activities;
  for (const sub of _subscribers) sub(_activities);
}

export function getTechHubActivities(): TechHubActivity[] {
  return _activities;
}

export function subscribeTechHubActivities(cb: (activities: TechHubActivity[]) => void): () => void {
  _subscribers.add(cb);
  return () => { _subscribers.delete(cb); };
}
