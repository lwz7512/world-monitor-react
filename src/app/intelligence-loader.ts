import type { AppContext } from '@/app/app-context';
import { getSignalAggregator, type SignalAggregator } from '@/app/lazy-services';
import {
  getMilitaryVesselsModule,
  isVesselRuntimeStoppedError,
} from '@/services/military-vessels-lazy';
import type { MilitaryFlight } from '@/types';
import {
  fetchInternetOutages,
  fetchTrafficAnomalies,
  fetchDdosAttacks,
  fetchProtestEvents,
  getProtestStatus,
  fetchMilitaryFlights,
  fetchUSNIFleetReport,
  fetchCableHealth,
  fetchSanctionsPressure,
  fetchRadiationWatch,
} from '@/services';
import { dispatchOrefBreakingAlert } from '@/services/breaking-news-alerts';
import { ingestProtests, ingestFlights, ingestVessels } from '@/services/geo-convergence';
import { updateAndCheck } from '@/services/temporal-baseline';
import {
  ingestProtestsForCII,
  ingestMilitaryForCII,
  ingestOutagesForCII,
  ingestConflictsForCII,
  ingestUcdpForCII,
  ingestHapiForCII,
  ingestDisplacementForCII,
  ingestClimateForCII,
  ingestStrikesForCII,
  ingestOrefForCII,
  ingestAdvisoriesForCII,
  ingestGpsJammingForCII,
  ingestCyberThreatsForCII,
  ingestTemporalAnomaliesForCII,
  ingestSanctionsForCII,
  isInLearningMode,
  resetHotspotActivity,
} from '@/services/country-instability';
import { fetchGpsInterference } from '@/services/gps-interference';
import { dataFreshness, type DataSourceId } from '@/services/data-freshness';
import {
  fetchConflictEvents,
  fetchUcdpClassifications,
  fetchHapiSummary,
  fetchUcdpEvents,
  deduplicateAgainstAcled,
  deduplicateUcdpProjectionAggregates,
  fetchIranEvents,
} from '@/services/conflict';
import { fetchUnhcrPopulation } from '@/services/displacement';
import { fetchClimateAnomalies } from '@/services/climate';
import { fetchSecurityAdvisories } from '@/services/security-advisories';
import { fetchThermalEscalations } from '@/services/thermal-escalation';
import { fetchCrossSourceSignals } from '@/services/cross-source-signals';
import {
  fetchOrefAlerts,
  startOrefPolling,
  stopOrefPolling,
  onOrefAlertsUpdate,
} from '@/services/oref-alerts';
import { getResilienceRanking } from '@/services/resilience';
import { buildResilienceChoroplethMap } from '@/components/resilience-choropleth-utils';
import { enrichEventsWithExposure } from '@/services/population-exposure';
import {
  setPopulationExposures,
  setPopulationExposureError,
} from '@/services/population-exposure-store';
import { setDisplacementData } from '@/services/displacement-store';
import { setUcdpEventsData, getUcdpEventsData } from '@/services/ucdp-events-store';
import { hasPremiumAccess } from '@/services/panel-gating';
import { isDesktopRuntime } from '@/services/runtime';
import { getHydratedData } from '@/services/bootstrap';

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';
// Iran-events domain sunset (war ended 2026-07). Default OFF: no fetch, even the
// CII/risk-scoring path. Set VITE_ENABLE_IRAN_ATTACKS=true to restore. Mirrors CYBER_LAYER_ENABLED.
const IRAN_ATTACKS_ENABLED = import.meta.env.VITE_ENABLE_IRAN_ATTACKS === 'true';

