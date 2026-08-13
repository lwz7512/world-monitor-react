import type { ListGlobalTendersResponse, GlobalTender } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { GlobalTenderFilters } from '@/services/global-tenders';

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

export type { GlobalTender };

export const globalProcurementDataChannel = makeChannel<ListGlobalTendersResponse | null>(null);
export const globalProcurementLoadingChannel = makeChannel<boolean>(false);
export const globalProcurementErrorChannel = makeChannel<string | null>(null);

let _onRequest: ((filters: GlobalTenderFilters, append: boolean) => void) | null = null;
export const registerGlobalProcurementHandler = (fn: (filters: GlobalTenderFilters, append: boolean) => void): void => { _onRequest = fn; };
export const globalProcurementRequest = (filters: GlobalTenderFilters, append: boolean): void => { _onRequest?.(filters, append); };

export const setGlobalProcurementLoading = (loading: boolean): void => globalProcurementLoadingChannel.set(loading);

export const updateGlobalProcurement = (newData: ListGlobalTendersResponse, append: boolean): void => {
  globalProcurementErrorChannel.set(null);
  globalProcurementLoadingChannel.set(false);
  if (append) {
    const current = globalProcurementDataChannel.get();
    if (current) {
      const merged = new Map(current.tenders.map(t => [t.id, t]));
      newData.tenders.forEach(t => merged.set(t.id, t));
      globalProcurementDataChannel.set({ ...newData, tenders: [...merged.values()] });
    } else {
      globalProcurementDataChannel.set(newData);
    }
  } else {
    globalProcurementDataChannel.set(newData);
  }
};

export const clearGlobalProcurement = (): void => {
  globalProcurementDataChannel.set(null);
  globalProcurementLoadingChannel.set(false);
  globalProcurementErrorChannel.set(null);
};

export const showGlobalProcurementUnavailable = (): void => {
  globalProcurementLoadingChannel.set(false);
  globalProcurementDataChannel.set(null);
  globalProcurementErrorChannel.set('Procurement opportunities are currently unavailable.');
};
