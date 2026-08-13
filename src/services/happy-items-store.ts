import type { NewsItem } from '@/types';

interface HappyPanelItems {
  /** Curated RSS items (tagged with happyCategory) — used by breakthroughs, spotlight, digest. */
  curatedItems: NewsItem[];
  /** Curated + GDELT-supplementary merged — used by positive-feed. */
  feedItems: NewsItem[];
}

let _data: HappyPanelItems = { curatedItems: [], feedItems: [] };
const _subscribers = new Set<(data: HappyPanelItems) => void>();

export function setHappyPanelData(data: HappyPanelItems): void {
  _data = data;
  for (const cb of _subscribers) cb(data);
}

export function getHappyPanelData(): HappyPanelItems {
  return _data;
}

export function subscribeHappyPanelData(cb: (data: HappyPanelItems) => void): () => void {
  _subscribers.add(cb);
  return () => { _subscribers.delete(cb); };
}
