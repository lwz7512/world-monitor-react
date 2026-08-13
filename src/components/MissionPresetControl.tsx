import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppContextMaybe } from '@/context/AppContext';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import type { MapLayers } from '@/types';
import type { MapView } from '@/components/MapContainer';
import {
  DEFAULT_MAP_LAYERS,
  MOBILE_DEFAULT_MAP_LAYERS,
  STORAGE_KEYS,
  SITE_VARIANT,
  LAYER_TO_SOURCE,
} from '@/config';
import {
  MISSION_PRESETS,
  applyMissionPresetToState,
  clearMissionPreset,
  dismissMissionPresetPrompt,
  filterMissionLayersForRenderer,
  isMissionPresetPromptDismissed,
  loadStoredMissionPreset,
  resetMissionPresetState,
  saveMissionPreset,
  type MissionPreset,
  type MissionPresetId,
} from '@/services/mission-presets';
import {
  initAisStream,
  disconnectAisStream,
  isAisConfigured,
} from '@/services';
import { trackMapLayerToggle } from '@/services/analytics';
import { dataFreshness } from '@/services/data-freshness';
import { saveToStorage, showToast } from '@/utils';
import { scheduleAfterFirstPaint } from '@/utils/after-paint';

function computePopoverPosition(anchor: HTMLElement): { left: number; top: number } {
  const rect = anchor.getBoundingClientRect();
  const width = 360;
  const estimatedHeight = 620;
  const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
  const top = Math.min(
    Math.max(12, rect.bottom + 8),
    Math.max(12, window.innerHeight - estimatedHeight - 12),
  );
  return { left, top };
}

interface MissionPresetCardProps {
  preset: MissionPreset;
  selected: boolean;
  onSelect: (id: MissionPresetId) => void;
}

function MissionPresetCard({ preset, selected, onSelect }: MissionPresetCardProps) {
  return (
    <button
      type="button"
      className={`mission-preset-card${selected ? ' selected' : ''}`}
      data-mission-id={preset.id}
      aria-pressed={selected}
      onClick={() => onSelect(preset.id)}
    >
      <span className="mission-preset-card__icon">{preset.icon}</span>
      <span className="mission-preset-card__body">
        <strong>{preset.label}</strong>
        <small>{preset.description}</small>
      </span>
      <span className="mission-preset-card__check">{selected ? '✓' : ''}</span>
    </button>
  );
}

interface MissionPresetPopoverProps {
  anchor: HTMLElement | null;
  mobile: boolean;
  activePreset: MissionPreset | null;
  onSelect: (id: MissionPresetId) => void;
  onReset: () => void;
  onClose: () => void;
}

