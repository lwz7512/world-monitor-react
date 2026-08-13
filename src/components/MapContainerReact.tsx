import { useLayoutEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { MapContainer, MapContainerState, MapContainerOptions } from './MapContainer';

export interface MapContainerHandle {
  readonly instance: MapContainer | null;
}

interface MapContainerReactProps {
  MapContainerClass: typeof MapContainer;
  initialState: MapContainerState;
  preferGlobe?: boolean;
  options?: MapContainerOptions;
  onReady?: (map: MapContainer) => void;
}

export const MapContainerReact = forwardRef<MapContainerHandle, MapContainerReactProps>(
  function MapContainerReact({ MapContainerClass, initialState, preferGlobe = false, options, onReady }, ref) {
    const divRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<MapContainer | null>(null);

    useImperativeHandle(ref, () => ({
      get instance() { return mapRef.current; },
    }), []);

    useLayoutEffect(() => {
      const div = divRef.current;
      if (!div) return;
      const map = new MapContainerClass(div, initialState, preferGlobe, options ?? {});
      mapRef.current = map;
      onReady?.(map);
      return () => {
        map.destroy();
        mapRef.current = null;
      };
    // One-shot: class/initialState/preferGlobe are construction-time config, not reactive props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <div ref={divRef} className="map-container" id="mapContainer" />;
  }
);

/**
 * Mount the React-wrapped MapContainer synchronously into `mountEl` and return
 * the constructed MapContainer instance. Uses flushSync + useLayoutEffect so
 * the instance is available before this function returns, preserving the
 * synchronous construction flow in panel-layout.ts.
 */
export function mountMapContainer(
  mountEl: HTMLElement,
  props: Omit<MapContainerReactProps, 'onReady'>,
): MapContainer {
  let instance: MapContainer | null = null;
  const root = createRoot(mountEl);
  flushSync(() =>
    root.render(
      <MapContainerReact
        {...props}
        onReady={(map) => {
          instance = map;
        }}
      />,
    ),
  );
  if (!instance) throw new Error('[MapContainerReact] useLayoutEffect did not fire synchronously');
  return instance;
}
