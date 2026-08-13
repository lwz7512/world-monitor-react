import type { MarketData } from '@/types';
import type { ChinaCorporateDisclosureSnapshot } from '@/components/market-disclosures';

type Listener<T> = (data: T) => void;

function makeChannel<T>(initial: T) {
  let _data = initial;
  const _subs = new Set<Listener<T>>();
  return {
    set(data: T): void { _data = data; for (const sub of _subs) sub(_data); },
    get(): T { return _data; },
    subscribe(cb: Listener<T>): () => void { _subs.add(cb); return () => { _subs.delete(cb); }; },
  };
}

export type MarketsState =
  | { kind: 'idle' }
  | { kind: 'retrying'; message: string }
  | { kind: 'configError'; message: string }
  | { kind: 'ok' };

export const marketsDataChannel = makeChannel<MarketData[]>([]);
export const marketsDisclosuresChannel = makeChannel<ChinaCorporateDisclosureSnapshot | null>(null);
export const marketsStateChannel = makeChannel<MarketsState>({ kind: 'idle' });
export const marketsRateLimitedChannel = makeChannel<boolean>(false);

export const setMarketsData = (data: MarketData[], rateLimited?: boolean): void => {
  marketsDataChannel.set(data);
  marketsRateLimitedChannel.set(Boolean(rateLimited));
  marketsStateChannel.set({ kind: 'ok' });
};

export const setMarketsDisclosures = (snapshot: ChinaCorporateDisclosureSnapshot | null | undefined): void => {
  marketsDisclosuresChannel.set(snapshot ?? null);
};

export const setMarketsRetrying = (message: string): void => {
  marketsStateChannel.set({ kind: 'retrying', message });
};

export const setMarketsConfigError = (message: string): void => {
  marketsStateChannel.set({ kind: 'configError', message });
};
