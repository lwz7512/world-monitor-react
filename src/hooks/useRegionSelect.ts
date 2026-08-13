import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { trackMapViewChange } from '@/services/analytics';
import type { MapView } from '@/components/MapContainer';

export function useRegionSelect(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    const el = document.getElementById('regionSelect') as HTMLSelectElement | null;
    if (!el) return;
    const handler = () => {
      ctx.map?.setView(el.value as MapView);
      trackMapViewChange(el.value);
    };
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, [ctx]);
}
