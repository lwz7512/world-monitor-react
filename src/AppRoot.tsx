import { AppContextProvider } from '@/context/AppContext';
import { PanelLayout } from '@/app/PanelLayout';
import { AppShell } from '@/app/AppShell';
import { useAppLifecycle } from '@/hooks/useAppLifecycle';
import { MissionPresetControl } from '@/components/MissionPresetControl';
import {
  useHeaderClock,
  usePizzIntIndicator,
  useLlmStatusIndicator,
  useStatusPanel,
  usePanelViewTracking,
  useSnapshotSaving,
} from '@/hooks/useEventSetup';
import { useMapControls } from '@/hooks/useMapControls';
import { useTvMode } from '@/hooks/useTvMode';
import { useSearchControls } from '@/hooks/useSearchControls';
import { usePlaybackControl } from '@/hooks/usePlaybackControl';
import { useExportPanel } from '@/hooks/useExportPanel';
import { useUnifiedSettings } from '@/hooks/useUnifiedSettings';
import { useAuthWidget } from '@/hooks/useAuthWidget';
import { useMapLayerHandlers } from '@/hooks/useMapLayerHandlers';
import { useUrlStateSync } from '@/hooks/useUrlStateSync';
import { usePanelEventBridge } from '@/hooks/usePanelEventBridge';
import { useChatAnalystBridge } from '@/hooks/useChatAnalystBridge';
import { useWidgetCreator } from '@/hooks/useWidgetCreator';
import { useMobileLayout } from '@/hooks/useMobileLayout';
import { useMlWorker } from '@/hooks/useMlWorker';
import { useI18nHydration } from '@/hooks/useI18nHydration';
import { useDesktopUpdater } from '@/hooks/useDesktopUpdater';
import { useDesktopExternalLinks } from '@/hooks/useDesktopExternalLinks';
import { useRegionSelect } from '@/hooks/useRegionSelect';
import { useMapResizeSync } from '@/hooks/useMapResizeSync';
import { useFocalPointsReady } from '@/hooks/useFocalPointsReady';
import { useDocumentVisibility } from '@/hooks/useDocumentVisibility';
import { useThemeChangedSync } from '@/hooks/useThemeChangedSync';
import { useViewportDataPrime } from '@/hooks/useViewportDataPrime';
import { useIdleDetection } from '@/hooks/useIdleDetection';
import { usePanelCloseUndo } from '@/hooks/usePanelCloseUndo';
import { useWidgetMcpHandlers } from '@/hooks/useWidgetMcpHandlers';
import { useShareEmbed } from '@/hooks/useShareEmbed';
import { useDownloadDropdown } from '@/hooks/useDownloadDropdown';
import { useVariantFullscreen } from '@/hooks/useVariantFullscreen';
import { useConnectivityIndicator } from '@/hooks/useConnectivityIndicator';
import { useFollowedCountriesCapDrop } from '@/hooks/useFollowedCountriesCapDrop';
import { useFindingsBadge } from '@/hooks/useFindingsBadge';
import { useRefreshIntervals } from '@/hooks/useRefreshIntervals';
import { useDeepLinks } from '@/hooks/useDeepLinks';
import { useAuthLifecycle } from '@/hooks/useAuthLifecycle';
import { useCloudPrefsSync } from '@/hooks/useCloudPrefsSync';

/**
 * Thin shell that calls event-setup hooks that have been migrated out of
 * EventHandlerManager. Must be inside AppContextProvider so ctx-dependent
 * hooks can access the bridge context.
 */
function AppSetupHooks() {
  useHeaderClock();
  usePizzIntIndicator();
  useLlmStatusIndicator();
  useStatusPanel();
  usePanelViewTracking();
  useSnapshotSaving();
  useMapControls();
  useTvMode();
  useSearchControls();
  usePlaybackControl();
  useExportPanel();
  useUnifiedSettings();
  useAuthWidget();
  useMapLayerHandlers();
  useUrlStateSync();
  usePanelEventBridge();
  useChatAnalystBridge();
  useWidgetCreator();
  useMobileLayout();
  useMlWorker();
  useI18nHydration();
  useDesktopUpdater();
  useDesktopExternalLinks();
  useRegionSelect();
  useMapResizeSync();
  useFocalPointsReady();
  useDocumentVisibility();
  useThemeChangedSync();
  useIdleDetection();
  usePanelCloseUndo();
  useWidgetMcpHandlers();
  useShareEmbed();
  useDownloadDropdown();
  useVariantFullscreen();
  useConnectivityIndicator();
  useFollowedCountriesCapDrop();
  useFindingsBadge();
  useRefreshIntervals();
  useViewportDataPrime();
  useDeepLinks();
  useAuthLifecycle();
  useCloudPrefsSync();
  return null;
}

export function AppRoot() {
  useAppLifecycle();

  return (
    <>
      <AppShell />
      <AppContextProvider>
        <AppSetupHooks />
        <PanelLayout />
        <MissionPresetControl />
      </AppContextProvider>
    </>
  );
}
