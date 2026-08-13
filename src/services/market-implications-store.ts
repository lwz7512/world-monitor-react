import type { MarketImplicationsData } from '@/services/market-implications';

type StoreState = MarketImplicationsData | null | undefined;

let _state: StoreState = undefined;
const _subscribers = new Set<(state: StoreState) => void>();

export function setMarketImplicationsData(data: MarketImplicationsData | null): void {
  _state = data;
  for (const sub of _subscribers) sub(_state);
}

export function getMarketImplicationsState(): StoreState {
  return _state;
}

export function subscribeMarketImplications(cb: (state: StoreState) => void): () => void {
  _subscribers.add(cb);
  return () => { _subscribers.delete(cb); };
}
