import type { MapLayers } from '@/types';
import type { CustomWidgetSpec } from '@/services/widget-store';
import type { McpPanelSpec } from '@/services/mcp-store';
import type { PositionSample } from '@/services/aviation';
import type { AuthLauncher } from '@/components/AuthLauncher';
import type { OverlayId } from '@/utils/overlay-history';

export interface EventHandlerCallbacks {
  openSearch: (options?: { toggle?: boolean; replaceOverlayId?: OverlayId; historyPending?: boolean }) => void;
  updateSearchIndex: () => void;
  updateFlightSource?: (adsb: PositionSample[], military: import('@/types').MilitaryFlight[]) => void;
  loadAllData: () => Promise<void>;
  /**
   * Tell the data loader that the rendered news no longer reflects the last
   * load, so the next loadAllData() refetches it even though the category set
   * is unchanged. See DataLoader.invalidateNewsHydration.
   */
  invalidateNewsHydration: () => void;
  flushStaleRefreshes: () => void;
  setHiddenSince: (ts: number) => void;
  loadDataForLayer: (layer: string) => void;
  waitForAisData: () => void;
  syncDataFreshnessWithLayers: () => void;
  ensureCorrectZones: () => void;
  applySavedPanelOrder?: (panelOrder?: string[]) => void;
  refreshCiiAfterFocalPointsReady?: () => void;
  stopLayerActivity?: (layer: keyof MapLayers) => void;
  mountLiveNewsIfReady?: () => void;
  applyMapLayerChange: (layer: keyof MapLayers, enabled: boolean, source: 'user' | 'programmatic') => void;
  syncUrlState: () => void;
  setupMobileAuth: (modal: AuthLauncher) => void;
  openCountryStory: (code: string, name: string) => void;
  openCountryBrief: (code: string) => void;
  updateMonitorResults: () => void;
  addCustomWidget: (spec: CustomWidgetSpec) => Promise<void>;
  addMcpPanel: (spec: McpPanelSpec) => void;
  resetIdleTimer: () => void;
  applyPanelSettings: () => void;
  enablePanelById?: (panelId: string) => boolean;
  openCountryBriefByCode?: (code: string, name: string, opts?: { maximize?: boolean }) => void;
  enforceFreeTierLimits?: (cloudSyncVersion?: number) => boolean;
  healStoredTabSnapshots?: () => void;
  freeTierGateResetForAuthTransition?: () => void;
  clearPendingCloudRecoverySyncVersion?: () => void;
  setPendingCloudRecoverySyncVersionIfUnset?: (version: number) => void;
}