async function runSignalAggregator(
  statusPanel: AppContext['statusPanel'] | undefined,
  context: string,
  ingest: (aggregator: SignalAggregator) => void,
): Promise<void> {
  try {
    ingest(await getSignalAggregator());
    statusPanel?.updateApi('Signal Aggregator', { status: 'ok', errorMessage: undefined });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[SignalAggregator] ${context} skipped:`, err);
    statusPanel?.updateApi('Signal Aggregator', {
      status: 'error',
      errorMessage: `${context}: ${errorMessage}`,
    });
  }
}

export interface IntelligenceLoaderCallbacks {
  refreshCiiAndBrief: () => void;
  runMilitarySurgeAnalysis: (flights: MilitaryFlight[]) => Promise<void>;
}

export class IntelligenceLoader {
  private ctx: AppContext;
  private callbacks: IntelligenceLoaderCallbacks;

  constructor(ctx: AppContext, callbacks: IntelligenceLoaderCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
  }

  destroy(): void {
    stopOrefPolling();
  }

  async loadIntelligenceSignals(): Promise<void> {
    resetHotspotActivity();
    const _desktopLocked = isDesktopRuntime() && !hasPremiumAccess();
    const tasks: Promise<void>[] = [];

    tasks.push(
      (async () => {
        try {
          const outages = await fetchInternetOutages();
          this.ctx.intelligenceCache.outages = outages;
          ingestOutagesForCII(outages);
          await runSignalAggregator(this.ctx.statusPanel, 'outages', (aggregator) =>
            aggregator.ingestOutages(outages),
          );
          dataFreshness.recordUpdate('outages', outages.length);
          if (this.ctx.mapLayers.outages) {
            this.ctx.map?.setOutages(outages);
            this.ctx.map?.setLayerReady('outages', outages.length > 0);
            this.ctx.statusPanel?.updateFeed('NetBlocks', {
              status: 'ok',
              itemCount: outages.length,
            });
          }
          // InternetDisruptionsPanel is self-fetching via usePanelData; no push needed.
          fetchTrafficAnomalies()
            .then((r) => {
              this.ctx.map?.setTrafficAnomalies(r.anomalies);
            })
            .catch(() => {});
          fetchDdosAttacks()
            .then((r) => {
              this.ctx.map?.setDdosLocations(r.topTargetLocations ?? []);
            })
            .catch(() => {});
        } catch (error) {
          console.error('[Intelligence] Outages fetch failed:', error);
          dataFreshness.recordError('outages', String(error));
        }
      })(),
    );

    const protestsTask = (async (): Promise<import('@/types').SocialUnrestEvent[]> => {
      try {
        const protestData = await fetchProtestEvents();
        this.ctx.intelligenceCache.protests = protestData;
        ingestProtests(protestData.events);
        ingestProtestsForCII(protestData.events);
        await runSignalAggregator(this.ctx.statusPanel, 'protests', (aggregator) =>
          aggregator.ingestProtests(protestData.events),
        );
        const protestCount = protestData.sources.acled + protestData.sources.gdelt;
        if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
        if (protestData.sources.gdelt > 0)
          dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
        if (protestData.sources.gdelt > 0)
          dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
        if (this.ctx.mapLayers.protests) {
          this.ctx.map?.setProtests(protestData.events);
          this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
          const status = getProtestStatus();
          this.ctx.statusPanel?.updateFeed('Protests', {
            status: 'ok',
            itemCount: protestData.events.length,
            errorMessage:
              status.acledConfigured === false
                ? 'ACLED not configured - using GDELT only'
                : undefined,
          });
        }
        return protestData.events;
      } catch (error) {
        console.error('[Intelligence] Protests fetch failed:', error);
        dataFreshness.recordError('acled', String(error));
        return [];
      }
    })();
    tasks.push(protestsTask.then(() => undefined));

    tasks.push(
      (async () => {
        try {
          const conflictData = await fetchConflictEvents();
          this.ctx.intelligenceCache.conflicts = conflictData.events;
          ingestConflictsForCII(conflictData.events);
          if (conflictData.count > 0)
            dataFreshness.recordUpdate('acled_conflict', conflictData.count);
        } catch (error) {
          console.error('[Intelligence] Conflict events fetch failed:', error);
          dataFreshness.recordError('acled_conflict', String(error));
        }
      })(),
    );

    const hydratedUcdp = getHydratedData('ucdpEvents') as
      import('@/services/conflict').HydratedUcdpPayload | undefined;

    tasks.push(
      (async () => {
        try {
          const classifications = await fetchUcdpClassifications(hydratedUcdp);
          ingestUcdpForCII(classifications);
          if (classifications.size > 0) dataFreshness.recordUpdate('ucdp', classifications.size);
        } catch (error) {
          console.error('[Intelligence] UCDP fetch failed:', error);
          dataFreshness.recordError('ucdp', String(error));
        }
      })(),
    );

    tasks.push(
      (async () => {
        try {
          const summaries = await fetchHapiSummary();
          ingestHapiForCII(summaries);
          if (summaries.size > 0) dataFreshness.recordUpdate('hapi', summaries.size);
        } catch (error) {
          console.error('[Intelligence] HAPI fetch failed:', error);
          dataFreshness.recordError('hapi', String(error));
        }
      })(),
    );

    tasks.push(
      (async () => {
        try {
          const militaryVessels = await getMilitaryVesselsModule();
          if (militaryVessels.isMilitaryVesselTrackingConfigured()) {
            militaryVessels.initMilitaryVesselStream();
          }
          const [flightData, vesselData] = await Promise.all([
            fetchMilitaryFlights(),
            militaryVessels.fetchMilitaryVessels(),
          ]);
          this.ctx.intelligenceCache.military = {
            flights: flightData.flights,
            flightClusters: flightData.clusters,
            vessels: vesselData.vessels,
            vesselClusters: vesselData.clusters,
          };
          fetchUSNIFleetReport()
            .then((report) => {
              if (report) this.ctx.intelligenceCache.usniFleet = report;
            })
            .catch(() => {});
          ingestFlights(flightData.flights);
          ingestVessels(vesselData.vessels);
          ingestMilitaryForCII(flightData.flights, vesselData.vessels);
          await runSignalAggregator(this.ctx.statusPanel, 'military tracks', (aggregator) => {
            aggregator.ingestFlights(flightData.flights);
            aggregator.ingestVessels(vesselData.vessels);
          });
          dataFreshness.recordUpdate('opensky', flightData.flights.length);
          updateAndCheck([
            { type: 'military_flights', region: 'global', count: flightData.flights.length },
            { type: 'vessels', region: 'global', count: vesselData.vessels.length },
          ])
            .then(async (anomalies) => {
              if (anomalies.length > 0) {
                await runSignalAggregator(
                  this.ctx.statusPanel,
                  'temporal anomalies',
                  (aggregator) => aggregator.ingestTemporalAnomalies(anomalies),
                );
                ingestTemporalAnomaliesForCII(anomalies);
                this.callbacks.refreshCiiAndBrief();
              }
            })
            .catch(() => {});
          if (this.ctx.mapLayers.military) {
            this.ctx.map?.setMilitaryFlights(flightData.flights, flightData.clusters);
            this.ctx.map?.setMilitaryVessels(vesselData.vessels, vesselData.clusters);
            this.ctx.map?.updateMilitaryForEscalation(flightData.flights, vesselData.vessels);
            const militaryCount = flightData.flights.length + vesselData.vessels.length;
            this.ctx.statusPanel?.updateFeed('Military', {
              status: militaryCount > 0 ? 'ok' : 'warning',
              itemCount: militaryCount,
            });
          }
          if (!isInLearningMode()) {
            await this.callbacks.runMilitarySurgeAnalysis(flightData.flights);
          }
        } catch (error) {
          // A teardown that races an in-flight vessel load is a deliberate
          // cancellation, not a real fetch failure — don't pollute freshness.
          if (isVesselRuntimeStoppedError(error)) return;
          console.error('[Intelligence] Military fetch failed:', error);
          dataFreshness.recordError('opensky', String(error));
        }
      })(),
    );

    tasks.push(
      (async () => {
        try {
          const protestEvents = await protestsTask;
          // The bootstrap payload is a dashboard projection (#5300) — 150 rows, not
          // 2,000. The panel is fine with that (it renders 50/tab and takes its
          // counts from the precomputed aggregates), but the map draws every event.
          // When its layer is on, skip hydration so fetchUcdpEvents goes to the RPC
          // and returns the full set.
          const wantsFullUcdpSet = this.ctx.mapLayers.ucdpEvents;
          const result = await fetchUcdpEvents(wantsFullUcdpSet ? undefined : hydratedUcdp);
          if (!result.success) {
            // listUcdpEvents is a pure Redis-read (gold standard). Retrying returns
            // the same empty result until the Railway seed refreshes the key.
            dataFreshness.recordError(
              'ucdp_events',
              'UCDP events unavailable (retaining prior event state)',
            );
            return;
          }
          const acledEvents = protestEvents.map((e) => ({
            latitude: e.lat,
            longitude: e.lon,
            event_date: e.time.toISOString(),
            fatalities: e.fatalities ?? 0,
          }));
          const events = deduplicateAgainstAcled(result.data, acledEvents);
          const aggregates =
            !wantsFullUcdpSet && hydratedUcdp?.aggregates && hydratedUcdp.dedupeIndex
              ? deduplicateUcdpProjectionAggregates(
                  hydratedUcdp.aggregates,
                  hydratedUcdp.dedupeIndex,
                  acledEvents,
                )
              : undefined;
          setUcdpEventsData({ events, aggregates });
          if (this.ctx.mapLayers.ucdpEvents) {
            this.ctx.map?.setUcdpEvents(events);
          }
          if (events.length > 0) dataFreshness.recordUpdate('ucdp_events', events.length);
        } catch (error) {
          console.error('[Intelligence] UCDP events fetch failed:', error);
          dataFreshness.recordError('ucdp_events', String(error));
        }
      })(),
    );

    tasks.push(
      (async () => {
        try {
          const unhcrResult = await fetchUnhcrPopulation();
          if (!unhcrResult.ok) {
            dataFreshness.recordError(
              'unhcr',
              'UNHCR displacement unavailable (retaining prior displacement state)',
            );
            // DisplacementPanel subscribes to displacement-store; no push needed.
            return;
          }
          const data = unhcrResult.data;
          setDisplacementData(data);
          ingestDisplacementForCII(data.countries);
          if (this.ctx.mapLayers.displacement && data.topFlows) {
            this.ctx.map?.setDisplacementFlows(data.topFlows);
          }
          if (data.countries.length > 0) dataFreshness.recordUpdate('unhcr', data.countries.length);
        } catch (error) {
          console.error('[Intelligence] UNHCR displacement fetch failed:', error);
          // DisplacementPanel subscribes to displacement-store; no push needed.
          dataFreshness.recordError('unhcr', String(error));
        }
      })(),
    );

    tasks.push(
      (async () => {
        try {
          const climateResult = await fetchClimateAnomalies();
          if (!climateResult.ok) {
            dataFreshness.recordError(
              'climate',
              'Climate anomalies unavailable (retaining prior climate state)',
            );
            return;
          }
          const anomalies = climateResult.anomalies;
          ingestClimateForCII(anomalies);
          if (this.ctx.mapLayers.climate) {
            this.ctx.map?.setClimateAnomalies(anomalies);
          }
          if (anomalies.length > 0) dataFreshness.recordUpdate('climate', anomalies.length);
        } catch (error) {
          console.error('[Intelligence] Climate anomalies fetch failed:', error);
          dataFreshness.recordError('climate', String(error));
        }
      })(),
    );

    // Security advisories
    tasks.push(this.loadSecurityAdvisories());

    // OREF sirens (premium-locked on desktop without API key)
    if (!_desktopLocked) {
      tasks.push(
        (async () => {
          try {
            const data = await fetchOrefAlerts();
            const alertCount = data.alerts?.length ?? 0;
            const historyCount24h = data.historyCount24h ?? 0;
            ingestOrefForCII(alertCount, historyCount24h);
            this.ctx.intelligenceCache.orefAlerts = { alertCount, historyCount24h };
            if (data.alerts?.length) dispatchOrefBreakingAlert(data.alerts);
            onOrefAlertsUpdate((update) => {
              const updAlerts = update.alerts?.length ?? 0;
              const updHistory = update.historyCount24h ?? 0;
              ingestOrefForCII(updAlerts, updHistory);
              this.ctx.intelligenceCache.orefAlerts = {
                alertCount: updAlerts,
                historyCount24h: updHistory,
              };
              if (update.alerts?.length) dispatchOrefBreakingAlert(update.alerts);
            });
            startOrefPolling();
          } catch (error) {
            console.error('[Intelligence] OREF alerts fetch failed:', error);
          }
        })(),
      );
    }

    // GPS/GNSS jamming (cloud-only — seeded by Wingbits API via fetch-gpsjam.mjs)
    if (!isDesktopRuntime()) {
      tasks.push(
        (async () => {
          try {
            const data = await fetchGpsInterference();
            if (!data) {
              this.ctx.intelligenceCache.gpsJamming = [];
              ingestGpsJammingForCII([]);
              this.ctx.map?.setLayerReady('gpsJamming', false);
              return;
            }
            this.ctx.intelligenceCache.gpsJamming = data.hexes;
            ingestGpsJammingForCII(data.hexes);
            if (this.ctx.mapLayers.gpsJamming) {
              await this.ctx.map?.setGpsJamming(data.hexes);
              this.ctx.map?.setLayerReady('gpsJamming', data.hexes.length > 0);
            }
            this.ctx.statusPanel?.updateFeed('GPS Jam', {
              status: 'ok',
              itemCount: data.hexes.length,
            });
            dataFreshness.recordUpdate('gpsjam', data.hexes.length);
          } catch (error) {
            this.ctx.map?.setLayerReady('gpsJamming', false);
            this.ctx.statusPanel?.updateFeed('GPS Jam', { status: 'error' });
            dataFreshness.recordError('gpsjam', String(error));
          }
        })(),
      );
    }

    await Promise.allSettled(tasks);

    try {
      const ucdpEvts = getUcdpEventsData().events;
      const events = [
        ...(this.ctx.intelligenceCache.protests?.events || []).slice(0, 10).map((e) => ({
          id: e.id,
          lat: e.lat,
          lon: e.lon,
          type: 'conflict' as const,
          name: e.title || 'Protest',
        })),
        ...ucdpEvts.slice(0, 10).map((e) => ({
          id: e.id,
          lat: e.latitude,
          lon: e.longitude,
          type: e.type_of_violence as string,
          name: `${e.side_a} vs ${e.side_b}`,
        })),
      ];
      if (events.length > 0) {
        const exposures = await enrichEventsWithExposure(events);
        setPopulationExposures(exposures);
        if (exposures.length > 0) dataFreshness.recordUpdate('worldpop', exposures.length);
      } else {
        setPopulationExposures([]);
      }
    } catch (error) {
      console.error('[Intelligence] Population exposure fetch failed:', error);
      setPopulationExposureError();
      dataFreshness.recordError('worldpop', String(error));
    }

    this.callbacks.refreshCiiAndBrief();
    console.log('[Intelligence] All signals loaded; canonical CII state refreshed');
  }

  async loadOutages(): Promise<void> {
    if (this.ctx.intelligenceCache.outages) {
      const outages = this.ctx.intelligenceCache.outages;
      this.ctx.map?.setOutages(outages);
      this.ctx.map?.setLayerReady('outages', outages.length > 0);
      this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
      return;
    }
    try {
      const outages = await fetchInternetOutages();
      this.ctx.intelligenceCache.outages = outages;
      this.ctx.map?.setOutages(outages);
      this.ctx.map?.setLayerReady('outages', outages.length > 0);
      ingestOutagesForCII(outages);
      await runSignalAggregator(this.ctx.statusPanel, 'outages', (aggregator) =>
        aggregator.ingestOutages(outages),
      );
      this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
      dataFreshness.recordUpdate('outages', outages.length);
      // InternetDisruptionsPanel is self-fetching via usePanelData; no push needed.
      fetchTrafficAnomalies()
        .then((r) => {
          this.ctx.map?.setTrafficAnomalies(r.anomalies);
        })
        .catch(() => {});
      fetchDdosAttacks()
        .then((r) => {
          this.ctx.map?.setDdosLocations(r.topTargetLocations ?? []);
        })
        .catch(() => {});
    } catch (error) {
      this.ctx.map?.setLayerReady('outages', false);
      this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'error' });
      dataFreshness.recordError('outages', String(error));
    }
  }

  async loadCyberThreats(): Promise<void> {
    if (!CYBER_LAYER_ENABLED) {
      this.ctx.mapLayers.cyberThreats = false;
      this.ctx.map?.setLayerReady('cyberThreats', false);
      return;
    }

    if (this.ctx.cyberThreatsCache) {
      this.ctx.map?.setCyberThreats(this.ctx.cyberThreatsCache);
      this.ctx.map?.setLayerReady('cyberThreats', this.ctx.cyberThreatsCache.length > 0);
      ingestCyberThreatsForCII(this.ctx.cyberThreatsCache);
      this.callbacks.refreshCiiAndBrief();
      this.ctx.statusPanel?.updateFeed('Cyber Threats', {
        status: 'ok',
        itemCount: this.ctx.cyberThreatsCache.length,
      });
      return;
    }

    try {
      const { fetchCyberThreats } = await import('@/services/cyber');
      const threats = await fetchCyberThreats({ limit: 500, days: 14 });
      this.ctx.cyberThreatsCache = threats;
      this.ctx.map?.setCyberThreats(threats);
      this.ctx.map?.setLayerReady('cyberThreats', threats.length > 0);
      ingestCyberThreatsForCII(threats);
      this.callbacks.refreshCiiAndBrief();
      this.ctx.statusPanel?.updateFeed('Cyber Threats', {
        status: 'ok',
        itemCount: threats.length,
      });
      this.ctx.statusPanel?.updateApi('Cyber Threats API', { status: 'ok' });
      dataFreshness.recordUpdate('cyber_threats', threats.length);
    } catch (error) {
      this.ctx.map?.setLayerReady('cyberThreats', false);
      this.ctx.statusPanel?.updateFeed('Cyber Threats', {
        status: 'error',
        errorMessage: String(error),
      });
      this.ctx.statusPanel?.updateApi('Cyber Threats API', { status: 'error' });
      dataFreshness.recordError('cyber_threats', String(error));
    }
  }

  async loadIranEvents(): Promise<void> {
    if (!IRAN_ATTACKS_ENABLED) {
      this.ctx.map?.setLayerReady('iranAttacks', false);
      return;
    }
    try {
      const events = await fetchIranEvents();
      this.ctx.intelligenceCache.iranEvents = events;
      this.ctx.map?.setIranEvents(events);
      this.ctx.map?.setLayerReady('iranAttacks', events.length > 0);
      const coerced = events.map((e) => ({ ...e, timestamp: Number(e.timestamp) || 0 }));
      await runSignalAggregator(this.ctx.statusPanel, 'iran conflict events', (aggregator) =>
        aggregator.ingestConflictEvents(coerced),
      );
      ingestStrikesForCII(coerced);
      this.callbacks.refreshCiiAndBrief();
    } catch {
      this.ctx.map?.setLayerReady('iranAttacks', false);
    }
  }

  async loadCableActivity(): Promise<void> {
    try {
      const { fetchCableActivity } = await import('@/services/cable-activity');
      const activity = await fetchCableActivity();
      this.ctx.map?.setCableActivity(activity.advisories, activity.repairShips);
      const itemCount = activity.advisories.length + activity.repairShips.length;
      this.ctx.statusPanel?.updateFeed('CableOps', { status: 'ok', itemCount });
    } catch {
      this.ctx.statusPanel?.updateFeed('CableOps', { status: 'error' });
    }
  }

  async loadCableHealth(): Promise<void> {
    try {
      const healthData = await fetchCableHealth();
      this.ctx.map?.setCableHealth(healthData.cables);
      const cableIds = Object.keys(healthData.cables);
      const faultCount = cableIds.filter((id) => healthData.cables[id]?.status === 'fault').length;
      const degradedCount = cableIds.filter(
        (id) => healthData.cables[id]?.status === 'degraded',
      ).length;
      this.ctx.statusPanel?.updateFeed('CableHealth', {
        status: 'ok',
        itemCount: faultCount + degradedCount,
      });
    } catch {
      this.ctx.statusPanel?.updateFeed('CableHealth', { status: 'error' });
    }
  }

  async loadProtests(): Promise<void> {
    if (this.ctx.intelligenceCache.protests) {
      const protestData = this.ctx.intelligenceCache.protests;
      this.ctx.map?.setProtests(protestData.events);
      this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
      const status = getProtestStatus();
      this.ctx.statusPanel?.updateFeed('Protests', {
        status: 'ok',
        itemCount: protestData.events.length,
        errorMessage:
          status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
      });
      if (status.acledConfigured === true) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'ok' });
      } else if (status.acledConfigured === null) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'warning' });
      }
      this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'ok' });
      if (protestData.sources.gdelt > 0)
        dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
      return;
    }
    try {
      const protestData = await fetchProtestEvents();
      this.ctx.intelligenceCache.protests = protestData;
      this.ctx.map?.setProtests(protestData.events);
      this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
      ingestProtests(protestData.events);
      ingestProtestsForCII(protestData.events);
      await runSignalAggregator(this.ctx.statusPanel, 'protests', (aggregator) =>
        aggregator.ingestProtests(protestData.events),
      );
      const protestCount = protestData.sources.acled + protestData.sources.gdelt;
      if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
      if (protestData.sources.gdelt > 0)
        dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
      if (protestData.sources.gdelt > 0)
        dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
      this.callbacks.refreshCiiAndBrief();
      const status = getProtestStatus();
      this.ctx.statusPanel?.updateFeed('Protests', {
        status: 'ok',
        itemCount: protestData.events.length,
        errorMessage:
          status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
      });
      if (status.acledConfigured === true) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'ok' });
      } else if (status.acledConfigured === null) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'warning' });
      }
      this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('protests', false);
      this.ctx.statusPanel?.updateFeed('Protests', {
        status: 'error',
        errorMessage: String(error),
      });
      this.ctx.statusPanel?.updateApi('ACLED', { status: 'error' });
      this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'error' });
      dataFreshness.recordError('gdelt_doc', String(error));
    }
  }

  async loadSecurityAdvisories(): Promise<void> {
    try {
      const result = await fetchSecurityAdvisories();
      if (result.ok) {
        this.ctx.intelligenceCache.advisories = result.advisories;
        ingestAdvisoriesForCII(result.advisories);
      }
    } catch (error) {
      console.error('[App] Security advisories fetch failed:', error);
    }
  }

  async loadSanctionsPressure(): Promise<void> {
    try {
      const result = await fetchSanctionsPressure();
      this.ctx.intelligenceCache.sanctions = result;
      await runSignalAggregator(this.ctx.statusPanel, 'sanctions pressure', (aggregator) =>
        aggregator.ingestSanctionsPressure(result.countries),
      );
      ingestSanctionsForCII(result.countries);
      if (result.totalCount > 0) {
        dataFreshness.recordUpdate('sanctions_pressure', result.totalCount);
        this.ctx.statusPanel?.updateApi('OFAC', {
          status: result.newEntryCount > 0 ? 'warning' : 'ok',
        });
      } else {
        this.ctx.statusPanel?.updateApi('OFAC', { status: 'error' });
      }
    } catch (error) {
      console.error('[App] Sanctions pressure fetch failed:', error);
      dataFreshness.recordError('sanctions_pressure', String(error));
      this.ctx.statusPanel?.updateApi('OFAC', { status: 'error' });
    }
  }

  async loadResilienceRanking(): Promise<void> {
    if (!hasPremiumAccess() || !this.ctx.map?.isDeckGLActive?.()) {
      this.ctx.map?.setResilienceRanking([]);
      this.ctx.map?.setLayerReady('resilienceScore', false);
      return;
    }

    try {
      const result = await getResilienceRanking();
      this.ctx.map?.setResilienceRanking(result.items, result.greyedOut ?? []);
      const displayable = buildResilienceChoroplethMap(result.items, result.greyedOut ?? []);
      this.ctx.map?.setLayerReady('resilienceScore', displayable.size > 0);
    } catch (error) {
      console.error('[App] Resilience ranking fetch failed:', error);
      this.ctx.map?.setResilienceRanking([]);
      this.ctx.map?.setLayerReady('resilienceScore', false);
    }
  }

  async loadRadiationWatch(): Promise<void> {
    try {
      const result = await fetchRadiationWatch();
      const anomalies = result.observations.filter(
        (observation) => observation.severity !== 'normal',
      );
      this.ctx.intelligenceCache.radiation = result;
      await runSignalAggregator(this.ctx.statusPanel, 'radiation observations', (aggregator) =>
        aggregator.ingestRadiationObservations(result.observations),
      );
      this.ctx.map?.setRadiationObservations(anomalies);
      this.ctx.map?.setLayerReady('radiationWatch', anomalies.length > 0);
      if (result.observations.length > 0) {
        dataFreshness.recordUpdate('radiation', result.observations.length);
      }
    } catch (error) {
      console.error('[App] Radiation watch fetch failed:', error);
      this.ctx.map?.setLayerReady('radiationWatch', false);
      dataFreshness.recordError('radiation', String(error));
    }
  }

  async loadThermalEscalations(): Promise<void> {
    try {
      const result = await fetchThermalEscalations();
      this.ctx.intelligenceCache.thermalEscalation = result;
      dataFreshness.recordUpdate('thermal-escalation' as DataSourceId, result.clusters.length);
    } catch (error) {
      console.error('[App] Thermal escalation fetch failed:', error);
    }
  }

  async loadCrossSourceSignals(): Promise<void> {
    try {
      const result = await fetchCrossSourceSignals();
      dataFreshness.recordUpdate(
        'cross-source-signals' as DataSourceId,
        result.signals?.length ?? 0,
      );
    } catch (error) {
      console.error('[App] Cross-source signals fetch failed:', error);
    }
  }
}
