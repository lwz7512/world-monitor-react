import type { Monitor } from '@/types';

let _monitors: Monitor[] = [];
const _subs = new Set<(monitors: Monitor[]) => void>();

export function setMonitorItems(monitors: Monitor[]): void {
  _monitors = monitors;
  _subs.forEach((cb) => cb(monitors));
}

export function getMonitorItems(): Monitor[] {
  return _monitors;
}

export function subscribeMonitorItems(cb: (monitors: Monitor[]) => void): () => void {
  _subs.add(cb);
  return () => {
    _subs.delete(cb);
  };
}
