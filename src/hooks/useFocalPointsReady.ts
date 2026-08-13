import { useEffect } from 'react';
import { getPublishedAppActions } from '@/services/app-actions-bridge';

export function useFocalPointsReady(): void {
  useEffect(() => {
    const handler = () => {
      getPublishedAppActions()?.refreshCiiAfterFocalPointsReady?.();
    };
    window.addEventListener('focal-points-ready', handler);
    return () => window.removeEventListener('focal-points-ready', handler);
  }, []);
}
