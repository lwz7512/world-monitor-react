import type { StockAnalysisResult } from '@/services/stock-analysis';
import type { StockAnalysisHistory } from '@/services/stock-analysis-history';
import type { InsiderTransactionsResult } from '@/services/insider-transactions';

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

export type StockAnalysisState = { state: 'idle' | 'ok' | 'retrying' | 'error'; message: string | null };

export const stockAnalysisItemsChannel = makeChannel<StockAnalysisResult[]>([]);
export const stockAnalysisHistoryChannel = makeChannel<StockAnalysisHistory>({});
export const stockAnalysisInsiderChannel = makeChannel<Record<string, InsiderTransactionsResult>>({});
export const stockAnalysisSourceChannel = makeChannel<'live' | 'cached'>('live');
export const stockAnalysisStateChannel = makeChannel<StockAnalysisState>({ state: 'idle', message: null });

export const setStockAnalysisItems = (items: StockAnalysisResult[], history: StockAnalysisHistory, source: 'live' | 'cached' = 'live'): void => {
  if (items.length === 0) {
    stockAnalysisStateChannel.set({ state: 'retrying', message: 'No premium stock analyses available yet.' });
    return;
  }
  stockAnalysisItemsChannel.set(items);
  stockAnalysisHistoryChannel.set(history);
  stockAnalysisSourceChannel.set(source);
  stockAnalysisStateChannel.set({ state: 'ok', message: null });
};

export const setStockAnalysisInsider = (symbol: string, data: InsiderTransactionsResult): void => {
  stockAnalysisInsiderChannel.set({ ...stockAnalysisInsiderChannel.get(), [symbol]: data });
};

export const setStockAnalysisState = (state: StockAnalysisState['state'], message: string | null = null): void => {
  stockAnalysisStateChannel.set({ state, message });
};
