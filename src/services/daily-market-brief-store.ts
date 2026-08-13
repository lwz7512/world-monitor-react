import type { DailyMarketBrief } from '@/services/daily-market-brief';

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

export type BriefPanelState =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | { kind: 'ok'; brief: DailyMarketBrief; source: 'live' | 'cached' }
  | { kind: 'error'; message: string };

export const dailyBriefStateChannel = makeChannel<BriefPanelState>({ kind: 'idle' });

export const setDailyBriefData = (brief: DailyMarketBrief, source: 'live' | 'cached' = 'live'): void => {
  dailyBriefStateChannel.set({ kind: 'ok', brief, source });
};

export const setDailyBriefLoading = (message = 'Building daily market brief...'): void => {
  dailyBriefStateChannel.set({ kind: 'loading', message });
};

export const setDailyBriefError = (message: string): void => {
  dailyBriefStateChannel.set({ kind: 'error', message });
};

export const setDailyBriefUnavailable = (message = 'The daily brief needs live market data before it can be generated.'): void => {
  dailyBriefStateChannel.set({ kind: 'error', message });
};
