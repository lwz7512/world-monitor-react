import type { FredSeries, BisData } from '@/services/economic';
import type { SpendingSummary } from '@/services/usa-spending';
import type { GetEconomicStressResponse } from '@/generated/client/worldmonitor/economic/v1/service_client';

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

export type FredLoadState = 'loading' | 'ok' | 'error' | 'retrying';
export type FredState = { state: FredLoadState; errorMsg: string };

export const economicFredDataChannel = makeChannel<FredSeries[]>([]);
export const economicFredStateChannel = makeChannel<FredState>({ state: 'loading', errorMsg: '' });
export const economicLastUpdateChannel = makeChannel<string | null>(null);
export const economicBisChannel = makeChannel<BisData | null>(null);
export const economicBlsChannel = makeChannel<FredSeries[]>([]);
export const economicSpendingChannel = makeChannel<SpendingSummary | null>(null);
export const economicStressChannel = makeChannel<GetEconomicStressResponse | null>(null);

function notifyIfStressCrossed(score: number): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const level = score >= 85 ? 2 : score >= 70 ? 1 : 0;
  if (level === 0) return;
  try {
    const key = 'wm:economic-stress:last-notified-level';
    const lastLevel = parseInt(sessionStorage.getItem(key) ?? '0', 10);
    if (level <= lastLevel) return;
    sessionStorage.setItem(key, String(level));
    new Notification('Economic Stress Alert', {
      body: `Composite stress index reached ${score.toFixed(1)} (${score >= 85 ? 'Critical' : 'Severe'})`,
      icon: '/favico/favicon-32x32.png',
      tag: 'economic-stress',
    });
  } catch { /* Notification API can throw in some environments */ }
}

export const setEconomicFredData = (data: FredSeries[]): void => {
  economicFredDataChannel.set(data);
  economicFredStateChannel.set({ state: 'ok', errorMsg: '' });
  economicLastUpdateChannel.set(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
};
export const setEconomicFredLoading = (): void => economicFredStateChannel.set({ state: 'loading', errorMsg: '' });
export const setEconomicFredError = (msg: string): void => economicFredStateChannel.set({ state: 'error', errorMsg: msg });
export const setEconomicFredRetrying = (remainingSeconds?: number): void =>
  economicFredStateChannel.set({
    state: 'retrying',
    errorMsg: remainingSeconds !== undefined ? `Retrying (${remainingSeconds}s)` : 'Retrying…',
  });

export const setEconomicBis = (data: BisData): void => economicBisChannel.set(data);
export const setEconomicBls = (data: FredSeries[]): void => economicBlsChannel.set(data);
export const setEconomicSpending = (data: SpendingSummary): void => economicSpendingChannel.set(data);
export const setEconomicStress = (data: GetEconomicStressResponse): void => {
  if (Number.isFinite(data.compositeScore)) notifyIfStressCrossed(data.compositeScore);
  economicStressChannel.set(data);
};
