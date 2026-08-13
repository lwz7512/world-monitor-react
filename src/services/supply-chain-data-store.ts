import type {
  GetShippingRatesResponse,
  GetChokepointStatusResponse,
  GetCriticalMineralsResponse,
  GetShippingStressResponse,
} from '@/generated/client/worldmonitor/supply_chain/v1/service_client';

type Listener<T> = (data: T) => void;

function makeChannel<T>() {
  let _data: T | null = null;
  const _subs = new Set<Listener<T>>();
  return {
    set(data: T): void { _data = data; for (const s of _subs) s(data); },
    get(): T | null { return _data; },
    subscribe(cb: Listener<T>): () => void { _subs.add(cb); return () => { _subs.delete(cb); }; },
  };
}

export const shippingRatesChannel = makeChannel<GetShippingRatesResponse>();
export const chokepointStatusChannel = makeChannel<GetChokepointStatusResponse>();
export const criticalMineralsChannel = makeChannel<GetCriticalMineralsResponse>();
export const shippingStressChannel = makeChannel<GetShippingStressResponse>();

export const setSupplyChainShipping = (d: GetShippingRatesResponse) => shippingRatesChannel.set(d);
export const setSupplyChainChokepoints = (d: GetChokepointStatusResponse) => chokepointStatusChannel.set(d);
export const setSupplyChainMinerals = (d: GetCriticalMineralsResponse) => criticalMineralsChannel.set(d);
export const setSupplyChainStress = (d: GetShippingStressResponse) => shippingStressChannel.set(d);
