import type {
  GetTradeRestrictionsResponse,
  GetTariffTrendsResponse,
  GetTradeFlowsResponse,
  GetTradeBarriersResponse,
  GetCustomsRevenueResponse,
  ListComtradeFlowsResponse,
} from '@/services/trade';

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

export const tradePolicyRestrictionsChannel = makeChannel<GetTradeRestrictionsResponse | null>(null);
export const tradePolicyTariffsChannel = makeChannel<GetTariffTrendsResponse | null>(null);
export const tradePolicyFlowsChannel = makeChannel<GetTradeFlowsResponse | null>(null);
export const tradePolicyBarriersChannel = makeChannel<GetTradeBarriersResponse | null>(null);
export const tradePolicyRevenueChannel = makeChannel<GetCustomsRevenueResponse | null>(null);
export const tradePolicyComtradeChannel = makeChannel<ListComtradeFlowsResponse | null>(null);

export const setTradePolicyRestrictions = (d: GetTradeRestrictionsResponse): void => tradePolicyRestrictionsChannel.set(d);
export const setTradePolicyTariffs = (d: GetTariffTrendsResponse): void => tradePolicyTariffsChannel.set(d);
export const setTradePolicyFlows = (d: GetTradeFlowsResponse): void => tradePolicyFlowsChannel.set(d);
export const setTradePolicyBarriers = (d: GetTradeBarriersResponse): void => tradePolicyBarriersChannel.set(d);
export const setTradePolicyRevenue = (d: GetCustomsRevenueResponse): void => tradePolicyRevenueChannel.set(d);
export const setTradePolicyComtrade = (d: ListComtradeFlowsResponse): void => tradePolicyComtradeChannel.set(d);
