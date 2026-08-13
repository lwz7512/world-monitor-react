import type { StockBacktestResult } from '@/services/stock-backtest';

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

export type StockBacktestState = { state: 'idle' | 'ok' | 'retrying' | 'error'; message: string | null };

export const stockBacktestItemsChannel = makeChannel<StockBacktestResult[]>([]);
export const stockBacktestSourceChannel = makeChannel<'live' | 'cached'>('live');
export const stockBacktestStateChannel = makeChannel<StockBacktestState>({ state: 'idle', message: null });

export const setStockBacktestItems = (items: StockBacktestResult[], source: 'live' | 'cached' = 'live'): void => {
  if (items.length === 0) {
    stockBacktestStateChannel.set({ state: 'retrying', message: 'No stock backtests available yet.' });
    return;
  }
  stockBacktestItemsChannel.set(items);
  stockBacktestSourceChannel.set(source);
  stockBacktestStateChannel.set({ state: 'ok', message: null });
};

export const setStockBacktestState = (state: StockBacktestState['state'], message: string | null = null): void => {
  stockBacktestStateChannel.set({ state, message });
};
