import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { setRendererCapability } from '@/services/china-corridor-store';
export function useMapLayerHandlers(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx?.map) return;
    const actions = getPublishedAppActions();
    if (!actions) return;

    ctx.map.setOnLayerChange((layer, enabled, source) => {
      actions.applyMapLayerChange(layer, enabled, source);
    });

    ctx.map.setOnAircraftPositionsUpdate((positions) => {
      ctx.intelligenceCache.aircraftPositions = positions;
      const military = ctx.intelligenceCache.military?.flights ?? [];
      actions.updateFlightSource?.(positions, military);
    });

    ctx.map.setOnChinaCorridorRendererCapabilityChange((supported) => {
      setRendererCapability(supported);
    });
  }, [ctx]);
}
