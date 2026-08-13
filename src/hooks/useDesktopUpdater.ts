import { useEffect } from 'react';
import { isDesktopRuntime } from '@/services/runtime';
import { DesktopUpdater } from '@/app/desktop-updater';
import type { AppContext } from '@/app/app-context';

export function useDesktopUpdater(): void {
  useEffect(() => {
    const stub = { isDesktopApp: isDesktopRuntime(), isDestroyed: false } as Pick<AppContext, 'isDesktopApp' | 'isDestroyed'>;
    const updater = new DesktopUpdater(stub as AppContext);
    updater.init();
    return () => {
      stub.isDestroyed = true;
      updater.destroy();
    };
  }, []);
}
