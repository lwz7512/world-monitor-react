import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { debounce } from '@/utils';

export function useMapResizeSync(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    const handler = debounce(() => {
      ctx.map?.setIsResizing(false);
      ctx.map?.render();
    }, 150);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [ctx]);
}
