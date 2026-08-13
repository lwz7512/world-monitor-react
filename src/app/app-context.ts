import type { InternetOutage, SocialUnrestEvent, MilitaryFlight, MilitaryFlightCluster, MilitaryVessel, MilitaryVesselCluster, USNIFleetReport, PanelConfig, MapLayers, NewsItem, MarketData, ClusteredEvent, CyberThreat, Monitor, AisDisruptionEvent } from '@/types';
import type { AirportDelayAlert, PositionSample } from '@/services/aviation';
import type { IranEvent } from '@/generated/client/worldmonitor/conflict/v1/service_client';
import type { ConflictEvent } from '@/services/conflict';
import type { GpsJamHex } from '@/services/gps-interference';
import type { OverlayId } from '@/utils/overlay-history';

// Geometry-resolved satellite-fire shape ingested into CII. Mirrors the inline
// projection built in DataLoaderManager.loadFirmsData so the cache can replay it
// once precision country geometry is ready (#4512).
export type SatelliteFireSignal = {
  lat: number;
  lon: number;
  brightness: number;
  frp: number;
  region?: string;
};
import type { SanctionsPressureResult } from '@/services/sanctions-pressure';
import type { RadiationWatchResult } from '@/services/radiation';
import type { SecurityAdvisory } from '@/services/security-advisories';
import type { Earthquake } from '@/services/earthquakes';

export type { CountryBriefSignals } from '@/types';

import type { UnifiedSettingsTabId } from '@/components/settings-types';
export type { UnifiedSettingsTabId };

export interface UnifiedSettingsController {
  open(tab?: UnifiedSettingsTabId, replaceOverlayId?: OverlayId, historyPending?: boolean): void;
  close(): void;
  hasPendingChanges(): boolean;
  refreshPanelToggles(): void;
  getButton(): HTMLButtonElement;
  destroy(): void;
}

export interface IntelligenceCache {
  conflicts?: ConflictEvent[];
  // Coordinate-resolved sources whose CII attribution depends on precision
  // country geometry. They are ingested during the visible-data fan-out (before
  // geometry is ready, so attribution is coarse/empty) and replayed once
  // geometry lands — see refreshGeometryDependentCiiAfterCountryGeometry (#4512).
  gpsJamming?: GpsJamHex[];
  aisDisruptions?: AisDisruptionEvent[];
  satelliteFires?: SatelliteFireSignal[];
  flightDelays?: AirportDelayAlert[];
  thermalEscalation?: import('@/services/thermal-escalation').ThermalEscalationWatch;
  aircraftPositions?: PositionSample[];
  outages?: InternetOutage[];
  protests?: { events: SocialUnrestEvent[]; sources: { acled: number; gdelt: number } };
  military?: { flights: MilitaryFlight[]; flightClusters: MilitaryFlightCluster[]; vessels: MilitaryVessel[]; vesselClusters: MilitaryVesselCluster[] };
  earthquakes?: Earthquake[];
  usniFleet?: USNIFleetReport;
  iranEvents?: IranEvent[];
  orefAlerts?: { alertCount: number; historyCount24h: number };
  advisories?: SecurityAdvisory[];
  sanctions?: SanctionsPressureResult;
  radiation?: RadiationWatchResult;
  imageryScenes?: Array<{ id: string; satellite: string; datetime: string; resolutionM: number; mode: string; geometryGeojson: string; previewUrl: string; assetUrl: string }>;
}

export interface AppContext {
  map: import('@/components').MapContainer | null;
  readonly isMobile: boolean;
  readonly isDesktopApp: boolean;
  readonly container: HTMLElement;

  panels: Record<string, import('@/components').Panel>;
  /**
   * `feed category key → the panel key its NewsPanel registered under`, filled
   * by panel-layout as it registers news panels. A category whose key was
   * already claimed by a non-news panel never lands here, which is what stops
   * the data layer resolving it as a news category (#5376). See
   * `enabledNewsCategoryKeys` in src/config/feed-resolution.ts.
   */
  newsCategoryPanelKeys: Map<string, string>;
  panelSettings: Record<string, PanelConfig>;

  mapLayers: MapLayers;

  allNews: NewsItem[];
  newsByCategory: Record<string, NewsItem[]>;
  latestMarkets: MarketData[];
  latestPredictions: import('@/services/prediction').PredictionMarket[];
  latestTechEvents: Array<{ id: string; title: string; location: string; startDate: string; [key: string]: unknown }>;
  latestClusters: ClusteredEvent[];
  intelligenceCache: IntelligenceCache;
  cyberThreatsCache: CyberThreat[] | null;

  disabledSources: Set<string>;
  currentTimeRange: import('@/components').TimeRange;

  inFlight: Set<string>;
  visiblePanelPrimed: Set<string>;
  seenGeoAlerts: Set<string>;
  monitors: Monitor[];

  signalModal: import('@/components/SignalModal').SignalModal | null;
  ensureSignalModal: () => Promise<import('@/components/SignalModal').SignalModal>;
  statusPanel: import('@/components').StatusPanel | null;
  searchModal: import('@/components').SearchModal | null;
  findingsBadge: import('@/components').IntelligenceGapBadge | null;
  breakingBanner: import('@/components/BreakingNewsBanner').BreakingNewsBanner | null;
  playbackControl: import('@/components').PlaybackControl | null;
  exportPanel: import('@/utils/export').ExportPanel | null;
  unifiedSettings: UnifiedSettingsController | null;
  pizzintIndicator: import('@/components').PizzIntIndicator | null;
  correlationEngine: import('@/services/correlation-engine').CorrelationEngine | null;
  llmStatusIndicator: import('@/components').LlmStatusIndicator | null;
  refreshScheduler: import('@/app/refresh-scheduler').RefreshScheduler | null;
  dataLoader: import('@/app/data-loader').DataLoaderManager | null;
  countryBriefPage: import('@/components/CountryBriefPanel').CountryBriefPanel | null;
  countryTimeline: import('@/components/CountryTimeline').CountryTimeline | null;

  positivePanel: null;
  countersPanel: null;
  progressPanel: null;
  breakthroughsPanel: null;
  heroPanel: null;
  digestPanel: null;
  speciesPanel: null;
  renewablePanel: null;
  authModal: { open(): void; close(): void; destroy(): void } | null;
  authHeaderWidget: import('@/components/AuthHeaderWidget').AuthHeaderWidget | null;
  tvMode: import('@/services/tv-mode').TvModeController | null;
  mobilePanelNav: import('@/components/MobilePanelNav').MobilePanelNav | null;
  happyAllItems: NewsItem[];
  isDestroyed: boolean;
  uiReady: Promise<void>;
  resolveUiReady: () => void;
  isPlaybackMode: boolean;
  isIdle: boolean;
  initialLoadComplete: boolean;
  resolvedLocation: 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania';
  activeChokepoint: string | null;

  initialUrlState: import('@/utils').ParsedMapUrlState | null;
  readonly PANEL_ORDER_KEY: string;
  readonly PANEL_SPANS_KEY: string;
  primeVisiblePanelData?: (forceAll?: boolean) => Promise<void>;
  freeTierGate: import('@/app/free-tier-gate').FreeTierGate | null;
  pendingCloudRecoverySyncVersion: number | undefined;
  pendingDeepLinks?: {
    country: string | null;
    expanded: boolean;
    chokepoint: string | null;
    storyCode: string | null;
  } | null;
}

export interface AppModule {
  init(): void | Promise<void>;
  destroy(): void;
}
