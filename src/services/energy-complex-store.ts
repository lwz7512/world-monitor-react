import type { OilAnalytics, CrudeInventoryWeek, NatGasStorageWeek, GetEuGasStorageResponse, GetOilStocksAnalysisResponse, LngVulnerabilityData } from '@/services/economic';
import type { MarketData } from '@/types';

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

export const energyAnalyticsChannel = makeChannel<OilAnalytics | null>(null);
export const energyTapeChannel = makeChannel<MarketData[]>([]);
export const energyCrudeWeeksChannel = makeChannel<CrudeInventoryWeek[]>([]);
export const energyNatGasChannel = makeChannel<NatGasStorageWeek[]>([]);
export const energyEuGasChannel = makeChannel<GetEuGasStorageResponse | null>(null);
export const energyOilStocksChannel = makeChannel<GetOilStocksAnalysisResponse | null>(null);
export const energyLngVulnerabilityChannel = makeChannel<LngVulnerabilityData | null>(null);
export const energyRetryMessageChannel = makeChannel<string | null>(null);

export const setEnergyAnalytics = (d: OilAnalytics): void => energyAnalyticsChannel.set(d);
export const setEnergyTape = (d: MarketData[]): void => energyTapeChannel.set(d);
export const setEnergyCrudeWeeks = (d: CrudeInventoryWeek[]): void => energyCrudeWeeksChannel.set(d);
export const setEnergyNatGas = (d: NatGasStorageWeek[]): void => energyNatGasChannel.set(d);
export const setEnergyEuGas = (d: GetEuGasStorageResponse): void => energyEuGasChannel.set(d.unavailable ? null : d);
export const setEnergyOilStocks = (d: GetOilStocksAnalysisResponse): void => energyOilStocksChannel.set(d.unavailable ? null : d);
export const setEnergyLngVulnerability = (d: LngVulnerabilityData | null): void => energyLngVulnerabilityChannel.set(d?.top20LngDependent?.length ? d : null);
export const setEnergyRetrying = (message: string | null): void => energyRetryMessageChannel.set(message);
