import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';

export function useThemeChangedSync(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    const handler = () => {
      ctx.map?.render();
    };
    window.addEventListener('theme-changed', handler);
    return () => window.removeEventListener('theme-changed', handler);
  }, [ctx]);
}
