import { useEffect, useState } from 'react';
import { createAppManagers, type AppManagers } from '@/app/create-app-managers';
import { initApp, destroyApp } from '@/app/app-lifecycle';
import { installChunkReloadGuard, clearChunkReloadGuard } from '@/bootstrap/chunk-reload';

declare const __APP_VERSION__: string;

export function useAppLifecycle(): void {
  const [managers] = useState<AppManagers>(() => createAppManagers('app'));

  useEffect(() => {
    let webMcp: AbortController | null = null;
    const storageKey = installChunkReloadGuard(__APP_VERSION__);

    void initApp(managers)
      .then((ctrl) => {
        webMcp = ctrl;
        clearChunkReloadGuard(storageKey);
      })
      .catch(console.error);

    return () => {
      destroyApp(managers, webMcp);
    };
  }, []);
}