function MissionPresetPopover({ anchor, mobile, activePreset, onSelect, onReset, onClose }: MissionPresetPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const position = !mobile && anchor ? computePopoverPosition(anchor) : null;

  useEffect(() => {
    popoverRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', handler);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={popoverRef}
      className={`mission-preset-popover${mobile ? ' mission-preset-popover--mobile' : ''}`}
      role="dialog"
      aria-label="Mission presets"
      tabIndex={-1}
      style={position ? { left: position.left, top: position.top } : undefined}
    >
      <div className="mission-preset-popover__header">
        <div>
          <span>Mission</span>
          <strong>{activePreset?.label ?? 'Choose Workspace'}</strong>
        </div>
        <div className="mission-preset-popover__actions">
          <button type="button" className="mission-preset-reset" onClick={onReset}>Reset</button>
          <button type="button" className="mission-preset-close" aria-label="Close mission presets" onClick={onClose}>×</button>
        </div>
      </div>
      <div className="mission-preset-popover__list">
        {MISSION_PRESETS.map((preset) => (
          <MissionPresetCard
            key={preset.id}
            preset={preset}
            selected={activePreset?.id === preset.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function MissionPresetControl() {
  const ctx = useAppContextMaybe();
  const [activePreset, setActivePreset] = useState<MissionPreset | null>(() => loadStoredMissionPreset());
  const [isOpen, setIsOpen] = useState(false);
  const [isMobilePopover, setIsMobilePopover] = useState(false);
  const [isDismissed, setIsDismissed] = useState(() => isMissionPresetPromptDismissed());
  const anchorRef = useRef<HTMLButtonElement>(null);
  const dataRefreshTimerRef = useRef<number | null>(null);

  const scheduleMissionDataRefresh = useCallback(() => {
    if (dataRefreshTimerRef.current) window.clearTimeout(dataRefreshTimerRef.current);
    dataRefreshTimerRef.current = window.setTimeout(() => {
      dataRefreshTimerRef.current = null;
      void getPublishedAppActions()?.loadAllData();
    }, 150);
  }, []);

  useEffect(() => {
    return () => {
      if (dataRefreshTimerRef.current) window.clearTimeout(dataRefreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const item = document.getElementById('mobileMenuMission');
    const label = item?.querySelector('.mobile-menu-item-label');
    if (label) {
      label.textContent = activePreset ? `Mission: ${activePreset.shortLabel}` : 'Mission';
    }
  }, [activePreset]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { mobile } = (e as CustomEvent<{ anchor: HTMLElement | null; mobile: boolean }>).detail;
      setIsMobilePopover(mobile);
      setIsOpen((prev) => !prev);
    };
    document.addEventListener('wm:open-mission-preset', handler);
    return () => document.removeEventListener('wm:open-mission-preset', handler);
  }, []);

  useEffect(() => {
    if (!ctx) return;
    if (ctx.isMobile || window.location.search || loadStoredMissionPreset() || isMissionPresetPromptDismissed()) return;
    scheduleAfterFirstPaint(() => {
      if (ctx.isDestroyed) return;
      if (loadStoredMissionPreset() || isMissionPresetPromptDismissed()) return;
      setIsOpen(true);
    });
  }, [ctx]);

  // --- helpers (ctx-dependent, called only when ctx is non-null) ---

  function getMissionDefaultLayers(): MapLayers {
    return ctx!.isMobile ? MOBILE_DEFAULT_MAP_LAYERS : DEFAULT_MAP_LAYERS;
  }

  function filterMissionLayersForAvailableServices(layers: MapLayers): MapLayers {
    if (layers.ais && !isAisConfigured()) return { ...layers, ais: false };
    return layers;
  }

  function filterMissionLayersForCurrentRenderer(layers: MapLayers): MapLayers {
    const renderer = ctx!.map?.isGlobeMode?.() ? 'globe' : 'flat';
    const isDeckGLActive = ctx!.map?.isDeckGLActive?.() ?? !ctx!.isMobile;
    return filterMissionLayersForAvailableServices(
      filterMissionLayersForRenderer(layers, renderer, isDeckGLActive, getMissionDefaultLayers()),
    );
  }

  function runMapLayerSideEffects(layer: keyof MapLayers, enabled: boolean): void {
    const actions = getPublishedAppActions();
    const sourceIds = LAYER_TO_SOURCE[layer];
    if (sourceIds) {
      for (const sourceId of sourceIds) {
        dataFreshness.setEnabled(sourceId, enabled);
      }
    }
    if (layer === 'ais') {
      if (enabled) {
        ctx!.map?.setLayerLoading('ais', true);
        initAisStream();
        actions?.waitForAisData();
      } else {
        disconnectAisStream();
      }
      return;
    }
    if (enabled) {
      actions?.loadDataForLayer(layer);
    } else {
      actions?.stopLayerActivity?.(layer as keyof MapLayers);
    }
  }

  function applyMissionMapLayerTransitions(previousLayers: MapLayers, nextLayers: MapLayers): void {
    const layerKeys = new Set([
      ...Object.keys(previousLayers),
      ...Object.keys(nextLayers),
    ] as Array<keyof MapLayers>);
    for (const layer of layerKeys) {
      const enabled = !!nextLayers[layer];
      if (!!previousLayers[layer] === enabled) continue;
      trackMapLayerToggle(layer, enabled, 'programmatic');
      runMapLayerSideEffects(layer, enabled);
    }
  }

  function persistMissionPanelOrder(panelOrder: string[]): void {
    saveToStorage(ctx!.PANEL_ORDER_KEY, panelOrder);
    saveToStorage(ctx!.PANEL_ORDER_KEY + '-bottom-set', []);
    try {
      localStorage.removeItem(ctx!.PANEL_ORDER_KEY + '-bottom');
    } catch {
      // Storage can be unavailable; the current session still applies the in-memory order.
    }
  }

  function handleApplyPreset(presetId: MissionPresetId): void {
    if (!ctx) return;
    const actions = getPublishedAppActions();
    const applied = applyMissionPresetToState(presetId, ctx.panelSettings, getMissionDefaultLayers(), SITE_VARIANT);
    const mapLayers = filterMissionLayersForCurrentRenderer(applied.mapLayers);
    const previousMapLayers = { ...ctx.mapLayers };

    ctx.panelSettings = applied.panelSettings;
    ctx.mapLayers = mapLayers;
    saveToStorage(STORAGE_KEYS.panels, applied.panelSettings);
    saveToStorage(STORAGE_KEYS.mapLayers, mapLayers);
    persistMissionPanelOrder(applied.panelOrder);
    saveMissionPreset(applied.preset.id);

    actions?.applyPanelSettings();
    actions?.applySavedPanelOrder?.(applied.panelOrder);
    ctx.unifiedSettings?.refreshPanelToggles();
    ctx.map?.setLayers(mapLayers);
    applyMissionMapLayerTransitions(previousMapLayers, mapLayers);
    ctx.map?.setView(applied.preset.view as MapView, applied.preset.zoom);
    ctx.map?.setTimeRange(applied.preset.timeRange);
    actions?.mountLiveNewsIfReady?.();
    actions?.syncDataFreshnessWithLayers();
    scheduleMissionDataRefresh();
    actions?.syncUrlState();
    showToast(`Mission preset applied: ${applied.preset.label}`);
    setActivePreset(applied.preset);
    setIsOpen(false);
  }

  function handleResetPreset(): void {
    if (!ctx) return;
    const actions = getPublishedAppActions();
    const reset = resetMissionPresetState(ctx.panelSettings, getMissionDefaultLayers(), SITE_VARIANT);
    const mapLayers = filterMissionLayersForCurrentRenderer(reset.mapLayers);
    const previousMapLayers = { ...ctx.mapLayers };

    ctx.panelSettings = reset.panelSettings;
    ctx.mapLayers = mapLayers;
    saveToStorage(STORAGE_KEYS.panels, reset.panelSettings);
    saveToStorage(STORAGE_KEYS.mapLayers, mapLayers);
    persistMissionPanelOrder(reset.panelOrder);
    clearMissionPreset();

    actions?.applyPanelSettings();
    actions?.applySavedPanelOrder?.(reset.panelOrder);
    ctx.unifiedSettings?.refreshPanelToggles();
    ctx.map?.setLayers(mapLayers);
    applyMissionMapLayerTransitions(previousMapLayers, mapLayers);
    ctx.map?.setView('global');
    ctx.map?.setTimeRange('7d');
    actions?.mountLiveNewsIfReady?.();
    actions?.syncDataFreshnessWithLayers();
    scheduleMissionDataRefresh();
    actions?.syncUrlState();
    showToast('Mission preset reset');
    setActivePreset(null);
    setIsOpen(false);
  }

  function handleClose(): void {
    dismissMissionPresetPrompt();
    setIsDismissed(true);
    setIsOpen(false);
  }

  const isActive = !!activePreset;
  const isSuggested = !isActive && !isDismissed;
  const btnClassName = [
    'mission-preset-button',
    isActive ? 'mission-preset-button--active' : '',
    isSuggested ? 'mission-preset-button--suggested' : '',
  ].filter(Boolean).join(' ');

  const mount = document.getElementById('missionPresetMount');
  if (!mount) return null;

  return createPortal(
    <>
      <button
        ref={anchorRef}
        id="missionPresetBtn"
        type="button"
        className={btnClassName}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title={activePreset ? `Mission: ${activePreset.label}` : 'Choose mission preset'}
        onClick={() => { setIsMobilePopover(false); setIsOpen((prev) => !prev); }}
      >
        <span className="mission-preset-button__icon">{activePreset?.icon ?? '◎'}</span>
        <span className="mission-preset-button__label">{activePreset?.shortLabel ?? 'Mission'}</span>
      </button>
      {isOpen && (
        <MissionPresetPopover
          anchor={anchorRef.current}
          mobile={isMobilePopover}
          activePreset={activePreset}
          onSelect={handleApplyPreset}
          onReset={handleResetPreset}
          onClose={handleClose}
        />
      )}
    </>,
    mount,
  );
}
